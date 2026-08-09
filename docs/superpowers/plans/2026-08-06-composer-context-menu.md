# Composer Context Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file, skill, and connector choices to the shared Composer plus menu, with reference-style adjacent submenus backed by existing capability data.

**Architecture:** `Composer` will render and control the nested menu using its existing `ComposerSlashCommand` inputs, so slash commands and plus-menu choices share one insertion path. `AppController` will extend command construction to include configured MCP servers and pass navigation callbacks for the existing management pages. No Runtime or Desktop-specific UI implementation is added.

**Tech Stack:** React 18, TypeScript, lucide-react, Vitest, Testing Library, CSS.

---

### Task 1: Composer Nested Menu Behavior

**Files:**
- Modify: `apps/web/src/features/runs/Composer.tsx`
- Test: `apps/web/src/features/runs/Composer.test.tsx`

- [ ] **Step 1: Write failing tests for menu labels and submenus**

Update the existing add-context test to expect `添加文件`, `技能`, and `连接器`. Supply one `skill` and one `mcp` command, click each trigger, and assert that the adjacent menu exposes only commands from the selected category.

```tsx
await user.click(screen.getByRole('button', { name: '添加上下文' }));
expect(screen.getByRole('menuitem', { name: '添加文件' })).toBeInTheDocument();
await user.click(screen.getByRole('menuitem', { name: '技能' }));
expect(screen.getByRole('menu', { name: '技能' })).toBeInTheDocument();
expect(screen.getByRole('menuitem', { name: /brainstorming/ })).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `pnpm --filter @clawee/web test -- src/features/runs/Composer.test.tsx`

Expected: FAIL because the current menu still renders only `添加图片` and has no category submenus.

- [ ] **Step 3: Add nested menu state and rendering**

Extend Composer state with an active add category and optional search query. Render first-level rows using `Paperclip`, `Zap`, `Link`, and `ChevronRight`. Filter `props.slashCommands` by `skill` or `mcp`; render the active category in a sibling `.composer-add-submenu` and apply selection through a new helper that accepts a command directly rather than requiring a slash trigger.

```ts
type AddSubmenu = 'skill' | 'mcp' | null;
const [addSubmenu, setAddSubmenu] = useState<AddSubmenu>(null);
const addCommands = slashCommands.filter(command => command.category === addSubmenu);
```

The direct insertion path appends the command at the current textarea selection and restores textarea focus. Slash-trigger insertion continues to replace its slash query.

- [ ] **Step 4: Add filtering, empty states, and management callbacks**

Add optional props:

```ts
onManageSkills?(): void;
onManageConnectors?(): void;
```

The skills submenu includes an accessible search field. Both categories show a stable empty state and a footer management action only when its callback exists. Escape closes the category panel before closing the parent menu.

- [ ] **Step 5: Run the focused Composer tests**

Run: `pnpm --filter @clawee/web test -- src/features/runs/Composer.test.tsx`

Expected: PASS.

### Task 2: Capability Mapping and Navigation

**Files:**
- Modify: `apps/web/src/app/AppController.tsx`
- Modify: `apps/web/src/features/knowledge/KnowledgeConversation.tsx`
- Test: `apps/web/src/app/App.test.tsx`
- Test: `apps/web/src/features/knowledge/KnowledgeConversation.test.tsx`

- [ ] **Step 1: Write a failing mapping/navigation test**

Return a configured MCP server from `/codex/mcp`, open the Composer add menu, open `连接器`, select the server, and assert that the prompt contains `使用 MCP：github `. Assert that `管理技能` navigates to `#/plugins` and `管理连接器` navigates to `#/connections`.

- [ ] **Step 2: Run focused app tests and verify RED**

Run: `pnpm --filter @clawee/web test -- src/app/App.test.tsx src/features/knowledge/KnowledgeConversation.test.tsx`

Expected: FAIL because MCP servers are not currently mapped to Composer commands and management callbacks are absent.

- [ ] **Step 3: Build shared capability commands**

Replace the skill-only builder with a builder that accepts skills and MCP data:

```ts
function buildComposerSlashCommands(
  skills: CodexSkillListResponse | undefined,
  mcp: CodexMcpListResponse | undefined
): ComposerSlashCommand[] {
  return [
    ...validSkillCommands,
    ...configuredMcpCommands
  ];
}
```

Each configured MCP server maps to category `mcp`, label `server.name`, a transport/status description, and insert text `使用 MCP：${server.name} `.

- [ ] **Step 4: Wire management routes and knowledge Composer data**

Pass normal Composer callbacks that call `navigateToRoute({ view: 'plugins' })` and `navigateToRoute({ view: 'connections' })`. Pass the same capability commands into `KnowledgeConversation`; omit attachment upload callbacks so its `添加文件` row remains honestly disabled.

- [ ] **Step 5: Run focused app and knowledge tests**

Run: `pnpm --filter @clawee/web test -- src/app/App.test.tsx src/features/knowledge/KnowledgeConversation.test.tsx`

Expected: PASS.

### Task 3: Reference-Style Layout and Verification

**Files:**
- Modify: `apps/web/src/styles/app.css`
- Test: `apps/web/src/styles/app-css.test.ts`

- [ ] **Step 1: Add a failing CSS contract test**

Assert that the submenu has a constrained width and height, scrollable command list, adjacent desktop positioning, mobile-safe viewport width, and a higher z-index than the right knowledge pane.

- [ ] **Step 2: Run the CSS test and verify RED**

Run: `pnpm --filter @clawee/web test -- src/styles/app-css.test.ts`

Expected: FAIL because `.composer-add-submenu` does not exist.

- [ ] **Step 3: Implement the nested menu styling**

Add `.composer-add-menu`, `.composer-add-submenu`, `.composer-add-search`, `.composer-add-command-list`, and `.composer-add-footer`. Keep card radius at 8px, use existing popover/border/surface tokens, use fixed responsive constraints, and place the second panel beside the first with a small gap. Add a narrow-viewport rule that keeps both panels inside the viewport.

- [ ] **Step 4: Run all focused tests and type checking**

Run:

```bash
pnpm --filter @clawee/web test -- src/features/runs/Composer.test.tsx src/features/knowledge/KnowledgeConversation.test.tsx src/styles/app-css.test.ts
pnpm --filter @clawee/web typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 5: Verify in the running Web app**

Start or reuse `pnpm web:dev`, open `http://127.0.0.1:9000/`, and verify the menu in a normal conversation and a knowledge conversation at desktop and mobile content widths. Confirm no clipping, overlap, layout shift, or inert visible entry.

- [ ] **Step 6: Record remaining Desktop gate status**

Run the repository's shared Web/Desktop consistency suite if available. Do not claim Desktop parity or release readiness unless the actual packaged App E2E and embedded Web hash checks pass; report any unavailable gate explicitly.
