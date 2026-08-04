# KrillinAI Brand Replacement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every Coca-Cola brand reference in the current Clawee customization with a local, theme-compatible KrillinAI mark and name.

**Architecture:** Keep the replacement entirely in the shared `apps/web` frontend. Add one transparent monochrome SVG asset, point the existing sidebar brand lockup at it, and update the static shared-drive fixture without adding platform branches or remote asset dependencies.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, Testing Library, SVG

---

## File Map

- Create `apps/web/public/krillinai-mark.svg`: transparent monochrome KrillinAI mark derived from the user-provided artwork.
- Modify `apps/web/src/features/shell/ClaweeSidebar.tsx`: replace Coca-Cola name, image source, and alternative text.
- Modify `apps/web/src/features/shell/ClaweeSidebar.test.tsx`: assert the KrillinAI expanded and collapsed brand states.
- Modify `apps/web/src/styles/app.css`: preserve current dimensions and invert the monochrome mark in dark mode.
- Modify `apps/web/src/features/drive/SharedDrivePage.tsx`: rename the static brand-guideline example.
- Modify `apps/web/src/features/drive/SharedDrivePage.test.tsx`: cover the new name and absence of the old one.
- Delete `apps/web/public/coca-cola-mark.svg`: remove the obsolete untracked asset after all references are gone.

### Task 1: Lock the expected KrillinAI text behavior with tests

**Files:**
- Modify: `apps/web/src/features/shell/ClaweeSidebar.test.tsx`
- Modify: `apps/web/src/features/drive/SharedDrivePage.test.tsx`

- [ ] **Step 1: Update the sidebar assertions before implementation**

Replace the expanded-state assertions with:

```tsx
expect(screen.getByText('KrillinAI')).toHaveClass('sidebar-brand-partner');
expect(screen.queryByText('Coca-Cola')).not.toBeInTheDocument();
expect(screen.getByText('KrillinAI').nextElementSibling)
  .toContainElement(screen.getByText('Clawee'));
```

Replace the collapsed-state image assertion with:

```tsx
expect(screen.getByRole('img', { name: 'KrillinAI' }))
  .toHaveAttribute('src', '/krillinai-mark.svg');
```

- [ ] **Step 2: Add the shared-drive brand fixture assertion**

At the start of the existing search test, add:

```tsx
expect(screen.getByText('KrillinAI 品牌视觉规范 2026.pdf')).toBeInTheDocument();
expect(screen.queryByText('可口可乐品牌视觉规范 2026.pdf')).not.toBeInTheDocument();
```

- [ ] **Step 3: Run focused tests and confirm the expected failure**

Run:

```bash
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" pnpm --filter @clawee/web test -- src/features/shell/ClaweeSidebar.test.tsx src/features/drive/SharedDrivePage.test.tsx
```

Expected: failures show that `Coca-Cola`, `/coca-cola-mark.svg`, and the old shared-drive filename still exist.

### Task 2: Replace the brand asset and references

**Files:**
- Create: `apps/web/public/krillinai-mark.svg`
- Modify: `apps/web/src/features/shell/ClaweeSidebar.tsx`
- Modify: `apps/web/src/styles/app.css`
- Modify: `apps/web/src/features/drive/SharedDrivePage.tsx`
- Delete: `apps/web/public/coca-cola-mark.svg`

- [ ] **Step 1: Add the transparent local SVG**

Create an SVG with a `750 750` view box and the three black geometric strokes and dot from the supplied logo. The SVG must have no background rectangle and must use `fill="currentColor"` only if embedded inline; for an `<img>`, use black path fills so CSS `filter` can invert the complete asset in dark mode.

- [ ] **Step 2: Replace sidebar branding**

Use the new asset and name:

```tsx
<img
  className="sidebar-logo-image sidebar-logo-mark"
  src="/krillinai-mark.svg"
  alt="KrillinAI"
/>
```

```tsx
<span className="sidebar-brand-partner">KrillinAI</span>
```

- [ ] **Step 3: Add theme adaptation without layout changes**

Keep `.sidebar-logo-mark` at `28px` square and add:

```css
:root[data-theme="dark"] .sidebar-logo-mark {
  filter: invert(1);
}
```

- [ ] **Step 4: Rename the shared-drive fixture and remove the old asset**

Change the file name to:

```ts
name: 'KrillinAI 品牌视觉规范 2026.pdf'
```

Remove `apps/web/public/coca-cola-mark.svg` after `rg -n "Coca-Cola|可口可乐|coca-cola-mark" apps/web` returns only intentional negative test assertions.

- [ ] **Step 5: Run focused verification**

Run:

```bash
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" pnpm --filter @clawee/web test -- src/features/shell/ClaweeSidebar.test.tsx src/features/drive/SharedDrivePage.test.tsx
PATH="$HOME/.nvm/versions/node/v22.22.0/bin:$PATH" pnpm --filter @clawee/web typecheck
git diff --check
```

Expected: both test files pass, type checking succeeds, and the diff has no whitespace errors.

- [ ] **Step 6: Visually verify the shared Web implementation**

At the running Web URL, inspect expanded and collapsed sidebars in light and dark themes. Confirm that the logo is visible, has no white square, stays within the fixed 28px box, and that the shared-drive row uses the KrillinAI filename. Because Desktop consumes the same Web source, retain the actual packaged App verification as a release gate.

No implementation commit is included in this plan because the relevant component, CSS, tests, and shared-drive files already contain overlapping user changes. Leave the focused changes in the working tree for user review rather than committing unrelated work.
