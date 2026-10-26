import "./topic-fixtures.ts";
// bare FIRST per topic-fixtures (side effects for mock + campus/synthetics before anything else)
import { restoreTopicFixtures } from "./topic-fixtures.ts";
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { loadPool, publicMatchCondition, searchTerms } from "@aihot/backend/publication/pool";

const T = `relevance-${tag()}`;
const now = new Date("2026-01-01T12:00:00Z");
const id = (suffix: string) => `${T}-${suffix}`;
const query = (q: string) => ({ channel: "all" as const, category: null, college: null, tag: null, tab: "relevance" as const, q, now });
after(restoreTopicFixtures);
after(closeDb);
before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${T}, ${T}, 'rss', 'T1')`;
});

async function add(suffix: string, direct: string, body: string, options: {
  title?: string; age?: number; channel?: "news" | "x"; category?: "academic" | "opportunities"; tags?: string[];
  sourceId?: string;
  visibility?: string; eligible?: boolean; future?: boolean; noSearchRow?: boolean;
} = {}) {
  const at = new Date(+now - (options.age ?? 60) * 1000);
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
    VALUES (${id(suffix)}, ${options.sourceId ?? T}, ${id(suffix)}, ${`https://example.org/${id(suffix)}`}, ${options.title ?? "neutral"}, ${at}, ${at})`;
  await sql`INSERT INTO publications (article_id, title, source_id, channel, category, tags, url, discovered_at, timeline_at, sort_at,
    selected, eligible, visibility, visible_after, search_text)
    VALUES (${id(suffix)}, ${options.title ?? "neutral"}, ${options.sourceId ?? T}, ${options.channel ?? "news"}, ${options.category ?? "academic"}, ${options.tags ?? []},
      ${`https://example.org/${id(suffix)}`}, ${at}, ${at}, ${at}, ${options.future ?? false}, ${options.eligible ?? true},
      ${options.visibility ?? "public"}, ${options.future ? new Date(+now + 60_000) : at}, ${direct})`;
  if (!options.noSearchRow) await sql`INSERT INTO pool_search (article_id, direct, body) VALUES (${id(suffix)}, ${direct}, ${body})`;
}

test("short and multi-term relevance keep cross-field AND and deterministic score ties", async () => {
  await add("title", "zx qy", "zx qy", { title: "ZX QY", age: 100 });
  await add("cross-a", "zx", "qy", { age: 50 });
  await add("cross-z", "zx", "qy", { age: 50 });
  await add("body", "", "zx qy", { age: 1 });
  await add("partial", "zx", "zx", { age: 10 });
  await add("withdrawn", "zx qy", "zx qy", { visibility: "withdrawn" });
  await add("future", "zx qy", "zx qy", { future: true });
  await add("ineligible", "zx qy", "zx qy", { eligible: false });
  const multi = await loadPool(query("zx qy"));
  assert.deepEqual(multi.items.map(item => item.id), ["title", "cross-z", "cross-a", "body"].map(id));
  assert.equal(multi.total, 4);
  const single = await loadPool(query("zx"));
  assert.deepEqual(single.items.map(item => item.id), ["title", "partial", "cross-z", "cross-a", "body"].map(id));
  const beyond = await loadPool({ ...query("zx qy"), page: 2 });
  assert.deepEqual([beyond.items, beyond.total, beyond.pageCount], [[], 4, 1]);
});
test("company relevance retains tag-only candidates, boosts and unique totals", async () => {
  await add("company-both", "testcol", "testcol", { title: "Test College", tags: ["entity:testcollege"], age: 100 });
  await add("company-tag", "", "", { tags: ["entity:testcollege"], noSearchRow: true, age: 1 });
  await add("company-text", "testcol qy", "testcol", { title: "Test College", age: 60 });
  await add("company-low", "testcol", "", { age: 1 });
  await add("company-withdrawn", "testcol", "testcol", { tags: ["entity:testcollege"], visibility: "withdrawn" });
  const company = await loadPool(query("TestCol"));
  assert.deepEqual(company.items.map(item => item.id), ["company-both", "company-tag", "company-text", "company-low"].map(id));
  assert.equal(company.total, 4, "the text-and-tag candidate counts once");
  const multi = await loadPool(query("testcol qy"));
  assert.deepEqual(multi.items.map(item => item.id), [id("company-text")], "only the whole company alias expands the candidates");
});

test("relevance retains combined filters and literal LIKE characters", async () => {
  await add("filtered", "uv", "uv", { channel: "x", category: "academic", tags: [T] });
  await add("wrong-channel", "uv", "uv", { category: "academic", tags: [T] });
  await add("wrong-category", "uv", "uv", { channel: "x", category: "opportunities", tags: [T] });
  await add("wrong-tag", "uv", "uv", { channel: "x", category: "academic" });
  const filtered = await loadPool({ ...query("uv"), channel: "x", category: "academic", tag: T });
  assert.deepEqual(filtered.items.map(item => item.id), [id("filtered")]);
  await add("literal", "qx%_\\z", "");
  await add("wildcard-lookalike", "qx-anything-z", "");
  assert.deepEqual((await loadPool(query("qx%_\\z"))).items.map(item => item.id), [id("literal")]);
});

test("search terms split where Han meets a Latin word, not before digits", () => {
  assert.deepEqual(searchTerms("多模态RAG"), ["多模态", "rag"]);
  assert.deepEqual(searchTerms("blcu code更新 campus v4"), ["blcu", "code", "更新", "campus", "v4"]);
  assert.deepEqual(searchTerms("v4版本"), ["v4", "版本"]);
  assert.deepEqual(searchTerms("10月"), ["10月"]);
});

test("public search needs a plain Latin term to start a word in the body", async () => {
  await add("kv-word", "", "a kv pipeline");
  await add("kv-han", "", "多模态kv系统");
  await add("kv-inside", "", "an mkv file");
  await add("kv-direct", "mkv", "");
  const found = async (q: string) => (await sql<{ article_id: string }[]>`
    SELECT p.article_id FROM publications p WHERE p.source_id = ${T} ${publicMatchCondition(searchTerms(q))}`)
    .map(r => r.article_id).sort();
  assert.deepEqual(await found("kv"), ["kv-direct", "kv-han", "kv-word"].map(id).sort());
});

test("equal relevance ranks a seated selected item, then the higher score, then the newest", async () => {
  await add("tie-new", "wq", "", { age: 1 });
  await add("tie-score", "wq", "", { age: 30 });
  await add("tie-selected", "wq", "", { age: 50 });
  await add("tie-unseated", "wq", "", { age: 40 });
  await sql`UPDATE publications SET score = 80 WHERE article_id = ${id("tie-score")}`;
  await sql`UPDATE publications SET selected = true, score = 10 WHERE article_id = ${id("tie-selected")}`;
  await sql`UPDATE publications SET selected = true, seat = false, score = 5 WHERE article_id = ${id("tie-unseated")}`;
  const result = await loadPool(query("wq"));
  assert.deepEqual(result.items.map(item => item.id), ["tie-selected", "tie-score", "tie-unseated", "tie-new"].map(id));
  assert.equal(result.total, 4);
});

test("college pool intersects publisher sources with category, audience and both search orderings", async () => {
  const sources = ["blcu-xxkx-notices", "blcu-xxkx-rss", "blcu-bs-notices", "blcu-yjsy-notices"];
  for (const source of sources) await sql`INSERT INTO sources (id, name, kind, tier)
    VALUES (${source}, '信息科学学院 notification', 'rss', 'T1') ON CONFLICT (id) DO NOTHING`;
  const direct = `${T} college`;
  await add("college-web", direct, direct, { sourceId: sources[0], tags: [T] });
  await add("college-wechat", direct, direct, { sourceId: sources[1], tags: [T] });
  await add("college-other", direct, direct, { sourceId: sources[2], tags: [T] });
  await add("college-central", direct, direct, { sourceId: sources[3], tags: [T] });
  await add("college-category", direct, direct, { sourceId: sources[0], category: "opportunities", tags: [T] });
  await add("college-audience", direct, direct, { sourceId: sources[0] });
  await add("college-keyword", "unrelated", "unrelated", { sourceId: sources[0], tags: [T] });
  for (const tab of ["time", "relevance"] as const) {
    const result = await loadPool({ ...query(direct), college: "xxkx", category: "academic", tag: T, tab });
    assert.deepEqual(new Set(result.items.map(item => item.id)), new Set(["college-web", "college-wechat"].map(id)));
    assert.equal(result.total, 2);
    assert.equal(result.filters.college, "xxkx");
    const beyond = await loadPool({ ...query(direct), college: "xxkx", category: "academic", tag: T, tab, page: 2 });
    assert.deepEqual([beyond.items, beyond.total, beyond.pageCount], [[], 2, 1]);
    const other = await loadPool({ ...query(direct), college: "bs", category: "academic", tag: T, tab });
    assert.deepEqual(other.items.map(item => item.id), [id("college-other")]);
  }
  const scope = { ...query(""), q: null, category: "academic" as const, tag: T };
  const result = await loadPool({ ...scope, college: "xxkx" });
  assert.equal(result.total, 3);
  assert.equal(result.todayCount, 3);
});

test("a college pool never points a yielding report at another college's selected representative", async () => {
  for (const source of ["blcu-xxkx-notices", "blcu-bs-notices"]) await sql`INSERT INTO sources (id, name, kind, tier)
    VALUES (${source}, ${source}, 'rss', 'T1') ON CONFLICT (id) DO NOTHING`;
  const [fact] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, title)
    VALUES (${`${T}-cross-college`}, 'Shared event') RETURNING id`;
  const direct = `${T} seat`;
  await add("college-yielding", direct, direct, { sourceId: "blcu-xxkx-notices", tags: [T] });
  await add("college-holder", direct, direct, { sourceId: "blcu-bs-notices", tags: [T] });
  await sql`UPDATE publications SET selected = true, fact_id = ${fact!.id},
    seat = (article_id = ${id("college-holder")})
    WHERE article_id IN ${sql(["college-yielding", "college-holder"].map(id))}`;
  const result = await loadPool({ ...query(direct), college: "xxkx", tag: T });
  assert.deepEqual(result.items.map(item => item.id), [id("college-yielding")]);
  assert.equal(result.items[0]!.sameEvent ?? null, null);
  const unfiltered = await loadPool({ ...query(direct), tag: T });
  assert.equal(unfiltered.items.find(item => item.id === id("college-yielding"))!.sameEvent?.id, id("college-holder"));
});
