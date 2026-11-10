import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createDefaultCreatorServicesConfig,
  type CreatorActionRequest,
  type CreatorArtifact,
  type CreatorJob,
  type CreatorJson
} from '@opencreator/protocol';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import TranscriptionWorkspace from './TranscriptionWorkspace.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:transcript') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

it('validates a source, uploads local media, and starts source-only transcription', async () => {
  const fixture = createFixture();
  await renderWorkspace(fixture);
  const form = screen.getByRole('form', { name: '视频转录' });
  expect(within(form).queryByRole('button', { name: '开始转录' })).not.toBeInTheDocument();
  fireEvent.click(within(form).getByRole('button', { name: '继续' }));
  expect(screen.getByRole('alert')).toHaveTextContent('请先选择需要转录的视频或音频');
  expect(fixture.applyAction).not.toHaveBeenCalled();

  const file = new File(['video'], 'interview.mp4', { type: 'video/mp4', lastModified: 123 });
  fireEvent.change(screen.getByLabelText('上传本地视频'), { target: { files: [file] } });
  fireEvent.click(within(form).getByRole('button', { name: '继续' }));
  expect(screen.queryByLabelText('上传本地视频')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '视频源语言' })).toBeInTheDocument();
  fireEvent.click(within(form).getByRole('button', { name: '开始转录' }));

  await waitFor(() => expect(fixture.uploadSourceVideo).toHaveBeenCalledWith('transcription-job', expect.objectContaining({ file })));
  await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith('transcription-job', expect.objectContaining({
    action: 'run-stage',
    input: { stageId: 'transcription' }
  })));
  expect(fixture.currentJob().state).toMatchObject({
    sourceType: 'file',
    sourceLanguage: 'zh_cn',
    targetLanguage: 'zh_cn',
    preferPlatformCaptions: false,
    sourceArtifactId: 'source-video'
  });
});

it('accepts a public video URL without uploading a local file', async () => {
  const fixture = createFixture();
  await renderWorkspace(fixture);
  fireEvent.change(screen.getByRole('textbox', { name: '视频链接' }), {
    target: { value: 'https://www.youtube.com/watch?v=transcription' }
  });
  fireEvent.click(screen.getByRole('button', { name: '继续' }));
  fireEvent.click(screen.getByRole('button', { name: '开始转录' }));

  await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith('transcription-job', expect.objectContaining({
    action: 'run-stage', input: { stageId: 'transcription' }
  })));
  expect(fixture.uploadSourceVideo).not.toHaveBeenCalled();
  expect(fixture.currentJob().state).toMatchObject({
    sourceType: 'url',
    sourceUrl: 'https://www.youtube.com/watch?v=transcription'
  });
});

it('opens the subtitle editor, autosaves changes, and downloads results after returning', async () => {
  const fixture = createFixture({ sourceFileName: 'interview.mp4' });
  const source = sourceArtifact(fixture.currentJob());
  const artifact: CreatorArtifact = {
    id: 'subtitle-result', jobId: fixture.currentJob().id, kind: 'source_subtitle', version: 1,
    status: 'completed', path: '/tmp/source.srt', scopeKey: null, inputFingerprint: null,
    sha256: null, sourceArtifactIds: [source.id], createdAt: fixture.currentJob().createdAt,
    metadata: { fileName: 'source.srt', cueCount: 2, resultVersion: 1 }
  };
  const clicks: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicks.push(this.download);
  });
  await renderWorkspace(fixture, {
    ...fixture.currentJob(), status: 'completed', artifacts: [source, artifact]
  });

  const editor = await screen.findByRole('textbox', { name: '横屏字幕 1' });
  expect(editor).toHaveValue('第一句转录');
  expect(screen.getByRole('textbox', { name: '横屏字幕 2' })).toHaveValue('Second transcript line');
  fireEvent.change(editor, { target: { value: '校对后的转录' } });
  await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith('transcription-job', expect.objectContaining({
    action: 'edit-subtitle',
    input: expect.objectContaining({ artifactId: 'subtitle-result', preserveResultVersion: true })
  })), { timeout: 3000 });
  expect(await screen.findByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('校对后的转录');

  const back = screen.getByRole('button', { name: '返回项目' });
  await waitFor(() => expect(screen.queryByLabelText('有未保存的字幕修改')).not.toBeInTheDocument());
  expect(screen.queryByText('字幕保存失败，请重试。')).not.toBeInTheDocument();
  fireEvent.click(back);
  const summary = await screen.findByRole('heading', { name: '转录结果' });
  const summaryPanel = summary.closest('.transcription-output') as HTMLElement;
  expect(within(summaryPanel).getByRole('button', { name: '编辑字幕' })).toBeInTheDocument();
  expect(screen.getByText('校对后的转录')).toBeVisible();
  expect(screen.queryByRole('button', { name: '下载 TXT' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '下载 SRT' })).not.toBeInTheDocument();
  fireEvent.click(within(summaryPanel).getByRole('button', { name: '编辑字幕' }));
  expect(await screen.findByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('校对后的转录');
  fireEvent.click(screen.getByText('导出', { exact: true }));
  expect(screen.getByRole('button', { name: '下载 TXT' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '下载 SRT' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '下载 TXT' }));
  fireEvent.click(screen.getByText('导出', { exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '下载 SRT' }));
  await waitFor(() => expect(clicks).toEqual(['interview.txt', 'source.srt']));
  expect(fixture.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(false);
});

it('only accepts video and audio uploads in the embedded composer', async () => {
  const fixture = createFixture();
  const config = createDefaultCreatorServicesConfig();
  const service = { getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })) };
  render(<LanguageProvider initialPreference="zh-CN"><CreatorSessionProvider initialJob={fixture.currentJob()} service={fixture}>
    <TranscriptionWorkspace embedded onBack={vi.fn()} creatorServicesService={service as unknown as CreatorServicesSettingsService} />
  </CreatorSessionProvider></LanguageProvider>);
  await act(async () => { await Promise.resolve(); });

  expect(screen.getByText('视频 / 音频')).toBeInTheDocument();
  expect(screen.queryByText('视频 / 音频 / SRT')).not.toBeInTheDocument();
  const modelSelect = screen.getByRole('combobox', { name: '语音识别模型' });
  expect(modelSelect.querySelector('img')).toHaveAttribute('src', '/model-brands/openai.svg');
  fireEvent.click(modelSelect);
  expect(screen.getByRole('option', { name: 'WhisperKit · large-v2' }).querySelector('img'))
    .toHaveAttribute('src', '/components/whisperkit.png');
  fireEvent.keyDown(modelSelect, { key: 'Escape' });
  const input = screen.getByLabelText('上传视频或音频');
  expect(input).toHaveAttribute('accept', expect.not.stringContaining('.srt'));
  fireEvent.change(input, { target: { files: [new File(['subtitle'], 'source.srt')] } });
  expect(screen.getByRole('alert')).toHaveTextContent('请选择视频或音频文件');
  expect(fixture.applyAction).not.toHaveBeenCalled();
});

function createFixture(state: Record<string, CreatorJson> = {}) {
  const createdAt = '2026-11-05T00:00:00Z';
  let job: CreatorJob = {
    id: 'transcription-job', projectId: 'project', templateId: 'transcription', templateVersion: 1,
    status: 'draft', revision: 1, presetOrigin: null, agentThreadId: null, stages: [], artifacts: [],
    providerRequests: [], activities: [], createdAt, updatedAt: createdAt,
    state: { sourceType: 'file', sourceUrl: '', sourceLanguage: 'zh_cn', targetLanguage: 'zh_cn', preferPlatformCaptions: false, ...state }
  };
  const applyAction = vi.fn(async (_id: string, request: CreatorActionRequest) => {
    if (request.action === 'edit-subtitle') {
      const source = job.artifacts.find(artifact => artifact.id === request.input.artifactId)!;
      const cues = request.input.cues as Array<{ id: number; start: string; end: string; text: string }>;
      const edited: CreatorArtifact = {
        ...source,
        id: `edited-${job.revision + 1}`,
        version: source.version + 1,
        metadata: { ...source.metadata, cues, editedFromArtifactId: source.id }
      };
      job = {
        ...job, revision: job.revision + 1, artifacts: [...job.artifacts, edited],
        state: { ...job.state, subtitleArtifactId: edited.id }
      };
    } else {
      const patch = request.action === 'update-settings' ? request.input.patch as Record<string, CreatorJson> : {};
      job = { ...job, revision: job.revision + 1, state: { ...job.state, ...patch } };
    }
    return { job, receipt: { actor: 'user' as const, action: request.action, summary: request.action, affectedArtifacts: [], newRevision: job.revision, createdAt } };
  });
  const uploadSourceVideo = vi.fn(async (_jobId: string, input: { file: File }) => {
    const artifact = sourceArtifact(job, input.file);
    job = {
      ...job, revision: job.revision + 1, artifacts: [...job.artifacts, artifact],
      state: { ...job.state, sourceArtifactId: artifact.id, sourceFileName: input.file.name }
    };
    return { job, artifact, deduplicated: false };
  });
  return {
    currentJob: () => job,
    setJob: (next: CreatorJob) => { job = next; },
    applyAction,
    uploadSourceVideo,
    openArtifact: vi.fn(async (_jobId: string, artifactId: string) => {
      const cues = job.artifacts.find(artifact => artifact.id === artifactId)?.metadata.cues as Array<{ id: number; start: string; end: string; text: string }> | undefined;
      if (cues) return new Response(cues.map(cue => `${cue.id}\n${cue.start} --> ${cue.end}\n${cue.text}`).join('\n\n'));
      return new Response('1\n00:00:00,000 --> 00:00:01,500\n第一句转录\n\n2\n00:00:01,500 --> 00:00:03,000\nSecond transcript line\n');
    }),
    runAgentTurn: vi.fn()
  };
}

function sourceArtifact(job: CreatorJob, file?: File): CreatorArtifact {
  return {
    id: 'source-video', jobId: job.id, kind: 'source_video', version: 1, status: 'completed',
    path: '/tmp/interview.mp4', scopeKey: null, inputFingerprint: null, sha256: null,
    sourceArtifactIds: [], createdAt: job.createdAt,
    metadata: { fileName: file?.name ?? 'interview.mp4', bytes: file?.size ?? 100, mimeType: 'video/mp4' }
  };
}

async function renderWorkspace(fixture: ReturnType<typeof createFixture>, job = fixture.currentJob()) {
  fixture.setJob(job);
  const config = createDefaultCreatorServicesConfig();
  const service = { getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })) };
  const view = render(<LanguageProvider initialPreference="zh-CN"><CreatorSessionProvider initialJob={job} service={fixture}>
    <TranscriptionWorkspace onBack={vi.fn()} creatorServicesService={service as unknown as CreatorServicesSettingsService} />
  </CreatorSessionProvider></LanguageProvider>);
  await act(async () => { await Promise.resolve(); });
  return view;
}
