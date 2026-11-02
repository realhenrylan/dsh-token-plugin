> 已发布到 npm，包名为 `dsh-token-plugin`。

<div align="center">

# DeepSeek Harness 用量与消耗插件（dsh-usage-plugin）

[English](./README.md) | **简体中文**

[GitHub](https://github.com/realhenrylan/dsh-token-plugin) · MIT License


**由开发者制作的 DeepSeek Harness 插件** —— 记录每一次模型调用的 token 用量与消耗，支持峰谷计费、日历热力图与 CSV / JSON / PNG 导出。

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-339933)
![Platform](https://img.shields.io/badge/platform-web%20%26%20desktop-4d9fff)

</div>

---


## 简介

dsh-usage-plugin 是 DeepSeek Harness 生态的**用量与消耗统计插件**（DSH plugin，Host + Client 双面一体包）。装好后在 WebUI 顶部「对话」「轨迹」之后会出现 **「用量与消耗」** tab：

> 支持 **Windows / macOS / Linux**：路径按当前平台处理（`node:path`），目录选择与「打开所在目录」均调用系统原生方式（macOS 用 `osascript` / `open`，Linux 用 `zenity` / `xdg-open`），导出不依赖 Windows 专用命令。

- **用量与消耗**：记录每次模型调用的 token 用量与缓存命中（输入·未命中 / 缓存命中 / 缓存写入 / 输出 / 推理 / 结束原因），按 DeepSeek 峰谷/基础价格计算消耗（工作日高峰时段按北京时间 9:00–12:00、14:00–18:00 计价；自 2026-08-23 起周末全天按空闲价计费；自 2026-09-10 12:00（北京时间）起改用 V4.1 Flash 调价后的峰谷价——`deepseek-flash` 空闲价 缓存命中 0.02 / 输入 1 / 输出 4 元，高峰为其两倍）。模型名以请求参数为准如实显示（非 DeepSeek 模型不再显示为「未知模型」，无官方价格的模型消耗按 0 统计）。概览含「按模型」表与「按 API 服务商 × 模型」明细表（每个服务商一组，组内列出各模型的调用与高峰/空闲分列消耗），底部有总费用合计。概览还支持**日期筛选**（今天 / 近 7 天 / 近 30 天 / 全部，外加自定义起止区间），可将聚合统计限定到任意一天或日期范围。
- **用量日历**：按月查看每日用量热力图（按消耗或调用数着色），悬停查看详情（含高峰 / 空闲消耗拆分）、点击某天查看当日调用明细与高峰/空闲消耗统计，附每日统计表（高峰消耗 / 空闲消耗 / 总消耗分列）与汇总。支持**日期范围筛选**（今天 / 近7天 / 近30天 / 全部 + 自定义起止日期）：筛选激活时每日统计表跨月显示范围内所有天、顶部卡片切换为「范围内调用 / 范围内消耗」并按范围汇总、热力图仅对范围内日期着色。
- **明细（缓存命中 / 按模型 / 按服务商）**：最新记录排在最前，支持 今天 / 近7天 / 近30天 / 全部 快捷筛选与自定义起止日期区间，汇总行与表尾合计区分高峰消耗 / 空闲消耗 / 总费用合计；列表分页渲染（每页 100 条），记录量大也不卡顿。
- **中断调用如实呈现**：被中止 / 出错 / 超时（如手动停止生成、流中断）的调用在面板中标红显示「中断」徽标、结束原因（已中断 / 错误 / 超时）与消耗 `—`。这类调用官方后台仍会计入「API 请求次数」并按实际 token 计费，但 harness 不向插件上报 usage——插件按 0 token 记录它们，**调用次数与官方口径一致，消耗不受影响**；概览「调用次数」卡片会提示 `中断 N（未计费）`。
- **本地统计 vs 官方后台的差异提示**：用量面板顶部固定显示说明横幅——本面板统计的是插件本地捕获的调用（官方价格 + 峰谷时段），与官方后台（platform.deepseek.com 用量页）相比金额可能更低：① 中断/出错/超时的调用官方仍按实际 token 计费而插件按 0 记录；② 账号下其他 API Key（其它应用/脚本）的调用不经过 DeepSeek Harness，官方包含而插件不包含；③ 精确对账可导出官方月度账单 CSV 对比。检测到中断调用时，横幅额外以红字显示「当前记录中有 N 次中断调用（未计费）」。
- **价格表**：**DeepSeek 官方 API 价格表**（覆盖官方模型 `deepseek-flash`（DeepSeek-V4.1-Flash）与 `deepseek-v4-pro`；旧名 `deepseek-v4-flash` / `deepseek-v4-flash-vision-exp` 仍可调用并并入 Flash 档位），展示基础价与峰谷价（高峰/空闲）单价表，高峰价与空闲价分列展示。峰谷价表按官方调价**分段**：2026-08-17 起为第一版峰谷价；**2026-09-10 12:00（北京时间）起为 V4.1 Flash 调价后的新版**（`deepseek-flash` 空闲价下调为 缓存命中 0.02 / 输入 1 / 输出 4 元，高峰为其两倍；`deepseek-v4-pro` 不变），历史调用始终按其发生时刻对应的版本计费。支持在面板内直接编辑价格并持久化（数据目录 `pricing.json`），也可一键恢复默认。
- **订阅制 Coding Plan（计费通道）**：每条调用都带**计费通道**标注——订阅套餐或按量。内置 **OpenCode Go / Command Code GOAT** 等套餐的默认登记条目（月费按实付填写）。在面板登记套餐（每期费用 + Provider ID / 模型 ID 归因规则）后，新调用在**写入时**按 Provider ID 精确匹配自动标注（歧义不猜、不命中不标）；历史调用可按会话 ID 或日期范围手动标注。订阅调用显示**等效官方价**（按官方按量价折算的参考值）并配**「订阅回本」卡**（等效价 ÷ 月费倍数），汇总与 CSV / JSON 导出按通道分列。等效价只是参考值，不代表实付账单，实付为订阅月费。
- **导出**：CSV / JSON / **PNG 长图**（按最新在前展示，最多含最近 2000 条，超出会提示；PNG 报告含高峰 / 空闲消耗分列统计），可导出到任意目录（原生目录选择器），导出后自动打开所在目录。
- **导入**：选择文件（JSON / CSV）合并导入，按时间去重。
- **持久化**：记录实时落盘到**固定专用数据目录**（如 `%LOCALAPPDATA%\dsh-usage-plugin\dsh-usage\usage-records.json`，详见下文「数据目录」），与当前工作区无关，重启自动恢复（上限 100000 条，尽量多存）。
- **界面适配**：面板字号跟随应用「显示大小」设置自动缩放（em 相对字号）；桌面端宽表在容器内横向滑动（max-content + overflow-x），**移动端（≤900px）表格贴合屏宽、不再出现横向滑条**，弹窗与卡片随视口自适应。
- **英文界面（i18n）**：面板语言跟随宿主的「通用设置 → 语言」——在那里切换，插件即时跟随，不再自带切换按钮，也不再用 `localStorage` 覆盖系统语言。双语词典覆盖整个面板（含高峰 / 空闲时段说明、PNG 报告）；外部「会话 / 设置」标签页名按渲染时读取，切换语言后实时更新。
- **内部/工具调用单独分组**：内部/占位调用（如 `dsh2shell-*`、模型 `fake`）不混入模型消耗明细，单独收在「消耗明细」下方可折叠的 **「工具调用（内部）」** 分组里（默认收起），成本表只统计真实模型调用。
- **移动端适配**：≤900px 时表格贴合屏宽（不再出现横向滑条）、宽表折叠中间列，弹窗统计卡与按模型卡片随视口自适应。

---

## 界面预览

### 用量与消耗
![用量与消耗](./docs/assets/usage-overview.png)

## 从本仓库安装

使用 GitHub 仓库地址直接安装：

```bash
dsh plugin --profile web add github:realhenrylan/dsh-token-plugin
```

`github:realhenrylan/dsh-token-plugin` 对应仓库地址 https://github.com/realhenrylan/dsh-token-plugin。

也可以在本地打包安装：

使用 GitHub 仓库地址克隆，然后打包并通过 DSH 安装：

```bash
git clone https://github.com/realhenrylan/dsh-token-plugin.git
cd dsh-token-plugin
npm pack
dsh plugin --profile web add ./dsh-token-plugin-2.0.1.tgz
```

如果已经克隆仓库，可直接在仓库目录中执行后两条命令。安装包文件名中的版本号以 `npm pack` 的输出为准。

安装后重启 DSH 服务。也可通过 `dsh plugin --profile web add dsh-token-plugin` 安装已发布版本。桌面端推荐列表由其维护方单独管理。

## 这个包是什么

一个 npm 包 = **host 半**（Node 侧 Cordis 插件，负责记录、计费、导出，见 `lib/index.js`）+ **client 半**（浏览器侧面板，见 `lib/client.js`，通过 `/usage/api` 与 host 通信）。

包通过两处声明接入 DSH：

| 声明 | 作用 |
| --- | --- |
| `dsh.bundle.patch`（`cordis.patch.yml`） | 让 DSH 把它识别为**标准 bundle 插件包**：`dsh plugin --profile <名> add <包名>` 一条命令即可安装并自动接线，无需手改任何配置文件 |
| `dsh.client` + `exports["./client"]` | 让 web 客户端在 `/plugins/<包名>/client.js` 自动加载浏览器面板 |

所以对使用者来说，**安装就是一条命令**，不用碰 YAML、不用手动复制文件。

---

## 更新和卸载

更新时重新打包当前仓库，再使用上面的命令安装新安装包。卸载时运行 `dsh plugin --profile web remove dsh-token-plugin`，然后重启 DSH。

## 数据与位置

> **自 v1.9.2 起**，记录存储在**固定专用数据目录**中（修复 [#4](https://github.com/feiyang-dev/dsh-usage-plugin/issues/4)）。路径不再跟随会话工作区 / `~/.dsh` / 桌面端安装目录漂移，因此切换工作区时历史数据不会再"消失"（被统计为 0），且 UI 中显示的路径与真实落盘路径始终一致。

- 数据文件：`<数据根>/dsh-usage/usage-records.json`
  - **数据根**的解析顺序（数据始终落在该顺序里**第一个可写**的目录，**不会放进工作区**，除非以下全部不可写）：
    1. 环境变量 `DSH_USAGE_DATA_DIR`（若已设置）——优先级最高，覆盖其它；
    2. Windows：`%LOCALAPPDATA%\dsh-usage-plugin`（若 `LOCALAPPDATA` 未设置则回退到 `%APPDATA%`）；
    3. 用户主目录：`~/dsh-usage-data`（Windows 为 `%USERPROFILE%\dsh-usage-data`，macOS/Linux 为 `~/dsh-usage-data`）；
    4. **兜底（极少见）**：当前工作区 `<工作区>/dsh-usage` —— 仅当上述系统/用户目录都不可写时才使用，并会在面板顶部提示「持久化未启用」。
  - **写入不经过模型沙箱**：持久化由插件宿主进程自身的文件系统直接完成，不受 `workspace-write` 沙箱约束，因此固定目录一定能正常写入，数据也不因工作区切换而丢失。
  - Windows 下默认位置：`%LOCALAPPDATA%\dsh-usage-plugin\dsh-usage\usage-records.json`
- 旧数据自动合并：首次启动时，落在 `%USERPROFILE%\dsh-usage`、`~/.dsh/dsh-usage` 以及各工作区 `dsh-usage`（或 `.dsh-usage-records.json`）下的旧记录会按**记录身份**去重后合并进固定数据根，无需手动迁移。身份取 `recordId`（新记录），或"会话 + 时刻 + 模型 + 用途 + 四桶用量 + 结束原因"的复合指纹（旧记录）——不再只按毫秒去重，同一毫秒的两条不同请求不会互相覆盖。**旧版本写入的记录完全兼容**：没有 `recordId` / `pricingTime` / `unit` 等新字段也能正常读取。
- **写入是原子的**：先写同目录临时文件并刷盘，再原子替换目标文件；失败时原文件保持不变。
- **损坏文件不会静默清零**：若数据文件存在但无法解析，插件不会把它当成空数据（旧版本会，且随后用空数据覆盖掉整份历史），而是把原件改名保留为 `usage-records.json.corrupt-<时间戳>.json` 后继续启动，方便人工抢救。
- 价格配置（面板内编辑后保存）：`<数据根>/dsh-usage/pricing.json`
- 价格表历史快照（每次改价 / 恢复默认自动追加，最多 200 条，只增不改）：`<数据根>/dsh-usage/pricing-history.json`
  - 只用于回看「某个时刻用的是哪套价」，**不参与任何金额计算**；也可以在 `pricing.json` 里写 `holidays: ["2027-01-01", ...]` 覆盖内置的法定节假日表。
- 订阅套餐登记表（面板「订阅套餐」区编辑后保存）：`<数据根>/dsh-usage/plans.json`
- 导出目录（默认）：`<数据根>/dsh-usage/{csv,json,images}/`
- 自定义导出目录：在面板「导出目标目录」里填写或点「选择目录…」
- 启动诊断日志（若插件激活失败）：数据根旁的 `dsh-usage-boot.log`

---

## 统计口径声明

本插件的用量与费用**基于 DeepSeek Harness 的 `llm/stream` 事件逐次记录**，并额外通过 `session/event` 监听搜索后端请求。请先了解它的边界，再决定如何使用这些数字。

### 已精确统计（上游实测值）

| 来源 | 说明 |
| --- | --- |
| 主 Agent 对话 | 每次调用的四桶 token、缓存命中数与结束原因 |
| 会话标题生成 | `purpose: session-title` |
| 上下文压缩 | `purpose: compaction` |
| 进程内子 Agent | 与主 Agent 共用同一个 `ctx.llm`，同样被拦截 |

计费公式与官方口径一致：`未命中输入 × 未命中价 + 缓存命中 × 命中价 + 输出 × 输出价`。其中「缓存写入」按未命中价计、不单列（DeepSeek 官方向来不单独上报该字段）；`reasoning` 已包含在「输出」内，不另计。

### 未纳入精确统计（面板中会单独标注）

| 来源 | 为什么统计不到 | 插件怎么处理 |
| --- | --- | --- |
| **`web_search` 的 DeepSeek 搜索后端调用** | `web-search-deepseek` 在 Harness 内部用原生 `fetch` 直连 `api.deepseek.com/anthropic/v1/messages`，刻意绕开 `ctx.llm`；而且上游只把**请求**写进会话日志（`web/deepseek-search-llm-request`），响应里的 usage **被整个丢弃**（其响应类型甚至没有声明 usage 字段）。这部分真实计费没有任何数据源可以取到。 | **精确记录调用次数**，并按请求体给出**输入侧下限**估算，全部标记为 `estimated`；输出侧不猜。概览页会显示「估算消耗 ≥ ¥X（N 次）」。 |
| 外部 CLI 子 Agent（claude-code / codex） | 起独立子进程，完全绕过 `ctx.llm`，不产生任何事件 | 不统计 |
| 请求中断时服务端已产生的输出 | 中断时 adapter 不产出 usage chunk | 记一条 0 token 的「中断调用」，使调用次数与官方口径一致 |
| 官方按 HTTP 请求计费，插件按「流」计费 | Harness 内部重试不会产生新的流 | 调用次数可能与官方 request_count 有出入 |

### 结论

- 普通对话 / coding 场景下，插件金额与官方账单**基本一致**；
- **大量使用联网搜索（`web_search`）时，插件显示的金额会明显低于官方账单**——缺失的正是搜索后端的消耗，面板会显式提示存在估算项；
- 任何情况下，**请以 DeepSeek 官方后台账单为准**。

### 历史价格不会被改写

每条记录在落盘时都会**冻结当时生效的三个单价**（记录里的 `unit` 字段）。因此：

- 之后修改价格表（面板保存或直接改 `pricing.json`）**只影响之后产生的记录**，历史费用不会被重算；
- 旧版本写入或手工导入的记录没有冻结单价，其费用按**当前**价格表计算，改动价格后会跟着变化——概览页与价格页会提示这类记录的条数；
- 确实需要用新价格重算全部历史时，在「价格表」页点**「用当前价格表重算全部历史」**（或调用 API `{"action":"repriceAll"}`）。这是唯一会改写历史费用的入口。
- **计费通道标注同样在写入时冻结**：套餐自动归因只作用于登记之后产生的记录；历史记录只能在面板「手动标记计费通道」里按会话 ID 或日期范围显式改标，该操作不改金额。

---

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 面板报 `Unexpected end of JSON input` | 插件行缺少 `inject` 列表，路由未注册。按方法 B3 补上 inject 后重启 |
| 面板一直空白 / 顶部无 tab | 插件未激活。看会话工作区 `dsh-usage-boot.log`；确认 `cordis.patch.yml` 里的行存在且 `name` 正确 |
| `dsh plugin` 报 pnpm not found | 安装 pnpm：`npm install -g pnpm` |
| 安装时连不上 npm 官方源 | 配置镜像：`npm config set registry https://registry.npmmirror.com`（或对 pnpm 设 `pnpm config set registry ...`）后再执行安装命令 |
| 卸载后仍报 `Cannot find package '@feiyang666/...'` | profile 里残留了包引用。删掉 `cordis.patch.yml` 中对应行与 `dsh.profile.bundles` 里的包名，重启 |
| Desktop 0.2.x 上费用恒为 ¥0、且价格页提示"全部记录都没有冻结单价" | 1.18.0 及更早只认 `deepseek-official` / `deepseek` 两个 provider id，而桌面端官方账号的 id 是 `deepseek-account`。升级到 **1.19.0** 起按前缀识别所有 `deepseek-*`，新记录冻结单价，历史记录的费用也会一并算对（issue #19） |

---

## 相关项目

| 项目 | 说明 | 安装方式 |
| --- | --- | --- |
| [数据保险箱（dsh-vault）](https://github.com/feiyang-dev/dsh-vault) | 自动备份 / 清空检测 / 一键恢复，保护聊天记录与工作区数据 | 桌面端一键安装，或 `dsh plugin add @feiyang666/dsh-vault` |
| [DeepSeek-Harness](https://github.com/deepseek-ai/DeepSeek-Harness) | 官方 CLI / Web 服务 | 见下方「运行 DeepSeek Harness」 |

### 运行 DeepSeek Harness

**快速安装（通过 npm）**

安装 Node.js，然后运行：

```bash
npx @deepseek-ai/dsh web
```

该命令会启动 Web UI，默认地址为 http://127.0.0.1:3080。详见 [Web UI 指南](https://github.com/deepseek-ai/DeepSeek-Harness)。

**从源码运行**

如需从仓库源码运行：

```bash
git clone https://github.com/deepseek-ai/deepseek-harness.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm dsh web
```

## 致谢

- **[@ayleen](https://github.com/ayleen)**：为 Web 面板实现完整的英文界面（i18n 层）与响应式语言切换，余额查询改为语义化字段（[#7](https://github.com/feiyang-dev/dsh-usage-plugin/pull/7)）。
- **[@wuhuqif176](https://github.com/wuhuqif176)**：在「剩余余额查询」中新增百炼（Qwen）Token Plan 配额查询（[#8](https://github.com/feiyang-dev/dsh-usage-plugin/pull/8)）。
- **[@Martin-soaring-dev](https://github.com/Martin-soaring-dev)**：筹备了插件开源贡献（打包、插件契约校验、文档与 CI），并提交贡献分支，成为后续开源版本的基础（[#6](https://github.com/feiyang-dev/dsh-usage-plugin/pull/6)）。
- **[@mumuer1024](https://github.com/mumuer1024)**：报告并定位了持久化路径随会话工作区漂移导致历史数据"消失/统计为 0"的问题，提出把数据写到固定专用目录的方案（[#4](https://github.com/feiyang-dev/dsh-usage-plugin/issues/4)）；并报告了 DeepSeek 搜索后端调用未计入统计导致费用被严重低估的问题，给出了可在官方账单上交叉验证的完整取证（[#12](https://github.com/feiyang-dev/dsh-usage-plugin/issues/12)）。
- **[@liu3734](https://github.com/liu3734)**：报告并定位 macOS（POSIX）下路径处理与 spawn 的 Windows 专用问题，提出跨平台修复方案（[#1](https://github.com/feiyang-dev/dsh-usage-plugin/issues/1)）。
- **[@zhiqiangme](https://github.com/zhiqiangme)**：提交了历史用量回填与侧边栏余额的大型 PR（[#14](https://github.com/feiyang-dev/dsh-usage-plugin/pull/14)）。其中**「`cacheWriteTokens` 兜底导致四桶双计」、「同毫秒记录按 `time` 去重会互相覆盖」、「用量文件非原子写入且解析失败被静默清零」三项定位**已成为 v1.18.0 计费口径修复的核心依据（详见 [CHANGELOG](./CHANGELOG.md)）。
- **[@vb2250158](https://github.com/vb2250158)**：提交 PR [#18](https://github.com/feiyang-dev/dsh-usage-plugin/pull/18)，定位并修复趋势图 X 轴日期在窄图下重叠的问题，给出「按 canvas 实测文本宽度排布 + 首尾日期优先」的完整方案与回归用例，已并入 v1.24.0。

## 更新日志

- [CHANGELOG.md](./CHANGELOG.md) —— 每次发布的详细更新内容。

## 许可

MIT © dsh-usage-plugin
