import "./topic-fixtures.ts";
// bare FIRST per topic-fixtures (side effects for campus/synthetic)
import { restoreTopicFixtures } from "./topic-fixtures.ts";
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { overrideFields, searchContent } from "@aihot/backend/admin/content";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { publishArticle } from "@aihot/backend/publication/publish";
import { alignCategoryTags } from "@aihot/backend/editorial/vocabulary";
import { QUEUES, getBoss, stopBoss } from "@aihot/backend/jobs/queue";

after(async () => { restoreTopicFixtures(); await stopBoss(); await closeDb(); });

test("classification alignment preserves publication identities and custom tags without a model whitelist or six-tag cap", () => {
  const tags = ["校园资讯", "entity:blcu", "编辑核验", "教务考试", "本科生", "研究生", "留学生", "新生", "毕业生", "部门专题"];
  const remaining = ["entity:blcu", "编辑核验", "本科生", "研究生", "留学生", "新生", "毕业生", "部门专题"];
  assert.deepEqual(alignCategoryTags(tags, "international"), ["国际交流", ...remaining]);
  assert.deepEqual(alignCategoryTags(tags, null), remaining);
  assert.deepEqual(alignCategoryTags(tags, "unknown"), remaining);
  assert.deepEqual(tags, ["校园资讯", "entity:blcu", "编辑核验", "教务考试", "本科生", "研究生", "留学生", "新生", "毕业生", "部门专题"]);
});
test("category corrections revise every standard report atomically without selecting, rewriting or notifying", async () => {
  await getBoss(); // the digest check below reads the job table
  const sourceId = `category-${tag()}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode) VALUES (${sourceId},'Category fixture','rss','T1','editorial')`;
  const { articleId } = await upsertMaterial({ sourceId, url: `https://example.com/${sourceId}`, title: "国际暑校交换项目申请通知", bodyText: "国际暑校交换项目开放申请，入选学生可获项目资助。", bodyStatus: "ok", via: "fetch", publishedAt: new Date() });
  await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,subjects,title_zh,summary_zh,score,selected)
    VALUES (${articleId},1,'rule','pass','academic',ARRAY['校园资讯','教务考试','本科生','历史专题'],ARRAY['blcu'],'国际暑校交换项目申请通知','冻结摘要',88,true)`;
  const [story] = await sql`INSERT INTO stories (public_id,title) VALUES (gen_random_uuid(),'国际暑校交换项目') RETURNING id`;
  const [fact] = await sql`INSERT INTO facts (public_id,title,story_id) VALUES (${`f-${tag()}`},'暑校交换项目开放申请',${story!.id}) RETURNING id`;
  await sql`INSERT INTO fact_articles (fact_id,article_id,role) VALUES (${fact!.id},${articleId},'report')`;
  await publishArticle(articleId, { releasedAt: new Date() });
  const publication = async () => (await sql`SELECT category,tags FROM publications WHERE article_id=${articleId}`)[0]!;
  assert.deepEqual(await publication(), { category: "academic", tags: ["教务考试", "本科生", "历史专题", "entity:blcu"] });
  const entry = { itemId: articleId, title: "冻结标题", summary: "冻结摘要", sourceId, firstParty: true, role: "官方" };
  const contents = [
    { kind: "daily", key: "2097-01-02", content: { leadItemId: articleId, lead: { title: "冻结头条" }, highlights: [articleId], flashes: [], sections: [{ label: "教务考试", items: [entry] }], metrics: { totalEvents: 1 } } },
    ...(["weekly", "monthly"] as const).map(kind => ({ kind, key: kind === "weekly" ? "2097-W01" : "2097-01", content: { headline: "冻结头条", leadItemId: articleId, storyOrder: [articleId], overview: "保留总述", themes: [{ heading: "教务考试", summary: "旧模型导读", storyRefs: [entry] }], metrics: { totalStories: 1 } } })),
  ];
  for (const r of contents) await sql`INSERT INTO reports (kind,key,window_start,window_end,content,generated_at,origin)
    VALUES (${r.kind},${r.key},now(),now(),${sql.json(r.content as never)},now(),'imported')`;
  const [before] = await sql`SELECT selected,seat,score,visible_after,selected_ready_at FROM publications WHERE article_id=${articleId}`;
  const change = (actor: string) => overrideFields(articleId, { fields: { category: "international" }, version: 0, reason: "交流项目附带资助仍归国际交流" }, actor);
  await sql.unsafe(`CREATE FUNCTION reject_category_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.actor = 'reject-category' THEN RAISE EXCEPTION 'category audit rejected'; END IF; RETURN NEW; END $$`);
  await sql.unsafe("CREATE TRIGGER reject_category_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_category_audit()");
  try {
    await assert.rejects(change("reject-category"), /category audit rejected/);
    assert.equal((await sql`SELECT category FROM publications WHERE article_id=${articleId}`)[0]!.category, "academic");
    assert.equal((await sql`SELECT 1 FROM report_revisions WHERE report_id IN (SELECT id FROM reports WHERE key IN ('2097-01-02','2097-W01','2097-01'))`).length, 0);
  } finally {
    await sql.unsafe("DROP TRIGGER reject_category_audit ON audit_log; DROP FUNCTION reject_category_audit()");
  }
  const digestCount = (await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name=${QUEUES.digest}`)[0]!.n;
  await change("test-category");
  assert.deepEqual(await publication(), { category: "international", tags: ["国际交流", "本科生", "历史专题", "entity:blcu"] });
  for (const r of contents) {
    const [saved] = await sql`SELECT content,revision FROM reports WHERE kind=${r.kind} AND key=${r.key}`;
    assert.equal(saved!.revision, 2);
    const c = saved!.content;
    assert.equal(c.leadItemId, articleId);
    if (r.kind === "daily") {
      assert.deepEqual(c.sections, [{ label: "国际交流", items: [entry] }]);
      assert.deepEqual(c.highlights, [articleId]);
      assert.equal(c.lead.title, "冻结头条");
    } else {
      assert.deepEqual(c.themes, [{ heading: "国际交流", summary: null, storyRefs: [entry] }]);
      assert.deepEqual(c.storyOrder, [articleId]);
      assert.equal(c.overview, "保留总述");
    }
  }
  assert.deepEqual((await sql`SELECT selected,seat,score,visible_after,selected_ready_at FROM publications WHERE article_id=${articleId}`)[0], before);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name=${QUEUES.digest}`)[0]!.n, digestCount);
  await overrideFields(articleId, { fields: {}, clear: ["category"], version: 1, reason: "验证撤销纠错" }, "test-category");
  assert.deepEqual(await publication(), { category: "academic", tags: ["教务考试", "本科生", "历史专题", "entity:blcu"] });
  const [restored] = await sql`SELECT content FROM reports WHERE kind='daily' AND key='2097-01-02'`;
  assert.equal(restored!.content.sections[0].label, "教务考试");
  const manualTags = ["校园资讯", "国际交流", "entity:blcu", "人工专题", "本科生", "研究生", "留学生", "新生", "毕业生"];
  await overrideFields(articleId, { fields: { tags: manualTags }, version: 2, reason: "人工专题保留" }, "test-category");
  const nonCategoryTags = ["entity:blcu", "人工专题", "本科生", "研究生", "留学生", "新生", "毕业生"];
  assert.deepEqual(await publication(), { category: "academic", tags: ["教务考试", ...nonCategoryTags] });
  await overrideFields(articleId, { fields: { category: "international" }, version: 3, reason: "只修类别并保留人工标签" }, "test-category");
  assert.deepEqual(await publication(), { category: "international", tags: ["国际交流", ...nonCategoryTags] });
  await overrideFields(articleId, { fields: { category: null }, version: 4, reason: "证据不足主动清空类别" }, "test-category");
  assert.deepEqual(await publication(), { category: null, tags: nonCategoryTags });
  for (const r of contents) {
    const [saved] = await sql`SELECT content,revision FROM reports WHERE kind=${r.kind} AND key=${r.key}`;
    assert.equal(saved!.revision, 5, `${r.kind}: clearing category creates its own report revision`);
    assert.equal(saved!.content.leadItemId, articleId);
    assert.deepEqual(saved!.content.metrics, r.content.metrics);
    if (r.kind === "daily") {
      assert.deepEqual(saved!.content.sections, [{ label: "校园资讯", items: [entry] }]);
      assert.deepEqual(saved!.content.highlights, [articleId]);
      assert.equal(saved!.content.lead.title, "冻结头条");
    } else {
      assert.deepEqual(saved!.content.themes, [{ heading: "校园资讯", summary: null, storyRefs: [entry] }]);
      assert.deepEqual(saved!.content.storyOrder, [articleId]);
      assert.equal(saved!.content.headline, "冻结头条");
      assert.equal(saved!.content.overview, "保留总述");
    }
    const [prior] = await sql`SELECT content FROM report_revisions
      WHERE report_id=(SELECT id FROM reports WHERE kind=${r.kind} AND key=${r.key}) AND revision=4`;
    if (r.kind === "daily") assert.deepEqual(prior!.content.sections, [{ label: "国际交流", items: [entry] }]);
    else assert.deepEqual(prior!.content.themes, [{ heading: "国际交流", summary: null, storyRefs: [entry] }]);
  }
  await publishArticle(articleId);
  assert.deepEqual(await publication(), { category: null, tags: nonCategoryTags }, "rebuilding must not restore a deliberately cleared category");
  await overrideFields(articleId, { fields: {}, clear: ["category"], version: 5, reason: "撤销未分类覆盖" }, "test-category");
  assert.deepEqual(await publication(), { category: "academic", tags: ["教务考试", ...nonCategoryTags] });
  await overrideFields(articleId, { fields: {}, clear: ["tags"], version: 6, reason: "撤销人工标签覆盖" }, "test-category");
  assert.deepEqual(await publication(), { category: "academic", tags: ["教务考试", "本科生", "历史专题", "entity:blcu"] });
  for (const r of contents) {
    const [saved] = await sql`SELECT content,revision FROM reports WHERE kind=${r.kind} AND key=${r.key}`;
    assert.equal(saved!.revision, 6, `${r.kind}: removing the null override restores classification once`);
    if (r.kind === "daily") assert.deepEqual(saved!.content.sections, [{ label: "教务考试", items: [entry] }]);
    else assert.deepEqual(saved!.content.themes, [{ heading: "教务考试", summary: null, storyRefs: [entry] }]);
  }
  assert.deepEqual((await sql`SELECT selected,seat,score,visible_after,selected_ready_at FROM publications WHERE article_id=${articleId}`)[0], before);
  assert.equal((await sql`SELECT count(*)::int AS n FROM pgboss.job WHERE name=${QUEUES.digest}`)[0]!.n, digestCount);
  assert.equal((await sql`SELECT 1 FROM receipts WHERE subject LIKE ${`article:${articleId}@%`}`).length, 0);
});

test("content review intersects category with title, ID and URL searches and supports category-only history", async () => {
  const marker = `review-${tag()}`;
  const sourceId = `${marker}-source`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode) VALUES (${sourceId},'Review fixture','rss','T1','editorial')`;
  const create = async (key: string, category: "opportunities" | "campus") => {
    const url = `https://example.com/${marker}/${key}`;
    const { articleId } = await upsertMaterial({ sourceId, url, title: `${marker} 原始标题 ${key}`, bodyText: "历史公告正文", bodyStatus: "ok", via: "fetch",
      publishedAt: new Date("2025-01-01T00:00:00Z") });
    await sql`INSERT INTO analyses (article_id,input_revision,origin,relevance,category,tags,title_zh,summary_zh,selected)
      VALUES (${articleId},1,'rule','pass',${category},ARRAY[]::text[],${`${marker} 公开标题 ${key}`},'历史公告摘要',false)`;
    await publishArticle(articleId, { releasedAt: new Date("2025-01-01T00:00:00Z") });
    return { id: articleId, url };
  };
  const first = await create("a", "opportunities");
  const second = await create("b", "opportunities");
  const other = await create("c", "campus");
  const ids = async (query: string, category: "opportunities" | "campus" | null) => (await searchContent(query, category)).map(row => row.id).sort();
  assert.deepEqual(await ids("", null), []);
  assert.deepEqual(await ids(marker, null), [first.id, second.id, other.id].sort());
  assert.deepEqual(await ids(marker, "opportunities"), [first.id, second.id].sort());
  assert.deepEqual(await ids(`${marker} 原始标题`, "opportunities"), [first.id, second.id].sort());
  assert.deepEqual(await ids(`${marker} 公开标题`, "opportunities"), [first.id, second.id].sort());
  assert.deepEqual(await ids("  ", "opportunities"), [first.id, second.id].sort());
  assert.deepEqual(await ids(first.id, "opportunities"), [first.id]);
  assert.deepEqual(await ids(first.id, "campus"), []);
  assert.deepEqual(await ids(other.id, "opportunities"), []);
  assert.deepEqual(await ids(first.url, "opportunities"), [first.id]);
  assert.deepEqual(await ids(first.url, "campus"), []);
  assert.deepEqual(await ids(other.url, "opportunities"), []);
});
