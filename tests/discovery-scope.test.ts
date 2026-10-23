// A topic directory kept for the website must not become a second stale layer beneath discovery's
// own cache. Its last qualifying report can be withdrawn while the directory is still warm.
import "./topic-fixtures.ts";
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { sql, closeDb } from "@aihot/backend/db";
import { topicPageCounts, restoreTopicFixtures } from "./topic-fixtures.ts";
import { loadLlmsAvailability } from "@aihot/backend/publication/llms";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();
after(async () => {
  restoreTopicFixtures();
  await app.close(); await closeDb();
});

test("llms and sitemap build from current topic scope rather than a cached directory", async () => {
  const source = `discovery-topics-${tag()}`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode) VALUES (${source},'Discovery topics','rss','T1','editorial')`;
  for (let i = 0; i < 20; i++) {
    const id = `${source}-${i}`;
    await sql`INSERT INTO articles (id,source_id,identity_key,url,title,timeline_at,discovered_at)
      VALUES (${id},${source},${id},${`https://example.org/${id}`},'BLCU',now(),now())`;
    await sql`INSERT INTO publications (article_id,source_id,title,summary,url,timeline_at,discovered_at,sort_at,selected,eligible,visible_after,tags,channel,category)
      VALUES (${id},${source},'BLCU 发布模型','Summary',${`https://example.org/${id}`},now(),now(),now(),true,true,now() - interval '1 minute',ARRAY['entity:blcu'],'news','academic')`;
  }
  assert.equal((await topicPageCounts()).find((topic) => topic.slug === "blcu")!.indexable, true);
  await sql`UPDATE publications SET visibility = 'withdrawn' WHERE source_id = ${source}`;
  assert.ok(!(await loadLlmsAvailability()).topics.some((topic) => topic.slug === "blcu"));
  const sitemap = await app.inject("/sitemap.xml");
  assert.equal(sitemap.statusCode, 200);
  assert.ok(!sitemap.body.includes("/topics/blcu</loc>"));
});
