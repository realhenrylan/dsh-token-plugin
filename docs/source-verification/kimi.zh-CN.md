# Kimi（月之暗面 Moonshot）官方模型推理价格核验报告

> 第一阶段「模型官方价格计量」证据存档。核验原则：读到什么写什么；读不到即标注不可用，不猜测单价。

## 核验时间（北京时间）

2026-11-01 20:53 – 21:00（+08:00，Asia/Shanghai）。本报告记录该时刻官方页面状态。

## 访问的 URL

| URL | 访问结果 |
| --- | --- |
| https://platform.kimi.com/docs/pricing/chat | ✅ 成功（HTML 页面；价格表在页面 JS payload 中，`curl` 抓取解析） |
| https://platform.kimi.com/docs/pricing/chat.md | ✅ 成功（Markdown 版；但 DocTable 表格为客户端渲染，.md 中表格为空壳，单价不在其中） |
| https://platform.kimi.com/docs/pricing/batch | ✅ 成功（批量推理定价页 HTML，表格同样在 JS payload 中） |
| https://platform.kimi.com/docs/pricing/batch.md | ✅ 成功（表格为空壳） |
| https://platform.kimi.com/docs/guide/context-caching.md | ✅ 成功（上下文缓存计费与 TTL 规则） |
| https://platform.kimi.com/docs/models.md | ✅ 成功（模型列表、已下线模型） |
| https://platform.kimi.com/docs/changelog.md | ✅ 成功（变更日志，含模型上下线时间） |
| https://platform.kimi.com/docs/openapi.json | ✅ 成功（OpenAPI 规范，用于核查是否有机器可读价格接口） |
| https://platform.kimi.com/docs/pricing/websearch.md、/docs/pricing/limits.md | ✅ 成功（联网搜索定价、充值与限速；非模型推理价，未纳入本表） |

说明：`web_fetch` 工具因 DNS 解析限制拒绝 platform.kimi.com（解析到非公网 IP），`web_search` 工具因搜索 API key 失效不可用（HTTP 401）；以上页面均改用 `curl` 直接抓取官方服务器返回的原始内容，来源仍为 platform.kimi.com 官方页面。

## 计价单位与币种

- 币种：**人民币 CNY**，页面以 `¥` 标注。
- 计价单位：**元 / 1 MTok**，官方原文「此处 1 MTok = 1,000,000 tokens，表格中的价格代表每消耗 1 MTok 的价格」，即**每百万 tokens**。
- Input 与 Output 均按量计费；上传并抽取的文档内容作为 Input 传输时同样按量计费；文件内容抽取/文件存储接口**限时免费**（官方原文，未标注截止日期）。

## 逐型号价格表（逐桶）

生效时间：官方页面**未公布单价生效日期列**，也未公布未来生效价格；价格表以页面最后更新时间为准（定价页 JSON-LD `dateModified` = 2026-10-30T12:10:01.248Z）。下表「生效时间」列如实记为未公布。所有单价单位均为 **CNY 元 / 1 MTok（= 1,000,000 tokens）**。

### K3 系列（上下文窗口 1,048,576 tokens）

| 模型 ID（官方） | 输入 | 输出 | 缓存命中 | 缓存写入（5min） | 缓存写入（1h） | 缓存存储 | 生效时间 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `kimi-k3.1-pro` | ¥13.00 | ¥68.00 | ¥1.30 | ¥13.00 | ¥26.00 | 未公布存储费 | 未公布 |
| `kimi-k3.1-pro-highspeed` | ¥26.00 | ¥136.00 | ¥1.30 | ¥26.00 | ¥52.00 | 未公布存储费 | 未公布 |
| `kimi-k3` | ¥20.00 | ¥100.00 | ¥2.00 | ¥20.00 | ¥40.00 | 未公布存储费 | 未公布 |

表头工具提示原文（K3 表）：
- 缓存命中：「命中缓存的请求前缀按此价格计费，命中后缓存有效期（TTL）自动续期。」
- 缓存写入（5min）：「将请求前缀写入上下文缓存，缓存有效期（TTL）为 5 分钟；不指定 TTL 时默认按此档。」
- 缓存写入（1h）：「将请求前缀写入上下文缓存，缓存有效期（TTL）为 1 小时。」

### K2 系列（上下文窗口 262,144 tokens）

| 模型 ID（官方） | 输入 | 输出 | 缓存命中 | 缓存写入 | 缓存存储 | 生效时间 |
| --- | --- | --- | --- | --- | --- | --- |
| `kimi-k2.7-code` | ¥6.50 | ¥27.00 | ¥1.30 | 不支持缓存写入（批量页原文：「`kimi-k2.7-code`、`kimi-k2.6` 不支持缓存写入」；K2 价格表亦无写入列） | 未公布存储费 | 未公布 |
| `kimi-k2.7-code-highspeed` | ¥13.00 | ¥54.00 | ¥2.60 | 同上 | 未公布存储费 | 未公布 |
| `kimi-k2.6` | ¥6.50 | ¥27.00 | ¥1.10 | 同上 | 未公布存储费 | 未公布 |

### 已下线模型（无现行价格）

官方模型列表页确认以下系列/型号**已下线**，当前定价页不含其价格，本次核验**未能读取到现行单价**（来源状态：不适用/已下线，不猜测历史价格）：

- `moonshot-v1` 全系列（`moonshot-v1-8k` / `-32k` / `-128k` / `moonshot-v1-auto` / `-vision-preview` 系列）：**2026-08-31 下线**。
- `kimi-k2` 系列（`kimi-k2-0905-preview` / `-0711-preview` / `-turbo-preview` / `-thinking` / `-thinking-turbo`）：**2026-05-25 下线**。
- `kimi-k2.5`：2026-08-31 下线；`kimi-latest`：2026-01-28 下线；`kimi-thinking-preview`：2025-11-11 下线。

### K2 系列退出计划（官方公告，非价格）

「K2 系列模型将于 2026 年 10 月 31 日起停止向新注册用户开放，已注册用户不受影响；我们计划在 12 月底下线所有 K2 系列模型，请提前做好迁移准备。」（定价页与模型列表页原文；核验时点 2026-11-01，10-31 新注册截止已生效。）

## 缓存 TTL 与计费规则

来源：定价页（pricing/chat）+ 上下文缓存最佳实践（guide/context-caching.md）。

1. **自动启用**：「Kimi API 对重复的请求前缀**自动启用**上下文缓存计费，缓存有效期（TTL）默认为 5min」。Chat Completions / Responses 省略 `prompt_cache_options` 时默认按 `5m` TTL 读写缓存；Anthropic Messages 省略 `cache_control` 时同样默认 `5m`。
2. **TTL 档位**：仅 `5m` 与 `1h` 两档。设置方式：Chat/Responses 传 `prompt_cache_options: {"mode": "implicit", "ttl": "5m"|"1h"}`（`mode` 当前仅支持 `implicit`）；Messages 传请求顶层 `cache_control: {"type": "ephemeral", "ttl": "5m"|"1h"}`（消息体内的同名标记会被忽略）。
3. **计费方式**（官方定价原则，以 `kimi-k3` 为例）：
   - Input（缓存未命中）：未命中部分按输入价计费，每次请求单独计费；
   - Cache Write（5m / 1h）：前缀**首次写入缓存时一次性收取**，写入价按 TTL 档位不同（5m 档 ≈ 输入价 1×，1h 档 ≈ 输入价 2×，以各模型表为准）；
   - Cached Input（缓存命中）：命中部分按缓存命中价计费，每次请求单独计费，**不再重复收取缓存写入费用**；
   - 官方原文：「缓存写入的拆分是计费透明化。写入成本原先就包含在输入价格中，拆分后现有请求的整体费用不变」；「缓存命中价格是缓存未命中价格的 1/10」（以 `kimi-k3` 为例：命中 ¥2 vs 未命中 ¥20 / 1M tokens）。
4. **续期**：「命中缓存后缓存有效期（TTL）自动续期」——每次命中后有效期按原 TTL 重新计算，**续期免费**。
5. **TTL 锁定**：「缓存条目的 TTL 在首次写入时锁定，不能改写：相同前缀命中后按原 TTL 免费续期，新增部分也按锁定的 TTL 继续写入。已有条目完全过期后，才能用新的 TTL 重新写入。」
6. **过期与隔离**：缓存前缀无活动超过所选 TTL 后自动过期；缓存不支持手动清除；缓存按组织（org）隔离，同一组织内共享、组织之间不共享。
7. **缓存存储费**：官方页面**未公布**独立的缓存存储/保留费用（仅有写入与命中两项），本核验记为「未公布」，不推断为免费。
8. **usage 字段**（用于计量）：Chat Completions `usage.prompt_tokens_details.cached_tokens` / `cache_write_tokens`；Responses `usage.input_tokens_details.cached_tokens` / `cache_write_tokens`；Messages `usage.cache_read_input_tokens` / `usage.cache_creation_input_tokens`（另有 `usage.cache_creation.ephemeral_5m_input_tokens` / `ephemeral_1h_input_tokens` 分 TTL 记录写入）。Chat/Responses 下缓存读取、缓存写入、未缓存三者互斥，之和等于总输入 Token 数；流式需 `stream_options.include_usage=true` 才有完整明细。

## 批量与标准差别（Batch API）

来源：pricing/batch（含 JS payload 中价格表）与 changelog.md。

- **折扣**：批量推理 API 费用为标准模型价格的 **60%**（各项费用统一 6 折，含缓存命中与缓存写入）。
- **支持模型**：`kimi-k3.1-pro`、`kimi-k3`、`kimi-k2.7-code`、`kimi-k2.6`（**不含** `-highspeed` 高速版；2026-10 起 K3.1 Pro / K3 新增批量支持，此前仅 K2.7 Code / K2.6）。

批量价格表（CNY 元 / 1 MTok）：

| 模型 ID | 批量输入 | 批量输出 | 批量缓存命中 | 批量缓存写入（5min） | 批量缓存写入（1h） |
| --- | --- | --- | --- | --- | --- |
| `kimi-k3.1-pro` | ¥7.80 | ¥40.80 | ¥0.78 | ¥7.80 | ¥15.60 |
| `kimi-k3` | ¥12.00 | ¥60.00 | ¥1.20 | ¥12.00 | ¥24.00 |
| `kimi-k2.7-code` | ¥3.90 | ¥16.20 | ¥0.78 | —（不支持缓存写入） | — |
| `kimi-k2.6` | ¥3.90 | ¥16.20 | ¥0.66 | —（不支持缓存写入） | — |

- **缓存差异**：`kimi-k3.1-pro`、`kimi-k3` 的批量任务同样收取缓存写入费用；`kimi-k2.7-code`、`kimi-k2.6` 不支持缓存写入。批量请求异步并发处理，**缓存命中为尽力而为（best-effort），不保证命中**（批量表缓存命中列工具提示原文）。
- **运行差异**：Batch API 不受实时并发限制；任务需在指定 `completion_window` 内完成，超时变为 `expired` 状态。
- 备注：定价页（chat）正文称批量「`kimi-k3.1-pro` 与 `kimi-k3` 支持批量推理……各项费用为标准价格的 60%」，与批量定价页「Batch API 支持 `kimi-k3.1-pro`、`kimi-k3`、`kimi-k2.7-code` 和 `kimi-k2.6`」相比遗漏 K2 两个型号；以批量定价页（专门页面）为准，此处如实记录两处表述差异。

## 机器可读价格接口

- **不存在**稳定机器可读价格接口：OpenAPI 规范（https://platform.kimi.com/docs/openapi.json）中无 pricing/price 查询端点；`GET /v1/models` 返回 `id` / `created` / `owned_by` / `context_length` / `supports_image_in` / `supports_video_in` / `supports_reasoning` 等字段，**不含价格**；Billing 标签下仅有 `GET /v1/users/me/balance`（余额查询）。
- 官方文档提供 `.md` 镜像（如 /docs/pricing/chat.md），但价格表是运行时渲染的 DocTable 组件，**.md 中表格为空壳，不含单价**；单价目前只能从页面 HTML/JS payload 或渲染后的 DOM 文本获取，自动化解析依赖页面结构，属脆弱通道。
- 页面元数据：定价页 JSON-LD `dateModified` = 2026-10-30T12:10:01.248Z，可作为抓取结果时效性参照。

## 已知缺口

1. **单价生效日期未公布**：官方价格表无生效日期列，也无「未来生效价格」公告；`effectiveFrom` 只能记为未公布。仅能用页面 `dateModified`（2026-10-30T12:10:01.248Z）作为「截至该日有效」的近似锚点。
2. **缓存存储费未公布**：官方只列缓存命中与缓存写入两个计费桶，未见存储/保留费；不能推断为免费。
3. **K2 系列缓存 TTL 未单列**：K2 表仅列缓存命中价、无写入列；「TTL 默认 5min」的注记位于 K3 表下，K2 系列的 TTL 档位本次核验未能读取到官方明确说明（批量页仅明确 K2 不支持缓存写入）。
4. **已下线型号无现行价格**：`moonshot-v1` 全系、`kimi-k2` 系列、`kimi-k2.5`、`kimi-latest`、`kimi-thinking-preview` 已下线，官方现行页面不含其价格；本次核验未能读取（不猜测历史价格）。
5. **海外/美元计价未核验**：变更日志多处提及「国内外同步上线/全平台下线」，但本次核验仅覆盖 platform.kimi.com 中文站的 CNY 价格；是否存在海外站美元价目本次核验未能读取/解析，来源状态为不可用。
6. **搜索工具不可用**：`web_search` 因 API key 失效（HTTP 401）未能用于交叉验证第三方转述；所有数据均来自官方页面直抓。
7. **无价格变更预告渠道**：changelog 有功能/模型上下线记录，但无独立价格生效公告页；2025-04 changelog 仅提到「模型产品降价」未附价目。

## 结论

- **可自动计价：是（带条件）**。六个在售型号（`kimi-k3.1-pro`、`kimi-k3.1-pro-highspeed`、`kimi-k3`、`kimi-k2.7-code`、`kimi-k2.7-code-highspeed`、`kimi-k2.6`）的输入、输出、缓存命中、缓存写入（K3 系列 5min/1h 两档）单价均已在官方页面逐桶核实，币种 CNY、单位元/1 MTok，批量为标准价 60%（四个型号，不含高速版）；配合 usage 字段（cached_tokens / cache_write_tokens 等）可实现按量计价。
- **自动化风险**：官方无机器可读价格接口，.md 镜像不含表格数据，解析需依赖网页 HTML/JS 结构（脆弱）；单价生效日期、缓存存储费、K2 缓存 TTL 为已知缺口，计量模型需显式处理「未知」而非补默认值。
- **时效性**：K2 系列计划 2026 年 12 月底下线（2026-10-31 起对新注册用户停开），价格样本应在此之前向 K3 系列迁移；`moonshot-v1` 系列已于 2026-08-31 下线，若插件中存在 moonshot-v1 计价条目应标记为已下线。
- 同名脱敏样本见 `test/fixtures/pricing/kimi.sample.json`。
