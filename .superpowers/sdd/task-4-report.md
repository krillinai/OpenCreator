# Task 4 报告：Web Runtime 文件服务

## 实现范围

- 修改 `apps/web/src/runtime/client.ts`
- 修改 `apps/web/src/runtime/client.test.ts`
- 新增 `apps/web/src/services/workspace-file-service.ts`
- 新增 `apps/web/src/services/workspace-file-service.test.ts`

## TDD 过程

1. 先新增 `workspace-file-service.test.ts`，覆盖：
   - `listDirectory` 调 `GET /workspace/files/directory`
   - `openText` 调 `GET /workspace/files/content`
   - `saveText` 调 `POST /workspace/files/content`
   - `reveal` 调 `POST /workspace/files/reveal`
   - `openBlob` 走 `RuntimeClient.rawGet`，并生成 object URL
   - `revokeBlob` 调 `URL.revokeObjectURL`
2. 扩展 `runtime/client.test.ts`，补充：
   - `rawGet` 带 `Authorization`
   - `rawRequest` 保持非 2xx 抛 `ApiClientError`
   - 现有 JSON `request` 继续发送 JSON body
3. 先运行失败验证：
   - `pnpm --filter @clawee/web test -- src/services/workspace-file-service.test.ts`
   - 初次失败为 `workspace-file-service.ts` 不存在，符合 brief 预期
4. 实现 `rawGet` / `rawRequest` 与 `workspace-file-service`
5. 运行目标测试与 typecheck，全部通过

## RuntimeClient 改动

- 新增 `rawGet(path)`
- 新增 `rawRequest(path, input)`
- `request<T>` 改为先走 `rawRequest`，再 `readJson`
- 非 2xx 错误解析逻辑保持不变，仍抛 `ApiClientError`
- `/healthz` 不带 `Authorization`，其他 path 继续带 Bearer token

## workspace-file-service 说明

- 导出 `createWorkspaceFileService(client)`
- 提供方法：
  - `listDirectory(threadId, path)`
  - `getMeta(threadId, path)`
  - `openText(threadId, path)`
  - `saveText(input)`
  - `openBlob(threadId, path)`
  - `revokeBlob(objectUrl)`
  - `reveal(input)`
- `openBlob` 实现：
  - `client.rawGet('/workspace/files/blob?...')`
  - `await response.blob()`
  - `URL.createObjectURL(blob)`
  - 返回 `{ objectUrl, mime, size }`

## 验证结果

- 通过：
  - `pnpm --filter @clawee/web test -- src/services/workspace-file-service.test.ts src/runtime/client.test.ts`
  - `pnpm --filter @clawee/web typecheck`

## 风险与备注

- 按要求仅修改 web runtime client 与 workspace file service，未触碰 App/UI。
- 测试命令使用了 `apps/web` 包内可命中的相对路径写法；仓库根路径写法在当前 Vitest 配置下不会命中测试文件。
