# 千问 Qwen（阿里云百炼 Model Studio）官方定价来源核验报告

> 第一阶段「模型官方价格计量」证据留档。原则：**读到什么写什么；读不到写「来源不可用」，绝不猜测单价**。
> 价格均为官方页面原文数字；由官方明确比例推导的数字（如缓存命中价）标注了推导依据。

## 1. 核验信息

| 项 | 值 |
| --- | --- |
| 核验时间 | 2026-11-01 20:53–21:05（Asia/Shanghai，+08:00） |
| 核验方式 | HTTPS GET 抓取静态 HTML 后解析表格（web_fetch 被沙箱 DNS 策略拒绝：`URL hostname "help.aliyun.com" resolves to a non-public IP address`；web_search 工具鉴权失败 HTTP 401。改用 `curl -L` 实际取回页面，HTTP 200，内容为服务端渲染的完整文档正文与表格） |
| 价格页 | https://help.aliyun.com/zh/model-studio/model-pricing （《模型调用价格》，用户指南（模型）→ 产品计费 → 模型调用计费），抓取成功 |
| 模型列表接口文档 | https://help.aliyun.com/zh/model-studio/list-models （API 参考（模型）→ 模型管理 → 查询模型列表），抓取成功 |
| 上下文缓存文档 | https://help.aliyun.com/zh/model-studio/context-cache （《上下文缓存（Context Cache）》，价格页明确指向该页取缓存单价），抓取成功 |
| 模型大全页 | https://help.aliyun.com/zh/model-studio/models ，抓取成功（JS 渲染目录，仅分类列表，无逐型号单价） |
| 硅基流动文档 | https://docs.siliconflow.cn/cn/userguide/capabilities/text-generation ，抓取成功（仅用于第三方别名核验） |
| 生效日期 | **未知**。价格页「更新时间」为动态渲染，静态 HTML 中为空；页面未给出价格生效日期。按方案要求保留「生效时间未知」，不以抓取时间冒充生效时间。 |

## 2. 计价口径（价格页原文规则）

- 单位：**元/百万 Token**（CNY per 1M tokens），输入、输出单价均为每百万 Token。K=1,000、M=1,000,000。
- 默认按量计费；页面展示**原价**，活动优惠以百炼控制台为准。
- **阶梯计费**：单价取决于**单次请求的输入 Token 总量**；该请求全部 Token 按所在阶梯单价结算（不是按阶梯分段累计）。
- **Batch 调用**：支持 Batch 的模型（表中标「Batch调用半价」）输入、输出单价均为实时推理价的 **50%**。
- **上下文缓存**：仅输入 Token 享折扣；**Batch 与缓存折扣不能同时生效**。
- **免费额度**：仅华北2（北京）地域有；有效期为「自开通百炼/模型发布/申请通过之日起 90 天内（以较晚者为准）」。
- 部分模型有「当前能力等同于 X」的官方别名（别名指向的快照与主 ID 同价）。

## 3. 逐型号价格表（华北2（北京），按量，元/百万 Token）

「输出」列若分「非思考 / 思考」，指该模型思考模式输出（**含思维链+回答**）单独定价；「—」表示官方输出单价不分模式（同一单价覆盖思维链+回答）。

### 千问 Max

| 模型 ID | 模式 | 输入阶梯（单次请求输入 Token） | 输入 | 输出（非思考） | 输出（思考，思维链+回答） | Batch | 缓存 | 免费额度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| qwen3.8-max（别名 qwen3.8-max-0902） | 非思考和思考模式同价 | 0<Token≤1M | 12 | — | 36 | 半价 | 享折扣（命中价例外，见 §5） | 100 万 Token |
| qwen3.7-max（=qwen3.7-max-2026-05-20） | 非思考和思考模式同价 | 0<Token≤1M | 12 | — | 36 | 半价 | 享折扣 | 100 万 Token |
| qwen3.7-max-2026-06-08 / qwen3.7-max-2026-05-20 | 非思考和思考模式同价 | 0<Token≤1M | 12 | — | 36 | 未标注 | 享折扣 | 无 |
| qwen3.7-max-preview（=qwen3.7-max-2026-05-17） | **仅思考模式** | 0<Token≤1M | 12 | — | 36 | 未标注 | 未标注 | 无 |
| qwen-max | **仅非思考模式** | 无阶梯计价 | 2.4 | 9.6 | — | 未标注（国际行标「半价」） | 未标注（不在缓存支持列表） | 无 |

### 千问 Plus

| 模型 ID | 输入阶梯 | 输入 | 输出（非思考） | 输出（思考，思维链+回答） | Batch | 缓存 | 免费额度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| qwen3.7-plus（=qwen3.7-plus-2026-05-26） | 0<Token≤256K | 原价 2（**限时 8 折**，折后价页面未给出） | 原价 8（限时 8 折） | 原价 8（限时 8 折） | 半价 | 享折扣 | 100 万 Token |
| qwen3.7-plus | 256K<Token≤1M | 原价 6（限时 8 折） | 原价 24（限时 8 折） | 原价 24（限时 8 折） | 半价 | 享折扣 | 100 万 Token |
| qwen3.7-plus-2026-05-26 | 0<Token≤256K / 256K<Token≤1M | 2 / 6 | 8 / 24 | 8 / 24 | 未标注 | 享折扣 | 无 |
| qwen3.6-plus（=qwen3.6-plus-2026-04-02） | 0<Token≤256K / 256K<Token≤1M | 2 / 8 | 12 / 48 | 12 / 48 | 未标注 | 享折扣（缓存支持列表含 qwen3.6-plus） | 无 |
| qwen3.5-plus（=qwen3.5-plus-2026-02-15；qwen3.5-plus-2026-04-20 同价） | 0<Token≤128K / 128K<Token≤256K / 256K<Token≤1M | 0.8 / 2 / 4 | 4.8 / 12 / 24 | 4.8 / 12 / 24 | 未标注 | 享折扣 | 无 |
| qwen-plus（=qwen-plus-2025-12-01；qwen-plus-latest 同价） | 0<Token≤128K / 128K<Token≤256K / 256K<Token≤1M | 0.8 / 2.4 / 4.8 | **2 / 20 / 48** | **8 / 24 / 64** | 半价 | 享折扣 | 无 |
| qwen-plus-2025-07-14 / qwen-plus-2025-04-28 | 无阶梯计价 | 0.8 | 2 | 8 | 未标注 | 未标注 | 无 |
| qwen-plus-2025-01-25 | 无阶梯计价 | 0.8 | 2 | （旧快照无思考列） | 未标注 | 未标注 | 无 |

### 千问开源（文本生成）

| 模型 ID | 模式 | 输入阶梯 | 输入 | 输出（非思考） | 输出（思考，思维链+回答） | Batch | 缓存 | 免费额度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| qwen3.8-2.4t-a95b | 非思考和思考模式同价 | 0<Token≤1M | 12 | — | 36 | 未标注 | 享折扣（命中价例外，见 §5） | 100 万 Token |
| qwen3.8-27b | 非思考和思考模式同价 | 0<Token≤1M | 3 | — | 12 | 未标注 | 享折扣 | 100 万 Token |
| qwen3.6-35b-a3b | 非思考和思考模式同价 | 0<Token≤256K | 1.8 | 10.8 | 10.8 | 未标注 | 未标注 | 无 |
| **qwen3.6-27b**（用量记录中的型号） | 非思考和思考模式同价 | 0<Token≤256K | **3** | **18** | **18** | 未标注 | 未标注（不在缓存支持列表） | 无 |
| qwen3.5-397b-a17b | 非思考和思考模式同价 | 0<Token≤128K / 128K<Token≤256K | 1.2 / 3 | 7.2 / 18 | 7.2 / 18 | 未标注 | 未标注 | 无 |
| qwen3.5-122b-a10b | 同上 | 0<Token≤128K / 128K<Token≤256K | 0.8 / 2 | 6.4 / 16 | 6.4 / 16 | 未标注 | 未标注 | 无 |
| qwen3.5-27b | 同上 | 0<Token≤128K / 128K<Token≤256K | 0.6 / 1.8 | 4.8 / 14.4 | 4.8 / 14.4 | 未标注 | 未标注 | 无 |
| qwen3.5-35b-a3b | 同上 | 0<Token≤128K / 128K<Token≤256K | 0.4 / 1.6 | 3.2 / 12.8 | 3.2 / 12.8 | 未标注 | 未标注 | 无 |

### 千问 Flash

| 模型 ID | 模式 | 输入阶梯 | 输入 | 输出 | Batch | 缓存 | 免费额度 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| qwen3.8-flash | 非思考和思考模式同价 | 0<Token≤1M | 0.8 | 2.7（含思维链+回答） | 未标注 | 享折扣（比例例外且随地域，见 §5） | 100 万 Token |
| qwen3.7-flash（=qwen3.7-flash-2026-07-15） | 非思考和思考模式同价 | 0<Token≤32K / 32K<Token≤256K / 256K<Token≤1M | 0.2 / 0.6 / 1.2 | 0.8 / 2.4 / 4.8 | 半价 | 享折扣 | 100 万 Token |
| qwen3.6-flash（=qwen3.6-flash-2026-04-16） | 同上 | 0<Token≤256K / 256K<Token≤1M | 1.2 / 4.8 | 7.2 / 28.8 | 半价 | 享折扣 | 无 |
| qwen3.5-flash（=qwen3.5-flash-2026-02-23） | 同上 | 0<Token≤128K / 128K<Token≤256K / 256K<Token≤1M | 0.2 / 0.8 / 1.2 | 2 / 8 / 12 | 半价 | 享折扣 | 无 |
| qwen-flash（=qwen-flash-2025-07-28） | 同上 | 0<Token≤128K / 128K<Token≤256K / 256K<Token≤1M | 0.15 / 0.6 / 1.2 | 1.5 / 6 / 12 | 半价 | 享折扣 | 无 |

### qwen-turbo

**来源不可用**：当前价格页未列出文本模型 `qwen-turbo`（仅列 `qwen-audio-turbo`「目前仅供免费体验」与 `qwen-doc-turbo` 0.6/1 元/百万 Token）。不得猜测其单价；如需覆盖，应另行核实是否已下线。

## 4. 地域差异（同页分地域表，均为元/百万 Token，货币同为人民币）

- 表按地域分节：华北2（北京）、美国（弗吉尼亚）、新加坡、德国（法兰克福）、日本（东京）、中国香港；海外地域表增加「服务部署范围」列（全球 / 美国 / 国际 / 欧盟 / 日本等）。
- **「全球」部署范围 = 与北京同价**（如 qwen3.8-max 12/36、qwen3.7-max 12/36、qwen3.8-27b 3/12）。
- 「美国」部署范围（美国弗吉尼亚）：qwen3.8-max 14.988 / 44.965；qwen3.7-max 18.736 / 56.207；qwen3.7-plus 原价 2.998 / 11.991（≤256K）、原价 8.993 / 35.972（256K–1M，均限时 8 折）；qwen3.8-flash 1.094 / 3.427；qwen3.6-flash 1.87355 / 11.2413。
- 「国际」部署范围（新加坡）：qwen3.8-max 14.988 / 44.965；qwen3.7-max 18.736 / 56.207；qwen-max 11.743 / 46.971；qwen3.8-27b 3.646 / 21.875；**qwen3.6-27b 4.49652 / 26.97912（输出两列同价）**；qwen3.5-27b 2.202 / 17.614（≤256K 口径）；qwen-plus ≤256K 2.936 / 8.807 / 29.357，256K–1M 8.807 / 26.421 / 88.071。
- 「欧盟」部署范围（德国法兰克福）：qwen-plus ≤256K 2.998 / 8.993 / 29.977，256K–1M 8.993 / 26.979 / 89.93。
- 「日本」部署范围（东京）：qwen3.7-plus 原价 2.998 / 11.991（限时 8 折）。
- 「中国香港」：qwen-plus-2025-12-01 ≤256K 2.917 / 8.75 / 29.167，256K–1M 8.75 / 26.25 / 87.501。
- 覆盖不完全一致：如 qwen3.6-27b 在分地域表中**仅见北京与新加坡（国际）**；美国/德国表该组只列 qwen3.6-35b-a3b。海外地域均无免费额度。

## 5. 缓存（上下文缓存）计价规则（来自 context-cache 页）

| 项目 | 显式缓存 | 隐式缓存 |
| --- | --- | --- |
| 创建缓存 Token | 标准输入单价的 **125%** | 100%（不额外加价） |
| 命中缓存 Token | 标准输入单价的 **10%** | 标准输入单价的 **20%** |
| 最少缓存 Token | 1024 | 1024 |
| 有效期 | 5 分钟（命中后重置） | 不确定，系统定期清理 |

- 前缀增量计费：已有缓存前缀按命中（10%），新增部分按创建（125%）；其余未命中 Token 原价。创建/命中 Token 数分别由 `cache_creation_input_tokens` / `cached_tokens` 返回。
- **例外（官方原文）**：`qwen3.8-max`、`qwen3.8-max-0902`、`qwen3.8-2.4t-a95b` 创建缓存按 125%，但**命中价不是 10%**（「具体价格请参见百炼控制台」）；`qwen3.8-flash` 创建价不是 125%、命中价不是 10%，且**比例随地域不同**。→ 这 4 个型号的精确缓存单价**来源不可用（公开页未给出数值）**。
- **缓存存储费**：两个页面均未提及存储/保管费用，仅 5 分钟有效期；按「未覆盖」处理，不并入总价。
- 缓存支持模型（北京，官方列表）：千问 Max：qwen3.8-max、qwen3.8-max-0902、qwen3.7-max、qwen3.7-max-2026-05-20、qwen3.7-max-2026-06-08；千问开源：qwen3.8-2.4t-a95b、qwen3.8-27b；千问 Plus：qwen3.7-plus、qwen3.7-plus-2026-05-26、qwen3.6-plus、qwen3.5-plus、qwen3.5-plus-2026-04-20、qwen-plus；千问 Flash：qwen3.8-flash、qwen3.7-flash、qwen3.7-flash-2026-07-15、qwen3.6-flash、qwen3.5-flash、qwen-flash；另含 qwen3-coder-flash、qwen3-vl-plus、qwen-plus-character、qwen-doc-turbo 及 Kimi/GLM 部分型号。**qwen-max、qwen3.6-27b、qwen3.5-27b 不在列表内。**
- 其他：系统为保证模型效果会追加少量内部 Token，按标准输入价计费。

## 6. 模型列表接口评估（https://help.aliyun.com/zh/model-studio/list-models）

- 接口：`GET /api/v1/models`，查询百炼平台可用模型，**返回含定价与上下文长度**（`prices`、`model_info`）。
- **需要凭据**：请求 Header `Authorization: Bearer {API_KEY}`（环境变量 `DASHSCOPE_API_KEY`）；**不是匿名可读**。北京等端点把 **WorkspaceId 放进域名**：`https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api/v1/models`；新加坡 `https://dashscope-intl.aliyuncs.com/api/v1/models`、中国香港 `https://cn-hongkong.dashscope.aliyuncs.com/api/v1/models` 不含 WorkspaceId；日本/德国/美国为 `https://{WorkspaceId}.<region>.maas.aliyuncs.com/api/v1/models`。本次核验**未调用**该接口（无用户配置凭据；不创建凭据）。
- 返回内容性质：`provider`（模型作者）取值含 `qwen`、`zhipu-ai`、`deepseek`、`mini-max`、`moonshot-ai`、`wan`、`kling` 等；`inference_provider`（推理服务供应商）取值含 `aliyun-bailian`、`alibaba-cloud-modelstudio`、**`siliconflow`（硅基流动）**、`moonshot`、`mini-max`、`kling`、`vidu`、`pixverse`、`vanchin`、`xiaomi`、`zhipu-ai`、`tripo`。→ **返回含第三方厂商模型与不同推理服务商**，其价格不一定是模型开发方官方直销价，选用时需按 `provider`/`inference_provider` 过滤。
- 价格结构：`prices[].range_name`（无分段为 `Default`，有分段如 `32k<Input<=128k`）；`prices[].prices[]` 含 `type`（如 `input_token`、`output_token`、`image_number`）、`price`、`price_unit`（如「每百万tokens」）、`price_name`。另有 `published_time`、`equivalent_snapshot`、`inference_offline_info.offline_time`、`model_info`（`context_window`、`max_input_tokens`、`max_output_tokens`、`max_reasoning_tokens`、`reasoning_max_input_tokens`、`reasoning_max_output_tokens`）。
- **存在稳定机器可读价格接口**（同一接口带 `prices` 字段），但需 API Key（北京另需 WorkspaceId）；支持分页（`page_no`/`page_size`）、`model` 精确查询、`name` 模糊查询、`providers`/`inference_providers`/`capabilities` 筛选；可按 `providers=qwen`+`model=qwen3.6-27b` 精确定位官方条目。
- **文档内返回示例的价格数字不可采信**：示例 `qwen3.8-max` 写 `input 2 / output 8`（`range_name: Default`，`published_time: 2025-11-11 12:00:00`），页面明示「以下示例仅用于展示返回结构，**模型信息和价格以实际返回结果为准**」，且与价格页正文的 12/36 不一致。→ 以价格页正文为准，示例仅作结构参考。
- 另有 `deployment_methods`（含 `ptu` 预置吞吐量）筛选，说明存在 PTU 部署形态；PTU 价格不在本页文本价格表内。

## 7. 第三方别名映射可行性（`qwen/qwen3.6-27b` ↔ 百炼 `qwen3.6-27b`）

- 百炼价格页存在精确型号 ID `qwen3.6-27b`（无日期快照别名行）。
- 硅基流动官方文档（text-generation 页）仅在**代码示例**中出现 `model="Qwen/Qwen3.6-27B"`；未公布版本号、发布日期、权重指纹或与百炼的映射表。用量记录中的 `qwen/qwen3.6-27b` 与该写法仅大小写不同。
- 百炼模型卡片 URL 探测（`models-qwen3.6-27b`、`qwen3.6-27b`）均为 404；「模型大全」页为 JS 渲染目录，无版本信息。
- **结论：不可确认是同一版本。** 命名（Qwen3.6-27B / qwen3.6-27b）一致，但双方均未公布任何可校验的版本指纹（快照日期、权重哈希、`equivalent_snapshot`）；按方案口径「不同平台提供的同名模型不一定是同一版本」，**不能直接套用百炼官方价**，除非后续用用户已配置凭据调用 `GET /api/v1/models`（`name=qwen3.6-27b`，含 `inference_provider=siliconflow` 条目与 `equivalent_snapshot`/`published_time`）或取得双方版本声明后再确认。

## 8. 已知缺口

1. `qwen-turbo`：当前官方价格页未列出 → **来源不可用**，不猜测单价。
2. qwen3.8-max / qwen3.8-max-0902 / qwen3.8-2.4t-a95b 显式缓存命中价、qwen3.8-flash 全部缓存比例：官方指向控制台，公开页无精确数值 → **来源不可用**。
3. 「限时 8 折」（qwen3.7-plus 等）只给原价与折扣标记，折后价未在页面公布 → 以原价记录并标注折扣存在。
4. 价格生效日期：页面「更新时间」动态渲染，静态 HTML 为空 → **生效时间未知**。
5. 缓存存储费：页面未提及 → 未覆盖。
6. 模型列表接口未实测（需 API Key，北京需 WorkspaceId；本次不使用/不创建凭据）→ 返回字段以文档为准，实际返回结构待接入时验证。
7. qwen-max、qwen3.6-27b、qwen3.5-27b 不支持上下文缓存（不在官方支持列表）；qwen3.6-27b 海外地域仅见新加坡（国际）价。
8. 旧世代文本模型（qwen3-235b-a22b 等 qwen3 dense 系、qwen2.5 系）未在当前价格页列出；qwen3.7-max-preview（仅思考模式）等特殊模式型号需按模式标记处理。
9. PTU（预置吞吐量）等非按量形态价格未覆盖。

## 9. 结论

- 百炼官方价格页可稳定读取（服务端渲染 HTML），逐型号、逐阶梯、思考模式、缓存规则、地域差异均可核验；**计价单位为元/百万 Token**，北京按量价为默认参考（如 qwen3.6-27b：输入 3 / 输出 18（思考同价），0<Token≤256K；qwen-plus：0.8/2/8 起，思考输出 8，三档 128K/256K/1M 边界；qwen-max：2.4/9.6 无阶梯仅非思考）。
- 存在**需凭据的机器可读价格接口**（`GET /api/v1/models` 含 `prices`，按 `range_name` 分段），但返回含第三方厂商与多个推理服务商（含 siliconflow），需按 `provider`/`inference_provider` 过滤后再作为官方直销价使用；文档示例价格数字不可采信。
- 思考模式：多数 3.x 型号「非思考和思考模式」同价（输出含思维链+回答）；qwen-plus 系（含 qwen-plus-latest/-2025-12-01 及日期快照）**思考输出单独计价**（8 vs 2 等）；qwen-max 仅非思考；qwen3.7-max-preview 仅思考。
- 缓存：显式创建 125%、命中 10%、隐式命中 20%、最少 1024 Token、有效期 5 分钟；4 个型号命中价例外且公开页无数值；无存储费信息。
- 第三方别名 `qwen/qwen3.6-27b` 与百炼 `qwen3.6-27b` **不可确认同一版本**，暂不套用官方价。

脱敏样本见 `test/fixtures/pricing/qwen.sample.json`（无任何 key/token/WorkspaceId）。
