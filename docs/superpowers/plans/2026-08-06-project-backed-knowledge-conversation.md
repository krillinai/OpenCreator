# Project-Backed Knowledge Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create enterprise knowledge conversations inside the default project and open them in the standard conversation UI.

**Architecture:** Treat `enterpriseSubjectId` as the knowledge-policy marker while storing new knowledge threads as project-backed `conversation` threads. Replace the Knowledge page's embedded conversation mode with a creation callback, then navigate through the normal AppController thread path.

**Tech Stack:** React, TypeScript, Fastify, SQLite, Vitest

---

### Task 1: Replace the Knowledge page toggle

**Files:**
- Modify: `apps/web/src/features/knowledge/KnowledgePage.tsx`
- Modify: `apps/web/src/features/knowledge/KnowledgePage.test.tsx`

- [ ] Write a failing test that clicks `对话知识库`, expects `onStartConversation` once, and confirms the old split workspace is absent.
- [ ] Replace `conversation` with `onStartConversation`, remove local conversation mode state and embedded layout, and wire the button callback.
- [ ] Run the focused Knowledge page test.

### Task 2: Create and navigate to the default-project thread

**Files:**
- Modify: `apps/web/src/services/thread-service.ts`
- Modify: `apps/web/src/services/thread-service.test.ts`
- Modify: `apps/web/src/app/AppController.tsx`
- Modify: `apps/web/src/app/App.test.tsx`

- [ ] Update `createKnowledgeThread` to send `{ projectId }`.
- [ ] Add an App test covering default project ensure, knowledge thread creation, and standard thread navigation.
- [ ] Implement `openEnterpriseKnowledgeConversation`, normal thread-store adoption, project/thread selection, and navigation.
- [ ] Remove the independent knowledge timeline/run state and component wiring.
- [ ] Run focused Web tests and typecheck.

### Task 3: Store knowledge threads in the default project

**Files:**
- Modify: `apps/daemon/src/api/routes.knowledge-conversation-2026-08-05.ts`
- Modify: `apps/daemon/src/enterprise/knowledge-conversation-2026-08-05.ts`
- Modify: `apps/daemon/src/threads/types.ts`
- Modify: `apps/daemon/src/threads/manager.ts`
- Modify: `apps/daemon/src/storage/repositories.ts`
- Modify relevant unit tests under `apps/daemon/test/unit`

- [ ] Add failing route and manager tests for required `projectId`, project cwd, `conversation` purpose, and enterprise subject marker.
- [ ] Validate the project through ThreadManager and create the knowledge thread with external project workspace and standard conversation purpose.
- [ ] List knowledge threads by enterprise subject marker for legacy compatibility.
- [ ] Run focused Daemon tests.

### Task 4: Preserve knowledge runtime isolation

**Files:**
- Modify: `apps/daemon/src/agent-tools/run-injection.ts`
- Modify: `apps/daemon/src/runs/manager.ts`
- Modify relevant Daemon policy tests

- [ ] Add policy assertions that a `conversation` thread with `enterpriseSubjectId` receives only the knowledge tool.
- [ ] Replace purpose-only knowledge checks with the enterprise subject marker while retaining legacy behavior.
- [ ] Run focused policy and run-manager tests.

### Task 5: End-to-end verification

- [ ] Run Web tests and typecheck.
- [ ] Run Daemon tests and typecheck.
- [ ] In the 9000 app, click `企业知识库` then `对话知识库`; confirm a new `知识库对话` appears under the default project and the standard conversation route opens.
- [ ] Run `git diff --check`.
