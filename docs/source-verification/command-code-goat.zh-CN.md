# Command Code GOAT 通道核验

核验日期：2026-11-02（北京时间）

## 名称、价格与额度

目标套餐的官方名称是 **Command Code GOAT**；“Command Goat”不是套餐正式名称。

- [GOAT 官方说明](https://commandcode.ai/docs/plans/goat)列出 $10/月、各模型有独立额度、合计最多 $100 credits；用量上限为任意 5 小时最多 $20、任意 7 天最多 $50、每月最多 $100。窗口及账期按各自周期重置；额外购买的按量 credits 按模型常规价格计费，不计入套餐额度。
- [官方 Provider API 文档](https://commandcode.ai/docs/provider)说明除 $1/月 Go plan 外，GOAT 等计划可通过 OpenAI/Anthropic 兼容 API 使用，调用从订阅 credits 扣减。GOAT 与 Provider 按量计划都使用 `https://api.commandcode.ai/provider/v1` 端点，因此仅凭 endpoint 无法分辨套餐结算归属。官方页面也列有 usage analytics 与 per-request cost，但核验到的资料未给出可供本插件调用的公开 usage/quota API。
- 官方页面明确说明 Go plan 仅供 Command Code CLI 使用且不提供 Provider API；它不是本插件的目标 API 通道。

## DSH 归因结论

DSH 自定义 API route 的 provider id 由用户设定，`llm/stream` 的 `options` 提供 route provider 与模型 id，不提供 endpoint、credential 或 Command Code account plan。默认登记不预填 Provider ID；仅在用户确认 GOAT route 使用专属、稳定的 ID 后，插件才可按该精确 ID 自动标注。若同一 ID/凭据之后改作 Provider 按量计划，旧记录不能仅靠模型名或 endpoint 可靠区分，应按会话/时间范围手动调整通道。

默认套餐月费为 `10`（官方公开价 $10/月，2026-11-02 核验；实付不同可在面板修改），币种 USD，来源链接指向 GOAT 官方说明。额度规则仅存档核验，本阶段不实现窗口、百分比或剩余额度模拟。

