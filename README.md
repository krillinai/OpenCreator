<div align="center">

<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="./docs/images/OpenCreator_logo_vector_dark.svg" />
    <img src="./docs/images/OpenCreator_logo_vector.svg" alt="OpenCreator" width="380" />
  </picture>
  <br />
  The open-source AI workspace & Skills for creators
</h1>

<p>Bring visual creator tools, reusable Skills, and Agents together for scripts, video, images, voice, avatars, translation, and editing—all in one workspace.</p>

<p><strong>OpenCreator was formerly known as KrillinAI.</strong></p>

<a href="https://trendshift.io/repositories/13360" target="_blank"><img src="https://trendshift.io/api/badge/repositories/13360" alt="OpenCreator, formerly KrillinAI: #1 Repository of the Day on Trendshift" width="250" height="55" /></a>

**English** | [简体中文](./docs/zh/README.md) | [日本語](./docs/ja/README.md) | [한국어](./docs/ko/README.md) | [Bahasa Indonesia](./docs/id/README.md) | [Español](./docs/es/README.md) | [Français](./docs/fr/README.md) | [Deutsch](./docs/de/README.md) | [Português](./docs/pt/README.md) | [Русский](./docs/ru/README.md) | [العربية](./docs/ar/README.md)

[![GitHub Stars](https://badgen.net/github/stars/krillinai/OpenCreator?icon=github&label=Stars&color=EAB308)](https://github.com/krillinai/OpenCreator/stargazers)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://www.apache.org/licenses/LICENSE-2.0)
[![Bilibili](https://img.shields.io/badge/dynamic/json?label=Bilibili&query=%24.data.follower&suffix=%E7%B2%89%E4%B8%9D&url=https%3A%2F%2Fapi.bilibili.com%2Fx%2Frelation%2Fstat%3Fvmid%3D242124650&logo=bilibili&color=00A1D6&labelColor=FE7398&logoColor=FFFFFF)](https://space.bilibili.com/242124650)
[![AtomGit G-Star](https://img.shields.io/badge/AtomGit-G--Star-DA203E?style=flat)](https://atomgit.com/krillinai/OpenCreator)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/3GwBGsjs8)
[![QQ 群](https://img.shields.io/badge/QQ%20群-754069680-green?logo=tencent-qq)](https://qm.qq.com/q/W4YC0PLMeA)

[Highlights](#project-highlights) · [Creator Tools](#creator-tools) · [Skills](#skills) · [Examples](#examples) · [Quick Start](#quick-start) · [Desktop](#desktop) · [Docs](#documentation)

</div>

![OpenCreator Agent workspace](./docs/images/opencreator-home-en.png)

## Project Overview

OpenCreator is built for individuals and teams who want to keep creative and development work running locally. Instead of reimplementing an Agent loop, it uses Codex CLI as the execution engine and adds a stable local Runtime, a visual workspace, and a Desktop host around it.

OpenCreator offers two connected ways to work:

- **Content workspace**: use visual tools and creation templates for video translation and downloading, image and video generation, voiceovers, article and social post writing, short-video scripting, and stick figure animation.
- **Agent conversation**: start and guide creative or development tasks in natural language, organize conversations by project, keep Runs working in the background, and manage approvals, attachments, files, Skills, MCP, schedules, notifications, memory, and diagnostics from one place.

Web is the single frontend implementation. Desktop loads the same Web build and adds only capabilities that require the operating system, such as directory selection, window lifecycle, tray behavior, and native notifications. With the same data and content viewport, both platforms share the same general UI and Runtime behavior.

## Project Highlights

- 🤖 **Codex Native**: Reuse the Codex Agent loop, models, reasoning, tool calls, conversations, Skills, and MCP without maintaining a second execution engine.

- 🚀 **Ready-to-Use Desktop App**: Launch OpenCreator directly from the desktop app with Codex CLI included; the local Runtime starts on demand and prepares a default project automatically.

- 🔄 **Managed Runtime Components**: Inspect bundled, active, and latest yt-dlp versions, check for updates periodically, and update manually while keeping the current working version available if an update fails.

- 🎨 **Multimodal Creation**: Create and manage video, images, audio, subtitles, and documents through one connected workflow.

- 🧩 **Creation Templates**: Start creating images and videos from reusable templates without setting up prompts and settings from scratch.

- 🔗 **Dual-Mode Workflow**: Work through either the visual workspace or Agent conversation while one shared state machine keeps steps, progress, and results synchronized.

- 🕘 **Versioning**: Every revision creates a new version while preserving earlier settings and outputs for review and comparison.

- 🧩 **Reusable Skills**: Use video workflow Skills, extend the Agent with your own Skills, and manage MCP through Codex-native configuration.

- 🧠 **Memory**: Keep global, project, and thread memory with summaries and reproducible Run input snapshots.

- 🔐 **Local Security**: Keep data, attachments, and logs local by default, with approvals and redacted diagnostics.

- 🌐 **Localized Interface**: Use the Web or Desktop client in Simplified Chinese, English, or Swedish, with automatic system-language detection or manual selection.

## Creator Tools

The current release includes ten creator tools. Available models and services depend on your local Codex environment and AI service settings.

Open the Dashboard to write articles, Xiaohongshu posts, or short-video scripts; create stick figure animations; translate or download videos; generate thumbnails, images, or videos; and create voiceovers with Smart Dubbing.

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
<tr><td valign="top">Article Writer</td><td valign="top">✅ Available</td><td>Turn a topic, links, videos, or source documents into editable topic options, an outline, and a complete article; add generated images and export Markdown, HTML, or PDF</td></tr>
<tr><td valign="top">Xiaohongshu Posts</td><td valign="top">✅ Available</td><td>Generate a complete Xiaohongshu post from a topic or source material, with controls for the target audience, post type, and length, then copy or download the result</td></tr>
<tr><td valign="top">Short Video Script</td><td valign="top">✅ Available</td><td>Create a shoot-ready segmented script from a topic or source material, tailored to the audience, platform, duration, and tone, then edit, copy, or download it</td></tr>
<tr><td valign="top">Stick Figure Animation</td><td valign="top">✅ Available</td><td>Turn text or YouTube content into narration, voice, consistent-character storyboard visuals, subtitles, and a downloadable stick figure animation</td></tr>
<tr><td valign="top">Auto Clips</td><td valign="top">In development</td><td>Analyze long videos, identify highlights, and turn selected moments into reusable short clips</td></tr>
<tr><td valign="top">Smart Dubbing</td><td valign="top">✅ Available</td><td>Turn scripts into voiceovers with selectable voices, pacing, and emotion controls</td></tr>
<tr><td valign="top">Video Generation</td><td valign="top">✅ Available</td><td>Generate videos with Seedance from prompts and reference images, then preview, regenerate, and download each version</td></tr>
<tr><td valign="top">Digital Avatar</td><td valign="top">In development</td><td>Combine scripts, voice, and avatar presentation to produce talking-head videos</td></tr>
</tbody>
</table>

## Creation Templates

Start creating from a template instead of building every prompt and setting from scratch. Browse featured templates by category, including video creation and image design, to find a starting point for your idea.

The collection brings together templates created by OpenCreator and by independent creators. Third-party templates credit their creators and link to the original source on the template detail page.

![Featured creation templates across video and image categories](./docs/images/product/creation-templates-gallery-en.png)

Open a template to preview its example result and inspect its prompt, settings, tags, author, and original source. Select **Use this template** to start creating with it, then adjust the inputs for your own work.

![Image creation template detail with example result, settings, and prompt](./docs/images/product/creation-templates-detail-en.png)

## Skills

Creator tools provide visual controls; Skills give the Agent reusable instructions and tool workflows. OpenCreator includes video-production Skills in the repository, alongside support for managing local Codex Skills.

The repository's [`skills/`](./skills/) directory contains reusable instructions for Agents operating the embedded KrillinAI CLI and the external Channel pipeline.

| Skill | Capabilities |
| --- | --- |
| [KrillinAI CLI](./skills/krillinai-cli/SKILL.md) | Choose commands, check configuration, and interpret progress, manifests, outputs, and errors |
| [Subtitle](./skills/krillinai-subtitle/SKILL.md) | Download platform captions or transcribe media, translate subtitles, and produce bilingual or short portrait subtitles |
| [TTS](./skills/krillinai-tts/SKILL.md) | Generate target-language dubbing from subtitles and optionally produce a dubbed video |
| [Landscape Render](./skills/krillinai-render-horizontal/SKILL.md) | Render landscape videos with bilingual subtitles or dubbed audio and target-language subtitles |
| [Portrait Render](./skills/krillinai-render-vertical/SKILL.md) | Compose portrait videos with titles, bilingual subtitles, or dubbing |
| [Cover](./skills/krillinai-cover/SKILL.md) | Generate a cover image from a complete text prompt and save the image and final prompt |
| [Pipeline Plan](./skills/krillinai-pipeline/SKILL.md) | Validate a multi-stage output plan in dry-run mode; execute actual work through the individual stage Skills |
| [Channel Pipeline](./skills/channel-pipeline/SKILL.md) | Drive a configured Channel checkout for search, ingest, processing, multi-platform publishing, and Baidu sync |

### Extend with Your Own Skills

OpenCreator supports local Codex Skills defined by `SKILL.md`, so you can add your own methods and workflows rather than relying only on fixed creator tools. Skill availability depends on the active Codex home and installed Skills; video workflow Skills require the CLI and relevant services to be configured. Inclusion in the repository does not mean every Skill is automatically installed or every external service is bundled.

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

Language model availability follows the Codex model catalog or your OpenAI-compatible provider. Image, video, voice, and transcription models use the services configured in **Settings → AI Services**.

The providers and models shown are examples; actual availability depends on your credentials, provider account access, and platform.

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
<td align="center" width="20%"><img src="https://github.com/MiniMax-AI.png?size=80" alt="MiniMax" width="40" height="40" /><br /><strong>MiniMax</strong></td>
</tr>
</table>

### Image

<table>
<tr>
<td align="center" width="25%"><img src="./docs/images/models/openai.png" alt="OpenAI" width="40" height="40" /><br /><strong>GPT Image</strong></td>
<td align="center" width="25%"><img src="./docs/images/models/jimeng.png" alt="Jimeng" width="40" height="40" /><br /><strong>Seedream 4.0</strong><br />Jimeng</td>
<td align="center" width="25%"><img src="./docs/images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1</strong><br />Kling Image</td>
<td align="center" width="25%"><img src="./docs/images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Nano Banana</strong><br />Gemini 2.5 Flash Image</td>
</tr>
</table>

### Video

<table>
<tr>
<td align="center" width="33%"><img src="./docs/images/models/seedance.png" alt="Seedance" width="40" height="40" /><br /><strong>Seedance 2.5</strong></td>
<td align="center" width="33%"><img src="./docs/images/models/kling.png" alt="Kling" width="40" height="40" /><br /><strong>Kling v2.1 Master</strong></td>
<td align="center" width="33%"><img src="./docs/images/models/gemini.png" alt="Gemini" width="40" height="40" /><br /><strong>Veo 3.1</strong></td>
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

Local transcription also supports faster-whisper, WhisperKit, and whisper.cpp where available.

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

### Video Generation

Generate an AI video from a text prompt or reference image with Seedance. Configure the model, aspect ratio, resolution, and duration, then preview, regenerate, or download each version from the project workspace.

![OpenCreator Video Generation with Seedance](./docs/images/examples/video-generation-seedance-en.png)

### Video Downloader

Analyze a public video link, compare the available formats, and download video or audio directly to the project.

![OpenCreator Video Downloader format selection](./docs/images/examples/video-downloader-formats-en.png)

### Stick Figure Animation

OpenCreator developed this original character collection in collaboration with artist [Harbor Hsia](https://www.behance.net/xiaheyuan1), creator of [Stickman on Behance](https://www.behance.net/gallery/254715463/Stickman). The built-in cast keeps character identities consistent throughout the animation workflow.

![OpenCreator stick figure characters developed with artists](./docs/images/examples/stick-figure-characters.webp)

Turn text or YouTube content into a complete animation through a guided workflow for script review, narration, timing, storyboard visuals, subtitles, rendering, and downloadable video output.

![OpenCreator stick figure animation example frame](./docs/images/examples/stick-figure-animation-frame.jpg)

## Quick Start

### Install the Desktop App

Download the installer for your platform from the [latest OpenCreator release](https://github.com/krillinai/OpenCreator/releases/latest) (macOS Apple Silicon, macOS Intel, or Windows x64). Install and open the app; you do not need Node.js or pnpm to use the Desktop app. The Desktop package includes Codex CLI, but real model tasks require a valid Codex login.

On first launch, OpenCreator starts the local Runtime and prepares a default project. Once connected, enter your request in the composer to start a task. If you run into trouble, see the [user guide and troubleshooting](./docs/opencreator-user-guide-and-troubleshooting.md).

### Run Web from Source

For development or browser-based use, install:

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
| `pnpm krillinai:package` | Separate KrillinAI Server and CLI archives for the selected platform |

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

Before submitting a change, choose verification that matches its impact, as described in the [contributing guide](./CONTRIBUTING.md#what-reviewers-check). Docs, copy, and style changes need only relevant checks; shared behavior and Runtime changes need targeted module tests and typechecks. Run full workspace tests or builds when the affected scope requires them, and report what you ran in the PR.

Changes to Desktop, Host Bridge, the Runtime proxy, or shared frontend workflows also require Web/Desktop consistency tests, packaged application E2E, and Web build hash verification. Passing Web unit tests alone does not establish Desktop release readiness.

The real Codex smoke test is disabled by default. Enable it explicitly with:

```bash
OPENCREATOR_RUN_REAL_CODEX_SMOKE=1 \
pnpm --filter @opencreator/daemon test -- test/smoke/real-codex-smoke.test.ts
```

## Documentation

- **Use OpenCreator:** [Quick Start](#quick-start) · [User guide and troubleshooting](./docs/opencreator-user-guide-and-troubleshooting.md)
- **Develop and extend:** [Contributing guide](./CONTRIBUTING.md) · [Contributing a Skill](./docs/contributing/skills-contributing.md) · [Contributing a creation template](./docs/contributing/templates-contributing.md) · [Runtime API v1](./docs/runtime-api-for-ui-v1.md) · [Visual component guidelines](./docs/visual-component-guidelines.md)
- **Maintain and release:** [Codex-native Runtime design](./docs/2026-07-03-codex-native-agent-runtime-design.md) · [Desktop release runbook](./docs/operations/opencreator-desktop-release-runbook.md) · [Windows Desktop release guide](./docs/operations/opencreator-desktop-windows-release.md)

## Translation Convention

The root `README.md` is the canonical English document. Maintained translations live at `docs/<locale>/README.md`. Add a language to the switcher only after its full document has been translated and synchronized with the English structure.

## The Crew

Each crew member is responsible for their area, including its standards, contribution reviews and merges, and community support.

<table border="1" cellpadding="12">
  <tr>
    <td align="center" valign="middle" width="160" height="160"><img src="./docs/images/contributors/wulien.svg" width="64" height="64" alt="wulien avatar" /><br /><a href="https://github.com/wulien">wulien</a><br />Code &amp; Bug Fixes</td>
    <td align="center" valign="middle" width="160" height="160"><img src="./docs/images/contributors/dle-kb.svg" width="64" height="64" alt="DLe-kb avatar" /><br /><a href="https://github.com/DLe-kb">DLe-kb</a><br />Creation templates</td>
    <td align="center" valign="middle" width="160" height="160"><img src="./docs/images/contributors/xiaheyuan.svg" width="64" height="64" alt="xiaheyuan avatar" /><br /><a href="https://github.com/xiaheyuan">xiaheyuan</a><br />Design &amp; assets</td>
    <td align="center" valign="middle" width="160" height="160"><img src="./docs/images/contributors/krillinai.svg" width="64" height="64" alt="krillinai avatar" /><br /><a href="https://github.com/krillinai">krillinai</a><br />Skills &amp; Docs</td>
  </tr>
</table>

## Contributing

Contributions are welcome in these areas:

| Type | What to contribute | Where it lives | Ship size |
| --- | --- | --- | --- |
| Code | Bug fixes, creator workflows, shared features | `apps/web/`, `apps/daemon/` | One focused PR with tests |
| Skills | Reusable Agent workflows | [`skills/`](./skills/) | One folder with `SKILL.md` and optional references → [guide](./docs/contributing/skills-contributing.md) |
| Creation templates | Reusable image, video, or cover presets | [`template/`](./template/) | One folder with `template.json` plus assets → [guide](./docs/contributing/templates-contributing.md) |
| Illustration and design | Original illustrations, icons, or UI designs | An agreed asset location | One PR with previews, source files, and license |
| Third-party service integrations | AI or media provider support | Relevant Web or Daemon modules | One PR with error handling, credential safety, and tests |
| Documentation and translations | Docs improvements or new locales | `README.md`, `docs/`, `docs/<locale>/` | One PR |

The full guide — including local setup, review criteria, and common rejection patterns — lives in [CONTRIBUTING.md](./CONTRIBUTING.md) (available in [10 languages](./docs/zh/CONTRIBUTING.md)).

## Contributors

Thanks to everyone who has taken part through code, documentation, feedback, issue reports, Skills, designs, and ideas.

<div>
  <a href="https://github.com/maranello-o"><img src="./docs/images/contributors/maranello-o.svg" width="48" height="48" alt="maranello-o" /></a>
  <a href="https://github.com/wulien"><img src="./docs/images/contributors/wulien.svg" width="48" height="48" alt="wulien" /></a>
  <a href="https://github.com/puji4810"><img src="./docs/images/contributors/puji4810.svg" width="48" height="48" alt="puji4810" /></a>
  <a href="https://github.com/krillinai"><img src="./docs/images/contributors/krillinai.svg" width="48" height="48" alt="krillinai" /></a>
  <a href="https://github.com/PairZhu"><img src="./docs/images/contributors/pairzhu.svg" width="48" height="48" alt="PairZhu" /></a>
  <a href="https://github.com/Mijaelx"><img src="./docs/images/contributors/mijaelx.svg" width="48" height="48" alt="Mijaelx" /></a>
  <a href="https://github.com/OutisLi"><img src="./docs/images/contributors/outisli.svg" width="48" height="48" alt="OutisLi" /></a>
  <a href="https://github.com/yeager"><img src="./docs/images/contributors/yeager.svg" width="48" height="48" alt="yeager" /></a>
  <a href="https://github.com/catwithtudou"><img src="./docs/images/contributors/catwithtudou.svg" width="48" height="48" alt="catwithtudou" /></a>
  <a href="https://github.com/newdee"><img src="./docs/images/contributors/newdee.svg" width="48" height="48" alt="newdee" /></a>
  <a href="https://github.com/scwf"><img src="./docs/images/contributors/scwf.svg" width="48" height="48" alt="scwf" /></a>
  <a href="https://github.com/xiaheyuan"><img src="./docs/images/contributors/xiaheyuan.svg" width="48" height="48" alt="xiaheyuan" /></a>
  <a href="https://github.com/hbxugang"><img src="./docs/images/contributors/hbxugang.svg" width="48" height="48" alt="hbxugang" /></a>
  <a href="https://github.com/kapil971390"><img src="./docs/images/contributors/kapil971390.svg" width="48" height="48" alt="kapil971390" /></a>
  <a href="https://github.com/octo-patch"><img src="./docs/images/contributors/octo-patch.svg" width="48" height="48" alt="octo-patch" /></a>
  <a href="https://github.com/yuanjinghh"><img src="./docs/images/contributors/yuanjinghh.svg" width="48" height="48" alt="yuanjinghh" /></a>
  <a href="https://github.com/DLe-kb"><img src="./docs/images/contributors/dle-kb.svg" width="48" height="48" alt="DLe-kb" /></a>
  <a href="https://github.com/liupig"><img src="./docs/images/contributors/liupig.svg" width="48" height="48" alt="liupig" /></a>
</div>


## Star History

OpenCreator was formerly named KrillinAI. This chart covers the repository's full history across the rename.

[![OpenCreator Star History](https://api.star-history.com/svg?repos=krillinai/OpenCreator&type=date)](https://www.star-history.com/?type=date&repos=krillinai%2FOpenCreator)

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
