# 站点（BLCUhelper）

这个站自己的东西：站名、文案、品牌、静态页面及模块配置。适配说明见 [把它改成你的行业](../docs/customize.md) 与 [BLCUhelper 规划路线](../local://blcu-information-plan.md)。

| 文件 | 内容 |
|---|---|
| `site.ts` | 站名（BLCUhelper）、行业词（北语校园）、出刊时间、首页和关于页文案、分享图文字、条目与日报上的说法、公开接口分类、备案号（由配置负责人维护） |
| `models.ts` | 具名的模型和每一步默认用哪个（没写的步骤用 `.env` 里配的那一个） |
| `brand/` | 图标、自绘几何字母 B 与通知卡片图标（`logo.svg`）、Logo 组件（`Logo.tsx`，保持接口与参数）、日报周报月报报头字（`nameplates/`） |
| `pages/` | 使用规则草案（`terms.md`）、隐私说明草案（`privacy.md`）：包含学生自建非官方声明、数字北语官方服务大厅入口链接、数据范围与覆盖限制、免登录与官方账号隔离、更正下架渠道 |
| `public/` | 发布在网站根目录的模板与固定文件（`{{siteName}}` 等占位符由 API 动态替换）：`robots.txt`、`manifest.webmanifest`、`openapi-v1.json` |
| `changelog.json` | 更新日志（记录校园通知聚合适配与系统更新历史） |
| `modules/` | 启用哪些模块：`index.ts`、`server.ts`、`web.ts` 三份清单，首期保持默认空，见 [架构](../docs/architecture.md#模块) |
