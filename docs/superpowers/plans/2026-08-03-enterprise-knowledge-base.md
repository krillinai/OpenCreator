# Enterprise Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a static enterprise knowledge-base dashboard below Plugins in the shared OpenCreator sidebar.

**Architecture:** Define typed static fixtures in a focused model module and render them through one responsive shared Web page. Integrate a dedicated hash route and `ActiveView`, following the existing Activity page navigation pattern without adding services or platform branches.

**Tech Stack:** React, TypeScript, Vitest, Testing Library, CSS, Lucide icons.

---

### Task 1: Knowledge Model And Page

**Files:**
- Create: `apps/web/src/features/knowledge/knowledge-model.ts`
- Create: `apps/web/src/features/knowledge/knowledge-model.test.ts`
- Create: `apps/web/src/features/knowledge/KnowledgePage.tsx`
- Create: `apps/web/src/features/knowledge/KnowledgePage.test.tsx`
- Create: `apps/web/src/features/knowledge/knowledge.css`

- [ ] Write failing model tests for stable identifiers, valid categories, visibility, source, update and sync fields.
- [ ] Write failing component tests for static disclosure, metrics, combined search/filter, selection and empty results.
- [ ] Implement typed fixtures and query helper.
- [ ] Implement the responsive master-detail page with local-only interactions.
- [ ] Run `pnpm --filter @opencreator/web test -- src/features/knowledge` and expect all tests to pass.

### Task 2: Shared Navigation Integration

**Files:**
- Modify: `apps/web/src/app/app-state.ts`
- Modify: `apps/web/src/app/routes.ts`
- Modify: `apps/web/src/app/routes.test.ts`
- Modify: `apps/web/src/app/AppController.tsx`
- Modify: `apps/web/src/app/App.test.tsx`
- Modify: `apps/web/src/features/shell/OpenCreatorSidebar.tsx`
- Modify: `apps/web/src/features/shell/OpenCreatorSidebar.test.tsx`

- [ ] Add failing tests for `#/knowledge`, sidebar placement immediately below Plugins, selected state, refresh and history restoration.
- [ ] Add the `knowledge` route and active view.
- [ ] Lazy-load the shared page and connect navigation/history state.
- [ ] Add the sidebar action with a Lucide library icon.
- [ ] Run focused route, sidebar and App tests and expect all to pass.

### Task 3: Verification

**Files:**
- Verify all files changed by Tasks 1 and 2.

- [ ] Run `pnpm --filter @opencreator/web test` and expect zero failures.
- [ ] Run `pnpm --filter @opencreator/web typecheck` and expect zero errors.
- [ ] Run `pnpm --filter @opencreator/web build` and expect a successful production build.
- [ ] Start the built Web preview and capture 1440x900 and 390x844 screenshots of `#/knowledge`.
- [ ] Confirm no overlap, clipped controls, fake platform action, API request or platform branch.

