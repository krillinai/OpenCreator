# Agent Activity Token Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a role-aware Agent activity dashboard in OpenCreator backed by `claw-mcp`, with organization-wide administrator metrics, self-only employee metrics, drill-down activity details, and deduplicated Codex token usage.

**Architecture:** `opencreator-collector` reads cumulative Codex usage from rollout transcripts and sends an idempotent `usage_updated` event to `claw-mcp`. `claw-mcp` stores one latest cumulative usage row per turn, performs role-scoped aggregation, and exposes a sanitized app Activity API. OpenCreator Daemon proxies that API through the existing enterprise session and shared `apps/web` renders the same routes for Browser and Desktop.

**Tech Stack:** Go 1.24, PostgreSQL, React 19, TypeScript, Fastify, Zod, Vitest, Testing Library, Playwright, Electron.

---

## Repository Boundaries

- `claw-mcp` repository: `/Users/joshuayin/develop/claw-mcp`
- OpenCreator repository: `/Users/joshuayin/develop/opencreator-client`
- Do not mix files from both repositories in one Git commit.
- Preserve the existing uncommitted `Composer.tsx` and `Composer.test.tsx` changes in OpenCreator; stage files explicitly.

## File Structure

### `claw-mcp`

- Create `db/migrations/00024_office_agent_turn_usage.sql`: turn-level cumulative usage storage and indexes.
- Modify `internal/office/collectorapi/types.go`: standard usage event and payload.
- Create `internal/collector/adapter/codex/usage_reader.go`: bounded rollout JSONL parser.
- Create `internal/collector/adapter/codex/usage_reader_test.go`: transcript variants and malformed-line coverage.
- Modify `internal/collector/adapter/codex/server.go`: enrich Stop hooks with transcript usage.
- Modify `internal/collector/adapter/codex/mapper.go` and test: emit `usage_updated`.
- Modify `internal/office/state/types.go`, `reducer.go`, and tests: persist standard usage events.
- Modify `internal/office/store/postgres.go`: idempotent usage upsert.
- Create `internal/office/dashboard/usage_types.go`: range, breakdown, trend, employee and Agent DTOs.
- Create `internal/office/store/usage_queries.go` and test: organization/self aggregation and details.
- Modify `internal/office/httpapi/dashboard_handlers.go` and tests: role-aware dashboard endpoints.
- Modify `internal/server/office_http.go` and route tests: register app Activity dashboard routes.

### OpenCreator

- Modify `packages/protocol/src/api.ts`: public dashboard DTOs.
- Modify `apps/daemon/src/enterprise/http-client-2026-07-30.ts` and tests: parse sanitized upstream Activity responses.
- Create `apps/daemon/src/enterprise/activity-manager-2026-08-02.ts` and test: session-bound proxy manager.
- Modify `apps/daemon/src/api/routes.enterprise-2026-07-30.ts`, `server.ts`, and integration tests: Runtime endpoints.
- Modify `apps/web/src/services/enterprise-service-2026-07-30.ts` and test: Activity client methods.
- Modify `apps/web/src/app/app-state.ts`, `routes.ts`, and tests: Activity routes.
- Modify `apps/web/src/features/shell/OpenCreatorSidebar.tsx` and test: navigation entry.
- Create `apps/web/src/features/activity/AgentActivityPage.tsx`: role-aware list dashboard.
- Create `apps/web/src/features/activity/AgentActivityDetailPage.tsx`: employee/Agent/session/turn details.
- Create `apps/web/src/features/activity/agent-activity.css`: shared dashboard layout.
- Create focused component tests and modify `apps/web/src/app/AppController.tsx` and `App.test.tsx`.
- Extend Web/Desktop bridge consistency E2E and packaged App E2E fixtures.

### Task 1: Persist Standard Turn Usage in `claw-mcp`

**Files:**
- Create: `/Users/joshuayin/develop/claw-mcp/db/migrations/00024_office_agent_turn_usage.sql`
- Modify: `/Users/joshuayin/develop/claw-mcp/db/migrations/embed.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/store/migrations_test.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/office/collectorapi/types.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/office/state/types.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/office/state/reducer.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/office/state/reducer_test.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/office/store/postgres.go`
- Test: `/Users/joshuayin/develop/claw-mcp/internal/office/store/postgres_test.go`

- [ ] **Step 1: Add failing migration and reducer tests**

Assert migration `00024` creates `office_agent_turn_usage` with a unique key on collector, Agent, session and turn. Add a reducer test that passes:

```go
collectorapi.CollectorEvent{
    EventType: collectorapi.EventUsageUpdated,
    AgentID: "agent_1", SessionID: "session_1", TurnID: "turn_1",
    Usage: &collectorapi.UsageSummary{
        Provider: "openai", Model: "gpt-5.3-codex",
        InputTokens: 100, CachedInputTokens: 40,
        OutputTokens: 30, ReasoningOutputTokens: 10,
        IsFinal: true, Available: true,
    },
}
```

and expects one `UpsertTurnUsage` call.

- [ ] **Step 2: Verify the tests fail**

Run: `go test ./internal/store ./internal/office/state`

Expected: FAIL because `EventUsageUpdated`, `UsageSummary`, and migration `00024` do not exist.

- [ ] **Step 3: Add the usage schema and standard event**

Create the table with non-negative checks and these columns:

```sql
collector_id TEXT NOT NULL,
agent_id TEXT NOT NULL,
session_id TEXT NOT NULL,
turn_id TEXT NOT NULL,
provider TEXT NOT NULL DEFAULT '',
model TEXT NOT NULL DEFAULT '',
input_tokens BIGINT,
cached_input_tokens BIGINT,
output_tokens BIGINT,
reasoning_output_tokens BIGINT,
usage_available BOOLEAN NOT NULL DEFAULT FALSE,
is_final BOOLEAN NOT NULL DEFAULT FALSE,
first_observed_at TIMESTAMPTZ NOT NULL,
last_observed_at TIMESTAMPTZ NOT NULL,
completed_at TIMESTAMPTZ,
PRIMARY KEY (collector_id, agent_id, session_id, turn_id)
```

Add `EventUsageUpdated` and `UsageSummary` to `collectorapi`, then add `TurnUsageState` and `UpsertTurnUsage` to the state Store contract.

- [ ] **Step 4: Implement monotonic idempotent upsert**

Use `INSERT ... ON CONFLICT ... DO UPDATE` so token values use `GREATEST(existing, excluded)`, `is_final` uses logical OR, and `last_observed_at` advances. A late partial event must not lower confirmed usage.

- [ ] **Step 5: Run focused tests**

Run: `go test ./internal/store ./internal/office/state`

Expected: PASS.

- [ ] **Step 6: Commit `claw-mcp` task 1**

```bash
git add db/migrations/00024_office_agent_turn_usage.sql db/migrations/embed.go internal/store/migrations_test.go internal/office/collectorapi/types.go internal/office/state/types.go internal/office/state/reducer.go internal/office/state/reducer_test.go internal/office/store/postgres.go internal/office/store/postgres_test.go
git commit -m "feat: persist agent turn token usage"
```

### Task 2: Read Codex Usage from Rollout Transcripts

**Files:**
- Create: `/Users/joshuayin/develop/claw-mcp/internal/collector/adapter/codex/usage_reader.go`
- Create: `/Users/joshuayin/develop/claw-mcp/internal/collector/adapter/codex/usage_reader_test.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/collector/adapter/codex/hook_payload.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/collector/adapter/codex/server.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/collector/adapter/codex/mapper.go`
- Test: `/Users/joshuayin/develop/claw-mcp/internal/collector/adapter/codex/mapper_test.go`

- [ ] **Step 1: Write failing parser and mapper tests**

Create JSONL fixtures containing Codex `event_msg/token_count` records with:

```json
{"payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":120,"cached_input_tokens":50,"output_tokens":45,"reasoning_output_tokens":12}}}}
```

Test that the last valid cumulative record wins, malformed lines are skipped, paths outside the current user's Codex transcript location are rejected, and files over the configured bound are read from the tail only. Test that a Stop hook with usage emits exactly one `usage_updated` event after the turn completion event.

- [ ] **Step 2: Verify tests fail**

Run: `go test ./internal/collector/adapter/codex`

Expected: FAIL because `ReadLatestUsage` and usage mapping do not exist.

- [ ] **Step 3: Implement a bounded usage reader**

Implement:

```go
type TokenUsage struct {
    InputTokens, CachedInputTokens int64
    OutputTokens, ReasoningOutputTokens int64
}

func ReadLatestUsage(path string, maxBytes int64) (TokenUsage, bool, error)
```

Read at most the last 4 MiB, discard a partial first line when tailing, decode line-by-line, and accept only non-negative integer counters. Never return transcript prompt or response content.

- [ ] **Step 4: Enrich Stop hooks and map usage**

In `HookServer`, call the reader only for `HookEventName == "Stop"` and a non-empty transcript path. Add the usage payload to `HookPayload` in memory, then map it to `collectorapi.EventUsageUpdated` with `IsFinal=true`, `Available=true`, and model from the hook.

- [ ] **Step 5: Run focused tests**

Run: `go test ./internal/collector/adapter/codex`

Expected: PASS.

- [ ] **Step 6: Commit `claw-mcp` task 2**

```bash
git add internal/collector/adapter/codex/usage_reader.go internal/collector/adapter/codex/usage_reader_test.go internal/collector/adapter/codex/hook_payload.go internal/collector/adapter/codex/server.go internal/collector/adapter/codex/mapper.go internal/collector/adapter/codex/mapper_test.go
git commit -m "feat: collect codex token usage"
```

### Task 3: Add Role-Scoped Usage Queries and Sanitized Details

**Files:**
- Create: `/Users/joshuayin/develop/claw-mcp/internal/office/dashboard/usage_types.go`
- Create: `/Users/joshuayin/develop/claw-mcp/internal/office/store/usage_queries.go`
- Create: `/Users/joshuayin/develop/claw-mcp/internal/office/store/usage_queries_test.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/office/store/dashboard_queries.go`
- Test: `/Users/joshuayin/develop/claw-mcp/internal/office/store/dashboard_queries_test.go`

- [ ] **Step 1: Add failing aggregation and privacy tests**

Seed two users in one tenant-equivalent account domain, plus a third unrelated owner. Assert organization queries include the first two only, self queries include one owner only, and range boundaries for `today`, `7d`, and `30d` use the server-provided timezone. Assert totals use `input + output` and do not add cached or reasoning subsets again.

Add a detail assertion that serialized `ToolCallItem` contains `tool_name`, `tool_type`, `status`, timestamps and duration, but has no `input`, `response`, or `response_text` keys.

- [ ] **Step 2: Verify tests fail**

Run: `go test ./internal/office/store`

Expected: FAIL because usage query types and sanitized tool call DTOs do not exist.

- [ ] **Step 3: Implement dashboard DTOs**

Define `UsageRange`, `UsageBreakdown`, `UsageTrendPoint`, `UsageSummary`, `EmployeeUsageRow`, `AgentUsageRow`, `ActivityDashboard`, and `ActivityDetail`. Include `scope: "organization" | "self"`, `range_start`, `range_end`, `timezone`, `missing_usage_records`, and `partial`.

- [ ] **Step 4: Implement organization and self queries**

Join ownership through `office_collector_tokens.user_id`; never accept a user ID from request query parameters. Aggregate by UTC timestamp boundaries produced from the configured enterprise timezone. Sort employee rows by total tokens descending and Agent rows by total tokens descending.

- [ ] **Step 5: Sanitize tool calls at the dashboard boundary**

Replace raw tool call bodies in user-facing Activity detail DTOs with:

```go
type SafeToolCallItem struct {
    ToolCallID string `json:"tool_call_id"`
    ToolName string `json:"tool_name"`
    ToolType string `json:"tool_type"`
    Status string `json:"status"`
    StartedAt time.Time `json:"started_at"`
    CompletedAt *time.Time `json:"completed_at,omitempty"`
    DurationMS int64 `json:"duration_ms"`
}
```

- [ ] **Step 6: Run focused tests and commit**

Run: `go test ./internal/office/store ./internal/office/dashboard`

Expected: PASS.

```bash
git add internal/office/dashboard/usage_types.go internal/office/store/usage_queries.go internal/office/store/usage_queries_test.go internal/office/store/dashboard_queries.go internal/office/store/dashboard_queries_test.go
git commit -m "feat: aggregate role scoped agent usage"
```

### Task 4: Expose `claw-mcp` Activity Dashboard APIs

**Files:**
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/office/httpapi/dashboard_handlers.go`
- Test: `/Users/joshuayin/develop/claw-mcp/internal/office/httpapi/dashboard_handlers_test.go`
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/server/office_http.go`
- Test: `/Users/joshuayin/develop/claw-mcp/internal/server/route_foundation_test.go`
- Test: `/Users/joshuayin/develop/claw-mcp/internal/server/office_http_test.go`

- [ ] **Step 1: Write failing route and authorization tests**

Cover:

```text
GET /api/v1/app/activity/dashboard?range=7d
GET /api/v1/app/activity/agents/:collector_id/:agent_id?range=7d
```

An enterprise administrator receives `scope=organization`; a normal account receives `scope=self`; invalid ranges return 400; unauthenticated requests return 401; an employee requesting an unowned Agent receives 404; serialized responses contain no raw tool bodies.

- [ ] **Step 2: Verify tests fail**

Run: `go test ./internal/office/httpapi ./internal/server`

Expected: FAIL with unregistered routes.

- [ ] **Step 3: Implement handlers and server-side role selection**

Resolve account identity and administrator capability from authenticated request context. Do not accept `scope`, `tenant_id`, or `user_id` from clients. Parse `range` through a closed enum and default it to `7d`.

- [ ] **Step 4: Run server tests and the full Go suite**

Run: `go test ./internal/office/httpapi ./internal/server`

Expected: PASS.

Run: `go test ./...`

Expected: PASS.

- [ ] **Step 5: Commit `claw-mcp` task 4**

```bash
git add internal/office/httpapi/dashboard_handlers.go internal/office/httpapi/dashboard_handlers_test.go internal/server/office_http.go internal/server/route_foundation_test.go internal/server/office_http_test.go
git commit -m "feat: expose agent activity usage dashboard"
```

### Task 5: Add OpenCreator Protocol and Daemon Enterprise Proxy

**Files:**
- Modify: `/Users/joshuayin/develop/opencreator-client/packages/protocol/src/api.ts`
- Test: `/Users/joshuayin/develop/opencreator-client/apps/daemon/test/unit/protocol-shape.test.ts`
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/daemon/src/enterprise/http-client-2026-07-30.ts`
- Test: `/Users/joshuayin/develop/opencreator-client/apps/daemon/test/unit/enterprise-http-client-2026-07-30.test.ts`
- Create: `/Users/joshuayin/develop/opencreator-client/apps/daemon/src/enterprise/activity-manager-2026-08-02.ts`
- Create: `/Users/joshuayin/develop/opencreator-client/apps/daemon/test/unit/enterprise-activity-manager-2026-08-02.test.ts`
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/daemon/src/api/routes.enterprise-2026-07-30.ts`
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/daemon/src/api/server.ts`
- Test: `/Users/joshuayin/develop/opencreator-client/apps/daemon/test/integration/api.test.ts`

- [ ] **Step 1: Write failing protocol, upstream parser, and Runtime route tests**

Define tests for `EnterpriseActivityDashboardResponse`, `EnterpriseActivityDetailResponse`, and `EnterpriseActivityRange`. Assert Zod rejects negative Token counts, unsupported scope/range, and any tool call containing `input`, `response`, or `response_text`.

Test Runtime endpoints:

```text
GET /enterprise/activity?range=7d
GET /enterprise/activity/agents/:collectorId/:agentId?range=7d
```

with signed-out, administrator, employee, upstream 403, malformed upstream payload, and timeout cases.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @opencreator/daemon test -- test/unit/enterprise-http-client-2026-07-30.test.ts test/unit/enterprise-activity-manager-2026-08-02.test.ts test/integration/api.test.ts`

Expected: FAIL because Activity types and routes do not exist.

- [ ] **Step 3: Add protocol types and strict upstream schemas**

Mirror only the sanitized `claw-mcp` response. Keep token counts as non-negative numbers, represent missing usage with `available: false`, and expose `partial` plus `missingUsageRecords`.

- [ ] **Step 4: Implement the session-bound manager**

The manager obtains the current access token through `EnterpriseSessionManager`, calls the HTTP client, and maps `EnterpriseHttpError` to existing Runtime enterprise error codes. It never accepts credentials or user identity from Web.

- [ ] **Step 5: Register Runtime routes and run tests**

Run the focused command from step 2, then:

Run: `pnpm --filter @opencreator/daemon typecheck`

Expected: PASS.

- [ ] **Step 6: Commit OpenCreator task 5 without Composer files**

```bash
git add packages/protocol/src/api.ts apps/daemon/src/enterprise/http-client-2026-07-30.ts apps/daemon/src/enterprise/activity-manager-2026-08-02.ts apps/daemon/src/api/routes.enterprise-2026-07-30.ts apps/daemon/src/api/server.ts apps/daemon/test/unit/protocol-shape.test.ts apps/daemon/test/unit/enterprise-http-client-2026-07-30.test.ts apps/daemon/test/unit/enterprise-activity-manager-2026-08-02.test.ts apps/daemon/test/integration/api.test.ts
git commit -m "feat: proxy enterprise agent activity"
```

### Task 6: Add Shared Activity Navigation and Routes

**Files:**
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/web/src/app/app-state.ts`
- Test: `/Users/joshuayin/develop/opencreator-client/apps/web/src/app/app-state.test.ts`
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/web/src/app/routes.ts`
- Test: `/Users/joshuayin/develop/opencreator-client/apps/web/src/app/routes.test.ts`
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/web/src/features/shell/OpenCreatorSidebar.tsx`
- Test: `/Users/joshuayin/develop/opencreator-client/apps/web/src/features/shell/OpenCreatorSidebar.test.tsx`

- [ ] **Step 1: Write failing navigation tests**

Assert “Agent 活动” is immediately after “新对话”, invokes `onOpenView('activity')`, has `aria-current=page` on the Activity view, and keeps icon/title accessibility while collapsed. Assert route round trips for:

```text
#/activity
#/activity/agent/<collectorId>/<agentId>?range=7d
```

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @opencreator/web test -- src/app/routes.test.ts src/app/app-state.test.ts src/features/shell/OpenCreatorSidebar.test.tsx`

Expected: FAIL because Activity is not an ActiveView or AppRoute.

- [ ] **Step 3: Add `activity` state, routes, and sidebar action**

Use Lucide `Activity` or `ChartNoAxesCombined`; do not add a platform capability branch. Route Agent IDs with `encodeURIComponent` and reject malformed encodings through the existing safe parser.

- [ ] **Step 4: Run tests and commit**

Run the focused command from step 2.

Expected: PASS.

```bash
git add apps/web/src/app/app-state.ts apps/web/src/app/app-state.test.ts apps/web/src/app/routes.ts apps/web/src/app/routes.test.ts apps/web/src/features/shell/OpenCreatorSidebar.tsx apps/web/src/features/shell/OpenCreatorSidebar.test.tsx
git commit -m "feat: add agent activity navigation"
```

### Task 7: Build Administrator and Employee Activity Views

**Files:**
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/web/src/services/enterprise-service-2026-07-30.ts`
- Test: `/Users/joshuayin/develop/opencreator-client/apps/web/src/services/enterprise-service-2026-07-30.test.ts`
- Create: `/Users/joshuayin/develop/opencreator-client/apps/web/src/features/activity/AgentActivityPage.tsx`
- Create: `/Users/joshuayin/develop/opencreator-client/apps/web/src/features/activity/AgentActivityPage.test.tsx`
- Create: `/Users/joshuayin/develop/opencreator-client/apps/web/src/features/activity/AgentActivityDetailPage.tsx`
- Create: `/Users/joshuayin/develop/opencreator-client/apps/web/src/features/activity/AgentActivityDetailPage.test.tsx`
- Create: `/Users/joshuayin/develop/opencreator-client/apps/web/src/features/activity/agent-activity.css`
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/web/src/app/AppController.tsx`
- Test: `/Users/joshuayin/develop/opencreator-client/apps/web/src/app/App.test.tsx`

- [ ] **Step 1: Write failing service and component tests**

Cover administrator organization cards/table, employee self cards/distributions, today/7d/30d switching, partial/missing usage, employee and Agent drill-down, signed-out prompt, empty Collector state, 403, retry, and cache clearing on logout. Assert no raw tool body text renders.

- [ ] **Step 2: Verify tests fail**

Run: `pnpm --filter @opencreator/web test -- src/services/enterprise-service-2026-07-30.test.ts src/features/activity/AgentActivityPage.test.tsx src/features/activity/AgentActivityDetailPage.test.tsx`

Expected: FAIL because Activity service methods and components do not exist.

- [ ] **Step 3: Implement service methods and page state**

Add `getActivityDashboard(range)` and `getActivityAgentDetail(collectorId, agentId, range)`. Use request-generation guards consistent with enterprise skills so stale results from an old account cannot replace current state.

- [ ] **Step 4: Implement the dashboard UI**

Administrator view: four summary metrics, compact trend, Token breakdown, searchable employee table. Employee view: three summary metrics, trend, model distribution, Agent distribution, recent turns. Detail view: Agent status, usage breakdown, sessions/turns, prompt and assistant summaries, activity timeline, sub-Agents, and sanitized tool rows.

Use stable grid dimensions, full-width bands, tables and unframed detail sections. Do not nest cards or add decorative gradients.

- [ ] **Step 5: Integrate with AppController and run tests**

Run the focused command from step 2, then:

Run: `pnpm --filter @opencreator/web typecheck`

Expected: PASS.

- [ ] **Step 6: Commit task 7 without Composer files**

```bash
git add apps/web/src/services/enterprise-service-2026-07-30.ts apps/web/src/services/enterprise-service-2026-07-30.test.ts apps/web/src/features/activity/AgentActivityPage.tsx apps/web/src/features/activity/AgentActivityPage.test.tsx apps/web/src/features/activity/AgentActivityDetailPage.tsx apps/web/src/features/activity/AgentActivityDetailPage.test.tsx apps/web/src/features/activity/agent-activity.css apps/web/src/app/AppController.tsx apps/web/src/app/App.test.tsx
git commit -m "feat: show role aware agent activity"
```

### Task 8: Enforce Retention and Complete Cross-Platform Gates

**Files:**
- Modify: `/Users/joshuayin/develop/claw-mcp/internal/office/store/management_queries.go`
- Test: `/Users/joshuayin/develop/claw-mcp/internal/office/store/management_queries_test.go`
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/web/e2e/enterprise-platform-consistency-2026-07-30.spec.ts`
- Modify: `/Users/joshuayin/develop/opencreator-client/apps/desktop/e2e/enterprise-packaged-2026-07-30.spec.ts`

- [ ] **Step 1: Add failing 90-day cleanup tests**

Seed usage and activity rows at 89 and 91 days. Assert cleanup deletes the 91-day usage/activity rows, preserves account/Agent/permission rows, and is idempotent.

- [ ] **Step 2: Implement cleanup and run `claw-mcp` full tests**

Run: `go test ./...`

Expected: PASS.

- [ ] **Step 3: Add Browser/Desktop consistency coverage**

Render the Activity list and Agent detail with the same Fake Daemon payload for Browser Bridge and Desktop Bridge. Compare visible labels, active route, key grid dimensions, Runtime request paths, time-range changes and detail navigation.

- [ ] **Step 4: Run OpenCreator verification**

Run:

```bash
pnpm typecheck
pnpm --filter @opencreator/web test
pnpm --filter @opencreator/daemon test
pnpm desktop:test
pnpm e2e
```

Expected: PASS.

- [ ] **Step 5: Build and verify the packaged Desktop App**

Run the repository's actual packaged App E2E and Web asset hash verification. Confirm the package rebuilds `apps/web/dist`, `opencreator-app://` loads Activity, Runtime proxy requests succeed, and embedded Web hashes match the fresh dist.

- [ ] **Step 6: Commit retention and consistency work per repository**

In `claw-mcp`:

```bash
git add internal/office/store/management_queries.go internal/office/store/management_queries_test.go
git commit -m "feat: expire old agent activity usage"
```

In OpenCreator:

```bash
git add apps/web/e2e/enterprise-platform-consistency-2026-07-30.spec.ts apps/desktop/e2e/enterprise-packaged-2026-07-30.spec.ts
git commit -m "test: verify agent activity host consistency"
```

## Completion Criteria

- Collector reports final cumulative Codex Token usage without duplicate counting.
- `claw-mcp` employees cannot access another user's data; enterprise administrators see organization data only within their authorized enterprise boundary.
- OpenCreator Browser and Desktop call the same Runtime endpoints and render the same common UI.
- Tool input, full response and response text are absent from every user-facing Activity response.
- Today, 7-day and 30-day ranges use explicit server boundaries; detail retention is 90 days.
- Both repositories pass type checks and relevant tests.
- Actual packaged App E2E and Web asset hash verification pass before release is claimed.
