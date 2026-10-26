// Failure modes, fixed before changing public loaders or prefetch:
// - returning to a page that was already open still needs the network;
// - query variants mix content/SEO, or restores lose their anchor;
// - hovering downloads pages, a press no longer loads data or its click asks again, scroll-through touches
//   download it, or a failed prefetch breaks the current page;
// - visits renew deadlines, expired/errors stay cached, or refresh stops working;
// - Agent tabs choose an invalid panel or leave canonical/history behind;
// - search downloads two whole pages, requests before opening, or never retries/updates suggestions.
// Reader work failures fixed before changing enhancement and return-position code:
// - offscreen code downloads/runs immediately, visible code stays plain, or raw copying changes;
// - tiny/linked pictures become zoom buttons, or language changes keep old handlers;
// - a deep return loses its anchor, or folded dates confuse the anchor search.
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { chromium, webkit, expect, type Browser } from "@playwright/test";
import type { ReportCitation, ReportDetail } from "@aihot/contracts/site";
import { FIXTURE_AT as at, fakeApi, feedItem, itemDetail, startWebServer, visit, type WebServer } from "./web-server.ts";

const item = feedItem({id:'navigation-fixture',title:'性能检查文章'});
const detail = itemDetail({id:item.id,title:item.title,originalTitle:'Fixture article'});
const attachment = { name: '<img src="/attachment-name"> 申请材料.pdf', url: "https://example.org/materials/application.pdf" };
const materialsDetail = itemDetail({
  id: "materials-fixture", title: "附带材料通知", readingMode: "summary-only", body: null,
  outline: [], hasTranslation: false, markdownAvailable: false, attachments: [attachment],
});
const codeSource='import json\n\nwith open("data.json") as file:\n    data = json.load(file)\n\nfor record in data:\n    print(record["title"])\n';
const readerBody=Array.from({length:30},(_,i)=>`<p>阅读段落 ${i}：先阅读文章，再查看后面的代码和图片。正文保持可读，图片和代码在需要时增强。</p>`).join('')
  +`<pre><code>${codeSource}</code></pre><pre><code>x = 1</code></pre>`
  +Array.from({length:12},(_,i)=>`<img src="/reader-image/${i}.svg" alt="正文配图 ${i}" width="640" height="360" loading="lazy">`).join('')
  +'<img src="/reader-image/tiny.svg" alt="小图标" width="16" height="16" loading="lazy"><a href="https://example.org"><img src="/reader-image/linked.svg" alt="链接图片" width="640" height="360" loading="lazy"></a>';
const citation = (id: string, sourceName: string): ReportCitation => ({
  itemId: id, title: "报道 " + id, summary: "固定报告摘要", sourceName,
  sourceUrl: "https://example.org/reports/" + id, sourceIconUrl: null,
  firstParty: false, publishedAt: at, available: true,
});
const reportLead = { ...citation("report-lead", "头条来源"), related: [citation("report-related", "关联来源")] };
const reportHighlight = citation("report-highlight", "看点来源");
const reportBody = citation("report-body", "正文来源");
const reportFlash = citation("report-flash", "快讯来源");
const reportWithdrawn = { ...citation("report-withdrawn", "已撤回来源"), available: false };
const report = (kind:'daily'|'weekly'|'monthly'): ReportDetail => ({
  kind, key:kind==='daily'?'2026-10-04':kind==='weekly'?'2026-W40':'2026-10', issueNumber:1,
  title:'Fixture '+kind, generatedAt:at, lead:{title:'Fixture '+kind,leadParagraph:'Fixture report'},
  leadItemId:reportLead.itemId, overview:null, highlights:[reportLead, reportHighlight],
  sections:[{label:"报道",summary:null,items:[reportLead, reportHighlight, reportBody, reportWithdrawn]}],
  flashes:[reportFlash], cover:null, metrics:{}, readingMinutes:1, prev:null, next:null,
});
const hits: string[] = [];
let suggestionsVersion=1;
let failing='';
let ttl=60;
let web:WebServer;
let origin:string;
let chrome:Browser;
let safari:Browser;
const api=fakeApi((url,res,req)=>{
  const p=url.pathname;
  if(p==='/api/site/meta'||p==='/api/site/track')return;
  hits.push(req.url!);
  if(p===failing){res.statusCode=503;return {code:'unavailable'};}
  if(p==='/api/site/search/suggestions')return {topics:[{slug:'openai',name:'OpenAI',group:'company'}],hot:[{rank:1,title:'建议版本 '+suggestionsVersion,to:'/story/fixture'}]};
  if(p==='/api/site/topics')return {groups:[],topics:[{slug:'openai',name:'OpenAI',group:'company',definition:'Fixture',brand:null,total:0,recent:0,indexable:false,latest:null}]};
  if(p==='/api/site/hot')return {computedAt:at,windowHours:48,entries:[{rank:1,story:{publicId:'fixture',title:'建议版本 '+suggestionsVersion},heat:10,trend:'flat',trendPct:0,badges:[],participantCount:0,sourceCount:0,sourceNames:[],participants:[],spark:[],summary:null,latest:null,cover:null}]};
  if(p==='/api/site/timeline'){
    res.setHeader('X-Accel-Expires','@'+(Math.floor(Date.now()/1000)+ttl));
    const category=url.searchParams.get('category');
    const shown={...item,title:category?'分类 '+category:'性能检查文章'};
    if(url.searchParams.get('tag')==='long-reading'){
      const cards=Array.from({length:180},(_,i)=>({key:'long-'+i,anchorAt:i<60?at:'2026-10-03T08:00:00.000Z',item:{...item,id:'long-'+i,title:'长列表文章 '+i,summary:'用于核实深处阅读返回的固定摘要。'.repeat(3)},group:null}));
      return {filters:{channel:'all',category:null,tag:'long-reading'},cards,nextCursor:null,hot:null,dayCounts:{'2026-10-04':60,'2026-10-03':120}};
    }
    return {filters:{channel:'all',category,tag:null},cards:[{key:shown.id,anchorAt:at,item:shown,group:null}],nextCursor:null,hot:null,dayCounts:{'2026-10-04':1}};
  }
  if(p==='/api/site/pool'){
    const page=Number(url.searchParams.get('page')||1);
    return {filters:{channel:'all',category:null,tag:null,q:null,tab:'time'},items:[{...item,title:'全部第 '+page+' 页'}],page,pageCount:3,total:3,todayCount:1,freshness:at};
  }
  if(p==='/api/site/items/navigation-fixture')return detail;
  if(p==='/api/site/items/navigation-fixture/original')return {...detail,body:{zh:null,original:'<p>Original fixture</p>',zhKind:null,complete:true},bodyLanguage:'original'};
  if(p==='/api/site/items/reader-fixture')return {...detail,id:'reader-fixture',title:'阅读增强检查',body:{...detail.body,zh:readerBody}};
  if(p==='/api/site/items/reader-fixture/original')return {...detail,id:'reader-fixture',title:'阅读增强检查',body:{...detail.body,zh:null,original:'<p>Original reader text</p>'},bodyLanguage:'original'};
  if(p==='/api/site/items/materials-fixture')return materialsDetail;
  if(p.startsWith('/api/site/items/long-'))return {...detail,id:p.split('/').at(-1),title:'长列表详情'};
  const kind=p.match(/^\/api\/site\/reports\/(daily|weekly|monthly)\/latest-page$/)?.[1] as 'daily'|'weekly'|'monthly'|undefined;
  if(kind){const r=report(kind);return {report:r,index:[{key:r.key,issueNumber:1,title:r.title,count:0}]};}
});

before(async()=>{
  // Started together; whatever started is stopped in after() even when another one failed.
  const started=await Promise.allSettled([
    startWebServer(api).then(w=>{web=w;origin=w.origin;}),
    chromium.launch({channel:'chromium'}).then(b=>{chrome=b;}),
    webkit.launch().then(b=>{safari=b;}),
  ]);
  for(const result of started)if(result.status==='rejected')throw result.reason;
});
after(async()=>{
  await chrome?.close();await safari?.close();
  await web?.stop();
});

// One engine per behaviour: WebKit for what phone readers do (iPhone Safari), Chromium for desktop-only
// pointer behaviour such as hover and mouse presses. The router and caches are the same code in both.
test('SSR list and visited query variants return offline without another read',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  try{
    await visit(page,origin+'/');
    await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible();
    await page.getByRole('link',{name:'性能检查文章',exact:true}).click();
    await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    await context.setOffline(true);
    await page.goBack();
    await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible({timeout:1500});
    await context.setOffline(false);
  }finally{await context.close();}
});

for (const width of [390, 1280, 1600]) test(`source links bypass the card while titles stay internal and materials stay on the original site at width ${width}`, async () => {
  const context = await chrome.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const externalRequests: string[] = [];
  await context.route("https://example.org/**", async (route) => {
    externalRequests.push(route.request().url());
    await route.fulfill({ contentType: "text/plain", body: "Original site fixture" });
  });
  try {
    await visit(page, origin + "/");
    const card = page.locator("article", { has: page.getByRole("heading", { name: item.title, exact: true }) });
    const source = card.getByRole("link", { name: "Fixture", exact: true });
    await expect(source).toHaveAttribute("href", item.links.original);
    await expect(source).toHaveAttribute("rel", "noopener noreferrer");
    const start = hits.length;
    const opened = context.waitForEvent("page");
    await source.click();
    const original = await opened;
    await original.waitForURL(item.links.original);
    await original.close();
    await expect(page).toHaveURL(origin + "/");
    assert.equal(hits.slice(start).filter((url) => url.startsWith("/api/site/items/")).length, 0);
    await card.getByRole("link", { name: item.title, exact: true }).click();
    await expect(page).toHaveURL(origin + "/items/" + item.id);
    await expect(page.getByText("固定正文", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "原文附带材料", exact: true })).toHaveCount(0);

    await visit(page, origin + "/items/materials-fixture");
    // The first visible source is the narrow metadata or the wide-screen rail, not the footer.
    const detailSource = page.getByRole("link", { name: "Fixture", exact: true }).filter({ visible: true }).first();
    await expect(detailSource).toHaveAttribute("href", materialsDetail.links.original);
    await expect(detailSource).toHaveAttribute("target", "_blank");
    const materials = page.getByRole("region", { name: "原文附带材料", exact: true });
    const material = materials.getByRole("link", { name: attachment.name, exact: true });
    await expect(material).toBeVisible();
    await expect(material).toHaveAttribute("href", attachment.url);
    await expect(material).toHaveAttribute("target", "_blank");
    await expect(material).toHaveAttribute("rel", "noopener noreferrer");
    assert.equal(await material.getAttribute("download"), null);
    await expect(materials.locator("img")).toHaveCount(0);
    await expect(page.getByText("固定正文", { exact: true })).toHaveCount(0);
    assert.equal(externalRequests.includes(attachment.url), false, "showing materials does not fetch them");
  } finally { await context.close(); }
});

test("the phone preview exposes the feed's original link while detail data is pending", async () => {
  const context = await safari.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/items\/navigation-fixture\.data(?:\?|$)/, async (route) => {
    await pending;
    await route.continue();
  });
  try {
    await visit(page, origin + "/");
    await page.getByRole("link", { name: item.title, exact: true }).click();
    const preview = page.locator('article[aria-busy="true"]');
    await expect(preview.getByRole("link", { name: "Fixture", exact: true })).toHaveAttribute("href", item.links.original);
    await expect(page.getByRole("navigation", { name: "阅读工具" }).getByRole("link", { name: "原文", exact: true })).toHaveAttribute("href", item.links.original);
    release();
    await expect(page.getByText("固定正文", { exact: true })).toBeVisible();
  } finally { release(); await context.close(); }
});

test("daily, weekly and monthly report sources open originals without taking over headlines or withdrawn citations", async () => {
  for (const width of [390, 1280]) {
    const context = await chrome.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    await context.route("https://example.org/**", (route) => route.fulfill({ contentType: "text/plain", body: "Original report fixture" }));
    try {
      for (const kind of ["daily", "weekly", "monthly"] as const) {
        await visit(page, origin + "/" + kind);
        for (const c of [reportLead, reportHighlight, reportBody, reportLead.related[0]!, reportFlash]) {
          const sources = page.getByRole("link", { name: c.sourceName, exact: true });
          assert.ok(await sources.count() > 0, kind + " exposes " + c.sourceName);
          for (const source of await sources.all()) {
            await expect(source).toHaveAttribute("href", c.sourceUrl);
            await expect(source).toHaveAttribute("target", "_blank");
            await expect(source).toHaveAttribute("rel", "noopener noreferrer");
          }
        }
        await expect(page.getByText(reportWithdrawn.sourceName, { exact: true })).toBeVisible();
        await expect(page.getByRole("link", { name: reportWithdrawn.sourceName, exact: true })).toHaveCount(0);
        await expect(page.getByRole("link", { name: reportBody.title, exact: true })).toHaveAttribute("href", "/items/" + reportBody.itemId);
        const front = page.getByRole("region", { name: "头版", exact: true });
        const opened = context.waitForEvent("page");
        await front.getByRole("link", { name: reportHighlight.sourceName, exact: true }).click();
        const original = await opened;
        await original.waitForURL(reportHighlight.sourceUrl);
        await original.close();
        await expect(page).toHaveURL(origin + "/" + kind);
        await front.getByRole("link", { name: reportHighlight.title, exact: true }).click();
        await expect(page).toHaveURL(origin + "/" + kind + "#r-" + reportHighlight.itemId);
      }
    } finally { await context.close(); }
  }
});

test('hover downloads nothing, a press fetches article data once for its click, touches that move do not, and failed prefetch does not replace the current page',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  const press={button:0,pointerType:'mouse',isPrimary:true};
  try{
    await visit(page,origin+'/');
    const link=page.getByRole('link',{name:'性能检查文章',exact:true});
    const start=hits.length;
    // In one task, as a scroll moves within the hold that makes a still touch a press; two calls can be further apart.
    await link.evaluate(a=>{for(const type of ['touchstart','touchmove'])a.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,composed:true}));});
    await link.hover();await page.waitForTimeout(300);
    await page.getByRole('heading',{name:'精选',exact:true}).click();
    assert.equal(hits.slice(start).filter(x=>x.startsWith('/api/site/items/')).length,0);
    await link.click();await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    assert.equal(hits.slice(start).filter(x=>x.startsWith('/api/site/items/')).length,1,'the click reuses the prefetch its press started');
    const fresh=await chrome.newContext();const freshPage=await fresh.newPage();
    try{
      await visit(freshPage,origin+'/');failing='/api/site/items/navigation-fixture';
      const failed=freshPage.waitForResponse(r=>r.url().includes('/items/navigation-fixture.data')&&r.status()===503);
      await freshPage.getByRole('link',{name:'性能检查文章',exact:true}).dispatchEvent('pointerdown',press);await failed;
      await expect(freshPage.getByRole('heading',{name:'精选',exact:true})).toBeVisible();
    }finally{await fresh.close();}
  }finally{failing='';await context.close();}
});

test('SSR all-pages and report kinds return offline with their own content',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    await visit(page,origin+'/all');
    await page.locator('a[href="/all?page=2"]').first().click();
    await expect(page.getByRole('link',{name:'全部第 2 页',exact:true})).toBeVisible();
    await context.setOffline(true);await page.goBack();
    await expect(page.getByRole('link',{name:'全部第 1 页',exact:true})).toBeVisible({timeout:1500});
    await context.setOffline(false);await visit(page,origin+'/daily');
    await page.getByRole('link',{name:'周报',exact:true}).click();
    await expect(page.locator('#report-start')).toContainText('周报');
    await context.setOffline(true);await page.getByRole('link',{name:'日报',exact:true}).click();
    await expect(page.locator('#report-start')).toContainText('日报',{timeout:1500});
  }finally{await context.close();}
});

test('a revisit never renews the original deadline; an expired read shows an error and a reload asks again',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    await page.clock.install();ttl=1;
    await visit(page,origin+'/');
    await page.getByRole('link',{name:'性能检查文章',exact:true}).click();await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    failing='/api/site/timeline';
    await page.clock.runFor(1500);
    await page.goBack();await expect(page.getByRole('heading',{name:'暂时无法加载',exact:true})).toBeVisible();
    failing='';ttl=60;
    await page.reload();await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible();
  }finally{ttl=60;failing='';await context.close();}
});

test('SSR freshness spent in an upstream cache is not renewed by HTML hydration',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    ttl=0;await visit(page,origin+'/');
    await page.getByRole('link',{name:'性能检查文章',exact:true}).click();await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    const start=hits.length;ttl=60;
    await page.goBack();await expect(page.getByRole('link',{name:'性能检查文章',exact:true})).toBeVisible();
    assert.equal(hits.slice(start).filter(x=>x.startsWith('/api/site/timeline')).length,1);
  }finally{ttl=60;await context.close();}
});

test('Agent tabs finish offline with matching canonical; invalid direct tabs and anchored links keep a panel',async()=>{
  const context=await chrome.newContext();const page=await context.newPage();
  try{
    await visit(page,origin+'/agent');
    await context.setOffline(true);
    await page.getByRole('tablist',{name:'接入方式'}).getByRole('tab',{selected:true}).click();
    await expect(page.locator('#agent-panel')).not.toBeEmpty();
    for(const [tab,name] of [['mcp',/^MCP/],['rss',/^RSS/],['api',/^REST API/]] as const){
      const choice=page.getByRole('tab',{name});
      // The active track was exercised above; compare navigation through every remaining track.
      if(await choice.getAttribute('aria-selected')==='true')continue;
      const target=await choice.getAttribute('href');
      await choice.click();
      await expect(page).toHaveURL(origin+target,{timeout:1500});
      await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href',origin+target);
      await expect(page.locator('#agent-panel')).toHaveAttribute('aria-labelledby','agent-tab-'+tab);
      await expect(page.locator('#agent-panel')).not.toBeEmpty();
    }
    await context.setOffline(false);
    await visit(page,origin+'/agent?tab=unknown');
    await expect(page.getByRole('tab').first()).toHaveAttribute('aria-selected','true');
    await expect(page.locator('#agent-panel')).not.toBeEmpty();
    await visit(page,origin+'/agent#agent-api-recovery');
    await expect(page.locator('#agent-api-recovery')).toBeVisible();
  }finally{await context.close();}
});

test('phone suggestions load only on opening, use one small read, retry failures and update on reopening',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
  try{
    suggestionsVersion=1;await visit(page,origin+'/');
    assert.equal(hits.filter(x=>x==='/api/site/search/suggestions').length,0);
    let start=hits.length;
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.getByRole('link',{name:'1 建议版本 1',exact:true})).toBeVisible();
    assert.deepEqual(hits.slice(start),['/api/site/search/suggestions']);
    await page.getByRole('button',{name:'取消',exact:true}).click();
    suggestionsVersion=2;start=hits.length;
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.getByRole('link',{name:'1 建议版本 2',exact:true})).toBeVisible();
    assert.deepEqual(hits.slice(start),['/api/site/search/suggestions']);
    await page.getByRole('button',{name:'取消',exact:true}).click();
    failing='/api/site/search/suggestions';await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.getByRole('link',{name:'1 建议版本 2',exact:true})).not.toBeVisible();
    await page.getByRole('button',{name:'取消',exact:true}).click();failing='';suggestionsVersion=3;
    await page.getByRole('button',{name:'搜索',exact:true}).click();
    await expect(page.getByRole('link',{name:'1 建议版本 3',exact:true})).toBeVisible();
  }finally{failing='';await context.close();}
});

test('reader enhancements wait for visible code and update only the picture that loaded',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  const scripts:string[]=[];page.on('request',r=>{if(r.url().includes('/assets/')&&r.url().includes('highlight-'))scripts.push(r.url());});
  await page.route('**/reader-image/*.svg',route=>route.fulfill({contentType:'image/svg+xml',body:`<svg xmlns="http://www.w3.org/2000/svg" width="${route.request().url().endsWith('/tiny.svg')?16:640}" height="360"><rect width="640" height="360" fill="red"/></svg>`}));
  try{
    await visit(page,origin+'/items/reader-fixture');
    await expect(page.getByRole('heading',{name:'阅读增强检查',exact:true})).toBeVisible();
    await expect(page.locator('.code-block-copy')).toHaveCount(2);
    assert.deepEqual(scripts,[],'reading the introduction must not download the offscreen highlighter');
    const source=page.locator('.prose pre code').first();
    assert.equal(await source.textContent(),codeSource);
    await source.scrollIntoViewIfNeeded();
    await expect(source).toHaveClass(/hljs/);
    assert.equal(await source.textContent(),codeSource,'colouring preserves the copyable text');
    assert.equal(scripts.length,1);
    await page.locator('.code-block-copy').first().click();
    await expect(page.locator('.code-block-copy').first()).toHaveText('已复制');
    assert.equal(await page.locator('.prose pre code').nth(1).textContent(),'x = 1');
    for(let i=0;i<12;i++){
      const picture=page.locator(`.prose img[alt="正文配图 ${i}"]`);
      await picture.scrollIntoViewIfNeeded();
      await expect(picture).toHaveAttribute('role','button');
    }
    const tiny=page.locator('.prose img[alt="小图标"]');await tiny.scrollIntoViewIfNeeded();
    await expect(tiny).not.toHaveAttribute('role','button');
    await expect(page.locator('.prose a img')).not.toHaveAttribute('role','button');
    await page.getByRole('navigation',{name:'正文语言'}).getByRole('link',{name:'原文',exact:true}).click();
    await expect(page.getByText('Original reader text',{exact:true})).toBeVisible();
    assert.equal(await page.locator('.code-block-copy').count(),0);
  }finally{await context.close();}
});

test('deep reading returns to its anchor, including folded dates',async()=>{
  const context=await safari.newContext({viewport:{width:390,height:844}});
  const page=await context.newPage();
  try{
    await visit(page,origin+'/?tag=long-reading');
    await expect(page.locator('[data-card-key]')).toHaveCount(180);
    await page.getByRole('button',{name:'收起10月4日',exact:true}).click();
    await expect(page.locator('[data-card-key]')).toHaveCount(120);
    await page.getByRole('link',{name:'长列表文章 160',exact:true}).scrollIntoViewIfNeeded();
    const before=await page.evaluate(()=>{
      const first=[...document.querySelectorAll<HTMLElement>('[data-card-key]')].find(e=>e.getBoundingClientRect().bottom>72)!;
      return {key:first.dataset.cardKey!,top:first.getBoundingClientRect().top};
    });
    await page.getByRole('link',{name:'长列表文章 160',exact:true}).click();
    await expect(page.getByText('固定正文',{exact:true})).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-card-key]')).toHaveCount(120);
    await expect.poll(()=>page.locator(`[data-card-key="${before.key}"]`).evaluate((e,top)=>Math.abs(e.getBoundingClientRect().top-top),before.top)).toBeLessThan(2);
    await expect(page.getByRole('button',{name:'展开10月4日',exact:true})).toBeVisible();
  }finally{await context.close();}
});
