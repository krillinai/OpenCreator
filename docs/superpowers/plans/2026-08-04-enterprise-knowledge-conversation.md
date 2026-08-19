# Enterprise Knowledge Conversation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the enterprise knowledge document browser with a static, permission-aware knowledge conversation dashboard.

**Architecture:** Keep the feature entirely in the shared `apps/web` frontend. A pure knowledge model owns demo identities, accessible scopes, keyword answer matching, and permission filtering; `KnowledgePage` owns only role selection, local conversation state, and rendering. No route, Runtime, Host Bridge, or Desktop-specific behavior changes.

**Tech Stack:** React 19, TypeScript, Lucide React, Vitest, Testing Library, CSS.

---

### Task 1: Permission-aware static knowledge model

**Files:**
- Modify: `apps/web/src/features/knowledge/knowledge-model.ts`
- Modify: `apps/web/src/features/knowledge/knowledge-model.test.ts`

- [ ] **Step 1: Replace document-search tests with failing permission and answer tests**

```ts
import { describe, expect, it } from 'vitest';
import {
  createKnowledgeAnswer,
  getAccessibleKnowledgeScopes,
  knowledgeProfiles,
  knowledgeScopes
} from './knowledge-model.js';

describe('enterprise knowledge conversation fixtures', () => {
  it('filters knowledge scopes by the active identity', () => {
    expect(getAccessibleKnowledgeScopes('employee').map(scope => scope.id)).toEqual([
      'scope-company-policy',
      'scope-product',
      'scope-customer-success'
    ]);
    expect(getAccessibleKnowledgeScopes('admin')).toHaveLength(knowledgeScopes.length);
  });

  it('does not disclose restricted knowledge in employee answers', () => {
    const answer = createKnowledgeAnswer('employee', 'Runtime 和 Desktop 如何通信？');
    expect(answer.text).toContain('当前权限范围内');
    expect(answer.text).not.toContain('研发文档');
    expect(answer.evidence).toEqual([]);
  });

  it('returns permission-filtered evidence for matched answers', () => {
    const employeeAnswer = createKnowledgeAnswer('employee', '客户退款需要谁审批？');
    expect(employeeAnswer.text).toContain('客户成功负责人');
    expect(employeeAnswer.evidence).toEqual([
      { scopeId: 'scope-customer-success', label: '客户成功知识域', count: 2 }
    ]);

    const adminAnswer = createKnowledgeAnswer('admin', 'Runtime 和 Desktop 如何通信？');
    expect(adminAnswer.evidence[0]?.scopeId).toBe('scope-engineering');
  });

  it('uses stable profile and scope identifiers', () => {
    expect(knowledgeProfiles.map(profile => profile.id)).toEqual(['employee', 'admin']);
    expect(new Set(knowledgeScopes.map(scope => scope.id)).size).toBe(knowledgeScopes.length);
  });
});
```

- [ ] **Step 2: Run the model test and verify it fails**

Run: `pnpm --filter @opencreator/web test -- src/features/knowledge/knowledge-model.test.ts`

Expected: FAIL because `createKnowledgeAnswer`, `getAccessibleKnowledgeScopes`, `knowledgeProfiles`, and `knowledgeScopes` do not exist.

- [ ] **Step 3: Implement the static identities, scopes, and permission-filtered answer rules**

```ts
export type KnowledgeRole = 'employee' | 'admin';
export type KnowledgeAccessLevel = 'organization' | 'team' | 'restricted';

export type KnowledgeProfile = {
  id: KnowledgeRole;
  name: string;
  roleLabel: string;
  department: string;
  accessibleScopeIds: string[];
};

export type KnowledgeScope = {
  id: string;
  name: string;
  summary: string;
  accessLevel: KnowledgeAccessLevel;
  itemCount: number;
  suggestions: string[];
};

export type KnowledgeEvidence = {
  scopeId: string;
  label: string;
  count: number;
};

export type KnowledgeAnswer = {
  text: string;
  evidence: KnowledgeEvidence[];
};

export const knowledgeProfiles: KnowledgeProfile[] = [
  {
    id: 'employee',
    name: '小林',
    roleLabel: '员工',
    department: '客户成功',
    accessibleScopeIds: ['scope-company-policy', 'scope-product', 'scope-customer-success']
  },
  {
    id: 'admin',
    name: '企业管理员',
    roleLabel: '管理员',
    department: '企业管理',
    accessibleScopeIds: [
      'scope-company-policy',
      'scope-product',
      'scope-customer-success',
      'scope-engineering'
    ]
  }
];

export const knowledgeScopes: KnowledgeScope[] = [
  {
    id: 'scope-company-policy',
    name: '公司制度',
    summary: '差旅、报销与人事制度',
    accessLevel: 'organization',
    itemCount: 18,
    suggestions: ['出差住宿标准是多少？', '报销需要在多久内提交？']
  },
  {
    id: 'scope-product',
    name: '产品资料',
    summary: '产品能力、部署与安全边界',
    accessLevel: 'organization',
    itemCount: 12,
    suggestions: ['OpenCreator 企业版包含哪些能力？']
  },
  {
    id: 'scope-customer-success',
    name: '客户成功',
    summary: '客户上线、退款与服务流程',
    accessLevel: 'team',
    itemCount: 24,
    suggestions: ['客户退款需要谁审批？', '企业客户上线前要完成什么？']
  },
  {
    id: 'scope-engineering',
    name: '研发知识',
    summary: 'Runtime、Daemon 与发布门禁',
    accessLevel: 'restricted',
    itemCount: 31,
    suggestions: ['Runtime 和 Desktop 如何通信？']
  }
];

export function getKnowledgeProfile(role: KnowledgeRole): KnowledgeProfile {
  return knowledgeProfiles.find(profile => profile.id === role)!;
}

export function getAccessibleKnowledgeScopes(role: KnowledgeRole): KnowledgeScope[] {
  const allowed = new Set(getKnowledgeProfile(role).accessibleScopeIds);
  return knowledgeScopes.filter(scope => allowed.has(scope.id));
}

export function getKnowledgeSuggestions(role: KnowledgeRole): string[] {
  return getAccessibleKnowledgeScopes(role).flatMap(scope => scope.suggestions).slice(0, 4);
}

export function createKnowledgeAnswer(role: KnowledgeRole, question: string): KnowledgeAnswer {
  // Match ordered rules only after confirming that the rule's scope is accessible.
  // Return a generic permission-safe fallback without naming inaccessible scopes.
}
```

Implement ordered rules for refund/customer onboarding, travel/reimbursement, product/OpenCreator, and Runtime/Desktop/release. Each rule includes `scopeId`, keywords, answer text, and evidence count. Filter the matching rules by `accessibleScopeIds` before matching keywords.

- [ ] **Step 4: Run the model test and verify it passes**

Run: `pnpm --filter @opencreator/web test -- src/features/knowledge/knowledge-model.test.ts`

Expected: PASS with four tests.

- [ ] **Step 5: Commit the model change**

```bash
git add apps/web/src/features/knowledge/knowledge-model.ts apps/web/src/features/knowledge/knowledge-model.test.ts
git diff --cached --check
git commit -m "feat(web): model permission-aware knowledge answers"
```

### Task 2: Conversation-first knowledge page

**Files:**
- Modify: `apps/web/src/features/knowledge/KnowledgePage.tsx`
- Modify: `apps/web/src/features/knowledge/KnowledgePage.test.tsx`

- [ ] **Step 1: Write failing component tests for conversation and permissions**

Replace document-list expectations with tests that assert:

```ts
it('renders a conversation dashboard without document browsing controls', () => {
  render(<KnowledgePage />);
  expect(screen.getByRole('heading', { name: '企业知识库' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: '询问企业知识' })).toBeInTheDocument();
  expect(screen.getByText('小林')).toBeInTheDocument();
  expect(screen.getByText('公司制度')).toBeInTheDocument();
  expect(screen.getByText('客户成功')).toBeInTheDocument();
  expect(screen.queryByText('研发知识')).not.toBeInTheDocument();
  expect(screen.queryByRole('list', { name: '知识文档' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('sends a question and renders non-interactive evidence', async () => {
  const user = userEvent.setup();
  render(<KnowledgePage />);
  await user.type(screen.getByRole('textbox', { name: '询问企业知识' }), '客户退款需要谁审批？');
  await user.click(screen.getByRole('button', { name: '发送' }));
  expect(screen.getByText('客户退款需要谁审批？')).toBeInTheDocument();
  expect(screen.getByText(/客户成功负责人/)).toBeInTheDocument();
  expect(screen.getByText('客户成功知识域 · 2 条依据')).toBeInTheDocument();
  expect(screen.getByText('客户成功知识域 · 2 条依据')).not.toHaveProperty('tagName', 'A');
});

it('switches identities and clears answers that could exceed the new permission scope', async () => {
  const user = userEvent.setup();
  render(<KnowledgePage />);
  await user.click(screen.getByRole('button', { name: '管理员视图' }));
  expect(screen.getByText('研发知识')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Runtime 和 Desktop 如何通信？' }));
  expect(screen.getByText('研发知识域 · 2 条依据')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '员工视图' }));
  expect(screen.queryByText('研发知识')).not.toBeInTheDocument();
  expect(screen.queryByText('研发知识域 · 2 条依据')).not.toBeInTheDocument();
});
```

Also test that the send button is disabled for whitespace-only input and that pressing Enter submits while Shift+Enter does not.

- [ ] **Step 2: Run the page test and verify it fails**

Run: `pnpm --filter @opencreator/web test -- src/features/knowledge/KnowledgePage.test.tsx`

Expected: FAIL because the current page renders document search, list, and details instead of a conversation composer.

- [ ] **Step 3: Implement the conversation page**

Use local state with this message shape:

```ts
type KnowledgeMessage = {
  id: string;
  role: 'assistant' | 'user';
  text: string;
  evidence?: KnowledgeEvidence[];
};
```

Build `KnowledgePage` with:

- `role` state defaulting to `'employee'`.
- `messages` initialized from a role-specific welcome message.
- `draft` state for the textarea.
- `sendQuestion(question)` that trims input, appends a user message and `createKnowledgeAnswer(role, question)`, then clears the draft.
- A segmented control with `aria-pressed` buttons for employee/admin.
- A conversation region with `aria-label="知识对话"`.
- Suggestion buttons from `getKnowledgeSuggestions(role)`.
- A `<form>` containing `<textarea aria-label="询问企业知识">` and an icon button with `aria-label="发送"`.
- `onKeyDown` behavior that sends on Enter without Shift and leaves Shift+Enter to create a newline.
- A permission aside with `aria-label="当前知识权限"` that maps only `getAccessibleKnowledgeScopes(role)`.
- Evidence rendered as `<span>` elements, never anchors or buttons.

When the role changes, replace the message list with the new role's welcome message and clear the draft.

- [ ] **Step 4: Run the page and model tests**

Run: `pnpm --filter @opencreator/web test -- src/features/knowledge/KnowledgePage.test.tsx src/features/knowledge/knowledge-model.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the component behavior**

```bash
git add apps/web/src/features/knowledge/KnowledgePage.tsx apps/web/src/features/knowledge/KnowledgePage.test.tsx
git diff --cached --check
git commit -m "feat(web): make enterprise knowledge conversational"
```

### Task 3: Conversation dashboard styling

**Files:**
- Modify: `apps/web/src/features/knowledge/knowledge.css`

- [ ] **Step 1: Replace document-browser selectors with conversation layout selectors**

Implement these layout responsibilities:

```css
.knowledge-page__inner {
  width: min(1180px, 100%);
  min-height: 100%;
  margin: 0 auto;
  padding: 28px clamp(18px, 2.4vw, 32px) 36px;
}

.knowledge-dashboard {
  min-height: 620px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 270px;
  gap: 18px;
}

.knowledge-conversation {
  min-width: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  overflow: hidden;
}

.knowledge-composer {
  margin: 12px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 36px;
  align-items: end;
  gap: 8px;
  border: 1px solid var(--border-strong);
  border-radius: 8px;
  background: var(--surface-2);
}

.knowledge-permissions {
  align-self: start;
  border-left: 1px solid var(--border);
  padding-left: 18px;
}

@media (max-width: 820px) {
  .knowledge-dashboard { grid-template-columns: 1fr; }
  .knowledge-permissions {
    grid-row: 1;
    border-left: 0;
    border-bottom: 1px solid var(--border);
    padding: 0 0 14px;
  }
}
```

Add focused styles for header controls, welcome state, suggestion chips, user/assistant messages, non-clickable evidence labels, stable 36px send button, accessible focus outlines, textarea growth limits, and mobile spacing. Do not add document-card or nested-card styling.

- [ ] **Step 2: Run knowledge tests and typecheck**

Run: `pnpm --filter @opencreator/web test -- src/features/knowledge/KnowledgePage.test.tsx src/features/knowledge/knowledge-model.test.ts`

Run: `pnpm --filter @opencreator/web typecheck`

Expected: all tests and TypeScript checks PASS.

- [ ] **Step 3: Commit the styling**

```bash
git add apps/web/src/features/knowledge/knowledge.css
git diff --cached --check
git commit -m "style(web): focus knowledge page on conversation"
```

### Task 4: Shared app regression verification

**Files:**
- Verify: `apps/web/src/app/App.test.tsx`
- Verify: `apps/web/src/features/shell/OpenCreatorSidebar.test.tsx`
- Verify: `apps/web/src/app/routes.test.ts`

- [ ] **Step 1: Run focused routing and navigation tests**

Run:

```bash
pnpm --filter @opencreator/web test -- \
  src/app/routes.test.ts \
  src/features/shell/OpenCreatorSidebar.test.tsx \
  src/app/App.test.tsx \
  -t "knowledge|企业知识库"
```

Expected: knowledge route parsing, sidebar selection, and direct/history navigation tests PASS.

- [ ] **Step 2: Run all directly affected tests**

Run:

```bash
pnpm --filter @opencreator/web test -- \
  src/features/knowledge/knowledge-model.test.ts \
  src/features/knowledge/KnowledgePage.test.tsx \
  src/features/shell/OpenCreatorSidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run static checks**

Run: `pnpm --filter @opencreator/web typecheck`

Run: `git diff --check`

Expected: both commands exit zero.

- [ ] **Step 4: Inspect residual risk**

Confirm no `KnowledgePage` production markup contains `知识文档`, `打开文档`, `<a>`, or a document selection handler. Confirm `apps/web` remains the only implementation and no Desktop-specific file changed.
