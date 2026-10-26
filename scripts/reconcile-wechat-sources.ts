// Reconciles expected WeChat MP sources from industry/sources.json against
// wechat-mp-tools subscriptions and database state.
//
// Usage:
//   node scripts/reconcile-wechat-sources.ts [--json] [--strict] [--url http://127.0.0.1:5200/healthz]
import { closeDb, sql } from "@aihot/backend/db";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";

export type ReconcileStatus =
  | "STATUS_HEALTHY"        // Subscribed, fetch ok, articles present
  | "STATUS_EMPTY_FEED"     // Subscribed, fetch ok, but 0 articles ever collected
  | "STATUS_QUIET"          // Subscribed, fetch ok, but no new articles in window
  | "STATUS_FAILING"        // Subscribed, but last fetch resulted in error
  | "STATUS_NEVER_FETCHED"  // Subscribed, but last_fetch_time is 0
  | "STATUS_DISABLED"       // Disabled in source config or collector
  | "STATUS_MISSING_SUB"    // Expected in sources.json, but missing in collector subscriptions
  | "STATUS_MISSING_DB";    // Expected in sources.json, but not seeded in database

export interface ExpectedSource {
  id: string;
  name: string;
  account: string;
  feedUrl: string;
  tier: string;
  enabled: boolean;
}

export interface CollectorSubscription {
  id?: string;
  fakeid?: string;
  nickname?: string;
  name?: string;
  enabled?: boolean;
  last_fetch_time?: number;
  total_articles?: number;
  last_error?: string | null;
  error_kind?: string | null;
}

export interface DbSourceInfo {
  id: string;
  enabled: boolean;
  health: string;
  last_ok_at: string | Date | null;
  last_error: string | null;
  articlesCount: number;
  recentArticlesCount: number;
  lastArticleAt: string | Date | null;
}

export interface ReconciliationItem {
  id: string;
  name: string;
  account: string;
  tier: string;
  status: ReconcileStatus;
  statusLabel: string;
  isCovered: boolean;
  subscribedInCollector: boolean;
  collectorFakeId: string | null;
  collectorLastFetch: Date | null;
  collectorError: string | null;
  inDatabase: boolean;
  dbArticlesCount: number;
  dbRecentArticlesCount: number;
  riskNote: string;
}

export interface ReconciliationReport {
  timestamp: string;
  totalExpected: number;
  totalSubscribedInCollector: number;
  coveredCount: number;
  missingSubCount: number;
  failingCount: number;
  emptyOrQuietCount: number;
  items: ReconciliationItem[];
}

export function extractAccountName(feedUrl: string, fallbackName: string): string {
  try {
    const raw = decodeURIComponent(feedUrl);
    const match = raw.match(/\/api\/articles\/rss\/([^?]+)/);
    return match ? match[1]! : fallbackName;
  } catch {
    return fallbackName;
  }
}

interface RawSeedSource {
  id: string;
  name: string;
  kind: string;
  config?: {
    feedUrl?: string;
    [key: string]: unknown;
  };
  tier?: string;
  enabled?: boolean;
}

export function loadExpectedSources(root: string = REPO_ROOT): ExpectedSource[] {
  const filePath = path.join(root, "industry/sources.json");
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, "utf8");
  const { sources } = JSON.parse(raw) as { sources: RawSeedSource[] };
  return sources
    .filter((s) => s.kind === "rss" && Boolean(s.config?.feedUrl?.includes("/api/articles/rss/")))
    .map((s) => ({
      id: s.id,
      name: s.name,
      account: extractAccountName(s.config?.feedUrl ?? "", s.name),
      feedUrl: s.config?.feedUrl ?? "",
      tier: s.tier ?? "T2",
      enabled: s.enabled ?? true,
    }));
}

export function reconcileWeChatSources(
  expected: ExpectedSource[],
  subscriptions: CollectorSubscription[],
  dbSources?: Map<string, DbSourceInfo>
): ReconciliationReport {
  const subMap = new Map<string, CollectorSubscription>();
  for (const sub of subscriptions) {
    const name = sub.nickname || sub.name;
    if (name) subMap.set(name, sub);
  }

  const items: ReconciliationItem[] = [];
  let coveredCount = 0;
  let missingSubCount = 0;
  let failingCount = 0;
  let emptyOrQuietCount = 0;

  for (const exp of expected) {
    const sub = subMap.get(exp.account);
    const db = dbSources?.get(exp.id);

    let status: ReconcileStatus = "STATUS_HEALTHY";
    let statusLabel = "正常覆盖";
    let isCovered = false;
    let riskNote = "";

    const collectorFetchSec = sub?.last_fetch_time ?? 0;
    const collectorFetchDate = collectorFetchSec > 0 ? new Date(collectorFetchSec * 1000) : null;
    const collectorError = sub?.error_kind || sub?.last_error || null;
    const inDb = dbSources ? Boolean(db) : true;
    const totalArticles = db ? db.articlesCount : (sub?.total_articles ?? 0);
    const recentArticles = db ? db.recentArticlesCount : (totalArticles > 0 ? 1 : 0);

    if (exp.enabled === false || (sub && sub.enabled === false)) {
      status = "STATUS_DISABLED";
      statusLabel = "已停用";
      riskNote = "配置或采集器中处于停用状态";
    } else if (!sub) {
      status = "STATUS_MISSING_SUB";
      statusLabel = "采集器未订阅";
      missingSubCount++;
      riskNote = "主站预期覆盖，但采集器后台尚未添加该公众号订阅";
    } else if (dbSources && !inDb) {
      status = "STATUS_MISSING_DB";
      statusLabel = "主站库未收录";
      riskNote = "采集器已有订阅，但主站 sources 表未初始化该信源";
    } else if (collectorError || (db && db.last_error)) {
      status = "STATUS_FAILING";
      statusLabel = "采集报错";
      failingCount++;
      riskNote = `抓取报错：${collectorError || db?.last_error}`;
    } else if (collectorFetchSec === 0) {
      status = "STATUS_NEVER_FETCHED";
      statusLabel = "尚未调度抓取";
      emptyOrQuietCount++;
      riskNote = "已添加订阅，但尚未执行初次拉取";
    } else if (totalArticles === 0) {
      status = "STATUS_EMPTY_FEED";
      statusLabel = "空订阅(无文章)";
      emptyOrQuietCount++;
      riskNote = "采集器已抓取但文章库为空，需核查历史或正文抓取限制";
    } else if (recentArticles === 0) {
      status = "STATUS_QUIET";
      statusLabel = "近期无新文";
      emptyOrQuietCount++;
      riskNote = "近 7 天没有新增通知，需确认是否为低频发文账号";
    } else {
      status = "STATUS_HEALTHY";
      statusLabel = "正常覆盖";
      isCovered = true;
      coveredCount++;
    }

    items.push({
      id: exp.id,
      name: exp.name,
      account: exp.account,
      tier: exp.tier,
      status,
      statusLabel,
      isCovered,
      subscribedInCollector: Boolean(sub),
      collectorFakeId: sub?.fakeid || sub?.id || null,
      collectorLastFetch: collectorFetchDate,
      collectorError,
      inDatabase: inDb,
      dbArticlesCount: totalArticles,
      dbRecentArticlesCount: recentArticles,
      riskNote,
    });
  }

  return {
    timestamp: new Date().toISOString(),
    totalExpected: expected.length,
    totalSubscribedInCollector: subscriptions.length,
    coveredCount,
    missingSubCount,
    failingCount,
    emptyOrQuietCount,
    items,
  };
}

interface CollectorHealthzPayload {
  status?: string;
  watchdog?: {
    subscriptions?: CollectorSubscription[];
  };
}

async function fetchCollectorSubscriptions(url: string): Promise<CollectorSubscription[] | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = (await res.json()) as CollectorHealthzPayload | CollectorSubscription[];
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object" && Array.isArray(data.watchdog?.subscriptions)) {
      return data.watchdog.subscriptions;
    }
    return null;
  } catch {
    return null;
  }
}

function loadLocalCollectorSubscriptions(root: string = REPO_ROOT): CollectorSubscription[] {
  const subFile = path.join(root, ".data/wechat-mp-tools/data/rss_subscriptions.json");
  if (!existsSync(subFile)) return [];
  try {
    return JSON.parse(readFileSync(subFile, "utf8")) as CollectorSubscription[];
  } catch {
    return [];
  }
}

async function queryDatabaseSources(expectedIds: string[]): Promise<Map<string, DbSourceInfo> | null> {
  if (!process.env.DATABASE_URL) return null;
  try {
    const since = new Date(Date.now() - 7 * 86400_000);

    const sources = await sql<Array<{ id: string; enabled: boolean; health: string; last_ok_at: Date | null; last_error: string | null }>>`
      SELECT id, enabled, health, last_ok_at, last_error FROM sources WHERE id = ANY(${expectedIds})`;

    const articles = await sql<Array<{ source_id: string; total: number; recent: number; last_article: Date | null }>>`
      SELECT source_id,
             count(*)::int AS total,
             count(*) FILTER (WHERE discovered_at >= ${since})::int AS recent,
             max(published_at) AS last_article
      FROM articles
      WHERE source_id = ANY(${expectedIds})
      GROUP BY source_id`;

    const artMap = new Map(articles.map((a) => [a.source_id, a]));
    const result = new Map<string, DbSourceInfo>();
    for (const s of sources) {
      const a = artMap.get(s.id);
      result.set(s.id, {
        id: s.id,
        enabled: s.enabled,
        health: s.health,
        last_ok_at: s.last_ok_at,
        last_error: s.last_error,
        articlesCount: a?.total ?? 0,
        recentArticlesCount: a?.recent ?? 0,
        lastArticleAt: a?.last_article ?? null,
      });
    }
    return result;
  } catch {
    return null;
  }
}

export function formatReportTable(report: ReconciliationReport): string {
  const lines: string[] = [];
  lines.push(`\n=== 微信公众号信源与采集器订阅对账报告 ===`);
  lines.push(`生成时间: ${report.timestamp}`);
  lines.push(`预期信源: ${report.totalExpected} 个 | 采集器实际订阅: ${report.totalSubscribedInCollector} 个`);
  lines.push(`正常覆盖: ${report.coveredCount} 个 | 缺少订阅: ${report.missingSubCount} 个 | 抓取报错: ${report.failingCount} 个 | 空源/静默: ${report.emptyOrQuietCount} 个\n`);

  lines.push(`| # | 来源 ID | 公众号名称 | 等级 | 采集器订阅 | 状态判定 | 库内篇数 | 风险说明 |`);
  lines.push(`|---|---|---|---|---|---|---|---|`);

  report.items.forEach((item, index) => {
    const subLabel = item.subscribedInCollector ? "已订阅" : "**未订阅**";
    lines.push(
      `| ${index + 1} | \`${item.id}\` | ${item.account} | ${item.tier} | ${subLabel} | ${item.statusLabel} | ${item.dbArticlesCount} | ${item.riskNote || "-"} |`
    );
  });

  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  const jsonOutput = args.includes("--json");
  const strict = args.includes("--strict");
  const urlArgIndex = args.indexOf("--url");
  const collectorUrl = urlArgIndex >= 0 && args[urlArgIndex + 1] ? args[urlArgIndex + 1]! : "http://127.0.0.1:5200/healthz";

  const expected = loadExpectedSources();
  let subs = await fetchCollectorSubscriptions(collectorUrl);
  if (!subs) {
    subs = loadLocalCollectorSubscriptions();
  }

  const dbInfo = await queryDatabaseSources(expected.map((e) => e.id));
  const report = reconcileWeChatSources(expected, subs, dbInfo ?? undefined);

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReportTable(report));
  }
  if (process.env.DATABASE_URL) {
    await closeDb();
  }

  if (strict && (report.missingSubCount > 0 || report.failingCount > 0)) {
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  main().catch((err) => {
    console.error("Reconcile error:", err);
    process.exit(1);
  });
}
