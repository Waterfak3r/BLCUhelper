// 这个行业的分类体系：类别、标签词表、机构（主体）名录，以及防止张冠李戴的身份词典。
// 模型按这里的词表打标签，主题页（topics.json）按标签归类，筛选栏按类别分组。
// 换行业时：类别的 key 会出现在网址里（/all?category=…），上线后就不要再改；标签和名录可以随时增减。

/**
 * 网页上的类别（筛选栏、卡片角标、RSS 分类订阅）。key 是网址和接口里的身份，上线后不要改。
 * section 是日报里的分节标题（几个类别可以共用一节，按这里的顺序排）；guide 告诉结构抽取模型这一类收什么、
 * 和相邻类别的边界在哪（总的归类原则写在 prompts/structure.md 里）。
 * commentary 标出评论类（教程、观点）：日报写过的事又有评论类的后续报道，只占一行快讯（报道它的信源够多时除外）。
 * 没归上类的资料在日报里放进第一个 key 为 industry 的类别所在的节（没有就放最后一节）。
 * tagColor 是飞书推送卡片里跟在标题后面的这一类小标签的颜色（飞书 text_tag 的颜色名）。
 * feedLabel 是分类 RSS 标题里的名字（不写就用 label）。公开接口、RSS 和 MCP 里要把一类并进另一类发布，写在站点设置里（site/site.ts 的 PUBLIC_CATEGORIES）。
 */
export const CATEGORIES = [
  { key: "academic", tagColor: "indigo", label: "教务考试", feedLabel: "教务考试", section: "教务考试", guide: "选课、课程安排、考试、成绩与学籍事项。包括开课计划、考试通知、成绩发布、转专业、休学等。跨学院或需资格的优先，纯宣传不归此。" },
  { key: "funding", tagColor: "turquoise", label: "奖助评优", feedLabel: "奖助评优", section: "奖助评优", guide: "奖学金、助学金、评优及其申请和公示。包括国家奖、校级奖、专项资助、优秀学生评选结果。资格、截止、公示名单优先；已结束的回顾不自动入选。" },
  { key: "opportunities", tagColor: "orange", label: "升学就业交流", feedLabel: "升学就业交流", section: "升学就业交流", guide: "招聘实习、升学、访学与交换项目。包括校招信息、实习岗位、考研保研、出国交流、交换生计划。资格条件、时间节点、申请入口优先。" },
  { key: "events", tagColor: "violet", label: "活动讲座", feedLabel: "活动讲座", section: "活动讲座", guide: "可参与的讲座、比赛、社团和校园活动。包括学术讲座、文化节、体育比赛、社团招新、志愿服务。时间、地点、报名方式优先；纯宣传口径弱化。" },
  { key: "services", tagColor: "green", label: "校园服务", feedLabel: "校园服务", section: "校园服务", guide: "网络、校园卡、场馆、住宿和办事服务变更。包括系统维护、卡务调整、场馆开放时间、宿舍安排、办事流程变化。影响范围、替代方案、时间优先。" },
  { key: "campus", tagColor: "purple", label: "校园资讯", feedLabel: "校园资讯", section: "校园资讯", guide: "不属于上述事项的校园事实消息；纯宣传不自动精选。包括校情通报、天气提醒、设施使用须知、行政通知等。事实要素优先，口号式宣传低优先。" },
] as const satisfies ReadonlyArray<{ key: string; tagColor: string; label: string; feedLabel?: string; section: string; guide: string; commentary?: true }>;

/**
 * 这个行业最受关注的一类发布（校园站没有固定“发布”类）：日报报头的数字、改分类后修订已出的报告都按它数。
 * category 是类别，tag 是标签，两者都对上才算；unit 接在数字后面。
 * 没有这样一类的行业设成 null，报头就不显示这个数。
 */
export const RELEASE: { category: string; tag: string; unit: string } | null = null;

/** 周报月报的总述可以直接写、不必在报道里找到出处的行业通用词（小写）。站名会自动算进去。 */
export const PLAIN_TERMS: readonly string[] = [];

/**
 * 内容理解一步给每篇资料判的“内容类型”（写在 prompts/content-understanding.md 里，改了类型要同步改那份提示词）。
 * 评分提示词（prompts/selection-score.md）按类型给五个维度不同的权重。
 */
export const ITEM_TYPES = ["required_action", "opportunity", "service_change", "guide", "campus_news"] as const;

// ── 标签词表 ────────────────────────────────────────────────────────────────────────────

/** 每篇资料的第一个标签必须是这些“分类标签”之一。 */
export const CATEGORY_TAGS = [
  "教务考试", "奖助评优", "升学就业交流", "活动讲座", "校园服务", "校园资讯",
] as const;

/** 可选的主题标签。 */
export const TOPIC_TAGS = [
  "本科生", "研究生", "留学生", "新生", "毕业生",
] as const;

/** 可选的实体标签（公司、机构、平台）。 */
export const ENTITY_TAGS = ["北京语言大学"] as const;

/** 模型常写的近义词，统一成词表里的写法。 */
export const TAG_SYNONYMS: Readonly<Record<string, string>> = {};

// ── 机构与主体 ──────────────────────────────────────────────────────────────────────────

/**
 * 机构主题：id → 显示名、卡片上显示的标签（null 表示只用 entity:<id> 归类）、别名。
 * aliases 给结构抽取模型看；orgNames 是这个机构发消息时开头用的组织名，
 * 在它自己的主题页上读者知道说的是谁，可以省去；otherNames 是机构的其他称呼（官方账号名、子品牌）。
 * 所有这些名字都用来认出说的是哪个机构，比如把事实的主体对到发布方。
 */
export const ENTITIES: Record<string, { name: string; displayTag: string | null; aliases: string[]; orgNames?: string[]; otherNames?: string[] }> = {
  blcu: { name: "北京语言大学", displayTag: "北京语言大学", aliases: ["北京语言大学", "北语", "BLCU"] },
};

/**
 * 身份词典：摘要和标题里出现的机构，必须在原文里也出现过，否则退回原标题、丢掉摘要（防止模型张冠李戴）。
 * 行业没有这个问题时可以留空数组。
 */
export const IDENTITY_LEXICON: ReadonlyArray<{ id: string; name: string; patterns: RegExp[] }> = [];

/** 这些域名上的文章，发布方就是对应的机构（托管平台如 GitHub、arXiv 不算）。 */
export const PUBLISHER_DOMAINS: ReadonlyArray<{ entityId: string; domains: readonly string[] }> = [];

/** 原文里的这些写法也算提到了对应机构。 */
export const IDENTITY_CONTEXT_ALIASES: ReadonlyArray<{ entityId: string; pattern: RegExp }> = [];
