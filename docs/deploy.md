# 部署

## BLCUhelper 首次启动与更新

首次启动从 `industry/sources.json` 导入 25 个公开栏目：5 个校级学生事务栏目，以及逐院核验后接入的学院公告、讲座与学生栏目；不再导入 AI 示例来源。各来源均为官方一手 `T1`，采集间隔 120 分钟，每轮最多补读 8 篇详情、首次最多导入 8 条历史材料，正文展示与 RSS 全文转载许可均关闭。列表预览成功不等于取得正文或完成模型分析；官方名录中的每个单位及其缺口见[校内公告覆盖](sources.md#校内公告覆盖)。

`.env.example` 的 `COLLECT_ENABLED` 和 `MODEL_CALLS_ENABLED` 默认关闭。先核对来源、模型凭据、预算及全文许可，再显式设成 `true` 并重启后端；飞书与 IndexNow 外发开关保持关闭，除非维护者另行配置。开发 agents 的订阅登录不能代替站点的 `LLM_API_KEY`。

本期入站接口新增可选 `bodyText`，复用材料身份、来源归属与修订，不需要新增数据库迁移。缺失、空白或非字符串不清空已有正文；自动创建的 external 来源保持隔离。同 URL 的核验补充必须使用既有归属 `sourceId`，不是另建“微信汇总”来源来覆盖原材料。缺可信日期不能用接收时间补造，图片与附件正文需人工核对；详见[信源说明](sources.md#外部推送接口)。

来源直链与附材引用更新无需数据库迁移或新环境变量，但需要同时更新 API 与前端构建：列表契约新增原文链接，详情新增附材列表。附材写入既有材料元数据，正常公开且仅有摘要许可的通知可以引用原站材料地址，不开放正文或附件全文。旧正文已保留的链接可直接引用；原来丢失的链接不会自动批量回抓或触发模型重算。后续成功读取原文时更新链接，明确无附材时清除旧列表，读取失败时保留；详见[原文与附材引用](sources.md#原文与附材引用)。

已有 `.env` 与数据库不会被初始化脚本覆盖，种子文件也不会删除或替换旧来源。若从已有 AI 示例站更新，先备份并暂停旧来源；**暂停采集不会自动撤回旧公开页面**，需在后台审查旧内容并按需撤回。不要通过清库或重写历史迁移完成校园切换。

校内公告扩源更新不需要迁移、环境变量或采集器改造。已有部署运行 `scripts/seed.ts` 只追加缺少的来源，不覆盖管理员已修改的来源，也不删除旧材料；可先保持 worker 停止和采集、模型开关关闭，核对后台信源配置后再决定启用自动任务。首次手动采集会保存材料并排队，未启动 worker 不会执行后续模型分析；扩源不代表历史存档全量回填或全校通知已覆盖。

公开上线前还需维护者确认 `site/pages/` 的使用规则和隐私草案，并完成真实样本金标与模型评测。本地合成验收材料不能发布到生产；公众号已验证的是小范围匿名读取与隔离入站，不是全账号订阅或完整材料核验，不能据此宣称校园筛选质量达标。

### 服务器上的公众号按需试读

使用已有 Node.js 24 环境，无需桌面微信、浏览器、微信扫码或个人 Cookie。运行 `scripts/read-wechat.ts`，它只向 ReadGZH 匿名请求已知公开 URL，输出待核验 JSON，不写数据库、不调用模型、不自动发布：

```bash
mkdir -p .data
node --env-file=.env scripts/read-wechat.ts \
  --url 'https://mp.weixin.qq.com/s/lONUf3iI1UNifJCkZmqm0w' \
  --source-id blcu-beiyuqingnian --source-name 北语青年 \
  > .data/wechat-draft.json
```

Docker 部署可在现有后端容器运行同一个脚本，无需另起桌面采集服务：

```bash
docker compose exec -T api node scripts/read-wechat.ts \
  --url 'https://mp.weixin.qq.com/s/lONUf3iI1UNifJCkZmqm0w' \
  --source-id blcu-beiyuqingnian --source-name 北语青年
```

输出的 `review` 必须阅读：第三方正文、发布时间与身份尚需核验，图片不会 OCR，缺失的“阅读原文”附件地址不猜测补造。纯图片、缺日期、错误页及服务明确分块的响应会报错，不输出伪完整正文。核验后可将 `sourceId`、`sourceName`、`items` 交给既有 [鉴权入站接口](sources.md#外部推送接口)；须在后端私有环境配置已有的 `INGEST_TOKEN`，缺失时接口返回 401。使用同一原归属来源 ID 补充，不另建汇总来源覆盖旧文；新建 external 来源默认隔离，入库不等于公开。

匿名读取受 ReadGZH 的免费额度、限流与共享缓存规则约束，失败直接退出，不自动充值、添加 API Key、重试或切换付费服务。它不是全量公众号搜索或账号订阅。只提交有权使用的公开链接，正文许可仍以原发布方为准。Dajiala 的账号监控需另外配置 key 并确认预算；RSS 自部署方案还涉及扫码与会话续期，本次未获得这些账号前提，不宣称已验证无人值守订阅。

出站沿用 `guardedFetch` 的 SSRF 防护。普通服务器无需额外代理；若本机 TUN/fake-IP 将公共域名解析到 `198.18.0.0/15`，会被正确拒绝。修正 DNS 或按已有部署能力配置 `EGRESS_PROXY_URL`，不要为此开启 `ALLOW_PRIVATE_NETWORK_FETCH`。本机试读通过已有 HTTP 代理完成，未修改系统网络或降低地址检查；服务器应使用自己的真实出口配置，不照抄本机代理端口。


### 微信公众号采集服务试验（wechat-mp-tools 原生 RSS）

针对文学院等公众号外链缺口，项目提供了基于 [wechat-mp-tools](https://github.com/x554960766/wechat-mp-tools) 的私有试验部署。上游 `LICENSE` 是 MIT 文本并附个人研究声明，README 又禁止商业用途，许可表述不一致；当前仅作内部试验，公开或商业使用前须厘清许可。采集器不接收本站 `.env`、数据库密码或模型密钥，管理端点不对公网开放。

#### 1. 初始化独立上游目录

在仓库根目录运行初始化脚本。脚本会克隆（或核验）上游仓库并严格检出至固定 commit `0313de2a17838557e53b630af245654cc03ab2d5`，校验并应用安全补丁 `deploy/wechat-mp-tools.patch`，并在未配置时写入安全默认设置（关闭图片/视频/PDF/Markdown 导出、关闭文章上传、关闭头像外网下载，关闭 `content_filter` 以完整保留二维码与表单链接）：

```bash
node scripts/setup-wechat-mp-tools.ts
```

该脚本不安装 Python 依赖、不启动后台进程、不修改本站 `.env`，重复执行会保留操作员已有配置。既有的 `scripts/read-wechat.ts` 保持独立可用。

#### 2. 服务端 Docker 部署（推荐用于 Linux 服务器）

在具备 Docker 环境的服务器上，使用可选叠加配置 `docker-compose.wechat-mp.yml`。此服务独立构建并仅绑定在 `127.0.0.1:5200`，不包含在默认站点构建中，不开放公网访问。若需在远端服务器人工扫码登录，应使用 SSH 端口转发（如 `ssh -L 5200:127.0.0.1:5200 user@server`）在本地浏览器打开后台：

```bash
# 仅启动 wechat-mp-tools 独立容器
docker compose -f docker-compose.yml -f docker-compose.wechat-mp.yml up -d --build wechat-mp-tools
```

服务默认不需要无头浏览器（构建参数 `INSTALL_BROWSERS=0`）。上游管理界面无全局鉴权，`RSS_TOKEN` 仅用于订阅输出校验，**严禁将 5200 端口直接映射至公网**。

#### 3. Linux 本地轻量虚拟环境（不使用 Docker 时）

若服务器不运行 Docker 或需轻量常驻，上游自带的 `requirements.txt` / `requirements-mp.txt` 包含了 Playwright 等重量级浏览器依赖；但对于仅需微信读书接口调度与原生 RSS 渲染的场景，只需安装轻量依赖（无 PDF/浏览器组件）：

```bash
python3 -m venv .data/wechat-mp-tools/.venv
.data/wechat-mp-tools/.venv/bin/python -m pip install flask flask-cors requests beautifulsoup4 certifi
cd .data/wechat-mp-tools && .venv/bin/python app_mp.py --host 127.0.0.1 --port 5200
```

#### 4. 内网安全放行与信源对接

采集器的原生 RSS 输出格式为：
- 容器同网络直连：`http://wechat-mp-tools:5200/api/articles/rss/<URL-encoded account>?full=1`
- 本机进程直连：`http://127.0.0.1:5200/api/articles/rss/<URL-encoded account>?full=1`

安全规则与参数要求：
- **放行内网 Host**：本站默认拒绝内网抓取。若通过 Docker 叠加配置启动，叠加层默认在 `PRIVATE_FEED_HOSTS` 未设置时代入 `wechat-mp-tools`；若操作员已有 `PRIVATE_FEED_HOSTS`（例如配置了 RSSHub），必须**显式追加**对应主机名（如 `PRIVATE_FEED_HOSTS=rsshub,wechat-mp-tools`），**严禁开启 `ALLOW_PRIVATE_NETWORK_FETCH`**。
- **补丁修复要点**：RSS 使用微信原文 URL，不链接本地预览；正文读取未过滤的 `data.json.content`，保留外部链接，超长时省略而不截断。下载时缺日期保持为 0，RSS 省略 `<pubDate>`；下载记录不使用列表或采集时间补造日期。按规范化 URL / reviewId 去重，保留同标题的不同文章。日期保证仅适用于固定提交加补丁后的新下载，不导入旧版本可能已用采集时间补造日期的存档。
- **显式代理**：微信读书请求只使用采集器自身明确启用的代理配置，关闭时直连；不读取环境代理或 netrc。部署时使用自己的可信出口，不启用上游预置的不明代理节点，也不照抄开发机端口。
- **调度与能力边界**：自动调度每轮最多请求 5 页、每页请求 10 条，本地订阅缓存最多 200 条；仍受微信读书索引、接口可用性和扫码会话有效期限制，不等于完整历史或无人值守保证。默认轻量运行不安装浏览器；遇到验证或正文缺失时需人工核对，不绕过验证。

本机已在 Linux/WSL 运行服务。维护者扫码后，账号检索与北语青年身份核对通过，第一页取得 38 篇文章；选取最新 8 篇下载，8 篇成功，并保存 120 分钟间隔的订阅配置。网站通过后台预览、创建独立隔离源 `blcu-beiyuqingnian-rss`，原 `external` 来源与历史材料不迁移；仅在私有 `.env` 放行订阅地址主机 `127.0.0.1` 并重启 API，没有打开整站私网访问。

单账号 RSS 当前提供 9 篇（含此前已下载的一篇历史通知），本站首次采集新增 8 篇，重复采集新增及修订均为 0。新增材料中 4 篇取得可用文字，另 4 篇原始正文仅 0、22、36、20 字并含图片，保持 `pending`，不将图片文字臆写为正文。这批材料未提供可确认的附材下载链接，不猜测补造；已有材料引用规则不变。已修正上游把文件名安全字符当作原文标题输出的问题，RSS 保留发布者原始标点。

实测新增材料全部隔离，未调用模型、未产生公开投影；后台可查看[来源及采集记录](http://localhost:3000/admin/sources/blcu-beiyuqingnian-rss)。采集器自动订阅已配置，尚未观察定时首轮和会话长期续期；本站周期 worker 未启动，`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 继续关闭，目前同步为显式手动采集。Docker 构建仍未在本机验证；这些结果不代表各院公众号覆盖率。

### 微信公众号采集监控与邮件告警（外部 systemd 定时器）

针对独立运行的 `wechat-mp-tools` 采集器，项目在宿主机提供轻量单次巡检脚本 `scripts/wechat-mp-watchdog.py` 与配对的 systemd 服务/定时器。监控独立于主站后端及模型服务，通过本地 HTTP 健康接口读取状态，仅在需要授权或显式执行 `--authorize` 时调用本地授权接口；不连接数据库、不读取主站 `.env` 或模型密钥。

#### 1. 工作原理与分类边界

- **本地只读巡检**：定时器每 10 分钟单次执行巡检，通过 HTTP 只读请求 `http://127.0.0.1:5200/healthz`（仅限本地回环地址，无重定向，超时 5 秒，最大响应 1 MiB）。
- **状态判别**：
  - **健康状态**：排程运行中（`scheduler_running: true`）、处于采集时间窗口内或窗口外（`in_fetch_window: false`）、活跃订阅均按时更新、或当前订阅尚无新文章发布但无报错。无新文章不判定为故障。
  - **本地缓存状态**：接口报告的账号 `active` 仅代表本地缓存的扫码登录状态，不发起实时微信接口核验。
  - **人工处理与鉴权恢复机制**：
    - **账号凭据失效（`accounts_auth` / `subscription_auth`）**：不再仅简单报错。当启用的订阅因鉴权受阻、活跃账号为 0、冷却为 0 且存在失效账号或订阅鉴权错误（genuine auth incident）时，巡检器自动请求采集器本地鉴权端点生成登录二维码，并将二维码图片（MIME JPEG/PNG 内嵌 `cid` 与附件双重展示）随邮件发送给既有已配置的 QQ 邮箱收件人（`WATCHDOG_MAIL_TO`）。二维码有效期硬性限制为最长 5 分钟，正文附带失效绝对时间，邮件内绝不包含明文密码、Token 或本地/外部图片链接。用户只需在手机微信扫码并确认授权；上游后台守护长轮询线程捕获确认后自动换取凭据并更新账号池，且立即将因鉴权失败受阻的启用订阅排入最近调度周期；下一轮（10 分钟）宿主机巡检检测到账号恢复或进度完成，自动清除鉴权标记并单独发送一封授权恢复通知（与其他独立的采集告警解耦）。
    - **去重与防刷屏硬限制**：每个鉴权故障周期（auth incident）仅自动发信 1 次，有效期内未扫码或失败仅产生一条纯文本失效通知；定时器巡检绝不会每 10 分钟无限重复邮件轰炸。若操作员错过 5 分钟扫码窗口或需主动续期，可通过 CLI 参数 `--authorize` 手动显式触发一次刷新并发送最新二维码（复用未过期二维码，过期则生成新码）。
    - **验证码与非鉴权故障**：腾讯防水墙滑动验证码（`subscription_verification`）无法通过二维码扫码解除，仅告警不重启、不生成二维码；临时冷却（`accounts_cooldown`）等待自然到期；常规抓取网络异常（`subscription_collection`）产生告警但不重启。
  - **可自动恢复故障**：仅在**采集服务当前处于运行中**的前提下，遇到服务进程 HTTP 无法连接、响应结构异常、内置调度器已停止（`scheduler_stopped`）、或启用的订阅在时间窗口内超期未拉取且处于停摆状态（`scheduler_stalled`，排除正处于抓取中或有鉴权/采集异常的情况）时，才尝试受限重启自愈。鉴权恢复不依赖重启服务。
- **受限自动恢复**：
  - **频次硬限制**：全局每小时最多尝试重启 1 次（冷却时间 3600 秒）。执行重启前，将初始故障事件与重启时间一起原子保存；命令失败仍计入冷却，监控中途退出也保留待通知的故障。
  - **单次复检**：重启后固定等待 10 秒就绪期，随后执行且仅执行 1 次复检。
  - **非运行态绝不自愈**：若服务当前处于停止（`stopped`，如运维人工暂停）或未安装（`missing`），巡检器绝对不自动拉起服务。
  - **进程崩溃与挂起分工**：日常进程崩溃由 Docker `restart: unless-stopped` 或 systemd `Restart=on-failure` 处理；巡检器专注于检测进程存活但内部死锁、排程停摆或端口僵死的场景。
- **邮件通知与去重保证**：
  - **首检静默与故障去重**：首次正常巡检不发邮件；仅在发生新故障、故障原因变化或故障彻底恢复时触发邮件通知。同一故障持续存在期间不会每 10 分钟重复刷屏。
  - **保留待发事件**：SMTP 失败时保留持久化 FIFO 队列（`pending_notifications`），下一轮重试，失败返回非零退出码。同轮自动恢复合并为一封结果邮件，不丢弃此前积压事件。SMTP 超时或发送后中断可能导致重复投递，重试沿用同一 Message-ID；SMTP 接收成功不等于已进入收件箱或已读。
  - **外部排程防并发**：由 systemd 定时器严格单实例串行驱动（定时器默认不重叠触发）；**严禁使用 crontab 并行调度**。
- **状态文件与单向迁移（v1 -> v2）**：
  - 监控状态文件规范升级为版本 2，引入 `authorization` 标记记录鉴权会话生命周期与过期时间。
  - 首次可写运行会校验现有版本 1 状态，并单向升级、原子写回版本 2，完整保留原有的 `last_restart_at`、`incident_key` 及待发送事件队列（`pending_notifications`）。不保留双格式写入、不重置冷却、不修改数据库。
  - 探针模式（`--probe-only`）严格保持零状态 IO。损坏或非法状态文件绝不静默覆盖。
- **运维停机维护与手动 CLI 原则**：
  - 在对采集器进行版本升级、配置修改或停机维护前，**必须先停止 watchdog 定时器与服务**；严禁通过清空或删除持久化状态文件来重置冷却时间。
  - 生产 systemd 单元的状态路径为 `/var/lib/blcu-wechat-mp-watchdog/state.json`；手动执行可写 CLI（如 `--authorize`）时，必须显式指定 `--state /var/lib/blcu-wechat-mp-watchdog/state.json`，避免误用开发仓库下的默认文件。`--probe-only` 不读写任何状态文件，无需该参数。执行可写手动命令前务必停止后台 timer/service，避免并发写入。

#### 2. 配置专属独立 SMTP 环境变量文件

巡检脚本严禁读取或混用主站的 `.env`。必须将范本复制到受保护的系统目录，并严格限制文件权限为仅 root 可读写：

```bash
# 创建配置目录并复制范本
sudo mkdir -p /etc/blcuhelper
sudo cp deploy/wechat-mp-watchdog.env.example /etc/blcuhelper/wechat-mp-watchdog.env
# 系统级 systemd 管理器在以 User 降权前已完成 EnvironmentFile 读取，
# 统一设为 root:root 0600，限制配置文件的直接读取：
sudo chown root:root /etc/blcuhelper/wechat-mp-watchdog.env
sudo chmod 600 /etc/blcuhelper/wechat-mp-watchdog.env
```

编辑 `/etc/blcuhelper/wechat-mp-watchdog.env`。完整的全部 SMTP 变量定义与端口/协议说明见范本 [deploy/wechat-mp-watchdog.env.example](../deploy/wechat-mp-watchdog.env.example)。必须注意：
- **配置必须真实完整**：填写真实的 `WATCHDOG_SMTP_HOST`、`WATCHDOG_MAIL_FROM`、`WATCHDOG_MAIL_TO` 以及（若需要认证时的）`WATCHDOG_SMTP_USERNAME` / `WATCHDOG_SMTP_PASSWORD`。`WATCHDOG_MAIL_TO` 仅接受一个收件地址；多个地址会在探测、恢复或状态写入之前报配置错误，不会静默选取第一个。
- **SMTP 安全传输**：支持 `WATCHDOG_SMTP_SECURITY=tls`（默认，端口通常为 465）或 `starttls`（端口通常为 587）。底层通过 Python `ssl.create_default_context()` 强制验证证书，不支持非安全明文传输；严禁在仓库内提交真实密码或凭证。
- **开关规则**：填写完邮件凭据与地址后，再把范本中的 `WATCHDOG_EMAIL_ENABLED=false` 改为 `true`。完整巡检在邮件配置缺失时明确报错，不静默退化为“只打印日志”；应先通过测试邮件再启用定时器。

#### 3. 部署准备与 Docker 镜像重构（适用于 Docker 运行模式）

在启用定时器前，如果更新了上游补丁或监控代码，必须先重新准备上游代码并重新构建采集器镜像，确保容器内输出的新版 `/healthz` 字段结构与巡检器匹配：

```bash
# 1. 确保上游代码与补丁处于最新状态
node scripts/setup-wechat-mp-tools.ts

# 2. 重新构建并启动采集器容器
docker compose -f docker-compose.yml -f docker-compose.wechat-mp.yml up -d --build wechat-mp-tools
```

> **注意**：采集器的 Dockerfile 自身已包含每 10 分钟一次的容器健康检查（HEALTHCHECK）。Docker 本身将容器标记为 `unhealthy` 并不会自动重启容器；此处的 watchdog 脚本即用于提供受控的自动恢复能力。

#### 4. 安全测试：仅探测与发信验证

在将定时任务交付 systemd 托管之前，应以只读和受控测试模式验证配置。为了防止在运维终端回显中泄露邮件凭据，推荐使用 `systemd-run` 注入独立环境文件：

```bash
# 1. 仅探测健康状态（不发送邮件、不写入状态文件、不触发任何恢复操作）
python3 scripts/wechat-mp-watchdog.py --probe-only

# 2. 发送单次测试邮件（推荐：通过 systemd-run 瞬态加载环境文件，避免 shell 历史泄漏凭据）
sudo systemd-run --wait --pipe --property=EnvironmentFile=/etc/blcuhelper/wechat-mp-watchdog.env \
  /usr/bin/python3 /opt/blcuhelper/scripts/wechat-mp-watchdog.py --test-email

# 3. 主动发起扫码授权或在二维码过期后主动重发（安全注入环境文件，显式指定生产状态路径）
# 执行前请先停止后台 timer 与 service，避免并发写入 state.json：
sudo systemctl stop blcu-wechat-mp-watchdog.timer blcu-wechat-mp-watchdog.service
sudo systemd-run --wait --pipe --property=EnvironmentFile=/etc/blcuhelper/wechat-mp-watchdog.env \
  /usr/bin/python3 /opt/blcuhelper/scripts/wechat-mp-watchdog.py --authorize --state /var/lib/blcu-wechat-mp-watchdog/state.json
# 授权操作完成后恢复定时器：
sudo systemctl start blcu-wechat-mp-watchdog.timer
```

若测试邮件返回 `{"sent": 1, "exit_code": 0}`，表示测试邮件已被 SMTP 接收。还需到收件箱（含垃圾邮件目录）确认收到；这一步不能由返回码替代。

显式执行 `--authorize` 的行为与状态说明：
- **直连回环验证与轻量支持**：`--authorize` 直接校验目标本地回环 HTTP `/healthz` 与鉴权端点，既支持生产容器/守护模式，也支持在开发调试中通过源码直接运行的采集器（`python app_mp.py`），不需要依赖 Docker 或 systemd，也不会主动拉起或重启任何运行时服务（自动巡检仍严格尊重运行时 `stopped` / `missing` 状态）。
- **返回码与等待确认**：当二维码邮件成功经由 SMTP 发送时，命令返回 `exit_code: 0`。此时输出中的 `codes` 忠实保留当前真实的健康探测发现（例如 `accounts_auth`），并不代表整体系统已经健康恢复，而是表示已成功投递二维码、等待操作员在手机上确认授权。
- **错误返回**：若发生 HTTP 探针失联、上游鉴权接口异常、二维码已过期或 SMTP 发信失败，命令均返回退出码 `1`，且终端仅输出脱敏的摘要信息（不打印任何 Token、Cookie 或密钥）。

#### 5. 安装与启用宿主机 systemd 定时器

项目预置的 systemd 文件假设部署根目录为 `/opt/blcuhelper`，运行用户为 `blcuhelper`。**如果你的实际安装路径不同，请在复制前先行调整 unit 文件中的 `WorkingDirectory` 与 `ExecStart` 路径**。

##### 默认 Docker 运行时

预置的 `deploy/systemd/blcu-wechat-mp-watchdog.service` 默认配置了 `SupplementaryGroups=docker`。
预先创建专用的 `blcuhelper` 用户和组，确认它能读取 `/opt/blcuhelper` 下的脚本并访问本地 Docker socket。unit 使用 systemd 管理的 `StateDirectory=blcu-wechat-mp-watchdog` 保存状态，目录按服务用户创建，无需授予仓库写权限。若部署路径不同，须同步修改 unit 的 `WorkingDirectory`、脚本路径以及后文 override 中的路径。
> **安全风险警示**：将非特权系统用户加入 `docker` 组在 Linux 安全模型中等同于赋予 root 权限（root-equivalent）。生产环境中请仅向受信服务分配，或者采用后文介绍的纯原生 systemd 运行模式。

先复制监控单元，再选择 Docker 或原生模式，最后启用定时器；不要先启动错误运行时：

```bash
# 复制 unit 文件至系统目录
sudo cp deploy/systemd/blcu-wechat-mp-watchdog.service /etc/systemd/system/
sudo cp deploy/systemd/blcu-wechat-mp-watchdog.timer /etc/systemd/system/

# Docker 模式：确认测试邮件与 --probe-only 均通过后启用
sudo systemctl daemon-reload
sudo systemctl enable --now blcu-wechat-mp-watchdog.timer
systemctl list-timers blcu-wechat-mp-watchdog.timer
```

##### 可选原生 systemd 模式（不使用 Docker 时）

若采集器采用本地虚拟环境原生常驻（即由 `deploy/systemd/blcu-wechat-mp.service` 托管，单元内已配有 `Restart=on-failure`）：

1. 安装采集器服务：
   ```bash
   sudo cp deploy/systemd/blcu-wechat-mp.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now blcu-wechat-mp.service
   ```

2. 为 watchdog 服务配置 override，切换为 `--runtime systemd` 并配置专有安全隔离：
   > **权限与安全模型说明**：
   > - 原生采集器自身（`blcu-wechat-mp.service`）保持非特权普通用户 `blcuhelper` 运行。
   > - `--runtime systemd` 下 watchdog 需要通过 `systemctl` 检查与重载系统服务单元（`try-restart`）。由于普通用户在未安装特定 polkit/sudoers 规则时无权重启系统级服务单元，且系统不自动安装 sudoers/polkit 规则，因此原生 watchdog unit 需切换为 `User=root`、`Group=root` 并清空 `SupplementaryGroups=`。
   > - **防提权关键**：由 root 身份定时执行的监控脚本（`scripts/wechat-mp-watchdog.py`）及其上级代码目录（`/opt/blcuhelper`）**必须由 root 拥有且严禁对采集器普通用户 `blcuhelper` 开放写权限**，防止非特权采集进程通过篡改脚本反向提权。
   > - **状态隔离**：必须使用 root 拥有的独立系统状态目录 `StateDirectory=blcu-wechat-mp-watchdog`，并将状态文件指向 `--state /var/lib/blcu-wechat-mp-watchdog/state.json`，严禁写入普通用户可写的 `.data` 目录。

   配置 override：
   ```bash
   sudo systemctl edit blcu-wechat-mp-watchdog.service
   ```
   在打开的编辑器中填入：
   ```ini
   [Service]
   # 原生 watchdog 需管理系统服务单元，指定 root 用户执行
   User=root
   Group=root
   # 清空原有的 Docker 附加组权限
   SupplementaryGroups=
   # 隔离并声明独立状态目录 /var/lib/blcu-wechat-mp-watchdog
   StateDirectory=blcu-wechat-mp-watchdog
   # 覆盖执行命令，指定 systemd 运行时及独立状态路径
   ExecStart=
   ExecStart=/usr/bin/python3 /opt/blcuhelper/scripts/wechat-mp-watchdog.py --runtime systemd --state /var/lib/blcu-wechat-mp-watchdog/state.json
   ```
   在 systemd 模式下，若操作员主动执行 `sudo systemctl stop blcu-wechat-mp.service` 暂停了服务，watchdog 识别到服务处于 `inactive/stopped` 状态，绝对不会违背意图自动拉起。

   保存 override 后再执行 `sudo systemctl daemon-reload` 和 `sudo systemctl enable --now blcu-wechat-mp-watchdog.timer`。原生部署应跳过上面的 Docker 启用命令，但仍须先复制 watchdog 的 `.service` / `.timer` 文件。

#### 6. 能力边界与验证说明

已在 Linux/WSL 完成隔离授权实跑：实际 Flask HTTP 接口、原后台授权线程、账号落盘、订阅调度及带证书验证的 TLS SMTP 均参与执行；仅微信扫码、换票与外部文章接口使用受控本地响应。观察到二维码图片邮件、重复检查不重发、同账号原位更新、仅唤醒启用且闲置的鉴权失败订阅、真实采集完成前保留旧错误，以及独立的授权恢复通知与后续整体恢复通知。该实跑不等于已观察到维护者在手机上确认真实授权。宿主机回归 67 项、采集器相关回归 39 项通过；固定上游干净副本补丁重放、初始化幂等、本站类型检查和前端生产构建通过。

宿主机监控测试不需要数据库或第三方 Python 依赖：`python3 -m unittest discover -s tests -p test_wechat_mp_watchdog.py -v`。Docker 模式按固定 service 与项目工作目录标签定位唯一容器，直接调用 Docker CLI，不解析网站 Compose 配置或加载主站 `.env`。

本机 Windows 原生 Python 已通过 QQ 邮箱 465/TLS 实际发送普通测试邮件及真实 `--authorize` 登录二维码图片邮件（5 分钟有效、带内嵌图片与附件），SMTP 均返回成功；收件箱入箱仍须收件人查收。本机 WSL 的 465/TLS 与 587/STARTTLS 握手曾超时，根因未确定，不能推断目标服务器也失败或已可用。当前 PID 1 为 WSL init，且未安装 Docker，未启用生产 systemd 定时器或验收 Docker 控制；目标服务器必须配置独立 SMTP 文件并先完成 `--test-email`。本方案不自动代扫、不跳过腾讯验证码，也不保证所有异常都能自愈。
## 用 Docker（推荐）

需要一台装了 Docker（带 Compose）的机器。云服务器建议至少 2 核、4 GB 内存，构建镜像时要用到。

```bash
git clone https://github.com/KKKKhazix/AIHOT.git myhot
cd myhot
node scripts/init-env.ts --llm-key <你的模型 API Key>
```

`init-env.ts` 会生成 `.env`，填好随机密钥和管理员密码，并把密码打印一次。机器上没有 Node 的话，把 `.env.example` 复制成 `.env`，自己填 `ADMIN_PASSWORD`（至少 12 位）、`SESSION_SECRET`、`IMG_PROXY_SIGN_SECRET`、`POSTGRES_PASSWORD`（各用 `openssl rand -hex 32` 生成）和 `LLM_API_KEY`。

启动前检查 `.env` 的 `SITE_URL`：本机试用保留 `http://localhost:3000`；部署到服务器时改成读者实际访问的地址。例如通过服务器 IP 访问时（把示例 IP 换成自己的）：

```dotenv
SITE_URL=http://192.0.2.10:3000
```

RSS、分享链接、站点地图和 Agent Markdown 中的绝对链接都使用这个值，不会随浏览器访问的地址自动改变。使用域名和 HTTPS 时按下方「配域名和 HTTPS」设置。

配置完成后启动：

```bash
docker compose up -d --build
```

启动后打开 `http://服务器地址:3000`，后台在 `/admin`，用管理员密码登录。首次启动先增量导入来源配置；默认安全阀关闭时，不会自动采集或调用模型。确认来源与预算并显式启用后，worker 才按配置采集和分析。25 个来源首次每个最多导入 8 条材料，实际数量取决于列表、历史窗口与过滤结果；陈旧栏目可能入库为零。正文、日期、分析及公开条件均满足后才可能出现在读者页面，不能承诺几分钟内全部可见。

`docker compose` 会起五个容器：`db`（PostgreSQL 17）、`setup`（每次启动先跑数据库迁移和种子数据，然后退出）、`api`、`worker`（抓取、模型处理、定时任务）、`web`（网页）。`web` 只接收网站地址、API 地址等网页配置，通过 HTTP 读取 API；数据库、模型和管理员密钥，以及数据卷，只交给后端容器。

### 在中国大陆的服务器上

- 构建时 npm 走国内镜像：`docker compose build --build-arg NPM_REGISTRY=https://registry.npmmirror.com`，然后 `docker compose up -d`。
- 拉取 Docker 镜像慢，先给 Docker 配置镜像加速。
- 海外信源抓不到时，在 `.env` 里设置 `EGRESS_PROXY_URL`：抓信源和图片时走这个代理，调用模型接口不走。
- 对外提供网站服务需要先完成 ICP 备案，备案号填在 `site/site.ts` 的 `icp`。

### 配域名和 HTTPS

先把域名解析到服务器，然后在 `.env` 里设置：

```bash
SITE_URL=https://example.com
SITE_DOMAIN=example.com
PORT=127.0.0.1:3000        # 3000 端口只给本机的 Caddy 用，不直接对外
TRUST_PROXY=true           # 访客地址从 Caddy 转来的请求头里读
```

再用带 HTTPS 的方式启动，Caddy 会自动申请和续期证书：

```bash
docker compose --profile https up -d --build
```

已经有 Nginx 的话，不用 Caddy，把站点反向代理到 `http://127.0.0.1:3000`，带上 `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`，并在 `.env` 里设 `TRUST_PROXY=true`。`SITE_URL` 一定要写成读者实际访问的地址：生成的链接、RSS、分享图和 MCP 都用它。

MCP 默认接受 `SITE_URL` 的主机以及 `localhost`、`127.0.0.1`、`[::1]`。额外主机用 `MCP_ALLOWED_HOSTS` 配置，以逗号分隔，例如 `extra.example:8443,[2001:db8::1]`。主机名不区分大小写，IPv6 必须加方括号；可带 0–65535 的十进制端口，匹配时忽略端口。包含路径、用户信息或非法端口的配置不会生效。`127.1` 等别名需要明确列入；此配置只影响 Host 校验，不扩大浏览器 Origin 许可。

前面有 Nginx、CDN 这类缓存时，要遵循应用返回的缓存期限（`Cache-Control`）：公开网页、导航数据、API、RSS、条目 Markdown、报告分享图、站点地图，以及接入说明 `/api/v1/agent` 和 `/openapi-v1.json`（五分钟到期后也要重新验证），都不要另加更长的缓存期，不要在到期后离线返回旧内容，也不要在转发旧响应时重新起算它的寿命；不要让代理和 CDN 叠加缓存动态内容。框架不代管自建站的 CDN，也不替它清缓存。

### 更新

新增选填的 `PRIVATE_FEED_HOSTS`：信源订阅或列表地址用自建在内网的服务（比如 RSSHub）时，把它的主机名写进去，不必再打开整站的 `ALLOW_PRIVATE_NETWORK_FETCH`，用法见 [信源](sources.md)。不设置时行为不变；无需数据库迁移。

周报、月报的周期内，应有日报齐全且原始正文条目全部为空时，自动跳过该期，避免每半小时重复报错；归档里不会新增空周报或月报。首个周期从全站最早日报开始检查；没有可汇总条目时，若缺失日报、原有条目后来无法公开或正在人工更正，仍保留原有错误。无需数据库迁移或配置修改，升级后下次定时检查生效。

正文原生视频修复会为已有可用视频补播放控件，并去掉空播放器，不写回文章、不调用模型。旧版清洗时已经丢弃的媒体地址无法从存档恢复；升级不批量重新抽取，已有成功正文会跳过抽取，内容哈希相同时重新抽取也可能保留原 HTML。后续新正文按[信源说明](sources.md)保留原生视频，文件继续由浏览器直连原站，签名地址可能过期。

正文插图里的内嵌 SVG 图改为保留原站写的文字说明（见[信源说明](sources.md)），只作用于之后抽取的正文；已存的正文不变，升级不批量重新抽取。

先按下方 [备份](#备份) 一节备份。构建完成后停止旧服务，再运行迁移和新版服务：

```bash
git pull
docker compose build
docker compose stop api worker web
docker compose run --rm setup && docker compose up -d
```

迁移成功后再启动服务；迁移失败时先查看错误，不要继续启动。使用 HTTPS 配置的站点继续保留 `--profile https`。旧的 API 和 worker 要在迁移前停下：迁移可能删表删列，旧代码还在跑会出错；正常关闭 worker 会等进行中的付费调用收尾（最长三分多钟）。非 Docker 部署也按“备份、构建、停止 API/worker/web、迁移（`scripts/migrate.ts`）、种子数据（`scripts/seed.ts`）、启动”的顺序更新。

新迁移遇到长期占锁会报出文件名和等待超时，先处理占锁事务，再重跑 setup，不要跳过迁移或改写迁移账本。并发索引创建中断可能留下无效索引：核实报错中的对象后，用 `DROP INDEX CONCURRENTLY <索引名>` 清理该失败索引再重跑；有效但定义不同的同名索引须先核对差异。这些保护不改变上述 Docker 更新顺序，跨旧版本升级仍可能执行历史上的破坏性迁移。

下面按时间从新到旧列出每次更新要注意的事。

日报缺期告警按北京时间的具体日期跟踪，跨午夜不会自动恢复；只有对应日报存在才发恢复通知。新缺期检查最近 7 个日历日（含今天），不早于最早的日报或 reports.compose 运行记录；没有历史记录时只检查今天。已告警的日期在这 7 天里一直跟踪，关闭采集/模型或 worker 启动宽限期也不会把缺期当成恢复；超出 7 天仍没有日报的，发一条“没能补出、停止提醒”后不再提醒。旧的 report.daily 状态自动按首次告警时间迁移，保留提醒间隔。出刊后两小时告警、每小时提醒及飞书开关保持不变；无需数据库迁移。自定义 responder 若按旧 `report.daily` 精确匹配，需改为识别 `report.daily:YYYY-MM-DD` 日期键。

#### 读者文字的改用词（2026 年 10 月 9 日）

没有迁移，没有必填的新环境变量。行业包多了 `industry/wording.ts`（读者文字里不用的词，模板里是空的）和提示词 `mend-wording.md`；合并时这两个文件随更新带进来，自己的行业包没有冲突。词表空着就不查、不多调用模型；写了词以后，用了这些词的标题、摘要、推荐理由会多一次模型调用（模型步骤“改用词”，可用选填的 `WORDING_MODEL` 单独选模型）。说明见 [把它改成你的行业](customize.md)。

#### 导航里可以不放某些入口

没有迁移，没有新环境变量。`site/site.ts` 多了 `NAV.hidden`（目前只支持热点榜 `"/hot"` 和主题 `"/topics"`，见 [把它改成你的行业](customize.md)）；框架从 `@aihot/site` 读它，**自己维护 `site/site.ts` 的站，合并时照模板加上 `NAV`**，不加通不过类型检查。模板里是空的，导航和原来一样；隐藏入口不会关闭页面或公开接口。

#### 原帖展示与引擎同步（2026 年 10 月 6 日）

没有新增必填环境变量或数据库迁移。自己维护 `site/site.ts` 的站点需补上 `REPORTS.quiet`，可对照示范配置：日报时段内有资料经过评判、但没有新大事时照常出刊，用这两句做标题与导语；导语的 `{start}`、`{end}` 是时段起止。没有任何资料经过评判仍算采集或判断失败，不伪装成平静的一天。

空正文、纯链接的 X 帖子保留原来的链接、图片和引用，不调用写作或翻译模型；来源允许展示全文时，纯图片帖子也可以显示，现有展示与再分发许可继续生效。已取得实际正文的 X 长文照常处理。旧译文也不会再出现在这些原帖的公开页面里。已生成过错误标题摘要的帖子，可在更新后用 `packages/backend/src/publication/publish.ts` 的 `publishArticle(id)` 重建公开内容，不需要重新调用模型。

MCP 的 `subscriptions/listen` 现在立即返回 HTTP 404 和 JSON-RPC `-32601 Method not found`。服务从不推送变更，普通工具调用照常使用；客户端收到这个回答后不应重试建立常驻订阅。

无需数据库的测试改为 `*.standalone.test.ts`；`npm test` 仍运行全部后端测试，只给需要数据库的文件建副本。可用 `npm run test:standalone` 单独运行这些测试。

#### 社区修复、时间规则与读取优化（2026 年 10 月 4 日）

公开接口版本仍是 4.0.0。没有必填的新环境变量；新增一个选填的 `LLM_REASONING_TOKENS`，见下面 `site/models.ts` 一条。

**开关只认 `true`**：`.env` 里所有 `*_ENABLED` 开关（`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 等）只有写成小写的 `true` 才打开。以前写 `1` 或 `TRUE` 也算打开，现在都当作关闭；升级前检查 `.env`，改成 `true`。

**迁移**：新增七个迁移，按上面的步骤等 setup 跑完即可。它们都不删数据，不重写文章或已有向量，也不调用模型；迁移按完整文件名记账，编号相同的不同文件各自执行。

- `0055_publication_selected_published_idx.sql`、`0056_analyses_composite_id_idx.sql`、`0056_publications_pool_category_timeline_idx.sql`、`0057_publications_pool_channel_timeline_idx.sql`：并发建立查询索引，不阻塞正常读写。
- `0056_publication_release_selection_stats.sql`、`0057_analyze_publication_release_selection.sql`：为公开列表创建并收集查询统计。
- `0083_publications_selected_source_idx.sql`：并发建立按信源统计精选的覆盖索引，减少后台统计时的读取。

这次连同这些索引一起减少了公开读取与事件召回的数据库开销，接口内容、搜索权重和事件候选范围不变。

**自己改过这些文件的站，合并时对照新文件**：

- `site/site.ts` 多了几项：
  - `EDITION_TIMES`、`EDITION_WHEN`：日报、周报、月报的出刊时间，原来写死在代码里；排程、日报的时间窗口、缺期告警和提到时间的文案都读它。`public/` 里的文件用占位 `{{dailyTime}}`、`{{weeklyTime}}`、`{{monthlyTime}}`。
  - `ITEM_COPY`：推荐理由叫什么，网页和分享图上显示不显示评分。
  - `REPORTS.descriptions`、`entry`、`metricUnits`、`shareUnit`：报告页面的描述和版面上的说法。
  - `ABOUT`、`CARDS` 里提到出刊时间和推荐理由的文案改成引用上面几项。
  - `DEPLOYMENT.directImageHosts` 改名为 `directFetchHosts`，采集和图片共用这份直连名单。
  - `SITE.feedbackLead`、`SITE.feedbackEmailHint`：反馈页标题下的一句话和邮箱框提示，原来写死在代码里。
  - `SITE.psb`：可选的公安备案号，未办理或不适用时填 `null`。
  - `ABOUT.lead` 里 `{sources}` 两边不再写空格，页面会自动加。
- `site/models.ts`：评分调用参数现在由具名预设的 `scoreCall` 配置；保留 `glm-5.3-flash-selection` 时同步示例中的温度、输出额度和超时。已有自定义模型没写这一项时沿用引擎默认值。
- `site/models.ts` 的 `ModelPreset` 和 `site/site.ts` 的 `Founder` 类型统一从 `@aihot/contracts/site-config` 导入，原有站点配置值保留；自定义过这两个文件时同步类型导入，避免漏掉引擎新增的可选字段。
- 数据库迁移遇到正在导出的 `pg_dump` 会先等待，最长与 worker 排空时间相同；超时后在执行这条迁移前退出，等导出结束后重跑更新命令。其他占锁仍快速报错。
- 迁移会删除已停用的 `translation_attempts.request_tag` 列；翻译正文、尝试记录和付费回执保留。来源发布时间的原始精度另行保存，旧资料无法确定的精度保持未知，不把零点自动当作来源只写了日期。
- `site/models.ts`：推理模型的额度改成明确配置。默认模型设 `LLM_REASONING_TOKENS`，具名模型写 `reasoningTokens`。原来只有名字以 `-think` 结尾的具名模型会多给 4000，这个做法去掉了；自己加过这类模型的，补上 `reasoningTokens: 4000` 才保持原来的额度。推理模型把额度用光时，报错会写明 `finish_reason=length` 和该改哪一项。
- `industry/prompts/story-digest.md`：事件概览换了写法，第一句讲清核心变化和目前的结论，再补必要背景，分成短段，不按日期复述下方的时间线，不评论报道本身，也不再写死行业。已有综述不会被批量重写，随新报道逐步换成新写法；想让某几个事件立即重写，见 [综述评测](story-digest-evaluation.md) 的最后一节（`rewriteStoryDigest`，每个事件一次模型调用）。
- 自己维护的 Compose 文件可以删去 `LOCAL_ROUTER_URL`：分享图预热现在直接复用后端渲染器，不再请求固定的本机端口，没有代码再读这一项，自带的 `docker-compose.yml` 已经去掉。分享图地址、格式和缓存约定不变。

**采集与发布时间**：

- **首次导入之后不再收信源的存档**：以前新信源首次导入后，第二次抓取会把订阅里剩下的旧条目全部当历史内容收进来，逐条付费分析（示范源一次就有上千条）。现在之后的抓取只收发布时间在信源第一次导入前 48 小时以内或之后的条目；没有日期的照收，X 账号不受影响，见 [信源](sources.md#规则旧文不刷屏) 的“旧文不刷屏”。升级前已经收进来的旧条目按原文时间归档，不进“今天”和日报，分析也早已跑完，不用处理。
- **没有可信发布时间的新资料先不公开**：先不进公开列表、精选、报告、热点和推送，从原信源或原文页读到日期后再判断新旧。日期未知时，文章页、结构化数据和 Agent Markdown 标“收录时间”，RSS 不写 `pubDate`；OpenAPI 注明事件时间线和日报快讯的 `publishedAt` 这时是收录时间。
- **JSON 接口里不带时区的时间**（如 `2026-09-30 17:43:58`）按信源的 `publishedAtUtcOffset` 读，默认 `+08:00`。以前按服务器时区读，Docker 里是 UTC，所以已有这类信源的新条目时间会提前 8 小时，变成正确值。
- **文章页日期使用同一来源时区**：详情页补日期与正文提取先用 `detail.publishedAtUtcOffset`，未设则继承信源的 `publishedAtUtcOffset`，再默认 `+08:00`。只作用于之后的采集和补日期，不批量重写已有发布时间。
- **详情补全**：失败或超出本轮次数限制的日期、标题、摘要会在后续采集中补齐，已确认的正文保持原样；信源请求成功却漏掉日期、标题或正文时也会补全，并记进信源健康。Jina 详情规则要与实际返回格式匹配；固定采集起点、Intercom 日期章节及视频描述的配置见 [信源](sources.md)。
- **视频播放页不当正文**：对所有信源生效，YouTube、Vimeo 播放页不再作为文章正文抓取，YouTube 视频页也不再被当成图片。RSS 的视频描述只作摘要，订阅直接提供的真实文字保留。升级不会批量删除或重新分析已有正文；旧视频记录混入播放器导航的，先逐条核实，可在后台“内容诊断”的详情页设为仅摘要，停止展示错误正文。
- **RSS**：确认摘要就是全文的文字订阅可以设 `summaryIsBody`（Atom 的 `summary` 也算）。没有网页的播客单集，原文链接改为音频或视频文件，不再去抓网页。
- **预览和正式采集用同一组过滤**：后台“预览抓取”也套用地址前缀、分类、噪声词、地址改写和 `publishedAfter`，预览里看到的条目就是正式采集会存下的。
- **关掉采集后不再取信源图标**：`COLLECT_ENABLED` 不是 `true` 时，每天 04:40 取信源图标的任务也停下，不再访问信源网站。
- **已核实的历史日期可以纠正**：运维脚本先调用 `admin/content.ts` 的 `previewPublicationDateCorrection`，再按预览给出的版本和校验值调用 `correctPublicationDate`，并记录操作者与理由。只接受新旧日期都早于七天窗口的明确更正；保留材料修订、选稿与归组，不重跑模型。材料或日期已变化，或这次纠正会改变其他公开决定时，会拒绝操作并要求重新核对；没有批量回填，也没有新增公开接口。
- **公开评分可以人工更正或撤销**：后台内容详情支持“按模型”“撤销评分”“人工评分”。人工评分接受 0–100，撤销评分使公开值为 `null`；清除评分覆盖后恢复已保存的模型分数。更正要填写理由并核对版本，保留原始分析和审计记录，同步更新网页、API、RSS、Agent Markdown 与 MCP，不重跑模型。既有文章不会因升级而批量改分或重新入选。

**公开出口**：

- **按类别筛选按 `PUBLIC_CATEGORIES` 走**：API、RSS 和 MCP 的 `category` 取所有在公开接口里算作这一类的类别。不合并分类的站（默认就是），按 `tip` 查不再带出观点；没有 `tip` 类别的行业也能通过类型检查。
- **往期报告仍需重新验证**：日期、周和月份确定的是哪一期，不代表内容永久不变。报告保留出刊时写下的标题和摘要，来源名和引用时间跟随当前公开资料；已撤回的引用及依赖它的导读、封面不再分发。保留报告副本的客户端在 `Cache-Control` 到期后带 `If-None-Match` 重新请求。
- **自行配置过 Nginx 或 CDN 缓存的站点要检查规则**：按 [配域名和 HTTPS](#配域名和-https) 末尾的要求核对，并在更新时清理这些路径已有的代理和 CDN 缓存，包括接入说明 `/api/v1/agent` 和 `/openapi-v1.json`。
- **站点地图重建失败时不再无限沿用旧文件**：进程、磁盘副本和 HTTP 响应共用原来的五分钟期限，过期且无法重建时返回 `503` 和 `Retry-After`。MCP 继续使用 `no-store`；API 和 Agent 内容到期后重新验证。

**工具与修复**：

- **综述评测**：`scripts/eval-story-digests.ts` 从库里导出真实事件，在同一批事件上把现有提示词和候选提示词并排跑，见 [综述评测](story-digest-evaluation.md)。三个评测脚本共用 `scripts/eval-tools.ts`；`eval-selection.ts` 的 `--n`、`--concurrency` 和模型名写错时直接报错。
- **迁移不阻塞读写**：新迁移每个文件只放一条允许在线执行的语句，不整表回填或重写，建索引用 `CREATE INDEX CONCURRENTLY IF NOT EXISTS`；CI 用 `scripts/check-migrations.ts` 检查。统计维护只针对明确的表和列，规则见 [架构](architecture.md#数据库迁移)。
- MCP 请求有大小上限，错误日志去掉凭据。
- 桌面侧栏放大后显示细滚动条。
- 测试按每一步实际的提示词认请求、从 `industry/selection.ts` 读门槛，换行业改写提示词和门槛后不再误报；架构测试不再受路径分隔符影响。

#### 站点文件搬进 `site/`（2026 年 10 月 4 日）

公开接口没有变化，版本仍是 4.0.0。

- **站点自己的文件从 `industry/` 搬到了 `site/`**：`site.ts`、`models.ts`、`brand/`、`pages/`、`public/`、`changelog.json`。`industry/` 只留行业知识：`taxonomy.ts`、`topics.json`、`sources.json`、`prompts/`、`selection.ts`。自己改过这些文件的，合并时把改动挪到 `site/` 下的同名文件。
- **`site.ts` 多了几项**，都可以不填：`SITE.github`、`SITE.llmsIntro`、`SITE.rootIcons`，`POLICY.terms.license`、`POLICY.terms.headers`，`ABOUT.termsAnchor`（二维码卡片可以写 `alias`），以及 `ACCESS`、`ADMIN`、`DEPLOYMENT`、`FEED_COPY`、`PUBLIC_CATEGORIES`，说明见 [把它改成你的行业](customize.md)。`PUBLIC_CATEGORIES` 取代了 4.0.0 时的 `publicAs`：原来在类别上写 `publicAs: "tip"` 的，改在 `PUBLIC_CATEGORIES.merge` 里写（键是这个类别的 key，值是 `"tip"`）。
- **`DEPLOYMENT.requiredSecrets`** 是生产 API 启动时额外检查的凭据清单，默认空；基本会话、图片签名和管理员登录校验仍然生效。只有你的部署要求某个可选集成必须配置时才填写。
- **只属于你这个站的功能可以做成模块**：放进 `modules/<名字>/`，在 `site/modules/` 的清单里启用，见 [架构](architecture.md) 的“模块”。框架本身不带模块。
- **Agent 接入页默认打开 MCP**，页面列出 MCP、RSS 和 API 三种接入方式。Agent Markdown 接口仍在 `/api/v1/agent`，可从页面下方“Agent 使用说明”进入。
- **图片代理可以设流量上限**：`IMGPROXY_UPSTREAM_MB_PER_MINUTE`、`IMGPROXY_UPSTREAM_GB_PER_DAY`（或 `site.ts` 的 `DEPLOYMENT.imageUpstreamBudget`），默认不设。
- **修复**：同样的数据每次给出同样的字节（排序遇到并列时补上唯一的次序，API 和 RSS 的 ETag 不再无故变化）；网页转给 api 的请求不再带上逐跳头，`Connection: close` 不再让下一个 POST 失败；`llms.txt` 的接入方式按实际数，不再写成四种。

#### 升级到公开接口 4.0.0（2026 年 10 月 3 日）

- **模型榜、Codex 重置监控和主题页的大事记不再是框架的一部分**，只留在 AIHOT 上。页面（`/leaderboard`、`/codex-reset`）、接口（`/api/v1/codex-resets`、`/api/v1/codex-resets/recent`、`/api/v1/agent/codex-resets`）和 MCP 工具 `<前缀>_get_codex_resets` 都去掉了，MCP 和 `/openapi-v1.json` 的版本号升到 4.0.0。迁移 `0053` 删掉它们的表（`lb_*`、`monitor_*`、`fx_rates`）和设置，定时任务及其执行队列在 worker 启动时自动撤掉，后台运行记录继续保留；要留这些数据的，升级前先备份。公司主题页的标志改成公司名的首字母。
- **行业包有几处变化**，自己改过 `industry/` 的站，合并时对照新文件补上：
  - `site.ts` 多了 `topicsTitle`、`feedbackExample`、`keywords`、`since`、`interfaceVersion`、`POLICY`（使用规则和隐私说明两页的名字与简介、X 帖子算不算全文）、`ABOUT.description`、`ABOUT.sourcesFallback`、`AGENT`、`REPORTS`、`ALERTS`、`SOURCE_DEFAULTS`、`COMMUNITY_FEEDS`、`CARDS`；作者块的两张二维码卡片加了 `kind`，`ABOUT.copyright` 改成反馈页链接前后的两段。
  - 新增 `models.ts`：具名的模型和每一步默认用哪个，原来写在代码里。
  - 网页左上角的标志从 `apps/web/app/components/Logo.tsx` 搬到 `industry/brand/Logo.tsx`（后来搬到 `site/` 下，见上方）。
  - 新增 `public/`：`robots.txt`、`manifest.webmanifest` 原来在代码里生成，OpenAPI 说明原来在 `reference/`，现在都是这里的文件。原来填了 `contactEmail` 就会生成的 `/.well-known/security.txt`，现在要自己放一份 `public/.well-known/security.txt`（后来搬到 `site/` 下，见上方）。
  - 删掉了 `features.ts`、`chronicle.ts` 和 `chronicles/`；`topics.json` 里的 `orgNames`、`leaderboardProvider`、`chronicleTerms` 不再使用，可以删掉。
  - `taxonomy.ts` 的类别可以写 `feedLabel`（分类 RSS 标题里的名字，示例站用“AI 模型”这样的说法）；`ENTITIES` 加了几家公司。当时类别上还可以写 `publicAs`，让它在公开接口里并进另一类；这个字段后来删掉了，改成 `site/site.ts` 的 `PUBLIC_CATEGORIES.merge`（见上方），再写 `publicAs` 通不过类型检查。
- **推送接口的限流可以设置**：`/api/ingest/items` 每个客户端每分钟最多推几次由 `INGEST_RATE_LIMIT` 决定，`docker compose` 默认 10，和以前一样；不用 Docker 时默认不限，前面没有代理限流的话在 `.env` 里设上。
- **不再使用的环境变量**：`ARTIFICIAL_ANALYSIS_API_KEY`、`MONITOR_MODEL`，可以从 `.env` 删掉。

#### 升级到公开接口 3.0.0（2026 年 10 月 3 日）

- **安全阀默认关**：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED` 只有写成 `true` 才打开，没写就是关。用 `scripts/init-env.ts` 生成的 `.env` 已经有这两行；自己写的 `.env` 没有的话要补上，否则升级后不再采集、不再调用模型。
- **周报月报接口换了形状**：`/api/v1/weeklies`、`/api/v1/monthlies` 的列表和每一期都带 `periodStart`、`periodEnd`，正文改成 `sections[]`（每栏 `label`、`summary`、`items`），不再有 `title`、`themes`，列表的 `limit` 最多 60。读这两个接口的程序要跟着改；MCP 和 `/openapi-v1.json` 的版本号随之升到 3.0.0。
- **精选的机器出口每条新闻一条**：API 的 `mode=selected`、同步接口和精选 RSS 里，同一条新闻只留代表报道，其他报道以 `remove` 出现在同步的变更里（`mode=all` 里还在）。升级前已经入选的旧报道不会被重新整理，等这条新闻再有报道发布时才归并。
- **精选要等去重确认**：分数够了的资料，要等归组确认它不是精选里已有新闻的重复、带来了新信息，才进精选；确认之前只在“全部动态”。归组用的模型回答不合格式时会停在那里，后台“运行”页能看到。
- **一手只看分级**：`T1` 就是一手，`first_party` 不再单独设置；以前单独标成一手的 `T1_5`、`T2` 信源不再算一手，要算就改成 `T1`。
- **行业包多了几项**：`taxonomy.ts` 新增 `RELEASE`、`PLAIN_TERMS`，评论类的类别标 `commentary: true`，`ENTITIES` 可以写 `otherNames`，`CATEGORY_BY_ITEM_TYPE` 不再使用。已经换成别的行业的站，合并时对照 [把它改成你的行业](customize.md) 补上。
- **主题只读 `industry/topics.json`**：迁移会删掉数据库里的 `topics` 表。只改过数据库、没改文件的主题，升级前先写进文件。公司主题只看 `entityId`，`related` 不再使用。
- **日报不再调用模型**：日报按规则编排，周报月报从日报汇编，模型只写总述和栏目导读；已经出过的各期不重写。
- **提示词有改动**：`industry/prompts/` 里的 `structure.md`、`group-*.md`、`story-digest.md`、`report-period.md` 换成了新的写法，`report-daily-lead.md` 删掉了，新加了 `report-period-sections.md`。改过这些提示词的，对照着把自己的改动搬过去。
- **删掉的脚本**：`scripts/delete-sources.ts`、`scripts/regroup-events.ts`、`scripts/enqueue-analysis.ts`。不要的信源在后台暂停；单篇的重新评估、重新归组在后台“内容诊断”里打开这一篇操作。
- **管理员会话绑定登录方式**（迁移 `0041`）：从还没有会话绑定的版本升级后，未绑定的旧会话需要重新登录。此前已试用会话绑定迁移的数据库可直接升级，已有列和绑定会被保留，无需手动修改迁移记录。之后的规则见下方“管理员会话与配置变更”。
- **3.x 的 `/agent` 默认打开 Agent Markdown**，MCP 的接入说明在 `/agent?tab=mcp`；当前接入页见上方“站点文件搬进 `site/`”。
- **飞书内容群只推 `T1`、`T1_5` 信源的精选。**

### 备份

在 `.env` 里配置 `DB_BACKUP_STORE_*`（任何 S3 兼容的对象存储），每天 04:10 自动备份到那里。`DB_BACKUP_STORE_SECRET_ID`、`DB_BACKUP_STORE_SECRET_KEY`、`DB_BACKUP_STORE_BUCKET`、`DB_BACKUP_STORE_REGION` 四项都要填；不填 `DB_BACKUP_STORE_DOMAIN` 时按腾讯云 COS 拼地址（`<桶名>.cos.<地域>.myqcloud.com`），用其他 S3 兼容存储时，把这个存储桶的访问域名（含桶名，例如 AWS S3 的 `<桶名>.s3.<地域>.amazonaws.com`）填进 `DB_BACKUP_STORE_DOMAIN`。

一次完整备份包含同一时间戳的数据库 `.dump` 和文件包 `.tar.gz`，文件名取自数据库名：Docker 里数据库叫 `aihot`，所以是 `aihot-<时间>.dump` 和 `aihot-files-<时间>.tar.gz`。文件包保留 `uploads/` 以及仍存本地的 `feedback-screenshots/`，不包含图片缓存或本地备份目录。已经转发到飞书的图片只保留数据库中的外部引用，文件包不保存飞书上的图片。

恢复时同时取回这一对文件：使用与数据库版本兼容的 `pg_restore` 将 `.dump` 恢复到空数据库，再把文件包解压到数据目录根目录（Docker 中为 `/data`，非 Docker 使用 `AIHOT_DATA_DIR`，默认 `.data`），保留包内的子目录结构，并确保运行进程可读取这些文件。只恢复数据库不能找回仍由 `local:` 引用的反馈截图；旧备份中没有包含的文件也无法凭数据库引用恢复。

下面的手动导出只包含数据库，不包含上述附件目录：

```bash
docker compose exec -T db pg_dump -U aihot aihot | gzip > myhot-$(date +%F).sql.gz
```

数据都在三个 Docker 卷里：`db`（数据库）、`data`（上传的图片、图片缓存、本地备份）、`caddy`（证书）。`docker compose down` 不会删除它们；`docker compose down -v` 会。

### 看日志

```bash
docker compose logs -f --tail 100 api worker web
```

后台的“运行”页能看到每个定时任务最近的结果，“信源”页能看到每个信源的抓取状况。

### 管理员会话与配置变更

会话绑定登录方式、登录时的管理员凭据或飞书身份。修改管理员密码、飞书管理员名单或会话密钥后，应重启所有 API 进程，使它们加载相同的新配置；只编辑配置文件不代表正在运行的进程已生效，混用旧代码或旧配置的进程不能提供统一撤权。

有效配置改变后，密码会话不再接受旧密码的授权，飞书会话按登录时实际取得的 union ID 或邮箱检查当前名单（两者任一仍获授权即可）。停用飞书登录应用或更换应用 ID 会使飞书会话失效；只轮换同一应用的 secret 不会使仍获授权的飞书会话退出。轮换或移除 `SESSION_SECRET` 会使两种会话都失效。

鉴权时确认失效的会话会被删除，恢复旧配置也不会让它复活。系统不记录全局凭据变更历史：某次配置变化若从未被进程加载，或在恢复前从未被会话检查观察到，不能据此追溯撤销会话。

## 花多少钱

- **模型**：每条新资料先预筛一次；过了预筛的再评两次分、做一次结构化、写一次标题摘要，然后归组（有相近的报道时才调用），另外还有事件综述、周报月报的总述和精选的全文翻译。空正文、纯链接的 X 帖子不调用写作或翻译模型。日报按规则编排，不调用模型。我们用示范信源在本地试跑，第一次导入的 152 条资料一共用了大约 930 次模型调用。之后每天用多少，取决于你的信源每天更新多少条。后台“模型与评测”页能看到每一步的调用次数和输入输出 token 数。
- **付费采集**（X、公众号、Jina）：按请求计费，默认不启用，填了 key 才会用。
- 所有付费服务都有每分钟、每小时、每天的调用上限（后台“设置 → 付费请求上限”），超过就暂停，不会一夜之间刷爆账单。填 0 表示立即停用这个服务。

## 不用 Docker

需要 Node.js 24.11 以上和 PostgreSQL 16 或 17，系统用 Linux 或 macOS；Windows 上请在 WSL2 里运行，或者用上面的 Docker 方式。

```bash
npm ci
node scripts/init-env.ts --llm-key <你的模型 API Key>
createdb myhot
```

在 `.env` 里加上：

```bash
DATABASE_URL=postgres://你的用户名@127.0.0.1:5432/myhot
API_BASE_URL=http://127.0.0.1:3001
```

然后：

```bash
node --env-file=.env scripts/migrate.ts
node --env-file=.env scripts/seed.ts
npm run build -w @aihot/web

NODE_ENV=production node --env-file=.env apps/api/src/main.ts          # 接口，3001 端口
NODE_ENV=production node --env-file=.env apps/worker/src/main.ts       # 后台任务
cd apps/web && NODE_ENV=production node --env-file=../../.env server.ts   # 网页，3000 端口
```

三个进程都要带 `NODE_ENV=production`。api 和 worker 不带它就按开发环境运行：启动时不检查生产密钥和管理员密码，`DEV_AUTH_ROLE` 免登录也会生效。

三个进程要一直运行，生产环境用 systemd 或 pm2 守护（守护配置里同样设 `NODE_ENV=production`）。停止 worker 时给它 515 秒（systemd 的 `TimeoutStopSec=515`、pm2 的 `kill_timeout: 515000` 和 `treekill: false`），覆盖队列的 470 秒排空和数据库清理；systemd 还需设 `KillMode=mixed`，只先通知主进程停止接任务，让正在备份的 `pg_dump`、`tar` 自然完成。被提前杀掉的调用结果不明，要等至少半小时自动放行后才会重试。

开发时用带热更新的方式：`npm run dev:api`、`npm run dev:worker`、`npm run dev:web`。开发时想免登录进后台，在 `.env` 里设 `DEV_AUTH_ROLE=admin`（生产环境会拒绝启动）。
