// Known public article URLs only; stdout is reviewable ingest material, never publication.
// node scripts/read-wechat.ts --url 'https://mp.weixin.qq.com/s/...' --source-id '...'
import { parseArgs } from "node:util";
import { htmlAttachments, type Attachment } from "@aihot/backend/content/attachments";
import { sanitizeBody } from "@aihot/backend/content/sanitize";
import { guardedFetch, requireOk } from "@aihot/backend/lib/http-fetch";
import { contentDocument } from "@aihot/backend/lib/page-content";
import { stripTags } from "@aihot/backend/lib/text";
import { normalizeUrl } from "@aihot/backend/lib/url";
import { readPublicationDate } from "@aihot/backend/sources/dates";

export interface ReadgzhArticle {
  title: string;
  url: string;
  author: string | null;
  publishedAt: string;
  bodyText: string;
  raw: { attachments: Attachment[] };
}

export interface ReadgzhResult extends ReadgzhArticle {
  review: string[];
}

function articleUrl(value: string): string {
  const original = value.trim();
  const normalized = normalizeUrl(original);
  if (!normalized) throw new Error("需要有效的微信公众号原文 URL");
  const url = new URL(original);
  const identity = new URL(normalized);
  const shortPath = /^\/s\/[A-Za-z0-9_-]+$/.test(url.pathname);
  const queryPath = url.pathname === "/s" && ["__biz", "mid", "idx", "sn"].every(key => identity.searchParams.get(key)?.trim());
  if (url.protocol !== "https:" || url.hostname !== "mp.weixin.qq.com" || url.port || url.username || url.password || !(shortPath || queryPath)) {
    throw new Error("仅支持无用户凭据的 https://mp.weixin.qq.com/s/... 或含 __biz、mid、idx、sn 的 /s 原文 URL");
  }
  return original;
}

// These are page/interstitial labels, not keyword matches against an article's prose.
const UNAVAILABLE_LABEL = /^(?:(?:微信公众平台\s*[-—|]\s*)?(?:登录|扫码登录|验证码|安全验证|环境异常|访问过于频繁|该内容已被发布者删除|内容已删除|网页无法访问)|(?:ReadGZH\s*[-—:：|]\s*)?(?:error|service unavailable|login|sign in|captcha|verification required))(?:\s*[!！。.：:]?\s*)$/i;

export function parseReadgzhArticle(html: string, originalUrl: string): ReadgzhResult {
  const url = articleUrl(originalUrl);
  const document = contentDocument(html);
  const article = document.querySelector("article");
  const heading = article?.querySelector("h1");
  const title = heading ? stripTags(heading.innerHTML) : "";
  if (UNAVAILABLE_LABEL.test(document.querySelector("title")?.textContent?.trim() ?? "") || UNAVAILABLE_LABEL.test(title)) {
    throw new Error("读取到登录、验证码或服务错误页面，不能作为正文");
  }
  if (!title) throw new Error("ReadGZH 响应缺少有效的 article h1 标题");

  let author: string | null = null;
  let dateText = "";
  for (const p of article!.querySelectorAll(".meta p")) {
    const text = stripTags(p.innerHTML);
    if (/^作者\s*[:：]/.test(text)) author = text.replace(/^作者\s*[:：]\s*/, "").trim() || null;
    if (/^发布时间\s*[:：]/.test(text)) dateText = text.replace(/^发布时间\s*[:：]\s*/, "").trim();
  }
  const { publicationTime } = readPublicationDate(dateText, "+08:00");
  if (!publicationTime) throw new Error("ReadGZH 响应缺少有效的发布日期（按上海时区解析）");

  const content = article!.querySelector(".content");
  if (!content) throw new Error("ReadGZH 响应缺少 article .content 正文");
  for (const node of content.querySelectorAll("footer, .footer")) node.remove();
  const hasImages = !!content.querySelector("img, picture");
  const bodyHtml = sanitizeBody(content.innerHTML, url);
  const bodyText = stripTags(bodyHtml);
  if (/^(?:请(?:先)?(?:完成|进行|输入).{0,12}(?:验证码|安全验证)|请(?:先)?(?:登录|扫码)|访问过于频繁|系统繁忙[，,。]|服务暂不可用)/.test(bodyText) || UNAVAILABLE_LABEL.test(bodyText)) {
    throw new Error("读取到登录、验证码或服务错误页面，不能作为正文");
  }
  if (bodyText.length < 200) throw new Error("正文文字不足 200 字或为纯图片，不能生成入站正文");

  const attachments = htmlAttachments(content.innerHTML, url, true);
  const review = ["这是第三方读取的待核验入站材料，不保证完整原文；请人工核验原文、来源身份与发布日期后再使用既有入站接口。"];
  if (!author) review.push("响应未提供作者，来源身份尚未核验。");
  if (hasImages) review.push("正文含图片（可能包括二维码或图片内材料），未下载、识别或核验图片内容。");
  if (attachments.length || /(?:阅读原文|点击原文|原文链接|详见附件|见附件|附件下载|获取附件)/.test(bodyText)) {
    review.push("正文依赖原文链接或附件；附件与原文跳转目标尚未核验，未下载，也未推测缺失的材料 URL。");
  }
  return { title, url, author, publishedAt: publicationTime, bodyText, raw: { attachments }, review };
}

export async function readWechatArticle(url: string): Promise<ReadgzhResult> {
  const originalUrl = articleUrl(url);
  const endpoint = new URL("https://api.readgzh.site/rd");
  // Forward article identity only, never WeChat session or sharing parameters.
  endpoint.searchParams.set("url", normalizeUrl(originalUrl)!);
  endpoint.searchParams.set("format", "html");
  // No authentication, retries, summary calls, image requests or attachment requests.
  const response = requireOk(await guardedFetch(endpoint.href, {
    timeoutMs: 30_000,
    maxBytes: 6 * 1024 * 1024,
  }), "ReadGZH article");
  if (Number(response.headers.get("x-total-parts")) > 1) {
    throw new Error("ReadGZH 响应被分页（X-Total-Parts > 1），拒绝输出部分正文；请人工核验原文");
  }
  // Observed HTML is served as text/plain; validate its structure, not its Content-Type.
  return parseReadgzhArticle(response.text(), originalUrl);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string" },
      "source-id": { type: "string" },
      "source-name": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: false,
  });
  if (values.help) {
    console.log("Usage: node scripts/read-wechat.ts --url <WeChat article URL> --source-id <existing source ID> [--source-name <name>]\n匿名读取已知公开 URL；输出待核验 JSON，不订阅账号、不入库、不发布、不调用模型。网络请求受既有出站策略约束，可由运维配置 EGRESS_PROXY_URL。");
    return;
  }
  const sourceId = values["source-id"]?.trim();
  if (!values.url || !sourceId) throw new Error("--url 和 --source-id 必填；使用 --help 查看用法");
  const { review, ...item } = await readWechatArticle(values.url);
  const sourceName = values["source-name"]?.trim();
  console.log(JSON.stringify({ sourceId, ...(sourceName ? { sourceName } : {}), items: [item], review }, null, 2));
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
