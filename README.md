<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/images/OpenCreator_logo_vector_dark.svg" />
    <img src="./docs/images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  The open-source AI workspace for creators
</h1>

<p>From scripts to video, images, voice, avatars, translation, and editing, Agents move the whole creative process forward in one workspace.</p>

<p><strong>OpenCreator was formerly known as KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator, formerly KrillinAI: #1 Repository of the Day on Trendshift" width="250" height="55" /></a>

**English** | [简体中文](./docs/zh/README.md) | [日本語](./docs/ja/README.md) | [한국어](./docs/ko/README.md) | [Bahasa Indonesia](./docs/id/README.md) | [Español](./docs/es/README.md) | [Français](./docs/fr/README.md) | [Deutsch](./docs/de/README.md) | [Português](./docs/pt/README.md) | [Русский](./docs/ru/README.md) | [العربية](./docs/ar/README.md)

[![GitHub Stars](https://img.shields.io/github/stars/krillinai/OpenCreator?style=flat&logo=github&label=Stars&color=gold)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/3GwBGsjs8)
[![QQ 群](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Project Highlights](#project-highlights) · [Creator Tools](#creator-tools) · [Conversation & Workspace](#conversation-and-workspace-moving-together) · [Models Supported](#models-supported) · [Examples](#examples) · [Quick Start](#quick-start) · [Desktop](#desktop) · [OpenCreator System Architecture](#opencreator-system-architecture) · [Development](#development) · [Documentation](#documentation) · [Contributors](#contributors) · [Star History](#star-history)

</div>

![OpenCreator Agent workspace](./docs/images/opencreator-home-en.png)

## Project Overview

OpenCreator is built for individuals and teams who want to keep creative and development work running locally. Instead of reimplementing an Agent loop, it uses Codex CLI as the execution engine and adds a stable local Runtime, a visual workspace, and a Desktop host around it.

The product brings together two connected workflows:

- **AI content creation**: use dedicated creator tools for video translation, video downloading, thumbnail generation, and image generation.
- **General Agent workspace**: organize conversations by project, keep Runs working in the background, and manage approvals, attachments, files, Skills, MCP, schedules, notifications, memory, and diagnostics from one place.

Web is the single frontend implementation. Desktop loads the same Web build and adds only capabilities that require the operating system, such as directory selection, window lifecycle, tray behavior, and native notifications. With the same data and content viewport, both platforms share the same general UI and Runtime behavior.

## Project Highlights

- 🤖 **Codex Native**: Reuse the Codex Agent loop, models, reasoning, tool calls, conversations, Skills, and MCP without maintaining a second execution engine.

- 🚀 **Ready-to-Use Desktop App**: Launch OpenCreator directly from the desktop app with Codex CLI included; the local Runtime starts on demand and prepares a default project automatically.

- 🔄 **Managed Runtime Components**: Inspect bundled, active, and latest yt-dlp versions, check for updates periodically, and update manually while keeping the current working version available if an update fails.

- 🎨 **Multimodal Creation**: Create and manage video, images, audio, subtitles, and documents through one connected workflow.

- 🔗 **Dual-Mode Workflow**: Work through either the visual workspace or Agent conversation while one shared state machine keeps steps, progress, and results synchronized.

- 🕘 **Versioning**: Every revision creates a new version while preserving earlier settings and outputs for review and comparison.

- 🧩 **Skills and MCP**: Browse, install, and invoke Skills while managing MCP through Codex-native configuration.

- 🧠 **Memory**: Keep global, project, and thread memory with summaries and reproducible Run input snapshots.

- 🔐 **Local Security**: Keep data, attachments, and logs local by default, with approvals and redacted diagnostics.

## Creator Tools

The current release includes four creator tools. Available models and services depend on your local Codex environment and AI service settings.

Open the Dashboard to translate videos, download public videos, generate thumbnails, or create images.

![OpenCreator Creator Dashboard](./docs/images/product/opencreator-dashboard-en.png)

> More creator tools are continuously being added.

<table width="100%">
<thead>
<tr>
<th width="18%">Workspace</th>
<th width="14%">Status</th>
<th width="68%">Capabilities</th>
</tr>
</thead>
<tbody>
<tr><td valign="top">Video Translation</td><td valign="top">✅ Available</td><td>Import local or public videos; transcribe with cloud or local Whisper services; use LLM context for subtitle segmentation, alignment, terminology, and translation; configure bilingual subtitles, dubbing or a custom voice sample, subtitle styles, landscape or portrait composition, and export SRT, audio, or video</td></tr>
<tr><td valign="top">Video Downloader</td><td valign="top">✅ Available</td><td>Parse YouTube, Bilibili, and other supported public links, inspect available quality and format options, and download video or audio for later workflows</td></tr>
<tr><td valign="top">Thumbnail Generator</td><td valign="top">✅ Available</td><td>Combine a topic, video link, and optional reference image to generate and compare multiple content-thumbnail variations</td></tr>
<tr><td valign="top">Image Generation</td><td valign="top">✅ Available</td><td>Generate with GPT Image from a prompt and optional reference image, configure the aspect ratio and output count, then preview and download individual images</td></tr>
<tr><td valign="top">Stick Figure Animation</td><td valign="top">Coming soon</td><td>Develop characters, storyboards, voiceovers, and animation in a guided workflow</td></tr>
<tr><td valign="top">Auto Clips</td><td valign="top">In development</td><td>Analyze long videos, identify highlights, and turn selected moments into reusable short clips</td></tr>
<tr><td valign="top">Smart Dubbing</td><td valign="top">In development</td><td>Turn scripts into voiceovers with selectable voices, pacing, and emotion controls</td></tr>
<tr><td valign="top">Video Generation</td><td valign="top">In development</td><td>Generate video from prompts and reference images, then preview and export the result</td></tr>
<tr><td valign="top">Digital Avatar</td><td valign="top">In development</td><td>Combine scripts, voice, and avatar presentation to produce talking-head videos</td></tr>
</tbody>
</table>

## Conversation and workspace, moving together

Describe tasks naturally, then step into visual tools whenever you need precise control.

![OpenCreator conversation and visual workspace working together](./docs/images/examples/opencreator-auto-clips-en.png)

### Fine-grained workspace controls

Adjust subtitles, shots, audio, and generation settings precisely.

### Flexible conversational edits

Tell the Agent what to change and refine the result in natural language.

### Synchronized state

Conversation and workspace share the current task state, so nothing needs repeating.

### Independent versions

Each revision creates a separate version without overwriting earlier results or settings.

## Models Supported

Language model availability follows the Codex model catalog or your OpenAI-compatible provider. Image, voice, and transcription models use the services configured in **Settings → AI Services**.

### Language models

<table>
<tr>
<td align="center" width="20%"><img src="./docs/images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT</strong></td>
<td align="center" width="20%"><img src="./docs/images/models/deepseek.png" alt="DeepSeek" width="40" height="40" /><br /><strong>DeepSeek</strong></td>
<td align="center" width="20%"><img src="https://github.com/QwenLM.png?size=80" alt="Qwen" width="40" height="40" /><br /><strong>Qwen</strong></td>
<td align="center" width="20%"><img src="https://github.com/MoonshotAI.png?size=80" alt="Kimi" width="40" height="40" /><br /><strong>Kimi</strong></td>
<td align="center" width="20%"><img src="https://github.com/zai-org.png?size=80" alt="Z.ai" width="40" height="40" /><br /><strong>GLM</strong></td>
</tr>
<tr>
<td align="center" width="20%"><img src="https://github.com/xai-org.png?size=80" alt="xAI" width="40" height="40" /><br /><strong>Grok</strong></td>
<td align="center" width="20%"><img src="./docs/images/models/doubao.svg" alt="Doubao" width="40" height="40" /><br /><strong>Doubao</strong></td>
<td align="center" width="20%"><img src="./docs/images/models/ernie.png" alt="ERNIE" width="40" height="40" /><br /><strong>ERNIE</strong></td>
<td align="center" width="20%"><img src="https://github.com/Tencent-Hunyuan.png?size=80" alt="Tencent Hunyuan" width="40" height="40" /><br /><strong>Hunyuan</strong></td>
<td width="20%"></td>
</tr>
</table>

### Image

<table>
<tr>
<td align="center"><img src="./docs/images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
</tr>
</table>

### Voice and transcription

<table>
<tr>
<td align="center" width="20%"><img src="./docs/images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>Whisper</strong></td>
<td align="center" width="20%"><img src="./docs/images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>OpenAI TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
<td align="center" width="20%"><img src="https://github.com/microsoft.png?size=80" alt="Microsoft" width="40" height="40" /><br /><strong>Edge TTS</strong></td>
<td align="center" width="20%"><img src="https://github.com/aliyun.png?size=80" alt="Alibaba Cloud" width="40" height="40" /><br /><strong>Aliyun Speech</strong></td>
</tr>
</table>

## Examples

### Video Translation

The public examples below were produced when OpenCreator was still named KrillinAI. They demonstrate the established subtitle alignment, translation, dubbing, and portrait-video workflow that OpenCreator's Video Translation workspace brings into a wider Agent workflow.

The project generated the subtitle file below from a 46-minute local video in one run, without manual subtitle adjustments. The published result shows complete coverage, no overlapping lines, natural segmentation, and high-quality translation.

![OpenCreator subtitle alignment example](./docs/images/examples/krillinai-subtitle-alignment.png)

<table width="100%">
<tr>
<td width="33%">

#### Subtitle Translation

https://github.com/user-attachments/assets/bba1ac0a-fe6b-4947-b58d-ba99306d0339

</td>
<td width="33%">

#### Dubbing

https://github.com/user-attachments/assets/0b32fad3-c3ad-4b6a-abf0-0865f0dd2385

</td>
<td width="33%">

#### Portrait Mode

https://github.com/user-attachments/assets/c2c7b528-0ef8-4ba9-b8ac-f9f92f6d4e71

</td>
</tr>
</table>

> These video examples and the subtitle alignment image were produced while OpenCreator still used the KrillinAI name.

### Video Downloader

Analyze a public video link, compare the available formats, and download video or audio directly to the project.

![OpenCreator Video Downloader format selection](./docs/images/examples/video-downloader-formats-en.png)

### Stick Figure Animation (Coming Soon)

> Coming soon. Not yet integrated in the current release.

OpenCreator developed this original character collection in collaboration with artist [Harbor Hsia](https://www.behance.net/xiaheyuan1), creator of [Stickman on Behance](https://www.behance.net/gallery/254715463/Stickman). The preset cast is being prepared for a future story and animation workflow with consistent character identities.

![OpenCreator stick figure characters developed with artists](./docs/images/examples/stick-figure-characters.webp)

The planned workflow will guide a character and story idea through storyboard generation, shot review, voiceover, music, and versioned animation output.

![OpenCreator stick figure animation example frame](./docs/images/examples/stick-figure-animation-frame.jpg)

## Quick Start

### Prerequisites

- Node.js 22 or later
- pnpm 9.15.0, pinned through the repository's `packageManager` field
- A Codex CLI executable available in your terminal
- A valid Codex CLI login for real model tasks

Check your local environment first:

```bash
node --version
pnpm --version
codex --version
```

### Run Web from Source

```bash
git clone https://github.com/krillinai/OpenCreator.git
cd OpenCreator
corepack enable
pnpm install
pnpm web:dev
```

Open `http://127.0.0.1:19861/`. The development server starts the local daemon on demand and injects a temporary Runtime token through a same-origin proxy, so no connection token needs to be copied manually.

On first launch, the Runtime prepares a default project. The composer is ready as soon as the connection completes. To work on the daemon only:

```bash
pnpm daemon:dev
```

The daemon listens only on a loopback address and prints its connection address and temporary token to stdout once.

## Desktop

Desktop and the browser use the same React frontend from `apps/web`. General project, conversation, task, and settings behavior calls the same Daemon/API. Electron adds only real system paths, window controls, tray behavior, and native notifications.

### Development Mode

```bash
pnpm desktop:dev
```

### Local Packaging

| Command | Output |
| --- | --- |
| `pnpm desktop:package` | A runnable directory for the current platform, intended for local verification |
| `pnpm desktop:dist` | An installer for the current platform |
| `pnpm desktop:release` | The formal release packaging entry point |
| `pnpm --filter @opencreator/desktop verify:package` | Verification for an existing Desktop package |

Desktop packaging rebuilds Web from the current workspace, records the commit, dirty state, platform, architecture, and Web hash, and compares `apps/web/dist` with the resources embedded in the application. Packaging fails if they differ. See the [Desktop release runbook](./docs/operations/opencreator-desktop-release-runbook.md) for signing, notarization, Windows builds, and release requirements.

## Core Workflows

### Conversations and Runs

1. Select a project or start a new conversation.
2. Enter a task and choose the permission level, Profile, model, and reasoning effort.
3. While a Run is active, queue follow-up tasks or interrupt it and continue immediately.
4. Use the Timeline to inspect reasoning summaries, tool calls, file changes, approvals, and final results.
5. Use the task center to track running, completed, failed, and approval-blocked tasks globally.

### Skills and MCP

- Browse the Skill marketplace, installation history, and locally available Skills in the plugin center.
- Select a Skill from the composer with `/` or the add menu so the next task follows its workflow.
- MCP management passes through Codex-native commands and configuration instead of maintaining a second execution engine.
- OpenCreator uses the active `$CODEX_HOME` by default, so confirm the impact before changing global Skills or MCP configuration.

### Schedules and Dedicated Task Threads

- Every schedule owns a persistent, dedicated OpenCreator conversation.
- Automatic triggers, manual runs, and user follow-ups reuse that conversation and run serially with the `queue` or `skip` policy.
- Deleting a schedule archives its dedicated conversation while preserving existing Runs, results, and underlying Codex history.
- Rotating or recovering an underlying Codex thread does not change the OpenCreator task entry or page route.

## OpenCreator System Architecture

OpenCreator treats the visual workspace and the Agent conversation as two interfaces to the same creative task, rather than two separate workflows. Each creator workflow is modeled as a state machine: source input, configuration, generation, review, revision, and export become explicit states and events. Workspace actions and conversational commands enter the same state machine, while the current step, configuration, progress, versions, and results are projected back into both interfaces. This keeps the workspace and conversation synchronized without introducing a second source of truth.

Creative work is iterative, so revisions do not overwrite the current result. Each correction or regeneration creates a new version from the existing workflow state, retaining the settings and outputs of earlier versions for review, comparison, and continued refinement.

```text
+-----------------------------+     +------------------------------------+
| Browser Access              |     | Desktop Host                       |
|                             |     | Shared Web build + Electron        |
+--------------+--------------+     +------------------+-----------------+
               |                                       |
               +-------------------+-------------------+
                                   v
+----------------------------------------------------------------------------+
| Creator Experience / apps/web                                              |
| Dashboard / Creator Tools / Agent Conversation / Settings / Files          |
+-------------------------------------+--------------------------------------+
                                      |
+-------------------------------------v--------------------------------------+
| Collaboration Core                                                         |
| Shared workflow state / Steps / Progress / Results / Versions              |
+-------------------------------------+--------------------------------------+
                                      | Runtime API + SSE
+-------------------------------------v--------------------------------------+
| Local Runtime / apps/daemon                                                 |
| Projects / Runs / Approvals / Schedules / Memory / Notifications           |
| Component status / Update checks / Verified updates / Safe fallback        |
+-------------+------------------------+------------------------+-------------+
              |                        |                        |
              v                        v                        v
+---------------------+  +---------------------+  +-------------------------+
| Local Data          |  | Codex Engine        |  | Media Toolchain         |
| SQLite / Files      |  | CLI / app-server    |  | FFmpeg / yt-dlp         |
| System credentials  |  | Skills / MCP        |  | Whisper / AI services   |
+---------------------+  +---------------------+  +-------------------------+
```

| OpenCreator Component | Responsibility | Implementation |
| --- | --- | --- |
| Creator Experience | Dashboard, creator tools, Agent conversation, settings, and files | `apps/web` · React 18 · Vite · TypeScript |
| Collaboration Core | Keeps workspace steps, conversation context, progress, results, and revisions synchronized | Shared workflow state · `CreatorCollaborationPanel` · version history |
| Local Runtime | Manages projects, Runs, approvals, schedules, memory, and notifications | `apps/daemon` · Fastify · Runtime API · SSE |
| Runtime Components | Tracks bundled, active, and latest versions; checks periodically and installs only user-requested updates | yt-dlp nightly · update verification · working-version fallback |
| Codex Engine | Provides the Agent loop, sessions, reasoning, tools, Skills, and MCP | Codex CLI · app-server |
| Media Toolchain | Downloads, transcribes, transforms, generates, and exports creative media | yt-dlp · Whisper · FFmpeg · configured AI services |
| Local Data | Stores project data, Runs, attachments, outputs, and credentials locally | SQLite · filesystem · system credential storage |
| Desktop Host | Loads the shared Web build and adds operating-system capabilities | `apps/desktop` · Electron · Preload Bridge |

Core principles:

- The workspace and Agent conversation are synchronized projections of one workflow state; both dispatch events to the same state machine instead of maintaining parallel task state.
- Revisions create new versions instead of replacing existing results, preserving the context and output of every creative iteration.
- The frontend does not launch Codex directly and does not depend on raw Codex JSONL event formats.
- The daemon owns process lifecycle, event normalization, persistence, approvals, schedules, and the notification outbox.
- Codex remains the execution source of truth for the Agent loop, Skills, and MCP.
- Browser Bridge and Desktop Bridge do not implement separate copies of general product logic.

## Repository Layout

```text
OpenCreator/
├── apps/
│   ├── web/          # The single React frontend implementation
│   ├── daemon/       # Local Fastify Runtime and Codex adapter
│   ├── desktop/      # Electron Main, Preload, native capabilities, and packaging
│   └── harness/      # Runtime command-line verification tool
├── packages/
│   ├── protocol/     # Runtime contracts shared by Web, Daemon, and Desktop
│   └── skill-market/ # Skill marketplace models and shared logic
├── docs/             # Design docs, API references, runbooks, and test reports
├── scripts/          # Repository-level checks
└── .runtime/         # Local Runtime data, created on first launch
```

## Configuration

### AI Service API Keys

Open **Settings → AI Services** to configure the model, transcription, voice, and image providers used by the current workspaces. Additional service categories may appear in preparation for upcoming creator tools. Each category exposes only the fields required by its selected provider, including the Base URL, API Key, model, proxy, or provider-specific credentials.

![OpenCreator AI Services API Key settings](./docs/images/product/opencreator-ai-services-en.png)

Credentials are saved through the local Runtime's system credential storage and should never be committed to the repository. Some local or system-backed providers, such as Edge TTS, do not require an API Key.

### Third-party Runtime Components

Open **Settings → Third-party Components** to inspect the yt-dlp nightly version currently in use, the version bundled with OpenCreator, its source, and the latest available release. OpenCreator checks for updates every seven days but never installs them automatically. Updates require an explicit user action, and the current working version remains available if downloading, verification, or installation fails.

![OpenCreator Third-party Components settings](./docs/images/product/opencreator-third-party-components-en.png)

### Runtime Environment Variables

Most users do not need environment variables. Use these when you need isolated data, a specific Codex executable, or a custom managed-project directory:

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `OPENCREATOR_DATA_DIR` | `.runtime` | OpenCreator database, Runs, attachments, and managed workspaces |
| `OPENCREATOR_CODEX_BIN` | `codex` | Path to the Codex CLI executable |
| `CODEX_HOME` | `~/.codex` | Source of truth for Codex sessions, configuration, Skills, MCP, and Profiles |
| `OPENCREATOR_DEFAULT_CWD` | Current working directory | Default daemon working directory |
| `OPENCREATOR_DEFAULT_PROJECT_ROOT` | Runtime default policy | Managed-project root; when set, OpenCreator uses its `OpenCreator/` child directory |
| `OPENCREATOR_CODEX_THREAD_ROTATION_RUN_THRESHOLD` | `50` | Terminal Run threshold for rotating the Codex thread behind a long-running schedule; use `0` to disable proactive rotation |

For example, isolate both Runtime data and the Codex environment:

```bash
OPENCREATOR_DATA_DIR=/path/to/opencreator-data \
CODEX_HOME=/path/to/codex-home \
pnpm web:dev
```

## Data and Security

Runtime data is stored under `.runtime/` in the repository root by default:

| Path | Contents |
| --- | --- |
| `.runtime/app.sqlite` | Projects, threads, Runs, events, schedules, notifications, attachment metadata, approvals, memory, and summaries |
| `.runtime/runs/` | Redacted logs, diagnostics, and metadata for individual Runs |
| `.runtime/attachments/` | Controlled attachment files |
| `.runtime/workspaces/` | Runtime-managed project workspaces |

Codex sessions and configuration remain in `$CODEX_HOME` and must be backed up separately from `.runtime/`.

Security boundaries include:

- The daemon listens only on `127.0.0.1`; every API except the health check requires a Bearer token.
- HTML preview disables scripts, navigation, and popups by default and allows only controlled same-workspace relative resources.
- Sensitive memory requires a second confirmation. OpenCreator never permanently stores unconfirmed suggestions automatically.
- Diagnostics and Run logs are redacted before they are returned or exported.
- Desktop packages enable ASAR integrity and cookie encryption while disabling RunAsNode, `NODE_OPTIONS`, and the Node CLI Inspector.

See the [user guide and troubleshooting reference](./docs/opencreator-user-guide-and-troubleshooting.md) for complete backup, restore, cleanup, and reset procedures.

## Development

### Common Commands

| Command | Purpose |
| --- | --- |
| `pnpm web:dev` | Start Web and launch the local daemon on demand |
| `pnpm daemon:dev` | Start the daemon only |
| `pnpm desktop:dev` | Build dependencies and start Electron in development mode |
| `pnpm test` | Run workspace unit and integration tests |
| `pnpm typecheck` | Run TypeScript checks across the repository |
| `pnpm build` | Build every workspace |
| `pnpm e2e` | Run Web Playwright E2E tests |
| `pnpm smoke:ci` | Run the fake-Codex Runtime smoke test |
| `pnpm perf:check` | Check the recorded performance baseline |

Before submitting a change, run at least:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Changes to Desktop, Host Bridge, the Runtime proxy, or shared frontend workflows also require Web/Desktop consistency tests, packaged application E2E, and Web build hash verification. Passing Web unit tests alone does not establish Desktop release readiness.

The real Codex smoke test is disabled by default. Enable it explicitly with:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## Documentation

- [User guide and troubleshooting](./docs/opencreator-user-guide-and-troubleshooting.md)
- [Runtime API v1](./docs/runtime-api-for-ui-v1.md)
- [Codex-native Runtime design](./docs/2026-07-03-codex-native-agent-runtime-design.md)
- [Desktop release runbook](./docs/operations/opencreator-desktop-release-runbook.md)
- [Windows Desktop release guide](./docs/operations/opencreator-desktop-windows-release.md)
- [Visual component guidelines](./docs/visual-component-guidelines.md)

## Translation Convention

The root `README.md` is the canonical English document. Maintained translations live at `docs/<locale>/README.md`. Add a language to the switcher only after its full document has been translated and synchronized with the English structure.

## Contributing

1. Describe the problem, use case, and expected behavior in [Issues](https://github.com/krillinai/OpenCreator/issues).
2. Create a focused feature or fix branch from the latest development branch.
3. Follow the existing architecture: implement general product capabilities once in Web and Daemon, and isolate native differences behind explicit capabilities.
4. Add appropriate unit, integration, or E2E coverage for behavior changes, and list both completed and skipped verification in the Pull Request.
5. Never commit `.runtime/`, local credentials, Codex sessions, build caches, or other user data.

## Contributors

Thanks to everyone who has taken part through code, documentation, feedback, issue reports, Skills, designs, and ideas.

<a href="https://github.com/krillinai/KrillinAI/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=krillinai/KrillinAI&amp;max=500&amp;columns=20" alt="OpenCreator contributors" />
</a>

## Star History

OpenCreator was formerly named KrillinAI. This chart covers the repository's full history across the rename.

[![OpenCreator Star History](https://api.star-history.com/svg?repos=krillinai/KrillinAI&type=Date)](https://star-history.com/#krillinai/KrillinAI&Date)

## Related Projects

| Project | Role |
| --- | --- |
| [OpenAI Codex](https://github.com/openai/codex) | The Agent execution engine behind model access, reasoning, tool calls, sessions, Skills, and MCP integration. |
| [yt-dlp](https://github.com/yt-dlp/yt-dlp) | Inspects supported public media links, lists available formats, and downloads video or audio for creator workflows. |
| [FFmpeg](https://ffmpeg.org/) | FFmpeg and ffprobe handle media conversion, composition, frame extraction, and output validation. |
| [Whisper](https://github.com/openai/whisper), [whisper.cpp](https://github.com/ggml-org/whisper.cpp), [faster-whisper](https://github.com/SYSTRAN/faster-whisper), and [WhisperKit](https://github.com/argmaxinc/WhisperKit) | Cloud and platform-specific local speech-transcription options selected according to available Runtime capabilities. |
| [React](https://react.dev/) | The shared user interface foundation for the Web and Desktop experiences. |
| [Fastify](https://fastify.dev/) | The HTTP and API foundation of the local Runtime. |
| [Electron](https://www.electronjs.org/) | The Desktop host for native system capabilities, application lifecycle, and packaging. |
| [SQLite](https://www.sqlite.org/) | Local persistence for projects, conversations, Runs, schedules, memory, and other workspace data. |
| [Model Context Protocol](https://modelcontextprotocol.io/) | The open protocol used to connect external tools and services to the Agent workspace. |

---

<div align="center">

**OpenCreator · Create locally, work continuously.**

</div>
