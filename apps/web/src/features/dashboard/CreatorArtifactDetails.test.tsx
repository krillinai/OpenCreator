import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreatorActionRequest, CreatorArtifact, CreatorJob, CreatorJson } from '@opencreator/protocol';
import { beforeEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import CreatorArtifactDetails from './CreatorArtifactDetails.js';
import ImageGenerationWorkspace from './ImageGenerationWorkspace.js';
import CoverGeneratorWorkspace from './CoverGeneratorWorkspace.js';

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:artifact') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

function fixture(templateId = 'video-translation', kind = 'target_subtitle') {
  const createdAt = '2026-09-15T01:00:00.000Z';
  const artifacts: CreatorArtifact[] = [1, 2].map(version => ({
    id: `artifact-${version}`, jobId: 'job', kind, version,
    status: version === 1 ? 'stale' : 'completed', path: `/results/result-${version}.${kind === 'target_subtitle' ? 'srt' : 'png'}`,
    scopeKey: null, inputFingerprint: null, sha256: null,
    sourceArtifactIds: version === 2 ? ['artifact-1', 'missing-source'] : [], metadata: {}, createdAt
  }));
  let job: CreatorJob = {
    id: 'job', projectId: 'project', templateId, templateVersion: 2, status: 'completed', revision: 0,
    state: { provider: 'openai', currentStep: 2, furthestStep: 2, resultVersion: 2, latestResultVersion: 2,
      resultSnapshots: artifacts.map((artifact, index) => ({ version: index + 1, createdAt, action: 'stage-succeeded', stageId: 'generate', description: `生成 ${index + 1}`, artifactRefs: { [kind]: [artifact.id] }, changedArtifactIds: [artifact.id], staleArtifactIds: [], state: {} })) as CreatorJson },
    agentThreadId: null, stages: [], artifacts, providerRequests: [], activities: [], createdAt, updatedAt: createdAt
  };
  const applyAction = vi.fn(async (_id: string, request: CreatorActionRequest) => {
    job = { ...job, revision: job.revision + 1, state: { ...job.state, ...(request.action === 'select-result-version' ? { resultVersion: request.input.version! } : request.input.patch as Record<string, CreatorJson>) } };
    return { job, receipt: { actor: 'user' as const, action: request.action, summary: '', affectedArtifacts: [], newRevision: job.revision, createdAt } };
  });
  const openArtifact = vi.fn(async (_jobId: string, id: string) => new Response(id === 'artifact-1' ? 'same\nold' : 'same\nnew'));
  const service = { applyAction, openArtifact, runAgentTurn: vi.fn() };
  return { get job() { return job; }, service, applyAction, openArtifact };
}

function mount(f: ReturnType<typeof fixture>, child = <CreatorArtifactDetails />) {
  return render(<LanguageProvider initialPreference="zh-CN"><CreatorSessionProvider initialJob={f.job} service={f.service}>{child}</CreatorSessionProvider></LanguageProvider>);
}

async function openDetails() {
  fireEvent.click(screen.getByText('产物版本与来源'));
  return screen.findByRole('region', { name: '产物详情' });
}

it('traces sources, highlights text changes, downloads history and keeps stale results explicit', async () => {
  const f = fixture();
  mount(f);
  const details = within(await openDetails());
  expect(details.getByText('来源记录缺失：missing-source')).toBeInTheDocument();
  fireEvent.change(details.getByLabelText('对比版本'), { target: { value: 'artifact-1' } });
  await waitFor(() => expect(details.getByLabelText('版本 1 文本')).toHaveTextContent('old'));
  expect(details.getByLabelText('版本 2 文本').querySelector('.is-changed')).toHaveTextContent('new');
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  fireEvent.click(details.getByRole('button', { name: '下载 V1' }));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(f.openArtifact).toHaveBeenCalledWith('job', 'artifact-1');
  click.mockRestore();
  fireEvent.click(details.getByRole('button', { name: /result-1.srt · V1/ }));
  expect(details.getByText('已过期，非当前有效结果')).toBeInTheDocument();
  expect(details.getByText('已有记录将此结果标记为过期，未记录具体原因。')).toBeInTheDocument();
  expect(f.applyAction).not.toHaveBeenCalled();
});

it.each([
  ['image-generation', 'generated_image', ImageGenerationWorkspace],
  ['cover', 'cover_image', CoverGeneratorWorkspace]
] as const)('shares persisted version selection with the %s workspace and survives remount', async (templateId, kind, Workspace) => {
  const f = fixture(templateId, kind);
  const first = mount(f, <Workspace onBack={() => undefined} />);
  const details = within(await openDetails());
  fireEvent.change(details.getByLabelText('浏览产物（不改变项目选择）'), { target: { value: 'artifact-1' } });
  const adopt = details.getByRole('button', { name: '采用项目版本' });
  fireEvent.click(adopt);
  fireEvent.click(adopt);
  await waitFor(() => expect(f.job.state.resultVersion).toBe(1));
  expect(f.applyAction.mock.calls.filter(([, request]) => request.action === 'select-result-version')).toHaveLength(1);
  expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
  expect(screen.getByText('包含过期结果')).toBeInTheDocument();
  expect(f.job.artifacts).toHaveLength(2);
  first.unmount();
  mount(f, <Workspace onBack={() => undefined} />);
  expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
  const restored = within(await openDetails());
  expect(restored.getByText('已过期，非当前有效结果')).toBeInTheDocument();
  fireEvent.click(restored.getByRole('button', { name: '预览 V1' }));
  await waitFor(() => expect(restored.getByRole('img')).toHaveAttribute('src', 'blob:artifact'));
});

it('does not claim provenance or allow adoption for artifacts without a snapshot', async () => {
  const f = fixture();
  f.job.state.resultSnapshots = [];
  mount(f);
  const details = within(await openDetails());
  expect(details.getByText('未记录生成快照；无法确定 Action / Stage')).toBeInTheDocument();
  expect(details.getByRole('button', { name: '采用项目版本' })).toBeDisabled();
});

it('keeps the adopted version unchanged when the command fails', async () => {
  const f = fixture();
  f.applyAction.mockRejectedValueOnce(new Error('Revision conflict'));
  mount(f);
  const details = within(await openDetails());
  fireEvent.change(details.getByLabelText('浏览产物（不改变项目选择）'), { target: { value: 'artifact-1' } });
  fireEvent.click(details.getByRole('button', { name: '采用项目版本' }));
  await waitFor(() => expect(details.getByRole('alert')).toHaveTextContent('Revision conflict'));
  expect(f.job.state.resultVersion).toBe(2);
  expect(details.getByRole('button', { name: '采用项目版本' })).toBeEnabled();
});
