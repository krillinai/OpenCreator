import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig, type CreatorActionRequest, type CreatorArtifact, type CreatorJob, type CreatorJson, type GatewayAccountState } from '@opencreator/protocol';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { appLanguageOptions, type AppLanguage } from '../../i18n/language.js';
import { createLocalizedCopy } from '../../i18n/localized-copy.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import { CreatorSessionProvider } from './creator-session-store.js';
import { OfficialServicesContext } from './official-services.js';
import SmartDubbingWorkspace from './SmartDubbingWorkspace.js';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:dubbing-result') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
});

it.each([false, true])('opens speech style and speed only when the selected official model supports them (%s)', supported => {
  const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true },
    bindingVersion: '1', activationError: null, models: [{ id: 'gemini-3.1-tts', modality: 'speech', voices: ['Kore'], capabilities: supported ? ['speech_instructions', 'speech_speed'] : [] }] };
  render(<LanguageProvider initialPreference="zh-CN"><OfficialServicesContext.Provider value={state}><SmartDubbingWorkspace onBack={vi.fn()} /></OfficialServicesContext.Provider></LanguageProvider>);
  expect(screen.getByRole('textbox', { name: '配音文案内容' })).toBeVisible();
  expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument();
  expect(screen.queryByRole('radiogroup', { name: '表达风格' }) !== null).toBe(supported);
  expect(screen.queryByRole('slider') !== null).toBe(supported);
});

it('validates and submits the complete dubbing form directly without persisting wizard steps', async () => {
  const fixture = createFixture({ voiceCode: '' });
  await renderWorkspace(fixture);
  const form = screen.getByRole('form', { name: '文本转语音' });
  const submit = within(form).getByRole('button', { name: '开始生成' });
  fireEvent.click(submit);
  expect(within(form.parentElement!).getByRole('alert')).toHaveTextContent('请先填写需要配音的文案');
  fireEvent.change(screen.getByRole('textbox', { name: '配音文案内容' }), { target: { value: '  A clear voice.  ' } });
  fireEvent.click(submit);
  expect(within(form.parentElement!).getByRole('alert')).toHaveTextContent('请选择一个可用音色');
  expect(fixture.applyAction.mock.calls.every(([, request]) => request.action !== 'run-stage')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /^配音音色/ }));
  fireEvent.click(await screen.findByRole('radio', { name: 'Cedar' }));
  expect(screen.queryByRole('dialog', { name: '配音音色' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('radio', { name: '温暖' }));
  fireEvent.change(screen.getByRole('slider', { name: '语速' }), { target: { value: '0.9' } });
  fireEvent.click(screen.getByRole('radio', { name: 'WAV' }));
  fireEvent.click(submit);
  await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith('tts-job', expect.objectContaining({ action: 'run-stage', input: { stageId: 'tts' } })));
  expect(fixture.currentJob().state).toMatchObject({ text: 'A clear voice.', voiceCode: 'cedar', voiceName: 'Cedar', style: 'warm', speed: .9, format: 'wav' });
  for (const [, request] of fixture.applyAction.mock.calls) {
    if (request.action === 'update-settings') {
      expect(request.input.patch).not.toHaveProperty('currentStep');
      expect(request.input.patch).not.toHaveProperty('furthestStep');
    }
  }
});

it.each([0, 1, 2])('restores a legacy step %s draft with every control available and summary in the Agent panel', async step => {
  const fixture = createFixture({ text: 'Saved script', currentStep: step, furthestStep: step, style: 'calm', speed: 1.1, format: 'wav' });
  await renderWorkspace(fixture);
  expect(screen.getByRole('textbox', { name: '配音文案内容' })).toHaveValue('Saved script');
  expect(screen.getByRole('button', { name: '配音音色 Marin' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('radiogroup', { name: '配音音色' })).not.toBeInTheDocument();
  expect(screen.getByRole('radio', { name: '沉静' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByRole('slider', { name: '语速' })).toHaveValue('1.1');
  expect(screen.getByRole('radio', { name: 'WAV' })).toHaveAttribute('aria-checked', 'true');
  const panel = screen.getByRole('complementary', { name: 'OpenCreator' });
  expect(within(panel).getByRole('complementary', { name: '任务摘要' })).toHaveTextContent('WAV');
  expect(document.querySelector('[aria-current="step"]')).toBeNull();
  expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument();
});

it('keeps the editor and voice controls locked until a submission finishes', async () => {
  const fixture = createFixture({ text: 'Ready to speak' });
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const apply = fixture.applyAction.getMockImplementation()!;
  fixture.applyAction.mockImplementation(async (id, request) => {
    if (request.action === 'run-stage') await pending;
    return apply(id, request);
  });
  await renderWorkspace(fixture);
  const form = screen.getByRole('form', { name: '文本转语音' });
  fireEvent.click(within(form).getByRole('button', { name: '开始生成' }));
  await waitFor(() => expect(fixture.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(true));
  expect(screen.getByRole('textbox', { name: '配音文案内容' })).toBeDisabled();
  expect(screen.getByRole('button', { name: '配音音色 Marin' })).toBeDisabled();
  expect(screen.getByRole('slider')).toBeDisabled();
  fireEvent.click(within(form).getByRole('button', { name: '正在生成' }));
  expect(fixture.applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage')).toHaveLength(1);
  await act(async () => { finish(); await pending; });
  await waitFor(() => expect(within(form).getByRole('button', { name: '开始生成' })).toBeEnabled());
});

it('restores completed audio beside the editable form and downloads it without resubmitting', async () => {
  const fixture = createFixture({ text: 'Original script', currentStep: 2, furthestStep: 2 });
  const job = fixture.currentJob();
  const artifact: CreatorArtifact = { id: 'audio-result', jobId: job.id, kind: 'dubbed_audio', version: 1, status: 'completed', path: '/tmp/speech.wav', scopeKey: null, inputFingerprint: null, sha256: null, sourceArtifactIds: [], createdAt: job.createdAt,
    metadata: { fileName: 'speech.wav', bytes: 2048, provider: 'openai', model: 'gpt-4o-mini-tts', voiceCode: 'marin', voiceName: 'Marin', style: 'natural', speed: 1, format: 'wav', characterCount: 15, settingsSnapshot: { text: 'Original script' } } };
  const downloads: Array<{ fileName: string; href: string }> = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push({ fileName: this.download, href: this.href });
  });
  const view = await renderWorkspace(fixture, { ...job, status: 'completed', artifacts: [artifact] });
  await waitFor(() => expect(screen.getByLabelText('文本转语音试听')).toHaveAttribute('src', 'blob:dubbing-result'));
  expect(screen.getByRole('textbox', { name: '配音文案内容' })).toBeEnabled();
  expect(screen.getAllByRole('button', { name: '重新生成' })).toHaveLength(1);
  fireEvent.change(screen.getByRole('textbox', { name: '配音文案内容' }), { target: { value: 'Next script' } });
  const summary = screen.getByRole('complementary', { name: '任务摘要' });
  expect(summary).toHaveTextContent('Original script');
  expect(summary).not.toHaveTextContent('Next script');
  fireEvent.click(screen.getByRole('button', { name: '下载音频' }));
  expect(click).toHaveBeenCalledOnce();
  expect(downloads).toEqual([{ fileName: 'speech.wav', href: 'blob:dubbing-result' }]);
  expect(fixture.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(false);
  view.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:dubbing-result');
});

it('shows provider failures on the same page with a settings recovery link', async () => {
  const fixture = createFixture({ text: 'Saved script' });
  const job = fixture.currentJob();
  await renderWorkspace(fixture, { ...job, status: 'failed', stages: [{ id: 'stage', jobId: job.id, stageId: 'tts', executor: 'smart-dubbing', status: 'failed', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null, progress: {}, errorCode: 'creator_tts_config_missing', errorMessage: 'Missing API key', startedAt: job.createdAt, finishedAt: job.createdAt }] });
  expect(document.querySelector('.smart-dubbing-error')).toHaveTextContent('请先在设置的配音服务中配置当前服务商的 API Key');
  expect(within(document.querySelector('.smart-dubbing-error') as HTMLElement).getByRole('link')).toHaveAttribute('href', '#/settings?tab=ai-services&section=tts');
  expect(screen.getByRole('textbox', { name: '配音文案内容' })).toHaveValue('Saved script');
  expect(screen.getByRole('button', { name: '开始生成' })).toBeEnabled();
});

it.each([
  { language: 'zh-CN' as const, form: '文本转语音', script: '配音文案内容', clear: '清空文案', sample: '填入示例文案', expand: '展开编辑区', summary: '任务摘要' },
  { language: 'en-US' as const, form: 'Text to Speech', script: 'Dubbing script content', clear: 'Clear script', sample: 'Use sample script', expand: 'Expand editor', summary: 'Task summary' },
  { language: 'ar-SA' as const, form: 'تحويل النص إلى كلام', script: 'دبلجة محتوى البرنامج النصي', clear: 'مسح النص', sample: 'استخدم نموذج البرنامج النصي', expand: 'قم بتوسيع المحرر', summary: 'ملخص المهمة' }
])('localizes the single form and editor actions in $language', async copy => {
  await renderWorkspace(createFixture(), undefined, copy.language);
  const form = screen.getByRole('form', { name: copy.form });
  const editor = screen.getByRole('textbox', { name: copy.script });
  fireEvent.click(within(form).getByRole('button', { name: copy.sample }));
  expect((editor as HTMLTextAreaElement).value.length).toBeGreaterThan(20);
  expect(within(form).queryByRole('button', { name: copy.expand })).not.toBeInTheDocument();
  expect(editor).toHaveAttribute('rows', '5');
  fireEvent.click(within(form).getByRole('button', { name: copy.clear }));
  expect(editor).toHaveValue('');
  expect(within(screen.getByRole('complementary', { name: 'OpenCreator' })).getByRole('complementary', { name: copy.summary })).toBeInTheDocument();
});

it('provides the new clear-script action in every supported client language', () => {
  for (const { value } of appLanguageOptions) {
    const copy = createLocalizedCopy(value)('清空文案', 'Clear script');
    expect(copy).toBeTruthy();
    if (value !== 'en-US') expect(copy, value).not.toBe('Clear script');
  }
});

it('provides voice library search, filters, and gender labels in every client language', () => {
  for (const { value } of appLanguageOptions) {
    if (value === 'en-US') continue;
    const l = createLocalizedCopy(value);
    for (const [zh, en] of [['搜索音色', 'Search voices'], ['全部语言', 'All languages'], ['全部性别', 'All genders'], ['全部风格', 'All styles'], ['没有匹配的音色', 'No matching voices'], ['男声', 'Male'], ['女声', 'Female'], ['多语种', 'Multilingual']]) {
      expect(l(zh!, en!), `${value}: ${en}`).not.toBe(en);
    }
  }
});

it('shows provider icons in the selected speech model and its options', async () => {
  await renderWorkspace(createFixture());
  const trigger = screen.getByRole('combobox', { name: '语音模型' });
  expect(trigger.querySelector('.model-brand-icon')).toHaveAttribute('data-brand', 'openai');
  fireEvent.click(trigger);

  for (const [name, brand] of [['OpenAI TTS', 'openai'], ['MiniMax', 'minimax'], ['阿里云百炼', 'qwen'], ['火山引擎', 'bytedance']]) {
    const option = screen.getByRole('option', { name: new RegExp(`^${name}`) });
    expect(option.querySelector('.model-brand-icon')).toHaveAttribute('data-brand', brand);
    expect(option.querySelector('img')).toHaveAttribute('src', expect.stringMatching(/^\/model-brands\//));
  }
});

function createFixture(state: Record<string, CreatorJson> = {}) {
  const createdAt = '2026-10-17T00:00:00Z';
  let job: CreatorJob = { id: 'tts-job', projectId: 'project', templateId: 'smart-dubbing', templateVersion: 1, status: 'draft', revision: 1, presetOrigin: null, agentThreadId: null, stages: [], artifacts: [], providerRequests: [], activities: [], createdAt, updatedAt: createdAt,
    state: { text: '', ttsProvider: 'openai', ttsModel: 'gpt-4o-mini-tts', voiceCode: 'marin', voiceName: 'Marin', style: 'natural', speed: 1, format: 'mp3', ...state } };
  const applyAction = vi.fn(async (_id: string, request: CreatorActionRequest) => {
    const patch = request.action === 'update-settings' ? request.input.patch as Record<string, CreatorJson> : {};
    job = { ...job, revision: job.revision + 1, state: { ...job.state, ...patch } };
    return { job, receipt: { actor: 'user' as const, action: request.action, summary: request.action, affectedArtifacts: [], newRevision: job.revision, createdAt } };
  });
  return { currentJob: () => job, applyAction, openArtifact: vi.fn(async () => new Response(new Blob(['audio'], { type: 'audio/wav' }))), runAgentTurn: vi.fn() };
}

async function renderWorkspace(fixture: ReturnType<typeof createFixture>, job = fixture.currentJob(), language: AppLanguage = 'zh-CN') {
  const config = createDefaultCreatorServicesConfig();
  // Keep an explicitly empty saved voice empty so the form can validate it.
  config.tts.openai.defaultVoiceId = '';
  const service = {
    getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })),
    getTtsVoices: vi.fn(async () => ({ provider: 'openai' as const, model: 'gpt-4o-mini-tts', voices: [{ id: 'marin', name: 'Marin', provider: 'openai' as const, kind: 'builtin' as const }, { id: 'cedar', name: 'Cedar', provider: 'openai' as const, kind: 'builtin' as const }] })),
    previewTtsVoice: vi.fn()
  };
  const view = render(<LanguageProvider initialPreference={language}><CreatorSessionProvider initialJob={job} service={fixture}>
    <SmartDubbingWorkspace onBack={vi.fn()} creatorServicesService={service as unknown as CreatorServicesSettingsService} />
  </CreatorSessionProvider></LanguageProvider>);
  await act(async () => { await Promise.resolve(); });
  return view;
}
