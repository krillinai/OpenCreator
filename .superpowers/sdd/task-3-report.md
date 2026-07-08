# Task 3 报告：Daemon 文件 API Routes

## 实现范围

- 新增 `apps/daemon/src/api/routes.workspace-files.ts`
- 修改 `apps/daemon/src/api/server.ts`
- 修改 `apps/daemon/test/integration/api.test.ts`
- 补充 `apps/daemon/src/workspace-files/reveal.ts` 的 `createDefaultRevealExecutor` 导出，用于按 brief 注册默认 reveal executor

## TDD 过程

1. 先在 `apps/daemon/test/integration/api.test.ts` 增加 `"workspace files"` 集成测试：
   - external thread 目录读取
   - 文本内容读取
   - 文件写回磁盘
   - blob 图片读取与 `Content-Type`
   - 未授权 401
   - localhost CORS preflight
   - path traversal 返回 `PATH_INVALID`
2. 运行失败验证：
   - `pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "workspace files"`
   - 初次失败为 `404`，确认原因是 routes 尚未注册
3. 实现 routes 与 server 注册
4. 再次运行测试与 typecheck，全部通过

## 路由实现说明

- 已实现并注册以下路由：
  - `GET /workspace/files/directory?threadId=&path=`
  - `GET /workspace/files/meta?threadId=&path=`
  - `GET /workspace/files/content?threadId=&path=`
  - `POST /workspace/files/content`
  - `GET /workspace/files/blob?threadId=&path=`
  - `POST /workspace/files/reveal`
- 所有 query/body 均为手动校验
- 校验错误统一返回 `apiError('VALIDATION_FAILED', ...)`
- `WorkspaceFileError` 统一映射其 `statusCode`、`code`、`message`、`details`
- blob route 保持走全局 Bearer auth，返回 `Buffer`，并设置：
  - `Content-Type: <meta.mime>`
  - `Cache-Control: no-store`
- service 注册方式：
  - `getThread: (id) => threadManager.getThread(id)`
  - `revealExecutor: createDefaultRevealExecutor()`

## 验证结果

- 通过：
  - `pnpm --filter @clawee/daemon test -- test/integration/api.test.ts -t "workspace files"`
  - `pnpm --filter @clawee/daemon typecheck`

## 风险与备注

- 为满足 brief 注册签名，补充导出了 `createDefaultRevealExecutor()`；其行为仍直接返回现有 `defaultRevealExecutor`，未改变 reveal 逻辑。
