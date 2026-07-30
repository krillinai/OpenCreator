# Clawee Agent 登录与 Skill Hub 接口接入文档

## 1. 文档目的

本文定义 Clawee Agent 接入企业 MCP Gateway 登录和 Skill Hub 所需的 HTTP API、调用流程、错误处理和 Clawee 侧实现约束。

本文面向 Clawee Web、Desktop 和 Daemon 的开发与测试人员。接口提供方为 `claw-mcp`，下文统一称为“企业服务”。

## 2. 接入范围

本次接入包括：

1. 注册普通服务账号。
2. 使用已注册账号登录 Clawee。
3. 查询当前登录账号和会话状态。
4. 注销并撤销当前服务会话。
5. 获取企业 Skill Hub 中已发布的 Skill。
6. 获取 Skill 当前发布版本详情。
7. 下载指定发布版本的 Skill ZIP 包。
8. 校验并安装 Skill 到本机 Codex Skills 目录。
9. 根据远端版本信息识别可安装、已安装和可更新状态。

本次接入不包括：

1. 特殊企业账户、企业身份源或管理员预分配账号。
2. 调用企业后台 `/api/v1/admin/*` 接口。
3. 在 Clawee 内上传、发布或下架 Skill。
4. 由企业服务操作用户本地文件或 Codex Skills 目录。
5. OAuth Device Flow、Refresh Token 或跨设备同步。
6. 用企业 Skill Hub 替换 Clawee 现有公共 Skill Market。

## 3. 职责边界

### 3.1 企业服务

企业服务负责：

1. 按客户端类型注册普通账号；Clawee 注册时使用客户端提供的 `agent_id` 创建并绑定 Agent。
2. 校验账号和密码。
3. 为 `clawee-agent` 签发应用端 Bearer JWT。
4. 校验会话、账号状态和 Token 有效性。
5. 返回已发布 Skill 的元数据和版本信息。
6. 分发经过服务端校验的 Skill ZIP 包。
7. 返回稳定的 HTTP 状态码和业务错误码。

### 3.2 Clawee Daemon

Clawee Daemon 是企业服务的唯一调用方，负责：

1. 代理注册、登录、当前账号查询和注销请求。
2. 在首次注册或登录前生成并持久化稳定的 `agent_id`，并保存企业服务地址和企业会话 Token。
3. 为 Clawee Web 与 Desktop 提供统一的本地登录状态。
4. 获取 Skill 列表、详情和 ZIP 包。
5. 校验 ZIP 包 SHA-256，安全解压到临时目录。
6. 复用 Clawee 现有 Skill 安装事务、覆盖策略和回滚能力。
7. 保存企业 Skill 安装记录，并计算更新状态。

### 3.3 Clawee Web 与 Desktop

Clawee Web 与 Desktop 只调用本地 Daemon，不直接请求企业服务。

通用登录和 Skill Hub 业务必须由 Web/Desktop 共用的 Daemon API 和 Service 实现。Desktop Bridge 不得单独实现企业登录、Skill 列表或安装逻辑。

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

当前 Skill 列表一次返回全部已发布 Skill。Clawee 仍应保留读取 `meta` 的能力，以兼容后续游标分页。

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
| 获取已发布 Skill 列表 | `GET` | `/api/v1/app/skills` | Bearer JWT |
| 获取已发布 Skill 详情 | `GET` | `/api/v1/app/skills/detail?skill_id=...` | Bearer JWT |
| 下载指定 Skill 版本 | `GET` | `/api/v1/app/skills/package?skill_id=...&version_id=...` | Bearer JWT |
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

启动恢复流程：

1. Daemon 读取安全存储中的企业 Token。
2. 没有 Token 时返回“未登录”，不请求企业服务。
3. 有 Token 时调用 `/api/v1/auth/me`。
4. 返回 `200`、账号为 active 且 `agent.agent_id` 与本地配置一致时恢复登录状态。
5. 返回 `401` 时删除本地 Token 并进入未登录状态。
6. 网络失败或 `5xx` 时进入“企业服务暂不可用”，不得误删仍可能有效的 Token。

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

## 10. Skill 列表接口

### 10.1 `GET /api/v1/app/skills`

返回当前企业 Skill Hub 中全部已发布 Skill。未发布或已下架 Skill 不出现在列表中。

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
| `name` | string | Skill 包中声明的名称，也是 Clawee 本地安装目录名 |
| `description` | string | 当前发布版本的说明 |
| `version_id` | string | 当前发布版本的不透明标识 |
| `version` | string | 展示用版本字符串，不保证符合 SemVer |
| `package_sha256` | string | 原始 ZIP 字节的 SHA-256，64 位小写十六进制 |
| `updated_at` | string | 当前发布状态最近更新时间 |

Clawee 不得对 `version` 做大小比较。是否存在更新以 `version_id` 和 `package_sha256` 为准。

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

Skill 不存在、未发布或已下架时返回 `404 not_found`。Clawee 收到该错误后应刷新 Skill 列表，并取消本次安装或更新操作。

## 12. Skill 包下载接口

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
| `401` | `unauthorized` | Token 缺失、过期或被撤销 | 清除本地 Token，进入未登录状态 |
| `403` | `forbidden` | 当前账号无权访问 | 保留登录状态，提示无权访问 |
| `404` | `not_found` | Skill 不存在、未发布或已下架 | 刷新目录，终止当前操作 |
| `409` | `version_changed` | 当前发布版本已变化 | 刷新元数据，由用户重新发起安装或更新 |
| `413` | `package_too_large` | 包超过服务端限制 | 终止操作，不重试 |
| `429` | `rate_limited` | 请求过于频繁 | 遵循 `Retry-After`，只重试读取请求 |
| `500` | `internal_error` | 企业服务内部错误 | 保留登录和本地状态，允许手动重试 |
| `502/503` | 网关或服务不可用 | 企业服务暂不可用 | 保留 Token，展示离线状态 |

自动重试限制：

1. 登录和注销请求不得自动重试。
2. Skill 安装和更新不得在未知结果后自动重新执行本地写入。
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
4. 企业 Skill 的基础展示字段使用 `name`、`description`、`version` 和 `changelog`。
5. 公共市场和企业 Skill 出现同名 Skill 时，本地 Codex Skills 目录仍只能存在一份同名 Skill。
6. 安装前必须根据现有 Skill 来源和安装记录明确展示“安装”“更新”或“名称冲突”，不得静默覆盖未知来源 Skill。

建议为安装记录增加来源标识，避免使用 GitHub 字段表达企业 Skill：

```ts
type EnterpriseSkillInstallRecord = {
  source: "enterprise-skill-hub";
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
7. 远端 Skill 已从列表消失但本地仍存在：保留本地 Skill，标记为 `unpublished`，不得自动删除。

`version_id` 用于关联企业服务版本，`package_sha256` 是判断安装内容是否变化的最终依据。

## 18. 安装与更新流程

### 18.1 安装

```text
用户点击安装
  -> Daemon 获取 Skill 详情
  -> 记录 skill_id、version_id、package_sha256
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
| Skill 列表和详情 | 15 秒 |
| Skill ZIP 下载 | 120 秒 |

下载必须采用流式写入和增量 SHA-256，不应把完整 ZIP 同时保存在多个内存副本中。客户端应限制响应大小，并与企业服务当前 50 MiB 原始 ZIP 上限保持一致。

## 20. 日志与诊断要求

允许记录：

1. 企业服务 Origin。
2. HTTP 方法、路径模板和状态码。
3. 请求 ID。
4. `skill_id`、`version_id`、`name` 和 `package_sha256`。
5. 下载字节数、耗时和失败阶段。

禁止记录：

1. 账号密码。
2. Bearer Token 或完整 Authorization Header。
3. Skill ZIP 内容和 `SKILL.md` 全文。
4. 带有敏感 Query 参数的原始 URL。
5. 操作系统安全凭据存储内容。

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

### 21.2 Skill Hub

1. 只调用 `/api/v1/app/skills*` 目标接口。
2. 列表只展示企业服务返回的已发布 Skill。
3. 下载请求同时携带 `skill_id` 和 `version_id`。
4. 下载后按 `package_sha256` 校验原始 ZIP。
5. `409 version_changed` 会刷新元数据，不安装旧版本。
6. ZIP 校验、解压、安装或记录写入失败时不会留下半安装状态。
7. 更新失败时可以恢复原 Skill。
8. 企业 Skill 与公共市场同名时不会静默覆盖未知来源 Skill。
9. Web 与 Desktop 在相同数据下显示相同状态并调用相同 Runtime API。

## 22. 接口契约摘要

Clawee 正式依赖以下稳定契约：

```text
POST /api/v1/auth/register
POST /api/v1/auth/login
GET  /api/v1/auth/me
POST /api/v1/auth/logout

GET  /api/v1/app/skills
GET  /api/v1/app/skills/detail?skill_id=<skill_id>
GET  /api/v1/app/skills/package?skill_id=<skill_id>&version_id=<version_id>
```

Clawee Daemon 在首次注册或登录前生成并持久化稳定的 `agent_id`。账号通过 `/api/v1/auth/register` 自助注册时固定提交 `client_id=clawee-agent` 和该 `agent_id`；注册成功后通过登录接口提交相同字段，签发绑定该 Agent 的 `claw-frontend` Bearer JWT。缺少 `agent_id` 时注册和登录都必须失败，企业服务不得兜底生成或选择 Agent。Web `/app` 通过 `client_id=web` 或省略 `client_id` 进入原有账户级认证分支，继续显式切换 Agent。Clawee Daemon 是企业服务唯一调用方，Web/Desktop 不直接持有企业 Token；企业服务负责身份和 Skill 分发，Clawee 负责本地安装及其完整性和回滚。
