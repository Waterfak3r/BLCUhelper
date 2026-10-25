// Material references only: never fetch these URLs, execute scripts, or infer missing destinations.
import net from "node:net";
import { parseHTML } from "linkedom";
import { isBlockedAddress } from "../lib/url.ts";
import { collapseWhitespace, stripTags } from "../lib/text.ts";

export type Attachment = { name: string; url: string };
type Doc = ReturnType<typeof parseHTML>["document"];
type El = NonNullable<ReturnType<Doc["querySelector"]>>;
type PageNode = El["childNodes"][number];
const FILE = /\.(?:pdf|docx?|xlsx?|pptx?|zip|rar|7z|csv|txt|rtf|odt|ods|odp)(?:$|[?#])/i;
const ZONES = '.v_news_content, #vsb_content, article, main, [role="main"], .article-content, .news-content, .content-body, .wp_articlecontent, .TRS_Editor, .attachments, .attachment, [id^="attach"], [class*="attach-list"]';
const CHROME = 'nav, header, footer, aside, .nav, .menu, [role="navigation"], script, style, [hidden], [aria-hidden="true"]';

/** Public link safety without DNS, network access or identity normalisation (signed queries stay intact). */
export function attachmentUrl(value: string, base?: string): string | null {
  if (!value.trim() || value.trim().startsWith("#")) return null;
  try {
    const url = base ? new URL(value, base) : new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if (url.hash && base && url.href.split("#")[0] === new URL(base).href.split("#")[0]) return null;
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || net.isIP(host) && isBlockedAddress(host)) return null;
    if (/(?:^|\/)(?:login|signin|sign-in|sso|oauth2?|auth)(?:\/|$)/i.test(url.pathname)) return null;
    return url.href;
  } catch { return null; }
}

/** Filter stored metadata again at the publication boundary; first occurrence wins in source order. */
export function safeAttachments(value: unknown, base?: string): Attachment[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: Attachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || typeof item.url !== "string" || typeof item.name !== "string") continue;
    const url = attachmentUrl(item.url, base);
    const name = collapseWhitespace(stripTags(item.name));
    if (!url || !name || seen.has(url)) continue;
    seen.add(url);
    out.push({ name, url });
  }
  return out;
}

function downloadable(url: string): boolean {
  const u = new URL(url);
  return FILE.test(u.pathname) || [...u.searchParams.values()].some(value => FILE.test(value))
    || /\/download\/downfile\.jsp$/i.test(u.pathname);
}

/** Read before Readability mutates the DOM. Body fragments may opt into their already scoped root. */
export function documentAttachments(document: Doc, base: string, bodyFragment = false): Attachment[] {
  const out: Attachment[] = [];
  const root = document.body ?? document;
  const lists = [...document.querySelectorAll("ul, ol")].filter(el =>
    /^(?:附件(?:列表|\s*\d+)?|attachments?)\s*[:：【\[]/i.test((el.textContent ?? "").trim())
    || /^(?:附件(?:列表)?|attachments?)\s*[:：]?$/i.test((el.previousElementSibling?.textContent ?? "").trim()));
  const visit = (node: PageNode) => {
    if (node.nodeType === 1) {
      const el = node as unknown as El;
      if (el.matches(CHROME)) return;
      if (/^(?:上一条|下一条|上一篇|下一篇|previous|next)\s*[:：]/i.test((el.textContent ?? "").trim()) && ["p", "li"].includes(el.localName)) return;
      const attachmentList = lists.some(list => list.contains(el));
      const inZone = bodyFragment || !!el.closest(ZONES) || attachmentList;
      if (el.localName === "a") {
        const href = el.getAttribute("href");
        const url = href ? attachmentUrl(href, base) : null;
        const name = collapseWhitespace(el.textContent || el.getAttribute("title") || el.querySelector("img")?.getAttribute("alt") || "");
        // Outside an identified article, only explicitly declared attachment containers count.
        if (url && inZone && name && !/^(?:下载中心|首页|返回|登录|注册)$/.test(name)
          && (downloadable(url) || attachmentList || el.hasAttribute("download") || !!el.closest('.attachments, .attachment, [id^="attach"], [class*="attach-list"]') || /附件|下载|attachment|download/i.test(name))) out.push({ name, url });
        return;
      }
    }
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      if (!parent || !(bodyFragment || parent.closest(ZONES) || lists.some(list => list.contains(parent)))) return;
      // Entity decoding can split one visible URL into adjacent text nodes. Parse the whole
      // contiguous text run once, rather than treating an entity boundary as the URL's end.
      if (node.previousSibling?.nodeType === 3) return;
      let text = node.textContent ?? "";
      let next = node.nextSibling;
      while (next?.nodeType === 3) {
        text += next.textContent ?? "";
        next = next.nextSibling;
      }
      for (const match of text.matchAll(/https?:\/\/[^\s<>"'，。；）]+/gi)) {
        const url = attachmentUrl(match[0], base);
        const labelled = /(?:附件(?:下载)?|下载(?:地址)?|attachment|download)\s*[:：]?\s*$/i.test(text.slice(0, match.index));
        if (url && (downloadable(url) || labelled)) out.push({ name: match[0], url });
      }
      return;
    }
    for (const child of node.childNodes) visit(child as PageNode);
  };
  visit(root as unknown as PageNode);
  return safeAttachments(out);
}

export function htmlAttachments(html: string, base: string, bodyFragment = false): Attachment[] {
  return documentAttachments(parseHTML(bodyFragment ? `<html><body>${html}</body></html>` : html).document, base, bodyFragment);
}
