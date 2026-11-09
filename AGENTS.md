# OpenCreator Project Agent Rules

## Language Requirements for Git Commit Messages and Release Materials

- Mandatory: All Git commit messages in this project must be in English, including subjects, bodies, and messages produced by merge, squash, revert, and similar operations.
- GitHub Release titles and complete bodies, release notes files, and annotated tag messages must also be in English, including feature updates and download and installation instructions. Chinese and mixed Chinese-English text are prohibited.
- These English requirements for Git commit messages and Release materials take precedence over the global rule that responses and documents must be in Chinese. Responses and other project documents must remain in Chinese.
- Before committing, review the complete message to be used. Accurately translate any Chinese descriptions into English before committing. Do not translate only the subject while leaving the body in Chinese.
- During merges, rebases, cherry-picks, or reverts, inspect automatically generated commit messages to avoid reintroducing Chinese descriptions.
- After committing, verify the complete message with `git log -1 --format=%B`. Before pushing, inspect the subjects and bodies of all commits to be pushed. Do not push if any contain Chinese descriptions.

## Mandatory Rules for Execution Efficiency and Minimum Sufficient Validation

### General Principles

- Mandatory: Match validation scope to the risk and actual impact of the change. Do not automatically escalate small, local, low-risk changes to full test suites, complete builds, service restarts, end-to-end tests, or Desktop packaging.
- Mandatory: First locate and modify the smallest relevant area of code, then run the minimum set of checks that can establish the correctness of the change. Expand validation incrementally only when results reveal a broader impact.
- Mandatory: Do not expand the current task because the repository has unrelated historical failures, a dirty working tree, or problems in other modules. Record unrelated issues without investigating or fixing them as part of the current task.
- When the user explicitly requests complete testing, builds, packaging, publishing, or cross-platform parity validation, follow that request rather than the default tiers below.

### Risk Tiers

- P0, low risk: Copy, minor style adjustments, defaults, local visibility conditions, test assertions, and other changes that do not alter Runtime/API/persistence contracts.
  - By default, run only relevant file checks and the closest targeted tests. Run the corresponding package's `typecheck` for TypeScript code as needed.
  - By default, do not run full test suites, production builds, end-to-end tests, Desktop packaging, or service restarts.
- P1, medium risk: Changes to shared state, business logic, persistence behavior, interactions between components, Runtime request parameters, or shared components.
  - Run targeted tests for the affected modules and the corresponding package's `typecheck`.
  - Run a production build only when compilation boundaries, lazy loading, generated assets, or build configuration are involved.
  - Add browser validation only when targeted tests cannot adequately cover the actual interaction.
- P2, high risk: Changes to Daemon/Runtime, protocols, database migrations, process management, service configuration, builds and packaging, release workflows, or explicitly targeted Web/Desktop parity.
  - Run relevant integration tests, builds, service restarts, and health checks.
  - Run Desktop builds, packaging, and parity gates only when the task involves Desktop or a deliverable package.

### Fast Validation Path for Web Changes

- When changes affect only pages, template Workspaces, styles, or local frontend state in `apps/web`, without touching Host Bridge, Desktop capabilities, Preload/IPC, Daemon/Runtime, protocols, persistence, or build assets, completion requires relevant targeted Web tests, the `@opencreator/web` typecheck, and any necessary browser interaction checks.
- These Web-only changes can be delivered once those checks pass. By default, do not run production builds, Browser/Desktop parity specifications in both contexts, `desktop:package`, or packaged App E2E tests. Desktop's reuse of the same Web assets alone does not justify broader validation.
- Add Browser/Desktop specifications in both contexts only when changes depend on platform capabilities, Electron's content viewport could affect responsive behavior, or the user explicitly requests a Web/Desktop comparison. Passing these specifications does not itself require actual App packaging.
- Perform actual App packaging and packaged App E2E tests only when changes touch `apps/desktop`, Host Bridge, Preload/IPC, window or native system capabilities, Daemon startup and proxying, packaging assets/scripts, or when the task targets Desktop delivery, release candidate validation, or publishing.

### Service Operations

- Mandatory: The local OpenCreator Web development server must use `127.0.0.1:19861`. Do not switch to another port when `19861` is occupied. Confirm the listener is an older OpenCreator service, stop that service, and start the current working tree on `19861`.
- When a running Vite development server can hot-reload frontend source changes, do not restart the Web service merely to apply page changes.
- Stop or restart the relevant service only when server code, startup configuration, environment variables, or process dependencies change; hot reload fails; the service is not running; or the user explicitly requests it.
- Before restarting, confirm the target port and process command. After restarting, check only that service and its direct dependencies, avoiding operations on unrelated services.

### Conditions for Expanding Validation

- Targeted tests fail for reasons related to the current change.
- Changes touch a shared layer whose main callers cannot be covered by local tests.
- Typechecks or build results reveal an impact across modules.
- The user requests broader validation, or the task itself targets publishing, packaging, complete workflow acceptance, or cross-platform parity.

### Delivery Reports

- Report only validation actually performed. Do not imply that the entire project is free of regressions based on comprehensive checks that were not run.
- Deliver promptly once the minimum validation set covers the change. Do not continue running low-value checks merely to appear more thorough.

## Mandatory Rules for Using `opencreator-bug-fix`

- Mandatory: Do not enable or append the `opencreator-bug-fix` workflow by default for regular development, code fixes, experience improvements, or direct user requests.
- Use `opencreator-bug-fix` only when the user explicitly asks to read, process, or write back to the OpenCreator Feishu bug document.
- Without that explicit request, do not read Feishu documents, carry out the document feedback workflow, or automatically create Git commits through that workflow merely because a task resembles a bug. Complete the requested code changes and necessary validation directly.

## Mandatory Architecture Rules for Creator Template Collaboration Panels

- Mandatory: Video translation, cover generation, image generation, video generation, and all future Creator templates must share a single `CreatorCollaborationPanel`. Do not duplicate or create an entire Agent Panel for an individual template.
- The shared Panel owns Agent messages, the Activity timeline, Stage status cards, actual progress, approvals, the Composer, permissions, and task termination and continuation. Template Workspaces must not maintain separate message, approval, SSE, or Stage presentation logic.
- Express template differences only through `CreatorPanelAdapter`, configuration, callbacks, or local slots. Adapters handle only Stage/Phase/field copy, meaningful Activity descriptions, progress normalization, default Composer prompts, and template context summaries. They must not duplicate the shared interaction framework.
- Workspaces provide only the current step, business context, issue state, and quick actions to the shared Panel. Truly template-specific capabilities may use local slots, but slots must not be used to duplicate the entire Panel.
- The shared Panel must not read `krillinEventPayload` or other executor-private fields. Runtime progress exposed externally must use `phase`, `percent`, `message`, `completed`, `failed`, and `total`. Compatibility with legacy fields belongs only in the corresponding Adapter or Runtime normalizer.
- Do not write UI-only state to user-visible creation activity, including step indices, the furthest step reached, Workspace tabs, result tabs, and draft versions. Convert Activity updates into meaningful descriptions, filter them, and merge consecutive updates of the same kind before displaying them.
- Unknown templates must use a fallback adapter with stable, generic copy. Do not expose internal Stage IDs, executor names, or raw event fields directly.
- Every new Creator template must include Adapter tests, Activity filtering and deduplication tests, Stage status tests, and actual progress tests. Delivering an independent Panel is prohibited.

## Mandatory Web / Desktop Parity Gates

### Core Definitions

- Mandatory: `apps/web` is OpenCreator's only frontend implementation and primary development environment. Desktop must directly use the same Web frontend build assets. Do not maintain a second set of pages, components, styles, or shared interaction logic.
- Mandatory: Given the same business data, user preferences, and frontend content area dimensions, Web and Desktop must have identical shared interfaces, copy, layouts, states, interaction results, and Runtime requests.
- Parity means consistency of shared product capabilities. It does not require the browser to emulate system capabilities such as operating system windows, directory pickers, menu bars, trays, or native notifications.
- Shared React code alone does not establish parity at platform boundaries. Validate changes limited to shared Web code through the Fast Validation Path for Web Changes. Require actual packaged App validation only when Desktop boundaries or deliverable packages are involved.

### Mandatory Rules for Shared Capabilities

- Default projects, project creation, project selection, project configuration, sessions, tasks, plans, permissions, models, attachments, file editing, and other business capabilities must use Daemon/API/Service implementations shared by Web and Desktop.
- Do not implement separate shared business logic for Browser Bridge and Desktop Bridge.
- On first launch without a project, Web and Desktop must obtain the same default project and a session ready for input. Do not automatically create a project on one platform while requiring manual creation on the other.
- Blank project creation must use the shared Runtime project API. Desktop Bridge must not independently implement shared project creation logic.
- Desktop Bridge handles only capabilities that require the operating system or Electron, such as selecting existing directories, resolving paths from folder drops, window lifecycle, menu bars, trays, and native notifications.

### Mandatory Rules for Platform Capabilities

- Do not arbitrarily branch shared business logic, page structure, or styles on `hostBridge.kind` in shared UI.
- Express platform differences through explicit capabilities or optional callbacks, such as `canSelectDirectory` and `canControlWindow`.
- Components may display an action only when its capability is actually available. Do not show buttons whose handlers silently `return`, or create apparent parity where a visible action does nothing on Web but works on Desktop.
- Do not pass empty functions, fake success results, or ineffective callbacks to unsupported platforms merely to make them look consistent.
- Keep platform-specific UI local, identifiable, and independently testable. It must not change the main layout or core workflow of shared pages.
- Currently permitted platform-specific capabilities are limited to:
  - Selecting or switching to an existing local folder.
  - Reading the actual system path of a dropped folder.
  - Electron window closing and hiding, menu bar behavior, and tray behavior.
  - Native system notifications and their background lifecycle.
  - Other system capabilities explicitly confirmed by requirements that truly cannot be provided by the local Daemon.

### Mandatory Rules for Content Viewports

- Visual comparisons between Web and Desktop must use identical frontend content area dimensions. Do not compare using the outer dimensions of browser and Electron windows directly.
- Prioritize stable content area dimensions when creating Desktop windows. For responsive layouts, verify that Electron title bars, system borders, and scaling do not incorrectly trigger breakpoints.
- With identical content area dimensions, shared pages must have matching main DOM structure, visible copy, key element dimensions, and screenshots.

### Mandatory Rules for Build Assets

- Rebuild Web from the current working tree before Desktop packaging. Do not reuse an old `apps/web/dist` whose provenance cannot be established.
- Web files embedded in the Desktop package must exactly match the current `apps/web/dist`.
- The Desktop build manifest must record at least the Git commit, working tree dirty status, Web build identifier or hash, platform, architecture, and build time.
- Packaging validation must compare the App's embedded Web assets with the current Web build output. Abort packaging if they differ.
- Do not produce a deliverable App by manually copying or replacing resources inside it or by skipping the Web build.

### Tiered Parity Testing

When changes explicitly affect shared Web/Desktop behavior or platform capabilities, select the following automated tests according to their actual impact. Do not run the entire set by default for local Web-only changes:

1. Render the application with Browser Bridge and Desktop Bridge using the same Fake Daemon, project, session, local preferences, and content viewport.
2. Compare shared visible copy, buttons, states, key dimensions, and interaction results on the home page, project selector, project creation flow, settings page, session input area, and file Workspace.
3. Verify that the same shared operation calls the same Runtime API and produces the same persisted results on both platforms.
4. Verify that Web automatically obtains a default project on first launch and that the input is immediately usable.
5. Verify that Browser Bridge does not display unavailable Desktop native actions such as directory selection, directory switching, or window closing.
6. Verify that native actions under Desktop Bridge actually invoke the corresponding Bridge capabilities. Checking only that buttons exist is insufficient.
Perform actual App packaging only when the escalation conditions in the Fast Validation Path for Web Changes apply. In that case, also complete:

7. Run E2E tests against the actual packaged App to verify Preload Bridge, the `opencreator-app://` page, Runtime proxying, the default project, the core input flow, and native capabilities.
8. Verify that the file lists and content hashes in `apps/web/dist` exactly match the App's embedded Web directory.

### Required Decisions Before Making Changes

- Before changing `apps/web` pages, state, Services, Host Bridge, Daemon project logic, Desktop Preload, window logic, protocol proxies, or packaging scripts, determine the validation tier using the Fast Validation Path for Web Changes. Do not automatically treat ordinary Web changes as Desktop packaging tasks.
- Classify each new feature before implementation:
  - Shared product capability: Implement it once, shared by Web and Daemon.
  - Native system capability: Isolate it through a capability and provide platform-specific tests.
- When fixing an issue on one platform, inspect the same flow on the other. Do not validate only the platform where the issue was originally reported.
- When the platforms differ, first determine whether the difference is explicitly designed or is a defect caused by capability detection, data sources, stale build assets, viewports, or missing tests.
- Do not dismiss an existing inconsistency as a platform difference without explicit confirmation in the requirements.

### Requirements for Completion Claims

- Web-only changes may be declared complete after relevant targeted Web tests, typechecks, and necessary browser checks pass. This does not establish that an actual Desktop package or release candidate has been validated.
- When the conditions requiring Desktop packaging apply, do not claim that Desktop functionality is complete, the platforms have parity, or the product is ready for release until relevant tests, actual packaged App validation, and asset hash checks pass.
- If the current environment cannot run a required check, clearly state what remains unverified, why, and the remaining risk.
- Block the release if shared Web/Desktop behavior regresses, the App embeds stale Web assets, platform actions are ineffective, or first-launch states differ. Do not reduce these failures to ordinary warnings.
