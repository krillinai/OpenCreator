# Project-Backed Knowledge Conversation Design

## Goal

Clicking `对话知识库` creates a new conversation in the default project and immediately opens the standard conversation page. The conversation appears under the default project and retains enterprise knowledge search capability.

## Thread Model

New knowledge conversations are standard `conversation` threads with:

- `projectId` set to the ensured default project.
- `cwd` and `canonicalCwd` inherited from that project.
- `enterpriseSubjectId` set to the signed-in enterprise identity.
- Title `知识库对话`.

`enterpriseSubjectId`, rather than `purpose`, is the durable marker that activates knowledge isolation and search injection. Existing legacy `knowledge_conversation` threads continue to work because they already carry `enterpriseSubjectId`.

## Interaction

`KnowledgePage` no longer owns a list/conversation toggle or renders an independent conversation workspace. Its header button calls `onStartConversation`.

`AppController` ensures the default project, asks the dedicated knowledge endpoint to create the project-backed thread, inserts it into the normal thread store, selects the default project and new thread, then navigates to the standard thread route.

The normal Composer, timeline, history, sidebar selection, attachments, skills, MCP commands, and project conversation behavior are reused without a second UI implementation.

## Runtime Safety

The Daemon continues creating knowledge threads through the authenticated enterprise endpoint. Knowledge ownership checks use the enterprise subject marker. Run injection, isolated Codex home behavior, knowledge approval handling, and automatic rotation identify knowledge threads by `enterpriseSubjectId` so project-backed threads retain the same tool isolation.

## Compatibility

Legacy account-scoped knowledge threads remain readable through the existing enterprise endpoints. New project-backed knowledge threads are also visible through standard conversation endpoints and project listings.

## Verification

- Component test: `对话知识库` calls the creation callback and does not reveal the old split workspace.
- App test: clicking the entry ensures the default project, creates a knowledge thread with that project id, selects it, and navigates to the standard conversation.
- Daemon tests: knowledge thread creation uses the project directory and `conversation` purpose while retaining the enterprise subject marker.
- Policy tests: knowledge tool injection is activated by the enterprise subject marker.
- Run relevant Web and Daemon tests plus both typechecks.
- Verify the flow in the running 9000 app.

Actual packaged Desktop E2E and embedded Web asset hash verification remain required release gates.
