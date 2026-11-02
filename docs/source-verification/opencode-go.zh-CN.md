# OpenCode Go 通道核验

核验日期：2026-11-02（北京时间）

## 官方产品与配额资料

- [OpenCode Go 官方说明](https://opencode.ai/v2/docs/console/go/)列出 Go 月费 $10、Go Plus 月费 $40；支持的模型清单会变化。每个模型有独立的月度美元限额，官方明确列出 5 小时限额为月额度的 20%、每周限额为 50%、月度限额为 100%。超过额度后，只有启用 Extra Usage 且账户有余额时才会改走按量余额。
- 同一说明页提供按模型的公开按量价格与月额度。模型用量规则公开，因此“没有公开配额规则”不适用于当前 OpenCode Go。
- OpenCode 的[应用 API 文档](https://dev.opencode.ai/v2/docs/api)列出 `GET /api/experimental/usage/limits`，读取已登录 OpenCode Console workspace 的 Go allowance 与 Console budget；[Inference API 文档](https://opencode.ai/v2/docs/console/api/inference)说明 Go 请求响应含 `opencode.allowance`。这两项不是 DSH 当前 `llm/stream` 记录中的稳定通道字段，本阶段不接入。
- Go 调用使用独立于 Console inference 的 Go inference endpoint（URL 路径含 `/inference/go/`）。官方示例使用 `opencode-go/<model-id>` 作为 OpenCode 自身的 provider/model 路由。
- OpenCode Go 文档将 DeepSeek Harness 列为会话信息支持不完整的客户端：部分模型路径有会话信息，部分缺失。因此本插件不依赖会话 ID 做自动归因；手动回填时可改用日期范围。

## DSH 归因结论

DSH 的[模型配置说明](https://deepseek-harness.github.io/deepseek-harness/en/guide/providers)允许用户自定义 provider id、base URL、协议与凭据。当前插件在 `llm/stream` 只读取 `options.provider`、`options.model`、`options.purpose`、`options.sessionId` 与调用模式；不会把 endpoint 或认证数据持久化进用量记录。中断兜底仍使用同一回调闭包里的 provider/model。

因此，订阅 endpoint 与按量 endpoint 的差异不会自动出现在记录里。只有 DSH route 使用专门、稳定的 Provider ID（例如 `opencode-go`）时才可按该 ID 精确自动归因。旧记录和 Provider ID 复用过的调用使用面板按会话/时间范围手动标记，`basis` 保存 `manual:<UTC 时间>`。同模型名本身不参与归因。

默认登记使用 `USD`、月费 `0`（待用户登记实际支付额），Provider ID 留空。`opencode-go` 只是 OpenCode 自身示例路由名称，不是 DSH 的实际配置证据；维护者应先确认本机 DSH 配置，再填写专属且稳定的 Provider ID。额度窗口和比例只记录核验结论，本阶段不模拟。

