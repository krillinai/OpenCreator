---
name: krillinai-cli
description: Use when an agent needs to build or operate the embedded KrillinAI CLI, choose a supported command, or interpret its JSON, manifest, subtitle, dubbing, render, cover, speech, and voice outputs.
---

# KrillinAI CLI

Use this as the top-level routing skill for KrillinAI command-line work.

## Build And Locate The Binary

Build both KrillinAI binaries through the repository script:

```bash
pnpm krillinai:build
```

For the current machine, locate the CLI without assuming a platform or architecture:

```bash
TARGET="$(node -p "process.platform + '-' + process.arch")"
SUFFIX="$(node -p "process.platform === 'win32' ? '.exe' : ''")"
KRILLINAI_CLI="$PWD/.runtime/build/krillinai/$TARGET/bin/krillinai-cli$SUFFIX"
test -f "$KRILLINAI_CLI"
```

The CLI loads `config/config.toml` relative to its process working directory. For real runs from a source checkout, use `runtime/krillinai` as the process working directory and create its ignored `config/config.toml` from `config/config-example.toml` without overwriting an existing file. A release archive should be run from its unpacked package root.

For build layout, configuration, JSON, manifest, output, and error details, read:

```text
skills/krillinai-cli/references/cli-contract.md
```

## Choose The Command

| User intent | Command / skill |
|---|---|
| Generate source, target, bilingual, and short vertical subtitles | `subtitle`; use `krillinai-subtitle` |
| Generate target-language dubbing from subtitles | `tts`; use `krillinai-tts` |
| Create landscape videos | `render-horizontal`; use `krillinai-render-horizontal` |
| Create portrait/short-form videos | `render-vertical`; use `krillinai-render-vertical` |
| Generate a cover from a complete image prompt | `cover`; use `krillinai-cover` |
| Generate speech from plain text | `speech` |
| List provider voice codes for Aliyun, OpenAI, or MiniMax | `voices` |
| Validate a requested multi-stage output plan | `pipeline --dry-run`; use `krillinai-pipeline` |

`pipeline` only validates plans in dry-run mode; non-dry-run execution returns `unsupported_command`. `status` is reserved and unsupported.

## Operating Rules For Agents

- Use a dedicated `--workdir`; do not scatter outputs in the repo root.
- Use `--dry-run` for command-shape validation before external calls.
- Parse stdout as JSON lines. The terminal response is the object containing `ok`; OpenCreator mode may emit progress frames first.
- Treat `krillinai_manifest.json` and actual output files as the source of truth after a real stage.
- Reuse manifest outputs for later stages instead of guessing filenames.
- If a command fails, classify by `error.kind`: `usage`, `retryable`, `dependency`, or `internal`.
- Avoid rerunning expensive stages if the manifest already has valid upstream outputs.
- Do not claim that `cover` consumed a reference image: the current CLI accepts a complete text prompt and size only.
- Do not request an Edge TTS voice catalog: `voices` currently supports `aliyun`, `openai`, and `minimax`.

## Minimal Workflow

```bash
REPO_ROOT="$PWD"
WORKDIR="$REPO_ROOT/tasks/demo"
mkdir -p "$WORKDIR"

(cd "$REPO_ROOT/runtime/krillinai" && "$KRILLINAI_CLI" subtitle \
  "https://www.youtube.com/watch?v=VIDEO_ID" \
  --origin-lang en \
  --target-lang zh_cn \
  --workdir "$WORKDIR" \
  --caption-source any \
  --prepare-video)

(cd "$REPO_ROOT/runtime/krillinai" && "$KRILLINAI_CLI" render-vertical \
  --workdir "$WORKDIR")
```
