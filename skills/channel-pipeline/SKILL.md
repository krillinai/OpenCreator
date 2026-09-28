---
name: channel-pipeline
description: Use when an agent needs to run the Channel short-video automation pipeline for search, ingest, transcription, subtitles, TTS, rendering, publishing, status, platform auth, or Baidu sync from a configured Channel checkout.
---

# Channel Pipeline

Use this skill to operate the Channel repository as the local short-video distribution engine. OpenCreator is the product shell; Channel owns the pipeline state, media stages, and platform adapters.

## Prerequisites

- A local Channel checkout.
- Python 3.12 and uv.
- `CHANNEL_REPO` must point to the Channel checkout root. If it is unset, ask the user for the path; do not guess a user-specific path.
- On first use, install dependencies once with `uv sync`.
- Treat `data/state.db`, `data/output/`, and `secrets/` as user data. Do not delete or overwrite them.
- Never set `--force` unless the user explicitly confirms that they want to bypass the compliance gate.

## Locate And Probe The CLI

```bash
CHANNEL_REPO="${CHANNEL_REPO:?Set CHANNEL_REPO to the Channel checkout root}"
cd "$CHANNEL_REPO"
uv sync
uv run --no-sync pipeline status
```

`status` reports the data directory, ffmpeg availability, job counters, and the five most recent jobs.

## Command Map

| User intent | Command |
|---|---|
| Show pipeline status | `uv run --no-sync pipeline status` |
| Search and download candidates | `uv run --no-sync pipeline search "keyword" --platform bilibili --limit 3` |
| Preview search without downloading | `uv run --no-sync pipeline search "keyword" --dry-run` |
| Ingest one URL | `uv run --no-sync pipeline ingest --url <URL> --source <self\|licensed\|cc\|rework\|unknown>` |
| Ingest local inbox files | `uv run --no-sync pipeline ingest --inbox --source <self\|licensed\|cc\|rework\|unknown>` |
| Process pending jobs | `uv run --no-sync pipeline process` |
| Process one job | `uv run --no-sync pipeline process <job_id>` |
| Publish one job | `uv run --no-sync pipeline publish <job_id> --to <bilibili,youtube,tiktok,manual>` |
| Run one inbox/process/publish sweep | `uv run --no-sync pipeline run --to <platforms>` |
| Run unattended sweeps | `uv run --no-sync pipeline run --watch --to <platforms>` |
| Sync finished videos to Baidu Netdisk | `uv run --no-sync pipeline sync baidu <job_id>` |

For platform login, see `references/channel-cli.md`.

## Operating Rules

- Prefer explicit `status` → `ingest`/`search` → `process` → `publish` over `run` when the user needs review points.
- `search` defaults to `--source unknown`, so found material is blocked from automatic publishing by design. Only change the source when the user states the licensing or ownership basis.
- `pipeline run` does not search; it sweeps inbox, processes pending jobs, then publishes ready jobs.
- Publish commands are idempotent: already-published platforms are skipped.
- Treat actual output files and `publishes` rows as the source of truth after a stage; do not infer success from a non-zero file count alone.
- If a platform returns a compliance-block message, report the reason and wait for the user's licensing decision instead of bypassing it.

## Verification

- After search or ingest, run `status` and report the new job ID and content hash.
- After process, confirm the job is `ready`.
- After publish, report each platform result from stdout, including skipped and failed entries.
- After `sync baidu`, report the uploaded file name and `fs_id`.
- For command flags, failures, and auth behavior, read `references/channel-cli.md`.
