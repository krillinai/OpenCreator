# OpenCreator 错误码向 Agent 输出覆盖清单

## 输出约定

- 所有进入 Issue 的错误都在 Agent 文字中显示业务错误码；不显示 `OC-` 诊断编号，也不把 `technicalDetail`、堆栈、任意供应商正文或请求内容直接展示给用户。
- 已确认的事实只来自业务码的确定语义、白名单网络错误、上游 HTTP 状态和经过格式限制的上游错误码。供应商名称、上游码和 HTTP 状态与 OpenCreator 业务码分别展示。
- 旧 Issue 和未提供结构化事实的第三方错误会明确写“当前记录未提供更细的原因”，不能从历史通用文案反推 DNS、鉴权或配额原因。
- 同一 Issue 再次发生时，原因事实以本次失败为准；本次没有事实时不能沿用上一次的原因。重试确认、付费请求与未知远端接收状态的既有门禁不变。

## 出口覆盖

| 错误来源 | Agent 可见内容 | 更细原因来源 |
| --- | --- | --- |
| 协议声明的 159 个 Runtime 业务码及新增业务码 | 原样业务码（安全字符过滤后） | 明确语义的配置、校验、不存在、冲突、不支持、存储、鉴权分类；其余显示未知 |
| Web 请求、上传、文件、设置等页面操作 | API 业务码或本地 `NETWORK_ERROR` / `INVALID_JSON_RESPONSE` | API 结构化事实、本地请求超时、HTTP 状态；不解析任意响应正文 |
| Creator Stage、Provider Ledger 与 Agent turn | Stage 或 Provider 的业务码 | 网络白名单、上游 HTTP 状态/码、明确的配置码；事实随 Issue 存储和重试更新 |
| 图像、视频、智能配音和 TTS 接口 | 对应 `*_UPSTREAM_ERROR` 等业务码 | Provider、DNS/连接/超时/TLS、上游 HTTP 状态及安全上游码 |
| 文章、封面分析、短视频脚本、小红书文案 | `creator_llm_upstream_error` 或相应 Stage 码 | LLM HTTP 状态、安全上游码及网络失败类别 |
| 视频异步任务返回失败 | 视频任务结果中的安全上游码（若有） | 不展示 Provider 任意失败正文；无安全码时明确原因未确认 |
| 旧任务、未知第三方异常 | 已记录的业务码与操作上下文 | 不伪造细节，允许用户继续在 Agent 区域询问排查方向 |

`error-code-coverage.test.ts` 使用 TypeScript AST 枚举协议中的 `RuntimeErrorCode`，新增协议码时自动检查其 Agent 文本仍显示业务码且不泄漏技术详情。定向测试另覆盖网络/HTTP 归类、Provider 响应脱敏、SQLite 重复 Issue、客户端传递和三类媒体 API。
