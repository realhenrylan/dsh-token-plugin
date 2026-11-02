# 第一阶段实施记录：官方价参考金额（五家来源）

- 实施日期：2026-11-01
- 依据计划：[phase-1-official-pricing-plan.zh-CN.md](phase-1-official-pricing-plan.zh-CN.md)
- 来源核验时间：2026-11-01 20:53–21:05（+08:00），逐家报告见 [source-verification/](source-verification/)（deepseek / mimo / qwen / kimi / glm）
- 自动测试：`node --test` 148 个全部通过（原 74 + 新 74）；`npm run check` 通过（DSH 插件契约）

## 1. 交付范围

为 DeepSeek、小米 MiMo、千问 Qwen、Kimi、智谱 GLM 五家模型开发方建立统一「官方价参考金额」计价能力：

- 无论调用平台是哪家，先精确映射到**模型开发方的官方型号**，再按该官方 API 公开按量价与规则估算金额；
- 界面与导出统一命名为「官方价参考金额」，明确**不代表第三方实际账单**；
- 无法确认映射、缺价、缺用量、缺规则、缺汇率时金额为 `null` 并带结构化状态，**未知绝不当免费**；数值 `0` 只表示官方明确免费；
- 每次调用绑定版本化 `pricingSnapshot`，价格目录刷新**不改写**已冻结的历史快照。

## 2. 代码结构

| 模块 | 职责 |
| --- | --- |
| `lib/pricing/catalog.js` | 目录校验与归一（validateModelEntry / validateSourceBlock / normalizeCatalog / catalogFingerprint / emptyCatalog） |
| `lib/pricing/sources/common.js` | 来源抓取与解析公共层（fetchSource / checkSourceUrl 仅官方 HTTPS 主机 / 2MB 上限 / buildSourceBlock / 样本归一） |
| `lib/pricing/sources/index.js` | SOURCE_DEFS 五家来源定义 + createSourceAdapter（多页抓取）；五家全部接入自动文本解析器：MiMo / DeepSeek markdown 表、GLM pricing.md 表、Kimi flight payload（chat+batch 双页）、Qwen SSR HTML（model-pricing + context-cache 双页）；解析失配一律 ok:false「保留上一次有效价格」 |
| `lib/pricing/resolver.js` | buildAliasIndex / resolveModel：officialModelId 与已核实别名精确匹配（含平台 scope），**绝不做前缀裁剪或模糊匹配** |
| `lib/pricing/engine.js` | usageOf / priceCall / buildSnapshot / computeFromSnapshot：分档选择、峰谷时段、缓存读写桶、TTL 默认档、定点小数（nano）金额、状态字典 |
| `lib/pricing/cache.js` | createPricingCache：逐来源 6 小时到期刷新、24 小时标 stale、失败退避（5min 起指数、上限 6h）、并发刷新合并、坏数据整拒并保留上一份有效缓存 |
| `lib/pricing/holidays.js` | 2026 法定节假日日历（外部来源，覆盖年份显式标注） |
| `lib/pricing/seed-catalog.json` | 离线种子目录（66 型号，由 `scripts/build-pricing-seed.mjs` 从 5 份核验样本生成，priceVersion=seed:verified:2026-11-01） |
| `lib/index.js` | 宿主接入：pricingStatus / pricingRefresh / repricePreview / repriceAll；CSV / JSON 导出增列；list / stat 暴露汇总；modelKeyOf 收紧（不再把 mimo/kimi 的 flash/pro 误判进 DeepSeek 档） |
| `lib/client.js` | 价格页「官方价参考金额（五家来源）」区块：逐源状态、最后成功时间、来源链接、逐型号价格表（含峰谷双行）、手动刷新；概览页金额小结条（已可靠计价 / 部分估算 / 过期 / 未计价 / 旧口径，不同口径不合并）；概览 / 明细 / 日历 / 缓存列表 / 会话排行主金额已改用官方价参考金额（按 priced / estimated / stale / unpriced / legacy 分列，未计价显示「—」） |

## 3. 关键决策与理由

1. **模型作者与调用平台分开存**：条目只认官方型号 id 与已核实别名；第三方别名（如硅基流动 `qwen/qwen3.6-27b`）在无版本指纹可证同一性时**不映射**百炼价——避免同名不同版本的伪精确金额。
2. **调用模式未知不猜档**：qwen-plus 等思考 / 非思考价格不同的条目，未标注模式时拒计（missing_rule）而非取任一价；批量价只在显式标注时选用。
3. **非 token 计价项不套 token 公式**：按次 / 按时长（搜索、TTS、ASR、图像等 27 项）与"每百万 tokens 单一价未分桶"的条目标 `pricingExcluded` / `bucketSemantics:'unsplit'`，金额 null + 原因，不计入合计。
4. **峰谷 / 节假日**：DeepSeek 按现行已核验峰谷规则回算（工作日高峰 9:00–12:00 / 14:00–18:00，周末与法定节假日全天空闲）；节假日日历来自外部来源并标注覆盖年份，超出年份（如 2027）不静默假定，标 missing_rule。
5. **历史价段可追溯**：DeepSeek 2026-09-10 前价段（官方仅存图片）以 `verified:false` 入库，计价时标 estimated / unverified，不冒充本次核验。
6. **快照即冻结**：`pricingSnapshot` 保存已解析到桶的有效单价与规则坐标；`repriceAll` 默认不动官方快照，仅 `includeOfficial:true` 显式回算，且执行前必写 `usage-records.backup-*.json` 备份，备份失败即取消。
7. **金额精度**：定点 nano 整数聚合后转展示，0.02 元/百万 × 50 万 × 1000 条 = 10 元整无浮点漂移。
8. **TTL 缓存写入**：Kimi 5m/1h 分档写入价按官方默认 TTL（5m）计并生成 assumption 标注，显式 cacheTtl 可覆盖；MiMo 缓存写入限时免费记 0 并注明。
9. **旧记录不迁移**：旧 unit 口径继续按原规则显示并标"旧口径"，刷新目录不重算历史；旧记录如现算参考金额则标"未冻结"。

## 4. 测试映射（计划 §6 清单 → 测试文件）

| 计划要求 | 测试 |
| --- | --- |
| 五家成功读取 / 错误缺项 / 结构变化不覆盖好缓存 | test/pricing-sources.test.js（17）、test/pricing-cache.test.js（8） |
| 同模型双提供商同规则；flash/pro 同名不误映射 | test/pricing-resolver.test.js（7）、test/pricing-acceptance.test.js（双 provider 同 entry 同额） |
| DeepSeek 峰谷起止 / 周末 / 假日 / 跨午夜 / 节假日年份缺失；未来生效价与生效时间未知 | test/pricing-engine.test.js（15）、test/pricing-acceptance.test.js |
| Qwen 地域阶梯边界、Kimi 缓存写入 TTL、GLM 输入×输出分档、MiMo 型号区分 | test/pricing-engine.test.js、test/pricing-sources.test.js |
| 缺字段不产伪精确金额（null ≠ 0、missing_price / missing_fx / missing_usage / unknown_model 区分） | test/pricing-engine.test.js、test/pricing-records.test.js |
| 刷新定时 / 手动 / 并发去重 / 单源失败 / 24h 过期 / 退避上限 | test/pricing-cache.test.js |
| 价格刷新不改写已冻结历史 | test/pricing-acceptance.test.js（目录涨价 10 倍快照金额不变）、test/pricing-host-api.test.js（repriceAll 默认不删快照） |
| 旧数据兼容 / 新旧 JSON 导入导出 / CSV 金额币种状态来源 / 快照往返 | test/pricing-records.test.js（9）、test/pricing-host-api.test.js（4） |
| 轻量 stat 轮询不被破坏 | test/host-routes.test.js（既有）、test/pricing-host-api.test.js（list/stat 字段增量） |

## 5. 已知缺口（保明确状态，不猜）

- ~~未在真实 DSH 宿主做端到端验证~~ **已于 2026-11-01 22:34–22:39 完成真实 DSH 端到端验证**（DSH 重启后加载新版插件）：
  - **真实网络刷新**：DeepSeek、MiMo 两来源从官方页面真实抓取并解析成功（22:34:19，catalogVersion 变为实时目录 1112529873，不再依赖种子）。
  - **调用 → 记录 → 快照**：mimo-v2.6-pro（provider xiaomi，流式探针）记录绑定 `pricingSnapshot`（`official.frozen:true`、sourceId=mimo、basis=official-id、status=priced），金额 0.0124116 元与手工核算一致（1140×3 + 92544×0.025 + 1113×6 每百万）；`estimated:true` 来自"未标注调用方式按实时价计"假设（条目含 Batch 档，符合设计）。
  - **页面汇总**：officialSummary 已可靠计价 47 条 ¥0.616、部分估算 650 条 ¥13.78、未计价 17 条、旧口径 701 条，口径分列未合并。
  - 注意：`list` 响应投影出 `official` 计算结果但不带原始 `pricingSnapshot`（避免大对象），快照随 JSON 导出往返（已由 test/pricing-host-api.test.js 覆盖）。
- ~~qwen / kimi / glm 无自动解析通道~~ **已于 2026-11-02 补齐并真实验证**（见 §8）：五家来源全部自动抓取+解析成功（pricingStatus 五家 state=ok，lastError 空；显式 pricingRefresh 三家 replaced=true）。
- DeepSeek 2026-09-10 前历史价段 `verified:false`（官方仅存图片）；官方不提供节假日日历（日历为外部来源）；跨时段结算时点官方未说明。
- Kimi 生效日期未公布、缓存存储费未公布、海外 USD 未核验；K2 系列 TTL 档位官方未说明（cacheWrite=null，partial）。
- Qwen 例外 4 型号（qwen3.8-max / qwen3.8-max-0902 / qwen3.8-2.4t-a95b / qwen3.8-flash）缓存命中价公开页无数值（partial，null 不猜）；qwen-turbo 价格页无文本模型价（不虚构条目）；缓存比例（125%/10%/20%）为常量推导（cachedInput=输入×10% 标「比例推导」），来源 context-cache 页注释。
- MiMo Prompt Cache TTL 官方未公布；ultraspeed 生效日期未知；GLM 全部价格无官方生效日期。
- PNG 导出未改动（沿用现有实现），中英文案一致性由既有 i18n 测试与新增文案覆盖，PNG 版式建议人工过目一次。

## 6. 复验命令

```
node --test        # 154 个测试（含样张对拍 test/pricing-parse-pages.test.js 6 个）
npm run check      # DSH 插件契约
```

发布 npm 属于单独的发布步骤（计划 §6 尾注），本次未执行。

## 7. 主视图接入官方价参考金额（补充实施，2026-11-01 晚）

背景：用户报告使用小米 MiMo 时插件金额始终为 ¥0。核查确认 token 采集正常，但旧口径 `costFor()`（lib/index.js:350）只认 `deepseek` / `deepseek-*`，provider 为 `xiaomi` 的记录 `autoCost` 恒为 0；概览、明细、日历、缓存列表与导出此前全部读取该字段。官方价链路本身已能算出 MiMo 参考金额（`official`），但只显示在概览顶部的独立小结条里。

本次改动（仅 `lib/client.js`，host 未改——`list` 已返回 `official` 与 `officialSummary`，CSV/JSON 已含官方价列）：

- 新增 `refOf` / `refBucket` / `addRef` / `refSplit` / `fmtRef` / `refValue`，把每条记录归入 priced / estimated / stale / unpriced / excluded / legacy，并按高峰/空闲拆分；合计只分列相加，不把不同口径合并成一个「完整总额」。
- 概览、模型明细（含服务商视图）、用量日历、缓存命中列表、会话消耗排行与趋势图 tooltip 的金额全部改用官方价参考金额；估算金额带 `*`，可能过期带 `†`，未计价显示「—」。
- `aggregateRecords()` 同时产出旧口径与官方价口径字段，donut 按官方价占比排序。
- 浏览器实机渲染（真实 API 数据，1307 条）：概览「¥3.59 + ¥18.64*」，其中已可靠计价 475 条、部分估算 815 条、未计价 17 条；明细表 MiMo flash ¥2.75*、pro ¥15.88*，DeepSeek ¥3.59；日历与缓存列表一致，无 NaN / undefined。
- 测试：`node --check lib/client.js` 通过；`node --test` 148/148 通过；`npm run check` 通过。已 `DSH_PROFILE=desktop node sync-to-profile.mjs` 同步，安装副本与仓库 sha256 一致（225735 字节），刷新页面即可生效。

仍未改动：PNG `drawReport()` 仍用 `peakValleyCost`（已知缺口）；工具调用表与 `web_search` 估算仍按旧字段展示。

## 8. 补齐 Qwen / Kimi / GLM 自动解析通道（2026-11-02）

背景：用户指出关键缺口——只有 DeepSeek、MiMo 能自动获取并解析官方价格，Qwen / Kimi / GLM 仍用人工核验内置价，不能称"五家自动更新全部完成"。本节记录三家解析器的接入与真实验证。

### 8.1 数据通道（均为官方页面公开内容，无凭据）

| 来源 | 抓取 URL | 载体 | 解析器 |
| --- | --- | --- | --- |
| GLM | `https://docs.bigmodel.cn/cn/guide/start/pricing.md` | Mintlify Markdown 表 | `parseGlmText` |
| Kimi | `https://platform.kimi.com/docs/pricing/chat` + `/pricing/batch` | 页面 JS flight payload | `parseKimiText`（双页） |
| Qwen | `https://help.aliyun.com/zh/model-studio/model-pricing` + `/context-cache` | SSR HTML 表格 | `parseQwenText`（双页） |

`createSourceAdapter.fetchRaw` 扩展为多页抓取（全部成功才返回 `pages[]`，任一失败整体 ok:false 保留上一次有效价格）。

### 8.2 解析器要点（细节见代码内注释）

- **GLM**：Markdown 表 6/7 列；联合分档文本（`输入 [0, 32K)，输出 [0, 0.2K)`→maxInputTokens/maxOutputTokens，K=1000）；语义数字=元/百万、`免费`=0（官方明确免费≠未知）、`不支持`=cachedInput:null、`限时免费`=缓存存储 0；unsplit 单价条目（GLM-4-Voice / Embedding / CodeGeeX / Rerank）标 `bucketSemantics:'unsplit'` 不套文本公式；ASR 整句价「输入 16 元/百万（约 0.0002 元/秒）；输出不计费」→ {16, null, 0}。
- **Kimi**：flight payload 行正则提取 6 型号×5/3 格价（5 格=输入/输出/命中/写入5m/写入1h→cacheWrite TTL 对象；3 格 K2 系=不支持缓存写入）；batch 页同构提取批价（60%）；**页面身份守卫**：批价页行形态与实时价表同构，误把批价当实时价会产 6 折伪精确金额——按标记文本（实时价页「不指定 TTL 时默认按此档」/ 批价页「标准模型价格的 60%」）双向拒收身份错配页。
- **Qwen**：SSR HTML 按 `<h4>` 地域分区只收北京行（海外行价不同、部署范围列跳过）；两种行形态（带/不带「模式」格）；阶梯条件 `0<Token≤256K`→256000（K=1000/M=1000000）；思考/非思考分列→thinkingOutput；同价快照行（qwen3.8-max-0902 等）与「当前能力等同于 X」并入主型号 aliases（两遍合并防后置行丢别名）；缓存支持=北京支持清单（context-cache 页第一处「支持的模型」段=显式缓存口径）∪价格页附属行信号；缓存比例常量（创建 125%/命中 10%/隐式 20%/1024 Token/TTL 300s）来自 context-cache 页，cachedInput=输入×10% 标「比例推导」；例外 4 型号命中价不推导（null+missing）；qwen-turbo 页面无价行→不虚构条目。

### 8.3 语义红线执行

结构失配宁可 ok:false「保留上一次有效价格」绝不产伪精确金额：三家在行数为 0 / 表头失配 / 缓存清单缺失 / 页面身份错配时全部拒收。样张对拍测试（`test/pricing-parse-pages.test.js`，6 个）断言解析样张==人工核验 fixture 关键价（GLM 39 型号逐档、Kimi 6 型号含 TTL 分档与批价、Qwen 14 核心型号阶梯/思考拆分/缓存例外/aliases ⊇）+ 三家结构失配 ok:false。

### 8.4 真实验证（2026-11-02，DSH 重启后）

- `pricingStatus`：五家 state=ok、lastError 空、qwen 27 / kimi 6 / glm 39 型号（实时抓取解析，非种子）。
- 显式 `pricingRefresh`（qwen/kimi/glm）：三家 `ok:true, replaced:true`。
- 记录计价正常（officialSummary priced 1061 条 ¥19.39 等，旧口径分列不变）。
- 复验：`node --test` 154/154、`npm run check` OK、`sync-to-profile.mjs` 安装（profile=desktop）。

