import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  socialPublishDescriptionMaxLength,
  socialPublishPlatforms,
  socialPublishTiktokPrivacy,
  socialPublishTitleMaxLength,
  socialPublishYoutubePrivacy,
  type SocialPublishConfirmation
} from '@opencreator/protocol';

/** Input of the `confirm-social-publish` action. */
export const socialPublishConfirmationInputSchema = z.object({
  platforms: z.array(z.enum(socialPublishPlatforms)).min(1).max(socialPublishPlatforms.length)
    .refine(platforms => new Set(platforms).size === platforms.length, 'platforms must be unique'),
  title: z.string().trim().min(1).max(socialPublishTitleMaxLength),
  description: z.string().max(socialPublishDescriptionMaxLength).default(''),
  youtubePrivacy: z.enum(socialPublishYoutubePrivacy).default('private'),
  tiktokPrivacy: z.enum(socialPublishTiktokPrivacy).default('account-default'),
  aiGenerated: z.boolean().default(true),
  deliveryManifestArtifactId: z.string().min(1)
}).strict();

const storedConfirmationSchema = socialPublishConfirmationInputSchema.extend({
  id: z.string().uuid(),
  confirmedAt: z.string().min(1)
}).strict();

export function createSocialPublishConfirmation(
  input: z.infer<typeof socialPublishConfirmationInputSchema>,
  now: Date = new Date()
): SocialPublishConfirmation {
  return {
    ...input,
    id: randomUUID(),
    confirmedAt: now.toISOString()
  };
}

export function readSocialPublishConfirmation(value: unknown): SocialPublishConfirmation | undefined {
  const parsed = storedConfirmationSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** Ledger key: one Upload-Post request per user confirmation. */
export function socialPublishRequestKey(jobId: string, confirmationId: string): string {
  return `${jobId}:social-publish:${confirmationId}`;
}

export function confirmationIdFromRequestKey(requestKey: string): string | undefined {
  const match = /:social-publish:([0-9a-f-]{36})$/i.exec(requestKey);
  return match?.[1];
}
