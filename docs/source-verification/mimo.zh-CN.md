# 小米 MiMo 官方 API 定价来源核验报告

## 核验时间（北京时间）

- 核验执行时间：**2026-11-01 20:53 ~ 21:00（UTC+8）**，抓取时间戳 `2026-11-01T20:58:04+08:00`。
- 所有单价均来自本次实际读取的官方页面内容；未读到的项目一律标注「未能读取/解析」，不猜测单价。

## 访问的 URL 与可读性实测

### 工具层实测（重要）

| 途径 | 结果 |
| --- | --- |
| `web_fetch`（https://mimo.mi.com/docs/pricing） | **被工具拒绝**：`URL hostname "mimo.mi.com" resolves to a non-public IP address`。实测 DNS 返回 `198.18.0.75` / `2001:2::a0`（本机代理 fake-ip 网段），SSRF 防护据此拒绝。 |
| `web_search` | **本环境故障**：搜索端点返回 `HTTP 401 Authentication Fails`（DeepSeek 搜索端点配置问题），本次核验未能使用搜索引擎交叉验证。 |
| `curl` 直接抓取官方域名（ops_bash） | **成功**。下文所有数字均来自 curl 实际读取的官方内容。 |

### 页面逐项实测

| URL | HTTP | 读取结果 |
| --- | --- | --- |
| `https://mimo.mi.com/docs/pricing` | 200 | SPA 空壳（`<div id="root">` + rspack JS bundle），**无静态价格内容，必须浏览器渲染或读取其静态数据源**。本次核验读取的是其下方静态 markdown。 |
| `https://mimo.mi.com/llms.txt` | 200 | **稳定机器可读文档索引**（页面 `<link rel="llms">` 声明），列出全部文档的静态 markdown 地址。 |
| `https://mimo.mi.com/llms-full.txt` | 200 | 全部文档合并单文件（约 1.1 MB），含价格、API、新闻、更新日志全文。 |
| `https://mimo.mi.com/static/docs/price/pay-as-you-go.md` | 200 | **本次价格数字的来源**（按量计费价格表，含大陆/海外两张表）。 |
| `https://mimo.mi.com/static/docs/price/token-plan.md` | 200 | Token Plan 订阅价与 Credits 换算表。 |
| `https://mimo.mi.com/static/docs/quick-start/summary/model.md` | 200 | 官方型号表（Model ID、能力、上下文、限流）。 |
| `https://mimo.mi.com/static/docs/api/model/list-models.md` | 200 | List Models API 文档：`GET https://api.xiaomimimo.com/v1/models`，**需 API Key，本次无凭据未实际调用**。 |
| `https://mimo.mi.com/static/docs/news/latest/v2-6.md` | 200 | V2.6 发布新闻（含「API 价格不变」表述）。 |
| `https://mimo.mi.com/static/docs/news/latest/v2.5-price-update.md` | 200 | V2.5 系列永久降价公告（生效时间 2026-05-27 00:00 北京时间，全球同步）。 |
| `https://mimo.mi.com/static/docs/updates/model.md` | 200 | 型号发布日志：**2026-09-22 MiMo-V2.6 系列发布**（pro / flash / pro-ultraspeed）。 |
| `https://mimo.mi.com/static/docs/updates/deprecate.md` | 200 | 弃用表：`mimo-v2.5-pro`、`mimo-v2.5` 弃用与自动替换规则。 |
| `https://mimo.mi.com/static/docs/zh-CN/price/pay-as-you-go.md` | 404 | 静态 markdown **仅有英文版**；`/docs/zh-CN/...` 路由存在但同为 SPA。数字不受语言影响。 |

## 官方价格表（逐型号逐桶）

计费桶：**Input (Cache Hit)**（缓存命中输入）/ **Input (Cache Miss)**（未命中输入）/ **Output**（输出）。语言模型无按次计费项（联网搜索除外，见下）。

### 大陆价（人民币，元 / 百万 tokens）

| 推理方式 | 官方模型 ID | Input (Cache Hit) | Input (Cache Miss) | Output |
| --- | --- | --- | --- | --- |
| Real-time API | `mimo-v2.6-pro` | ¥0.025 | ¥3.00 | ¥6.00 |
| Real-time API | `mimo-v2.6-flash` | ¥0.02 | ¥1.00 | ¥2.00 |
| Real-time API | `mimo-v2.6-pro-ultraspeed` | ¥0.25 | ¥30.00 | ¥60.00 |
| Batch API | `mimo-v2.6-pro` | ¥0.0125 | ¥1.50 | ¥3.00 |
| Batch API | `mimo-v2.6-flash` | ¥0.01 | ¥0.50 | ¥1.00 |

> `mimo-v2.6-pro-ultraspeed` **不支持 Batch API**（官方原文：「Not support batch API」）。

### 海外价（美元，$ / 百万 tokens）

| 推理方式 | 官方模型 ID | Input (Cache Hit) | Input (Cache Miss) | Output |
| --- | --- | --- | --- | --- |
| Real-time API | `mimo-v2.6-pro` | $0.0036 | $0.435 | $0.87 |
| Real-time API | `mimo-v2.6-flash` | $0.0028 | $0.14 | $0.28 |
| Real-time API | `mimo-v2.6-pro-ultraspeed` | $0.036 | $4.35 | $8.7 |
| Batch API | `mimo-v2.6-pro` | $0.0018 | $0.2175 | $0.435 |
| Batch API | `mimo-v2.6-flash` | $0.0014 | $0.07 | $0.14 |

### 其他计费项（非 token 计价）

| 项目 | 大陆价 | 海外价 | 计价单位 |
| --- | --- | --- | --- |
| `mimo-v2.5-asr`（语音识别） | ¥0.5 / 小时 | $0.074 / 小时 | 按输入音频时长，精确到秒再折算小时 |
| `mimo-v2.5-tts` / `-voiceclone` / `-voicedesign` | 限时免费 | 限时免费 | — |
| 联网搜索插件（国内网络连通服务） | ¥16 / 1000 次 | — | 按调用次数，独立于 token 价格 |
| 联网搜索插件（海外网络连通服务） | — | $5 / 1000 次 | 按调用次数 |

### Token Plan 换算（订阅制，非按量价，仅备查）

Credits 换算（每百万 token 或每小时）：`mimo-v2.6-pro` 命中 2.5 / 未命中 300 / 输出 600 Credits；`mimo-v2.6-flash` 2 / 100 / 200 Credits；`mimo-v2.5-asr` 30M Credits/小时；TTS 不耗 Credits。个人月套餐：Lite ¥39（$6）/ 4.1B Credits、Standard ¥99（$16）/ 11B、Pro ¥329（$50）/ 38B、Max ¥659（$100）/ 82B。

## 缓存与计费规则

- **缓存命中**：请求前缀命中 Prompt Cache 时，命中部分按 **Input (Cache Hit)** 价计费；未命中输入按 Input (Cache Miss) 价。usage 返回 `prompt_tokens_details.cached_tokens` 指示命中 token 数（chat 与 responses 均如此）。
- **缓存写入（Cache Write）**：官方标注 **「Limited-time Free」（限时免费）**，未公布恢复收费的截止日期。
- **缓存 TTL / 有效期**：**本次核验未能读取到官方对 Prompt Cache 命中有效期（TTL）的任何公开承诺值**，来源状态为未知。官方仅在推理工程博客中提到「显著延长了缓存 TTL」而无具体数字，不构成计费依据。
- **推理（reasoning）token**：usage 中 `completion_tokens_details.reasoning_tokens` 是 `completion_tokens` 的细分（API 文档明示 max_tokens「包括可见输出与推理 token」），即**推理 token 计入输出计费**。此归属系依据 usage schema 结构推断——官方计费说明只列 input / cache hit / output 三项，未单列推理价。
- **按次计费项**：仅联网搜索（¥16 / $5 每 1000 次）与 ASR 按时长；语言模型本身无按次费用。
- 计费说明原文要点：「Billing Unit: China：RMB / M tokens; Overseas: dollar / M tokens」「Cache Write: Limited-time Free」「Internet search is billed independently based on the number of calls and is not included in the Token price」。

## 地域 / 币种差异

- 大陆：**人民币 CNY，元 / 百万 tokens**；海外：**美元 USD，$ / 百万 tokens**。两套价格各自独立公布。
- 海外价并非大陆价按固定汇率换算：隐含比值在 **6.897 ~ 7.143** 之间（如 ¥3.00/$0.435 = 6.897、¥1.00/$0.14 = 7.143），系官方按档取整。**计价时须按地域选对应官方价表，不得用汇率从 CNY 推算 USD**（反之同理）。
- 异常记录：联网搜索服务 ¥16/1000 次 vs $5/1000 次（隐含比值 3.2），与 token 价的地域比值明显不一致，属官方独立定价，照实录入。
- 调价公告声明 2026-05-27 的降价为「global synchronization（全球同步）」生效。

## 生效日期与调用方式差异

- **当前价目生效时间：2026-05-27 00:00（北京时间）**——《MiMo-V2.5 系列调价公告》：API 永久降价（最高降 99%，不再按输入长度区分价格），全球同步生效。
- **V2.6 系列 2026-09-22 发布**（updates/model.md），发布新闻明示「MiMo-V2.6 系列采用与 V2.5 系列相同的 API 价格，性能升级、价格不变」。因此上表价格自 V2.6 发布即适用。
- **未来生效价格**：本次核验**未发现**任何已公布但未生效的未来价格。
- **`mimo-v2.6-pro-ultraspeed` 的独立生效日期官方未标注**：该型号随 V2.6 系列于 2026-09-22 发布（此前有 `MiMo-V2.5-Pro-UltraSpeed` 限时体验活动），价格表未给出单独生效时间 → 记为「生效时间未知」，不用抓取时间冒充。
- **调用方式**：OpenAI Chat Completions / OpenAI Responses / Anthropic 三种 API 兼容，**计价口径相同**（input、input(cache hit)、output 三桶）；**Batch API 为独立端点**（`batch-api-${region}.xiaomimimo.com`，扣账户余额），价目为实时价的 **50%**，且仅 `mimo-v2.6-pro`、`mimo-v2.6-flash` 支持。
- **弃用**：`mimo-v2.5-pro`、`mimo-v2.5` 于 **2026-10-21 10:00（UTC+8）正式弃用**（2026-10-14 18:00 起请求已自动路由到 `mimo-v2.6-pro` / `mimo-v2.6-flash` 并按新模型计费）。

## 稳定机器可读接口

- ✅ `https://mimo.mi.com/llms.txt` 与 `https://mimo.mi.com/llms-full.txt`：官方声明的机器可读入口，静态 markdown，本次多次抓取均 HTTP 200，可作为自动刷新数据源（价格直链：`/static/docs/price/pay-as-you-go.md`）。
- ⚠️ `GET https://api.xiaomimimo.com/v1/models`：官方 List Models API，**需 API Key；本次无凭据未实际调用，可用性未验证**。
- ❌ 无专用价格 JSON API；`/docs/pricing` 页面本身为 JS 渲染 SPA，不能直接解析。

## 已知缺口

1. Prompt Cache **TTL / 命中有效期未公布** → 计价无法验证「调用间隔多久仍算命中」，只能按 usage 返回的 `cached_tokens` 实报实算。
2. **缓存写入「限时免费」无截止日期** → 属随时可能变更的促销价，自动计价需带「促销价」标记。
3. `mimo-v2.6-pro-ultraspeed` **价格生效日期未知**。
4. `GET /v1/models` 需凭据、本次未验证；无法确认是否返回价格字段。
5. web_search 工具本环境故障，未做搜索引擎交叉验证；`web_fetch` 因 DNS fake-ip 被拒——复核建议继续用直连 HTTP 抓取官方域名。
6. 推理 token 计入输出桶系依据 usage schema 推断，非官方计费页明文。
7. 静态文档仅英文版；中文路由为 SPA，不影响数字但影响文本引用。

## 与仓库现有第三方定价的映射可行性

- 仓库现状（`lib/index.js`）：`SILICONFLOW_PRICING` 覆盖 `deepseek-ai/deepseek-v4-flash|v4-pro|v3.2`、`qwen/qwen3.6-27b` 等，`DIGITALOCEAN_PRICING` 按 `flash`/`pro`/`v3.2` 子串分桶——**均为 DeepSeek/Qwen 系模型，与 MiMo 无交集**，本阶段不应把 MiMo 官方价套给这两家的任何记录。
- 官方型号 ID 全部为小写连字符形态：`mimo-v2.6-pro`、`mimo-v2.6-flash`、`mimo-v2.6-pro-ultraspeed`；展示名（新闻/官网）为 `MiMo-V2.6-Pro` / `MiMo V2.6 Flash` / `MiMo-V2.6-Pro UltraSpeed` 等，别名归一（去空格、变连字符、转小写）后可与官方 ID 确定性对应，**但大小写与 `-ultraspeed` 后缀必须保留区分**：UltraSpeed 单价是 Pro 的 **10 倍**（¥30 vs ¥3 未命中输入），误映射将产生 10 倍误差。
- 同名映射的可靠性边界（与 docs/phase-1-official-pricing-plan.zh-CN.md §1 口径一致）：
  - 只有当调用平台即官方（`api.xiaomimimo.com` / `batch-api-*.xiaomimimo.com`，provider 为小米 MiMo 官方）时，同名模型才可直接确认为官方同一版本、按官方价计「官方价参考金额」。
  - 第三方平台（硅基流动、DigitalOcean 等）若将来上架 `mimo-v2.6-*`，**同名不足以确认同版本**（可能为重打包/不同推理栈/不同缓存实现），且其价格是第三方自身价；在无平台官方对照声明前不得自动套用 MiMo 官方价，保持「未知/待核」状态。
  - 现有 `flash`/`pro` 子串匹配逻辑对 `mimo-v2.6-flash` 这类名称有误判风险（会落进 DeepSeek flash/pro 分支），实施时必须先按 provider/前缀隔离 MiMo 型号再匹配。
- 结论：**官方型号 ↔ 官方调用可可靠对应；官方 ↔ 第三方同名模型目前无一例可确认对应**，第一阶段映射仅限官方来源。

## 结论

1. **来源可读**：官方价格数据可通过 `llms.txt` → `/static/docs/price/pay-as-you-go.md` 静态 markdown 稳定机器读取（本次实测 HTTP 200）；`/docs/pricing` 页面本身是 SPA、需渲染。建议自动刷新走静态 markdown 路径。
2. **逐型号单价齐备**：`mimo-v2.6-pro`（命中 ¥0.025 / 未命中 ¥3.00 / 输出 ¥6.00）、`mimo-v2.6-flash`（¥0.02 / ¥1.00 / ¥2.00）、`mimo-v2.6-pro-ultraspeed`（¥0.25 / ¥30.00 / ¥60.00），均含海外 USD 表；pro/flash 另有 Batch 半价表。
3. **缓存规则**：命中/未命中双价 + 写入限时免费；**TTL 未公布**，命中量以 usage `cached_tokens` 为准。
4. **可自动计价**：三款 V2.6 语言模型的实时/批处理 × 命中/未命中/输出桶齐备，地域分表明确，**可以自动计价**（「官方价参考金额」口径）；需保留的标注：生效日期仅对2026-05-27 起价目可确认（ultraspeed 未知）、缓存写入为限时促销价、TTL 未知、按次搜索费与 ASR 时长费分开计。ASR/TTS 为非 token 计价，应单独处理，不并入 token 公式。
