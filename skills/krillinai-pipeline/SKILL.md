---
name: krillinai-pipeline
description: Use when validating or documenting a multi-stage KrillinAI CLI output plan; the current pipeline command supports dry-run planning only, not end-to-end execution.
---

# KrillinAI Pipeline

Use this skill to validate a requested stage plan. Run real work through the individual stage commands because non-dry-run `pipeline` execution returns `unsupported_command`.

## Plan Validation

```bash
(cd "$KRILLINAI_CWD" && "$KRILLINAI_CLI" pipeline \
  --outputs "subtitle,tts,vertical-bilingual" \
  --dry-run)
```

## Outputs Values

| Output | Stage |
|---|---|
| `subtitle` | Generate subtitle files |
| `tts` | Generate dubbing |
| `horizontal-bilingual` | Render landscape bilingual video |
| `horizontal-dubbed` | Render landscape dubbed video |
| `vertical-bilingual` | Render portrait bilingual video |
| `vertical-dubbed` | Render portrait dubbed video |
| `cover` | Generate cover |

The dry-run validates output names and returns a successful pipeline-stage JSON response. It does not execute stages or write a task manifest.

## Execute The Plan

Map the validated outputs to `subtitle`, `tts`, `render-horizontal`, `render-vertical`, and `cover`. Run each required command independently and use the same absolute `--workdir`.

## Recovery Strategy

- If `subtitle` succeeds and render fails, rerun only render with the same `--workdir`.
- If TTS fails, keep subtitle outputs and rerun `tts` after fixing provider config.
- Read `krillinai_manifest.json` before rerunning to avoid repeating expensive work.

## Verification

- Require terminal JSON with `"ok": true` for dry-run validation.
- For real work, confirm every independently executed stage succeeded.
- Confirm manifest stages and requested output files, not just the plan response.
- Inspect final requested media/cover files, not only intermediate outputs.
- For shared CLI details, read `skills/krillinai-cli/references/cli-contract.md`.
