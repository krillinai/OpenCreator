# Composer Dark Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate the dark-mode Composer input surface, project footer, border, and page background without changing layout or light mode.

**Architecture:** Keep all changes in the shared Composer CSS. Define Composer-local dark color variables, consume them in the existing container and pseudo-element structure, and preserve the explicit light-theme overrides.

**Tech Stack:** CSS, Vitest, React

---

### Task 1: Add failing dark-surface contracts

**Files:**
- Modify: `apps/web/src/styles/app-css.test.ts`

- [ ] Add assertions requiring `.opencreator-composer` to define `--composer-input-background: #1a1b1e`, `--composer-project-background: #232427`, `--composer-border: rgba(245, 245, 246, 0.12)`, and `--composer-separator: rgba(245, 245, 246, 0.06)`.
- [ ] Assert that the container border uses `--composer-border`, the input pseudo-element uses `--composer-input-background`, and the project footer uses `--composer-separator` as its top border.
- [ ] Run `pnpm --filter @opencreator/web test -- src/styles/app-css.test.ts` and confirm it fails because the new variables are absent.

### Task 2: Implement the dark surfaces

**Files:**
- Modify: `apps/web/src/styles/app.css`
- Test: `apps/web/src/styles/app-css.test.ts`

- [ ] Add the four Composer-local variables to `.opencreator-composer`.
- [ ] Change the outer border to `var(--composer-border)` and the input pseudo-element to `var(--composer-input-background)`.
- [ ] Give `.composer-project-context` a `1px solid var(--composer-separator)` top border and retain its existing background source.
- [ ] Keep the light-theme Composer variables mapped to the existing light surfaces and border values.
- [ ] Run `pnpm --filter @opencreator/web test -- src/styles/app-css.test.ts` and confirm all CSS contracts pass.

### Task 3: Verify shared rendering

**Files:**
- Test: `apps/web/src/features/runs/Composer.test.tsx`
- Test: `apps/web/src/features/knowledge/KnowledgeConversation.test.tsx`

- [ ] Run the focused component tests and Web typecheck.
- [ ] Inspect the normal dark-mode Composer at `http://127.0.0.1:9000/` and confirm the computed page, input, footer, border, and separator colors.
- [ ] Inspect knowledge conversation and confirm it uses the same input surface without a project footer.
- [ ] Run `git diff --check` and confirm no whitespace errors.
