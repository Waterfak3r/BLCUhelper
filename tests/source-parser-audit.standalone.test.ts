// Failures found in source audits: product/version labels parsed as dates, rolled-over calendar
// dates, and dated help-center sections collected as a single article or without their full body.
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { contentHash } from "@aihot/backend/content/materials";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { fetchWebList } from "@aihot/backend/sources/web-list";
import { parseLooseDate } from "@aihot/backend/sources/dates";
import { parseReadgzhArticle } from "../scripts/read-wechat.ts";

const section = (id: string, date: string, title: string, body: string) =>
  `<div class="intercom-interblocks-subheading3"><h3 id="${id}">${date}</h3></div>` +
  `<div class="intercom-interblocks-paragraph"><p><b>${title}</b></p></div>` +
  `<div class="intercom-interblocks-paragraph"><p>${body}</p></div>`;
const older = section("h_older", "September 25, 2026", "Build plugins", "Create a plugin and track its review.");
const newest = section("h_newest", "September 28, 2026", "A model launch", 'A new model is available. <a href="/docs/new">Read about it</a>.');
let prepend = false;
const server = http.createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  if (req.url === "/redirect") {
    res.writeHead(302, { location: "/help/notes" });
    res.end();
    return;
  }
  res.end(`<html><body><h1>Release notes</h1><article>` +
    `<div class="intercom-interblocks-subheading"><h2 id="h_month">September 2026</h2></div>` +
    (prepend ? section("h_future", "October 1, 2026", "Another release", "A separate update.") : "") + newest + older +
    `<div class="intercom-interblocks-subheading3"><h3 id="h_empty">September 20, 2026</h3></div>` +
    `<div><p> </p></div><div class="intercom-interblocks-subheading"><h2 id="h_old_month">August 2026</h2></div>` +
    `</article><footer>Help center footer</footer></body></html>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const previousPrivateFetch = config.allowPrivateNetworkFetch;
config.allowPrivateNetworkFetch = true;
after(async () => {
  config.allowPrivateNetworkFetch = previousPrivateFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const source = { config: { url: base + "/redirect", parseMode: "intercom_changelog", publishedAtUtcOffset: "+00:00" } } as never;

test("dates require a real complete calendar day, never a product version or an impossible day", () => {
  for (const value of ["Version 3", "Sonnet 5", "5", "September 2026", "2026-02-30", "2026/02/30 12:00", "2026年4月31日", "February 30, 2026"]) {
    assert.equal(parseLooseDate(value), null, value);
  }
  assert.equal(parseLooseDate("February 29, 2024", "+00:00")?.toISOString(), "2024-02-29T00:00:00.000Z");
});

test("Intercom daily sections have independent URLs, dates and complete bodies without month headings or empty days", async () => {
  assert.deepEqual(unsupportedConfig("web_list", (source as { config: Record<string, unknown> }).config), []);
  const items = await fetchWebList(source);
  assert.deepEqual(items.map((item) => [item.url, item.title, item.publishedAt?.toISOString(), item.bodyStatus]), [
    [base + "/help/notes#h_newest", "A model launch", "2026-09-28T00:00:00.000Z", "ok"],
    [base + "/help/notes#h_older", "Build plugins", "2026-09-25T00:00:00.000Z", "ok"],
  ]);
  assert.notEqual(items[0]!.identityKey, items[1]!.identityKey);
  assert.match(items[0]!.bodyHtml!, new RegExp(`href="${base}/docs/new"`));
  assert.doesNotMatch(items[0]!.bodyText!, /Build plugins|Help center footer/);
});

test("inserting a new help-center section does not change older identities or material hashes", async () => {
  const before = await fetchWebList(source);
  prepend = true;
  const after = await fetchWebList(source);
  for (const item of before) {
    const same = after.find((candidate) => candidate.identityKey === item.identityKey);
    assert.ok(same);
    assert.equal(contentHash(same), contentHash(item));
  }
});

const wechatUrl = "https://mp.weixin.qq.com/s/lONUf3iI1UNifJCkZmqm0w?scene=21#wechat_redirect";
const wechatBody = "参赛同学应认真阅读通知，按要求准备报名材料，在截止日期前向主办单位提交作品。".repeat(8);
const wechatPage = (body: string, date = "2026-05-30 13:24", title = "校园竞赛通知") =>
  `<html><head><title>${title}</title><meta name="description" content="这不是正文"></head><body>` +
  `<article><h1>${title}</h1><div class="meta"><p><strong>作者：</strong>北语青年</p>` +
  `<p><strong>发布时间：</strong>${date}</p></div><div class="content">${body}</div>` +
  `<div class="footer"><p>第三方服务推广</p><a href="https://readgzh.site/pricing">付费套餐</a>` +
  `<a href="https://readgzh.site/promotion.pdf">推广附件</a></div></article></body></html>`;

test("WeChat intake keeps the exact original URL and Shanghai publication time without service material", () => {
  const article = parseReadgzhArticle(wechatPage(`<p>${wechatBody}</p>`), wechatUrl);
  assert.equal(article.url, wechatUrl);
  assert.equal(article.title, "校园竞赛通知");
  assert.equal(article.author, "北语青年");
  assert.equal(article.publishedAt, "2026-05-30T05:24:00.000Z");
  assert.equal(article.bodyText, wechatBody);
  assert.deepEqual(article.raw.attachments, []);
  assert.ok(article.review.length > 0);
});

test("WeChat intake preserves date-only precision without inventing a publication time", () => {
  const dayOnly = parseReadgzhArticle(wechatPage(`<p>${wechatBody}</p>`, "2026-06-01"), wechatUrl);
  assert.equal(dayOnly.publishedAt, "2026-06-01");
  const explicitMidnight = parseReadgzhArticle(wechatPage(`<p>${wechatBody}</p>`, "2026-06-01 00:00"), wechatUrl);
  assert.equal(explicitMidnight.publishedAt, "2026-05-31T16:00:00.000Z");
});

test("WeChat intake preserves signed attachment queries and flags unverified image and attachment dependencies", () => {
  const attachment = "https://example.org/material.pdf?download=1&token=a%2Fb&scene=23";
  const body = `<p>${wechatBody}阅读原文获取附件。</p>` +
    `<a href="${attachment.replaceAll("&", "&amp;")}">报名附件</a>` +
    `<img src="https://example.org/qr.png" alt="图片里的文字不能成为正文">`;
  const article = parseReadgzhArticle(wechatPage(body), wechatUrl);
  assert.deepEqual(article.raw.attachments, [{ name: "报名附件", url: attachment }]);
  assert.doesNotMatch(article.bodyText, /图片里的文字不能成为正文/);
  assert.ok(article.review.some(note => /图片/.test(note)));
  assert.ok(article.review.some(note => /附件/.test(note)));
  const queryUrl = "https://mp.weixin.qq.com/s?__biz=MzA%3D%3D&mid=123&idx=1&sn=abc&scene=23";
  assert.equal(parseReadgzhArticle(wechatPage(`<p>${wechatBody}</p>`), queryUrl).url, queryUrl);
});

test("WeChat intake refuses missing dates, unavailable pages and image-only or short bodies", () => {
  for (const html of [
    wechatPage(`<p>${wechatBody}</p>`, ""),
    wechatPage(`<p>${wechatBody}</p>`, "2026-02-30 13:24"),
    wechatPage(`<p>${wechatBody}</p>`, "2026-05-30 13:24", ""),
    wechatPage(`<p>${wechatBody}</p>`, "2026-05-30 13:24", "验证码"),
    wechatPage(`<p>请先完成安全验证。${wechatBody}</p>`),
    wechatPage(`<img src="https://example.org/poster.png" alt="${wechatBody}">`),
    wechatPage("<p>请查看海报</p>"),
    `<html><head><title>登录</title><meta name="description" content="${wechatBody}"></head><body>扫码登录</body></html>`,
  ]) {
    assert.throws(() => parseReadgzhArticle(html, wechatUrl));
  }
});

test("WeChat intake rejects non-article, non-HTTPS and credential-bearing targets", () => {
  for (const url of [
    "http://mp.weixin.qq.com/s/example",
    "https://user:password@mp.weixin.qq.com/s/example",
    "https://mp.weixin.qq.com.evil.example/s/example",
    "https://mp.weixin.qq.com/",
    "https://mp.weixin.qq.com/s?__biz=abc&mid=123&idx=1",
    "https://api.readgzh.site/rd?url=example",
  ]) {
    assert.throws(() => parseReadgzhArticle(wechatPage(`<p>${wechatBody}</p>`), url));
  }
});
