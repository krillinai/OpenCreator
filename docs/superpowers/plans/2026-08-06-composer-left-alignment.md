# Composer Left Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the Composer placeholder, add icon, and project folder icon to one shared left baseline.

**Architecture:** Keep the shared React markup unchanged and express the alignment in the shared Composer CSS. Introduce one Composer-local baseline variable, then compensate for each control's existing hit-area geometry while preserving control sizes and menu anchoring.

**Tech Stack:** React, CSS, Vitest, Testing Library

---

### Task 1: Add the CSS alignment contract

**Files:**
- Modify: `apps/web/src/styles/app-css.test.ts`
- Test: `apps/web/src/styles/app-css.test.ts`

- [ ] **Step 1: Write the failing test**

Add a visual-contract test that requires `.opencreator-composer` to declare `--composer-left-baseline`, and requires the textarea, first left action, and project context to derive their horizontal positions from it without reducing `.composer-icon-button` dimensions.

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @opencreator/web test -- src/styles/app-css.test.ts`

Expected: FAIL because `--composer-left-baseline` and its three consumers do not exist yet.

### Task 2: Implement the shared baseline

**Files:**
- Modify: `apps/web/src/styles/app.css`
- Test: `apps/web/src/styles/app-css.test.ts`

- [ ] **Step 1: Add the Composer-local baseline variable**

Declare a single variable on `.opencreator-composer` representing the content offset from the Composer border:

```css
--composer-left-baseline: 20px;
```

- [ ] **Step 2: Derive the three alignment anchors from the variable**

Keep the textarea text at the baseline, offset the first toolbar control so the centered add icon starts at the baseline, and adjust the project-context padding so the folder icon starts at the same baseline. Preserve the existing 38px icon-button hit area.

- [ ] **Step 3: Run the focused CSS test**

Run: `pnpm --filter @opencreator/web test -- src/styles/app-css.test.ts`

Expected: PASS with all CSS visual-contract tests green.

### Task 3: Verify shared Composer behavior

**Files:**
- Test: `apps/web/src/features/runs/Composer.test.tsx`
- Test: `apps/web/src/features/knowledge/KnowledgeConversation.test.tsx`

- [ ] **Step 1: Run shared Composer tests and typecheck**

Run:

```bash
pnpm --filter @opencreator/web test -- src/features/runs/Composer.test.tsx src/features/knowledge/KnowledgeConversation.test.tsx src/styles/app-css.test.ts
pnpm --filter @opencreator/web typecheck
```

Expected: all focused tests pass and TypeScript exits with code 0.

- [ ] **Step 2: Measure the normal conversation alignment**

At `http://127.0.0.1:9000/`, measure the textarea content start (`textarea.left + padding-left`), the add button SVG left edge, and the project button's first SVG left edge. Expected: all three x coordinates are equal within 1 CSS pixel.

- [ ] **Step 3: Measure the knowledge conversation alignment**

Open `企业知识库` and enter `对话知识库`. Measure the textarea content start and add icon left edge. Expected: both coordinates are equal within 1 CSS pixel; project selection remains absent as designed for project-independent knowledge chat.

- [ ] **Step 4: Check the diff**

Run: `git diff --check`

Expected: no whitespace errors.
