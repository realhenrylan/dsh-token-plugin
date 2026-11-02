# DeepSeek 官方 API 定价来源核验报告

> 用途：「模型官方价格计量」第一阶段（docs/phase-1-official-pricing-plan.zh-CN.md）的可审计证据。
> 原则：只记录实际读取到的官方原文要点与数值；读不到的项目明确标注缺口，**绝不猜测单价**。

## 核验时间（北京时间）

- 核验窗口：**2026-11-01 20:53 – 20:57（UTC+8）**
- 抓取时间戳（`fetchedAt`）：`2026-11-01T20:56:48+08:00`
- 说明：本环境的 `web_fetch` / `web_search` 工具不可用（`web_fetch` 对 api-docs.deepseek.com 报「resolves to a non-public IP address」；`web_search` 后端鉴权失败 HTTP 401），因此改用 `curl` 直接 HTTPS GET 官方站点，全部页面返回 **HTTP 200** 并成功解析。以下所有数值均来自本次实际读取的官方页面内容。

## 访问的 URL（全部 HTTP 200，本次实际读取成功）

| URL | 内容 | 角色 |
| --- | --- | --- |
| https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ | 模型 & 价格（中文 HTML） | **主来源** |
| https://api-docs.deepseek.com/zh-cn/quick_start/pricing.md | 同上，原始 Markdown | **机器可读主来源** |
| https://api-docs.deepseek.com/quick_start/pricing/ | Models & Pricing（英文 HTML，美元价） | 币种交叉核对 |
| https://api-docs.deepseek.com/quick_start/pricing.md | 同上，原始 Markdown | 机器可读交叉核对 |
| https://api-docs.deepseek.com/zh-cn/guides/search.md | 网页搜索与抓取（Search/Fetch 完整计费规则） | Search/Fetch 计费 |
| https://api-docs.deepseek.com/zh-cn/quick_start/token_usage.md | Token 用量计算 | 计费单位说明 |
| https://api-docs.deepseek.com/zh-cn/guides/thinking_mode.md | 思考模式 | 推理 token 计费查证 |
| https://api-docs.deepseek.com/zh-cn/guides/vision.md | 图像理解 | 图片计费查证 |
| https://api-docs.deepseek.com/zh-cn/updates.md | 更新日志 | 价格生效时间线 |
| https://api-docs.deepseek.com/zh-cn/news/news260813.md | V4 Pro 正式版发布公告 | 2026-08-17 峰谷定价生效 |
| https://api-docs.deepseek.com/zh-cn/news/news260910.md | V4.1 Flash 发布公告 | 2026-09-10 12:00 调价生效 |
| https://api-docs.deepseek.com/zh-cn/news/news261017.md | V4.1 Flash 1017 发布公告 | Search/Fetch 开放与计费时间 |

## 官方价格表（当前生效价，逐型号逐桶）

单位：**元 / 百万 tokens**（中文站）；英文站为 **USD / 1M tokens**（两站各自独立标价，非汇率换算）。计费桶仅三类：输入·缓存命中、输入·缓存未命中、输出。官方价格页**没有**「缓存写入」「缓存存储」「推理 token」等独立计费桶。

### deepseek-flash（模型版本 DeepSeek-V4.1-Flash-1017）

| 计费桶（每百万 tokens） | 空闲时段（CNY） | 高峰时段（CNY） | 空闲（USD） | 高峰（USD） |
| --- | --- | --- | --- | --- |
| 输入（缓存命中） | 0.02 元 | 0.04 元 | $0.003 | $0.006 |
| 输入（缓存未命中） | 1 元 | 2 元 | $0.15 | $0.3 |
| 输出 | 4 元 | 8 元 | $0.6 | $1.2 |

### deepseek-v4-pro（模型版本 DeepSeek-V4-Pro-0813）

| 计费桶（每百万 tokens） | 空闲时段（CNY） | 高峰时段（CNY） | 空闲（USD） | 高峰（USD） |
| --- | --- | --- | --- | --- |
| 输入（缓存命中） | 0.15 元 | 0.30 元 | $0.022 | $0.044 |
| 输入（缓存未命中） | 4.5 元 | 9.0 元 | $0.66 | $1.32 |
| 输出 | 13.5 元 | 27.0 元 | $1.98 | $3.96 |

### 生效时间（官方公布，价格页本身不带生效日期字段）

| 时间（北京时间） | 事件 | 官方出处 |
| --- | --- | --- |
| 2026-08-17 00:00 | V4 全系列正式版配套调价，**首次引入峰谷定价**（闲时 = 高峰一半）；该版具体单价只在公告配图中，无文本数值 | updates.md 2026-08-13 条目；news260813.md |
| 2026-09-10 12:00 | V4.1 Flash 上线并**下调价格**（即上表现行价），继续峰谷定价；模型名改为 `deepseek-flash` | news260910.md「新价格于 2026 年 9 月 10 日 12:00 开始生效」 |
| 2026-10-17 | 模型升级为 DeepSeek-V4.1-Flash-1017，「API 调用方式与**价格保持不变**」 | updates.md 2026-10-17 条目 |
| 2026-11-01 00:00 | Search/Fetch 开始按次计费（此前免费） | pricing 页脚注、search.md、news261017.md |

- **当前价格页无未来生效价格**（无「即将生效」的新价目）。
- `deepseek-v4-pro` 现行价格是否自 2026-08-17 起就未变动，官方现行文本无法核验（2026-08-17 版价格仅存于公告配图）；能确认的是现行价自 2026-09-10 12:00 调价公告后即为现行状态。

## 峰谷与节假日规则（原文核对）

价格页脚注 (2) 原文：

> 空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。

英文页脚注 (2) 对应：`Peak hours are 01:00 - 04:00 and 06:00 - 10:00 UTC, Monday through Friday, excluding Chinese public holidays. All other hours are off-peak, including weekends and Chinese public holidays in full.`

要点：

- **空闲价 = 高峰价 × 1/2**（两档，无第三档）。
- 高峰 = 北京时间周一至周五 9:00–12:00、14:00–18:00，**且不含中国法定节假日**（节假日调休上班的周末按「周末」口径仍为空闲——官方原文只说周末全天空闲，未细化调休；见缺口）。
- 空闲 = 其余全部时段，**周末（周六、周日）全天**与**中国法定节假日全天**均为空闲。
- 跨午夜：高峰窗口不跨午夜；空闲段 18:00–次日 9:00 跨午夜。**跨时段请求如何结算（按请求开始时间还是按 token 分段）官方未说明**，属估算口径。
- 官方页面**不提供**法定节假日日历本身；节假日判定需外部引入国务院年度放假安排（覆盖年份需自行维护）。

## 别名与适用范围

| 模型 ID | 官方模型版本 | 状态 | 计费 |
| --- | --- | --- | --- |
| `deepseek-flash` | DeepSeek-V4.1-Flash-1017 | 现行主名 | Flash 价格（上表） |
| `deepseek-v4-flash` | 旧名，模型已下线 | 仍可调用，请求由 DeepSeek-V4.1-Flash-1017 服务 | **按 Flash 价格计费** |
| `deepseek-v4-flash-vision-exp` | 旧名，模型已下线 | 仍可调用，请求由 DeepSeek-V4.1-Flash-1017 服务 | **按 Flash 价格计费** |
| `deepseek-v4-pro` | DeepSeek-V4-Pro-0813 | 现行主名 | V4 Pro 价格（上表） |

- 脚注 (1) 原文要点：「模型名请使用 `deepseek-flash`。旧模型名 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp` 仍可调用，但对应模型已下线，请求将由 DeepSeek-V4.1-Flash-1017 模型提供服务，并按 Flash 价格计费。」
- **注意一处历史公告与现行状态不一致**：news260910.md 曾宣布「北京时间 2026 年 9 月 14 日 12:00 之后……用户访问 `deepseek-v4-pro` 的请求将全部路由到 V4.1 Flash，并按 V4.1 Flash 单价计费」；但 updates.md 2026-09-10 条目随后更新为「为响应广大用户的需求，我们决定在 2026 年 9 月 14 日之后**继续提供 DeepSeek V4 Pro 的 API 调用服务，计费方式保持不变**」，且现行价格页仍单列 `deepseek-v4-pro` 价格列与 DeepSeek-V4-Pro-0813 版本。**以现行价格页为准：`deepseek-v4-pro` 按 V4 Pro 价格计费**；未来 V4.1 Pro 上线后路由可能变化。
- 别名适用范围：仅限 DeepSeek 官方 API（api.deepseek.com）上的模型名路由；不代表第三方平台同名模型。

## Search / Fetch 按次计费（核实结果）

| API | 计费单位 | 价格（CNY） | 价格（USD） |
| --- | --- | --- | --- |
| Search | 每 1,000 次**成功**请求 | 5 元 | $0.75 |
| Fetch | 每 1,000 次**成功**请求 | 5 元 | $0.75 |

- 计费规则（search.md「计费」节原文要点）：按请求次数计费，不按 token 或结果条数；**只有返回 HTTP 200 且产生结果的请求才计费**（Search 的 `results` 非空、Fetch 返回网页正文）；请求失败、搜索无结果、超时不计费；`count` 不影响单价。
- 生效时间：**2026-11-01 00:00（北京时间）**起对 DeepSeek Harness / Claude Code / Codex 中经 Server 端工具调用产生的 Search/Fetch 计费（此前免费）。
- 接口：`POST https://api.deepseek.com/v1/tools/search`、`POST https://api.deepseek.com/v1/tools/fetch`；按账号限速 Search 100 QPS、Fetch 25 QPS（不影响单价，供参考）。

## 其他计费口径（核实结果）

- **计费公式**：模型调用费用 = token 消耗量 × 模型单价；按输入/输出总 token 计量（pricing 页「扣费规则」节）。
- **缓存写入/存储**：官方价格页**不存在**该计费桶（仅命中/未命中/输出三项）。不做任何推断。
- **推理（思维链）token**：官方价格表**无独立计费桶**；thinking_mode.md 全文无计费说明（思维链经 `reasoning_content` 返回）。是否全部并入输出 token 计费**官方未明示**，列入缺口。
- **图片**：无独立图片单价。vision.md：图片按尺寸换算成 token 与文本 token 一起计费，**每张图片 token 上限 1024**；仅 `deepseek-flash` 支持图像理解，`deepseek-v4-pro` 不支持。
- **音频/视频**：官方无对应模型能力与价格（未见任何音频/视频计价）。
- **扣费顺序**：直接从充值余额或赠送余额扣减，两者并存时优先扣赠送余额。

## 机器可读接口（稳定性评估）

- **存在**逐页原始 Markdown 端点：任意文档 URL 追加 `.md` 即返回纯 Markdown（本次验证 `pricing.md`、`search.md`、`updates.md`、`news*.md` 均 HTTP 200），可作为稳定机器读取入口（Docusaurus 站点约定）。
- **不存在** JSON 价格 API、带生效区间的结构化价目接口。价格页 Markdown 表格无生效日期字段；生效时间只能从更新日志/发布公告正文提取，属文本解析。
- 价格页自带「复制 Markdown / 打开 Markdown」入口，与 `.md` 端点一致。

## 已知缺口 / 未覆盖项

1. **历史价格数值不可核验**：2026-08-17 前的 base 价、2026-08-17 ~ 2026-09-10 的第一版峰谷价，官方仅存于公告配图（`v4_260813_price_cn.png`、`v4.1_260910_price_cn.jpeg`），无文本数值。本报告不猜测、不引用图中数字。
2. **周末/节假日规则的分段生效日期无官方文本**：现行页脚注只给统一规则（周末+法定节假日全天空闲），不带「2026-08-23 起周末空闲」「2026-11-01 起节假日空闲」之类的历史分段日期。
3. **法定节假日日历**：官方不提供节假日日期表与覆盖年份，需外部来源（如国务院年度放假安排）并标注覆盖年份。
4. **跨时段结算语义**：一次请求跨越高峰/空闲边界时按何时点计价，官方未说明。
5. **推理 token 计费口径**：是否全部计入输出桶，官方未明示。
6. **图片计费**：仅规则与 1024 token/张上限可核验，具体换算公式在 token_usage 页面的交互计算器中（需浏览器渲染），未机器可读。
7. **音频、视频、缓存写入/存储、批量（batch）折扣**：官方无此类计价（记录为「不存在」，非「未查到」）。
8. **Search/Fetch 用量可计价但插件侧不可取数**：单价与规则已核验；实际成功次数是否可从宿主取得属插件能力问题，不在本报告范围。

## 与仓库现有实现的差异

仓库现状（lib/index.js、lib/client.js）与本次核验对照：

| 项目 | 仓库实现 | 官方核验 | 结论 |
| --- | --- | --- | --- |
| deepseek-flash 现行峰谷价（peakValleyV41） | 空闲 0.02 / 1.0 / 4.0，高峰 0.04 / 2.0 / 8.0（lib/index.js:131-132） | 同左 | **一致** |
| deepseek-v4-pro 现行峰谷价 | 空闲 0.15 / 4.5 / 13.5，高峰 0.3 / 9.0 / 27.0（lib/index.js:135-136） | 同左 | **一致** |
| 价格段划分 | base（2026-08-17 前）/ peakValley（2026-08-17 00:00 起）/ peakValleyV41（2026-09-10 12:00 起） | 更新日志确认 2026-08-17 00:00 引入峰谷定价、2026-09-10 12:00 调价 | 时间点**一致**；但 base 段与第一版峰谷段的具体数值官方无文本可核验（仅配图），仓库数值来源为历史实现，**本次无法审计** |
| 高峰时段 | 周一至周五 9:00–12:00、14:00–18:00 | 同左 | **一致** |
| 周末规则 | `WEEKEND_FLAT_AT = 2026-08-23T00:00:00+08:00`（lib/index.js:40），此前周末按原峰谷分段 | 现行官方规则：周末全天空闲，**无分段日期** | 现行口径一致；「2026-08-23 起」这一分段日期**无官方文本可核验** |
| 节假日规则 | `HOLIDAY_RULE_AT = 2026-11-01T00:00:00+08:00`（lib/index.js:46）+ `HOLIDAYS_2026` 内置日历 | 现行官方规则：法定节假日全天空闲，**无分段日期、无日历** | 现行口径一致；分段日期与 2026 日历**无官方文本可核验**（日历需外部来源） |
| 模型别名归并 | `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 归入 flash 档 | 官方脚注 (1)：仍可调用、由 V4.1-Flash-1017 服务、按 Flash 价计费 | **一致** |
| deepseek-v4-pro 路由 | 不做时间路由，按 Pro 价计费 | 现行价格页单列 Pro 价（news260910 的 9/14 路由计划已被 updates.md 取消） | **一致**（以现行价格页为准） |
| Search/Fetch | 口径声明、不计入费用（CHANGELOG 2026-11-01 复核） | ¥5 / 1,000 次成功请求，2026-11-01 00:00 起计费，仅成功且有结果计费 | 单价与规则**一致**；官方「仅成功请求计费」口径此前未在仓库文案中细化 |
| V4 Flash base 段（0.02/1/2）与 pro base 段（0.025/3/6） | 仓库保留历史价 | 官方无文本可核验 | **无法核验**（保留现状即可，标注来源为历史实现） |

## 结论

**可自动计价（当前价）**：

- 当前生效的两个型号（`deepseek-flash`、`deepseek-v4-pro`）× 三个计费桶 × 高峰/空闲两档单价、峰谷规则、别名路由、Search/Fetch 按次价，均已从官方页面读取到精确数值，且存在 `.md` 机器可读入口，可支撑第一阶段的自动计价与后续刷新。
- **历史价格段为部分可核验**：2026-09-10 12:00 之前各段数值官方无文本来源，只可沿用仓库历史实现并标注「来源为历史实现，未经本次官方文本核验」，不得作为官方价宣称。
- 峰谷判定所需的法定节假日日历与跨时段结算语义需外部数据/估算口径，展示时应按方案 §3 标注「时段规则不完整」而非静默假定。
