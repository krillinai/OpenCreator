# Publishing to social platforms (Upload-Post)

OpenCreator can publish a finished Stick Figure Animation video to **TikTok, Instagram, YouTube, LinkedIn, Facebook, X, Threads, and Bluesky** from the **Video delivery** step, through [Upload-Post](https://upload-post.com). It is optional: nothing is sent anywhere until you configure it and confirm a publish.

> Upload-Post is a hosted third-party service. Its free plan covers 10 uploads a month on every platform above except TikTok, which needs a paid plan.

## Setup

1. Create an account at [upload-post.com](https://upload-post.com), create a **profile**, and connect the social accounts you want to post from to that profile.
2. Create an API key in the Upload-Post dashboard.
3. In **Settings → AI Services → Publishing**, enter the API key and the profile name, then save. The key is stored in `credentials.json` with the other service credentials; the profile name goes in `config.toml`.

## Publishing a video

When a delivery is ready, the **Video delivery** step shows a **Publish to social platforms** panel:

- Pick the platforms. Vertical (9:16) videos default to TikTok, Instagram, and YouTube; landscape videos default to YouTube and LinkedIn.
- The title/caption and description are prefilled from the approved script and can be edited.
- YouTube defaults to **Private**. TikTok defaults to the account's own privacy setting.
- **Label as AI-generated content** is on by default and sets the AI-content disclosure on the platforms that have one (TikTok, Instagram, YouTube, and X).
- **Publish…** asks for confirmation before anything is uploaded. Each result links to the published post, or explains why a platform was skipped (not connected to the profile) or failed.

If publishing is not configured, the panel links to the settings page instead of offering a publish button.

Only a **publishable** delivery can be published. If the delivery manifest is a technical draft, still has placeholder assets, or lists unresolved blocking checks, the panel explains which ones instead of offering to publish, and the Daemon rejects both the confirmation and the stage for the same reasons. Resolve the checks and regenerate the delivery first.

## How it works

- Publishing is the optional `social-publish` stage of the `stickman-video` template (executor `upload-post-publish`). The workflow never queues it on its own.
- The user-only `confirm-social-publish` action records what to publish (platforms, copy, privacy, and the delivery manifest it applies to) in the job state. The Agent cannot confirm a publish, and `update-settings` / `undo-action` cannot write that confirmation.
- The stage publishes one confirmation **at most once**. Its id is sent to Upload-Post as both `request_id` and `Idempotency-Key`, and the provider request ledger refuses a second submission for the same confirmation; publishing again needs a new confirmation. Only a definitive rejection (an HTTP 4xx other than 408, where Upload-Post created nothing) lets the same confirmation be retried, for example after fixing the API key.
- The video is uploaded once with `async_upload=true`, and the stage polls `GET /api/uploadposts/status` until every platform finishes (up to 10 minutes; after that the result is recorded as `submitted`). If the connection drops mid-upload, or Upload-Post answers with a 5xx or an unreadable response, the file is not re-sent: the stage looks the request up by its id and keeps tracking it if it exists; otherwise the request is marked as unknown and goes through the existing provider-request resolution flow.
- Results are written to a `social_publish_result` artifact (`social-publish.json`) and do not create a new result version.
- The request goes through the proxy configured in **AI Services** when one is set.

API reference: [docs.upload-post.com](https://docs.upload-post.com).
