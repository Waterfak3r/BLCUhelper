// Syncs sources from industry/sources.json to the database.
// By default, displays differences without modifying the database (--dry-run).
// Use --apply to execute updates.
// Run: node --env-file=.env scripts/sync-sources.ts [--apply] [--only-mp]
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { assertSupportedConfig } from "@aihot/backend/sources/config-keys";

interface SeedSource {
  id: string;
  name: string;
  kind: "rss" | "web_list" | "json_list" | "x_search" | "mp_account" | "external";
  config: Record<string, unknown>;
  tier?: string;
  owner_entity_id?: string | null;
  participation_mode?: string;
  interval_minutes?: number;
  tags?: string[];
  site_fulltext?: boolean;
  syndicate_fulltext?: boolean;
  enabled?: boolean;
}

interface DbSourceRow {
  id: string;
  name: string;
  kind: string;
  config: Record<string, unknown>;
  tier: string;
  enabled: boolean;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const onlyMp = args.includes("--only-mp");

  const raw = readFileSync(path.join(REPO_ROOT, "industry/sources.json"), "utf8");
  const { sources } = JSON.parse(raw) as { sources: SeedSource[] };

  const targetSources = onlyMp
    ? sources.filter((s) => s.id.startsWith("blcu-mp-") || s.config.feedUrl?.toString().includes("/api/articles/rss/"))
    : sources;

  const dbSources = await sql<DbSourceRow[]>`SELECT id, name, kind, config, tier, enabled FROM sources`;
  const dbMap = new Map(dbSources.map((r) => [r.id, r]));

  let newCount = 0;
  let diffCount = 0;
  let matchCount = 0;

  for (const s of targetSources) {
    assertSupportedConfig(s.kind, s.config);
    const existing = dbMap.get(s.id);
    if (!existing) {
      newCount++;
      console.log(`[NEW] ${s.id} (${s.name})`);
      if (apply) {
        const tier = s.tier ?? "T2";
        await sql`
          INSERT INTO sources (id, name, kind, config, tier, first_party, owner_entity_id, participation_mode, interval_minutes, tags, site_fulltext, syndicate_fulltext, enabled, next_fetch_at)
          VALUES (${s.id}, ${s.name}, ${s.kind}, ${sql.json(s.config as never)}, ${tier}, ${tier === "T1"}, ${s.owner_entity_id ?? null},
                  ${s.participation_mode ?? "editorial"}, ${s.interval_minutes ?? 60}, ${s.tags ?? []}, ${s.site_fulltext ?? false}, ${s.syndicate_fulltext ?? false},
                  ${s.enabled ?? true}, now())
          ON CONFLICT (id) DO NOTHING`;
      }
      continue;
    }

    const currentConfigStr = JSON.stringify(existing.config);
    const seedConfigStr = JSON.stringify(s.config);
    if (currentConfigStr !== seedConfigStr) {
      diffCount++;
      const currentFeed = existing.config.feedUrl ?? existing.config.url ?? "(no url)";
      const seedFeed = s.config.feedUrl ?? s.config.url ?? "(no url)";
      console.log(`[DIFF] ${s.id} (${s.name})`);
      console.log(`  current: ${currentFeed}`);
      console.log(`  seed:    ${seedFeed}`);
      if (apply) {
        await sql`
          UPDATE sources
          SET config = ${sql.json(s.config as never)},
              tier = ${s.tier ?? existing.tier},
              updated_at = now()
          WHERE id = ${s.id}`;
      }
    } else {
      matchCount++;
    }
  }

  console.log(`\nSummary: ${targetSources.length} target sources evaluated.`);
  console.log(`  Identical: ${matchCount}`);
  console.log(`  Config updated/diff: ${diffCount}`);
  console.log(`  Not yet in DB: ${newCount}`);

  if (!apply && (diffCount > 0 || newCount > 0)) {
    console.log(`\n[DRY RUN] Run with '--apply' to persist these changes to the database.`);
  } else if (apply) {
    console.log(`\n[APPLIED] Successfully synchronized sources with database.`);
  }

  await closeDb();
}

main().catch(async (err) => {
  console.error("sync-sources failed:", err);
  await closeDb();
  process.exit(1);
});
