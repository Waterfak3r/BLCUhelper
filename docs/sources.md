# 信源

信源在后台“信源”页管理：新建、试抓一次看看抓到什么、改频率、启停、看失败原因和最近的条目。首次启动时，`industry/sources.json` 里的示范信源会被导入。

## 校内公告覆盖

`industry/sources.json` 目前配置 25 个校内公开栏目（5 个校级职能部门栏目、2 个首批试点学院栏目，以及本轮逐院核验后新增入库的 18 个学院与教学科研单位公开栏目）；已有部署运行 `scripts/seed.ts` 增量加入缺少的来源，已存在的配置不覆盖。全部沿用官方一手 `T1`、120 分钟抓取间隔、每轮最多补读 8 篇详情、首次最多导入 8 条历史材料，以及关闭网页和 RSS 全文许可的默认设置。

### 1. 校级职能部门公开栏目（既有 5 源）

| 来源 ID | 公开栏目 | 主要覆盖 |
|---|---|---|
| `blcu-xsch-activities` | [学生处·活动公告](https://xsch.blcu.edu.cn/xsc/ldjy1/hdgg.htm) | 劳动教育等学生处活动通知 |
| `blcu-xsc-notices` | [党委学生工作部·通知公告](https://xsc.blcu.edu.cn/xwdt1/tzgg.htm) | 学生活动、勤工助学等；同栏也包含辅导员等非学生通知，仍需筛选 |
| `blcu-yjsy-notices` | [研究生院·通知公告](https://yjsy.blcu.edu.cn/xwgg1/tzgg.htm) | 研究生奖助、招生、推免拟录取等；非本校本科生升学去向全量统计 |
| `blcu-exchange-programs` | [国际合作与交流处·选派通知](https://exchange.blcu.edu.cn/xsjsjl/xptz.htm) | 校际交换、短期研修、国际暑校等项目 |
| `blcu-jobs-notices` | [就业创业指导中心·通知公告](https://jobs.blcu.edu.cn/front/channel.jspa?channelId=743) | 招聘服务、双选会等；用人单位要求不能写成学生报名要求 |

### 2. 官方教学科研单位 23 条目覆盖矩阵（含首批 2 源与新增 18 源）

依据学校官方[机构设置·教学科研单位](https://www.blcu.edu.cn/xxgk/jgsz.htm)原文严格顺序建立以下逐单位现状矩阵。

- **分母定义**：官方页面共有 23 个机构条目；其中 19 个条目具备独立站链接（第 1 条目为合署双链接，共 20 个官方一级域名/站），4 个条目在官网导航中无超链接（`<a>` 标签无 href）。汉学与中国学学院与一带一路研究院为官方合署，不额外多算学院。
- **状态定义**：
  - `已接入（公开 HTML）`：栏目有稳定公开 HTML 条目、独立详情页及发布日期，已配置 `web_list` 信源；
  - `混合（部分自站 / 部分外链微信）`：自站仅抓取本站 HTML 路径，外链微信条目既有采集器默认跳过，微信原文属于明确缺口；
  - `微信外链（无稳定自站公告正文）`：自站公告列表条目全部或绝大多数跳转微信，未取得正文，不创建虚构信源；
  - `新闻混杂（无独立公告流）`：仅有活动纪实、宣传喜报或会议回顾，无独立通知流，不为凑覆盖接入；
  - `线索发现（受限/矛盾/无稳定流）`：发现了学院入口或公开网页，但存在权限限制、正文缺失、日期矛盾或无独立站点，不能凭挂靠推断覆盖。

| 序号 | 官方条目名称 | 官方站点 / 域名 | 来源 ID | 纳入栏目 / 入口链接 | 覆盖状态与明确缺口 |
|---|---|---|---|---|---|
| 1 | **汉学与中国学学院（一带一路研究院）** | `https://chinastudies.blcu.edu.cn/`<br>`http://get.blcu.edu.cn/` | `blcu-chinastudies-notices`<br>`blcu-get-lectures` | [学院·通知公告](https://chinastudies.blcu.edu.cn/xwgg_News___Bulletin/tzgg_Announcement.htm)<br>[智库·讲座预告](http://get.blcu.edu.cn/xwgg/jzyg.htm) | **已接入（公开 HTML）**：学院通知与智库公开课预告均有静态正文与发布日期；智库通知公告混杂会议出版宣传未全量接入；所查样本无微信依赖，但不代表全院信息无遗漏。 |
| 2 | **国际中文学院** | `https://cics.blcu.edu.cn/` | `blcu-cics-notices`<br>`blcu-cics-lectures` | [通知公告](https://cics.blcu.edu.cn/xwgg/tzgg.htm)<br>[讲座预告](https://cics.blcu.edu.cn/xwgg/jzyg.htm) | **已接入（公开 HTML）**：口语大赛、名家讲坛有公开文字正文；但活动报名多依赖文末扫码进群，部分预热文章正文仅单张图片无文字，不可声称群内通知或纯图内容已提取。 |
| 3 | **应用中文学院** | `https://yyzw.blcu.edu.cn/` | `blcu-yyzw-notices` | [通知公告](https://yyzw.blcu.edu.cn/xwgg1/tzgg.htm) | **已接入（公开 HTML）**：招聘启事等有明确文字正文；奖学金公示等正文为 JS 嵌入 PDF，未自动下载解析附件名单；正文项目年份（如 2026）与发布时间分开，取详情发布时间。 |
| 4 | **外国语言文化学院（区域国别研究院）** | `http://irs.blcu.edu.cn/` | *暂无* | [新闻动态](http://irs.blcu.edu.cn/xwdt.htm)<br>[学生风采](http://irs.blcu.edu.cn/xsfc.htm) | **新闻混杂（无独立公告流）**：官网未设独立通知公告栏；现有栏目为讲座会议回顾和获奖喜报，详情多缺发布日期；页脚有“SFS学生咨讯”与“BLCU外语学院研究生”公众号二维码线索但未取得文章正文，属于明确缺口。 |
| 5 | **英语和高级翻译学院** | `https://seis.blcu.edu.cn/` | `blcu-seis-notices` | [通知公告](https://seis.blcu.edu.cn/xwgg/tzgg.htm) | **已接入（公开 HTML，首批）**：覆盖夏令营、同等学力申硕等通知；名额与对象限定院内，不默认适用全校。 |
| 6 | **教育学院** | `https://soe.blcu.edu.cn/` | `blcu-soe-notices` | [通知公告](https://soe.blcu.edu.cn/xwgg/tzgg.htm) | **已接入（公开 HTML）**：表格列表内有完整论坛事项正文；栏目混入研讨会报道等宣传新闻，保留原栏目结构交后续筛选；详情标称发布日期与列表/活动年份有差异，以详情为准。 |
| 7 | **文学院、中华文化研究院** | `https://wenxueyuan.blcu.edu.cn/` | *暂无* | [综合通知](https://wenxueyuan.blcu.edu.cn/index/xygg/zhtz.htm)<br>[讲座信息](https://wenxueyuan.blcu.edu.cn/index/xygg/jzxx.htm)<br>[学生组织](https://wenxueyuan.blcu.edu.cn/xsgz/xszz1.htm) | **微信外链（无稳定自站公告正文）**：通知、讲座、学生组织当前页条目全部直接外链微信（已发现 77 篇去重微信文章链接）；直连微信返回环境异常验证码，自站无正文，不创建虚构信源，属于明确微信缺口。 |
| 8 | **国际政治与传播学院** | `http://sjc.blcu.edu.cn/` | `blcu-sjc-notices` | [通知公告](http://sjc.blcu.edu.cn/tzgg.htm) | **已接入（公开 HTML）**：夏令营招贤榜、干部名单公示均有本站 HTML；党团工作栏因混入样板支部与晚会回顾未全量引入；正文落款日期与页面发布时间不同时取页面发布时间。 |
| 9 | **信息科学学院** | `https://xxkx.blcu.edu.cn/` | `blcu-xxkx-notices` | [院内公告](https://xxkx.blcu.edu.cn/xwdt/yngg.htm) | **混合（部分自站 / 部分外链微信）**：院内公告有公开 HTML 竞赛与助教通知（名单在附件中未下载）；学工动态半数直接外链微信（已记录 7 篇），自站配置仅采自站文章，微信部分待补。 |
| 10 | **商学院、经济研究院** | `https://bs.blcu.edu.cn/` | `blcu-bs-notices` | [通知公告](https://bs.blcu.edu.cn/xwgg/tzgg.htm) | **已接入（公开 HTML，首批）**：覆盖奖助、推免、交流通知；保留学院与年级限制。 |
| 11 | **马克思主义学院** | `https://marxism.blcu.edu.cn/` | `blcu-marxism-notices` | [通知公告](https://marxism.blcu.edu.cn/xwdt/tzgg.htm) | **混合（部分自站 / 部分外链微信）**：自站招生调剂可读；但最新条目多为跨站研究生院通知（由研院源覆盖不重复配置）；图片新闻与学生活动外链微信（已记录 16 篇），自站配置仅放行本站路径。 |
| 12 | **艺术学院** | `http://ysh.blcu.edu.cn/` | `blcu-ysh-notices` | [通知公告](https://ysh.blcu.edu.cn/xwgg_News___Bulletin/tzgg.htm) | **混合（部分自站 / 部分外链微信）**：本站同等学力招生简章可读；但夏令营简章、调剂公告等 6 条核心动态直接外链微信，且正文包含图片说明，自站配置仅放行本站路径，微信部分未取得。 |
| 13 | **语言科学与资源学院（语言科学研究院）** | `https://sllr.blcu.edu.cn/` | `blcu-sllr-notices` | [通知公告](https://sllr.blcu.edu.cn/xwgg/tzgg.htm) | **已接入（公开 HTML）**：夏令营与党员发展对象公示可读；团学建设以活动回顾为主未建源；页脚“言科青语”公众号未见文章外链，未取得微信正文。 |
| 14 | **心理与认知科学学院（生命健康研究院）** | `https://xlrzkx.blcu.edu.cn/` | `blcu-xlrzkx-notices`<br>`blcu-xlrzkx-admissions`<br>`blcu-xlrzkx-student-activities` | [通知公告](https://xlrzkx.blcu.edu.cn/xwgg/tzgg.htm)<br>[学院招生](https://xlrzkx.blcu.edu.cn/xyzs1.htm)<br>[团学活动](https://xlrzkx.blcu.edu.cn/txhd.htm) | **已接入（公开 HTML）**：招生与调剂在通知公告与招生栏目存在跨 URL 重复发布，保留多栏目交后续归组；部分心理活动报名详情正文为单张 jpg 图片、无文本，未 OCR。 |
| 15 | **继续教育学院（教育部出国留学培训部）、网络教育学院** | `https://cec.blcu.edu.cn/` | `blcu-cec-notices` | [信息公告](https://cec.blcu.edu.cn/xwdt/xxgg.htm) | **混合（部分自站 / 部分外链微信）**：两块牌子共用 cec 官网；自站停服声明与收费公示可读（收费正文为图表图片未下载）；现场确认通知外链微信且返回验证码；仅适用继教与网教群体。 |
| 16 | **国际学院** | `https://ic.blcu.edu.cn/` | `blcu-ic-notices` | [通知公告](https://ic.blcu.edu.cn/xydt/tzgg.htm) | **已接入（公开 HTML）**：大师课预告、寒假须知可读；通知明确针对 2+2 国际本科及培训项目，不代表全校通用。 |
| 17 | **海南国际学院** | `https://admission.blcu.edu.cn/xydt/list.htm` | *暂无* | [招生网·海南国际学院](https://admission.blcu.edu.cn/xydt/list.htm)<br>[项目课程](https://admission.blcu.edu.cn/hngjxyxmkc/list.htm) | **线索发现（受限/矛盾/无稳定流）**：官方机构名录中无 href 链接，实际挂靠国际学生招生处；虽有公开院页，但项目课程列表无数据、课程安排仅含图片、`page.htm` 实测跳转 `page.psp` 要求登录鉴权（HTTP 200/403 表单）、新生指南为嵌入 PDF、报到须知存在 2024 与 2026 年份矛盾；无法稳定自动采正文，属于明确缺口。 |
| 18 | **体育教学部** | `https://tyb.blcu.edu.cn/` | `blcu-tyb-notices` | [通知公告](https://tyb.blcu.edu.cn/tzgg.htm) | **已接入（公开 HTML）**：首页 15 条中 14 条为比赛夺冠报道，仅 1 条规程通知，属于典型混杂栏目；按高召回保留本站条目交模型筛选，体测分院安排为图片未 OCR。 |
| 19 | **中国书法国际传播研究院** | `https://icicc.blcu.edu.cn/` | *暂无* | [通知公告](https://icicc.blcu.edu.cn/sfzgxljz/tzgg.htm) | **混合（绝大多数外链微信）**：通知公告 20 条中 19 条直接外链微信且直连遇验证码，唯一自站条目为 2022 年学术随笔，不为凑数接入自站；讲座预告正文未取得，属于明确缺口。 |
| 20 | **国际中文教育实践与研究基地（北京语言大学）** | *无独立站* | *暂无* | 挂靠国际中文学院等 | **线索发现（校级基地无独立站）**：官方名录无 href，本轮未验证独立公开通知流；不能凭挂靠国际中文学院推断已覆盖独立基地通知。 |
| 21 | **区域国别协同创新中心** | *无独立站* | *暂无* | 挂靠外国语言文化学院等 | **线索发现（协同中心无独立站）**：官方名录无 href，本轮未验证独立公开通知流；不能凭挂靠推断已覆盖。 |
| 22 | **语言文化国际传播联合研究院** | `https://lacic.blcu.edu.cn/` | `blcu-lacic-lectures` | [讲座预告](https://lacic.blcu.edu.cn/xydt_News___Events/jzyg_Upcoming_Lectures.htm) | **已接入（公开 HTML）**：通知公告仅 2 条通用假期安排不单设源；沿真实导航接入梧桐学科建设讲坛预告，静态 HTML 含主讲人、时间、地点与发布日期。 |
| 23 | **国家国际政治与传播研究基地** | *无独立站* | *暂无* | 挂靠国际政治与传播学院等 | **线索发现（研究基地无独立站）**：官方名录无 href，本轮未验证独立公开通知流；不能凭挂靠推断已覆盖。 |

### 3. 数据完整度与采集边界

- **正文文字与附材**：本轮核验均基于各院实际 HTML 列表、原文日期、正文节点与附材链接。不自动下载附件，不自动调用 OCR 识别纯图正文。正文为图片（如部分活动预告、体测安排）、JavaScript 嵌入 PDF（如应用中文学院奖学金公示、海南校区新生指南）或附件名单的通知，当前仅记录标题与链接，正文文字属于客观缺失，不谎报为完整正文。
- **日期精度与历史边界**：详情发布日期严格以页面元数据或发稿栏为准，原站只有日期就保留日期精度，不臆造时间戳；正文提及的项目年份（如“2026年项目”）或活动日期不作为发布日期。首次导入只保留上限历史样本，不把历史旧通知当成今天新通知。
- **混合站点微信外链**：信息科学学院、马克思主义学院、艺术学院、继续教育学院等信源的 `allowUrlPrefixes` 仅放行自站路径。同栏中出现的微信外链条目在网页列表模式下自动跳过，不创建虚构全文配置，未取得正文的内容不计入自动覆盖。
- **通知总召回率客观说明**：25 个公开栏目实现了校级核心部门与具备稳定公开 HTML 学院栏目的接入，但文学院全量微信外链、外语学院公告流缺失、书法院微信受阻、海南及 3 个基地独立来源未建，且大量栏目混杂新闻报道与纯图附件。**“全学院逐项核验”不等于“全校通知全量覆盖”**，不能据此宣称通知召回率已达标。

### 4. 尚未覆盖的关键入口与缺口汇总

- **本科教务动态**：公开[转专业流程](https://jwc.blcu.edu.cn/info/1391/3512.htm)明确要求参照数字北语通知，教务实时选课、考务未找到公开稳定数据流，严禁接入需数字北语或教务系统认证的内网内容。
- **文学院、外国语言文化学院、书法院等微信依赖**：文学院通知与讲座全量外链微信、外语学院依赖“SFS学生咨讯”等账号、书法院讲座均为微信外链；直连微信常遇验证码，正文尚未打通。
- **团委、志愿与文体竞赛**：[团委通知列表](https://tuanwei.blcu.edu.cn/bmdt/tzgg.htm)条目指向公众号，属于半自动导入边界，文体志愿未全覆盖。
- **图书馆与校级汇总**：图书馆依赖前端动态渲染，学校统一通知汇总依赖动态接口，本轮未接入空壳源。
- **无独立站基地与异地校区**：海南国际学院及 3 个无超链接基地暂无独立稳定公开通知流，不能凭挂靠推断覆盖。
## 六种信源

| 类型 | 适合 | 需要 |
|---|---|---|
| `rss` | 有 RSS / Atom 的博客、媒体、Substack、公众号转 RSS 服务 | 无 |
| `web_list` | 没有 RSS 的网页列表（新闻页、博客列表、更新日志） | 写选择器；按需配置 Jina Reader 渲染（按次计费） |
| `json_list` | 返回 JSON 的接口（GitHub Releases 等） | 写字段路径 |
| `x_search` | X（推特）账号 | SocialData 的 key，按请求计费 |
| `mp_account` | 微信公众号 | 极致了（Dajiala）的 key，按请求计费 |
| `external` | 你自己的脚本推送进来的内容 | `INGEST_TOKEN`，见下文 |

`json_list` 的地址或配置可能携带凭据，只跟随同源重定向（协议、主机和端口都相同）。若接口搬到另一个来源，请直接更新信源地址；不要依赖跨源跳转传递认证信息。

抓取默认不连内网地址。订阅或列表地址指向自建在内网的服务时（比如同一 Docker 网络里的 RSSHub，地址写 `http://rsshub:1200/...`），在 `.env` 里设 `PRIVATE_FEED_HOSTS=rsshub`（逗号分隔的完整主机名，不区分大小写），重启 API 和 worker。放行只对 `rss` 的 `feedUrl`、`web_list` 与 `json_list` 的 `url` 本身生效，这些主机直连、不走 `EGRESS_PROXY_URL`；跳转到别的主机、文章正文、详情页、图片和图标仍按原规则拒绝内网地址，链路本地和云元数据地址（`169.254.0.0/16`、`100.100.100.200` 等）任何时候都拒绝。

每种信源认哪些配置项写在 [`config-keys.ts`](../packages/backend/src/sources/config-keys.ts)。填了不认识的配置项，保存会被拒绝、抓取会直接失败并在后台显示原因，不会悄悄退回通用解析。

## 原文与附材引用

文章列表、详情和报告中，已有原文地址的来源名称可以直接打开原文；文章标题仍进入站内阅读页。详情页的“原文附带材料”列出原文明确给出的附件或材料名称和原站地址，不托管文件、不代理下载，也不自动读取附件内容。链接可能过期或要求原站登录，访问权限与有效性以原站为准。

附材由采集脚本从实际页面结构和明确的文件链接中提取，不由模型生成。相对地址按原文页地址解析，保留下载链接的完整参数；上一条、下一条、导航、同页锚点，以及只有脚本行为、没有真实 HTTP(S) 地址的链接，不作为该篇附材。只有图片或附件的通知仍须核验转录，取得链接不会把不完整正文标为完整，也不会让模型凭链接猜测办理要求。

链接引用与全文许可分开：正常公开的通知即使 `site_fulltext=false`，仍可提供安全的附材链接，但正文继续只显示摘要；管理员明确限制为“仅摘要”、撤回或隔离的内容仍遵守原有公开边界，不借附材分发被限制的材料。

附材地址保存到现有材料元数据，不需要数据库迁移。成功重新读取原文后，以页面当前提供的链接替换旧列表；请求失败、跳转到登录页或没有读取详情时，不清空已有地址。抓取期间若已有较新的附材更新，旧响应不会覆盖新列表，附材变化本身不触发模型重评。旧材料已存正文中保留的附材可直接引用，原来抽取时已经丢失的链接无法凭空恢复，不会因此自动批量回抓或重跑模型。

## 先预览，再创建

进入 `/admin/sources/new`，填写 ID、名称，选择类型，再把[下一节](#每种信源怎么配置)对应的 JSON 填入“采集配置（JSON）”。这里填的是配置对象，不要包上 `kind` 或 `config`。切换类型会重置配置，先选类型再粘贴。

名称里全角括号中的备注（比如“某媒体（热点 RSS）”）只给后台看，读者在网页、RSS、Agent Markdown、MCP 和搜索里看到的是去掉备注的名字；X 账号写成 `X：显示名 (@handle)` 的，读者只看到显示名。公开 API 的 JSON 里仍是完整的名字。

`rss`、`web_list`、`json_list`、`x_search` 可以点“预览抓取”：显示条目总数和前 20 条的标题、原文链接、发布时间、摘要，不把条目存入文章库。检查抓到的是文章而不是导航，日期与原文一致，再点“创建”。预览和正式采集套用同一组过滤（地址前缀、分类、噪声词、地址改写、`publishedAfter`），看到的就是正式采集会收的条目；但它不等于完成生产采集，也不经过后续详情补齐、精选和公开发布流程。

预览仍会发出抓取请求；X 和 Jina 预览也可能产生费用，经过付费回执和预算。`COLLECT_ENABLED=false` 只关闭后台自动采集，不能用它来保证手动预览不访问外部服务。下面的本地 HTML/JSON 示例不需要任何 API key。

## 每种信源怎么配置

### rss

```json
{ "feedUrl": "https://example.com/feed.xml" }
```

可选：`summaryIsBody`（确认文字订阅里的摘要就是全文时，将 RSS 的 `description`、Atom 的 `summary` 当正文，不再去抓原文页）、`allowCategories` / `denyCategories`（按订阅里的分类过滤）。

所有信源的 YouTube、Vimeo 视频播放页都不作为文章正文提取。Media RSS 的视频描述保留为摘要，即使设置了 `summaryIsBody` 也不会把描述当成视频字幕；订阅通过 `content` / `content:encoded` 提供的真实文字仍可使用。其他文章中嵌入视频，不影响文章本身的正文读取。

文章正文中的原生视频保留安全的媒体地址和候选格式，使用浏览器控件手动播放。视频文件由浏览器直连原站，封面沿用图片代理；不自动播放、不循环，预加载提示设为 `none`，但浏览器不保证交互前完全没有请求。没有媒体地址和可用封面的播放器只保留后备文字。Markdown 和允许再分发的全文 RSS 保留视频结构，能否播放取决于阅读器；动态平台播放器和 iframe 不在此范围。

文章插图里内嵌的 SVG 图不保留图形本身（颜色和字体依赖原站样式表），换成原站给这张图写的无障碍文字说明（`aria-label`、`aria-labelledby` 指向的文字，或图里的 `<title>`、`<desc>`），作为纯文字放在图原来的位置；同一张图的宽窄两版只留一份，插图里已经显示的文字（图注、小标题）不重复。没有文字说明的图和插图之外的 SVG 图标照旧去掉。

没有网页的播客单集（没有 `<link>`、`guid` 也不是网址），原文链接用它的音频或视频文件，浏览器可以直接播放；这类单集不抓网页，按订阅里的文字处理。

#### wechat-mp-tools 原生 RSS 试验对接

针对部署在内网或本机的 wechat-mp-tools（见[部署文档](deploy.md#微信公众号采集服务试验wechat-mp-tools-原生-rss)），在后台以 `rss` 类型单独为每个公众号建源（单账号独立源，不合并为虚构的聚合身份）。例如为公众号“北语青年”或“北语文学院”建源：

```json
{
  "feedUrl": "http://wechat-mp-tools:5200/api/articles/rss/%E5%8C%97%E8%AF%AD%E9%9D%92%E5%B9%B4?full=1",
  "_aihot": { "initialBackfillLimit": 8 }
}
```

后台配置要点与安全约束：
- **配置参数**：类型选择 `rss`，确认公众号官方身份后再核定为一手（`T1`），抓取间隔 120 分钟。正文直接读取 RSS 的 `content:encoded`，不要设置 `summaryIsBody: true`：缺失或超长正文时，短描述不能代替完整通知。
- **试验期隔离**：试验阶段信源参与模式设为 `isolated`，`site_fulltext` 与 `syndicate_fulltext` 均设为 `false`。首次导入历史上限使用示例中的 `_aihot.initialBackfillLimit: 8`，不修改全局回填窗口。
- **已有源归属与 ID 保护**：`external` 来源不能在后台直接改成 `rss`；原 `blcu-beiyuqingnian` 保留外部导入记录，另通过后台创建单账号来源 `blcu-beiyuqingnian-rss`，不建立多个公众号混用的汇总源。相同原文 URL 按材料身份判重，不重复建文，也不强改既有文章的来源归属；历史材料补正文仍使用原 `sourceId`。RSS、网页列表、JSON 列表之间才支持后台原位更换采集方式，不以直接修改数据库绕过该约束。
- **正文与附材边界**：通过补丁修复后，RSS 条目使用微信文章原始 URL 并保留未过滤的正文段落与外部链接；若文章正文过长则安全省略正文等待人工核验，不返回断裂的附件 URL。正文中的插图直连微信图片 CDN，可能存在防盗链无法直接展示，属于已知客观现象，不私自下载转存；缺失日期的条目省略 `<pubDate>`，本站不会伪造当前时间作为发布日期。

### web_list

支持普通 CSS 选择器，`div` 列表也能采集。关键是 `itemSelector` 要选中**每条新闻**，而不是包住所有新闻的容器。例如：

```html
<div class="news-list">
  <div class="news-item">
    <h2><a href="/posts/first">第一条示例新闻</a></h2>
    <time datetime="2026-10-01T09:00:00+08:00">10 月 1 日</time>
  </div>
  <div class="news-item">
    <h2><a href="/posts/second">第二条示例新闻</a></h2>
    <time datetime="2026-10-01T10:00:00+08:00">10 月 1 日</time>
  </div>
</div>
```

对应配置（`example.com` 是占位地址，换成目标网页；可运行版本见[本地示例](#本地跑通-htmljson-示例)）：

```json
{
  "url": "https://example.com/news",
  "parseMode": "html",
  "itemSelector": ".news-list > .news-item",
  "linkSelector": "h2 a",
  "titleSelector": "h2 a",
  "publishedAtSelector": "time",
  "allowUrlPrefixes": ["https://example.com/posts/"]
}
```

- `itemSelector` 在整个页面找条目；`linkSelector`、`titleSelector` 在每个条目内取第一个匹配节点，也可以匹配条目自身。选 `.news-list` 只会得到一个容器，通常只取到第一条新闻；只写 `div` 又会混入嵌套容器。要选重复出现的新闻节点。
- 链接取自 `href`；`/posts/first` 等相对链接按列表重定向后的最终地址解析，也可用 `baseUrl` 指定基准地址。标题取节点文字。重复链接会合并；Markdown 列表先出现“Read more”等按钮、后出现真实标题时，使用真实标题。指向列表自身的链接通常会跳过。
- 日期在条目内查找 `publishedAtSelector`，依次尝试 `datetime`、`content`、`title` 属性和文字，无法解析的提示文字不会遮住同一节点的有效日期。没有时区的日期时间可用 `publishedAtUtcOffset`（默认 `+08:00`）；自带时区的时间保留原时区语义，纯 `YYYY-MM-DD` 按 UTC 零点读。不完整的月份、产品版本号和不存在的日历日期不作为发布日期。
- `parseMode`：普通网页默认 `html`；`markdown` 按 Markdown 链接读；`docusaurus_changelog` 读更新日志标题；`intercom_changelog` 按 Intercom 帮助中心的日期章节读取标题和正文，每节保留自己的网址锚点，默认按 UTC 日历日读取，也可指定 `publishedAtUtcOffset`。需要 Jina 时，显式把 `url` 写成 `https://r.jina.ai/https://目标站/路径` 并配置 `JINA_API_KEY`，不是抓不到就自动切换。Jina 默认返回 Markdown；要继续使用 CSS 选择器，显式设 `parseMode: "html"`。
- `detail`：列表缺日期、标题或摘要时抓详情页补齐（`publishedAtSelector`、`titleSelector`、`summarySelector` 等）。读取失败或本轮 `maxFetches` 用完的条目，后续抓取继续补全；补元数据时保留已确认的正文。已有真实标题不会因为列表仍写“Read the Blog”而被换回按钮文字，也不会仅因标题较长再次读取详情。需要强制使用详情标题时设置 `titleAuthoritative: true`。详情页和正文提取读到不带时区的时间时，先用 `detail.publishedAtUtcOffset`，未设则继承信源的 `publishedAtUtcOffset`，两处都未设时默认 `+08:00`。RSS、JSON 列表也可以用 `detail`。
- Jina 列表的 `detail.titleRegex`、`publishedAtRegex` 匹配 Jina 文本，可共用同一次详情响应；CSS 选择器读取原站 HTML。应按实际可读取的页面选择规则。
- `allowUrlPrefixes` / `denyUrlPrefixes`：只收某些路径下的文章。

### json_list

假设接口返回下面的结构，`itemsPath` 指向数组，其他字段路径相对**每个数组元素**填写。路径用点分隔，不是 JSONPath，不写 `$` 或 `[*]`。

```json
{
  "data": {
    "items": [
      {
        "id": "first",
        "title": "第一条示例新闻",
        "url": "https://example.com/posts/first",
        "summary": "第一条新闻的摘要。",
        "published_at": "2026-10-01T09:00:00+08:00"
      }
    ]
  }
}
```

对应配置：

```json
{
  "url": "https://example.com/api/news",
  "mode": "json_api",
  "itemsPath": "data.items",
  "titlePaths": ["title"],
  "urlTemplate": "{raw:url}",
  "summaryPaths": ["summary"],
  "publishedAtPath": "published_at",
  "externalIdPath": "id"
}
```

- 接口本身返回数组时，省略 `itemsPath`。`titlePaths`、`summaryPaths`、`authorPaths` 是候选路径数组，按顺序取第一个非空值，例如 `["title", "name"]`。
- 已有完整网址时用 `{raw:url}`；只有 slug 时可用 `https://example.com/posts/{slug}`。`{字段路径}` 会编码字段值，`{raw:字段路径}` 原样插入。JSON 列表不会自动把相对网址补成绝对网址，模板应产出完整的 HTTP(S) 地址。
- `summaryIsBody`：确认接口里的摘要就是全文时设为 `true`，把 `summaryPaths` 取到的文字当正文，不再去抓原文页。
- 日期建议返回带时区的 ISO 字符串；`2026-09-30 17:43:58` 这类不带时区的时间，与网页列表一样按 `publishedAtUtcOffset` 读（默认 `+08:00`）；数字时间戳分别设 `publishedAtUnit: "epoch_s"`（秒）或 `"epoch_ms"`（毫秒），`20261001` 这类日期设 `"yyyymmdd"`。
- 缺少标题或无法生成链接的条目会跳过。非空数组全部映射失败时，会报 `no items mapped (check title/url paths)`；路径不是数组时，会报 `items path did not resolve to an array`。

### 本地跑通 HTML/JSON 示例

仓库提供两份虚构示例：[news.html](examples/sources/news.html) 和 [news.json](examples/sources/news.json)，各有两条新闻。它们用于核对选择器和字段映射，不是运营信源；示例文章链接不提供正文。

在仓库根目录、Node.js 24.11 以上运行以下命令。服务只监听本机，只提供这两份文件；用 `Ctrl+C` 停止。

```bash
node --input-type=module -e '
import http from "node:http";
import { readFileSync } from "node:fs";
const files = {
  "/news.html": ["text/html; charset=utf-8", readFileSync("docs/examples/sources/news.html")],
  "/news.json": ["application/json", readFileSync("docs/examples/sources/news.json")]
};
http.createServer((req, res) => {
  const file = files[req.url];
  res.writeHead(file ? 200 : 404, { "content-type": file ? file[0] : "text/plain" });
  res.end(file ? file[1] : "Not found");
}).listen(8787, "127.0.0.1");'
```

在同一台机器上，按[非 Docker 部署方式](deploy.md#不用-docker)准备好数据库，用 `npm run dev:api`、`npm run dev:web` 运行开发 API 和网页，保持采集、模型、飞书和 IndexNow 开关关闭，不启动 worker。仅为此次本机示例，在开发 API 进程设置 `ALLOW_PRIVATE_NETWORK_FETCH=true` 后重启；默认禁止抓内网地址，生产环境拒绝启用此项，验证后移除。若 API 在容器或另一台服务器，`127.0.0.1` 指向它自己，此命令的地址不能直接用于该部署。

分别选择 `web_list`、`json_list`，粘贴配置并点“预览抓取”，无需创建信源：

```json
{
  "url": "http://127.0.0.1:8787/news.html",
  "parseMode": "html",
  "itemSelector": ".news-list > .news-item",
  "linkSelector": "h2 a",
  "titleSelector": "h2 a",
  "publishedAtSelector": "time",
  "allowUrlPrefixes": ["http://127.0.0.1:8787/posts/"]
}
```

```json
{
  "url": "http://127.0.0.1:8787/news.json",
  "mode": "json_api",
  "itemsPath": "data.items",
  "titlePaths": ["title"],
  "urlTemplate": "http://127.0.0.1:8787/posts/{id}",
  "summaryPaths": ["summary"],
  "publishedAtPath": "published_at",
  "externalIdPath": "id"
}
```

两次都应显示 **2 条**，依次为下表内容。JSON 示例还显示对应摘要，HTML 示例没有配置摘要提取。预览 API 的日期是 UTC，后台界面按 `+08:00` 显示为 09:00 和 10:00。

| 标题 | 原文链接 | 预览 API 的 publishedAt |
|---|---|---|
| 第一条示例新闻 | `http://127.0.0.1:8787/posts/first` | `2026-10-01T01:00:00.000Z` |
| 第二条示例新闻 | `http://127.0.0.1:8787/posts/second` | `2026-10-01T02:00:00.000Z` |

可以把 HTML 的 `itemSelector` 暂改成 `.news-list` 对照：只会返回第一条。改回 `.news-list > .news-item` 后恢复两条，这就是“列表容器”和“每条新闻”的区别。

抓真实网页时先看原始 HTTP 响应中有没有新闻节点。普通 HTML 模式不执行 JavaScript；浏览器里看得到、响应里没有的内容，不能靠换一个 CSS 选择器生成。优先找 RSS 或 JSON 接口，或按需配置 Jina / 自己维护的外部采集。`no items matched (html)` 还可能是选择器不匹配、没有 `href` 或标题、链接被前缀规则过滤；先核对响应与配置，不必先更换采集器。

### x_search

这类信源使用 SocialData 搜索，不是把 X 个人主页 URL 填入网页列表。以 `https://x.com/SomeAccount` 为例，取用户名 `SomeAccount`，不要包含 `@` 或整段 URL：

```json
{ "query": "from:SomeAccount -filter:replies", "searchType": "Latest" }
```

`SomeAccount` 是占位用户名，换成你要关注的真实账号。`-filter:replies` 排除回复；`Latest` 按最新内容查找。

在后端运行环境的 `.env` 配置 `SOCIALDATA_API_KEY`，重启 API（预览）和 worker（定时采集）后生效；不要把 key 写进信源 JSON 或提交到仓库。先在后台“设置 → 付费请求上限”检查 SocialData 额度，再按需预览。未配置 key 会报 `SOCIALDATA_API_KEY is not configured`；服务拒绝请求或预算熔断时看后台错误原因。预览可能有付费请求，本文不要求用真实服务验证，结果取决于账号和服务当时的返回。

生产自动采集时，普通账号会被自动合并成一次搜索（每次最多二十几个账号），省请求数；单个信源的手动预览不是合并采集。

### mp_account

```json
{ "ghid": "gh_xxxxxxxx", "nickname": "公众号名称" }
```

每个公众号按它的抓取间隔检查一次（查列表按次计费），新文章的正文一并取回。

需要在后端 `.env` 配置 `DAJIALA_KEY`，`ghid` 换成公众号原始 ID。配置字段用上面的 `ghid` / `nickname`，不要写成 `biz` / `name`。当前 `mp_account` 不支持“预览抓取”；`external` 也不支持主动试抓，按下方推送接口接入。

### 微信公众号方案对比与事实边界

校园场景中文学院、书法院、外语学院及团学竞赛大量通知承载于微信公众号。针对服务器环境与运维成本，不同公众号接入方案事实边界如下：

1. **ReadGZH 匿名按需单篇读取（当前实施中）**：
   - **实跑事实**：已在受限公网环境中对已知公开 URL 成功完成匿名实读（如人文竞赛、志愿等篇目），能提取正文文字、发布日期与附材链接。
   - **工作方式与边界**：正在新增独立辅助脚本 `scripts/read-wechat.ts`，仅接受已在校内网页列表中发现的具体公开文章 URL，按需匿名抓取，输出待人工/脚本核验的标准化 JSON；无桌面环境依赖、无需微信账号登录、不设自动 fallback 到外部不可控爬虫；网络请求遵循出站策略（可配 `EGRESS_PROXY_URL`）。
   - **缓存与隐私**：所查缓存列表仅针对单篇公开内容，不代表支持全账号订阅；第三方共享缓存只传递公开材料，不涉及任何私密凭据。
2. **极致了（Dajiala，已有原生支持）**：
   - 仓库内已有 `mp_account` 原生接入支持，直接配置 `ghid` 与 `DAJIALA_KEY` 即可定时查列表取正文。
   - **当前事实**：需购买商业 API key，目前环境未配置 key、未购买额度、未进入实测，处于可用但未启用的等待状态。
3. **wechatDownload 等桌面端工具**：
   - 依赖本地桌面 GUI、Windows/macOS 运行环境或微信客户端登录凭据与许可证书，只能在人工运维时辅助单篇或少量导出；无法作为无头 Linux 服务器后台自动化无人值守采集。
4. **RSSHub / 公众号转 RSS 方案**：
   - 虽可部署于 Linux 容器或轻量服务器，但上游数据源通常需要扫码登录、维护微信个人或公众号会话 Token，并面临频繁过期与风控阻断；技术上并非绝对不可行，但维护成本与断流风险高，因此本轮未作为自动化主方案接入。

## 分级、参与方式与全文

- **分级** `tier`：`T1` 官方一手（官网、官方博客、机构）、`T1_5` 官方账号与准官方创作者、`T2` 媒体与个人、`EXCLUDE_MP` 不参与精选。入选门槛按分级不同（`industry/selection.ts`）。
- **参与方式** `participation_mode`：`editorial` 进精选和全部动态；`hot_signal` 不单独展示，只作为“大家在讨论什么”的热度证据；`isolated` 不进任何公开页面。
- **一手**：只有 `T1` 算一手，不单独设置。同一条新闻有几篇报道时，代表报道优先选一手的，事件页也优先展示一手报道。
- **发布方**（可选，写在 `config` 里）：
  - `publisherUrlPrefixes`：`T1` 信源自己文章网址的前缀，比如 `["https://example.com/blog/"]`。别的信源（聚合站、转帖）带来的这些网址的文章，只要能认定是唯一一个官方信源的，就改记到它名下。网页列表信源不写时，认它自己列表所在的路径（这篇也要在它的列表里出现过）。
  - `publisherRole`：`T1_5` 账号的身份，`organization`（机构官方账号）或 `person`（官方人员）。再填上信源的 `owner_entity_id`（`industry/taxonomy.ts` 的 `ENTITIES` id），这个账号发的、主体正是这家公司的新闻，就能当代表报道（排在 `T1` 之后）。
- **全文**：`site_fulltext` 决定站内能不能显示全文，`syndicate_fulltext` 决定全文 RSS 能不能带正文。两者**默认都关**，只显示摘要和原文链接；来源明确允许时再打开。公众号、付费墙内容不会因为技术上抓得到就获得全文展示。

## 抓取频率

每个信源有自己的抓取间隔。每天 04:20 会按近 7 天的产出自动调整：产出多的抓得勤，最短 15 分钟（经 Jina 读的网页列表最短 60 分钟）；最长的，一般信源 60 分钟，X 账号和经 Jina 读的网页列表 120 分钟，只作热度证据的 180 分钟。合并搜索的 X 账号跟着合并后的节奏：进精选的半小时一次，只作热度证据的一小时一次。

抓取失败不推进位置，下次从同一处继续；连续失败的信源在后台标红，每周一会在运营群发一份信源周报（配置了飞书内部群时）。

「7 天没有新内容」按**信源自己的节奏**判断，而不是一个固定的窗口：日报和周报里分两类。**超出自身更新节奏**的排在前面，先对照原站（把最近 90 天的**产出日**去重到「天」，相邻两天的间隔取中位数当它的节奏；至少有 4 个这样的日子才算有节奏，静默时长要超过中位间隔的 4 倍才算超）。产出日取该条内容的发布时间，页面没给时间就用我们发现它的那天；**一次首次导入算一天**——它是一次交付，发布时间往回铺多远都不算多次产出（否则一个从没产出过的源会显得很准时，跨月的首次导入还会把中位间隔撑大，把一个已经安静的源藏起来）。窗口只算这 90 天里的产出日，更早的历史说明不了它现在多久发一次；发现时间与发布时间没有固定先后，任一个落在窗口内就读，产出日再按窗口夹一次。**判断不了节奏的仍然列出**，但不当作故障，分两种：窗口内没有可比较的产出（它产出过，只是都在窗口外），以及从未收到过内容（那是采集问题）；在自身节奏内的不再列出。抓取间隔 `interval_minutes` 不参与判断——它表示我们多久看一次，不是它多久发一次。

## 规则：旧文不刷屏

首次发现时原文已经发布超过 48 小时的资料、新信源第一次导入的存量条目、标记为回灌的推送，都按原文时间归档：不进入“今天”，也不推送。没有可信发布时间的资料先不公开（不进公开列表、精选、报告、热点和推送），从原信源或原文页读到日期后再判断新旧。这条规则所有入口共用，防止一次性导入历史内容刷屏。

新信源第一次导入时，只取列表里前 `_aihot.initialBackfillLimit` 条（默认 30）、`_aihot.initialBackfillMonths` 个月以内（默认 12）的条目。之后的抓取只收发布时间在信源第一次导入前 48 小时以内或之后的条目，列表里更早的存量不再进来，不会为整个订阅存档付费；第一次导入以后发布的条目，排在长列表第几条都会收。列表上没有发布时间的条目照收，按上面的规则等读到日期再判断。X 账号按抓取位置往后读，不受这条限制。

如果只想从一个固定时间之后开始监控，可在 RSS、网页列表、JSON 配置中设置 `publishedAfter`，例如 `"2026-10-01T00:00:00.000Z"`。必须是完整的 UTC 时间，可省略毫秒；预览、首次和后续采集都只接受**严格晚于**它且发布日期可信的条目，未知日期也会排除。起点当天的单页更新章节若仍使用同一发布日期，之后追加的内容也不会被纳入；选择起点时要把这个限制考虑进去。

## 外部推送接口

自己写脚本抓的内容，可以推进站里，走和普通采集一样的判重、精选和归组。

```
POST /api/ingest/items
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{
  "sourceId": "my-crawler",
  "sourceName": "我的抓取脚本",
  "items": [
    { "title": "必填", "url": "必填", "publishedAt": "2026-10-01T08:00:00+08:00", "author": "可选", "bodyText": "可选：经核对的完整正文或图片转录" }
  ]
}
```

- `INGEST_TOKEN` 在 `.env` 里设置，至少 16 位；不设置时接口一律返回 401。
- 每次最多 50 条，超过返回 413。每个客户端每分钟能推几次由 `INGEST_RATE_LIMIT` 决定：`docker compose` 默认 10，超过返回 429（带 `Retry-After: 60`）；不用 Docker 时默认不限，前面没有反向代理限流的话在 `.env` 里设上，设成 0 表示不限。
- 返回 `{"ok": true, "created": <新建条数>}`。不是 JSON 对象的条目、缺标题或网址的条目会被跳过，同一请求里重复的网址只取第一条。
- `sourceId` 不存在时会自动建一个 `external` 信源，默认不进公开页面：到后台把它的参与方式改成 `editorial` 才会出现在站上。
- 在后台暂停信源后，推送接口返回 409，不再接收新文章；恢复信源后可以继续推送。
- 条目的 `raw._aihot.backfill` 为 `true` 时按历史回灌处理（不进入“今天”、不推送）。
- `bodyText`（可选，本期新增）：仅当 `typeof === "string"` 且 `.trim()` 后非空时，才将修剪后的字符串作为 `bodyText` 传给 `upsertMaterial`；缺失、空白或非字符串值均视为未提供，不会清空已有正文。不接收 `bodyHtml`。不影响 `site_fulltext` / `syndicate_fulltext`。正文、日期、身份、修订、跨源发现、paused 拒绝等规则保持不变。
