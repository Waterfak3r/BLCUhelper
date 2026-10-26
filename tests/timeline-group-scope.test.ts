// Failure cases: a composite or mention folding into a fact; stale fact membership still folding;
// a future/withdrawn/unselected report affecting the anchor; filters choosing an anchor outside their
// own set; a later report moving a fact; equal-time standalone cards changing cursor order.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { loadTimeline } from "@aihot/backend/publication/timeline";
import { loadGroupReports } from "@aihot/backend/publication/groups";
import { InvalidCursorError } from "@aihot/backend/lib/cursor";

after(closeDb);

test("timeline grouping preserves evidence scope and filter-local anchors", async () => {
  const prefix = `timeline-scope-${tag()}`;
  const at = new Date("2026-01-01T00:00:00Z");
  const now = new Date(+at + 100_000);
  await sql`INSERT INTO sources (id, name, kind, tier) VALUES (${prefix}, ${prefix}, 'rss', 'T1')`;
  const [fact] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, title) VALUES (${prefix}, ${prefix}) RETURNING id`;
  const add = async (suffix: string, seconds: number, options: { role?: string; scope?: string; channel?: string; visibility?: string; selected?: boolean; future?: boolean; missing?: boolean; standalone?: boolean } = {}) => {
    const id = `${prefix}-${suffix}`;
    const time = new Date(+at + seconds * 1000);
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
      VALUES (${id}, ${prefix}, ${id}, ${`https://example.org/${id}`}, ${id}, ${time}, ${time})`;
    const [analysis] = await sql<{ id: number }[]>`INSERT INTO analyses (article_id, input_revision, origin, output)
      VALUES (${id}, 1, 'rule', ${sql.json(options.scope ? { scope: options.scope } : {})}) RETURNING id`;
    await sql`INSERT INTO publications (article_id, source_id, analysis_id, title, url, discovered_at, timeline_at, sort_at, visible_after,
      selected, eligible, visibility, channel, tags, fact_id)
      VALUES (${id}, ${prefix}, ${analysis!.id}, ${id}, ${`https://example.org/${id}`}, ${time}, ${time}, ${time}, ${options.future ? new Date(+now + 1) : time},
        ${options.selected ?? true}, true, ${options.visibility ?? "public"}, ${options.channel ?? "news"}, ${[prefix]}, ${options.standalone ? null : fact!.id})`;
    if (!options.missing && !options.standalone) await sql`INSERT INTO fact_articles (fact_id, article_id, role)
      VALUES (${fact!.id}, ${id}, ${options.role ?? "report"})`;
    return id;
  };
  await add("old-report", 0);
  await add("x-report", 10, { channel: "x" });
  const standalone = [
    await add("composite", 20, { scope: "composite" }),
    await add("mention", 30, { role: "mention" }),
    await add("removed", 40, { missing: true }),
    await add("standalone-a", 50, { standalone: true }),
    await add("standalone-z", 50, { standalone: true }),
  ];
  await add("future", -50, { future: true });
  await add("withdrawn", -40, { visibility: "withdrawn" });
  await add("unselected", -30, { selected: false });
  const filters = { channel: "all" as const, category: null, college: null, tag: prefix, now };
  const full = await loadTimeline(filters);
  assert.deepEqual(full.cards.map(card => card.key), [...standalone.reverse().map(id => `a${id}`), `f${fact!.id}`]);
  assert.equal(full.cards.at(-1)!.anchorAt, at.toISOString());
  assert.deepEqual(new Set(full.cards.at(-1)!.group!.memberIds), new Set([`${prefix}-old-report`, `${prefix}-x-report`]));
  const filtered = await loadTimeline({ ...filters, channel: "x" });
  assert.deepEqual(filtered.cards.map(card => [card.key, card.anchorAt]), [[`f${fact!.id}`, new Date(+at + 10_000).toISOString()]]);
  const news = await loadTimeline({ ...filters, channel: "news" });
  assert.deepEqual(news.cards.find(card => card.key === `f${fact!.id}`)!.group!.memberIds, [`${prefix}-old-report`]);
  const paged = [];
  let cursor: string | null = null;
  do {
    const page = await loadTimeline({ ...filters, cursor, limit: 2 });
    paged.push(...page.cards);
    cursor = page.nextCursor;
  } while (cursor);
  assert.equal(JSON.stringify(paged), JSON.stringify(full.cards));
});

test("college timeline keeps representatives, anchors, counts, expansion, cursors and caches in scope", async () => {
  const prefix = `college-scope-${tag()}`;
  const at = new Date(Date.now() - 60_000);
  const sources = ["blcu-xxkx-notices", "blcu-xxkx-rss", "blcu-bs-notices", "blcu-yjsy-notices"];
  for (const source of sources) await sql`INSERT INTO sources (id, name, kind, tier)
    VALUES (${source}, '信息科学学院 notification', 'rss', 'T1') ON CONFLICT (id) DO NOTHING`;
  const [fact] = await sql<{ id: number }[]>`INSERT INTO facts (public_id, title) VALUES (${prefix}, ${prefix}) RETURNING id`;
  const add = async (suffix: string, source: string, age: number, grouped: boolean) => {
    const id = `${prefix}-${suffix}`;
    const time = new Date(+at - age * 1000);
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, discovered_at, timeline_at)
      VALUES (${id}, ${source}, ${id}, ${`https://example.org/${id}`}, ${id}, ${time}, ${time})`;
    await sql`INSERT INTO publications (article_id, source_id, title, url, discovered_at, timeline_at, sort_at,
      visible_after, selected, eligible, visibility, channel, category, tags, fact_id)
      VALUES (${id}, ${source}, ${id}, ${`https://example.org/${id}`}, ${time}, ${time}, ${time}, ${time},
        true, true, 'public', 'news', 'academic', ${[prefix]}, ${grouped ? fact!.id : null})`;
    if (grouped) await sql`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${fact!.id}, ${id}, 'report')`;
    return id;
  };
  const web = await add("web", sources[0]!, 10, true);
  const wechat = await add("wechat", sources[1]!, 5, true);
  const other = await add("other", sources[2]!, 90_000, true);
  await add("central", sources[3]!, 100_000, true);
  const standalone = await add("standalone", sources[0]!, 0, false);
  const filters = { channel: "all" as const, category: "academic" as const, tag: prefix, college: "xxkx" as const };
  // No explicit clock: exercise groupedAnchors' actual per-filter cache.
  const full = await loadTimeline(filters);
  assert.deepEqual(full.cards.map(card => card.key), [`a${standalone}`, `f${fact!.id}`]);
  const group = full.cards[1]!;
  assert.ok([web, wechat].includes(group.item.id));
  assert.equal(group.anchorAt, new Date(+at - 10_000).toISOString());
  assert.deepEqual(new Set(group.group!.memberIds), new Set([web, wechat]));
  assert.equal(group.group!.reportCount, 2);
  assert.equal(group.group!.additionalSourceCount, 1);
  assert.equal(Object.values(full.dayCounts).reduce((a, b) => a + b, 0), 2);
  const expanded = await loadGroupReports({ ...filters, factPublicId: prefix });
  assert.deepEqual(new Set(expanded!.reports.map(report => report.id)), new Set([web, wechat]));
  const bs = await loadTimeline({ ...filters, college: "bs" });
  assert.deepEqual(bs.cards.map(card => card.item.id), [other]);
  assert.equal(bs.cards[0]!.anchorAt, new Date(+at - 90_000_000).toISOString());
  assert.equal(bs.cards[0]!.group, null);
  const first = await loadTimeline({ ...filters, limit: 1 });
  assert.ok(first.nextCursor);
  const second = await loadTimeline({ ...filters, cursor: first.nextCursor });
  assert.deepEqual([...first.cards, ...second.cards], full.cards);
  await assert.rejects(loadTimeline({ ...filters, college: "bs", cursor: first.nextCursor }), InvalidCursorError);
  assert.deepEqual((await loadTimeline({ ...filters, category: "funding" })).cards, []);
  assert.deepEqual((await loadTimeline({ ...filters, tag: `${prefix}-other` })).cards, []);
});
