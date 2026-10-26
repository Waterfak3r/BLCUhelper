// Standalone integration test for WeChat MP RSS parsing and intake.
// Verifies that WeChat MP RSS 2.0 payloads (with content:encoded and images)
// are parsed accurately using a local HTTP fixture, without external services or a database.
import "./standalone.ts";
import assert from "node:assert/strict";
import http from "node:http";
import { after, test } from "node:test";
import { config } from "@aihot/backend/config";
import { fetchRss } from "@aihot/backend/sources/rss";
import type { SourceRow } from "@aihot/backend/sources/types";

const addedPrivateHost = !config.privateFeedHosts.includes("127.0.0.1");
if (addedPrivateHost) {
  config.privateFeedHosts.push("127.0.0.1");
}

let serverPort = 0;
const sampleAccount = "%E5%8C%97%E8%AF%AD%E6%95%99%E5%8A%A1"; // 北语教务

const sampleRssXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>北语教务</title>
    <link>https://mp.weixin.qq.com</link>
    <description>北京语言大学教务处官方微信公众号</description>
    <item>
      <title>关于2026年秋季学期期末考试安排及成绩录入的通知</title>
      <link>https://mp.weixin.qq.com/s/sample_article_exam_2026</link>
      <pubDate>Mon, 26 Oct 2026 08:30:00 GMT</pubDate>
      <guid isPermaLink="false">exam_notice_2026_10_26</guid>
      <description>请各教学单位按照通知要求做好期末考试各项组织工作。</description>
      <content:encoded><![CDATA[
        <div class="rich_media_content">
          <p>各学院、各教学单位、各位任课教师及全体本科生、研究生同学：</p>
          <p>为确保2026年秋季学期教学秩序良好运行，做好学期末各项考试与成绩考核工作，现将期末考试及成绩录入工作安排具体通知如下：</p>
          <p>一、考试周时间及考场纪律：本学期集中考试周时间为2026年12月28日至2027年1月8日。各考场必须严格遵守考场纪律，佩戴有效证件参加考试，严禁携带违规电子设备。</p>
          <p>二、成绩评定与录入截止时间：各课程任课教师应在课程考试结束后尽快完成试卷批改，并在综合教务系统中完成成绩录入与提交，系统关闭截止时间为2027年1月15日24:00。</p>
          <p>三、缓考与补考申请流程：因病或因突发不可抗力无法参加正常考试的同学，须于考试前三天通过教务在线系统提交缓考申请及三级甲等医院诊断证明，逾期未办理者按缺考处理。</p>
          <p><img src="https://mmbiz.qpic.cn/mmbiz_png/sample/640?wx_fmt=png" alt="考试日程表" /></p>
          <p>北京语言大学教务处<br />2026年10月26日</p>
        </div>
      ]]></content:encoded>
    </item>
    <item>
      <title>【海报】梧桐讲坛第42期：青年文化与学术前沿</title>
      <link>https://mp.weixin.qq.com/s/sample_poster_short</link>
      <pubDate>Sun, 25 Oct 2026 10:00:00 GMT</pubDate>
      <guid isPermaLink="false">poster_2026_10_25</guid>
      <description>梧桐讲坛第42期即将开讲，欢迎广大师生参与。</description>
      <content:encoded><![CDATA[
        <div class="rich_media_content">
          <p>扫码查看详情海报：</p>
          <p><img src="https://mmbiz.qpic.cn/mmbiz_png/poster/640?wx_fmt=png" /></p>
        </div>
      ]]></content:encoded>
    </item>
  </channel>
</rss>`;

const server = http.createServer((req, res) => {
  if (req.url?.startsWith(`/api/articles/rss/${sampleAccount}`)) {
    if (req.headers["if-none-match"] === '"wechat-test-etag"') {
      res.writeHead(304);
      return res.end();
    }
    res.writeHead(200, {
      "content-type": "application/rss+xml; charset=utf-8",
      etag: '"wechat-test-etag"',
      "last-modified": "Mon, 26 Oct 2026 08:30:00 GMT",
    });
    return res.end(sampleRssXml);
  }
  res.writeHead(404);
  res.end();
});

await new Promise<void>((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      serverPort = addr.port;
    }
    resolve();
  });
});

after(() => {
  if (addedPrivateHost) {
    const idx = config.privateFeedHosts.indexOf("127.0.0.1");
    if (idx !== -1) config.privateFeedHosts.splice(idx, 1);
  }
  server.close();
});

test("fetchRss parses WeChat MP RSS 2.0 feed with content:encoded, dates and media", async () => {
  const source: SourceRow = {
    id: "blcu-jiaowu-rss",
    name: "北京语言大学·北语教务（微信）",
    kind: "rss",
    config: {
      feedUrl: `http://127.0.0.1:${serverPort}/api/articles/rss/${sampleAccount}?limit=20`,
    },
    cursor: null,
    tier: "T1",
    participation_mode: "editorial",
    enabled: true,
  } as unknown as SourceRow;

  const result = await fetchRss(source);
  assert.equal(result.notModified, false);
  assert.equal(result.candidates.length, 2);

  const fullArticle = result.candidates[0]!;
  assert.equal(fullArticle.title, "关于2026年秋季学期期末考试安排及成绩录入的通知");
  assert.equal(fullArticle.url, "https://mp.weixin.qq.com/s/sample_article_exam_2026");
  assert.ok(fullArticle.publishedAt instanceof Date);
  assert.equal(fullArticle.publishedAt.toISOString(), "2026-10-26T08:30:00.000Z");
  assert.equal(fullArticle.bodyStatus, "ok");

  // Check body extraction from content:encoded
  assert.ok(fullArticle.bodyHtml);
  assert.match(fullArticle.bodyHtml, /各教学单位/);
  assert.match(fullArticle.bodyHtml, /考试周时间/);
  assert.ok(fullArticle.bodyText);
  assert.match(fullArticle.bodyText, /期末考试及成绩录入/);

  // Check media extraction
  assert.ok(Array.isArray(fullArticle.media));
  assert.equal(fullArticle.media.length, 1);
  assert.equal(fullArticle.media[0]!.url, "https://mmbiz.qpic.cn/mmbiz_png/sample/640?wx_fmt=png");

  // Check second candidate: poster notification (<280 chars) stays as "pending" for extraction
  const posterArticle = result.candidates[1]!;
  assert.equal(posterArticle.title, "【海报】梧桐讲坛第42期：青年文化与学术前沿");
  assert.equal(posterArticle.bodyStatus, "pending");
  assert.equal(posterArticle.bodyHtml, null);
  assert.ok(posterArticle.excerpt);
  assert.match(posterArticle.excerpt, /梧桐讲坛第42期/);
  // Check conditional 304 response
  source.cursor = { rss: result.validator };
  const cachedResult = await fetchRss(source);
  assert.equal(cachedResult.notModified, true);
  assert.equal(cachedResult.candidates.length, 0);
  assert.equal(cachedResult.validator.etag, '"wechat-test-etag"');
});
