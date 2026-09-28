# Channel CLI contract

## Environment

- `CHANNEL_REPO`: absolute or workspace-relative path to the Channel checkout.
- Python 3.12 and uv must be available.
- `uv sync` installs dependencies; subsequent commands can use `uv run --no-sync`.
- `config/pipeline.yaml` controls transcription, subtitles, TTS, translation, search, and output profiles.
- `config/platforms.yaml` controls platform sizes, throttling, compliance, and publish parameters.

## Commands

| Command | Purpose | Notes |
|---|---|---|
| `pipeline status` | Show environment, job counters, recent jobs | Safe, read-only |
| `pipeline search [KEYWORDS...]` | Search, filter, and download candidates | Use `--dry-run` before downloading; default source is `unknown` |
| `pipeline ingest --url <URL> --source <SOURCE>` | Ingest one URL | Rejects playlists/channels |
| `pipeline ingest --inbox --source <SOURCE>` | Ingest top-level files from `data/inbox/` | Deduplicates by file hash |
| `pipeline process [JOB_ID]` | Move jobs to `ready` | Idempotent; can be rerun after failure |
| `pipeline publish JOB_ID --to <PLATFORMS>` | Publish one job | Idempotent; already-published platforms are skipped |
| `pipeline run [--watch] [--to <PLATFORMS>]` | Sweep inbox, process, publish | Does not perform search |
| `pipeline auth bilibili` | Bilibili login | Requires a real terminal for QR login |
| `pipeline auth youtube` | YouTube OAuth | Requires Google client secret JSON |
| `pipeline auth tiktok` | TikTok OAuth | Requires TikTok client key/secret |
| `pipeline auth baidu` | Baidu Netdisk OAuth | oob flow; token saved under `secrets/` |
| `pipeline sync baidu JOB_ID` | Upload finished videos to Baidu Netdisk | Requires job to be ready and token to be valid |

## Sources and compliance

Valid `--source` values are `self`, `licensed`, `cc`, `rework`, and `unknown`.

- `self` and `licensed` are allowed by the default auto-publish whitelist.
- `cc`, `rework`, and `unknown` are blocked from automatic publishing.
- Non-self sources get an attribution line appended to the description when configured.
- `--force` bypasses the compliance gate and prints a warning. Use it only after the user explicitly accepts the licensing or platform consequences.

## Platform targets

Supported publish targets are:

- `manual`
- `bilibili`
- `youtube`
- `tiktok`

`manual` always writes a publish package so the user can upload by hand. TikTok uses draft mode; treat it as requiring human review.

## State and outputs

- State database: `data/state.db`
- Job workspace: `data/work/{content_hash}/`
- Finished videos: `data/output/{content_hash}/`
- Manual publish package: `data/output/{content_hash}/manual/`
- Job statuses: `discovered`, `downloaded`, `transcribed`, `subtitled`, `edited`, `ready`, `publishing`, `published`, `failed`
- Publish statuses: `pending`, `published`, `failed`

## Failure handling

- A failed process step can be rerun because stages are idempotent.
- TTS failures fall back to the original audio and do not block the processing chain.
- Publish failures are reported per platform; one platform failing does not stop other platforms.
- Baidu upload failures may require re-running `pipeline sync baidu <job_id>`; finished videos are retried without reprocessing.
- Do not delete `data/state.db` or output directories to clear state; inspect `status` and the relevant job first.
