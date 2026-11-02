# 第二阶段：订阅制 Coding Plan 适配技术路径

状态：方案，尚未实施
适用代码：`dsh-token-plugin` 工作区（第一阶段官方价计价已落地）
制定日期：2026-11-02（北京时间）
前置文档：[第一阶段：模型官方价格计量技术路径](./phase-1-official-pricing-plan.zh-CN.md)

## 1. 背景与目标

订阅制 coding plan（首批目标：**OpenCode Go**、**Command Goat**，名称与 provider id 以第 9.1 节核验为准）按"月费 + 配额"计费，调用的边际价格为 0。第一阶段的**官方价参考金额**口径因此需要补充说明，否则用户会把参考金额误读为实付账单。

2026-11-02 与维护者讨论确定的结论：**保留官方价参考金额作为统一基准，plan 适配只做轻量层；不做无官方数据支撑的配额模拟。** 理由：

1. 官方价参考金额回答"这批用量按官方按量价值多少钱"，是跨模型、跨套餐的唯一统一单位；订阅回本、用量对比都依赖它。计量引擎（`lib/pricing/engine.js`）已解决最难的部分，不能推翻。
2. 订阅制用户真正的问题是"回本了吗"和"烧了多少配额"。前者完全建立在现有引擎之上；后者在套餐不公布配额规则、不提供 usage/quota API 时**无从得知真实口径**，硬做就是编数字，违反第一阶段"缺数据宁可不计价也不猜"的原则。
3. 套餐条款经常悄悄变化，硬编码配额规则的维护成本高且易错。

本阶段交付三件事：

1. **计费通道标注**（`channel`）：每条记录标明走的是按量通道还是哪个订阅套餐，防止金额误读；
2. **订阅回本视图**：登记月费后，展示"当月等效官方价 ÷ 月费"的回本倍数与差额；
3. **口径文案与分列**：plan 调用的金额统一展示为"等效官方价"，总计按通道分列，不悄悄合并。

**非目标（本阶段明确不做）**：配额窗口/百分比模拟、按套餐价反推单 token 成本、把订阅费摊销进单次调用、自动抓取订阅价格（月费由用户登记）、模糊归因。配额追踪只在官方公布规则或提供配额 API 之后另立阶段；届时复用余额查询里"百炼 Token Plan 配额"的展示先例。

## 2. 计价口径（第一阶段不变 + 新增术语）

第一阶段口径原样保留：无论从哪个平台调用，先确定调用的具体模型，再按该模型开发方官方 API 公开按量价格估算官方价参考金额。金额 `null` = 无法可靠计算；数值 0 只表示官方明示免费或计算结果确为零。

新增三个术语：

| 术语 | 含义 |
| --- | --- |
| **计费通道**（channel） | 一次调用的结算归属：`per_token`（按量）或 `plan:<id>`（订阅套餐）。只影响展示口径，不影响金额计算。 |
| **等效官方价** | plan 通道记录的金额展示名。含义：若该用量按官方按量计价值多少钱。**不是**实付金额——订阅已付月费，边际价格为 0。 |
| **订阅回本** | 当月该 plan 通道等效官方价合计 ÷ 登记月费。倍数 ≥ 1 表示"用回本了"。 |

混合口径**不合并**：总计行按通道分列（按量 ¥X / 订阅等效 ¥Y / 未计价 N 条），绝不把两种口径加成一个看似完整的总额。

## 3. 现状与改造边界

- `lib/index.js:1237-1341`（`llm/stream` 探针）：记录 `provider`、`model`、`purpose`、`sessionId`、四桶 usage、`finishReason`、`mode`。通道归因所需的判定字段是否存在于 `options` 中**尚未核实**，是第 9.1 节的第一项任务；不得假设一定存在。
- 记录写入点 `lib/index.js:1278-1298`（正常）与 `lib/index.js:1306-1325`（中断兜底）；`attachOfficialSnapshot`（`lib/index.js:1226`）在写入时冻结官方价快照。**`channel` 同样只在写入时判定并冻结**，不随套餐登记变更回改历史。
- `lib/records.js` 的 `normalizeRecord` / `normalizePricingSnapshot`（`lib/records.js:99`）：第一阶段的教训——新字段不同步扩展归一化会在重启或导入时丢失。`channel` 必须同步进归一化、持久化、导入导出。
- 记录身份键 `lib/records.js:149` 起：**不改动**。`channel` 不进复合指纹，避免改变旧记录的去重身份。
- 金额汇总 `officialOf`（`lib/index.js:1168`）与 `summarizeOfficial`（`lib/index.js:1130`）：按通道分列时在此扩展，沿用 priced / estimated / stale / unpriced / excluded / legacy 的状态划分。
- `projectRecord`（`lib/index.js:474`）：把 `channel` 投影进 API items。
- `budget.json` 先例（`lib/index.js:665-686` 加载、`lib/index.js:866` 路径、`lib/index.js:1896` 写入）：`plans.json` 沿用同一持久化模式，存放在 `budget.json` 同级目录。
- `lib/client.js`：视图为 OverviewView（`lib/client.js:1432`）/ BreakdownView（`lib/client.js:1307`）/ CalendarView（`lib/client.js:1679`）/ CacheListView（`lib/client.js:1956`）/ PriceView（`lib/client.js:2254`）；i18n 字典 `__T_EN`（`lib/client.js:10`）；budget 进度卡（`lib/client.js:1474-1580`）是回本卡片的现成样板。
- web_search 搜索后端计次（`purpose: 'web-search'` 的独立通道）**不在归因范围**：它不走 `llm/stream`，只记次数与估算下限，保持现状。

## 4. 数据模型

### 4.1 记录新增 `channel`（写入时冻结）

```js
// 记录新增可选字段；缺省（含全部旧记录）= 未标注通道，按量口径展示
channel: {
  v: 1,
  kind: 'plan',                  // 'plan' | 'per_token'
  planId: 'opencode-go',         // kind='plan' 时必填，指向 plans.json
  basis: 'provider:opencode-go'  // 归因依据，可追溯
}
```

归一化规则（对齐 `normalizePricingSnapshot` 的"形状不对整个丢弃"）：

- `v !== 1`、`kind` 非法、`kind='plan'` 而 `planId` 为空 → 整个丢弃，退回"未标注"；
- 丢弃只影响通道标注，**不影响记录本身和金额**；
- 旧记录无 `channel` 不回填、不迁移。`kind='per_token'` 只在归因规则显式命中按量通道时写入，与"未标注"在展示上等价（都不带订阅标记），但 JSON 往返必须保留原值。

导入导出：JSON 导出携带 `channel` 原样；CSV 增加"计费通道"列（`plan:<id>` / `per_token` / 空）；导入保留，识别不了的丢弃为未标注。PNG 报告不加列，在脚注注明含订阅通道记录的条数。

### 4.2 `plans.json` 套餐登记表

持久化于数据目录（`budget.json` 同级），面板可编辑、可重置。**月费是用户登记的展示参数**，不是官方实时价格，界面注明"以你订阅时的实际价格为准"。

```json
{
  "v": 1,
  "plans": [
    {
      "id": "opencode-go",
      "name": "OpenCode Go",
      "currency": "CNY",
      "monthlyFee": 0,
      "cycle": "month",
      "match": { "providers": ["opencode-go"], "models": [] },
      "sourceUrl": "",
      "note": ""
    }
  ]
}
```

- `id`：稳定标识，写入记录 `channel.planId`，创建后不可改（改名只改 `name`）；
- `monthlyFee`：非负数字，0 表示"未登记价格"（回本卡片显示"未登记月费"而不是除以 0）；
- `cycle`：`month` | `year`（摊 12）| `week`（摊 4.345）——只用于把周期价换算成月费展示；
- `match`：归因规则，见 4.3；
- 校验集中在新增的 `lib/plans/registry.js`：结构异常拒绝替换上次有效数据（对齐 `lib/pricing/catalog.js` 的校验原则）。

### 4.3 通道归因规则（确定性，不猜）

新增纯计算模块 `lib/plans/match.js`，风格对齐 `lib/pricing/resolver.js`：

1. 只做**显式、精确**匹配：`match.providers` 与记录 `provider` 精确匹配（大小写不敏感）；`match.models` 非空时还须命中记录 `model`（精确匹配）。
2. **仅模型名永远不足以归因**：同一模型可同时走订阅与按量通道，必须由 provider（或第 9.1 节核实出的更强字段）区分。
3. 多个 plan 同时命中 → 判为歧义，**不标注**（宁可退回未标注也不猜）。
4. 没有任何 plan 命中 → 仅当某 plan 的 `match` 显式声明"排除法归属"时才写 `per_token`；默认写"未标注"。
5. `basis` 记录命中依据（如 `provider:opencode-go`），供 UI 提示"为什么标为订阅"。

若第 9.1 节核实发现订阅与按量走同一 provider id 且无更强字段可分：**放弃自动归因**，改为面板手动标记（按会话/按时间区间批量打标，写入同样的 `channel` 结构，`basis` 记 `manual:<操作时间>`）。自动归因不做启发式猜测。

## 5. 订阅回本视图

- **位置**：概览页新增"订阅回本"卡片组，排在 budget 进度卡之后；每个已登记 plan 一张卡（未登记月费的 plan 只显示用量不显示倍数）。
- **数据**：当月（北京自然月，复用 `bjDayKeyOf`）该 plan 通道记录的等效官方价合计 ÷ 月费 = 回本倍数；同时显示差额（"还差 ¥Z 回本" / "已省 ¥W"）。
- **口径**：
  - 分子只累计可靠计价的金额（priced + estimated + stale），**未计价记录不计入分子但单独显示条数**（"另有 N 条未计价"），不把未知当 0 冒充完整口径；
  - 中断调用 0 token，不进分子，不单独提示（沿用现有中断口径）；
  - 月费按**当前登记值**计算，不冻结、不回改历史；卡片注明"按当前登记月费计算"。
- **计算位置**：客户端从 `list` 返回的 items 聚合（records 已全量在前端）；`stat` 轮询保持轻量，不新增字段。纯换算函数放 `lib/plans/roi.js` 供单测。

## 6. 界面与文案

- **通道标记**：明细表、日历日列表、缓存命中列表的行内加「订阅」小徽标（hover 显示 `basis` 与套餐名）；概览/明细的分组表新增"计费通道"列或按通道分小节。
- **金额命名**：plan 通道金额一律展示为**等效官方价**；顶部说明 banner 增加一段订阅口径："订阅套餐调用显示的是等效官方价（按官方按量价折算的参考值），不代表实付金额；实付为订阅月费。"
- **总计行**：按通道分列——按量 ¥X / 订阅等效 ¥Y / 未计价 N 条；两者之和可展示为"等效参考合计"，但必须带口径标签，不叫"总费用"。
- **套餐登记 UI**：价格表页新增"订阅套餐"小节（仿 budget 设置区）：列表 + 新增/编辑/删除 + 月费 + 归因规则（provider 列表）+ 来源链接；提供"恢复默认"。
- **i18n**：所有新文案进 `__T_EN` 双语字典（`lib/client.js:10`），跟随宿主语言切换；PNG 报告文案同步。

## 7. 宿主接口

- `/usage/api` 新增 action `plans`：读/写 `plans.json`（仿 `budget` 的 get/set，`lib/index.js:1896` 形状）；写入走原子写入，损坏时保留原文件并报告。
- `list` 响应附加 `plans`（登记表原样）；**不**新增 plan 聚合字段（客户端聚合）。
- SSE 版本指纹：`plans` 变更时更新指纹并通知客户端（登记表变了回本卡片要变）；记录快照不因登记表变更而改变。
- 旧客户端 / 旧数据兼容：`channel` 是可选字段，旧数据无损读取；旧客户端忽略新字段。

## 8. 明确不做（边界重申)

1. 配额窗口（如 5 小时会话窗）、配额百分比、"离限额多远"——无官方规则/API 前不做；
2. 按套餐价反推单 token 成本、把订阅费摊销到单次调用；
3. 把等效官方价当实付金额展示；
4. 自动抓取订阅价格（月费始终是用户登记值，可附来源链接供核对）；
5. 任何模糊 / 相似度归因（对齐 resolver 的"宁可不计价也不猜"，这里是"宁可不标注也不猜"）。

## 9. 分阶段执行与验收

### 9.1 通道核验（先做，产出写入 `docs/source-verification/`）

1. 实测 OpenCode Go / Command Goat 在宿主 `llm/stream` `options` 中的 `provider` id 及可区分订阅/按量的字段（如 auth、endpoint、header）；确认中断调用与非流式调用是否同样带这些字段；
2. 确认两家订阅价、计费周期、是否含多家模型（决定回本卡是单卡还是多模型聚合）；
3. 调查是否公开 usage/quota API 或配额规则文档：**只记录核验结果**，本阶段不接入。

### 9.2 数据层

`channel` 字段全链路：写入点冻结 → `normalizeRecord` 往返 → 持久化 / 导入导出 → `projectRecord` 投影；`plans.json` 登记表 + `lib/plans/registry.js` 校验 + 原子持久化。

### 9.3 归因与回本计算

`lib/plans/match.js` 归因纯函数；`lib/plans/roi.js` 回本换算纯函数；`officialOf` / `summarizeOfficial` 按通道分列。

### 9.4 UI 与文案

回本卡片、通道徽标、口径 banner、套餐登记区、i18n 双语、导出列与 PNG 脚注。

### 9.5 端到端验收

自动测试（`node --test`、`npm run check`）+ 真实 DSH 验证：调用 → 记录带 channel → 回本卡片 → 导出往返。测试至少覆盖：

- 归因：provider 精确命中、大小写、歧义不标注、未知 provider 不标注、`match.models` 交集、同模型走双通道仅按 provider 区分、手动打标 `basis:manual:*`；
- 记录往返：`normalizeRecord` 保留 `channel`、形状损坏整体丢弃、旧记录无字段、重启 / 导入导出不丢、复合指纹不因 `channel` 变化；
- 回本：北京自然月边界、未计价条数排除在分子外、月费 0 / 未登记显示、`cycle` 换算、多 plan、月费修改只影响展示；
- 口径：总计按通道分列不合并、plan 金额一律"等效官方价"、中断调用不影响回本、web_search 计次不参与归因；
- 兼容：旧 JSON 导入、`stat` 轻量（perf-guards）、`plans.json` 写入失败保留原文件、SSE 指纹随登记表更新。

## 10. 验收边界

本阶段完成意味着：通道标注与订阅回本在两家目标 plan 上通过上述验证，金额口径无歧义。**不**声称配额可知、不声称等效官方价等于实付账单。套餐条款变化、provider id 变化、订阅/按量不可区分等情况按第 4.3 节降级为未标注或手动标记，并保留可追溯原因。
