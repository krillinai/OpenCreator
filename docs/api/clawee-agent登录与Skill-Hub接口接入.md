# Clawee Agent 登录、MCP 能力目录、Skill Hub、知识库与共享文件接口接入文档

## 1. 文档目的

本文定义 Clawee Agent 接入企业 MCP Gateway 登录、MCP 能力目录、Skill Hub、账户授权知识库和共享文件空间所需的 HTTP API、调用流程、错误处理和 Clawee 侧实现约束。

本文面向 Clawee Web、Desktop 和 Daemon 的开发与测试人员。接口提供方为 `claw-mcp`，下文统一称为“企业服务”。

## 2. 接入范围

本次接入包括：

1. 注册普通服务账号。
2. 使用已注册账号登录 Clawee。
3. 查询当前登录账号和会话状态。
4. 注销并撤销当前服务会话。
5. 获取当前账户的 Collector 注册码和一键安装命令。
6. 执行 Collector 首次安装或更新。
7. 获取当前 Agent 的 MCP Token，并查询全部 upstream MCP endpoint、Tool 和当前 Agent 的有效授权状态。
8. 获取当前账户授权的 Skill 空间及空间动作。
9. 获取当前账户可读空间中已发布的 Skill。
10. 获取 Skill 当前发布版本详情。
11. 下载指定发布版本的 Skill ZIP 包。
12. 向具有写权限的 Skill 空间上传并发布 Skill。
13. 校验并安装 Skill 到本机 Codex Skills 目录。
14. 根据远端版本信息识别可安装、已安装和可更新状态。
15. 获取当前账户授权的知识库列表。
16. 获取授权知识库的文档列表。
17. 向具有上传权限的知识库上传文档。
18. 分页查询当前账户授权的共享文件空间和文件。
19. 查询、流式下载、新建和按 revision 替换共享文件。

本次接入不包括：

1. 特殊企业账户、企业身份源或管理员预分配账号。
2. 调用企业后台 `/api/v1/admin/*` 接口。
3. 在 Clawee 内创建或管理 Skill 空间、管理空间成员、切换当前发布版本或下架 Skill。
4. 由企业服务操作用户本地文件或 Codex Skills 目录。
5. OAuth Device Flow、Refresh Token 或跨设备同步。
6. 用企业 Skill Hub 替换 Clawee 现有公共 Skill Market。
7. 在 Clawee 内管理知识库或账户数据授权。
8. 在本阶段迁移 MCP 知识检索的 Agent Grant 判定。

## 3. 职责边界

### 3.1 企业服务

企业服务负责：

1. 按客户端类型注册普通账号；Clawee 注册时使用客户端提供的 `agent_id` 创建并绑定 Agent。
2. 校验账号和密码。
3. 为 `clawee-agent` 签发应用端 Bearer JWT。
4. 校验会话、账号状态和 Token 有效性。
5. 为 Clawee 查询或隐式创建当前账户的 Collector 注册码，并返回一键安装命令。
6. 向当前 Clawee 会话下发其绑定 Agent 的 MCP Token，并返回全部 upstream 的受治理 MCP endpoint、Tool 和当前 Agent 的授权状态。
7. 按当前账户的 Skill 空间授权返回空间、已发布 Skill、详情和版本信息。
8. 分发经过服务端校验的 Skill ZIP 包，并接收具备空间写权限的 Clawee Agent 上传的新版本。
9. 按当前账户数据权限返回知识库和文档，并代理经过校验的文档上传。
10. 返回稳定的 HTTP 状态码和业务错误码。

### 3.2 Clawee Daemon

Clawee Daemon 是企业服务的唯一调用方，负责：

1. 代理注册、登录、当前账号查询和注销请求。
2. 在首次注册或登录前生成并持久化稳定的 `agent_id`，并保存企业服务地址和企业会话 Token。
3. 为 Clawee Web 与 Desktop 提供统一的本地登录状态。
4. 从当前账号接口读取 Collector 一键安装命令，并按操作系统执行首次安装或更新。
5. 获取当前会话绑定 Agent 的 MCP Token，将其保存到系统安全凭据存储，并且不得返回给 Web 或 Desktop 渲染进程。
6. 获取全部 upstream MCP endpoint 和 Tool 授权目录，供本地展示和安装受治理的企业 MCP。
7. 获取当前账户授权的 Skill 空间、空间动作、Skill 列表、详情和 ZIP 包。
8. 仅向同时具有 `read` 和 `write` 的 Skill 空间代理 Skill ZIP 上传。
9. 校验 ZIP 包 SHA-256，安全解压到临时目录。
10. 复用 Clawee 现有 Skill 安装事务、覆盖策略和回滚能力。
11. 保存包含 Skill 空间标识的企业 Skill 安装记录，并计算更新状态。
12. 获取知识库和文档列表，并以流式 Multipart 请求代理用户选择的文档上传。

### 3.3 Clawee Web 与 Desktop

Clawee Web 与 Desktop 只调用本地 Daemon，不直接请求企业服务。

通用登录、Skill Hub 和知识库业务必须由 Web/Desktop 共用的 Daemon API 和 Service 实现。Desktop Bridge 不得单独实现企业登录、Skill 空间与列表、Skill 上传、知识库访问、文档上传或安装逻辑。

## 4. 总体调用链路

```text
Clawee Web / Desktop
        |
        | 本地 Runtime API，使用 Clawee Runtime Token
        v
Clawee Daemon
        |
        | HTTP；注册/登录无认证，后续请求使用 Bearer Token
        v
企业服务 /api/v1/auth/* 与 /api/v1/app/*
```

企业 JWT 不得返回给 React 渲染进程。Web 与 Desktop 只能读取账号、会话状态和业务数据，不得读取企业 Token 明文。

## 5. 通用 HTTP 约定

### 5.1 服务地址

当前接入使用以下固定服务 Origin：

```text
http://1.13.175.31:1904
```

Clawee 配置中保存企业服务 Origin，不保存带业务路径的完整 URL。当前地址使用 HTTP，账号密码和 Bearer Token 会以未加密的 HTTP 流量传输；切换到生产域名时应启用 HTTPS，但在服务端地址正式变更前，客户端不得自行改写协议、主机或端口。

### 5.2 请求头

JSON 请求：

```http
Accept: application/json
Content-Type: application/json
```

除注册、登录和健康检查外，所有接口都必须携带：

```http
Authorization: Bearer <enterprise_access_token>
```

不得通过 Query String、Cookie、请求体或自定义日志字段传递 Bearer Token。

### 5.3 JSON 命名和时间

1. 请求和响应字段使用 `snake_case`。
2. 时间使用 UTC RFC 3339 字符串。
3. 客户端必须忽略响应中不认识的新增字段。
4. 客户端不得依赖 JSON 字段顺序。

### 5.4 成功响应包装

单资源响应：

```json
{
  "data": {}
}
```

列表响应：

```json
{
  "data": [],
  "meta": {
    "next_cursor": "",
    "has_next": false
  }
}
```

当前 Skill 空间和 Skill 列表一次返回当前账户授权范围内的全部结果。Clawee 仍应保留读取 `meta` 的能力，以兼容后续游标分页。

### 5.5 错误响应包装

```json
{
  "error": {
    "code": "unauthorized",
    "message": "未认证",
    "details": []
  }
}
```

Clawee 的业务判断应优先使用 HTTP 状态码和 `error.code`，不得依赖中文 `message` 文案。

## 6. 接口总览

| 用途 | 方法 | 路径 | 认证 |
| --- | --- | --- | --- |
| 注册账号 | `POST` | `/api/v1/auth/register` | 无 |
| 账号登录 | `POST` | `/api/v1/auth/login` | 无 |
| 查询当前账号 | `GET` | `/api/v1/auth/me` | Bearer JWT |
| 注销当前会话 | `POST` | `/api/v1/auth/logout` | Bearer JWT |
| 获取当前 Agent MCP Token | `POST` | `/api/v1/app/agents/token/reveal` | Bearer JWT |
| 获取 MCP 能力目录 | `GET` | `/api/v1/app/agents/mcp-catalog` | Bearer JWT |
| 获取授权 Skill 空间 | `GET` | `/api/v1/app/skill-spaces` | Bearer JWT |
| 获取已发布 Skill 列表 | `GET` | `/api/v1/app/skills` | Bearer JWT |
| 获取已发布 Skill 详情 | `GET` | `/api/v1/app/skills/detail?skill_id=...` | Bearer JWT |
| 下载指定 Skill 版本 | `GET` | `/api/v1/app/skills/package?skill_id=...&version_id=...` | Bearer JWT |
| 上传并发布 Skill | `POST` | `/api/v1/app/skills/versions` | Clawee Bearer JWT |
| 获取授权知识库列表 | `GET` | `/api/v1/app/knowledge-bases` | Bearer JWT |
| 获取知识库文档列表 | `GET` | `/api/v1/app/knowledge-bases/documents?knowledge_base_id=...` | Bearer JWT |
| 上传知识库文档 | `POST` | `/api/v1/app/knowledge-bases/documents` | Bearer JWT |
| 获取授权共享空间 | `GET` | `/api/v1/app/shared-spaces` | Bearer JWT |
| 查询共享文件 | `GET` | `/api/v1/app/shared-files` | Bearer JWT |
| 查询共享文件详情 | `GET` | `/api/v1/app/shared-files/detail?file_id=...` | Bearer JWT |
| 下载共享文件 | `GET` | `/api/v1/app/shared-files/content?file_id=...` | Bearer JWT |
| 新建或替换共享文件 | `POST` | `/api/v1/app/shared-files/content?space_id=...&logical_path=...` | Bearer JWT |
| 服务连通性检查 | `GET` | `/healthz` | 无 |

Clawee 不得调用历史兼容路径 `/auth/*`、`/api/v1/skills/*` 或任何 `/api/v1/admin/*` 接口。

## 7. 账号注册与登录接口

当前不引入特殊企业账户。Clawee Daemon 首次使用时必须先生成并持久化稳定的 `agent_id`，再使用该 `agent_id` 注册普通账号；注册成功后使用同一邮箱、密码和 `agent_id` 登录并获取绑定该 Agent 的 `clawee-agent` Bearer JWT。

`agent_id` 同时表示当前 Clawee 本地实例对应的逻辑 Agent，不再引入独立的 `installation_id`。企业服务不得在注册或登录接口中自动生成、补全、选择默认 Agent，或者在 `agent_id` 无效时静默创建替代 Agent。

### 7.1 `POST /api/v1/auth/register`

创建普通服务账号。第一个注册成功的账号会成为 `admin`，后续自助注册账号为普通 `user`。

当 `client_id=clawee-agent` 时，注册请求必须携带 Clawee 本地已经生成并持久化的 `agent_id`。服务端使用该 ID 创建 Agent 并绑定新账号；账号、角色、Agent 或绑定任一步失败时，整个注册操作回滚。服务端不得为 Clawee 注册请求生成默认 Agent ID。

请求：

```http
POST /api/v1/auth/register HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/json
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "name": "张三",
  "password": "user-password",
  "client_id": "clawee-agent",
  "agent_id": "clawee_550e8400-e29b-41d4-a716-446655440000"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 登录邮箱；服务端会去除首尾空白并转换为小写 |
| `name` | string | 否 | 用户显示名称；服务端会去除首尾空白 |
| `password` | string | 是 | 密码，当前要求至少 8 个字符 |
| `client_id` | string | 是 | Clawee 固定为 `clawee-agent` |
| `agent_id` | string | 是 | Clawee 本地生成并持久化的稳定 Agent ID；注册和后续登录必须使用同一个值 |

Clawee 的 `agent_id` 生成和传入规则：

1. Daemon 在第一次注册或登录请求前生成全局唯一、不可包含邮箱、用户名或设备路径等敏感信息的 ID，推荐格式为 `clawee_<UUID>`。
2. Daemon 必须先把 `agent_id` 原子写入本地普通配置，再发起远端注册或登录请求；`agent_id` 不是秘密，不与 Bearer Token 存放在同一安全凭据字段中。
3. 注册失败、登录失败、网络超时、Token 过期和注销都不得自动更换或重新生成 `agent_id`。
4. 注册和登录请求都必须显式传递 `client_id=clawee-agent` 和非空 `agent_id`。
5. 企业服务收到 `client_id=clawee-agent` 且 `agent_id` 缺失或格式无效时，必须在创建账号、Agent、绑定或 Session 前返回 `400 invalid_request`。
6. 企业服务不得在 `agent_id` 缺失时自动生成 ID，不得自动选择账号的默认 Agent，也不得把无权访问的 ID 替换为新 Agent。客户端已经明确传入且尚不存在的有效 `agent_id`，可以按本文登录或注册规则创建并绑定。

成功响应：`200 OK`

```json
{
  "data": {
    "account": {
      "user_id": "usr_123",
      "email": "user@example.com",
      "name": "张三",
      "status": "active"
    },
    "agent": {
      "agent_id": "clawee_550e8400-e29b-41d4-a716-446655440000",
      "name": "张三"
    },
    "applications": {
      "frontend": true,
      "admin": false
    },
    "redirect_to": "/app"
  }
}
```

注册响应不包含 Bearer Token。Clawee 注册请求使用 `client_id=clawee-agent`，服务端不得为该响应写入 Web 登录 Cookie；注册成功后必须继续调用 `/api/v1/auth/login`，并传递相同的 `client_id` 和 `agent_id` 获取 Bearer JWT。

Clawee 注册流程：

1. Daemon 确认本地存在有效 `agent_id`；不存在时先生成并原子持久化，不得先调用远端接口。
2. 用户提交邮箱、可选名称和密码。
3. Daemon 调用 `/api/v1/auth/register`，固定传递 `client_id=clawee-agent` 和本地 `agent_id`。
4. 注册成功后，Daemon 使用同一邮箱、密码和 `agent_id` 立即调用 `/api/v1/auth/login`。
5. 登录成功后保存响应中的 `access_token` 和 `expires_at`，并校验响应 `agent.agent_id` 与本地配置完全一致。
6. 注册或后续登录任一步失败时，不进入已登录状态；不得更换本地 `agent_id`，密码不得持久化或写入日志。

常见失败：

| HTTP | `error.code` | 场景 | Clawee 行为 |
| --- | --- | --- | --- |
| `400` | `invalid_request` | JSON 无效、邮箱为空、密码少于 8 个字符、`client_id` 不正确或缺少有效 `agent_id` | 提示注册参数无效，不自动重试、不更换 `agent_id` |
| `409` | `agent_id_conflict` | `agent_id` 已存在且不能绑定到当前新账号 | 保留本地 `agent_id` 并提示冲突，不自动生成替代 ID |
| `500` | `internal_error` | 账号创建、权限初始化、Agent 创建或绑定失败 | 保留注册页，允许用户核对账号状态后手动重试或登录 |
| `502/503` | 网关或服务不可用 | 企业服务暂不可用 | 保留注册页，允许用户手动重试 |

### 7.2 `POST /api/v1/auth/login`

使用已注册账号和密码创建 Clawee 应用会话。

请求：

```http
POST /api/v1/auth/login HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/json
Content-Type: application/json
```

```json
{
  "email": "user@example.com",
  "password": "user-password",
  "client_id": "clawee-agent",
  "agent_id": "clawee_550e8400-e29b-41d4-a716-446655440000"
}
```

字段说明：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `email` | string | 是 | 已注册账号邮箱 |
| `password` | string | 是 | 已注册账号密码 |
| `client_id` | string | 是 | 固定为 `clawee-agent` |
| `agent_id` | string | 是 | 本地配置中的稳定 Agent ID；通过 Clawee 注册过账号时必须与注册值一致，已有 Web 账号首次登录时用于创建并绑定 Clawee Agent |

当 `client_id=clawee-agent` 时，缺少或传入空白 `agent_id` 必须返回 `400 invalid_request`，不能签发账户级 Token，也不能自动生成、自动选择或下发 Agent ID。服务端在账号密码验证成功后按以下规则处理客户端明确传入的 ID：

1. `agent_id` 不存在：创建该 Agent 并绑定当前账号，用于已有 Web 账号第一次登录 Clawee。
2. `agent_id` 已存在且属于当前账号、状态可用：复用该 Agent。
3. `agent_id` 已存在但属于其他账号：返回 `409 agent_id_conflict`，不得创建替代 Agent。
4. `agent_id` 已存在但状态不可用：返回 `403 agent_forbidden`。

Agent、账号绑定和初始 Agent Token 必须原子创建，成功后再签发 Session。Session 签发失败时本次登录仍然失败，但可以保留已经完整创建并归属于当前账号的 Agent；Clawee 使用同一个本地 `agent_id` 重试登录时必须复用该 Agent，不得重复创建或生成替代 ID。

成功响应：`200 OK`

```json
{
  "data": {
    "account": {
      "user_id": "usr_123",
      "email": "user@example.com",
      "name": "张三",
      "status": "active"
    },
    "agent": {
      "agent_id": "clawee_550e8400-e29b-41d4-a716-446655440000",
      "name": "张三"
    },
    "access_token": "eyJ...",
    "token_type": "Bearer",
    "expires_at": "2026-07-31T10:00:00Z"
  }
}
```

Clawee 处理要求：

1. 登录请求只能由本地 Daemon 发起。
2. Daemon 保存 `access_token` 和 `expires_at`，并保留普通配置中的 `agent_id`；不得保存密码。
3. 密码在请求完成后不得进入日志、诊断包、SQLite 或普通配置文件。
4. `token_type` 必须为 `Bearer`；其他值按协议错误处理。
5. `account.status` 不是 `active` 时不得进入已登录状态。
6. 响应缺少 `agent.agent_id`，或响应值与本地 `agent_id` 不一致时，按协议错误处理，清除本次 Token，但不得覆盖本地 `agent_id`。
7. 登录失败后不得自动重复提交账号密码，不得自动创建或更换 Agent。

常见失败：

| HTTP | `error.code` | Clawee 行为 |
| --- | --- | --- |
| `400` | `invalid_request` | 登录参数无效，包含缺少 `client_id` 或 `agent_id`；不重试、不更换 `agent_id` |
| `401` | `unauthorized` | 提示账号或密码错误，不保存任何会话数据 |
| `403` | `agent_forbidden` | 当前账号绑定的 Agent 状态不可用；不创建新 Agent |
| `409` | `agent_id_conflict` | `agent_id` 已属于其他账号；不创建替代 Agent，不更换本地 ID |
| `500` | `internal_error` | 保留登录页，允许用户手动重试 |
| `502/503` | 网关或服务不可用 | 提示企业服务暂不可用，允许用户手动重试 |

### 7.3 与 Web `/app` 的接口区分

注册和登录接口通过 `client_id` 区分 Web 与 Clawee，不通过 User-Agent、Origin、Cookie 是否存在或请求来源地址推断客户端类型。

| 客户端 | `client_id` | `agent_id` | 登录状态 | Agent 使用方式 |
| --- | --- | --- | --- | --- |
| Web `/app` | 省略或 `web` | 不要求 | 账户级 Web Cookie/JWT | 页面显式选择和切换当前账号拥有的 Agent，服务端逐次校验归属 |
| Clawee Agent | 固定为 `clawee-agent` | 必填 | 绑定固定 `agent_id` 的 Bearer JWT | 当前 Agent 来自认证 Principal，普通业务请求不能切换 |
| Electron 兼容客户端 | `electron` | 保持现有规则 | 应用端 Bearer JWT | 不自动套用 Clawee 的 Agent 绑定规则 |

服务端分支规则：

1. `/api/v1/auth/register` 收到省略的 `client_id` 或 `client_id=web` 时，继续执行现有 Web 注册流程，不要求 `agent_id`，并维持 Web Cookie 和 `/app` 行为。
2. `/api/v1/auth/login` 收到省略的 `client_id` 或 `client_id=web` 时，继续签发账户级 Web 登录态，不要求或绑定 `agent_id`。
3. 只有 `client_id=clawee-agent` 时，注册和登录才强制要求 `agent_id`；登录签发的 JWT 和服务端 Session 都必须绑定该 ID。
4. Clawee 后续请求中的当前 Agent 必须从认证后的 Principal 读取。即使请求 Query 或 JSON 中出现 `agent_id`，也只能用于一致性校验，不能覆盖登录态绑定。
5. Web `/app` 的显式 Agent 切换不修改 Clawee Session，也不会改变 Clawee 本地配置中的 `agent_id`。

## 8. 当前账号接口

### 8.1 `GET /api/v1/auth/me`

用于验证已保存 Token、恢复登录状态和获取当前账号信息。

请求：

```http
GET /api/v1/auth/me HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/json
Authorization: Bearer <enterprise_access_token>
```

成功响应：`200 OK`

```json
{
  "data": {
    "account": {
      "user_id": "usr_123",
      "email": "user@example.com",
      "name": "张三",
      "status": "active"
    },
    "agent": {
      "agent_id": "clawee_550e8400-e29b-41d4-a716-446655440000",
      "name": "张三"
    },
    "collector_registration": {
      "exists": true,
      "registration_code": "reg_xxx",
      "created_by": "张三",
      "created_at": "2026-08-04T10:00:00Z",
      "used_count": 0,
      "revoked": false,
      "install_url": "http://1.13.175.31:1904/office/collectors/install?code=reg_xxx",
      "install_script_url": "http://1.13.175.31:1904/office/collectors/install.sh?code=reg_xxx",
      "install_command": "curl -fsSL 'http://1.13.175.31:1904/office/collectors/install.sh?code=reg_xxx' | sh",
      "install_powershell_command": "irm 'http://1.13.175.31:1904/office/collectors/install.ps1?code=reg_xxx' | iex"
    },
    "applications": {
      "frontend": true,
      "admin": false
    },
    "admin_roles": [],
    "admin_permissions": []
  }
}
```

Clawee 依赖 `account`、`agent.agent_id` 和 `applications.frontend`。后台角色和权限不参与 Clawee 应用端授权判断。`agent.agent_id` 必须与本地配置一致；缺失或不一致时不得恢复为已登录状态。

`collector_registration` 只对 `client_id=clawee-agent` 的登录态返回。企业服务会查询当前账户的有效注册码；没有有效注册码时在账户级事务锁内隐式生成一次，已有有效注册码时直接复用。重复或并发调用 `/api/v1/auth/me` 不得轮换注册码，并且最终只能返回同一个有效注册码。

Daemon 根据本机系统选择一键安装命令：

1. macOS 和 Linux 执行 `install_command`。
2. Windows 执行 `install_powershell_command`。
3. 安装脚本同时用于首次安装和后续更新；Daemon 不得自行拼接注册码、服务地址或安装脚本 URL。
4. `registration_code`、`install_url`、`install_script_url` 和两种完整安装命令都包含敏感注册码，不得写入日志、审计数据、诊断包、React 状态持久化或普通配置文件。
5. 命令执行失败不代表企业登录失效。Daemon 保留有效 Token 和 `agent_id`，单独返回 Collector 安装或更新失败状态，允许用户重试。

企业服务无法查询或创建注册码时，`/api/v1/auth/me` 返回 `500 collector_registration_failed`；Collector 注册码服务未启用时返回 `503 collector_registration_unavailable`。这两种情况按“企业服务暂不可用”处理，不得清除仍可能有效的 Token。

启动恢复流程：

1. Daemon 读取安全存储中的企业 Token。
2. 没有 Token 时返回“未登录”，不请求企业服务。
3. 有 Token 时调用 `/api/v1/auth/me`。
4. 返回 `200`、账号为 active 且 `agent.agent_id` 与本地配置一致时恢复登录状态，然后读取 `collector_registration` 并按当前操作系统执行一键安装或更新命令。
5. Collector 安装或更新失败不改变登录状态；保留企业会话并返回独立的 Collector 错误状态。
6. 返回 `401` 时删除本地 Token 并进入未登录状态。
7. 网络失败或 `5xx` 时进入“企业服务暂不可用”，不得误删仍可能有效的 Token。

## 9. 注销接口

### 9.1 `POST /api/v1/auth/logout`

撤销当前 Bearer Token 对应的企业会话。

请求：

```http
POST /api/v1/auth/logout HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/json
Authorization: Bearer <enterprise_access_token>
```

成功响应：`204 No Content`

Clawee 注销顺序：

1. Daemon 调用企业注销接口。
2. 接口返回 `204` 后删除本地 Token 和账号缓存，但保留本地 `agent_id`，供下次登录复用。
3. 接口返回 `401` 时同样删除本地 Token，因为远端会话已经不可用；仍保留 `agent_id`。
4. 网络失败时保留 Token，并向用户说明远端注销未完成，避免把“只清理本地”误报为已注销。
5. 注销不删除已安装 Skill 和 Skill 安装记录。

## 10. Skill 空间与列表接口

Skill 空间是 Clawee 账户访问 Skill 的授权边界。空间授权复用企业服务统一的数据资源授权，资源类型为 `skill_space`，动作固定为：

| 动作 | 当前用途 |
| --- | --- |
| `read` | 查看空间、已发布 Skill、详情和 ZIP 下载 |
| `write` | 向空间上传 Skill；账户必须同时具有 `read` |

空间成员限制只适用于 Clawee Agent 客户端。企业管理后台仍按后台 RBAC 权限访问全部空间，不要求管理员成为空间成员。Clawee 不得调用管理后台接口创建空间或管理成员。

### 10.1 `GET /api/v1/app/skill-spaces`

返回当前账户具有 `read` 动作的 Skill 空间及权限快照。

请求：

```http
GET /api/v1/app/skill-spaces HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/json
Authorization: Bearer <enterprise_access_token>
```

成功响应：`200 OK`

```json
{
  "data": [
    {
      "space_id": "skillspace_123",
      "name": "研发技能",
      "description": "研发团队维护的 Skill",
      "updated_at": "2026-08-07T09:00:00Z",
      "actions": ["read", "write"]
    }
  ],
  "meta": {
    "next_cursor": "",
    "has_next": false
  }
}
```

`actions` 是当前账户在对应空间上的服务端权限快照。Clawee 不得自行推导或扩大权限；上传入口只能对同时返回 `read` 和 `write` 的空间开放。

### 10.2 `GET /api/v1/app/skills`

返回当前账户具有空间 `read` 权限且存在当前发布版本的 Skill。其他空间的 Skill、未发布或已下架 Skill 不出现在列表中。

请求：

```http
GET /api/v1/app/skills HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/json
Authorization: Bearer <enterprise_access_token>
```

成功响应：`200 OK`

```json
{
  "data": [
    {
      "skill_id": "skill_123",
      "space_id": "skillspace_123",
      "space_name": "研发技能",
      "name": "code-review",
      "description": "企业代码审查规范",
      "version_id": "skillver_456",
      "version": "1.2.0",
      "package_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "updated_at": "2026-07-30T08:00:00Z"
    }
  ],
  "meta": {
    "next_cursor": "",
    "has_next": false
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `skill_id` | string | 企业服务内部的不透明 Skill 标识，用于详情和下载请求 |
| `space_id` | string | Skill 所属空间的不透明标识，用于展示归属和安装记录 |
| `space_name` | string | Skill 所属空间当前名称，仅用于展示 |
| `name` | string | Skill 包中声明的名称，也是 Clawee 本地安装目录名 |
| `description` | string | 当前发布版本的说明 |
| `version_id` | string | 当前发布版本的不透明标识 |
| `version` | string | 展示用版本字符串，不保证符合 SemVer |
| `package_sha256` | string | 原始 ZIP 字节的 SHA-256，64 位小写十六进制 |
| `updated_at` | string | 当前发布状态最近更新时间 |

列表按 `updated_at` 倒序返回。Clawee 不得对 `version` 做大小比较；是否存在更新以 `version_id` 和 `package_sha256` 为准。

## 11. Skill 详情接口

### 11.1 `GET /api/v1/app/skills/detail`

请求 Query：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `skill_id` | 是 | 列表返回的不透明 Skill 标识 |

请求示例：

```http
GET /api/v1/app/skills/detail?skill_id=skill_123 HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/json
Authorization: Bearer <enterprise_access_token>
```

成功响应：`200 OK`

```json
{
  "data": {
    "skill_id": "skill_123",
    "space_id": "skillspace_123",
    "space_name": "研发技能",
    "name": "code-review",
    "description": "企业代码审查规范",
    "version_id": "skillver_456",
    "version": "1.2.0",
    "package_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "updated_at": "2026-07-30T08:00:00Z",
    "changelog": "修复安装说明"
  }
}
```

Skill 不存在、未发布、已下架或当前账户没有所属空间的 `read` 权限时，统一返回 `404 not_found`，不得据此判断资源是否真实存在。Clawee 收到该错误后应刷新 Skill 空间和 Skill 列表，并取消本次安装或更新操作。

## 12. Skill 包下载与上传接口

### 12.1 `GET /api/v1/app/skills/package`

下载列表或详情中声明的指定发布版本。

请求 Query：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `skill_id` | 是 | Skill 标识 |
| `version_id` | 是 | 本次准备安装的版本标识 |

请求示例：

```http
GET /api/v1/app/skills/package?skill_id=skill_123&version_id=skillver_456 HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/zip
Authorization: Bearer <enterprise_access_token>
```

成功响应：`200 OK`

```http
Content-Type: application/zip
Content-Disposition: attachment; filename="code-review-1.2.0.zip"
Content-Length: 12345
```

响应体为原始 ZIP 字节，不使用 JSON 包装。

下载约束：

1. Clawee 必须同时传递 `skill_id` 和 `version_id`。
2. 企业服务只在该 `version_id` 仍是当前发布版本时返回 ZIP。
3. 发布版本在列表读取后发生变化时，企业服务返回 `409 version_changed`。
4. Clawee 收到 `409 version_changed` 后刷新列表或详情，不得继续使用旧元数据重试下载。
5. Clawee 必须按元数据中的 `package_sha256` 校验原始响应字节。
6. SHA-256 不一致时立即删除临时文件，记录不含内容和凭证的诊断信息，并重新获取一次元数据；不得安装校验失败的包。
7. 当前账户没有 Skill 所属空间的 `read` 权限时统一返回 `404 not_found`。

### 12.2 `POST /api/v1/app/skills/versions`

向指定 Skill 空间上传 ZIP 并立即发布为当前版本。该接口只接受有效的 `clawee-agent` Bearer Token，且 Token 绑定的 Agent 必须仍属于当前账户并处于可用状态；普通 Web Token 即使属于同一账户也不能调用。

请求：

```http
POST /api/v1/app/skills/versions HTTP/1.1
Host: 1.13.175.31:1904
Accept: application/json
Authorization: Bearer <enterprise_access_token>
Content-Type: multipart/form-data; boundary=...
```

Multipart 表单必须且只能包含：

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `space_id` | text | 是 | 目标 Skill 空间 ID，只允许一个值 |
| `version` | text | 是 | 版本号，最长 64 个字符 |
| `changelog` | text | 否 | 更新说明，最多 2000 字 |
| `package` | file | 是 | 单个 Skill ZIP 包 |

账户必须同时具有目标空间的 `read` 和 `write`。ZIP 可以直接包含 `SKILL.md`，也可以将全部内容放在单一顶层目录中；原始 ZIP 最大 50 MiB，企业服务还会校验 ZIP 路径、条目数、解压后大小和 `SKILL.md` 元数据。

成功响应：`201 Created`

```json
{
  "data": {
    "skill": {
      "skill_id": "skill_123",
      "space_id": "skillspace_123",
      "space_name": "研发技能",
      "name": "code-review",
      "current_version_id": "skillver_789"
    },
    "version": {
      "version_id": "skillver_789",
      "skill_id": "skill_123",
      "version": "1.3.0",
      "changelog": "补充安全检查",
      "package_sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "uploaded_by_user_id": "usr_123",
      "uploaded_by_agent_id": "clawee_550e8400-e29b-41d4-a716-446655440000"
    }
  }
}
```

上传成功后该版本立即成为当前发布版本。Skill 名称当前全局唯一；如果其他空间已存在同名 Skill，企业服务返回 `409 conflict`，不会覆盖或移动原 Skill。请求结果未知时不得自动重复上传，应先刷新目标空间和 Skill 列表确认结果。

常见失败：

| HTTP | `error.code` | 场景 | Clawee 行为 |
| --- | --- | --- | --- |
| `400` | `invalid_request` | Multipart 字段、版本号或字段数量不合法 | 终止上传，修正请求 |
| `400` | `package_invalid` | ZIP 结构或 `SKILL.md` 不合法 | 展示校验错误，不重试 |
| `403` | `agent_forbidden` | Token 不是 Clawee Token，或绑定 Agent 不可用 | 停止业务请求并检查登录 Agent |
| `404` | `skill_space_not_found` | 空间不存在，或当前账户没有空间写权限 | 刷新 Skill 空间列表 |
| `409` | `conflict` | 同名 Skill、同版本或其他资源状态冲突 | 不自动覆盖，刷新列表确认 |
| `413` | `package_too_large` | ZIP 原始大小或规范化后大小超过限制 | 终止上传 |

## 13. 健康检查接口

### 13.1 `GET /healthz`

无需认证，仅用于判断 HTTP 服务是否可达。

成功响应：`200 OK`

```text
ok
```

健康检查成功不代表账号、会话或 Skill Hub 可用。登录状态必须通过 `/api/v1/auth/me` 判断，Skill Hub 可用性必须通过 `/api/v1/app/skills` 判断。

## 14. Skill Hub 错误处理

| HTTP | `error.code` | 场景 | Clawee 行为 |
| --- | --- | --- | --- |
| `400` | `invalid_request` | 缺少或传错参数 | 终止操作，不自动重试 |
| `400` | `package_invalid` | 上传 ZIP 结构或 `SKILL.md` 不合法 | 终止上传，展示校验错误 |
| `401` | `unauthorized` | Token 缺失、过期或被撤销 | 清除本地 Token，进入未登录状态 |
| `403` | `forbidden` | 当前账号无权访问 | 保留登录状态，提示无权访问 |
| `403` | `agent_forbidden` | 上传请求不是 Clawee Token，或绑定 Agent 不可用 | 停止业务请求并检查登录 Agent |
| `404` | `not_found` | Skill 不存在、未发布、已下架或无空间读权限 | 刷新空间和 Skill 列表，终止当前操作 |
| `404` | `skill_space_not_found` | 上传目标空间不存在或当前账户没有写权限 | 刷新 Skill 空间列表，终止上传 |
| `409` | `version_changed` | 当前发布版本已变化 | 刷新元数据，由用户重新发起安装或更新 |
| `409` | `conflict` | 同名 Skill、同版本或资源状态冲突 | 刷新列表，不自动覆盖或重复上传 |
| `413` | `package_too_large` | 包超过服务端限制 | 终止操作，不重试 |
| `429` | `rate_limited` | 请求过于频繁 | 遵循 `Retry-After`，只重试读取请求 |
| `500` | `internal_error` | 企业服务内部错误 | 保留登录和本地状态，允许手动重试 |
| `502/503` | 网关或服务不可用 | 企业服务暂不可用 | 保留 Token，展示离线状态 |

自动重试限制：

1. 登录和注销请求不得自动重试。
2. Skill 上传、安装和更新不得在未知结果后自动重新执行写入。
3. 列表和详情的网络错误最多进行有限次数退避重试。
4. `401`、`403`、`404`、`409` 和所有 `4xx` 参数错误不得按普通网络错误循环重试。

## 15. Clawee 登录状态设计建议

Daemon 对 Web/Desktop 暴露的状态至少应区分：

```text
signed_out
checking
signed_in
service_unavailable
```

建议的本地会话对象：

```ts
type EnterpriseSession = {
  status: "signed_out" | "checking" | "signed_in" | "service_unavailable";
  agentId: string;
  account?: {
    userId: string;
    email: string;
    name: string;
  };
  expiresAt?: string;
};
```

该对象不得包含或序列化 `accessToken`。`agentId` 来自 Clawee 本地普通配置，并且必须与最近一次成功登录或 `/api/v1/auth/me` 返回的 `agent.agent_id` 一致。

企业 Token 的持久化应使用操作系统安全凭据存储。不得存入浏览器 `localStorage`、IndexedDB、普通 JSON 设置、SQLite 明文字段或诊断导出。

`agent_id` 不是认证秘密，可以保存在 Daemon 普通配置中，但 Web/Desktop 渲染进程只能通过本地 Runtime API 读取必要的当前 Agent 信息，不能直接修改该字段。注销、Token 过期和普通网络错误不得删除或重新生成 `agent_id`。

当前接入不使用 Refresh Token。Token 到期或服务端返回 `401` 后，Clawee 进入未登录状态并要求用户重新登录。

## 16. 企业 Skill 与现有公共市场共存

企业 Skill Hub 和 Clawee 现有公共 Skill Market 是两个独立来源：

1. 公共市场继续使用 Clawee 内置审核目录和固定 GitHub 来源。
2. 企业 Skill 使用企业服务动态返回的目录和 ZIP 包。
3. 企业 Skill 不强制映射为公共市场的分类、封面、GitHub、作者和风险模型。
4. 企业 Skill 的基础展示字段使用 `space_name`、`name`、`description`、`version` 和 `changelog`。
5. 公共市场和企业 Skill 出现同名 Skill 时，本地 Codex Skills 目录仍只能存在一份同名 Skill。
6. 安装前必须根据现有 Skill 来源和安装记录明确展示“安装”“更新”或“名称冲突”，不得静默覆盖未知来源 Skill。

建议为安装记录增加来源标识，避免使用 GitHub 字段表达企业 Skill：

```ts
type EnterpriseSkillInstallRecord = {
  source: "enterprise-skill-hub";
  spaceId: string;
  skillId: string;
  name: string;
  versionId: string;
  version: string;
  packageSha256: string;
  installedAt: string;
  updatedAt: string;
};
```

## 17. Skill 状态计算

Clawee 应同时读取：

1. 企业 Skill 列表。
2. 本机 Codex Skill 扫描结果。
3. 企业 Skill 安装记录。

建议按以下顺序计算状态：

1. 本地不存在同名 Skill：`not_installed`。
2. 本地存在但 Skill 无效：`invalid`。
3. 本地存在且没有任何 Clawee 安装记录：`installed_unknown_source`。
4. 本地存在但安装记录来源不是企业 Skill Hub：`name_conflict`。
5. 企业安装记录的 `package_sha256` 等于远端：`installed`。
6. 企业安装记录的 `package_sha256` 不等于远端：`update_available`。
7. 远端 Skill 已从当前授权列表消失但本地仍存在：保留本地 Skill，标记为 `unavailable`，不得自动删除；客户端不能区分 Skill 已下架、已删除或空间 `read` 权限已撤销。

`version_id` 用于关联企业服务版本，`package_sha256` 是判断安装内容是否变化的最终依据。

## 18. 安装与更新流程

### 18.1 安装

```text
用户点击安装
  -> Daemon 获取 Skill 详情
  -> 记录 space_id、skill_id、version_id、package_sha256
  -> 按 skill_id + version_id 下载 ZIP
  -> 对原始 ZIP 字节计算 SHA-256
  -> 安全解压到 Daemon 临时目录
  -> 校验解压后的 Skill 结构和 name
  -> 复用现有 Skill 安装事务写入 Codex Skills 目录
  -> 安装成功后写入企业 Skill 安装记录
  -> 刷新本地 Skill 扫描结果
```

### 18.2 更新

更新必须复用现有覆盖和回滚能力：

1. 重新获取远端详情，不使用页面打开时的旧快照。
2. 下载并校验新的当前发布版本。
3. 进入本地 Skill 写锁和安装事务。
4. 备份旧 Skill 后覆盖。
5. 覆盖或安装记录写入失败时恢复旧 Skill。
6. 全部成功后更新企业 Skill 安装记录。

### 18.3 解压安全

即使企业服务已经校验上传包，Clawee 仍必须在本地防御：

1. 绝对路径和 Windows 盘符路径。
2. `..` 路径越界。
3. 反斜杠和规范化后重复路径。
4. 符号链接及其他非普通文件类型。
5. 超量文件条目和解压膨胀。
6. 缺失、重复或无效的 `SKILL.md`。
7. ZIP 包声明名称与远端 `name` 不一致。

安装成功或失败后都必须清理下载文件和临时解压目录。

## 19. 超时和资源限制建议

建议初始值：

| 操作 | 超时 |
| --- | --- |
| 健康检查 | 5 秒 |
| 注册、登录、当前账号、注销 | 15 秒 |
| Skill 空间、列表和详情 | 15 秒 |
| Skill ZIP 下载 | 120 秒 |
| Skill ZIP 上传 | 5 分钟 |
| 知识库和文档列表 | 15 秒 |
| 文档上传 | 5 分钟 |

下载必须采用流式写入和增量 SHA-256，不应把完整 ZIP 同时保存在多个内存副本中。客户端应限制响应大小，并与企业服务当前 50 MiB 原始 ZIP 上限保持一致。

## 20. 日志与诊断要求

允许记录：

1. 企业服务 Origin。
2. HTTP 方法、路径模板和状态码。
3. 请求 ID。
4. `space_id`、`skill_id`、`version_id`、`name` 和 `package_sha256`。
5. Skill ZIP 上传或下载字节数、耗时和失败阶段。
6. `knowledge_base_id`、`document_id`、文件名、文件大小和上传失败阶段。

禁止记录：

1. 账号密码。
2. Bearer Token 或完整 Authorization Header。
3. Skill ZIP 内容和 `SKILL.md` 全文。
4. 带有敏感 Query 参数的原始 URL。
5. 操作系统安全凭据存储内容。
6. 知识库文档内容和 Multipart 原始请求体。
7. Collector 注册码、带注册码的安装 URL 和一键安装命令。

诊断导出前必须再次执行敏感字段脱敏。

## 21. 验收清单

### 21.1 注册与登录

1. Web 与 Desktop 使用同一 Daemon 注册、登录接口和状态模型。
2. 首次注册或登录前，Daemon 已生成并原子持久化稳定的 `agent_id`。
3. Clawee 注册请求固定提交 `client_id=clawee-agent` 和本地 `agent_id`；缺少任一字段时服务端不会创建账号或 Agent。
4. 注册成功后自动调用登录接口，登录请求提交相同的 `client_id` 和 `agent_id`。
5. 登录时缺少 `agent_id` 不会触发服务端兜底生成或默认选择；客户端明确传入的有效 ID 不存在时，服务端按该 ID 原子创建并绑定 Agent。
6. 登录响应和 `/api/v1/auth/me` 返回的 `agent.agent_id` 与本地配置不一致时不会进入已登录状态。
7. Web `/app` 继续使用账户级登录态和显式 Agent 切换，不受 Clawee 的 `agent_id` 必填规则影响。
8. 企业 JWT 不出现在渲染进程、浏览器存储和日志中。
9. 应用重启后可以通过 `/api/v1/auth/me` 恢复或拒绝会话。
10. `401` 会清除本地 Token 但保留 `agent_id`，网络错误不会误清除 Token。
11. 注销成功后原 Token 无法继续访问 Skill 接口，后续登录继续使用原 `agent_id`。
12. Clawee 首次调用 `/api/v1/auth/me` 时，没有有效 Collector 注册码的账户会隐式生成一个注册码并返回双平台安装命令。
13. 重复及并发调用 `/api/v1/auth/me` 返回同一有效注册码，不会隐式轮换。
14. Daemon 按操作系统执行服务端返回的安装命令，并且不会记录注册码或完整命令。

### 21.2 Skill Hub

1. 只调用 `/api/v1/app/skill-spaces` 和 `/api/v1/app/skills*` 目标接口，不调用 Skill 空间管理后台接口。
2. Skill 空间列表只展示企业服务返回的当前账户可读空间，并直接使用 `actions` 控制上传入口。
3. Skill 列表只展示企业服务返回的当前账户可读空间内已发布 Skill，并保留 `space_id` 和 `space_name`。
4. 下载请求同时携带 `skill_id` 和 `version_id`。
5. 下载后按 `package_sha256` 校验原始 ZIP。
6. `409 version_changed` 会刷新元数据，不安装旧版本。
7. 上传只允许选择同时具有 `read` 和 `write` 的空间，并且 Multipart 中只提交一个 `space_id`、`version`、可选 `changelog` 和一个 `package`。
8. 上传结果未知时不会自动重复上传；`404 skill_space_not_found` 会刷新空间权限。
9. ZIP 校验、解压、安装或记录写入失败时不会留下半安装状态。
10. 更新失败时可以恢复原 Skill。
11. 企业 Skill 与公共市场同名时不会静默覆盖未知来源 Skill。
12. Web 与 Desktop 在相同数据下显示相同状态并调用相同 Runtime API。

### 21.3 知识库

1. Web 与 Desktop 通过同一 Daemon API 获取知识库和文档，不直接请求企业服务。
2. 知识库列表只展示企业服务返回的当前账户授权项，并使用响应中的 `permissions` 控制上传入口。
3. 读取未授权知识库时，将 `404 knowledge_base_not_found` 作为不可访问处理，不探测资源是否真实存在。
4. 只有 `permissions.read=true` 且 `permissions.upload=true` 时允许发起上传。
5. 上传只包含一个 `knowledge_base_id` 和一个 `file`，文件不经过 React 渲染进程持久化。
6. 上传结果未知时不自动重试，避免产生重复文档。
7. Web 与 Desktop 在相同账户授权下展示相同列表、权限状态和上传结果。

### 21.4 MCP 接入

1. Clawee Daemon 使用应用端 Bearer JWT 调用 `/api/v1/app/agents/token/reveal`，请求无需传递 `agent_id`。
2. Token 响应只包含 Agent Token 明文和基础信息，不包含 `mcp_config`、Authorization Header 或重复兼容字段。
3. Agent MCP Token 只写入系统安全凭据存储，不进入 React、普通配置、SQLite、日志和诊断包。
4. MCP 能力目录返回全部未删除 upstream 及其 `/mcp/servers/{upstream_id}` 受治理 endpoint，禁用 upstream 仍返回并明确标记状态。
5. 每个 upstream 返回其全部 Tool，`authorized` 仅在 upstream、Tool 和有效 Grant 同时可用时为 `true`。
6. 目录不返回企业内部 upstream 原始 URL、upstream Token、凭据引用或授权数据范围。
7. 企业 Grant、Codex 原生安装和 Codex 原生开启是三类独立状态；安装或开启不会创建、修改或撤销企业 Grant。
8. Clawee 不根据 Catalog 的 `authorized` 字段生成 `enabled_tools`，也不以该字段作为本地安全边界。
9. Gateway 的 `tools/list` 只返回当前 Agent 可用的 Tool，`tools/call` 每次重新校验 Token、Grant、upstream 和 Tool 状态。
10. 所有安装来源共用当前 `CODEX_HOME/config.toml`；企业目录安装最终调用 Codex 原生 MCP 管理能力，安装后默认保持关闭。
11. 用户关闭或卸载 upstream 后不撤销企业 Grant，也不删除共享的 Agent MCP Token。
12. Codex MCP 原生配置和企业 Token 指纹变化后，空闲的持久 App Server 立即关闭；忙碌进程完成当前 turn 后关闭，下一次运行使用新快照。
13. Clawee 不通过 `-c mcp_servers.*` 创建企业 MCP，不维护第二套 MCP Runtime 定义；Codex 从当前 `CODEX_HOME` 原生加载开启的 MCP。
14. Clawee 仅在 Runtime 环境中注入 `CLAWEE_ENTERPRISE_MCP_TOKEN`，配置文件只保存 `bearer_token_env_var` 名称，不保存 Token 明文。
15. Web 与 Desktop 通过同一 Daemon API 读取和修改 Codex 原生 MCP 配置，渲染相同页面并产生相同 Runtime 行为。
16. `clawee_schedule` 是 Clawee 内部动态工具例外，由 Daemon 按运行上下文注入，不属于“系统连接”中的用户 MCP。

## 22. 接口契约摘要

Clawee 正式依赖以下稳定契约：

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/me
POST /api/v1/auth/logout

POST /api/v1/app/agents/token/reveal
GET  /api/v1/app/agents/mcp-catalog

GET  /api/v1/app/skill-spaces
GET  /api/v1/app/skills
GET  /api/v1/app/skills/detail?skill_id=<skill_id>
GET  /api/v1/app/skills/package?skill_id=<skill_id>&version_id=<version_id>
POST /api/v1/app/skills/versions

GET  /api/v1/app/knowledge-bases
GET  /api/v1/app/knowledge-bases/documents?knowledge_base_id=<knowledge_base_id>
POST /api/v1/app/knowledge-bases/documents

GET  /api/v1/app/shared-spaces
GET  /api/v1/app/shared-files
GET  /api/v1/app/shared-files/detail?file_id=<file_id>
GET  /api/v1/app/shared-files/content?file_id=<file_id>
POST /api/v1/app/shared-files/content?space_id=<space_id>&logical_path=<logical_path>
```

Clawee Daemon 在首次注册或登录前生成并持久化稳定的 `agent_id`。账号通过 `/api/v1/auth/register` 自助注册时固定提交 `client_id=clawee-agent` 和该 `agent_id`；注册成功后通过登录接口提交相同字段，签发绑定该 Agent 的 `claw-frontend` Bearer JWT。缺少 `agent_id` 时注册和登录都必须失败，企业服务不得兜底生成或选择 Agent。`/api/v1/auth/me` 为 Clawee 查询或隐式创建账户级 Collector 注册码并返回双平台安装命令，Daemon 按系统执行命令完成 Collector 安装或更新。Daemon 使用应用端 Bearer JWT 调用 `/api/v1/app/agents/token/reveal` 获取绑定 Agent 的 MCP Token，再通过 MCP 能力目录获取全部 upstream 的受治理 endpoint 和 Tool 授权状态；这两个接口都优先使用认证会话绑定的 Agent，无需重复传递 `agent_id`。Skill Hub 使用账户级 Skill 空间授权：`read` 控制空间、列表、详情和下载，上传必须同时具有 `read` 和 `write`，未授权资源统一按接口约定隐藏。知识库 HTTP 接口使用 JWT 当前账户的数据授权，Agent 绑定只作为 Clawee 会话有效性校验。Web `/app` 通过 `client_id=web` 或省略 `client_id` 进入原有账户级认证分支，继续显式切换 Agent。Clawee Daemon 是企业服务唯一调用方，Web/Desktop 不直接持有企业 Token 或 Agent MCP Token；企业服务负责身份、Collector 接入信息、MCP Token、MCP 能力目录、Skill 空间授权、Skill 分发与上传校验和知识库授权代理。Codex 原生配置负责全部用户 MCP 的安装和开启状态，Codex Runtime 负责工具发现与调用；Clawee 负责本地安全存储、统一页面、原生配置操作、企业 Token 安全注入、Skill 上传代理、安装完整性、回滚以及知识库交互。

## 23. MCP Token 与能力目录接口

### 23.1 `POST /api/v1/app/agents/token/reveal`

返回 Clawee 当前登录会话所绑定 Agent 的现有 active MCP Token 及基础信息。该接口只读取 Token，不创建、不轮换、不吊销 Token，也不返回 MCP 配置或 Tool 授权目录。

请求：

```http
POST /api/v1/app/agents/token/reveal HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/json
```

Clawee 请求不需要请求体，也不需要传递 `agent_id`。服务端从已认证的 `clawee-agent` Principal 和 Session 中读取绑定的 Agent ID。若客户端显式传入 `agent_id`，该值只用于一致性校验，不能用于切换 Agent：

```json
{}
```

成功响应：

```json
{
  "data": {
    "token_id": "token_clawee_123",
    "agent_id": "clawee_550e8400-e29b-41d4-a716-446655440000",
    "token": "agt_xxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "token_type": "Bearer",
    "fingerprint": "a1b2c3d4e5f6",
    "status": "active",
    "expires_at": null,
    "scopes": [
      "mcp:call"
    ],
    "created_at": "2026-08-06T10:00:00Z"
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `token_id` | string | Agent MCP Token 的不透明记录 ID |
| `agent_id` | string | Token 所属 Agent；Clawee 必须校验其与本地 `agent_id` 一致 |
| `token` | string | 调用企业 MCP endpoint 时使用的 Bearer Token 明文 |
| `token_type` | string | 固定为 `Bearer` |
| `fingerprint` | string | Token 指纹，用于诊断和识别，不可代替 Token 调用 MCP |
| `status` | string | 当前返回值固定为 `active` |
| `expires_at` | string \| null | Token 到期时间；无到期时间时为 `null` |
| `scopes` | string[] | Token Scope；当前必须包含 `mcp:call` |
| `created_at` | string | Token 创建时间 |

Clawee 处理要求：

1. 仅 Daemon 可以调用并读取该响应；React 渲染进程不得读取 `token`。
2. Daemon 必须把 `token` 写入系统安全凭据存储，不得写入普通配置、SQLite、日志或诊断包。
3. MCP 配置中不得持久化 Token 明文；应只保存 endpoint 和环境变量名，由 Daemon 启动 Agent Runtime 时注入 Token。
4. 重复调用 `reveal` 返回当前 active Token，不会隐式轮换。
5. 返回 `404 not_found` 表示当前 Agent 没有可读取的 active Token、Token 已过期或历史 Token 不可恢复；不得把应用端 Bearer JWT 当作 MCP Token 使用。

错误处理：

| HTTP 状态 | `error.code` | Clawee 处理 |
| --- | --- | --- |
| `400` | `invalid_request` | 请求 JSON 无效；不重试、不更换 `agent_id` |
| `401` | `unauthorized` | 应用 Token 缺失、过期或会话失效；清除本地应用 Token 并进入未登录状态 |
| `403` | `agent_context_mismatch` | 请求中的 `agent_id` 与会话不一致；按客户端状态错误处理 |
| `403` | `agent_forbidden` | 会话绑定 Agent 已停用；不得继续安装或启动企业 MCP |
| `404` | `not_found` | 当前 Agent 没有可读取的 active MCP Token；允许保留 Codex 原生安装和开启状态，但阻止企业 MCP 认证并提示重新签发 Token |
| `500/503` | `internal_error` | 保留登录状态，不覆盖本地已有 MCP Token，允许用户手动重试 |

### 23.2 `GET /api/v1/app/agents/mcp-catalog`

返回企业服务中全部未删除 upstream MCP、每个 upstream 对应的 Gateway MCP endpoint、其 Tool 列表，以及 Clawee 当前登录会话所绑定 Agent 的有效授权状态。该接口为只读目录，不提供授权申请或修改能力。

请求：

```http
GET /api/v1/app/agents/mcp-catalog HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/json
```

Clawee 请求不需要传递 `agent_id`。服务端优先从已认证的 `clawee-agent` Principal 和 Session 中读取绑定的 Agent ID：

1. 未传 `agent_id` 时，查询当前会话绑定 Agent 的授权状态，不回退到账号主 Agent。
2. 显式传入 `agent_id` 时，只用于一致性校验；值必须与会话绑定 Agent 完全一致。
3. 显式值与会话不一致时返回 `403 agent_context_mismatch`，不得切换到其他 Agent。

成功响应：

```json
{
  "data": {
    "agent_id": "clawee_550e8400-e29b-41d4-a716-446655440000",
    "upstreams": [
      {
        "id": "crm-main",
        "name": "CRM",
        "domain": "sales",
        "mcp_endpoint": "http://1.13.175.31:1904/mcp/servers/crm-main",
        "upstream_transport": "streamable_http",
        "namespace": "crm",
        "status": "active",
        "tools": [
          {
            "id": "cap_customer_search",
            "upstream_name": "customer.search",
            "name": "customer.search",
            "exposed_name": "crm.customer.search",
            "title": "查询客户",
            "description": "按条件查询客户资料",
            "risk_level": "low",
            "confirm_required": false,
            "status": "active",
            "authorized": true,
            "authorization_expires_at": "2026-08-31T16:00:00Z"
          },
          {
            "id": "cap_customer_delete",
            "upstream_name": "customer.delete",
            "name": "customer.delete",
            "exposed_name": "crm.customer.delete",
            "title": "删除客户",
            "description": "删除指定客户记录",
            "risk_level": "high",
            "confirm_required": true,
            "status": "active",
            "authorized": false,
            "authorization_expires_at": null
          }
        ]
      }
    ]
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `agent_id` | string | 本次授权判断实际使用的会话 Agent ID；Clawee 必须校验其与本地 `agent_id` 一致 |
| `upstreams` | array | 当前全部未删除 upstream MCP；没有 upstream 时为空数组 |
| `upstreams[].id` | string | upstream 的不透明标识 |
| `upstreams[].name` | string | upstream 展示名称 |
| `upstreams[].domain` | string | upstream 所属业务域 |
| `upstreams[].mcp_endpoint` | string | 由本项目 Gateway 暴露的受治理 MCP endpoint；Clawee 安装 MCP 时使用该地址 |
| `upstreams[].upstream_transport` | string | Gateway 连接企业内部 upstream 时使用的 transport |
| `upstreams[].namespace` | string | upstream 在聚合 Gateway 中使用的 Tool 命名空间 |
| `upstreams[].status` | string | upstream 当前状态；非 `active` endpoint 不可调用 |
| `upstreams[].tools` | array | 该 upstream 下的全部 Tool；没有 Tool 时为空数组 |
| `tools[].id` | string | Tool 能力的不透明标识 |
| `tools[].upstream_name` | string | 企业内部 upstream 原始 Tool 名称 |
| `tools[].name` | string | 通过当前 `mcp_endpoint` 调用时使用的 endpoint 本地 Tool 名称 |
| `tools[].exposed_name` | string | 通过聚合 `/mcp` endpoint 调用时使用的带 namespace Tool 名称 |
| `tools[].title` | string | Tool 展示名称 |
| `tools[].description` | string | Tool 功能说明 |
| `tools[].risk_level` | string | 风险等级 |
| `tools[].confirm_required` | boolean | 调用时是否需要用户确认 |
| `tools[].status` | string | Tool 当前状态；非 `active` Tool 不可调用 |
| `tools[].authorized` | boolean | 当前会话 Agent 是否可以通过该 endpoint 调用此 Tool；只有 upstream 和 Tool 均为 `active` 且存在有效 Grant 时才为 `true` |
| `tools[].authorization_expires_at` | string \| null | 当前有效授权的到期时间；永久授权、无授权或授权已失效时为 `null` |

接口会返回全部未删除 upstream，以及每个 upstream 下已授权、未授权、启用和停用的 Tool。`mcp_endpoint` 始终指向本项目 Gateway 的 `/mcp/servers/{upstream_id}` 受治理入口，不返回企业内部 upstream 原始 URL、upstream Token、凭据引用或授权数据范围。软删除 upstream 不返回。当前目录不分页，客户端必须忽略未来新增字段。

`authorized` 是目录展示字段，不是 Clawee 的本地授权凭证。Clawee 可以展示“企业授权 Tool 数量”，但不得根据该字段决定是否安装 upstream、是否允许用户切换开启状态，也不得把当前 `authorized=true` 的 Tool 固化为 Codex `enabled_tools`。Grant 可能在目录刷新后发生变化，本地缓存无法替代 Gateway 的实时裁决。

错误处理：

| HTTP 状态 | `error.code` | Clawee 处理 |
| --- | --- | --- |
| `401` | `unauthorized` | Token 缺失、过期或会话失效；清除本地 Token 并进入未登录状态 |
| `403` | `agent_context_mismatch` | 请求中的 `agent_id` 与会话不一致；按客户端状态错误处理，不得尝试切换 Agent |
| `403` | `agent_forbidden` | 会话绑定 Agent 已停用或不可用；保留本地 `agent_id`，提示重新登录或联系管理员 |
| `500` | `internal_error` | 保留登录状态，允许用户手动重试 |

### 23.3 Clawee 三类状态与正确接入流程

Clawee 必须明确区分以下三类状态：

| 状态 | 所有者 | 持久化位置 | 作用 |
| --- | --- | --- | --- |
| 企业授权状态 | 企业管理员和 Gateway | 企业服务 Grant 数据 | 决定 Agent 实际能看到和调用哪些 Tool |
| 用户安装状态 | 当前 Clawee 用户 | 当前 `CODEX_HOME/config.toml` 的 `mcp_servers` 节点 | 决定 MCP 是否属于当前 Codex 原生连接集合 |
| 用户开启状态 | 当前 Clawee 用户 | 对应 `mcp_servers.<name>.enabled` | 决定 Codex Runtime 是否原生加载该 MCP |

三类状态之间不做隐式同步：

1. 企业管理员授权 Tool，不会自动替用户安装或开启 upstream。
2. 用户安装或开启 upstream，不会向企业服务申请 Grant。
3. 用户关闭或卸载 upstream，不会撤销企业 Grant。
4. 用户开启 upstream 后能否实际使用 Tool，由 Gateway 在 MCP 请求时决定。
5. Catalog 中的 `authorized` 和授权数量只用于解释当前企业状态，不作为 Clawee 的调用前置判断或安全边界。
6. MCP 无论通过 Clawee、`codex mcp add` 或其他写入当前 `CODEX_HOME` 的方式安装，都由同一原生列表展示和管理。

Clawee 的正确接入流程：

```text
Clawee 启动或刷新“系统连接”
  -> Daemon 对当前 CODEX_HOME 执行 codex mcp list --json
  -> 页面展示全部 Codex 原生 MCP，不区分安装来源
  -> 企业已登录时，Daemon 使用应用 JWT 获取 MCP Catalog
  -> Daemon reveal 当前 Agent 的 MCP Token
  -> MCP Token 写入独立系统安全凭据
  -> 页面按 endpoint 或稳定名称合并原生列表与企业目录
  -> 企业目录中未安装项只作为可安装来源展示

用户安装企业 MCP
  -> Daemon 调用 Codex 原生 MCP add
  -> config.toml 写入 Gateway endpoint 和 bearer_token_env_var 名称
  -> 安装完成后写 enabled=false，不自动开启

用户开启或关闭 MCP
  -> Daemon 修改当前 CODEX_HOME 中对应 MCP 的 enabled
  -> 不读取或修改企业 Grant
  -> 原生配置指纹变化使旧持久 Codex Runtime 失效

下一次 Codex Runtime 启动
  -> Codex 从当前 CODEX_HOME 原生加载 enabled=true 的 MCP
  -> Clawee 只通过环境变量注入 Agent MCP Token
  -> Clawee 不通过 -c mcp_servers.* 注入企业 MCP 定义
  -> Codex 原生执行 tools/list
  -> Gateway 只返回当前 Agent 已授权且 active 的 Tool
  -> Codex 原生执行 tools/call
  -> Gateway 再次校验 Token、Grant、upstream 和 Tool 状态
  -> Gateway 返回结果或标准 401/403/Tool 不可用错误
```

本地 Daemon API 分为两组：

```text
# Codex 原生 MCP 状态和操作
GET    /codex/mcp
POST   /codex/mcp/add
GET    /codex/mcp/:name
PATCH  /codex/mcp/:name
DELETE /codex/mcp/:name
POST   /codex/mcp/:name/login
POST   /codex/mcp/:name/logout

# 企业目录发现和安装适配
GET   /enterprise/mcp
POST  /enterprise/mcp/refresh
PATCH /enterprise/mcp/upstreams/:upstreamId/preference
```

原生状态更新规则：

1. `installed` 由当前 Codex 原生列表中是否存在该 MCP 计算，不单独持久化布尔值。
2. `enabled` 由 Codex 原生配置返回，不单独持久化用户偏好。
3. 企业目录安装最终调用和普通 MCP 相同的 Codex 原生 Manager，并默认设置为关闭。
4. 开启、关闭、登录、退出和删除都作用于实际安装的原生 MCP 名称。
5. endpoint 相同或稳定企业名称相同的目录项与原生 MCP 合并，不重复展示。
6. 历史 `enterprise_mcp_preferences` 仅作为一次性升级输入；迁移成功后删除旧记录，运行时不得再把 SQLite 作为状态源。
7. 原生列表读取失败时不得把 MCP 误判为未安装，不得执行迁移或重复安装，应返回 `ENTERPRISE_MCP_RUNTIME_UNAVAILABLE`。

Runtime 注入规则：

1. Codex 根据当前 `CODEX_HOME/config.toml` 原生加载 MCP；Clawee 不再创建第二套 MCP 定义。
2. Clawee 不根据 Catalog 的 `authorized` Tool 数量过滤、禁用或重写 Codex MCP 配置。
3. 企业 MCP 配置只保存 Gateway endpoint 和 `bearer_token_env_var=CLAWEE_ENTERPRISE_MCP_TOKEN`，不得保存 Token 明文。
4. Agent MCP Token 只存在于 Daemon 内存、系统安全凭据和 Codex 子进程环境中。
5. Token 明文不得进入命令行、React、普通配置、SQLite、日志、运行元数据或诊断包。
6. 当前 turn 使用启动时配置快照；用户或外部 CLI 修改配置后从下一次运行生效。
7. Codex MCP 配置指纹只摘要 `mcp_servers` 节点，必须覆盖 headers、env、enabled、endpoint 和其他原生字段，但不得记录或返回原值。
8. 企业 Runtime 指纹同时覆盖 Agent ID 和 Token 指纹；原生配置或企业 Token 变化必须使旧持久进程失效。
9. `confirm_required=true` 的 Tool 应由 Gateway 通过标准 MCP elicitation 发起确认；Gateway 未实现 elicitation 前，不得把 Catalog 字段本身视为已完成确认。
10. `clawee_schedule` 继续作为内部动态 MCP 注入，它不写入用户 MCP 列表，也不改变上述原生状态源。

Gateway 必须满足以下安全契约：

1. `tools/list` 只返回当前 Agent 具有有效 Grant 且 upstream、Tool 均为 active 的 Tool。
2. `tools/call` 不信任先前 `tools/list` 结果，每次重新校验 Token、Grant、授权到期时间、upstream 和 Tool 状态。
3. 未授权调用返回标准 MCP 错误，并映射明确的 `401/403` 语义。
4. Clawee 可以在收到权限错误后刷新 Catalog 和页面状态，但不得在客户端复制 Grant 判断逻辑。

## 24. 知识库接口

知识库 HTTP 接口按 JWT 当前账户授权，不按 Clawee 当前 Agent 的 MCP Grant 授权。服务端仍会在请求进入 `/api/v1/app/*` 时校验 JWT 绑定的 Agent 属于当前账户且状态为 `active`。

服务端知识库动作固定为：

| 动作 | 当前语义 |
| --- | --- |
| `read` | 知识库在列表中可见，并允许读取其文档列表 |
| `upload` | 允许上传文档，同时必须具有 `read` |
| `search` | 为下一阶段账户级 Agent 检索授权预留 |

本阶段 `search` 只存储在账户数据授权中，不参与现有 MCP `knowledge.search` 判定。Clawee 不得因为 `permissions.search=true` 绕过 MCP 能力目录或 Agent Grant 调用检索 Tool。

### 24.1 `GET /api/v1/app/knowledge-bases`

返回当前账户具有 `read` 权限的知识库。

请求：

```http
GET /api/v1/app/knowledge-bases HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/json
```

成功响应：`200 OK`

```json
{
  "data": [
    {
      "knowledge_base_id": "kb_123",
      "name": "公司制度",
      "description": "公司制度和员工手册",
      "status": "active",
      "document_count": 12,
      "permissions": {
        "read": true,
        "upload": true,
        "search": false
      }
    }
  ],
  "meta": {
    "next_cursor": "",
    "has_next": false
  }
}
```

字段说明：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `knowledge_base_id` | string | 企业服务内部的不透明知识库标识 |
| `name` | string | 展示名称 |
| `description` | string | 知识库说明 |
| `status` | string | 当前状态；客户端必须保留未知状态兼容能力 |
| `document_count` | number | 当前文档数量 |
| `permissions.read` | boolean | 是否允许读取；当前列表返回项固定为 `true` |
| `permissions.upload` | boolean | 是否允许上传文档 |
| `permissions.search` | boolean | 是否存在预留的账户检索授权，不代表 MCP Tool 已授权 |

Clawee 必须以列表和 `permissions` 为准，不缓存推导出的扩大权限。重新登录、用户刷新或收到权限相关错误后应重新拉取列表。

### 24.2 `GET /api/v1/app/knowledge-bases/documents`

请求 Query：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `knowledge_base_id` | 是 | 知识库列表返回的不透明 ID |

请求示例：

```http
GET /api/v1/app/knowledge-bases/documents?knowledge_base_id=kb_123 HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/json
```

成功响应：`200 OK`

```json
{
  "data": [
    {
      "document_id": "doc_123",
      "knowledge_base_id": "kb_123",
      "name": "员工手册.pdf",
      "size_bytes": 102400,
      "mime_type": "application/pdf",
      "status": "ready",
      "error_message": "",
      "uploaded_by": "usr_123",
      "created_at": "2026-08-04T08:00:00Z",
      "updated_at": "2026-08-04T08:01:00Z"
    }
  ],
  "meta": {
    "next_cursor": "",
    "has_next": false
  }
}
```

当前账户没有该知识库的 `read` 权限时返回 `404 knowledge_base_not_found`。该状态同时隐藏未授权资源是否存在，Clawee 不得用其他 ID 重试探测。

### 24.3 `POST /api/v1/app/knowledge-bases/documents`

上传单个知识库文档。当前账户必须同时具有目标知识库的 `read` 和 `upload` 权限。

请求：

```http
POST /api/v1/app/knowledge-bases/documents HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/json
Content-Type: multipart/form-data; boundary=...
```

Multipart 表单：

| 字段 | 数量 | 说明 |
| --- | --- | --- |
| `knowledge_base_id` | 1 | 目标知识库 ID |
| `file` | 1 | 待上传文档 |

Daemon 构造 Multipart 时必须先写入 `knowledge_base_id` part，再写入 `file` part，使企业服务可以在接收文件内容前完成账户授权。

允许的文件扩展名为 `.pdf`、`.docx`、`.md`、`.txt`、`.xlsx`、`.csv`，单文件最大 50 MiB。企业服务同时校验扩展名、文件内容和实际大小，Clawee 侧的文件选择限制不能替代服务端校验。

成功响应：`201 Created`

```json
{
  "data": {
    "document_id": "doc_456",
    "knowledge_base_id": "kb_123",
    "name": "员工手册.pdf",
    "size_bytes": 102400,
    "mime_type": "application/pdf",
    "status": "processing",
    "error_message": "",
    "uploaded_by": "usr_123",
    "created_at": "2026-08-04T08:00:00Z",
    "updated_at": "2026-08-04T08:00:00Z"
  }
}
```

Daemon 上传约束：

1. 文件选择和上传使用 Web/Desktop 共用的 Runtime API；Desktop Bridge 只可负责系统文件选择能力。
2. Daemon 从受控本地路径流式构造 Multipart，请求体不得经过 React 状态、浏览器存储或诊断导出。
3. 缺少 `read` 时服务端返回 `404 knowledge_base_not_found`；具有 `read` 但缺少 `upload` 时返回 `403 document_upload_forbidden`。
4. 返回 `201` 后刷新文档列表，按服务端 `status` 展示处理状态。
5. 网络断开或结果未知时不得自动重复上传。用户再次发起前应刷新文档列表。

### 24.4 错误处理

| HTTP | `error.code` | Clawee 行为 |
| --- | --- | --- |
| `400` | `invalid_request` | 文件、表单或知识库 ID 不合法；终止操作，不自动重试 |
| `401` | `unauthorized` | 清除本地 Token，进入未登录状态 |
| `403` | `agent_forbidden` | 当前绑定 Agent 不可用；停止应用接口请求 |
| `403` | `document_upload_forbidden` | 保留登录状态，刷新知识库列表并禁用上传入口 |
| `404` | `knowledge_base_not_found` | 刷新知识库列表，不区分未授权与资源不存在 |
| `404` | `not_found` | 已授权资源或文档已不存在；刷新列表 |
| `409` | `conflict` | 资源状态不允许当前操作；刷新列表和状态 |
| `502` | `knowledge_provider_error` | 底层知识库暂不可用；保留登录状态，允许用户稍后重试 |
| `500` | `internal_error` | 保留登录状态，记录脱敏诊断并允许手动重试 |

## 25. 共享文件空间接口

共享文件空间是企业服务中的文件数据权限边界。Clawee 只调用 `/api/v1/app/*` 应用端接口，不调用共享空间后台管理接口。空间创建和成员授权由企业管理员完成；Clawee 使用当前登录账户和会话绑定 Agent 的 Bearer JWT 查询及读写已经授权的空间。

所有共享文件接口必须满足以下认证条件：

1. 请求携带 `Authorization: Bearer <enterprise_access_token>`。
2. Token 由 `client_id=clawee-agent` 的登录流程签发，并绑定非空 `agent_id`。
3. 账号、Session、Agent 归属和 Agent 状态均有效。
4. 读取操作要求账户具有空间 `read` 授权；新建和替换要求空间 `write` 授权。
5. 未授权空间或文件与真实不存在资源使用相同的 `404` 响应，Clawee 不得通过枚举 ID、搜索数量或错误差异探测资源。

### 25.1 `GET /api/v1/app/shared-spaces`

分页返回当前账户具有 `read` 授权的共享空间。

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `limit` | 否 | 分页大小；默认 `50`，最小 `1`，最大 `100` |
| `cursor` | 否 | 上一页返回的不透明游标；首次请求不传 |

请求示例：

```http
GET /api/v1/app/shared-spaces?limit=50 HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/json
```

成功响应：`200 OK`

```json
{
  "data": [
    {
      "space_id": "space_01JXYZ",
      "name": "季度方案",
      "description": "跨团队方案文件",
      "updated_at": "2026-08-05T08:30:00Z"
    }
  ],
  "meta": {
    "next_cursor": "",
    "has_next": false,
    "max_file_size_bytes": 1073741824
  }
}
```

空间按 `updated_at DESC, space_id ASC` 排序。`updated_at` 只表示空间名称或说明的更新时间，不随成员增删或文件上传变化。Clawee 必须读取 `max_file_size_bytes` 进行上传前校验，但不得假设该字段会替代服务端限制。

### 25.2 `GET /api/v1/app/shared-files`

分页查询当前账户可读取的共享文件。`space_id` 为空时跨当前账户的全部授权空间查询。

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `space_id` | 否 | 限定一个已授权共享空间 |
| `query` | 否 | 去除首尾空白后，同时对 `file_id` 和 `file_name` 做大小写不敏感的包含匹配；最多 200 个字符 |
| `logical_path_prefix` | 否 | 限定逻辑路径前缀，可以以 `/` 结尾 |
| `limit` | 否 | 分页大小；默认 `50`，最小 `1`，最大 `100` |
| `cursor` | 否 | 上一页返回的不透明游标；连续翻页时其他查询参数必须保持不变 |

请求示例：

```http
GET /api/v1/app/shared-files?space_id=space_01JXYZ&query=design&logical_path_prefix=docs%2F&limit=50 HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/json
```

成功响应：`200 OK`

```json
{
  "data": [
    {
      "file_id": "file_01JXYZ",
      "space_id": "space_01JXYZ",
      "space_name": "季度方案",
      "logical_path": "docs/design.md",
      "file_name": "design.md",
      "size_bytes": 12345,
      "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
      "content_type": "text/markdown",
      "revision": 3,
      "updated_by_user_id": "usr_123",
      "updated_by_agent_id": "clawee_123",
      "updated_at": "2026-08-05T08:30:00Z"
    }
  ],
  "meta": {
    "next_cursor": "opaque_cursor",
    "has_next": true
  }
}
```

文件统一按 `updated_at DESC, file_id ASC` 排序。`%` 和 `_` 在 `query` 中按普通字符处理，不具有 SQL 通配符语义。指定的 `space_id` 不存在或当前账户无权读取时返回 `404 shared_space_not_found`。

### 25.3 `GET /api/v1/app/shared-files/detail`

按稳定 `file_id` 查询当前文件元数据，不返回文件正文。

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `file_id` | 是 | 文件列表返回的不透明文件标识 |

请求示例：

```http
GET /api/v1/app/shared-files/detail?file_id=file_01JXYZ HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/json
```

成功响应：`200 OK`

```json
{
  "data": {
    "file_id": "file_01JXYZ",
    "space_id": "space_01JXYZ",
    "space_name": "季度方案",
    "logical_path": "docs/design.md",
    "file_name": "design.md",
    "size_bytes": 12345,
    "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "content_type": "text/markdown",
    "revision": 3,
    "created_by_user_id": "usr_123",
    "created_by_agent_id": "clawee_123",
    "updated_by_user_id": "usr_456",
    "updated_by_agent_id": "clawee_456",
    "created_at": "2026-08-04T08:00:00Z",
    "updated_at": "2026-08-05T08:30:00Z"
  }
}
```

文件不存在或当前账户无权读取时返回 `404 shared_file_not_found`。

### 25.4 `GET /api/v1/app/shared-files/content`

流式下载文件当前内容。成功响应体是原始文件字节，不使用 JSON 包装。

Query 参数：

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `file_id` | 是 | 文件列表或详情返回的不透明文件标识 |

请求示例：

```http
GET /api/v1/app/shared-files/content?file_id=file_01JXYZ HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Accept: application/octet-stream
```

成功响应：`200 OK`

```http
Content-Type: text/markdown
Content-Length: 12345
Content-Disposition: attachment; filename*=UTF-8''design.md
ETag: "sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08"
X-Shared-File-ID: file_01JXYZ
X-File-Revision: 3
X-Content-SHA256: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

Daemon 下载约束：

1. 必须将响应体流式写入目标目录内的临时文件，不得把完整正文读入内存或返回给 React 渲染进程。
2. 下载完成后同时校验实际字节数、`Content-Length` 和 `X-Content-SHA256`；校验失败时删除临时文件。
3. 校验成功后再原子替换用户指定的本地目标文件。是否允许覆盖必须由本地 MCP Tool 的明确参数表达。
4. `X-File-Revision` 是后续替换上传使用的并发校验值，必须与下载结果一起返回给调用方。
5. `storage_key` 和服务器物理路径不会出现在响应中，Daemon 不得推导或构造这些内部字段。
6. 存储对象在响应头发送前不可用时返回 JSON `500 storage_unavailable`；响应流开始后中断时，以长度或摘要校验失败处理。

### 25.5 `POST /api/v1/app/shared-files/content`

使用原始 HTTP 请求体流式新建文件或替换当前内容。请求不是 Multipart，也不使用 JSON 或 Base64 包装正文。

Query 参数：

| 参数 | 新建 | 替换 | 说明 |
| --- | --- | --- | --- |
| `space_id` | 必填 | 必填 | 目标共享空间 ID |
| `logical_path` | 必填 | 必填 | 空间内逻辑路径，必须进行 URL 编码 |
| `expected_revision` | 不传 | 必填 | 最近一次详情或下载得到的正整数 revision |

必须提供的请求头：

| 请求头 | 必填 | 说明 |
| --- | --- | --- |
| `Authorization` | 是 | `Bearer <enterprise_access_token>` |
| `Content-Length` | 是 | 原始文件字节数，允许 `0`；不得使用未知长度或仅依赖 chunked 传输 |
| `X-Content-SHA256` | 是 | 原始文件内容的 64 位小写十六进制 SHA-256 |
| `Content-Type` | 否 | 文件 MIME；未提供时保存为 `application/octet-stream`，最多 255 字节 |

新建请求示例：

```http
POST /api/v1/app/shared-files/content?space_id=space_01JXYZ&logical_path=docs%2Fdesign.md HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Content-Type: text/markdown
Content-Length: 12345
X-Content-SHA256: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08

<原始文件字节流>
```

替换请求示例：

```http
POST /api/v1/app/shared-files/content?space_id=space_01JXYZ&logical_path=docs%2Fdesign.md&expected_revision=3 HTTP/1.1
Authorization: Bearer <enterprise_access_token>
Content-Type: text/markdown
Content-Length: 12345
X-Content-SHA256: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08

<原始文件字节流>
```

新建成功返回 `201 Created`；替换成功返回 `200 OK`：

```json
{
  "data": {
    "file_id": "file_01JXYZ",
    "space_id": "space_01JXYZ",
    "logical_path": "docs/design.md",
    "file_name": "design.md",
    "size_bytes": 12345,
    "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "content_type": "text/markdown",
    "revision": 4,
    "created": false,
    "updated_at": "2026-08-05T08:30:00Z"
  }
}
```

上传语义：

1. 新建时不得传 `expected_revision`。相同 `space_id + logical_path` 已存在时返回 `409 file_already_exists`。
2. 替换时必须传最近读取的 `expected_revision`。服务端仅在当前 revision 相等时切换内容，并将 revision 加一。
3. revision 已变化时返回 `409 revision_conflict`，错误详情包含 `current_revision`。Daemon 必须重新下载并交由调用方合并，不得自动覆盖或自动使用新 revision 重试。
4. 网络中断、请求超时、超限、长度不符、摘要不符、权限变化、revision 冲突或服务端失败时，不得把本次内容视为上传成功。
5. 新建请求结果未知时，Daemon 不得盲目自动重试。应先按空间和路径查询文件并比对摘要，再决定是否由用户重试。
6. `local_path` 只存在于 Codex 与本地 MCP Server 之间，不得作为 Query、Header 或正文元数据发送给企业服务。

### 25.6 路径、大小和分页限制

| 项目 | 限制 |
| --- | --- |
| 单文件大小 | 最大 `1073741824` 字节（1 GiB），允许空文件 |
| `logical_path` | UTF-8 编码后最多 512 字节 |
| 单个路径片段和文件名 | UTF-8 编码后最多 255 字节 |
| `query` | 最多 200 个字符 |
| 分页大小 | 默认 50，最小 1，最大 100 |
| `cursor` | 最多 2048 字节，不透明 URL-safe Base64 字符串 |
| SHA-256 | 64 位小写十六进制字符串 |

`logical_path` 使用 `/` 分隔，并遵循以下规则：

1. 不允许空路径、绝对路径、反斜杠、NUL、空片段、`.` 或 `..` 片段。
2. 不允许以 `/` 开头或结尾，不允许连续 `/`。
3. 不做 Unicode 大小写或兼容等价归一化；路径按原字符串精确判定唯一。
4. `logical_path_prefix` 可以以 `/` 结尾，其余片段规则相同。
5. Daemon 的本地路径校验、允许根目录、符号链接防护和临时文件原子替换是独立责任，服务端逻辑路径校验不能替代本地文件安全检查。

### 25.7 错误处理

错误响应继续使用第 5.5 节的统一 JSON 结构。

| HTTP | `error.code` | 场景 | Clawee 行为 |
| --- | --- | --- | --- |
| `400` | `invalid_request` | 查询参数、请求头或 revision 格式无效 | 修正请求，不重试原请求 |
| `400` | `invalid_logical_path` | 逻辑路径不符合规则 | 拒绝调用并提示路径无效 |
| `400` | `invalid_digest` | SHA-256 格式不是 64 位小写十六进制 | 重新计算摘要后由用户重试 |
| `400` | `invalid_cursor` | 游标无法解码或缺少排序字段 | 清空游标并重新查询 |
| `401` | `unauthorized` | Token 缺失、过期或 Session 失效 | 清除本地 Token，进入未登录状态 |
| `403` | `agent_forbidden` | Agent 未绑定、被禁用或归属失效 | 停止文件请求，保留本地 `agent_id` 并要求重新登录或联系管理员 |
| `404` | `shared_space_not_found` | 空间不存在或当前账户无权访问 | 刷新空间列表，不探测资源 |
| `404` | `shared_file_not_found` | 文件不存在或当前账户无权访问 | 刷新文件列表，不探测资源 |
| `409` | `file_already_exists` | 新建路径已存在 | 查询现有文件并显式决定是否替换 |
| `409` | `revision_conflict` | 替换时 revision 已变化 | 使用 `current_revision` 提示冲突，重新下载，不自动覆盖 |
| `411` | `length_required` | 上传缺少 `Content-Length` | 补充长度后重新发起 |
| `413` | `file_too_large` | 声明或实际内容超过 1 GiB | 终止上传，不重试同一文件 |
| `422` | `content_length_mismatch` | 实际字节数与声明不一致 | 重新读取本地文件并重新计算长度和摘要 |
| `422` | `digest_mismatch` | 服务端计算摘要与声明不一致 | 重新读取本地文件，不自动重复发送旧请求体 |
| `500` | `storage_unavailable` | 服务端文件存储不可用 | 保留本地文件和登录状态，允许稍后手动重试 |
| `500` | `internal_error` | 数据库或未知服务端错误 | 保留本地状态，记录脱敏诊断并允许手动重试 |

`revision_conflict` 示例：

```json
{
  "error": {
    "code": "revision_conflict",
    "message": "文件已被其他成员修改",
    "details": [
      {
        "field": "expected_revision",
        "current_revision": 4
      }
    ]
  }
}
```
