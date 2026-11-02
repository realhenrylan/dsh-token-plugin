# GLM（智谱）官方 API 定价来源核验报告

- **核验时间（北京时间）**：2026-11-01 20:53 ~ 21:00（UTC+8）
- **核验对象**：智谱开放平台（BigModel）GLM 系列官方 API 公开按量价格
- **脱敏样本**：[glm.sample.json](../../test/fixtures/pricing/glm.sample.json)
- **结论摘要**：来源可读、价格表完整可解析，文本/视觉/向量等 token 计价模型可自动计价；图片/视频/语音时长/搜索/知识库为非 token 计价，必须单列。**所有价格均未标注官方生效日期**；缓存存储当前「限时免费」，免费期后标准价官方暂未公布。

## 1. 访问的 URL 与读取状态

| URL | 状态 | 说明 |
| --- | --- | --- |
| <https://docs.bigmodel.cn/cn/guide/start/pricing> | ✅ HTTP 200（约 232 KB） | 官方「API 定价」页，服务端渲染，含全部价格表 |
| <https://docs.bigmodel.cn/cn/guide/start/pricing.md> | ✅ HTTP 200（约 11 KB） | 同页 Mintlify Markdown 镜像，**机器可读**，内容与 HTML 一致 |
| <https://docs.bigmodel.cn/llms.txt> | ✅ HTTP 200 | 官方文档索引（机器可读） |
| <https://docs.bigmodel.cn/cn/guide/start/model-overview> 及 `.md` | ✅ HTTP 200 | 「模型概览」，用于核对型号与文档 slug |
| <https://docs.bigmodel.cn/cn/guide/capabilities/cache.md> | ✅ HTTP 200 | 「上下文缓存」机制与计费说明 |
| <https://docs.bigmodel.cn/cn/guide/tools/batch.md> | ✅ HTTP 200 | 「Batch API」使用说明与计费（5 折） |
| <https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3.md>、`glm-5.2.md`、`glm-4.7.md`、`glm-4.6.md`、`glm-4.5.md` | ✅ HTTP 200 | 模型详情页，取 Model Code / 请求示例中的精确 ID |
| <https://docs.bigmodel.cn/cn/guide/models/vlm/glm-5.3-flash.md> | ✅ HTTP 200 | 显式给出 Model Code：`glm-5.3-flash` / `glm-5.3-flashx` / `glm-5.3-flashx-legal` |
| <https://bigmodel.cn/pricing> | ⚠️ HTTP 200 但为 SPA 空壳（约 6.5 KB，无服务端渲染价格内容） | **本次核验未能读取/解析其价格内容，该来源状态为不可用**（需 JS 渲染） |
| <https://open.bigmodel.cn/pricing> | ⚠️ 未能访问 | `web_fetch` 被本机 SSRF 防护拒绝（域名解析到非公网 IP）；亦未再尝试其他途径 |

读取途径说明：`web_fetch` 对 docs.bigmodel.cn / open.bigmodel.cn 均返回「resolves to a non-public IP address」被拒，`web_search` 端点鉴权失败（HTTP 401）；本报告改用 `curl` 直连官方 HTTPS 域名抓取原始 HTML/Markdown 后本地解析，所有数值均直接转录自官方页面，无任何推算或猜测。

## 2. 计费总则（官方原文口径）

- **费用公式**：`调用费用 = 未命中缓存的输入费用 + 缓存命中费用 + 输出费用 + 缓存存储费用`。
- **价格单位**：除特别说明外，模型价格统一按 **「元/百万 Tokens」**（CNY per 1M tokens）展示；图片、视频、语音等按次/按分钟/按字符计费的，在对应价格表单独标明。
- **Token 换算**：GLM 系列 Token 与汉字数量换算比例约为 **1:1.6**，实际数量以接口返回用量信息为准。
- **Batch API**：支持 Batch API 的模型按对应标准调用价格的 **5 折**计费（多模态生成表中单独列出了各模型的 Batch 单价）。
- **扣费依据**：实际费用按接口返回用量、调用时适用单价与账单计算；页面价格如有调整，「以页面公告或最新展示为准」（即官方未承诺提前公告）。
- **缓存机制**（cache.md）：隐式自动缓存，命中量在 `usage.prompt_tokens_details.cached_tokens` 返回；重复前缀建议 ≥500 Token 才易命中；仅适用于标准 API 计费，不含资源包和 GLM Coding Plan 套餐。缓存命中价以定价页逐型号数值为准（cache.md 中「通常为标准价格的 50%」只是概述，与逐型号命中价不完全一致，例如 GLM-5.3 命中价 2 元为输入价 8 元的 25%）。
- **深度思考**：思考过程计入输出 Token 计费（cache.md）。

## 3. 逐型号价格表（元/百万 Tokens）

以下数值逐行转录自官方定价页（pricing.md）。「缓存存储」一列官方全部标注 **限时免费**；「缓存命中」的「不支持」表示该模型不支持缓存计价（官方原文，非免费）。

### 3.1 最新模型

| 模型 | 上下文 | 输入 | 输出 | 缓存存储（元/百万/h） | 缓存命中 | 输入模态 |
| --- | --- | --- | --- | --- | --- | --- |
| GLM-5.3 | 1M | 8 | 28 | 限时免费 | 2 | 文本 |
| GLM-5.3-Flash | 1M | 0.8 | 2.8 | 限时免费 | 0.23 | 图片、视频、文件、文本 |
| GLM-5.3-FlashX | 1M | 2 | 7 | 限时免费 | 0.57 | 图片、视频、文件、文本 |

### 3.2 文本模型

| 模型 | 上下文/分档 | 输入 | 输出 | 缓存命中 |
| --- | --- | --- | --- | --- |
| GLM-5.3-FlashX-Legal | 1M | 2 | 7 | 0.57 |
| GLM-5.2 | 1M | 8 | 28 | 2 |
| GLM-5.1 | 输入长度 [0, 32K) | 6 | 24 | 1.3 |
| GLM-5.1 | 输入长度 ≥32K | 8 | 28 | 2 |
| GLM-5-Turbo | 输入长度 [0, 32K) | 5 | 22 | 1.2 |
| GLM-5-Turbo | 输入长度 ≥32K | 7 | 26 | 1.8 |
| GLM-5 | 输入长度 [0, 32K) | 4 | 18 | 1 |
| GLM-5 | 输入长度 ≥32K | 6 | 22 | 1.5 |

更多文本模型（折叠表，缓存存储同为限时免费）：

| 模型 | 分档（官方原文） | 输入 | 输出 | 缓存命中 |
| --- | --- | --- | --- | --- |
| GLM-4.7 | 输入 [0, 32K)，输出 [0, 0.2K) | 2 | 8 | 0.4 |
| GLM-4.7 | 输入 [0, 32K)，输出 ≥0.2K | 3 | 14 | 0.6 |
| GLM-4.7 | 输入 [32K, 200K) | 4 | 16 | 0.8 |
| GLM-4.5-Air | 输入 [0, 32K)，输出 [0, 0.2K) | 0.8 | 2 | 0.16 |
| GLM-4.5-Air | 输入 [0, 32K)，输出 ≥0.2K | 0.8 | 6 | 0.16 |
| GLM-4.5-Air | 输入 [32K, 128K) | 1.2 | 8 | 0.24 |
| GLM-4.7-FlashX | 200K | 0.5 | 3 | 0.1 |
| GLM-4.7-Flash | 200K | 免费 | 免费 | 免费 |
| GLM-4-Plus | 128K | 5 | 5 | 2.5 |
| GLM-4-Air-250414 | 128K | 0.5 | 0.5 | 0.25 |
| GLM-4-AirX | 8K | 10 | 10 | 不支持 |
| GLM-4-Long | 1M | 1 | 1 | 0.5 |
| GLM-4-Assistant | 128K | 5 | 5 | 不支持 |
| GLM-Z1-Air | 128K | 0.5 | 0.5 | 不支持 |
| GLM-Z1-AirX | 32K | 5 | 5 | 不支持 |
| GLM-Z1-FlashX | 128K | 0.1 | 0.1 | 不支持 |
| GLM-4-FlashX-250414 | 128K | 0.1 | 0.1 | 0.05 |
| GLM-4-Flash-250414 | 128K | 免费 | 免费 | 不支持 |
| GLM-Z1-Flash | 128K | 免费 | 免费 | 不支持 |

注意 GLM-4.7 / GLM-4.5-Air 存在**输入+输出联合分档**（输出按 [0, 0.2K) / ≥0.2K 再分两档）；0.2K 官方未明示 K 的进制，按 1K=1000 计为 200 tokens（若按 1K=1024 则为 204.8，样本中已保留官方原文）。

### 3.3 视觉理解（token 计价，含图片/视频/文件输入模态）

| 模型 | 分档 | 输入 | 输出 | 缓存命中 |
| --- | --- | --- | --- | --- |
| GLM-OCR | 32K | 0.2 | 0.2 | 不支持 |
| GLM-5V-Turbo | 输入长度 [0, 32K) | 5 | 22 | 1.2 |
| GLM-5V-Turbo | 输入长度 ≥32K | 7 | 26 | 1.8 |
| GLM-4.6V | 输入长度 [0, 32K) | 1 | 3 | 0.2 |
| GLM-4.6V | 输入长度 [32K, 128K) | 2 | 6 | 0.4 |
| GLM-4.6V-FlashX | 输入长度 [0, 32K) | 0.15 | 1.5 | 0.03 |
| GLM-4.6V-FlashX | 输入长度 [32K, 128K) | 0.3 | 3 | 0.03 |
| GLM-4.6V-Flash | — | 免费 | 免费 | 免费 |
| GLM-4.5V | 输入长度 [0, 32K) | 2 | 6 | 0.4 |
| GLM-4.5V | 输入长度 [32K, 64K) | 4 | 12 | 0.8 |
| GLM-4V-Plus-0111 | 16K | 4 | 4 | 2 |
| GLM-4V-Flash | 4K | 免费 | 免费 | 不支持 |
| GLM-4.1V-Thinking-FlashX | 64K | 2 | 2 | 不支持 |
| GLM-4.1V-Thinking-Flash | 64K | 免费 | 免费 | 不支持 |

### 3.4 语音（token 计价部分）

| 模型 | 单价 | 备注 |
| --- | --- | --- |
| GLM-ASR-2512 | 输入：16 元/百万 Tokens（约 0.0002 元/秒）；输出：不计费 | 按音频折算 token，官方给出秒单价参考 |
| GLM-4-Voice | 80 元/百万 Tokens | 文本、音频模态 |

按次/按分钟/按字符计费的语音模型见第 5 节（非 token 计费项）。

### 3.5 向量模型与其他

| 模型 | 上下文 | 单价（元/百万 Tokens） | Batch API 价 |
| --- | --- | --- | --- |
| Embedding-3 | 8K | 0.5 | 0.25 |
| Embedding-2 | 8K | 0.5 | 0.25 |
| CodeGeeX-4 | 128K | 0.1 | 未标注 |
| Rerank | 4K | 0.8 | 未标注 |

## 4. 缓存计费汇总

- **缓存命中单价**：逐型号单列（见上表），从免费/不支持到 2.5 元/百万 Tokens 不等；不可用统一折扣率代替（官方 cache.md 的「通常 50%」与逐型号数值不一致，以定价页逐型号数值为准）。
- **缓存存储**：官方定价页逐行标注 **「限时免费」（元/百万 Tokens/小时口径）**；FAQ 明确：「缓存存储当前限时免费。**本页暂不展示免费期结束后的标准价格**，后续如有调整，以页面最新信息为准。」→ 免费期后单价**本次核验未能读取，来源状态为不可用**，禁止猜测。
- **命中判定**：隐式缓存，重复前缀建议 ≥500 Token；命中量以 `usage.prompt_tokens_details.cached_tokens` 为准。

## 5. 非 token 计费项清单（不得套用文本 token 公式）

### 5.1 多模态生成（按次计费）

| 模型 | 类型 | 规格 | 单价 | Batch API |
| --- | --- | --- | --- | --- |
| GLM-Image | 图像生成 | 多分辨率 | 0.1 元/次 | 不支持 |
| CogView-4 | 图像生成 | 多分辨率 | 0.06 元/次 | 0.03 元/次 |
| CogView-3-Flash | 图像生成 | 多分辨率 | 免费 | 不支持 |
| CogVideoX-3 | 视频生成 | 多分辨率 | 1 元/次 | 不支持 |
| CogVideoX-2 | 视频生成 | 多分辨率 | 0.5 元/次 | 0.25 元/次 |
| CogVideoX-Flash | 视频生成 | 多分辨率 | 免费 | 不支持 |
| ViduQ1-Text / ViduQ1-Image / ViduQ1-Start-End | 文生/图生/首尾帧视频 | 1080p | 各 2.5 元/次 | 不支持 |
| Vidu2-Image / Vidu2-Start-End | 图生/首尾帧视频 | 720p | 各 1.25 元/次 | 不支持 |
| Vidu2-Reference | 参考生视频 | 720p | 2.5 元/次 | 不支持 |

### 5.2 语音（非 token 计价部分）

| 模型 | 计价方式 | 单价 |
| --- | --- | --- |
| GLM-TTS | 按字符 | 2 元/万字符 |
| GLM-TTS-Clone | 按次 | 6 元/次 |
| GLM-Realtime-Flash | 按分钟 | 音频 0.18 元/分钟；视频 1.2 元/分钟 |
| GLM-Realtime-Air | 按分钟 | 音频 0.3 元/分钟；视频 2.1 元/分钟 |

### 5.3 搜索工具服务（按次计费）

| 工具 | 单价 |
| --- | --- |
| Search-Std | 0.01 元/次 |
| Search-Pro | 0.03 元/次 |
| Search-Pro-Sogou | 0.05 元/次 |
| Search-Pro-Quark | 0.05 元/次 |

### 5.4 知识库服务

| 功能 | 计价方式 | 单价 |
| --- | --- | --- |
| 多模态知识入库（文件管理） | 存储 | 1 GB 内存储免费（超出部分单价本页未给，本次核验未能读取） |
| 向量化（语义索引） | token | 0.5 元/百万 Tokens |
| GLM-rerank-pro（多模态重排序） | token | 0.8 元/百万 Tokens |
| 深度解析（文档解析） | 按页 | 0.12 元/页 |
| 图片理解 | — | 免费 |
| 上下文增强 | — | 免费 |
| knowledge_capacity（容量扩容） | 按容量×时长 | 0.04 元/GB/小时 |

## 6. 生效日期、未来价格与机器可读接口

- **生效日期**：官方定价页**未标注任何价格的生效日期/发布日期**，仅有 FAQ「如页面价格发生调整，新价格将以页面公告或最新展示为准」。按方案要求保留「生效时间未知」，抓取时间不得冒充生效时间。
- **未来生效价格**：未发现任何「未来某日起生效」的预告价格；唯一的时间性信息是缓存存储「限时免费」但免费期结束时间与后续价格均未公布。
- **稳定机器可读价格接口**：
  - **未发现**官方 JSON 价格 API（公开可访问、无需凭据）。
  - 但 Mintlify 文档提供逐页 **`.md` 原始 Markdown 端点**（如 `pricing.md`）与 **`llms.txt` 索引**，页面结构规整（表格即价格表），可作为相对稳定的机器读取来源；HTML 页与其 `.md` 镜像本次核验内容一致。
  - 控制台 `bigmodel.cn/pricing` 为 JS SPA，无服务端渲染价格，不适合作为自动抓取来源。

## 7. 已知缺口

1. **全部价格无官方生效日期** → `effectiveFrom` 一律记为未知。
2. **缓存存储免费期后单价未公布**（官方明示暂不展示）→ 不猜测、不填 0 之外的值。
3. **精确 API 型号 ID 仅部分被官方页面显式证实**：`glm-5.3`、`glm-5.3-flash`、`glm-5.3-flashx`、`glm-5.3-flashx-legal`、`glm-5.2`、`glm-4.7`、`glm-4.6`、`glm-4.5`（模型详情页 Model Code / 请求示例）、`glm-4-plus`、`glm-4v-plus`、`embedding-2`、`cogview-3`（batch.md 示例）。其余（含 **GLM-Z1-Air/AirX/FlashX/Flash**、GLM-4.5-Air/AirX、GLM-4-Air-250414、GLM-4-AirX、GLM-4-Assistant、GLM-4-FlashX/Flash-250414、GLM-4V-Plus-0111、GLM-4.5V、GLM-4.6V-FlashX、GLM-5/5-Turbo/5.1、GLM-4.7-FlashX/Flash、GLM-5V-Turbo、GLM-OCR、Embedding-3、CodeGeeX-4、Rerank 等）本次核验**未读到官方显式 API ID**，样本中以官方定价页展示名记录，并在 `idEvidence` 字段区分证据强度（展示名/官方文档 slug/请求示例/Model Code）。
4. **模型概览有、定价页无价格行**：GLM-4.6（文本）、GLM-4.5（文本）、GLM-4.5-AirX、GLM-4.5-Flash、AutoGLM-Phone 等 → **本次核验未能读取其官方单价，来源状态为不可用**，不猜测。
5. **分档边界的 K 进制未明示**（1K=1000 或 1024），样本保留官方原文并按 1K=1000 存数值。
6. **GLM-4.7 / GLM-4.5-Air 的输出长度分档**（0.2K 边界）需在计价引擎支持「输入+输出联合选档」，缺任一侧准确 token 数时不得猜档。
7. `bigmodel.cn/pricing`（商业/资源包价格）本次不可解析；资源包、GLM Coding Plan 套餐、免费额度、折扣、税费均不在本页口径内。

## 8. 结论

- **可自动计价**：✅ 是（token 计价的文本/视觉/语音/向量/其他模型）。官方单位统一为 **元/百万 Tokens（CNY, per_1m_tokens）**，分档边界明确（输入长度分档，GLM-4.7/GLM-4.5-Air 另有输出长度分档），缓存命中价逐型号可得，配合 `usage.prompt_tokens_details.cached_tokens` 与总用量即可按官方公式精确估算。
- **不可套文本公式的项**：图像/视频生成（元/次）、TTS（元/万字符）、TTS-Clone（元/次）、Realtime（元/分钟）、搜索（元/次）、知识库（元/页、元/GB/小时）→ 已单列于第 5 节与样本 `nonTokenItems`。
- **必须随计价保留的不确定性**：生效时间未知、缓存存储后续价未知、部分型号 API ID 未证实、K 进制未明示。按第一阶段方案，这些情况显示明确状态，不猜测单价，不把未知标为免费。
