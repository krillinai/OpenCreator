import type { CreatorArtifact, CreatorStageRun } from '@opencreator/protocol';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialogProvider } from '../../components/dialogs/ConfirmDialogProvider.js';
import {
  StickmanSocialPublishPanel,
  type PublishingConfigurationStatus,
  type SocialPublishDeliveryState
} from './StickmanSocialPublishPanel.js';

const l = (_chinese: string, english: string) => english;

describe('StickmanSocialPublishPanel', () => {
  it('links to the publishing settings instead of showing a dead publish button', () => {
    renderPanel({ configuration: 'missing' });

    expect(screen.getByRole('link', { name: 'Set up publishing' }))
      .toHaveAttribute('href', '#/settings?tab=ai-services&section=publishing');
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
  });

  it('publishes only after the user confirms, with YouTube private by default', async () => {
    const user = userEvent.setup();
    const onPublish = vi.fn(async () => undefined);
    renderPanel({ onPublish });

    await user.click(screen.getByRole('checkbox', { name: 'Instagram' }));
    await user.click(screen.getByRole('button', { name: 'Publish…' }));
    expect(onPublish).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(onPublish).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Publish…' }));
    await user.click(screen.getByRole('button', { name: 'Publish' }));
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith({
      platforms: ['tiktok', 'youtube'],
      title: 'How RAG works',
      description: 'Stick figures explain retrieval.',
      youtubePrivacy: 'private',
      tiktokPrivacy: 'account-default',
      aiGenerated: true
    }));
  });

  it('shows per-platform results for the current delivery', () => {
    renderPanel({
      artifacts: [publishResult('manifest-1', [
        { platform: 'youtube', status: 'completed', url: 'https://www.youtube.com/watch?v=abc', postId: 'abc', note: null, error: null, inbox: false },
        { platform: 'tiktok', status: 'completed', url: null, postId: null, note: null, error: null, inbox: true },
        { platform: 'x', status: 'failed', url: null, postId: null, note: null, error: 'Duplicate content', inbox: false }
      ])]
    });

    expect(screen.getByRole('link', { name: 'Open youtube' }))
      .toHaveAttribute('href', 'https://www.youtube.com/watch?v=abc');
    expect(screen.getByText('Sent to TikTok drafts; publish it from the app')).toBeInTheDocument();
    expect(screen.getByText('Duplicate content')).toBeInTheDocument();
  });

  it('blocks a technical draft and explains the unresolved checks instead of offering to publish', () => {
    const onPublish = vi.fn(async () => undefined);
    renderPanel({
      onPublish,
      delivery: {
        packageStatus: 'technical-draft',
        placeholderAssets: ['shot-02'],
        blockingChecks: ['visual_ocr_unverified']
      }
    });

    expect(screen.getByText('The delivery is still a technical draft')).toBeInTheDocument();
    expect(screen.getByText('Placeholder assets remain: shot-02')).toBeInTheDocument();
    expect(screen.getByText('Unresolved publishing checks: visual_ocr_unverified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'TikTok' })).not.toBeInTheDocument();
    expect(onPublish).not.toHaveBeenCalled();
  });

  it('keeps publishing disabled until the delivery verdict has loaded', () => {
    renderPanel({ delivery: null });
    expect(screen.getByRole('button', { name: 'Publish…' })).toBeDisabled();
  });

  it('locks the form while a publish is running', () => {
    renderPanel({
      stages: [{
        id: 'run-1', jobId: 'job-1', stageId: 'social-publish', executor: 'upload-post-publish',
        status: 'running', progress: { completed: 1, total: 2 }
      } as unknown as CreatorStageRun]
    });

    expect(screen.getByRole('button', { name: 'Publishing 1/2' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'TikTok' })).toBeDisabled();
  });
});

function renderPanel(overrides: {
  configuration?: PublishingConfigurationStatus;
  delivery?: SocialPublishDeliveryState | null;
  artifacts?: CreatorArtifact[];
  stages?: CreatorStageRun[];
  onPublish?: () => Promise<void>;
} = {}) {
  return render(
    <ConfirmDialogProvider>
      <StickmanSocialPublishPanel
        l={l}
        configuration={overrides.configuration ?? 'configured'}
        deliveryManifestArtifactId="manifest-1"
        {...(overrides.delivery === null ? {} : {
          delivery: overrides.delivery ?? { packageStatus: 'publishable', placeholderAssets: [], blockingChecks: [] }
        })}
        ratio="9:16"
        defaultTitle="How RAG works"
        defaultDescription="Stick figures explain retrieval."
        artifacts={overrides.artifacts ?? []}
        stages={overrides.stages ?? []}
        onPublish={overrides.onPublish ?? (async () => undefined)}
      />
    </ConfirmDialogProvider>
  );
}

function publishResult(manifestId: string, results: unknown[]): CreatorArtifact {
  return {
    id: 'result-1',
    jobId: 'job-1',
    kind: 'social_publish_result',
    version: 1,
    status: 'completed',
    path: null,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: { deliveryManifestArtifactId: manifestId, publishStatus: 'partial', results: results as never },
    createdAt: '2026-09-29T00:00:00.000Z'
  };
}
