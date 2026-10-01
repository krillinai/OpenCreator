/**
 * Publishing a finished Creator video to social platforms.
 *
 * Publishing is a public, hard-to-undo side effect, so it never runs as part
 * of a workflow: a user first records a confirmation (`confirm-social-publish`,
 * user actor only) and the `social-publish` stage then consumes exactly that
 * confirmation once.
 */

export const socialPublishPlatforms = [
  'tiktok',
  'instagram',
  'youtube',
  'linkedin',
  'facebook',
  'x',
  'threads',
  'bluesky'
] as const;
export type SocialPublishPlatform = (typeof socialPublishPlatforms)[number];

export function isSocialPublishPlatform(value: unknown): value is SocialPublishPlatform {
  return socialPublishPlatforms.some(platform => platform === value);
}

export const socialPublishYoutubePrivacy = ['private', 'unlisted', 'public'] as const;
export type SocialPublishYoutubePrivacy = (typeof socialPublishYoutubePrivacy)[number];

/** `account-default` keeps the TikTok account's own default privacy. */
export const socialPublishTiktokPrivacy = [
  'account-default',
  'PUBLIC_TO_EVERYONE',
  'MUTUAL_FOLLOW_FRIENDS',
  'FOLLOWER_OF_CREATOR',
  'SELF_ONLY'
] as const;
export type SocialPublishTiktokPrivacy = (typeof socialPublishTiktokPrivacy)[number];

export const socialPublishTitleMaxLength = 100;
export const socialPublishDescriptionMaxLength = 5000;

/** What the user confirmed; stored on the job state as `socialPublish`. */
export type SocialPublishConfirmation = {
  /** Also sent as Upload-Post `request_id` and `Idempotency-Key`. */
  id: string;
  platforms: SocialPublishPlatform[];
  title: string;
  description: string;
  youtubePrivacy: SocialPublishYoutubePrivacy;
  tiktokPrivacy: SocialPublishTiktokPrivacy;
  aiGenerated: boolean;
  deliveryManifestArtifactId: string;
  confirmedAt: string;
};

export type SocialPublishPlatformStatus =
  | 'completed'
  | 'failed'
  | 'retryable'
  | 'skipped'
  | 'queued'
  | 'processing';

export type SocialPublishPlatformResult = {
  platform: string;
  status: SocialPublishPlatformStatus;
  url: string | null;
  postId: string | null;
  /** Provider note when there is no public link, e.g. a private upload. */
  note: string | null;
  error: string | null;
  /** TikTok delivered the video to the account's drafts instead of posting it. */
  inbox: boolean;
};

/** Contents of the `social_publish_result` artifact. */
export type SocialPublishResult = {
  provider: 'upload-post';
  confirmationId: string;
  requestId: string;
  deliveryManifestArtifactId: string;
  /** `submitted` = accepted but still running when the stage stopped waiting. */
  status: 'completed' | 'partial' | 'failed' | 'submitted';
  platforms: SocialPublishPlatform[];
  results: SocialPublishPlatformResult[];
  finishedAt: string;
};
