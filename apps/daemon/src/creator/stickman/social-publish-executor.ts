import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  CreatorArtifact,
  CreatorJson,
  SocialPublishResult
} from '@opencreator/protocol';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import type { CreatorProviderRequestLedger } from '../provider-requests.js';
import {
  createUploadPostClient,
  UploadPostApiError,
  type UploadPostClient,
  type UploadPostStatus
} from '../publishing/upload-post-client.js';
import { readSocialPublishConfirmation, socialPublishRequestKey } from './social-publish.js';

const finalStatuses = new Set(['completed', 'failed']);
// `registered` never left the machine and `failed` was rejected by Upload-Post before
// it created anything, so only these block a second attempt with the same confirmation.
const acceptedLedgerStatuses = new Set(['submitting', 'waiting_remote', 'unknown_remote_acceptance', 'succeeded']);

export const uploadPostPublishExecutorId = 'upload-post-publish';

export function createUploadPostPublishExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  ledger: CreatorProviderRequestLedger;
  createClient?: (config: { apiKey: string; proxy: string }) => UploadPostClient;
  pollIntervalMs?: number;
  waitTimeoutMs?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => Date;
}): CreatorExecutor {
  const pollIntervalMs = input.pollIntervalMs ?? 10_000;
  const waitTimeoutMs = input.waitTimeoutMs ?? 10 * 60_000;
  const sleep = input.sleep ?? ((ms: number, signal: AbortSignal) => delay(ms, undefined, { signal }));
  const now = input.now ?? (() => new Date());

  return {
    id: uploadPostPublishExecutorId,
    async run(stage) {
      const confirmation = readSocialPublishConfirmation(stage.job.state.socialPublish);
      if (confirmation === undefined) {
        throw new CreatorExecutorError(
          'creator_social_publish_confirmation_required',
          'Publishing requires a confirmation from the user'
        );
      }
      const manifest = requireArtifact(stage.inputArtifacts, 'delivery_manifest');
      if (manifest.id !== confirmation.deliveryManifestArtifactId) {
        throw new CreatorExecutorError(
          'creator_social_publish_confirmation_stale',
          'The confirmed delivery is no longer the latest one; confirm publishing again'
        );
      }
      const requestKey = socialPublishRequestKey(stage.job.id, confirmation.id);
      // One confirmation publishes at most once. Only a request that definitively
      // failed before Upload-Post accepted it may be retried with the same confirmation.
      if (stage.job.providerRequests.some(request => (
        request.requestKey === requestKey && acceptedLedgerStatuses.has(request.status)
      ))) {
        throw new CreatorExecutorError(
          'creator_social_publish_already_submitted',
          'This confirmation was already sent to Upload-Post; confirm publishing again to post again'
        );
      }
      const video = requireArtifact(stage.inputArtifacts, 'clean_video');
      if (video.path === null) {
        throw new CreatorExecutorError('creator_stage_input_missing', 'The delivered video file is unavailable');
      }
      const config = await input.configStore.read();
      const { apiKey, profile } = config.publishing.uploadPost;
      if (apiKey.trim().length === 0 || profile.trim().length === 0) {
        throw new CreatorExecutorError(
          'creator_publishing_config_missing',
          'Configure the Upload-Post API key and profile in AI Services → Publishing'
        );
      }
      const client = (input.createClient ?? createUploadPostClient)({ apiKey, proxy: config.proxy });
      const ledger = input.ledger.registerBeforeSubmit({
        jobId: stage.job.id,
        provider: 'upload-post',
        stageRunId: stage.stageRun.id,
        requestKey,
        request: {
          requestId: confirmation.id,
          profile,
          platforms: confirmation.platforms,
          title: confirmation.title,
          description: confirmation.description,
          youtubePrivacy: confirmation.youtubePrivacy,
          tiktokPrivacy: confirmation.tiktokPrivacy,
          aiGenerated: confirmation.aiGenerated,
          videoArtifactId: video.id
        }
      });
      input.ledger.markSubmitting(ledger.id);
      const total = confirmation.platforms.length;
      stage.reportProgress({ phase: 'uploading', percent: 5, completed: 0, failed: 0, total, ledgerId: ledger.id });

      let accepted = false;
      try {
        await client.submitVideo({
          requestId: confirmation.id,
          profile,
          platforms: confirmation.platforms,
          videoPath: video.path,
          title: confirmation.title,
          description: confirmation.description,
          youtubePrivacy: confirmation.youtubePrivacy,
          tiktokPrivacy: confirmation.tiktokPrivacy,
          aiGenerated: confirmation.aiGenerated,
          signal: stage.signal
        });
        accepted = true;
      } catch (error) {
        if (error instanceof UploadPostApiError) {
          input.ledger.markFailed(ledger.id, error);
          throw new CreatorExecutorError(publishErrorCode(error), error.message, {
            ...(error.status === undefined ? {} : { status: error.status })
          });
        }
        if (stage.signal.aborted) throw error;
        // The upload may have reached Upload-Post before the connection dropped.
        // Never re-send the file: look the request up by its id instead.
      }
      if (!accepted) {
        const found = await client.getStatus(confirmation.id, stage.signal).catch(() => undefined);
        if (found === undefined || found.status === 'not_found') {
          input.ledger.markUnknownRemoteAcceptance(ledger.id);
          throw new CreatorExecutorError(
            'creator_provider_resolution_required',
            'The upload to Upload-Post was interrupted and its outcome is unknown'
          );
        }
      }
      input.ledger.markWaitingRemote(ledger.id, confirmation.id);

      const status = await waitForResult(client, confirmation.id, {
        signal: stage.signal,
        pollIntervalMs,
        deadline: Date.now() + waitTimeoutMs,
        sleep,
        onProgress(current) {
          stage.reportProgress({
            phase: 'publishing',
            percent: Math.min(95, 10 + Math.round((current.completed / Math.max(1, total)) * 85)),
            completed: current.completed,
            failed: current.results.filter(result => result.status === 'failed').length,
            total,
            ledgerId: ledger.id
          });
        }
      });
      input.ledger.markSucceeded(ledger.id);

      const result: SocialPublishResult = {
        provider: 'upload-post',
        confirmationId: confirmation.id,
        requestId: confirmation.id,
        deliveryManifestArtifactId: manifest.id,
        status: summarize(status),
        platforms: confirmation.platforms,
        results: status.results,
        finishedAt: now().toISOString()
      };
      const path = join(stage.workdir, 'social-publish.json');
      await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      const failed = status.results.filter(item => item.status === 'failed').length;
      return {
        outputs: [{
          kind: 'social_publish_result',
          status: 'completed',
          path,
          sourceArtifactIds: [video.id, manifest.id],
          metadata: {
            fileName: 'social-publish.json',
            mimeType: 'application/json',
            provider: 'upload-post',
            requestId: confirmation.id,
            confirmationId: confirmation.id,
            deliveryManifestArtifactId: manifest.id,
            publishStatus: result.status,
            results: status.results as unknown as CreatorJson,
            ledgerId: ledger.id
          }
        }],
        progress: {
          phase: 'completed',
          percent: 100,
          completed: status.results.length - failed,
          failed,
          total,
          ledgerId: ledger.id
        }
      };
    }
  };
}

async function waitForResult(
  client: UploadPostClient,
  requestId: string,
  options: {
    signal: AbortSignal;
    pollIntervalMs: number;
    deadline: number;
    sleep: (ms: number, signal: AbortSignal) => Promise<void>;
    onProgress(status: UploadPostStatus): void;
  }
): Promise<UploadPostStatus & { timedOut?: true }> {
  let last: UploadPostStatus = { status: 'queued', completed: 0, total: null, results: [] };
  for (;;) {
    try {
      last = await client.getStatus(requestId, options.signal);
      options.onProgress(last);
      if (finalStatuses.has(last.status)) return last;
    } catch (error) {
      // A status poll that fails does not undo an accepted upload: keep waiting,
      // unless the key itself stopped working or the stage was stopped.
      if (options.signal.aborted) throw error;
      if (error instanceof UploadPostApiError && error.code === 'upload_post_auth_failed') throw error;
    }
    if (Date.now() >= options.deadline) return { ...last, timedOut: true };
    await options.sleep(options.pollIntervalMs, options.signal);
  }
}

function summarize(status: UploadPostStatus & { timedOut?: true }): SocialPublishResult['status'] {
  if (status.timedOut === true || !finalStatuses.has(status.status)) return 'submitted';
  const published = status.results.filter(result => result.status === 'completed').length;
  const failed = status.results.filter(result => (
    result.status === 'failed' || result.status === 'retryable'
  )).length;
  if (published === 0) return 'failed';
  return failed > 0 || status.results.some(result => result.status === 'skipped') ? 'partial' : 'completed';
}

function publishErrorCode(error: UploadPostApiError): string {
  if (error.code === 'upload_post_auth_failed') return 'creator_publishing_auth_failed';
  if (error.code === 'upload_post_rejected') return 'creator_publishing_rejected';
  if (error.code === 'upload_post_forbidden') return 'creator_publishing_forbidden';
  if (error.code === 'upload_post_rate_limited') return 'creator_publishing_rate_limited';
  return 'creator_publishing_failed';
}

function requireArtifact(artifacts: CreatorArtifact[], kind: string): CreatorArtifact {
  const artifact = [...artifacts].reverse().find(candidate => (
    candidate.kind === kind && candidate.status === 'completed'
  ));
  if (artifact === undefined) {
    throw new CreatorExecutorError('creator_stage_input_missing', `${kind} is required before publishing`);
  }
  return artifact;
}
