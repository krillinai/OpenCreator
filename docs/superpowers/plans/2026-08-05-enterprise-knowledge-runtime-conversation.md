# Enterprise Knowledge Runtime Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an account-isolated, project-independent enterprise knowledge conversation view backed by the existing Thread, Run, Codex app-server, SSE, queue, cancellation, approval, and history infrastructure.

**Architecture:** Add `knowledge_conversation` as a first-class Thread purpose with a server-owned enterprise subject binding and dedicated create/list/read/run authorization. Knowledge Runs use the existing Run Manager but pass through a fail-closed policy that permits only the granted `knowledge.search` MCP tool and rejects startup unless Codex can disable shell, file, patch, web, and arbitrary MCP tools. The shared Web application hosts a knowledge conversation workspace that reuses the existing conversation controller hooks and presentation components, so Browser and Desktop execute identical Runtime requests.

**Tech Stack:** TypeScript, React, Fastify, SQLite/better-sqlite3, Codex app-server JSON-RPC, MCP, Vitest, Testing Library, Playwright, Electron.

---

## File Responsibility Map

- `packages/protocol/src/api.ts`: public Thread purpose, knowledge Thread request, stable enterprise subject, knowledge source, and stable Runtime error contracts.
- `apps/daemon/src/enterprise/http-client-2026-07-30.ts`: strict decoding of the upstream opaque account subject and Agent MCP grant/search responses.
- `apps/daemon/src/enterprise/session-manager-2026-07-30.ts`: expose a verified current enterprise identity to trusted Daemon services without accepting identity from Web.
- `apps/daemon/src/storage/migrations.ts`: add nullable `enterprise_subject_id` to Threads and an index for latest-account lookup.
- `apps/daemon/src/storage/repositories.ts`: persist and filter the server-owned subject binding.
- `apps/daemon/src/threads/types.ts`, `apps/daemon/src/threads/manager.ts`: create managed knowledge Threads and enforce purpose invariants.
- `apps/daemon/src/enterprise/knowledge-conversation-2026-08-05.ts`: central access checks, grant verification, isolated workspace creation, search forwarding, and source sanitization.
- `apps/daemon/src/api/routes.knowledge-conversation-2026-08-05.ts`: dedicated create/latest/detail/runs/history endpoints that never expose another subject's Thread.
- `apps/daemon/src/agent-tools/knowledge-tools-2026-08-05.ts`: `knowledge.search` MCP schema and name mapping.
- `apps/daemon/src/agent-tools/internal-routes.ts`, `apps/daemon/src/agent-tools/run-injection.ts`: capability-token-protected search route and per-Run knowledge-only MCP injection.
- `apps/daemon/src/codex/argv.ts`, `apps/daemon/src/codex/app-server-host-2026-07-28.ts`: explicit built-in tool policy with fail-closed capability validation.
- `apps/daemon/src/runs/manager.ts`, `apps/daemon/src/api/server.ts`: revalidate knowledge access/grants at actual queue start and compose the new services/routes.
- `apps/web/src/services/thread-service.ts`: dedicated knowledge Thread methods; ordinary thread loading excludes knowledge purposes.
- `apps/web/src/features/conversation/ConversationWorkspace.tsx`: reusable Timeline/Composer/approval surface driven by the existing conversation state callbacks.
- `apps/web/src/features/knowledge/KnowledgeConversation.tsx`: knowledge-specific empty/error/send policy around the shared workspace.
- `apps/web/src/features/knowledge/KnowledgePage.tsx`, `apps/web/src/features/knowledge/knowledge.css`: list/conversation toggle while preserving mounted state and the refresh action.
- `apps/web/src/app/AppController.tsx`: own one knowledge conversation state machine and connect it to existing Run/SSE/history primitives without selecting a project Thread.
- Browser/Desktop E2E fixtures: prove identical DOM, Runtime calls, persistence, mobile sizing, and packaged App behavior.

### Task 1: Extend Protocol and Upstream Enterprise Identity Contract

**Files:**
- Modify: `packages/protocol/src/api.ts`
- Modify: `apps/daemon/src/enterprise/http-client-2026-07-30.ts`
- Test: `apps/daemon/test/unit/protocol-shape.test.ts`
- Test: `apps/daemon/test/unit/enterprise-http-client-2026-07-30.test.ts`

- [ ] **Step 1: Write failing protocol and decoder tests**

```ts
const request: CreateThreadRequest = { purpose: 'knowledge_conversation' };
const purpose: ThreadPurpose = 'knowledge_conversation';
const account: EnterpriseAccountSummary = {
  subjectId: 'acct_01JZ8W6A2M4S',
  email: 'user@example.com',
  name: 'User'
};
expect(request.purpose).toBe(purpose);
expect(account.subjectId).toBe('acct_01JZ8W6A2M4S');
```

Add HTTP fixtures whose `account` contains `account_id`, and assert both login and `/auth/me` map it to `subjectId`. Add a malformed response without `account_id` and assert `ENTERPRISE_PROTOCOL_ERROR`; this prevents an email fallback.

- [ ] **Step 2: Run tests and verify the new contract fails**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/protocol-shape.test.ts test/unit/enterprise-http-client-2026-07-30.test.ts`

Expected: FAIL because the purpose union and `subjectId`/`account_id` decoder do not exist.

- [ ] **Step 3: Add exact protocol variants and strict account mapping**

```ts
export type ThreadPurpose =
  | 'conversation'
  | 'knowledge_conversation'
  | 'schedule_draft'
  | 'schedule_task';

export type CreateThreadRequest =
  | {
      projectId: string;
      purpose?: 'conversation';
      title?: string;
      profile?: string;
      model?: string;
      reasoning?: ReasoningEffort;
      sandbox?: SandboxMode;
    }
  | {
      purpose: 'knowledge_conversation';
      title?: string;
      profile?: string;
      model?: string;
      reasoning?: ReasoningEffort;
    }
  | {
      purpose: 'schedule_draft';
      title?: string;
      cwd?: string;
      workspaceMode?: WorkspaceMode;
      profile?: string;
      model?: string;
      reasoning?: ReasoningEffort;
      sandbox?: SandboxMode;
    };

export type EnterpriseAccountSummary = {
  subjectId: string;
  email: string;
  name: string;
};
```

In the upstream decoder require `account_id: z.string().min(1)` and map it only as `subjectId: account.account_id`. Extend `RuntimeErrorCode` with `KNOWLEDGE_THREAD_FORBIDDEN`, `KNOWLEDGE_SEARCH_NOT_GRANTED`, `KNOWLEDGE_TOOL_POLICY_UNAVAILABLE`, and `ENTERPRISE_KNOWLEDGE_UNAVAILABLE`.

- [ ] **Step 4: Run tests and typecheck**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/protocol-shape.test.ts test/unit/enterprise-http-client-2026-07-30.test.ts && pnpm --filter @opencreator/protocol typecheck`

Expected: PASS.

- [ ] **Step 5: Commit the contract**

```bash
git add packages/protocol/src/api.ts apps/daemon/src/enterprise/http-client-2026-07-30.ts apps/daemon/test/unit/protocol-shape.test.ts apps/daemon/test/unit/enterprise-http-client-2026-07-30.test.ts
git commit -m "feat: add knowledge conversation identity contract"
```

### Task 2: Persist Account Ownership and Create Knowledge Threads

**Files:**
- Modify: `apps/daemon/src/storage/migrations.ts`
- Modify: `apps/daemon/src/storage/repositories.ts`
- Modify: `apps/daemon/src/threads/types.ts`
- Modify: `apps/daemon/src/threads/manager.ts`
- Test: `apps/daemon/test/unit/storage.test.ts`
- Test: `apps/daemon/test/unit/thread-manager.test.ts`

- [ ] **Step 1: Write failing migration, repository, and manager tests**

```ts
const thread = manager.createKnowledgeThread({
  enterpriseSubjectId: 'acct_a',
  cwd: managedKnowledgeDir,
  profile: 'default'
});
expect(thread).toMatchObject({
  projectId: null,
  purpose: 'knowledge_conversation',
  enterpriseSubjectId: 'acct_a',
  workspaceMode: 'managed',
  sandbox: 'read-only'
});
expect(manager.listKnowledgeThreads('acct_b')).toEqual([]);
expect(manager.listKnowledgeThreads('acct_a')).toEqual([thread]);
```

Also open a pre-change SQLite fixture, run `migrate`, and assert `PRAGMA table_info(threads)` contains `enterprise_subject_id`.

- [ ] **Step 2: Run tests and verify missing storage support**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts test/unit/thread-manager.test.ts`

Expected: FAIL because knowledge ownership APIs and the column are absent.

- [ ] **Step 3: Add the nullable owner column, index, and typed repository filters**

```sql
ALTER TABLE threads ADD COLUMN enterprise_subject_id TEXT;
CREATE INDEX IF NOT EXISTS idx_threads_knowledge_subject_updated
ON threads(enterprise_subject_id, purpose, status, updated_at DESC, id DESC);
```

Extend `ThreadRow`, `CreateThreadRow`, `RuntimeThread`, inserts, and selects with `enterpriseSubjectId: string | null`. Add `listKnowledgeThreads({ enterpriseSubjectId, status, limit })` whose SQL requires both `purpose = 'knowledge_conversation'` and exact subject equality. `createKnowledgeThread` must force `projectId: null`, `origin: 'opencreator_created'`, `workspaceMode: 'managed'`, `sandbox: 'read-only'`, and never accept a subject from an HTTP body.

- [ ] **Step 4: Run focused tests and Daemon typecheck**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/storage.test.ts test/unit/thread-manager.test.ts && pnpm --filter @opencreator/daemon typecheck`

Expected: PASS.

- [ ] **Step 5: Commit persistence**

```bash
git add apps/daemon/src/storage/migrations.ts apps/daemon/src/storage/repositories.ts apps/daemon/src/threads/types.ts apps/daemon/src/threads/manager.ts apps/daemon/test/unit/storage.test.ts apps/daemon/test/unit/thread-manager.test.ts
git commit -m "feat: persist account-owned knowledge threads"
```

### Task 3: Add Dedicated, Subject-Authorized Knowledge Thread APIs

**Files:**
- Create: `apps/daemon/src/enterprise/knowledge-conversation-2026-08-05.ts`
- Create: `apps/daemon/src/api/routes.knowledge-conversation-2026-08-05.ts`
- Modify: `apps/daemon/src/enterprise/session-manager-2026-07-30.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/src/api/routes.threads.ts`
- Test: `apps/daemon/test/integration/knowledge-conversation-api-2026-08-05.test.ts`

- [ ] **Step 1: Write cross-account API tests before routes**

```ts
const created = await subjectA.post('/enterprise/knowledge-conversations', {});
expect(created.statusCode).toBe(201);
expect(created.json().thread.projectId).toBeNull();

expect((await subjectB.get('/enterprise/knowledge-conversations/latest')).statusCode).toBe(204);
expect((await subjectB.get(`/enterprise/knowledge-conversations/${created.json().thread.id}`)).statusCode).toBe(404);
expect((await subjectB.get(`/enterprise/knowledge-conversations/${created.json().thread.id}/history`)).statusCode).toBe(404);
expect((await subjectB.get(`/enterprise/knowledge-conversations/${created.json().thread.id}/runs`)).statusCode).toBe(404);
```

Assert `GET /threads?status=active` excludes the created knowledge Thread, and `POST /threads` rejects a client-supplied `enterpriseSubjectId`.

- [ ] **Step 2: Run the integration test and verify 404/missing route failures**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/integration/knowledge-conversation-api-2026-08-05.test.ts`

Expected: FAIL because the dedicated routes are not registered.

- [ ] **Step 3: Implement a trusted session identity and access service**

```ts
export type EnterpriseIdentity = {
  subjectId: string;
  agentId: string;
  accessToken: string;
};

export type KnowledgeConversationManager = {
  create(): Promise<RuntimeThread>;
  latest(): Promise<RuntimeThread | undefined>;
  requireOwnedThread(threadId: string): Promise<RuntimeThread>;
};
```

`EnterpriseSessionManager.requireIdentity()` must refresh/validate the token, return the opaque subject from the verified response, and never read request data. Use `resolve(dataDir, 'enterprise-knowledge', 'workspaces', sha256(subjectId), threadId)` for a Daemon-managed empty cwd. Return 404 for non-owned resources so callers cannot enumerate IDs.

- [ ] **Step 4: Register dedicated endpoints and hide knowledge Threads from generic endpoints**

Register `POST /enterprise/knowledge-conversations`, `GET /enterprise/knowledge-conversations/latest`, and subject-checked detail/runs/history routes. In generic `/threads` defaults exclude both `schedule_task` and `knowledge_conversation`; generic detail/history/runs must return 404 for knowledge purpose so authorization cannot be bypassed.

- [ ] **Step 5: Run API tests and typecheck**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/integration/knowledge-conversation-api-2026-08-05.test.ts test/integration/api.test.ts && pnpm --filter @opencreator/daemon typecheck`

Expected: PASS, including cross-subject non-disclosure.

- [ ] **Step 6: Commit authorized routes**

```bash
git add apps/daemon/src/enterprise/knowledge-conversation-2026-08-05.ts apps/daemon/src/api/routes.knowledge-conversation-2026-08-05.ts apps/daemon/src/enterprise/session-manager-2026-07-30.ts apps/daemon/src/api/server.ts apps/daemon/src/api/routes.threads.ts apps/daemon/test/integration/knowledge-conversation-api-2026-08-05.test.ts
git commit -m "feat: add isolated knowledge thread APIs"
```

### Task 4: Implement Authorized `knowledge.search` MCP and Fail-Closed Tool Policy

**Files:**
- Modify: `apps/daemon/src/enterprise/http-client-2026-07-30.ts`
- Modify: `apps/daemon/src/enterprise/knowledge-conversation-2026-08-05.ts`
- Create: `apps/daemon/src/agent-tools/knowledge-tools-2026-08-05.ts`
- Modify: `apps/daemon/src/agent-tools/capability-token.ts`
- Modify: `apps/daemon/src/agent-tools/internal-routes.ts`
- Modify: `apps/daemon/src/agent-tools/run-injection.ts`
- Modify: `apps/daemon/src/codex/argv.ts`
- Modify: `apps/daemon/src/codex/app-server-host-2026-07-28.ts`
- Test: `apps/daemon/test/unit/knowledge-run-policy-2026-08-05.test.ts`
- Test: `apps/daemon/test/integration/knowledge-mcp-api-2026-08-05.test.ts`

- [ ] **Step 1: Write failing grant and tool-policy tests**

```ts
expect(await policy.prepareRun(knowledgeThread)).toMatchObject({
  sandbox: 'read-only',
  builtInTools: {
    shell: false,
    fileRead: false,
    fileWrite: false,
    applyPatch: false,
    webSearch: false
  },
  mcpServers: [{ enabledTools: ['knowledge.search'], required: true }]
});
await expect(policy.prepareRun(knowledgeThread, noGrantSession))
  .rejects.toMatchObject({ code: 'KNOWLEDGE_SEARCH_NOT_GRANTED' });
await expect(policy.prepareRun(knowledgeThread, codexWithoutToolDisableSupport))
  .rejects.toMatchObject({ code: 'KNOWLEDGE_TOOL_POLICY_UNAVAILABLE' });
```

Add MCP tests proving a capability token for one Run/Thread cannot search for another, arbitrary tool names are rejected, upstream failures are mapped to `ENTERPRISE_KNOWLEDGE_UNAVAILABLE`, and returned sources contain only `title`, `knowledgeBaseName`, `documentName`, and `excerpt`.

- [ ] **Step 2: Run the policy tests and verify they fail**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/knowledge-run-policy-2026-08-05.test.ts test/integration/knowledge-mcp-api-2026-08-05.test.ts`

Expected: FAIL because the grant, MCP tool, and built-in policy do not exist.

- [ ] **Step 3: Add strict upstream grant/search decoders**

Decode the verified Agent grant from `GET /api/v1/app/mcp-grants` as `{ tools: [{ name: z.literal('knowledge.search'), enabled: z.boolean() }] }`. Forward searches through `POST /api/v1/app/knowledge/search` with `{ query, limit }`, the current access token, and no client-selected subject. Reject a missing/disabled grant independently of knowledge-base `permissions.search`.

- [ ] **Step 4: Add one capability scope and one MCP tool**

```ts
export const KNOWLEDGE_SEARCH_SCOPE = 'knowledge:search' as const;
export const KNOWLEDGE_SEARCH_TOOL = {
  name: 'knowledge.search',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['query'],
    properties: {
      query: { type: 'string', minLength: 1, maxLength: 4000 },
      limit: { type: 'integer', minimum: 1, maximum: 20 }
    }
  }
};
```

Issue `knowledge:search` only for a validated knowledge Run. The internal MCP handler must authorize run ID, thread ID, scope, current subject ownership, current session, and current Agent grant on every call before forwarding.

- [ ] **Step 5: Implement explicit Codex built-in tool disabling and capability probing**

Add a typed `BuiltInToolPolicy` to exec/app-server launch inputs and map every false field to the supported Codex feature/config switch. Extend the existing Codex capability probe to report each switch. For `knowledge_conversation`, reject Run startup unless all five switches are supported and false; do not fall back to prompt instructions, approval interception, or `read-only` alone. Ordinary and schedule Runs keep their current launch arguments.

- [ ] **Step 6: Run policy, argv, app-server, and MCP tests**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/unit/knowledge-run-policy-2026-08-05.test.ts test/integration/knowledge-mcp-api-2026-08-05.test.ts test/unit/codex-argv.test.ts test/unit/codex-app-server-runner.test.ts test/unit/agent-tool-run-injection.test.ts`

Expected: PASS; snapshots show only `knowledge.search` and all built-ins disabled for knowledge Runs.

- [ ] **Step 7: Commit the knowledge-only execution policy**

```bash
git add apps/daemon/src/enterprise/http-client-2026-07-30.ts apps/daemon/src/enterprise/knowledge-conversation-2026-08-05.ts apps/daemon/src/agent-tools/knowledge-tools-2026-08-05.ts apps/daemon/src/agent-tools/capability-token.ts apps/daemon/src/agent-tools/internal-routes.ts apps/daemon/src/agent-tools/run-injection.ts apps/daemon/src/codex/argv.ts apps/daemon/src/codex/app-server-host-2026-07-28.ts apps/daemon/test/unit/knowledge-run-policy-2026-08-05.test.ts apps/daemon/test/integration/knowledge-mcp-api-2026-08-05.test.ts
git commit -m "feat: enforce knowledge-only runtime tools"
```

### Task 5: Revalidate at Queue Start and Reuse Run/SSE/History

**Files:**
- Modify: `apps/daemon/src/runs/manager.ts`
- Modify: `apps/daemon/src/api/server.ts`
- Modify: `apps/daemon/src/api/routes.knowledge-conversation-2026-08-05.ts`
- Test: `apps/daemon/test/integration/knowledge-conversation-runs-2026-08-05.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Create a queued knowledge Run, revoke the grant before it starts, and assert terminal failure code `KNOWLEDGE_SEARCH_NOT_GRANTED` without spawning Codex. Add successful cases for enqueue order, cancellation, SSE replay using `Last-Event-ID`, history restoration, and Daemon restart convergence. Add a cross-subject `POST /runs` attempt and assert 404.

- [ ] **Step 2: Run the lifecycle suite and verify failures**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/integration/knowledge-conversation-runs-2026-08-05.test.ts`

Expected: FAIL because generic Run creation does not apply subject/grant checks at dequeue time.

- [ ] **Step 3: Add a Run-start policy hook**

```ts
export type RunStartPolicy = {
  prepare(input: {
    runId: string;
    thread: RuntimeThread;
    createdBy: 'api' | 'schedule';
  }): Promise<AgentToolRunInjection | undefined>;
};
```

Invoke `prepare` immediately before each queued Run spawns/resumes Codex, not only at HTTP submission. Route knowledge Run submission through the subject-authorized endpoint, then reuse existing Run repository, event stream, cancellation, queue, and history code. Preserve deterministic public error codes and redact upstream bodies/tokens.

- [ ] **Step 4: Run lifecycle and existing Run regression tests**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test -- test/integration/knowledge-conversation-runs-2026-08-05.test.ts test/integration/run-manager.test.ts test/integration/approval-runtime.test.ts`

Expected: PASS with unchanged ordinary/schedule behavior.

- [ ] **Step 5: Commit lifecycle integration**

```bash
git add apps/daemon/src/runs/manager.ts apps/daemon/src/api/server.ts apps/daemon/src/api/routes.knowledge-conversation-2026-08-05.ts apps/daemon/test/integration/knowledge-conversation-runs-2026-08-05.test.ts
git commit -m "feat: run knowledge conversations through runtime queue"
```

### Task 6: Extract the Shared Conversation Workspace

**Files:**
- Create: `apps/web/src/features/conversation/ConversationWorkspace.tsx`
- Create: `apps/web/src/features/conversation/ConversationWorkspace.test.tsx`
- Modify: `apps/web/src/app/AppController.tsx`

- [ ] **Step 1: Add a characterization test for the existing workspace**

Render `ConversationWorkspace` with timeline items, a pending approval, queued items, running/canceling flags, model options, and callbacks. Assert the existing `ConversationHeader`, `Timeline`, approval overlay, `Composer`, stop, queue cancel/steer, and history-load interactions remain wired.

- [ ] **Step 2: Run the test and verify the component is missing**

Run: `pnpm --filter @opencreator/web test -- src/features/conversation/ConversationWorkspace.test.tsx`

Expected: FAIL because `ConversationWorkspace.tsx` does not exist.

- [ ] **Step 3: Extract presentation without moving state ownership**

Move the JSX currently composing `ConversationHeader`, `Timeline`, approval overlay, memory suggestion, and `Composer` into a typed component. Pass data and callbacks explicitly; keep Run/SSE/history effects in `AppController`. Add `variant: 'project' | 'knowledge'`; the knowledge variant hides project selector, attachments, file workspace, memory suggestion, starter tags, permission mutation, and project errors while retaining model, reasoning, queue, cancellation, approvals, and history.

- [ ] **Step 4: Run workspace and full App regression tests**

Run: `pnpm --filter @opencreator/web test -- src/features/conversation/ConversationWorkspace.test.tsx src/app/App.test.tsx`

Expected: Workspace tests PASS. Existing App assertions produce no new failures; record the five pre-existing async business failures separately if still present.

- [ ] **Step 5: Commit only the extraction**

```bash
git add apps/web/src/features/conversation/ConversationWorkspace.tsx apps/web/src/features/conversation/ConversationWorkspace.test.tsx apps/web/src/app/AppController.tsx
git commit -m "refactor: share conversation workspace rendering"
```

### Task 7: Add Knowledge Conversation UI and Lazy Thread Creation

**Files:**
- Modify: `apps/web/src/services/thread-service.ts`
- Modify: `apps/web/src/services/thread-service.test.ts`
- Create: `apps/web/src/features/knowledge/KnowledgeConversation.tsx`
- Create: `apps/web/src/features/knowledge/KnowledgeConversation.test.tsx`
- Modify: `apps/web/src/features/knowledge/KnowledgePage.tsx`
- Modify: `apps/web/src/features/knowledge/KnowledgePage.test.tsx`
- Modify: `apps/web/src/features/knowledge/knowledge.css`
- Modify: `apps/web/src/app/AppController.tsx`
- Modify: `apps/web/src/app/App.test.tsx`

- [ ] **Step 1: Write failing service and interaction tests**

```ts
expect(await service.getLatestKnowledgeThread()).toEqual({ thread: null });
expect(get).toHaveBeenCalledWith('/enterprise/knowledge-conversations/latest');
expect(await service.createKnowledgeThread()).toEqual({ thread });
expect(post).toHaveBeenCalledWith('/enterprise/knowledge-conversations', {});
```

UI tests must assert: refresh remains visible; toggle text changes `对话知识库`/`返回列表视图`; upload is list-only; list selection and mobile pane survive round-trip; whitespace submission creates nothing; first valid submit creates one Thread then one Run; later submits reuse it; switching views does not call cancel; returning restores the active timeline; signed-out, expired, missing-grant, and service-unavailable states retain the draft and disable sending with the specified message.

- [ ] **Step 2: Run tests and verify missing behavior**

Run: `pnpm --filter @opencreator/web test -- src/services/thread-service.test.ts src/features/knowledge/KnowledgePage.test.tsx src/features/knowledge/KnowledgeConversation.test.tsx src/app/App.test.tsx`

Expected: FAIL on missing dedicated service methods, toggle, and knowledge workspace.

- [ ] **Step 3: Add dedicated service methods and exclude knowledge from project loading**

```ts
getLatestKnowledgeThread(): Promise<{ thread: ThreadResponse | null }> {
  return client.get('/enterprise/knowledge-conversations/latest');
},
createKnowledgeThread(): Promise<{ thread: ThreadResponse }> {
  return client.post('/enterprise/knowledge-conversations', {});
}
```

Use the dedicated knowledge detail/runs/history/run endpoints. Change ordinary interactive loading to `purpose=conversation` plus the existing schedule query; never merge `knowledge_conversation` into sidebar/project collections.

- [ ] **Step 4: Implement stable view switching and lazy send**

Keep `mode` inside `KnowledgePage` and render both list and conversation state from stable parent data. The toggle must not clear selected knowledge base, documents, mobile pane, draft, timeline, subscription, or active Run. On the first trimmed non-empty submit, create the knowledge Thread, store its ID in knowledge-only controller state, then submit through the existing Run action; subsequent submits reuse it. On subject ID change, detach the old sender/subscription and load the new subject's latest active knowledge Thread.

- [ ] **Step 5: Style the knowledge workspace using existing conversation tokens**

Add a full-height unframed `.knowledge-conversation` layout inside the current knowledge content region. Reuse existing composer/timeline classes and sizes; add only knowledge header/toggle responsive rules. At 390px, keep the toggle text readable, preserve refresh, and prevent horizontal page overflow.

- [ ] **Step 6: Run Web tests and typecheck**

Run: `pnpm --filter @opencreator/web test -- src/services/thread-service.test.ts src/features/knowledge/KnowledgePage.test.tsx src/features/knowledge/KnowledgeConversation.test.tsx src/app/App.test.tsx && pnpm --filter @opencreator/web typecheck`

Expected: New suites PASS; no new App failures beyond any documented pre-existing failures.

- [ ] **Step 7: Commit the UI together with the user's existing knowledge styling changes**

Before committing, inspect `git diff` and preserve the already-present nickname removal, typography sizing, sidebar weight, document MIME removal, compact header, and refresh button. Then run:

```bash
git add apps/web/src/services/thread-service.ts apps/web/src/services/thread-service.test.ts apps/web/src/features/conversation/ConversationWorkspace.tsx apps/web/src/features/knowledge/KnowledgeConversation.tsx apps/web/src/features/knowledge/KnowledgeConversation.test.tsx apps/web/src/features/knowledge/KnowledgePage.tsx apps/web/src/features/knowledge/KnowledgePage.test.tsx apps/web/src/features/knowledge/knowledge.css apps/web/src/app/AppController.tsx apps/web/src/app/App.test.tsx apps/web/src/styles/app.css apps/web/src/styles/app-css.test.ts
git commit -m "feat: add runtime knowledge conversation view"
```

### Task 8: Browser/Desktop Consistency and Mobile E2E

**Files:**
- Modify: `apps/web/e2e/support/fake-enterprise-daemon-2026-07-30.ts`
- Modify: `apps/web/e2e/enterprise-platform-consistency-2026-07-30.spec.ts`
- Create: `apps/web/e2e/enterprise-knowledge-conversation-2026-08-05.spec.ts`

- [ ] **Step 1: Extend Fake Daemon with deterministic knowledge lifecycle**

Model subject A/B, latest Thread, create count, queued/running/terminal Runs, SSE replay, cancel, grant revocation, and sanitized source events. Record every Runtime request with bridge kind only as test metadata, never as behavior input.

- [ ] **Step 2: Add parity and mobile assertions**

Run the same scenario at the same 1280x800 content viewport under Browser and Desktop Bridge: toggle, lazy send, request sequence, running state, list round-trip, event recovery, cancel, history reload, account switch, and persistence. Compare visible text, button states, main DOM snapshot, key element rectangles, and persisted Fake Daemon state. At 390x844 assert `document.documentElement.scrollWidth === document.documentElement.clientWidth`.

- [ ] **Step 3: Run Web consistency E2E**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm exec playwright test apps/web/e2e/enterprise-platform-consistency-2026-07-30.spec.ts apps/web/e2e/enterprise-knowledge-conversation-2026-08-05.spec.ts`

Expected: PASS for both bridges and mobile viewport with identical Runtime request sequences.

- [ ] **Step 4: Commit E2E coverage**

```bash
git add apps/web/e2e/support/fake-enterprise-daemon-2026-07-30.ts apps/web/e2e/enterprise-platform-consistency-2026-07-30.spec.ts apps/web/e2e/enterprise-knowledge-conversation-2026-08-05.spec.ts
git commit -m "test: cover knowledge conversation platform parity"
```

### Task 9: Full Verification and Packaged App Gate

**Files:**
- Modify: `apps/desktop/e2e/enterprise-packaged-2026-07-30.spec.ts`

- [ ] **Step 1: Add packaged App assertions**

In the real packaged Electron app verify `opencreator-app://`, Preload Bridge, Runtime proxy, session subject, latest knowledge Thread restoration, toggle, first send, SSE-rendered answer/source, and a revoked-grant deterministic failure. Assert no project thread/sidebar entry is created.

- [ ] **Step 2: Run repository typechecks and focused tests**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm typecheck`

Expected: PASS.

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/daemon test && pnpm --filter @opencreator/web test && pnpm --filter @opencreator/desktop test`

Expected: PASS, or stop and report every pre-existing failure separately; do not claim completion while a new failure remains.

- [ ] **Step 3: Rebuild Web and package Desktop from the same workspace**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/web build && pnpm --filter @opencreator/desktop package`

Expected: PASS; the manifest records commit, dirty state, Web build hash, platform, architecture, and build time.

- [ ] **Step 4: Verify embedded hashes and run packaged E2E**

Run: `PATH=/Users/joshuayin/.nvm/versions/node/v22.22.0/bin:$PATH pnpm --filter @opencreator/desktop verify:package && pnpm --filter @opencreator/desktop e2e:package -- enterprise-packaged-2026-07-30.spec.ts`

Expected: PASS; `apps/web/dist` and embedded App Web resources have identical file lists and hashes, and the packaged knowledge flow succeeds.

- [ ] **Step 5: Commit packaged coverage and final verification record**

```bash
git add apps/desktop/e2e/enterprise-packaged-2026-07-30.spec.ts
git commit -m "test: verify packaged knowledge conversations"
```

Do not state Web/Desktop parity or release readiness unless every command in Task 9 passes. If upstream `/auth/me`, MCP grant, or knowledge search contracts are unavailable in the test environment, report that exact external dependency and leave release status blocked rather than substituting email identity, `permissions.search`, or model-only answers.
