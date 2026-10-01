import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import {
  socialPublishDescriptionMaxLength,
  socialPublishPlatforms,
  socialPublishTiktokPrivacy,
  socialPublishTitleMaxLength,
  socialPublishYoutubePrivacy,
  type SocialPublishConfirmation
} from '@opencreator/protocol';
import { stickmanDeliveryManifestSchema } from './contracts.js';

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

export type SocialPublishDeliveryCheck =
  | { publishable: true }
  | { publishable: false; reasons: string[] };

/**
 * Publishing is a public side effect, so it follows the delivery's own verdict:
 * a technical draft, placeholder assets or unresolved blocking checks all stop it.
 */
export function checkPublishableDelivery(manifestPath: string | null): SocialPublishDeliveryCheck {
  let manifest: z.infer<typeof stickmanDeliveryManifestSchema>;
  try {
    if (manifestPath === null) throw new Error('missing');
    manifest = stickmanDeliveryManifestSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch {
    return { publishable: false, reasons: ['the delivery manifest is missing or invalid'] };
  }
  const reasons: string[] = [];
  if (manifest.packageStatus !== 'publishable') reasons.push('the delivery is a technical draft');
  if (manifest.placeholderAssets.length > 0) {
    reasons.push(`placeholder assets remain: ${manifest.placeholderAssets.join(', ')}`);
  }
  if (manifest.blockingChecks.length > 0) {
    reasons.push(`blocking checks are unresolved: ${manifest.blockingChecks.join(', ')}`);
  }
  return reasons.length === 0 ? { publishable: true } : { publishable: false, reasons };
}

export function notPublishableMessage(reasons: string[]): string {
  return `Only a publishable delivery can be published to social platforms (${reasons.join('; ')})`;
}
