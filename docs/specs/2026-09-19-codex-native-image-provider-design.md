# Codex Native Image Provider — Design

> Status: approved for implementation (2026-09-19)
> Scope: experimental local image generation through the authenticated Codex subscription

## Goal

Add a `codex-native` image provider to OpenCreator. It must ask the locally installed Codex CLI/app-server to use its native image-generation capability and import the resulting local artifact into the existing OpenCreator image pipeline.

The provider is explicitly subscription-only. It must not call the OpenAI Images API, any other paid image API, or silently fall back to one.

## Evidence and existing seams

- The user's authenticated Codex CLI generated a PNG and saved it under the Codex generated-images directory without an API key.
- OpenCreator already has a structured Codex app-server host and generated protocol types for an `imageGeneration` item with `savedPath` and `failure` fields. The installed Codex build also demonstrated a compatibility gap: it created the subscription artifact locally but did not expose a matching structured notification to the host callback.
- The existing app-server argv builder disables `image_generation` when its built-in-tool isolation list is supplied. The native provider therefore must use the existing host without that isolation list.

## Architecture

1. Extend the shared image-provider union and provider catalog with `codex-native`.
2. Add a local provider configuration with no credential fields. Runtime-only options are supplied by the daemon: Codex executable, `CODEX_HOME`, workspace directory, and bounded timeout.
3. Implement a small adapter around `createCodexAppServerHost`:
   - start one authenticated app-server host;
   - start a thread and one turn with the requested prompt;
   - instruct the turn to generate exactly one image with the native image tool;
   - prefer `item/completed` and select the `imageGeneration` item;
   - when the installed Codex build omits that notification, snapshot `CODEX_HOME/generated_images` before the turn, scope discovery to the Codex thread directory when available, and import exactly one new valid image artifact created by that turn;
   - require a valid local `savedPath` or an unambiguous new local artifact, then copy the artifact into the normal image result pipeline;
   - close the host and clean up in `finally`.
4. Allow only artifacts inside the request workspace or `CODEX_HOME/generated_images`, with PNG/JPEG/WebP signatures and a bounded file size. Reject file URIs, paths, malformed notifications, missing artifacts, failures, timeouts, and non-zero host exits as local provider errors.
5. Integrate the adapter before remote providers in the existing provider dispatcher. The `codex-native` branch must contain no `fetch`/API-key fallback path.
6. Expose the provider in the shared settings/catalog UI with a clear subscription/local label and no API-key input. Reference-image editing and multi-count generation remain unsupported in this MVP.

## Failure and safety contract

- Missing/invalid Codex executable or home: local configuration/unavailable error.
- Missing/ambiguous local artifact, explicit image-generation failure, timeout, malformed path, invalid image signature, or oversized artifact: local generation error.
- Never log `CODEX_HOME` credentials, tokens, environment contents, or the generated image bytes.
- Never pass `--dangerously-bypass-approvals-and-sandbox`.
- Never invoke a remote image endpoint from the native provider.

## MVP and non-goals

MVP supports one text-to-image request and the existing OpenCreator image result/storage flow. It does not add reference-image editing, multi-image batches, image-to-video, Stickman-specific prompt orchestration, Desktop-only UI, or a new Codex protocol generator. Those can be added after the adapter is stable against the checked-in protocol bindings.

## Acceptance evidence

- Protocol/config/catalog tests prove `codex-native` has no credentials and is selectable.
- Adapter tests use a fake app-server host and cover success, missing/malformed `savedPath`, invalid image bytes, explicit failure, timeout/cancellation, non-zero host failure, and the absence of a paid fallback.
- Existing image-generation and Creator image-executor tests remain green.
- One real smoke test uses the authenticated local Codex session to generate one image and verifies the imported artifact; no API key or paid image endpoint is configured.
