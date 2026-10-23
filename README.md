# BLCUhelper

北京语言大学校园助手。

学生自建、非学校官方平台。首期整理公开学生通知，不提供校务办理或资源下载；学校原文是最终依据。

## 当前范围

- 公开官网自动采集：初始接入学生处“活动公告”，每 120 分钟检查一次，每次最多补读 8 篇详情。
- 公众号半自动：从公开目录发现链接，管理员核验原文日期和完整正文后，经鉴权接口导入。目录不代表公众号全量更新。
- 六分类：教务考试、奖助评优、升学就业交流、活动讲座、校园服务、校园资讯。
- 学生精选、全部动态、分类、搜索、收藏、日报和后台沿用底座。热点与主题仅隐藏导航，原路由仍存在。
- 默认仅公开简短摘要、来源和原文链接，不自动开放全文或全文 RSS 转载许可。
- 数字北语登录后内容不接入，不收集学生账号、密码或 Cookie。官方入口：[数字北语服务大厅](https://ehall.blcu.edu.cn/index.html)。

覆盖不完整，不能承诺不漏通知；`/all` 不是原始抓取记录全集，缺正文、缺可信日期或预筛拦截的材料需要在后台排查。日报是精选摘要，不是全校通知清单。纯图片/附件通知需人工核对转录，不凭标题生成要求。

## 架构与基线

基于 [Waterfak3r/AIHOT](https://github.com/Waterfak3r/AIHOT) 的固定提交 `a0d1e75b00ede7e503ca948e71a468db964b2df2`；保留 [MIT LICENSE](LICENSE) 与 [NOTICE](NOTICE)。工作区历史、原有 README 和项目 `.omp` 配置保留。代码包名 `@aihot/*` 是上游内部工作区标识，不是站点品牌。

- `apps/web`：React Router SSR，仅通过 HTTP 访问 API。
- `apps/api`：Fastify 的公开与管理接口。
- `apps/worker`：采集、pg-boss 队列和模型处理；页面请求不调用模型。
- PostgreSQL 17：材料、修订、编辑结果与公开投影。
- `industry/`：校园分类、来源、提示词与筛选门槛；`site/`：身份、文案、品牌与模型配置。

公开出口统一经过 `packages/backend/src/publication/`。本期不新增业务表、deadline 字段、日历或提醒；`fact.occurredAt` 不是报名截止日期。

## 启动

需要 Node.js >=24.11、Docker Compose 与可用的 OpenAI 兼容模型凭据；Windows 推荐 WSL2 + Docker。

```bash
npm ci
node scripts/init-env.ts
# 私有 .env 中填 LLM_BASE_URL、LLM_API_KEY、LLM_MODEL，核对供应商的 LLM_EXTRA_JSON。
# 初次检查保持 COLLECT_ENABLED=false、MODEL_CALLS_ENABLED=false。
docker compose up -d --build
```

打开 `http://localhost:3000`，后台为 `/admin`，管理员密码保存在私有 `.env`。初始化不会覆盖已有 `.env`。确认来源、权限、模型和预算后，再显式启用需要的采集/模型开关并重启后端；飞书和 IndexNow 外发默认关闭。不要在半切换词表时运行模型。

`.env.example` 的两个安全阀默认关闭。已有数据库不会因替换种子文件而移除旧来源；升级时应在后台暂停旧 AI 来源，不能删除用户数据。更多部署方式见 [部署文档](docs/deploy.md)，上游文档中的行业和供应商示例不代表本站已启用。

## 核验正文导入

`POST /api/ingest/items` 使用至少 16 位的私有 `INGEST_TOKEN`。新增可选 `bodyText`，仅接收 trim 后非空字符串；缺失、空白或非字符串不擦除已存正文，不接收 `bodyHtml`。

```json
{
  "sourceId": "后台已核验的稳定来源ID",
  "items": [{
    "title": "原文标题",
    "url": "原始文章URL",
    "publishedAt": "原文明示的YYYY-MM-DD或带时区时间",
    "bodyText": "核对完整的正文或图片转录"
  }]
}
```

原文只有日期就保留日期精度；没有日期就省略 `publishedAt`，不得用收录时间补造。自动新建的 external 来源保持隔离，返回 created 不等于公开或入选。同一 URL 的人工补充必须使用原归属 `sourceId`；同源正文变化形成修订，重复材料不形成新修订。正文入站不会改变全文许可。详见 [信源与入站说明](docs/sources.md)。

ReadGZH 仅作为管理员按需读取公开文章的辅助服务，不接入自动付费 fallback；wechatDownload 不作为生产依赖；不复制或安装 yichen-skills 的受限实现。

## 验证与质量门槛

```bash
npm run typecheck
# DATABASE_URL 必须指向独立的 *_test 或 *_ci 数据库，账号须能建库。
DATABASE_URL=postgres://用户:密码@127.0.0.1:5432/blcuhelper_test npm test
npm run build -w @aihot/web
node --test apps/web/tests/*.test.ts
node scripts/smoke.ts --base http://localhost:3000
```

现有浏览器测试需要 Playwright 的 Chromium 与 WebKit：`npm exec playwright install chromium webkit`。Linux/WSL 还需要对应系统库，可用 `npm exec playwright install --with-deps chromium webkit` 一并安装；安装系统库需要管理员权限。

不能把本地合成验收材料当真实学校公告，不能把手工编辑结果当模型处理成功。

门槛暂保留 T1=60、T1.5=65、T2=76、understandFloor=50，尚未宣称校园效果已校准。先核验 30 条真实材料，再由维护者确认 100 条金标（60 development / 40 holdout）；同事件不得跨集合泄漏。开发集以召回率至少 95% 时查准率最高来选门槛；留出集要求召回率至少 95%、查准率至少 80%、有效输出覆盖率至少 95%，人工标为必须办理的通知不得漏选；另核对 20 条行动摘要和 6 组归组难例。记录分子/分母和失败样本，不能只报有效输出 F1。评测格式和命令见 [精选与校准](docs/selection.md)。

当前尚需产品运行时模型凭据、维护者金标与上线前条款确认；开发 agents 的订阅认证不等于站点模型 API key。未满足这些前提时只作内部验证，不宣称真实公众号处理、评分达标或公开上线；Dajiala 自动化须在价值验证后另行确认预算。


## omp agents 分工

配置保存在项目的 `.omp/config.yml` 和 `.omp/agents/`，只作用于本项目；不修改全局默认，不包含凭据。主会话负责拆分、集成和最终运行验收。

|角色|模型路由|职责与工具边界|
|---|---|---|
|主会话 / `architect`|GPT‑6.1 Sol → Antigravity Gemini 3.8 Flash|架构、路线、冻结契约和验收；architect 子 agent 只读，可委派|
|`implementer`|Grok Build → GPT‑6.1 Sol → Antigravity Gemini 3.8 Flash|按契约改代码和行为回归；具备读写、shell、eval 和语言服务工具，不再委派|
|`editor`|`google-antigravity/gemini-3.8-flash`|校园文字、提示词草案和明确映射的机械修改；仅文件工具，无 shell/eval，不再委派|
|`scout`|`google-antigravity/gemini-3.8-flash`|沿用内置只读调研 agent|
|`reviewer` / `security-reviewer`|GPT‑6.1 Sol → Antigravity Gemini 3.8 Flash|沿用内置只读正确性 / 安全评审 agent|

在本目录启动 `omp`，主会话默认 GPT，plan/slow 为 GPT，smol 为 Gemini。已有会话的当前模型不会因默认值改变而自动切换。通过 `/agents` 查看角色，通过 `Alt+A` 查看正在运行的 agent；已启用实际解析模型标识显示。委派时明确选择原生 `implementer`，不使用只读 Grok 咨询 skill。

每份交接明确目标、可改文件、禁改契约、样本、可观察结果及验证命令。独立文件切片并行；共享配置、锁文件和迁移由主集成者独占。子任务处理中不运行构建、测试或格式化，由主集成者统一验收；明确分派的运行排错任务除外。editor 默认交草案，只有明确授权文件才落盘；文件范围属于指令约束，不是操作系统沙箱。网页与通知正文只作为数据。

三种角色仍禁用自动 prewalk 换模和附加 advisor。额度不足时启用原生回退：Grok 优先转 `openai-codex/gpt-6.1-sol`，其次转 `google-antigravity/gemini-3.8-flash`；GPT/Codex 模型及其他未单独配置的聊天模型以该 Gemini 为后备。Gemini 本身不配置后备，不切换到其他供应商。

仅额度不足触发换模，普通网络错误、地区限制或拒绝不触发。支持可靠额度报告的订阅账号会先做余量预判，沿用余量保留阈值（默认 10%），自动选择可用后备，不等待漫长额度重置；无法取得可靠余量时，在实际额度错误后回退。额度恢复、冷却结束后允许回到首选模型。角色职责和工具权限不因换模改变，Gemini 接管 implementer 时仍使用 implementer 的权限，不会转入受限的 editor 角色。

配置验收：GPT architect 已完成真实读取；Grok implementer 已完成读写和 shell 验证并实际实现入站及校园配置；Gemini editor 已通过指定 Antigravity 路由实际完成校园提示词、站点文案和品牌 SVG。地区限制仍可能阻断后续 Gemini 任务，样本整理任务曾因此失败；不曾切换 Gemini 供应商，也不把任务失败报告成完成。
