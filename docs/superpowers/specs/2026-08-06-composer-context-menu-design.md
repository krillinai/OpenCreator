# Composer Context Menu Design

## Goal

Extend the Composer's add-context menu so users can add files, invoke installed skills, and select configured connectors without leaving the conversation. The interaction should match the supplied reference: a compact first-level menu with a neighboring second-level panel.

## Scope

- Rename the visible action from `添加图片` to `添加文件`.
- Add `技能` and `连接器` entries to the first-level menu.
- Show a second-level panel for the active entry.
- Reuse the existing Composer capability data and invocation syntax.
- Keep the shared Web implementation as the only UI implementation used by Web and Desktop.

This change does not expand attachment MIME support. `添加文件` continues to use the current image attachment pipeline and remains disabled when attachments are unavailable, including knowledge conversations.

## Interaction

The plus button opens a compact menu containing:

1. `添加文件`
2. `技能` with a submenu indicator
3. `连接器` with a submenu indicator

Clicking or hovering `技能` or `连接器` opens the corresponding panel next to the first-level menu. The active row uses the existing menu selection background. The panel remains open while the pointer moves between the two surfaces. Viewport positioning reuses the Composer popover positioning behavior so the submenu can move left or upward when space is constrained.

The skills panel contains a search input, valid installed skills with their descriptions, and a `管理技能` footer action. Selecting a skill applies its existing Composer command, such as `$skill-id `, and returns focus to the prompt.

The connectors panel lists configured MCP servers and their status, followed by a `管理连接器` footer action. Selecting a connector inserts the existing MCP invocation prompt for that server and returns focus to the prompt.

Empty, loading, and error states remain inside the second-level panel rather than resizing the first-level menu.

## Architecture

`Composer` remains the owner of menu state, keyboard/pointer behavior, command insertion, and positioning. Its existing `ComposerSlashCommand` model is the shared invocation representation for both slash selection and submenu selection.

`AppController` builds Composer commands from the already loaded capability responses:

- Valid Codex skills become `skill` commands.
- Configured MCP servers become `mcp` commands.

No new Runtime endpoints or duplicate capability stores are introduced. Navigation callbacks open the existing skill market and connector management routes. Knowledge conversations continue to reuse `Composer`; unavailable capability or attachment actions must be honestly disabled or omitted rather than supplied as no-op callbacks.

## Accessibility

- The plus surface remains a `menu` with `menuitem` children.
- Submenu triggers expose `aria-haspopup="menu"` and `aria-expanded`.
- The secondary panel has an accessible name identifying skills or connectors.
- Search has an explicit accessible label.
- Escape closes the submenu first, then the parent menu.
- Selecting an invocation restores focus to the prompt.

## Tests

Composer unit tests cover:

- The renamed `添加文件` action.
- Opening skill and connector submenus.
- Filtering skills by search text.
- Inserting the selected skill or connector command.
- Management callbacks.
- Disabled attachment behavior.
- Closing and focus behavior.

App-level tests cover capability mapping and navigation to existing management pages. Type checking and focused Web tests are required. Because this changes shared Web UI, Web/Desktop consistency tests and packaged Desktop verification remain release gates; if they cannot be run locally, that limitation must be reported.
