import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reconcileWeChatSources,
  extractAccountName,
  type ExpectedSource,
  type CollectorSubscription,
  type DbSourceInfo,
} from "../scripts/reconcile-wechat-sources.ts";

test("extractAccountName extracts decoded account name from feedUrl", () => {
  const url1 = "http://wechat-mp-tools:5200/api/articles/rss/%E5%8C%97%E8%AF%AD%E9%9D%92%E5%B9%B4?limit=20";
  assert.equal(extractAccountName(url1, "fallback"), "北语青年");

  const url2 = "http://127.0.0.1:5200/api/articles/rss/BLCU%E8%89%BA%E6%9C%AF%E5%AD%A6%E9%99%A2?full=1";
  assert.equal(extractAccountName(url2, "fallback"), "BLCU艺术学院");

  const url3 = "http://example.com/feed.xml";
  assert.equal(extractAccountName(url3, "fallback"), "fallback");
});

test("reconcileWeChatSources: missing subscription is classified as STATUS_MISSING_SUB and NOT covered", () => {
  const expected: ExpectedSource[] = [
    { id: "blcu-test-1", name: "北语教务", account: "北语教务", feedUrl: "http://wechat-mp-tools:5200/api/articles/rss/%E5%8C%97%E8%AF%AD%E6%95%99%E5%8A%A1", tier: "T1", enabled: true },
  ];
  const subscriptions: CollectorSubscription[] = [];

  const report = reconcileWeChatSources(expected, subscriptions);
  assert.equal(report.totalExpected, 1);
  assert.equal(report.missingSubCount, 1);
  assert.equal(report.coveredCount, 0);

  const item = report.items[0]!;
  assert.equal(item.status, "STATUS_MISSING_SUB");
  assert.equal(item.isCovered, false);
  assert.equal(item.subscribedInCollector, false);
});

test("reconcileWeChatSources: subscribed but empty articles is classified as STATUS_EMPTY_FEED and NOT covered", () => {
  const expected: ExpectedSource[] = [
    { id: "blcu-test-empty", name: "北语青年", account: "北语青年", feedUrl: "http://wechat-mp-tools:5200/api/articles/rss/%E5%8C%97%E8%AF%AD%E9%9D%92%E5%B9%B4", tier: "T1_5", enabled: true },
  ];
  const subscriptions: CollectorSubscription[] = [
    { fakeid: "fake-1", nickname: "北语青年", enabled: true, last_fetch_time: 1729000000, total_articles: 0 },
  ];

  const report = reconcileWeChatSources(expected, subscriptions);
  assert.equal(report.coveredCount, 0);
  assert.equal(report.emptyOrQuietCount, 1);

  const item = report.items[0]!;
  assert.equal(item.status, "STATUS_EMPTY_FEED");
  assert.equal(item.isCovered, false);
  assert.equal(item.subscribedInCollector, true);
});

test("reconcileWeChatSources: collector error is classified as STATUS_FAILING and NOT covered", () => {
  const expected: ExpectedSource[] = [
    { id: "blcu-test-err", name: "平安北语", account: "平安北语", feedUrl: "http://wechat-mp-tools:5200/api/articles/rss/%E5%B9%B3%E5%AE%89%E5%8C%97%E8%AF%AD", tier: "T1", enabled: true },
  ];
  const subscriptions: CollectorSubscription[] = [
    { fakeid: "fake-err", nickname: "平安北语", enabled: true, last_fetch_time: 1729000000, error_kind: "auth_expired" },
  ];

  const report = reconcileWeChatSources(expected, subscriptions);
  assert.equal(report.failingCount, 1);
  assert.equal(report.coveredCount, 0);

  const item = report.items[0]!;
  assert.equal(item.status, "STATUS_FAILING");
  assert.equal(item.isCovered, false);
  assert.equal(item.collectorError, "auth_expired");
});

test("reconcileWeChatSources: active subscription with recent articles is classified as STATUS_HEALTHY", () => {
  const expected: ExpectedSource[] = [
    { id: "blcu-test-ok", name: "北语青年", account: "北语青年", feedUrl: "http://wechat-mp-tools:5200/api/articles/rss/%E5%8C%97%E8%AF%AD%E9%9D%92%E5%B9%B4", tier: "T1_5", enabled: true },
  ];
  const subscriptions: CollectorSubscription[] = [
    { fakeid: "fake-ok", nickname: "北语青年", enabled: true, last_fetch_time: 1729000000, total_articles: 15 },
  ];
  const dbInfo = new Map<string, DbSourceInfo>([
    ["blcu-test-ok", {
      id: "blcu-test-ok",
      enabled: true,
      health: "healthy",
      last_ok_at: new Date(),
      last_error: null,
      articlesCount: 15,
      recentArticlesCount: 3,
      lastArticleAt: new Date(),
    }],
  ]);

  const report = reconcileWeChatSources(expected, subscriptions, dbInfo);
  assert.equal(report.coveredCount, 1);
  assert.equal(report.missingSubCount, 0);
  assert.equal(report.failingCount, 0);

  const item = report.items[0]!;
  assert.equal(item.status, "STATUS_HEALTHY");
  assert.equal(item.isCovered, true);
  assert.equal(item.dbRecentArticlesCount, 3);
});

test("reconcileWeChatSources: active subscription with old articles but 0 recent is classified as STATUS_QUIET", () => {
  const expected: ExpectedSource[] = [
    { id: "blcu-test-quiet", name: "北语社团理事会", account: "北语社团理事会", feedUrl: "http://wechat-mp-tools:5200/api/articles/rss/%E5%8C%97%E8%AF%AD%E7%A4%BE%E5%9B%A2%E7%90%86%E4%BA%8B%E4%BC%9A", tier: "T1_5", enabled: true },
  ];
  const subscriptions: CollectorSubscription[] = [
    { fakeid: "fake-quiet", nickname: "北语社团理事会", enabled: true, last_fetch_time: 1729000000, total_articles: 8 },
  ];
  const dbInfo = new Map<string, DbSourceInfo>([
    ["blcu-test-quiet", {
      id: "blcu-test-quiet",
      enabled: true,
      health: "healthy",
      last_ok_at: new Date(),
      last_error: null,
      articlesCount: 8,
      recentArticlesCount: 0,
      lastArticleAt: new Date(Date.now() - 30 * 86400_000),
    }],
  ]);

  const report = reconcileWeChatSources(expected, subscriptions, dbInfo);
  assert.equal(report.coveredCount, 0);
  assert.equal(report.emptyOrQuietCount, 1);

  const item = report.items[0]!;
  assert.equal(item.status, "STATUS_QUIET");
  assert.equal(item.isCovered, false);
});
