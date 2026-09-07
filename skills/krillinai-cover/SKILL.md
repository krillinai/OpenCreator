---
name: krillinai-cover
description: Use when generating a cover image with the KrillinAI CLI from a complete image prompt, including validating image-provider configuration and inspecting the generated image and saved prompt.
---

# KrillinAI Cover

Use this skill for the implemented `cover` command. Read `skills/krillinai-cli/references/cli-contract.md` first for binary location, execution working directory, configuration, and JSON behavior.

## Command

```bash
(cd "$KRILLINAI_CWD" && "$KRILLINAI_CLI" cover \
  --workdir "$WORKDIR" \
  --prompt "$COVER_PROMPT" \
  --size 1536x1024)
```

The prompt must already contain the desired title text, language, composition, visual style, and any useful source-video context. The current CLI does not expose a reference-image argument and does not automatically send `origin_cover.jpg` to the image model.

## Inputs

- `--workdir`: an existing or new task directory.
- `--prompt`: required final prompt sent to the configured image model.
- `--size`: optional image size; the default is `1024x1024`.
- `[image]` configuration in `<execution-cwd>/config/config.toml`.

## Outputs

- `generated_cover.png`
- `cover_prompt.final.txt`
- `krillinai_manifest.json`

## Dry Run

`cover --dry-run` validates the command and writes a manifest, but it does not call the image model or create `generated_cover.png`.

## Verification

- Require terminal JSON with `"ok": true`.
- Read output paths from the terminal response or manifest.
- Confirm `generated_cover.png` is non-empty and decodable as an image.
- Confirm `cover_prompt.final.txt` exactly records the submitted prompt.
- If provider configuration is missing or generation fails, report the returned error rather than treating the manifest alone as success.
