# Sidebar Conversation Actions Design

## Goal

Make project conversation rows support the compact actions shown in the provided references while keeping all state consistent across Web and Desktop.

## Interaction

Each expanded project conversation row keeps its title and relative update time at rest. Hover or keyboard focus replaces the time with three icon buttons in this order:

1. More
2. Archive
3. Pin or unpin

The buttons have tooltips and accessible labels. On touch devices they remain available without relying on hover. A running conversation disables archive and permanent deletion until the active Run reaches a terminal state.

More opens a compact menu anchored to the row. The menu contains Rename and Delete Task. It closes on outside pointer input, Escape, selecting an action, route changes, or opening another row menu.

Rename replaces the row title with a focused single-line input. Enter or blur saves a trimmed non-empty title. Escape restores the previous title. A failed save restores the editable state and exposes an actionable error without losing the typed value.

Delete Task opens a destructive confirmation dialog. The dialog states that the conversation and its history will be permanently deleted and cannot be restored, while files in the project directory will not be deleted. Confirmation is disabled while the request is running.

Pin toggles immediately through the Runtime. Pinned conversations appear before unpinned conversations within the same project. Each group remains ordered by most recent update. The pin action remains visible while pinned so it can be undone.

## Runtime Contract

Thread state gains an optional persisted `pinnedAt` timestamp. The existing Thread update endpoint accepts title changes and a pin toggle represented by `pinned: boolean`; the Daemon assigns or clears `pinnedAt` rather than trusting a client timestamp.

A new permanent-delete endpoint removes an eligible conversation Thread and all Runtime-owned dependent records, including Runs, events, approvals, attachments or context references, and Thread-owned Runtime session artifacts. It must not remove any user project file or project directory.

Permanent deletion is rejected when:

- the Thread does not exist;
- the Thread is managed by a schedule;
- the Thread has an active or queued Run;
- referential cleanup cannot complete atomically.

Knowledge-policy conversations are ordinary project-backed conversation Threads and use the same rename, pin, archive, and delete contracts. The policy marker does not create a separate UI or data path.

## Web State

`ClaweeConversation` carries persisted pin state. `AppController` owns Runtime mutations and updates `runtimeThreads` only from successful responses. Deleting the selected conversation navigates to the normal new-conversation state and clears its cached timeline. Renaming or pinning never changes the selected route.

`ClaweeSidebar` owns transient presentation state only: open menu, rename draft, pending confirmation, and busy action IDs. It receives mutation callbacks from `AppController` and does not store durable pin or title state locally.

## Accessibility

The action cluster is keyboard reachable. The popup uses menu semantics, the rename input has a conversation-specific accessible label, and destructive confirmation uses the shared alert dialog. Focus returns to the relevant row action after canceling a menu or dialog when the element still exists.

## Verification

Tests cover:

- row action visibility and ordering;
- menu open, outside click, Escape, and single-menu behavior;
- rename save, cancel, empty input, and request failure;
- archive confirmation and running-state protection;
- pin persistence and project-local sorting;
- permanent-delete confirmation, active-Run rejection, database cascade, and preservation of project files;
- selected conversation cleanup after deletion;
- Browser Bridge and Desktop Bridge rendering the same controls and invoking the same Runtime endpoints.

Because the shared Web frontend is used by Desktop, no host-kind branch or Desktop-specific conversation action implementation is introduced.
