# Sidebar Conversation Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent pinning, inline rename, archive controls, and confirmed permanent deletion to project conversation rows.

**Architecture:** Extend the shared Thread protocol and SQLite repository so pin and permanent delete are Runtime-owned. Keep `AppController` responsible for mutations and durable Web state, while `OpenCreatorSidebar` owns only transient menu, edit, and dialog state. Browser and Desktop use the same component and Runtime endpoints.

**Tech Stack:** TypeScript, React 18, Fastify, better-sqlite3, Vitest, Testing Library, Playwright, Electron

---

## File Structure

- `packages/protocol/src/api.ts`: public Thread pin state and update contract.
- `apps/daemon/src/storage/database.ts`: additive `pinned_at` migration.
- `apps/daemon/src/storage/repositories.ts`: persist pin timestamps and atomically delete Thread-owned rows.
- `apps/daemon/src/threads/types.ts`: manager input and permanent-delete contract.
- `apps/daemon/src/threads/manager.ts`: pin assignment and deletion policy boundary.
- `apps/daemon/src/api/routes.threads.ts`: PATCH pin parsing and DELETE endpoint validation.
- `apps/web/src/services/thread-service.ts`: shared Runtime client calls.
- `apps/web/src/features/projects/project-model.ts`: sidebar pin projection.
- `apps/web/src/app/AppController.tsx`: rename, pin, delete mutations and selected-state cleanup.
- `apps/web/src/features/shell/OpenCreatorSidebar.tsx`: hover actions, menu, inline editor, and confirmation dialog.
- `apps/web/src/styles/app.css`: compact action cluster, menu, and editor styling.
- Existing adjacent test files: regression coverage at every boundary.

### Task 1: Add The Persisted Pin Contract

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `apps/daemon/src/storage/database.ts`
- Modify: `apps/daemon/src/storage/repositories.ts`
- Test: `apps/daemon/test/unit/storage.test.ts`

- [ ] **Step 1: Write failing storage and protocol tests**

Add assertions that `ThreadResponse.pinnedAt` is nullable, `UpdateThreadRequest` accepts `pinned?: boolean`, a new Thread starts unpinned, and updating pin state survives reopening the database.

```ts
expect(created.pinnedAt).toBeNull();
repository.updateThread(created.id, { pinnedAt: '2026-08-06T00:00:00.000Z' });
expect(repository.getThread(created.id)?.pinnedAt).toBe('2026-08-06T00:00:00.000Z');
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts`

Expected: FAIL because `pinned_at` and the typed fields do not exist.

- [ ] **Step 3: Add the additive migration and mappings**

Add nullable `pinned_at TEXT`, map it to `pinnedAt: string | null`, and extend the update repository input with `pinnedAt?: string | null`. Extend the protocol exactly as follows:

```ts
export type UpdateThreadRequest = {
  title?: string;
  sandbox?: SandboxMode;
  pinned?: boolean;
};

export type ThreadResponse = {
  // existing fields
  pinnedAt: string | null;
};
```

- [ ] **Step 4: Run storage tests and typechecks**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts && pnpm --filter @opencreator/protocol typecheck && pnpm --filter @opencreator/daemon typecheck`

Expected: PASS.

### Task 2: Implement Atomic Permanent Thread Deletion

**Files:**
- Modify: `apps/daemon/src/storage/repositories.ts`
- Modify: `apps/daemon/src/threads/types.ts`
- Modify: `apps/daemon/src/threads/manager.ts`
- Test: `apps/daemon/test/unit/storage.test.ts`
- Test: `apps/daemon/test/unit/thread-manager.test.ts`

- [ ] **Step 1: Write failing deletion tests**

Create a conversation with dependent Run/event data, delete it, and assert the Thread and Runtime-owned dependents are absent while a sentinel file in its project cwd remains.

```ts
manager.deleteThread(thread.id);
expect(manager.getThread(thread.id)).toBeUndefined();
expect(runRepository.listRunsByThread(thread.id)).toEqual([]);
expect(readFileSync(projectFile, 'utf8')).toBe('keep');
```

Also assert schedule-managed Threads reject with `THREAD_MANAGED_BY_SCHEDULE`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts test/unit/thread-manager.test.ts`

Expected: FAIL because `deleteThread` does not exist.

- [ ] **Step 3: Implement one transaction-owned delete operation**

Add `deleteThread(id: string): void` to the repository and manager. Delete dependent Runtime rows in foreign-key-safe order inside one SQLite transaction, then delete the Thread. Do not perform recursive filesystem deletion. Remove only a Thread-specific isolated `.codex-runtime` directory when it is located inside the Runtime-owned Thread workspace; never remove the project cwd.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the Task 2 command again. Expected: PASS.

### Task 3: Expose Pin And Delete Through The Runtime API

**Files:**
- Modify: `apps/daemon/src/api/routes.threads.ts`
- Test: `apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: Write failing API tests**

Cover `PATCH /threads/:id` with `{ "pinned": true }`, `DELETE /threads/:id`, missing Thread, schedule-managed Thread, and active Run rejection.

```ts
expect(pinResponse.json().thread.pinnedAt).toEqual(expect.any(String));
expect(deleteResponse.statusCode).toBe(204);
expect(activeDelete.json().error.code).toBe('THREAD_HAS_ACTIVE_RUN');
```

- [ ] **Step 2: Run the API tests and verify RED**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/integration/api.test.ts -t "pins|permanently deletes"`

Expected: FAIL on missing parsing and route.

- [ ] **Step 3: Implement validation and routes**

Map `pinned: true` to `new Date().toISOString()` and `pinned: false` to `null` in the manager. Add `DELETE /threads/:id`; return `204` only after deletion, `404 THREAD_NOT_FOUND`, `409 THREAD_MANAGED_BY_SCHEDULE`, or `409 THREAD_HAS_ACTIVE_RUN` as appropriate. Include `pinnedAt` in every Thread response mapper.

- [ ] **Step 4: Run API tests and Daemon typecheck**

Run the Task 3 test command, then `pnpm --filter @opencreator/daemon typecheck`. Expected: PASS.

### Task 4: Add Web Service And Projection Support

**Files:**
- Modify: `apps/web/src/services/thread-service.ts`
- Modify: `apps/web/src/services/thread-service.test.ts`
- Modify: `apps/web/src/features/projects/project-model.ts`
- Modify: `apps/web/src/features/projects/project-model.test.ts`

- [ ] **Step 1: Write failing service and ordering tests**

Assert `deleteThread('thread/1')` calls encoded `DELETE /threads/thread%2F1`, pin calls the existing PATCH endpoint, and project conversations sort pinned-first then newest-first.

```ts
await service.deleteThread('thread/1');
expect(del).toHaveBeenCalledWith('/threads/thread%2F1');
expect(sortProjectConversations(rows).map(row => row.id)).toEqual(['pinned-new', 'pinned-old', 'normal']);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/web test -- src/services/thread-service.test.ts src/features/projects/project-model.test.ts`

Expected: FAIL on missing delete and sort helpers.

- [ ] **Step 3: Implement the service and deterministic sorting**

Add `deleteThread(threadId): Promise<void>` using `client.delete`, carry `pinnedAt` into `OpenCreatorConversation`, and export a pure project-local sorting helper using `pinnedAt !== null` followed by the existing newest order.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Task 4 command again. Expected: PASS.

### Task 5: Build The Sidebar Interaction

**Files:**
- Modify: `apps/web/src/features/shell/OpenCreatorSidebar.tsx`
- Modify: `apps/web/src/features/shell/OpenCreatorSidebar.test.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/styles/app-css.test.ts`

- [ ] **Step 1: Write failing component tests**

Test the three action buttons, More menu, Escape/outside close, pin callback, inline Rename Enter/Escape/blur, empty title protection, and destructive delete confirmation. Use callbacks with these signatures:

```ts
onRenameConversation?(id: string, title: string): Promise<void> | void;
onPinConversation?(id: string, pinned: boolean): Promise<void> | void;
onDeleteConversation?(id: string): Promise<void> | void;
```

- [ ] **Step 2: Run the sidebar tests and verify RED**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/web test -- src/features/shell/OpenCreatorSidebar.test.tsx`

Expected: FAIL because More, Pin, Rename, and permanent Delete do not exist.

- [ ] **Step 3: Implement transient interaction state**

Add one open menu ID, one rename draft, pending delete state, and per-action busy IDs. Render `MoreHorizontal`, `Archive`, and `Pin`/`PinOff` icon buttons in a fixed 84px action cluster. Preserve the row width by replacing metadata rather than adding width. Use the shared `ConfirmDialog` with title `删除任务`, confirm label `永久删除`, and a description naming the conversation and preservation of project files.

- [ ] **Step 4: Add compact styles and CSS contracts**

Use an anchored menu with maximum 8px radius, no nested cards, fixed icon button dimensions, visible focus states, and `@media (hover: none)` visibility. The inline input occupies the title column without changing row height.

- [ ] **Step 5: Run component and CSS tests**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/web test -- src/features/shell/OpenCreatorSidebar.test.tsx src/styles/app-css.test.ts`

Expected: PASS.

### Task 6: Wire Mutations Into AppController

**Files:**
- Modify: `apps/web/src/app/AppController.tsx`
- Modify: `apps/web/src/app/App.test.tsx`

- [ ] **Step 1: Write failing App integration tests**

From a rendered conversation row, rename and assert PATCH plus updated title; pin and assert PATCH plus pinned-first order; permanently delete and assert DELETE, row removal, cached timeline cleanup, and navigation to a new conversation when selected.

```ts
expect(readRequestBody(renamePatch.init!)).toEqual({ title: '新标题' });
expect(readRequestBody(pinPatch.init!)).toEqual({ pinned: true });
expect(deleteCall.init?.method).toBe('DELETE');
```

- [ ] **Step 2: Run focused App tests and verify RED**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/web test -- src/app/App.test.tsx -t "renames a sidebar conversation|pins a sidebar conversation|permanently deletes a sidebar conversation"`

Expected: FAIL because callbacks are not wired.

- [ ] **Step 3: Implement AppController mutations**

Rename and pin through `threadService.updateThread`, replacing state only with the returned Thread. Delete through `threadService.deleteThread`, remove the Thread from stores, clear timeline and Run caches, and call the existing `startNewConversation()` path when deleting the selection. Map API errors to the existing thread load error surface.

- [ ] **Step 4: Run App tests and Web typecheck**

Run the Task 6 tests, then `pnpm --filter @opencreator/web typecheck`. Expected: PASS.

### Task 7: Shared Web/Desktop Verification

**Files:**
- Modify only if a verification failure identifies a scoped defect.

- [ ] **Step 1: Run focused regression suites**

Run all tests changed in Tasks 1-6 plus `git diff --check`. Expected: PASS.

- [ ] **Step 2: Run Browser/Desktop bridge consistency tests**

Run the repository's existing Web/Desktop parity suite for the sidebar and conversation workflow. Verify both bridges render the same labels and call the same PATCH/DELETE Runtime routes. Expected: PASS.

- [ ] **Step 3: Build fresh Web and package Desktop**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/web build && pnpm desktop:package`

Expected: fresh `apps/web/dist`, successful package, and build manifest for the current dirty state.

- [ ] **Step 4: Verify embedded asset hashes and packaged E2E**

Run the repository hash verification and packaged Electron E2E commands discovered from `apps/desktop/package.json`. Verify the sidebar menu, rename, pin, and delete confirmation in the packaged app. Expected: identical Web asset hashes and passing E2E.

- [ ] **Step 5: Restart port 9000 and smoke test**

Start `pnpm web:dev`, request `/.opencreator/runtime/healthz`, and manually verify the four interactions at desktop and mobile widths. Expected: HTTP 200 with `{ "ok": true }` and no overlapping row content.
