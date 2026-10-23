// A paused external source must not accept new reports or look healthy after a rejected push.
import "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { IngestError, ingestItems } from "@aihot/backend/ingest/items";
import { stopBoss } from "@aihot/backend/jobs/queue";
import { tag } from "./setup.ts";

after(async () => {
  await stopBoss();
  await closeDb();
});

test("a paused external source rejects pushed items without recording a successful fetch", async () => {
  const sourceId = `test-paused-ingest-${tag()}`;
  const lastOkAt = new Date("2026-09-01T00:00:00Z");
  await sql`
    INSERT INTO sources (id, name, kind, config, tier, participation_mode, enabled, health, last_ok_at)
    VALUES (${sourceId}, 'Paused external source', 'external', '{}'::jsonb, 'T2', 'editorial', false, 'paused', ${lastOkAt})`;

  await assert.rejects(
    ingestItems({ sourceId, items: [{ title: "New report", url: `https://example.org/${sourceId}` }] }),
    (error: unknown) => error instanceof IngestError && error.status === 409,
  );

  const [source] = await sql<{ last_ok_at: Date }[]>`SELECT last_ok_at FROM sources WHERE id = ${sourceId}`;
  const [articles] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM articles WHERE source_id = ${sourceId}`;
  assert.equal(source!.last_ok_at.toISOString(), lastOkAt.toISOString());
  assert.equal(articles!.count, 0);

  await sql`UPDATE sources SET enabled = true WHERE id = ${sourceId}`;
  assert.deepEqual(await ingestItems({ sourceId, items: [{ title: "New report", url: `https://example.org/${sourceId}` }] }), { ok: true, created: 1 });
});

test("an externally reported calendar day stays date-only through storage", async () => {
  const sourceId = `test-date-ingest-${tag()}`;
  await ingestItems({ sourceId, items: [{ title: "Calendar day", url: `https://example.org/${sourceId}`, publishedAt: "2026-10-13" }] });
  const [row] = await sql`SELECT publication_time, published_at_claim FROM articles WHERE source_id=${sourceId}`;
  assert.equal(row!.publication_time, "2026-10-13");
  assert.equal(row!.published_at_claim.toISOString(), "2026-10-13T00:00:00.000Z");
});

test("body completion and changes revise one material; repeated or absent bodies preserve it", async () => {
  const sourceId = `test-body-state-${tag()}`;
  const url = `https://example.org/${sourceId}/state`;
  const title = "State transition title";
  const publishedAt = "2026-10-21";

  // 1. first create with no bodyText (but trusted date)
  await ingestItems({ sourceId, items: [{ title, url, publishedAt }] });
  let [a] = await sql<{ id: string; revision: number; body_text: string | null; body_status: string; published_at: Date | null; publication_time: string | null; source_id: string }[]>`SELECT id, revision, body_text, body_status, published_at, publication_time, source_id FROM articles WHERE url = ${url}`;
  const articleId = a!.id;
  assert.equal(a!.source_id, sourceId);
  assert.equal(a!.revision, 1);
  assert.equal(a!.body_text, null);
  assert.equal(a!.body_status, "pending");
  assert.equal(a!.publication_time, publishedAt);

  // 2. same sourceId/url/title add bodyText -> revision +1, body set, status ok
  await ingestItems({ sourceId, items: [{ title, url, publishedAt, bodyText: "  initial verified body  " }] });
  [a] = await sql`SELECT id, revision, body_text, body_status, publication_time FROM articles WHERE id = ${articleId}`;
  assert.equal(a!.id, articleId);
  assert.equal(a!.revision, 2);
  assert.equal(a!.body_text, "initial verified body");
  assert.equal(a!.body_status, "ok");
  assert.equal(a!.publication_time, publishedAt);

  // 3. real body change -> revision +1 again
  await ingestItems({ sourceId, items: [{ title, url, publishedAt, bodyText: "updated body after real change" }] });
  [a] = await sql`SELECT id, revision, body_text, body_status FROM articles WHERE id = ${articleId}`;
  assert.equal(a!.revision, 3);
  assert.equal(a!.body_text, "updated body after real change");
  assert.equal(a!.body_status, "ok");

  // 4. identical repeat (same body) -> no revision change
  await ingestItems({ sourceId, items: [{ title, url, publishedAt, bodyText: "updated body after real change" }] });
  [a] = await sql`SELECT id, revision, body_text, body_status FROM articles WHERE id = ${articleId}`;
  assert.equal(a!.revision, 3);
  assert.equal(a!.body_text, "updated body after real change");
  assert.equal(a!.body_status, "ok");

  // Missing, blank and non-string bodies leave the verified text and revision intact.
  for (const bad of [undefined, "   ", 123] as const) {
    await ingestItems({ sourceId, items: [
      bad === undefined
        ? { title, url, publishedAt }
        : { title, url, publishedAt, bodyText: bad }
    ] });
    [a] = await sql`SELECT id, revision, body_text, body_status FROM articles WHERE id = ${articleId}`;
    assert.equal(a!.id, articleId);
    assert.equal(a!.revision, 3);
    assert.equal(a!.body_text, "updated body after real change");
    assert.equal(a!.body_status, "ok");
  }
});

test("different source ingest for same url is discovery only, does not override source or body", async () => {
  const sourceA = `test-cross-a-${tag()}`;
  const sourceB = `test-cross-b-${tag()}`;
  const url = `https://example.org/${tag()}/cross`;
  await ingestItems({ sourceId: sourceA, items: [{ title: "Cross", url, bodyText: "body from A" }] });
  const [a] = await sql<{ source_id: string; body_text: string | null; revision: number }[]>`SELECT source_id, body_text, revision FROM articles WHERE url=${url}`;
  await ingestItems({ sourceId: sourceB, items: [{ title: "Cross", url, bodyText: "body from B attempt" }] });
  const [b] = await sql<{ source_id: string; body_text: string | null; revision: number }[]>`SELECT source_id, body_text, revision FROM articles WHERE url=${url}`;
  assert.equal(b!.source_id, a!.source_id);
  assert.equal(b!.body_text, a!.body_text);
  assert.equal(b!.revision, a!.revision);
  const discs = await sql`SELECT source_id FROM article_discoveries WHERE article_id = (SELECT id FROM articles WHERE url=${url}) ORDER BY discovered_at`;
  assert.ok(discs.some(d => (d as Record<string, unknown>).source_id === sourceB));
});

test("ingest with bodyText but no date keeps published_at and publication_time null", async () => {
  const sourceId = `test-body-nodate-${tag()}`;
  const url = `https://example.org/${sourceId}/nodate`;
  await ingestItems({ sourceId, items: [{ title: "No date body", url, bodyText: "text without date" }] });
  const [a] = await sql<{ published_at: Date | null; publication_time: string | null; body_text: string | null }[]>`SELECT published_at, publication_time, body_text FROM articles WHERE url=${url}`;
  assert.equal(a!.published_at, null);
  assert.equal(a!.publication_time, null);
  assert.equal(a!.body_text, "text without date");
});

test("repeat ingest omitting date does not clear a previously trusted date", async () => {
  const sourceId = `test-date-preserve-${tag()}`;
  const url = `https://example.org/${sourceId}/date-preserve`;
  await ingestItems({ sourceId, items: [{ title: "Has date", url, publishedAt: "2026-10-21", bodyText: "with date body" }] });
  const [withDate] = await sql<{ published_at: Date | null; publication_time: string | null }[]>`SELECT published_at, publication_time FROM articles WHERE url=${url}`;
  assert.ok(withDate!.published_at);
  assert.equal(withDate!.publication_time, "2026-10-21");
  await ingestItems({ sourceId, items: [{ title: "Has date", url }] });
  const [noDate] = await sql<{ published_at: Date | null; publication_time: string | null }[]>`SELECT published_at, publication_time FROM articles WHERE url=${url}`;
  assert.equal(noDate!.published_at?.toISOString(), withDate!.published_at!.toISOString());
  assert.equal(noDate!.publication_time, withDate!.publication_time);
});

test("paused source still rejects even with bodyText", async () => {
  const sourceId = `test-paused-body-${tag()}`;
  await sql`
    INSERT INTO sources (id, name, kind, config, tier, participation_mode, enabled, health, last_ok_at)
    VALUES (${sourceId}, 'Paused body', 'external', '{}'::jsonb, 'T2', 'editorial', false, 'paused', now())`;
  await assert.rejects(
    ingestItems({ sourceId, items: [{ title: "Body on paused", url: `https://ex/${sourceId}`, bodyText: "x" }] }),
    (error: unknown) => error instanceof IngestError && error.status === 409,
  );
  await sql`UPDATE sources SET enabled=true WHERE id=${sourceId}`;
});
