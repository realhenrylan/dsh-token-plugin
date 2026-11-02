# Command Code GOAT 通道核验

核验日期：2026-11-02（北京时间）

## 名称、价格与额度

目标套餐的官方名称是 **Command Code GOAT**；“Command Goat”不是套餐正式名称。

- [GOAT 官方说明](https://commandcode.ai/docs/plans/goat)列出 $10/月、各模型有独立额度、合计最多 $100 credits；用量上限为任意 5 小时最多 $20、任意 7 天最多 $50、每月最多 $100。窗口及账期按各自周期重置；额外购买的按量 credits 按模型常规价格计费，不计入套餐额度。
- [官方 Provider API 文档](https://commandcode.ai/docs/provider)说明除 $1/月 Go plan 外，GOAT 等计划可通过 OpenAI/Anthropic 兼容 API 使用，调用从订阅 credits 扣减。GOAT 与 Provider 按量计划都使用 `https://api.commandcode.ai/provider/v1` 端点，因此仅凭 endpoint 无法分辨套餐结算归属。官方页面也列有 usage analytics 与 per-request cost，但核验到的资料未给出可供本插件调用的公开 usage/quota API。
- 官方页面明确说明 Go plan 仅供 Command Code CLI 使用且不提供 Provider API；它不是本插件的目标 API 通道。

## DSH 归因结论

DSH 自定义 API route 的 provider id 由用户设定，`llm/stream` 的 `options` 提供 route provider 与模型 id，不提供 endpoint、凭据或 Command Code account plan。默认登记不预填 Provider ID；仅在用户确认 GOAT route 使用专属、稳定的 ID 后，插件才可按该精确 ID 自动标注。若同一 ID/凭据之后改作 Provider 按量计划，旧记录不能仅靠模型名或 endpoint 可靠区分，应按会话/时间范围手动调整通道。

默认套餐月费为 `10`（官方公开价 $10/月，2026-11-02 核验；实付不同可在面板修改），币种 USD，来源链接指向 GOAT 官方说明。额度规则仅存档核验，本阶段不实现窗口、百分比或剩余额度模拟。

## 第三方市场模型别名核验（2026-11-02）

模型目录端点 `GET https://api.commandcode.ai/provider/v1/models`（Bearer 授权，2026-11-02 抓取，共 95 个模型；原始响应存档 `docs/source-verification/command-code-goat-models.json`）。整理原则：**裸名直命中不登记**——裸名与官方型号名大小写不敏感相等、或已是价目目录内 scope * 别名的，resolver 直接命中，无需冗余登记；只登记 GOAT 的「厂商前缀形态」（`vendor/model`）。目录里没有对应官方条目的市场形态一律不登记、不猜价。以下映射登记为 scope 限定 `command-code-goat` 的别名（在哪家核验在哪家生效，不外推到其他平台）：

| 市场 ID（GOAT 路由形态） | 映射官方型号 | 依据 |
| --- | --- | --- |
| `deepseek/deepseek-v4.1-flash`、`deepseek-v4.1-flash` | `deepseek-flash` | GOAT 目录 + DeepSeek 价格页脚注 1（旧名请求由 DeepSeek-V4.1-Flash-1017 提供服务并按 Flash 价格计费，见 deepseek.zh-CN.md） |
| `deepseek/deepseek-v4-flash` | `deepseek-flash` | 裸名 `deepseek-v4-flash` 已是目录内 scope * 别名（DeepSeek 脚注 1），补 GOAT 前缀形态 |
| `deepseek/deepseek-v4-flash-vision-exp` | `deepseek-flash` | 同上（裸名 `deepseek-v4-flash-vision-exp` 已是 scope * 别名） |
| `deepseek/deepseek-v4-pro` | `deepseek-v4-pro` | GOAT 目录 ID 去厂商前缀即官方型号（裸名直命中） |
| `xiaomi/mimo-v2.6-flash` | `mimo-v2.6-flash` | GOAT 目录 ID 与小米官方型号名对应（去厂商前缀），官方条目已在核验价目目录 |
| `xiaomi/mimo-v2.6-pro` | `mimo-v2.6-pro` | GOAT 目录 ID 去厂商前缀即官方型号（裸名直命中），补前缀形态 |
| `xiaomi/mimo-v2.6-pro-ultraspeed` | `mimo-v2.6-pro-ultraspeed` | 同上 |
| `Qwen/Qwen3.8-Max`、`Qwen/Qwen3.8-Max-0902` | `qwen3.8-max` | GOAT 目录 ID 去厂商前缀即官方型号；裸名 `Qwen3.8-Max` 直命中、`Qwen3.8-Max-0902` 已是目录内 scope * 别名，补前缀形态 |
| `Qwen/Qwen3.8-27B` | `qwen3.8-27b` | 同上（裸名直命中，补前缀形态） |
| `Qwen/Qwen3.8-Flash` | `qwen3.8-flash` | 同上 |
| `Qwen/Qwen3.7-Max` | `qwen3.7-max` | 同上 |
| `Qwen/Qwen3.7-Plus` | `qwen3.7-plus` | 同上 |
| `Qwen/Qwen3.7-Flash` | `qwen3.7-flash` | 同上 |
| `Qwen/Qwen3.6-Plus` | `qwen3.6-plus` | 同上 |
| `moonshotai/Kimi-K3.1-Pro` | `kimi-k3.1-pro` | 同上 |
| `moonshotai/Kimi-K3` | `kimi-k3` | 同上 |
| `moonshotai/Kimi-K2.7-Code` | `kimi-k2.7-code` | 同上 |
| `moonshotai/Kimi-K2.7-Code-Highspeed` | `kimi-k2.7-code-highspeed` | 同上 |
| `moonshotai/Kimi-K2.6` | `kimi-k2.6` | 同上 |
| `z-ai/glm-5.3-flash` | `glm-5.3-flash` | GOAT 目录 ID 与智谱官方型号名对应（去厂商前缀），官方条目已在核验价目目录 |
| `z-ai/glm-5.3-flashx` | `glm-5.3-flashx` | 同上 |
| `zai-org/GLM-5.3` | `glm-5.3` | GOAT 目录 ID 去厂商前缀即官方型号（裸名大小写不敏感直命中），补前缀形态 |
| `zai-org/GLM-5.2` | `glm-5.2` | 同上 |
| `zai-org/GLM-5.1` | `GLM-5.1` | 同上 |
| `zai-org/GLM-5` | `GLM-5` | 同上 |

排除不登记（无对应官方条目或无官方价目，不猜）：

- `deepseek/deepseek-v4-flash-fast`、`deepseek/deepseek-v4.1-flash-fast`：五家价目目录均无 fast 变体。
- `Qwen/Qwen3.8-Omni-Flash`、`Qwen/Qwen3.8-Max-Prime`、`Qwen/Qwen3.6-Max-Preview`、`moonshotai/Kimi-K2.5`、`zai-org/GLM-5.2-Fast`：对应官方型号不在已核验价目目录。
- `meta/muse-spark-1.3-contributor`、`inclusionai/ling-3.1-flash-1019:free`、`claude-haiku-5-5` 等：五家核验源中均无官方价目 → 维持「未计价」显形（金额 null，不进汇总与订阅回本分子）。

别名登记在 lib/pricing/sources/index.js 的 `MARKETPLACE_ALIASES`，挂在 parse 出口（seed 生成与运行时刷新同路，刷新不会冲掉）；官方型号名大小写不敏感比对（实抓 GLM 目录为混合大小写，如 `GLM-5.3-Flash`）；测试见 test/marketplace-alias.test.js。
