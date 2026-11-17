import { changeControl } from '../../test/select-option.js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { normalizePageIssue } from '../issues/page-issue-state.js';
import type {
  CreatorArtifact,
  CreatorJob,
  CreatorJson,
  CreatorServicesConfig,
  CreatorServicesConfigResponse,
  CreatorStageRun,
  GatewayAccountState
} from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { LanguageSwitchControls } from '../../test/LanguageSwitchControls.js';
import DashboardGenerationAccess from './DashboardGenerationAccess.js';
import VideoGenerationWorkspace from './VideoGenerationWorkspace.js';
import { CreatorSessionProvider, useCreatorSession } from './creator-session-store.js';
import { OfficialServicesContext } from './official-services.js';

describe('VideoGenerationWorkspace', () => {
  it.each([true, false])('defaults to the first listed ready video model when no local service is configured (account ready at mount: %s)', async readyAtMount => {
    const gatewayState: GatewayAccountState = {
      source: 'gateway', transport: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'account', email: 'user@example.com', verified: true }, bindingVersion: 'account:1',
      models: [
        { id: 'veo-3.1', name: 'Veo 3.1', modality: 'video', capabilities: ['generate'], sizes: ['720p@16:9'], durations: [8] },
        { id: 'gemini-omni-flash-1.1', name: 'Gemini Omni Flash 1.1', modality: 'video', capabilities: ['generate'], sizes: ['720p@16:9'], durations: [5] }
      ], activationError: null
    };
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city at dusk' } }), {
      gatewayState: readyAtMount ? gatewayState : undefined,
      creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: [] }) }
    });
    if (!readyAtMount) view.rerenderWorkspace({ gatewayState });

    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('Gemini Omni Flash 1.1'));
    expect(screen.getByRole('button', { name: '视频设置' })).toBeEnabled();
    await waitFor(() => expect(mergedSettingsPatch(view.applyAction.mock.calls)).toMatchObject({
      videoServiceSource: 'gateway', officialModels: { video: 'gemini-omni-flash-1.1' }
    }));
  });

  it.each([true, false])('opens a new video task with the last manually chosen official model (account ready at mount: %s)', async readyAtMount => {
    const gatewayState: GatewayAccountState = {
      source: 'gateway', transport: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'account', email: 'user@example.com', verified: true }, bindingVersion: 'account:1',
      selectedModels: { video: 'bytedance/seedance-2.5' },
      taskModels: { 'video-generation': { video: 'vendor/alternate' } },
      models: [
        { id: 'bytedance/seedance-2.5', name: 'Seedance 2.5', modality: 'video', capabilities: ['generate'], sizes: ['1280x720'], durations: [5] },
        { id: 'vendor/alternate', name: 'Alternate Video', modality: 'video', capabilities: ['generate'], sizes: ['1280x720'], durations: [7] }
      ], activationError: null
    };
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city at dusk' } }), {
      gatewayState: readyAtMount ? gatewayState : undefined
    });
    if (!readyAtMount) view.rerenderWorkspace({ gatewayState });

    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('Alternate Video'));
  });

  it('keeps the local video choice and settings after sign-in', async () => {
    const gatewayState: GatewayAccountState = {
      source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'account', email: 'user@example.com', verified: true },
      bindingVersion: 'account:1', taskModels: { 'video-generation': { video: 'vendor/video' } }, models: [
        { id: 'vendor/video', name: 'Official Video', vendor: 'Vendor', modality: 'video', capabilities: ['generate'], sizes: ['1080p@16:9'], durations: [7] },
        { id: 'seedance-2.5官方版', name: 'Seedance 2.5', modality: 'video', capabilities: ['generate'], sizes: ['720p@16:9'], durations: [5] }
      ],
      activationError: null
    };
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city at dusk', videoServiceSource: 'manual' } }), {
      gatewayState,
      creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: ['video.seedance.apiKey'] }) }
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    expect(screen.getByRole('option', { name: 'Official Video' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: '模型' }), { key: 'Escape' });
    openVideoSettings();
    expect(screen.getByRole('radiogroup', { name: '画幅' })).toHaveTextContent('16:9');
    expect(screen.getByRole('spinbutton', { name: '视频时长' })).toHaveValue(5);
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'run-stage' })));
    expect(mergedSettingsPatch(view.applyAction.mock.calls)).toMatchObject({ provider: 'seedance', model: 'doubao-seedance-2-5-260628' });
  });

  it('keeps the same settings fields when switching between local and official models', async () => {
    const gatewayState: GatewayAccountState = {
      source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'account', email: 'user@example.com', verified: true },
      bindingVersion: 'account:1', selectedModels: { video: 'vendor/video' },
      models: [{ id: 'vendor/video', name: 'Official Video', vendor: 'Vendor', modality: 'video', capabilities: ['generate'], sizes: ['1080p@16:9'], durations: [7] }],
      activationError: null
    };
    renderWorkspace(creatorJob({ state: { prompt: 'A city at dusk' } }), { gatewayState });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    openVideoSettings();
    expect(screen.getByRole('slider', { name: '视频时长' })).toHaveAttribute('max', '1');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(screen.getByRole('option', { name: 'Official Video' }));
    openVideoSettings();
    expect(screen.getByRole('spinbutton', { name: '视频时长' })).toHaveValue(7);
    expect(within(screen.getByRole('radiogroup', { name: '画幅' })).getAllByRole('radio').map(item => item.getAttribute('data-value'))).toEqual(['16:9']);
    expect(within(screen.getByRole('radiogroup', { name: '清晰度' })).getAllByRole('radio').map(item => item.getAttribute('data-value'))).toEqual(['1080p@16:9']);
    expect(screen.getByLabelText('上传视频参考图')).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(screen.getByRole('option', { name: '本地视频服务' }));
    openVideoSettings();
    expect(screen.getByRole('slider', { name: '视频时长' })).toHaveAttribute('max', '1');
    expect(screen.getByLabelText('上传视频参考图')).toBeEnabled();
  });

  it('uses a configured local video model while signed out and lists only public gateway models', async () => {
    const config: CreatorServicesConfig = createVideoConfig();
    config.video.provider = 'veo';
    const gatewayState: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
    const getVideoCatalog = vi.fn(async () => ({ models: [
      { id: 'bytedance/motion', name: 'Gateway Motion', vendor: 'ByteDance', modality: 'video' as const, capabilities: [], durations: [7], sizes: ['1080p@16:9'] },
      { id: 'google/film', name: 'Gateway Film', vendor: 'Google', modality: 'video' as const, capabilities: [], durations: [8] }
    ] }));
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city at dusk' } }), {
      creatorServicesService: { getConfig: async () => ({ config, configuredCredentials: ['video.veo.apiKey'] }) },
      gatewayState, gatewayAccountService: { getVideoCatalog }, accessGate: true
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    const list = screen.getByRole('listbox', { name: '模型' });
    expect(within(list).queryByRole('group')).not.toBeInTheDocument();
    expect(within(list).getAllByRole('option').map(option => option.getAttribute('aria-label'))).toEqual([
      '本地视频服务', 'Gateway Film', 'Gateway Motion'
    ]);
    expect(screen.queryByRole('option', { name: 'Seedance 2.5' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Gateway Motion' })).toHaveTextContent('Gateway Motion');
    expect(screen.getByRole('option', { name: 'Gateway Motion' })).not.toHaveTextContent(/登录后使用|1080p|时长|积分/);
    fireEvent.keyDown(screen.getByRole('combobox', { name: '模型' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'run-stage' })));
    expect(mergedSettingsPatch(view.applyAction.mock.calls))
      .toMatchObject({ provider: 'veo', model: config.video.veo.model });
    expect(screen.queryByRole('dialog', { name: '登录后继续创作' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(screen.getByRole('option', { name: 'Gateway Motion' }));
    expect(await screen.findByRole('dialog', { name: '登录后继续创作' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue('A city at dusk');
  });

  it('links an unconfigured local video option to video service settings', async () => {
    const previousHash = window.location.hash;
    const getVideoCatalog = vi.fn(async () => ({ models: [
      { id: 'vendor/film', name: 'Gateway Film', vendor: 'Vendor', modality: 'video' as const, capabilities: [] }
    ] }));
    try {
      renderWorkspace(creatorJob({ state: { prompt: 'A city at dusk' } }), {
        creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: [] }) },
        gatewayAccountService: { getVideoCatalog }
      });
      await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('选择模型'));
      fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
      const local = await screen.findByRole('option', { name: '本地视频服务' });
      expect(local).toBeEnabled();
      fireEvent.click(local);
      expect(window.location.hash).toBe('#/settings?tab=ai-services&section=video');
      expect(getVideoCatalog).toHaveBeenCalledOnce();
    } finally {
      window.location.hash = previousHash;
    }
  });

  it('sorts gateway video models by name while keeping their icons and prices', async () => {
    renderWorkspace(creatorJob({}), {
      creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: ['video.seedance.apiKey'] }) },
      gatewayAccountService: { getVideoCatalog: async () => ({ models: [
        { id: 'custom/unknown', name: 'Unknown Film', vendor: 'Others', modality: 'video' as const, capabilities: [], durations: [5], sizes: ['720p@16:9'] },
        { id: 'google/veo', name: 'Veo', vendor: 'Google', modality: 'video' as const, capabilities: [], durations: [8] },
        { id: 'zeta/film', name: 'Zeta Film', vendor: 'Zeta', modality: 'video' as const, capabilities: [] },
        { id: 'bytedance/seedance', name: 'Seedance', vendor: 'ByteDance', modality: 'video' as const, capabilities: [] },
        { id: 'SD2.0', name: 'SD 2.0', vendor: 'Others', modality: 'video' as const, capabilities: [], recommended: true,
          durations: [5], sizes: ['1080p@16:9'], resolutions: ['1080p'],
          price: { version: 'v1', videoUnitsPerSecond: { '1080p': 1_000_000 }, estimates: { clip: { creditUnits: '5000000', seconds: 5, resolution: '1080p' } } } }
      ] }) }
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    const list = screen.getByRole('listbox', { name: '模型' });
    await waitFor(() => expect(within(list).getAllByRole('option').map(option => option.getAttribute('aria-label')))
      .toEqual(['本地视频服务', 'SD 2.0', 'Seedance', 'Unknown Film', 'Veo', 'Zeta Film']));
    expect(within(list).queryByRole('group')).not.toBeInTheDocument();
    const sd = within(list).getByRole('option', { name: 'SD 2.0' });
    expect(sd.querySelector('[data-brand="generic"] svg')).not.toBeNull();
    expect(sd).toHaveTextContent('约 1 积分 / 1 秒 · 1080p');
    expect(sd).not.toHaveTextContent(/推荐|登录后使用|时长/);
    expect(within(list).getByRole('option', { name: 'Seedance' })
      .querySelector('[data-brand="bytedance"] img')).toHaveAttribute('src', '/model-brands/bytedance-color.svg');
    expect(within(list).getByRole('option', { name: 'Unknown Film' })).not.toHaveTextContent(/时长|720p/);
  });

  it.each([
    { language: 'zh-CN' as const, failure: '官方视频模型目录加载失败', local: '本地视频服务', model: '模型', retry: '重试加载视频模型' },
    { language: 'en-US' as const, failure: 'Official video models could not load', local: 'Local video service', model: 'Model', retry: 'Retry loading video models' },
    { language: 'sv-SE' as const, failure: 'Kunde inte läsa in officiella videomodeller', local: 'Lokal videotjänst', model: 'Modell', retry: 'Försök läsa in videomodeller igen' }
  ])('keeps local video generation available when the public catalog fails and retries it in $language', async ({ language, failure, local, model, retry }) => {
    const getVideoCatalog = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ models: [
      { id: 'vendor/video', name: 'Recovered Video', vendor: 'Vendor', modality: 'video', capabilities: [] }
    ] });
    renderWorkspace(creatorJob({ state: { prompt: 'A city' } }), {
      creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: ['video.seedance.apiKey'] }) },
      gatewayAccountService: { getVideoCatalog }, language
    });
    expect(await screen.findByText(failure)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: model })).toHaveValue(local);
    fireEvent.click(screen.getByRole('button', { name: retry }));
    fireEvent.click(screen.getByRole('combobox', { name: model }));
    expect(await screen.findByRole('option', { name: 'Recovered Video' })).toBeInTheDocument();
    expect(getVideoCatalog).toHaveBeenCalledTimes(2);
  });

  it.each([
    { available: true, selected: 'Requested Video', notice: false },
    { available: false, selected: 'Recommended Video', notice: true }
  ])('validates a pending public video model after sign-in (available: $available)', async ({ available, selected, notice }) => {
    const requested = { id: 'vendor/requested', name: 'Requested Video', vendor: 'Vendor', modality: 'video' as const, capabilities: [], durations: [5], sizes: ['1280x720'] };
    const recommended = { id: 'vendor/recommended', name: 'Recommended Video', vendor: 'Vendor', modality: 'video' as const, capabilities: [], durations: [8], sizes: ['720x1280'], recommended: true };
    const signedOut: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
    const signedIn: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', models: available ? [requested, recommended] : [recommended], recommendedModels: { video: recommended.id }, selectedModels: { video: recommended.id }, activationError: null };
    const getState = vi.fn(async () => signedIn);
    const gatewayAccountService = { getVideoCatalog: vi.fn(async () => ({ models: [requested, recommended] })), getState };
    const onGatewayStateChange = vi.fn();
    const view = renderWorkspace(creatorJob({ state: { prompt: 'Keep this video prompt' } }), {
      creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: ['video.seedance.apiKey'] }) },
      gatewayState: signedOut, gatewayAccountService, onGatewayStateChange, accessGate: true
    });
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Requested Video' }));
    expect(await screen.findByRole('dialog', { name: '登录后继续创作' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue('Keep this video prompt');
    view.rerenderWorkspace({ gatewayState: signedIn });
    await waitFor(() => available
      ? expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue(selected)
      : expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue(selected));
    expect(getState).toHaveBeenCalledWith({ refreshModels: true });
    expect(onGatewayStateChange).toHaveBeenCalledWith(signedIn);
    if (notice) expect(screen.getByText(/所选模型当前账户不可用/)).toBeInTheDocument();
    expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(false);
    expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue('Keep this video prompt');
  });
  it('selects a ready local provider when the configured default has no credentials', async () => {
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A coastline' } }), {
      creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: ['video.veo.apiKey'] }) }
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await waitFor(() => expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(true));
    expect(mergedSettingsPatch(view.applyAction.mock.calls))
      .toMatchObject({ provider: 'veo', model: 'veo-3.1-generate-preview' });
  });
  it('keeps the ready local provider when switching back from a gateway model', async () => {
    const signedOut: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A coastline' } }), {
      creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: ['video.veo.apiKey'] }) },
      gatewayAccountService: { getVideoCatalog: async () => ({ models: [{ id: 'vendor/video', name: 'Gateway Video', vendor: 'Vendor', modality: 'video', capabilities: [] }] }) },
      gatewayState: signedOut, accessGate: true
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Gateway Video' }));
    fireEvent.click(screen.getByRole('button', { name: '关闭登录窗口' }));
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(screen.getByRole('option', { name: '本地视频服务' }));
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await waitFor(() => expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(true));
    expect(mergedSettingsPatch(view.applyAction.mock.calls)).toMatchObject({ provider: 'veo', model: 'veo-3.1-generate-preview' });
  });
  it.each([0, 1, 2])('opens legacy step %s as a single editable form with the summary in the agent panel', async step => {
    const config: CreatorServicesConfig = createVideoConfig();
    config.video.provider = 'veo';
    renderWorkspace(creatorJob({ state: {
      prompt: 'A coastal tracking shot', provider: 'veo', model: 'veo-3.1-generate-preview',
      size: '720x1280', duration: 8, currentStep: step, furthestStep: step
    } }), { creatorServicesService: { getConfig: async () => ({ config, configuredCredentials: ['video.veo.apiKey'] }) } });
    const form = screen.getByRole('form', { name: '视频生成' });
    expect(within(form).getByRole('textbox', { name: '提示词' })).toHaveValue('A coastal tracking shot');
    await waitFor(() => expect(within(form).getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    openVideoSettings();
    expect(screen.getByRole('radio', { name: '9:16' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('spinbutton', { name: '视频时长' })).toHaveValue(8);
    expect(within(form).getByRole('button', { name: '生成' })).toBeEnabled();
    const agent = screen.getByRole('complementary', { name: 'OpenCreator' });
    expect(within(agent).getByRole('complementary', { name: '任务摘要' })).toHaveTextContent('Veo 3.1 · 9:16 · 8s');
    expect(document.querySelector('.creator-workspace-main .creator-task-summary')).toBeNull();
    expect(screen.queryByRole('navigation', { name: '视频生成流程' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '继续' })).not.toBeInTheDocument();
  });

  it('validates and submits the edited prompt and settings directly from one form', async () => {
    const config: CreatorServicesConfig = createVideoConfig();
    config.video.provider = 'veo';
    const view = renderWorkspace(creatorJob({}), { creatorServicesService: { getConfig: async () => ({ config, configuredCredentials: ['video.veo.apiKey'] }) } });
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请先描述需要生成的视频');
    expect(view.applyAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), { target: { value: '  The city at dusk  ' } });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    openVideoSettings();
    fireEvent.change(screen.getByRole('slider', { name: '视频时长' }), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: '生成' }));

    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith('creator_video_workspace', expect.objectContaining({
      action: 'run-stage', input: { stageId: 'generate' }
    })));
    const settings = view.applyAction.mock.calls.filter(([, request]) => request.action === 'update-settings');
    expect(mergedSettingsPatch(view.applyAction.mock.calls)).toMatchObject({ prompt: 'The city at dusk', provider: 'veo', duration: 8 });
    for (const [, request] of settings) {
      expect(request.input.patch).not.toHaveProperty('currentStep');
      expect(request.input.patch).not.toHaveProperty('furthestStep');
    }
  });

  it('previews, removes, and replaces a reference image without leaving the form', async () => {
    renderWorkspace(creatorJob({}));
    const upload = screen.getByLabelText('上传视频参考图');
    const image = new File(['image'], 'reference.png', { type: 'image/png' });
    changeControl(upload, { target: { files: [image] } });
    const preview = await screen.findByRole('img', { name: '视频参考图预览' });
    expect(preview).toBeVisible();
    expect(within(preview.closest('.video-generation-reference') as HTMLElement).queryByText('reference.png')).not.toBeInTheDocument();
    openVideoSettings();
    expect(screen.getByRole('radio', { name: '16:9' })).toBeDisabled();
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '移除参考图' }));
    expect(screen.queryByRole('img', { name: '视频参考图预览' })).not.toBeInTheDocument();
    openVideoSettings();
    expect(screen.getByRole('radio', { name: '16:9' })).toBeEnabled();
    changeControl(upload, { target: { files: [image] } });
    expect(await screen.findByRole('img', { name: '视频参考图预览' })).toBeVisible();
    expect(upload).toHaveValue('');
  });

  it('keeps the single image input when signing in to an official video model', async () => {
    const model = {
      id: 'vendor/video', modality: 'video' as const, capabilities: ['image_to_video'],
      sizes: ['1280x720'], durations: [5],
      videoOptions: { profile: 'sd', maxImages: 4, maxVideos: 2, maxAudios: 1,
        firstLastFrames: true, framesExclusive: true, generateAudio: false }
    };
    const signedOut: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
    const signedIn: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1',
      selectedModels: { video: model.id }, models: [model], activationError: null };
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city' } }), { gatewayState: signedOut });
    const upload = screen.getByLabelText('上传视频参考图');
    changeControl(upload, { target: { files: [new File(['image'], 'reference.png', { type: 'image/png' })] } });
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: '视频参考图预览' })).toBeVisible();

    await act(async () => { view.rerenderWorkspace({ gatewayState: signedIn }); });
    expect(screen.getByLabelText('上传视频参考图')).toBe(upload);
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.queryByLabelText('上传参考图片')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('上传参考视频')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('上传参考音频')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '参考模式' })).not.toBeInTheDocument();
  });

  it('submits only one saved image from an older multi-reference draft', async () => {
    const image = { role: 'image', fileName: 'first.png', assetId: `ocasset_${'a'.repeat(48)}` };
    const extraImage = { role: 'image', fileName: 'second.png', assetId: `ocasset_${'b'.repeat(48)}` };
    const video = { role: 'video', fileName: 'clip.mp4', assetId: `ocasset_${'c'.repeat(48)}` };
    const gatewayState: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1',
      selectedModels: { video: 'vendor/video' }, activationError: null,
      models: [{ id: 'vendor/video', modality: 'video', capabilities: ['image_to_video'], sizes: ['1280x720'], durations: [5],
        videoOptions: { profile: 'sd', maxImages: 4, maxVideos: 2, maxAudios: 1,
          firstLastFrames: true, framesExclusive: true, generateAudio: false } }] };
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city', size: '1280x720', duration: 5, videoServiceSource: 'gateway',
      videoReferences: [image, extraImage, video] } }), { gatewayState });
    expect(screen.getByText('1/1')).toBeInTheDocument();
    expect(screen.queryByText('clip.mp4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await waitFor(() => expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(true));
    expect(mergedSettingsPatch(view.applyAction.mock.calls)).toMatchObject({ videoReferences: [image] });
  });

  it('uploads the selected image after sign-in before starting generation', async () => {
    const initialJob = creatorJob({ state: { prompt: 'A city', size: '1280x720', duration: 5 } });
    const model = { id: 'vendor/video', modality: 'video' as const, capabilities: ['image_to_video'],
      sizes: ['1280x720'], durations: [5], videoOptions: { profile: 'sd', maxImages: 1, maxVideos: 1,
        maxAudios: 0, firstLastFrames: false, framesExclusive: false, generateAudio: false } };
    const signedOut: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
    const signedIn: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1',
      selectedModels: { video: model.id }, models: [model], activationError: null };
    const uploadReferenceImage = vi.fn(async (_jobId: string, input: { file: File }) => ({
      job: { ...initialJob, revision: 3, state: { ...initialJob.state, referenceImageArtifactId: 'image_1' } },
      receipt: {}
    }));
    const view = renderWorkspace(initialJob, { gatewayState: signedOut, uploadReferenceImage });
    const image = new File(['image'], 'reference.png', { type: 'image/png' });
    changeControl(screen.getByLabelText('上传视频参考图'), { target: { files: [image] } });
    await act(async () => { view.rerenderWorkspace({ gatewayState: signedIn }); });
    fireEvent.click(screen.getByRole('button', { name: '生成' }));

    await waitFor(() => expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(true));
    expect(uploadReferenceImage).toHaveBeenCalledWith(initialJob.id, expect.objectContaining({ file: image }));
    expect(mergedSettingsPatch(view.applyAction.mock.calls)).toMatchObject({ videoReferences: [] });
  });

  it.each([
    { language: 'zh-CN' as const, expand: '展开编辑区', prompt: '提示词' },
    { language: 'en-US' as const, expand: 'Expand editor', prompt: 'Prompt' },
    { language: 'sv-SE' as const, expand: 'Utöka redigeringsytan', prompt: 'Prompt' }
  ])('keeps a fixed editor without an expand action in $language', copy => {
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A coastal tracking shot' } }), { language: copy.language });
    const prompt = screen.getByRole('textbox', { name: copy.prompt });
    expect(prompt).toHaveAttribute('rows', '5');
    expect(prompt).toHaveValue('A coastal tracking shot');
    expect(screen.queryByRole('button', { name: copy.expand })).not.toBeInTheDocument();
    expect(view.applyAction).not.toHaveBeenCalled();
  });

  it.each([
    { language: 'zh-CN' as const, form: '视频生成', prompt: '提示词', model: '模型', generate: '生成', clear: '清空提示词', summary: '任务摘要' },
    { language: 'en-US' as const, form: 'Video Generation', prompt: 'Prompt', model: 'Model', generate: 'Generate', clear: 'Clear prompt', summary: 'Task summary' },
    { language: 'sv-SE' as const, form: 'Videogenerering', prompt: 'Prompt', model: 'Modell', generate: 'Generera', clear: 'Rensa prompt', summary: 'Uppgiftssammanfattning' }
  ])('localizes the single-page controls and summary in $language', copy => {
    renderWorkspace(creatorJob({}), { language: copy.language });
    const form = screen.getByRole('form', { name: copy.form });
    expect(within(form).getByRole('textbox', { name: copy.prompt })).toBeInTheDocument();
    expect(within(form).getByRole('combobox', { name: copy.model })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: copy.generate })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: copy.clear })).toBeDisabled();
    expect(within(screen.getByRole('complementary', { name: 'OpenCreator' })).getByRole('complementary', { name: copy.summary })).toBeInTheDocument();
  });

  it('shows model-native video sizes and durations beyond the custom provider presets', () => {
    const gatewayState: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', models: [{ id: 'vendor/video', modality: 'video', capabilities: [], resolutions: ['1080p', '720p'], aspectRatios: ['16:9', '9:16'], durations: [3, 12] }], activationError: null };
    renderWorkspace(creatorJob({ state: { prompt: 'city', videoServiceSource: 'gateway', currentStep: 1, furthestStep: 1 } }), { gatewayState });
    openVideoSettings();
    expect(within(screen.getByRole('radiogroup', { name: '画幅' })).getAllByRole('radio').map(option => option.getAttribute('data-value'))).toEqual(['16:9', '9:16']);
    expect(within(screen.getByRole('radiogroup', { name: '清晰度' })).getAllByRole('radio').map(option => option.getAttribute('data-value'))).toEqual(['1080p@16:9', '720p@16:9']);
    expect(screen.getByRole('slider', { name: '视频时长' })).toHaveAttribute('max', '1');
  });
  it('defaults a new official video to Seedance 2.5 and omits the inline credit quote', async () => {
    const gatewayState: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', selectedModels: { video: 'SD2.0' },
      models: [
        { id: 'SD2.0', name: 'SD 2.0', modality: 'video', capabilities: [], sizes: ['480p@16:9'], durations: [5], price: { version: 'v1', videoUnitsPerSecond: { '480p': 59_800_000 } } },
        { id: 'seedance-2.5官方版', name: 'Seedance 2.5', modality: 'video', capabilities: [], sizes: ['720p@16:9'], durations: [5] }
      ], activationError: null };
    renderWorkspace(creatorJob({ state: { prompt: 'A city' } }), {
      gatewayState,
      creatorServicesService: { getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: ['video.seedance.apiKey'] }) }
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('Seedance 2.5'));
    expect(screen.queryByText(/本次消耗|This generation costs/)).not.toBeInTheDocument();
  });
  it('separates format and resolution while preserving and submitting the selected combination', async () => {
    const gatewayState: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', selectedModels: { video: 'vendor/video' },
      models: [{ id: 'vendor/video', modality: 'video', capabilities: [], resolutions: ['1080p', '720p'], aspectRatios: ['16:9', '9:16'], durations: [5] }], activationError: null };
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city', videoServiceSource: 'gateway', size: '720p@16:9' } }), { gatewayState });
    openVideoSettings();
    expect(within(screen.getByRole('radiogroup', { name: '画幅' })).getAllByRole('radio').map(option => option.getAttribute('data-value'))).toEqual(['16:9', '9:16']);
    expect(within(screen.getByRole('radiogroup', { name: '清晰度' })).getAllByRole('radio').map(option => option.getAttribute('data-value'))).toEqual(['1080p@16:9', '720p@16:9']);
    fireEvent.click(screen.getByRole('radio', { name: '1080p' }));
    expect(screen.getByRole('radio', { name: '1080p' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '9:16' }));
    expect(screen.getByRole('radio', { name: '1080p' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    await waitFor(() => expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(true));
    expect(mergedSettingsPatch(view.applyAction.mock.calls)).toMatchObject({ size: '1080p@9:16' });
  });
  it('uses a slider for a long list of supported video durations', () => {
    const gatewayState: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', selectedModels: { video: 'vendor/video' },
      models: [{ id: 'vendor/video', modality: 'video', capabilities: [], sizes: ['720p@16:9'], durations: Array.from({ length: 20 }, (_, index) => index + 4) }], activationError: null };
    renderWorkspace(creatorJob({ state: { prompt: 'A city', videoServiceSource: 'gateway', size: '720p@16:9', duration: 5 } }), { gatewayState });
    openVideoSettings();
    expect(screen.getByRole('slider', { name: '视频时长' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('slider', { name: '视频时长' }), { target: { value: '11' } });
    expect(screen.getByRole('spinbutton', { name: '视频时长' })).toHaveValue(15);
    expect(screen.getByRole('button', { name: '视频设置' })).toHaveTextContent('15 秒');
  });
  it('shows the official model parameters alongside the local choice while signed in', async () => {
    const gatewayState: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', selectedModels: { video: 'bytedance/seedance-1-5-pro' }, models: [{ id: 'bytedance/seedance-1-5-pro', modality: 'video', capabilities: ['image_to_video'], sizes: ['1280x720', '720x1280'], durations: [4, 5] }], activationError: null };
    const getConfig = vi.fn(async (): Promise<CreatorServicesConfigResponse> => ({ config: createVideoConfig(), configuredCredentials: ['video.veo.apiKey'] }));
    renderWorkspace(creatorJob({ state: { prompt: 'city skyline', videoServiceSource: 'gateway', provider: 'veo', model: 'veo-3.1-generate-preview', size: '1024x1024', duration: 10, currentStep: 1, furthestStep: 1 } }), { gatewayState, creatorServicesService: { getConfig } });
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('seedance-1-5-pro');
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    expect(await screen.findByRole('option', { name: '本地视频服务' })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('combobox', { name: '模型' }), { key: 'Escape' });
    expect(screen.queryByRole('combobox', { name: '模型版本' })).not.toBeInTheDocument();
    openVideoSettings();
    expect(screen.getByRole('slider', { name: '视频时长' })).toHaveAttribute('max', '1');
    expect(screen.queryByRole('option', { name: /1024/ })).not.toBeInTheDocument();
    expect(getConfig).toHaveBeenCalled();
  });

  it('keeps the signed-in video model menu compact', async () => {
    const gatewayState: GatewayAccountState = {
      source: 'gateway', authState: 'signed_in', activationState: 'ready',
      account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1',
      selectedModels: { video: 'SD2.0' }, activationError: null,
      models: [
        { id: 'SD2.0', name: 'SD 2.0', vendor: 'Others', modality: 'video', capabilities: [], recommended: true,
          durations: [5], sizes: ['720p@16:9'], price: { version: 'v1', videoUnitsPerSecond: { '720p': 1_000_000 } } },
        { id: 'custom/film', name: 'Custom Film', vendor: 'Zeta', modality: 'video', capabilities: [], durations: [8], sizes: ['1080p@9:16'] }
      ]
    };
    renderWorkspace(creatorJob({ state: { prompt: 'A city', videoServiceSource: 'gateway' } }), { gatewayState });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('SD 2.0'));
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    const list = screen.getByRole('listbox', { name: '模型' });
    await waitFor(() => expect(within(list).getAllByRole('option').map(option => option.getAttribute('aria-label')))
      .toEqual(['本地视频服务', 'Custom Film', 'SD 2.0']));
    expect(within(list).queryByRole('group')).not.toBeInTheDocument();
    expect(within(list).getByRole('option', { name: 'SD 2.0' })).toHaveTextContent('约 1 积分 / 1 秒 · 720p');
    expect(within(list).getByRole('option', { name: 'SD 2.0' })).not.toHaveTextContent(/推荐|时长/);
    expect(within(list).getByRole('option', { name: 'Custom Film' })).not.toHaveTextContent(/时长|1080p/);
  });

  it('shows a cached public video catalog immediately while it refreshes', () => {
    const catalog = { models: [{ id: 'vendor/cached-video', name: 'Cached Video', vendor: 'Vendor', modality: 'video' as const, capabilities: [] }] };
    const getVideoCatalog = vi.fn(() => new Promise<typeof catalog>(() => undefined));
    renderWorkspace(creatorJob({}), { gatewayAccountService: { getCachedVideoCatalog: () => catalog, getVideoCatalog } });
    expect(screen.queryByText('正在加载官方视频模型…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    expect(screen.getByRole('option', { name: 'Cached Video' })).toBeInTheDocument();
    expect(getVideoCatalog).toHaveBeenCalledOnce();
  });

  it('blocks official generation when account activation is unavailable', () => {
    const view = renderWorkspace(creatorJob({ state: { prompt: 'city skyline', videoServiceSource: 'gateway', currentStep: 2, furthestStep: 2 } }), { gatewayState: null });
    expect(screen.getByRole('button', { name: '生成' })).toBeEnabled();
    expect(screen.getByRole('combobox', { name: '模型' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '生成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('官方视频服务暂不可用');
    expect(view.applyAction).not.toHaveBeenCalled();
  });

  it('leaves the running screen and shows the true failure through read-only reconciliation without an SSE event', async () => {
    vi.useFakeTimers();
    const running = runningVideoJob({ phase: 'submitting', percent: 8 });
    const failed: CreatorJob = { ...running, revision: running.revision + 1, status: 'failed',
      stages: running.stages.map(stage => ({ ...stage, status: 'failed', errorCode: 'creator_video_upstream_error', errorMessage: 'Reference rejected' }))
    };
    failed.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('Failed'), 'Video generation failed'),
      scope: { kind: 'creator-job', jobId: failed.id }, stageRunId: failed.stages[0]!.id, code: 'creator_video_upstream_error',
      publicFacts: { kind: 'http-rejected', provider: 'seedance', httpStatus: 400,
        upstreamCode: 'InputImageSensitiveContentDetected.PrivacyInformation', upstreamMessage: 'Input image may contain real person', requestId: 'request-123' }
    }];
    const getJob = vi.fn().mockResolvedValueOnce({ job: running }).mockResolvedValue({ job: failed });
    const applyAction = vi.fn();
    const subscribeJobEvents = vi.fn(() => ({ close: vi.fn() }));
    const service = { getJob, applyAction, subscribeJobEvents, runAgentTurn: vi.fn() };
    const view = render(<LanguageProvider initialPreference="zh-CN"><CreatorSessionProvider initialJob={running} service={service as never}>
      <VideoGenerationWorkspace onBack={vi.fn()} />
    </CreatorSessionProvider></LanguageProvider>);
    try {
      await act(async () => { await Promise.resolve(); });
      expect(document.querySelector('.creator-collaboration-stage[data-status="running"]')).not.toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(document.querySelector('.creator-collaboration-stage[data-status="running"]')).toBeNull();
      expect(document.querySelector('.creator-collaboration-stage[data-status="failed"]')).not.toBeNull();
      expect(document.querySelector('.creator-collaboration-stage[data-status="failed"]')).not.toHaveTextContent('8%');
      const panel = screen.getByRole('complementary', { name: 'OpenCreator' });
      expect(panel).toHaveTextContent('InputImageSensitiveContentDetected.PrivacyInformation');
      expect(panel).toHaveTextContent('Input image may contain real person');
      expect(screen.queryByText('视频生成任务已提交，可以离开当前页面，完成后会保留在项目中')).not.toBeInTheDocument();
      expect(getJob).toHaveBeenCalledTimes(2);
      expect(applyAction).not.toHaveBeenCalled();
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(getJob).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('shows the persisted provider failure instead of generic network advice in %s', language => {
    const failed = creatorJob({ status: 'failed', state: {
      prompt: 'A cinematic reveal', provider: 'seedance', size: '1280x720', duration: 5,
      currentStep: 1, furthestStep: 1, currentStage: 'generate'
    }, stages: [{
      id: 'failed_stage', jobId: 'creator_video_workspace', stageId: 'generate', executor: 'video',
      status: 'failed', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null,
      attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: { phase: 'submitting', percent: 8 }, errorCode: 'creator_video_upstream_error',
      errorMessage: 'Provider rejected the request with status 400', startedAt: null, finishedAt: null
    }] });
    failed.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('private diagnostic'), 'Video generation failed'),
      scope: { kind: 'creator-job', jobId: failed.id }, stageRunId: 'failed_stage', code: 'creator_video_upstream_error',
      publicFacts: { kind: 'http-rejected', provider: 'seedance', httpStatus: 400,
        upstreamCode: 'InputImageSensitiveContentDetected.SensitiveContent',
        upstreamMessage: 'Reference image was rejected', requestId: 'provider-request-123' }
    }];
    renderWorkspace(failed, { language });
    const panel = screen.getByRole('complementary', { name: 'OpenCreator' });
    expect(panel).toHaveTextContent('HTTP 400');
    expect(panel).toHaveTextContent('InputImageSensitiveContentDetected.SensitiveContent');
    expect(panel).toHaveTextContent('Reference image was rejected');
    expect(panel).toHaveTextContent('provider-request-123');
    expect(panel).not.toHaveTextContent('检查模型服务配置和网络');
    expect(panel).not.toHaveTextContent('尚未确认更细的原因');
  });

  it.each([
    ['zh-CN', '内容安全审核未通过'],
    ['en-US', 'content safety review'],
    ['sv-SE', 'innehållsgranskningen']
  ] as const)('explains an official content rejection in %s', (language, reason) => {
    const failed = failedVideoRequestJob('failed');
    failed.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('Rejected'), 'Video generation failed'),
      scope: { kind: 'creator-job', jobId: failed.id }, stageRunId: failed.stages[0]!.id,
      code: 'creator_video_generation_failed', publicFacts: {
        kind: 'http-rejected', provider: 'opencreator-gateway-video', httpStatus: 400,
        upstreamCode: 'upstream_rejected', upstreamMessage: '图片未通过内容安全审核', requestId: 'ocreq_content_rejected'
      }
    }];
    renderWorkspace(failed, { language });
    const panel = screen.getByRole('complementary', { name: 'OpenCreator' });
    expect(panel).toHaveTextContent(reason);
    expect(panel).toHaveTextContent('ocreq_content_rejected');
    expect(panel).not.toHaveTextContent('当前模型不支持这些参数');
  });

  it.each([
    ['zh-CN', '内容安全审核未通过'],
    ['en-US', 'content safety review'],
    ['sv-SE', 'innehållsgranskningen']
  ] as const)('explains an official video content-policy code in %s', (language, reason) => {
    const failed = failedVideoRequestJob('failed');
    failed.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('Rejected'), 'Video generation failed'),
      scope: { kind: 'creator-job', jobId: failed.id }, stageRunId: failed.stages[0]!.id,
      code: 'creator_video_generation_failed', publicFacts: {
        kind: 'http-rejected', provider: 'opencreator-gateway-video', httpStatus: 400,
        upstreamCode: 'content_policy_violation', upstreamMessage: 'Video failed content safety check', requestId: 'ocreq_video_rejected'
      }
    }];
    renderWorkspace(failed, { language });
    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent(reason);
  });

  beforeEach(() => {
    let objectUrlCount = 0;
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => `blob:video-${++objectUrlCount}`)
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
  });

  it('keeps the same video and playback position when session callbacks change', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    const view = renderWorkspace(completedVideoJob(), { openArtifact, children: <TaskRefreshControl /> });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;
    video.currentTime = 2;

    for (let update = 0; update < 3; update += 1) {
      fireEvent.click(screen.getByRole('button', { name: '刷新任务' }));
      view.rerenderWorkspace();
      await act(async () => undefined);
      expect(screen.getByLabelText('生成视频预览')).toBe(video);
      expect(video.src).toBe(source);
      expect(video.currentTime).toBe(2);
    }

    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('updates preview labels without reloading the video when the language changes', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(completedVideoJob(), { openArtifact, children: <LanguageSwitchControls /> });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;
    video.currentTime = 2;

    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    await act(async () => undefined);

    expect(screen.getByLabelText('Generated video preview')).toBe(video);
    expect(video.src).toBe(source);
    expect(video.currentTime).toBe(2);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('uses the latest transport only when the selected result changes', async () => {
    const initialTransport = vi.fn(async () => new Response(new Blob(['initial'])));
    const latestTransport = vi.fn(async () => new Response(new Blob(['latest'])));
    const view = renderWorkspace(completedVideoJob([videoArtifact(1), videoArtifact(2)]), {
      openArtifact: initialTransport
    });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;

    view.rerenderWorkspace({ openArtifact: latestTransport });
    await act(async () => undefined);
    expect(latestTransport).not.toHaveBeenCalled();
    expect(screen.getByLabelText('生成视频预览')).toBe(video);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    await waitFor(() => expect(latestTransport).toHaveBeenCalledWith(
      'creator_video_workspace', 'generated_video_v1'
    ));
    await waitFor(() => expect(screen.getByLabelText('生成视频预览')).not.toHaveAttribute('src', source));
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('discards and releases an outdated preview that completes after a version change', async () => {
    let resolveInitial!: (response: Response) => void;
    const initialRequest = new Promise<Response>(resolve => { resolveInitial = resolve; });
    const openArtifact = vi.fn(async (_jobId: string, artifactId: string) => (
      artifactId === 'generated_video_v2' ? initialRequest : new Response(new Blob(['current']))
    ));
    const view = renderWorkspace(completedVideoJob([videoArtifact(1), videoArtifact(2)]), { openArtifact });
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;

    await act(async () => { resolveInitial(new Response(new Blob(['outdated']))); });

    expect(screen.getByLabelText('生成视频预览')).toBe(video);
    expect(video.src).toBe(source);
    const outdatedSource = vi.mocked(URL.createObjectURL).mock.results.at(-1)!.value;
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(outdatedSource);
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(source);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('releases a pending result preview after the workspace is unmounted', async () => {
    let resolvePreview!: (response: Response) => void;
    const pendingPreview = new Promise<Response>(resolve => { resolvePreview = resolve; });
    const view = renderWorkspace(completedVideoJob(), { openArtifact: () => pendingPreview });
    view.unmount();

    await act(async () => { resolvePreview(new Response(new Blob(['video']))); });

    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      vi.mocked(URL.createObjectURL).mock.results[0]!.value
    );
  });

  it('does not reload the reference image when session callbacks change', async () => {
    const reference = { ...videoArtifact(1), id: 'reference_image', kind: 'reference_image' };
    const job = creatorJob({ artifacts: [reference], state: { referenceImageArtifactId: reference.id } });
    const openArtifact = vi.fn(async () => new Response(new Blob(['reference'], { type: 'image/png' })));
    const view = renderWorkspace(job, { openArtifact });
    await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(1));

    view.rerenderWorkspace();
    await act(async () => undefined);

    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('releases a pending reference preview after the workspace is unmounted', async () => {
    const reference = { ...videoArtifact(1), id: 'reference_image', kind: 'reference_image' };
    let resolvePreview!: (response: Response) => void;
    const pendingPreview = new Promise<Response>(resolve => { resolvePreview = resolve; });
    const job = creatorJob({ artifacts: [reference], state: { referenceImageArtifactId: reference.id } });
    const view = renderWorkspace(job, { openArtifact: () => pendingPreview });
    view.unmount();

    await act(async () => { resolvePreview(new Response(new Blob(['reference']))); });

    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      vi.mocked(URL.createObjectURL).mock.results[0]!.value
    );
  });

  it('shows a localized preview failure without retrying on unrelated updates', async () => {
    const openArtifact = vi.fn(async () => new Response('', { status: 404 }));
    const view = renderWorkspace(completedVideoJob(), { openArtifact, children: <LanguageSwitchControls /> });
    const status = view.container.querySelector('.video-result-player-status');
    await waitFor(() => expect(status).toHaveTextContent('视频预览加载失败，可以稍后重试或直接下载'));
    expect(status?.querySelector('.smart-dubbing-spinner')).toBeNull();

    view.rerenderWorkspace();
    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    await act(async () => undefined);

    expect(status).toHaveTextContent('The video preview failed to load. Retry later or download the file.');
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('shows first-generation waiting feedback without a fake percentage', () => {
    renderWorkspace(runningVideoJob());
    const notice = screen.getByRole('status', { name: '任务进度' });
    expect(notice).toHaveTextContent('视频生成中');
    expect(notice).toHaveTextContent('服务商未提供精确进度');
    expect(notice).toHaveTextContent('已运行');
    expect(notice).toHaveTextContent('最近收到状态');
    expect(notice).not.toHaveTextContent('%');
    expect(screen.getByRole('progressbar', { name: '生成视频进度' })).not.toHaveAttribute('aria-valuenow');
  });

  it.each(['queued', 'running'] as const)('shows waiting feedback while the task is %s', status => {
    renderWorkspace(runningVideoJob({ status, phase: 'queued' }));
    const notice = screen.getByRole('status', { name: '任务进度' });
    expect(notice).toHaveTextContent('任务正在服务商队列中');
    expect(notice).not.toHaveTextContent('%');
    expect(screen.getByRole('progressbar', { name: '生成视频进度' })).toHaveAttribute('data-indeterminate', 'true');
  });

  it('shows the same real progress in the result area and the shared task panel', () => {
    renderWorkspace(runningVideoJob({ percent: 54 }));
    expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('视频生成中 · 54%');
    expect(screen.getByRole('progressbar', { name: '生成视频进度' })).toHaveAttribute('aria-valuenow', '54');
    expect(screen.queryByText(/服务商未提供精确进度/)).not.toBeInTheDocument();
  });

  it('keeps the current video playable during regeneration and switches only when the new version arrives', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(runningVideoJob({ hasResult: true }), { openArtifact, children: <GenerationUpdateControls /> });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;
    video.currentTime = 2;
    expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('服务商未提供精确进度');
    expect(screen.getByText('新版本正在后台生成，可以继续预览和下载当前版本')).toBeVisible();
    expect(screen.getByRole('button', { name: '下载视频' })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: '更新生成进度' }));
    expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('下载生成的视频 · 90%');
    expect(screen.getByLabelText('生成视频预览')).toBe(video);
    expect(video.src).toBe(source);
    expect(video.currentTime).toBe(2);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '生成完成' }));
    expect(screen.queryByRole('status', { name: '任务进度' })).not.toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '项目 V2' })).toBeVisible();
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith('creator_video_workspace', 'generated_video_v2'));
    await waitFor(() => expect(screen.getByLabelText('生成视频预览')).not.toHaveAttribute('src', source));
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(source);
  });

  it('localizes retry feedback and preserves the existing preview across language switches', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(runningVideoJob({ hasResult: true, retrying: true }), { openArtifact, children: <LanguageSwitchControls /> });
    const video = await screen.findByLabelText('生成视频预览');
    expect(screen.getByRole('status', { name: '任务进度' })).toHaveTextContent('正在自动重试（第 2 次）');

    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    const notice = screen.getByRole('status', { name: 'Task progress' });
    expect(notice).toHaveTextContent('Retrying automatically (attempt 2)');
    expect(notice).toHaveTextContent('without submitting another generation task');
    expect(notice).not.toHaveTextContent('%');
    expect(screen.getByLabelText('Generated video preview')).toBe(video);

    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getByRole('status', { name: 'Uppgiftsförlopp' })).not.toHaveTextContent(/\p{Script=Han}/u);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('shows the actual video duration before browser metadata loads instead of the requested duration', async () => {
    const artifact = videoArtifact(1);
    artifact.metadata = { ...artifact.metadata, duration: 13.427, requestedDuration: 5 };
    renderWorkspace(completedVideoJob([artifact]), { openArtifact: async () => new Response(new Blob(['video'])) });

    const video = await screen.findByLabelText('生成视频预览');
    expect(video).toHaveAttribute('preload', 'metadata');
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:13');
    expect(screen.getByRole('complementary', { name: '任务摘要' })).toHaveTextContent('13.43 秒');
  });

  it('updates the playback clock from browser metadata, time updates, and seeks without reloading the video', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(completedVideoJob(), { openArtifact });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    const source = video.src;
    Object.defineProperty(video, 'duration', { configurable: true, value: 8.33 });
    fireEvent.loadedMetadata(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:08');

    video.currentTime = 3.7;
    fireEvent.timeUpdate(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:03 / 00:08');
    video.currentTime = 6;
    fireEvent.seeked(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:06 / 00:08');
    Object.defineProperty(video, 'duration', { configurable: true, value: 9.8 });
    fireEvent.durationChange(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:06 / 00:09');
    expect(screen.getByLabelText('生成视频预览')).toBe(video);
    expect(video.src).toBe(source);
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('does not invent a zero duration for invalid metadata (%s)', async invalidDuration => {
    const artifact = videoArtifact(1);
    artifact.metadata = { ...artifact.metadata, duration: invalidDuration, requestedDuration: 10 };
    renderWorkspace(completedVideoJob([artifact]), { openArtifact: async () => new Response(new Blob(['video'])) });
    const video = await screen.findByLabelText('生成视频预览');
    Object.defineProperty(video, 'duration', { configurable: true, value: invalidDuration });
    fireEvent.loadedMetadata(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / --:--');

    Object.defineProperty(video, 'duration', { configurable: true, value: 7.5 });
    fireEvent.durationChange(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:07');
    Object.defineProperty(video, 'duration', { configurable: true, value: invalidDuration });
    fireEvent.durationChange(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:07');
  });

  it('resets playback timing when a different result version is selected', async () => {
    renderWorkspace(completedVideoJob([videoArtifact(1), videoArtifact(2)]), {
      openArtifact: async () => new Response(new Blob(['video']))
    });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    Object.defineProperty(video, 'duration', { configurable: true, value: 8 });
    video.currentTime = 6;
    fireEvent.timeUpdate(video);
    expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:06 / 00:08');

    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    await waitFor(() => expect(screen.getByLabelText('播放时间')).toHaveTextContent('00:00 / 00:05'));
  });

  it('keeps timing and the video node stable across language switches', async () => {
    const openArtifact = vi.fn(async () => new Response(new Blob(['video'])));
    renderWorkspace(completedVideoJob(), { openArtifact, children: <LanguageSwitchControls /> });
    const video = await screen.findByLabelText<HTMLVideoElement>('生成视频预览');
    video.currentTime = 2;
    fireEvent.timeUpdate(video);

    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    expect(screen.getByText('Position / duration')).toBeVisible();
    expect(screen.getByLabelText('Playback time')).toHaveTextContent('00:02 / 00:05');
    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getByText('Position / längd')).toBeVisible();
    expect(screen.getByLabelText('Uppspelningstid')).toHaveTextContent('00:02 / 00:05');
    expect(openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  it('opens an existing project on the latest generated video version', async () => {
    const versionOne = videoArtifact(1);
    const versionTwo = videoArtifact(2);
    const job = creatorJob({
      status: 'completed',
      artifacts: [versionOne, versionTwo],
      state: {
        prompt: '当前编辑中的视频描述',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 1,
        furthestStep: 2,
        currentStage: 'generate',
        resultVersion: 2,
        latestResultVersion: 2,
        resultSnapshots: [
          resultSnapshot(1, versionOne),
          resultSnapshot(2, versionTwo)
        ]
      }
    });
    const openArtifact = vi.fn(async () => new Response(
      new Blob(['video'], { type: 'video/mp4' })
    ));

    renderWorkspace(job, { openArtifact });

    expect(await screen.findByRole('heading', { name: '生成结果' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V2' })).toBeInTheDocument();
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, versionTwo.id));
    fireEvent.click(screen.getByRole('button', { name: '项目 V2' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V1/ }));
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, versionOne.id));
  });

  it('does not expose a failed generation as a completed result version', () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'veo',
        size: '720x1280',
        duration: 8,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          phase: 'provider_failed',
          percent: null
        },
        errorCode: 'creator_video_generation_failed',
        errorMessage: 'The provider rejected the prompt',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    renderWorkspace(job);

    expect(screen.getByRole('textbox', { name: '提示词' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /项目 V/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新生成' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent('视频生成未完成，请检查模型服务配置后重试');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('The provider rejected the prompt')).not.toBeInTheDocument();
  });

  it('shows an actionable message when the selected model is not enabled', () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_model_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          phase: 'submitting',
          percent: 8
        },
        errorCode: 'creator_video_model_unavailable',
        errorMessage: 'Your account has not activated the model doubao-seedance-2-5',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    renderWorkspace(job, {
      openArtifact: vi.fn(async () => new Response(
        new Blob(['reference'], { type: 'image/png' })
      ))
    });

    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent(
      '当前账号未开通 Seedance 2.5，请切换模型版本或前往方舟控制台开通'
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('automatically continues an existing upstream task after a refresh failure', async () => {
    const job = creatorJob({
      status: 'failed',
      state: {
        prompt: '让猫开始打字',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: 'generate'
      },
      stages: [{
        id: 'failed_video_refresh_stage',
        jobId: 'creator_video_workspace',
        stageId: 'generate',
        executor: 'video',
        status: 'failed',
        dispatchStatus: 'finished',
        claimOwner: null,
        claimExpiresAt: null,
        attempt: 1,
        idempotencyKey: null,
        scopeKey: null,
        inputFingerprint: null,
        progress: {
          phase: 'generating',
          percent: null,
          videoGenerationResultId: 'video_result_1234'
        },
        errorCode: 'creator_video_upstream_error',
        errorMessage: 'The video generation status could not be refreshed',
        startedAt: '2026-09-07T08:00:00.000Z',
        finishedAt: '2026-09-07T08:01:00.000Z'
      }]
    });

    const view = renderWorkspace(job);

    expect(screen.queryByRole('button', { name: '取回原视频' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument();
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(job.id,
      expect.objectContaining({ action: 'run-stage', input: {
        stageId: 'generate', resumedFromStageRunId: job.stages[0]!.id
      } })));
  });

  it.each([
    ['zh-CN', '正在确认视频结果'],
    ['en-US', 'Checking the video result'],
    ['sv-SE', 'Kontrollerar videoresultatet']
  ] as const)('localizes the automatic recovery status in %s', (language, label) => {
    renderWorkspace(failedVideoRequestJob('waiting_remote'), { language });

    expect(screen.getByText(label)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: /取回原视频|Retrieve video|Hämta videon/ })).not.toBeInTheDocument();
  });

  it('checks an unresolved video request instead of silently submitting another one', async () => {
    const view = renderWorkspace(failedVideoRequestJob('unknown_remote_acceptance'));

    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(
      'creator_video_workspace',
      expect.objectContaining({ action: 'resolve-provider-request', input: { ledgerId: 'video_request', decision: 'query' } })
    ));
    expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(false);
    expect(screen.getByText('正在确认视频结果')).toHaveAttribute('role', 'status');
  });

  it('keeps recovery internal while the failed task is being checked', async () => {
    const view = renderWorkspace(failedVideoRequestJob('waiting_remote'));
    const form = screen.getByRole('form', { name: '视频生成' });

    expect(within(form).queryByRole('button', { name: '重新生成' })).not.toBeInTheDocument();
    expect(within(form).queryByRole('button', { name: '恢复视频' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取回原视频' })).not.toBeInTheDocument();
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(
      'creator_video_workspace',
      expect.objectContaining({ action: 'resolve-provider-request', input: { ledgerId: 'video_request', decision: 'query' } })
    ));
    expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(false);
  });

  it('shows Generate for a new task and Regenerate after an attempted task', () => {
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city at dusk' } }));
    expect(screen.getByRole('button', { name: '生成' })).toBeEnabled();

    view.unmount();
    renderWorkspace(failedVideoRequestJob('failed'));
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled();
  });

  it('checks a pending video request automatically without exposing a recovery button', async () => {
    const view = renderWorkspace(failedVideoRequestJob('waiting_remote'), { queryRequestStatus: 'succeeded' });

    expect(screen.queryByRole('button', { name: '取回原视频' })).not.toBeInTheDocument();
    expect(screen.queryByText('上次视频请求需要确认')).not.toBeInTheDocument();
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(
      'creator_video_workspace',
      expect.objectContaining({ action: 'resolve-provider-request', input: { ledgerId: 'video_request', decision: 'query' } })
    ));
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(
      'creator_video_workspace',
      expect.objectContaining({ action: 'run-stage', input: {
        stageId: 'generate', resumedFromStageRunId: 'running_video_stage'
      } })
    ));
    expect(view.applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage')).toHaveLength(1);
  });

  it('lets a confirmed failed request regenerate with one primary action', async () => {
    const view = renderWorkspace(failedVideoRequestJob('failed'), { gatewayState: readyWanGatewayState() });

    expect(screen.queryByRole('group', { name: '任务状态' })).not.toBeInTheDocument();
    const regenerate = screen.getByRole('button', { name: '重新生成' });
    expect(regenerate).toBeEnabled();
    fireEvent.click(regenerate);
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(
      'creator_video_workspace', expect.objectContaining({ action: 'run-stage', input: { stageId: 'generate' } })
    ));
  });

  it('shows the failure workspace if restoring an already confirmed result is rejected', async () => {
    const job = failedVideoRequestJob('succeeded');
    job.stages[0]!.errorCode = 'creator_video_generation_failed';
    const view = renderWorkspace(job, { runStageError: new Error('Recovery rejected') });

    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(job.id,
      expect.objectContaining({ action: 'run-stage', input: {
        stageId: 'generate', resumedFromStageRunId: job.stages[0]!.id
      } })));
    await waitFor(() => expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled());
    expect(screen.queryByText('正在确认视频结果')).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent('视频生成未完成');
  });

  it.each([
    ['zh-CN', '重新生成'],
    ['en-US', 'Regenerate'],
    ['sv-SE', 'Generera igen']
  ] as const)('localizes the primary retry label in %s', (language, label) => {
    renderWorkspace(failedVideoRequestJob('failed'), { language });

    expect(screen.getByRole('button', { name: label })).toBeEnabled();
  });

  it('recovers a confirmed video result without submitting a new generation request', async () => {
    const job = failedVideoRequestJob('waiting_remote');
    job.stages[0]!.errorCode = 'creator_video_generation_failed';
    const view = renderWorkspace(job, { queryRequestStatus: 'succeeded' });

    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(job.id,
      expect.objectContaining({ action: 'run-stage', input: {
        stageId: 'generate', resumedFromStageRunId: job.stages[0]!.id
      } })));
    expect(view.applyAction.mock.calls.map(([, request]) => request.action)).toEqual(
      expect.arrayContaining(['resolve-provider-request', 'run-stage'])
    );
  });

  it('keeps the saved video recovery available after reopening a confirmed request', async () => {
    const job = failedVideoRequestJob('succeeded');
    job.stages[0]!.errorCode = 'creator_video_generation_failed';
    const view = renderWorkspace(job);

    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(job.id,
      expect.objectContaining({ action: 'run-stage', input: {
        stageId: 'generate', resumedFromStageRunId: job.stages[0]!.id
      } })));
    expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'resolve-provider-request')).toBe(false);
  });

  it('does not start generation when a confirmed request has no saved local result', async () => {
    const job = failedVideoRequestJob('waiting_remote');
    delete job.stages[0]!.progress.videoGenerationResultId;
    const view = renderWorkspace(job, { queryRequestStatus: 'succeeded' });

    await waitFor(() => expect(document.querySelector('.creator-tool-error'))
      .toHaveTextContent('原视频已生成，但无法读取结果'));
    expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(false);
    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled();
    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent('原视频已生成，但无法读取结果');
  });

  it('explains an already confirmed video with no saved result after reopening', () => {
    const job = failedVideoRequestJob('succeeded');
    delete job.stages[0]!.progress.videoGenerationResultId;
    renderWorkspace(job);

    expect(screen.getByRole('button', { name: '重新生成' })).toBeEnabled();
    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent('原视频已生成，但无法读取结果');
    expect(screen.queryByRole('button', { name: '取回原视频' })).not.toBeInTheDocument();
  });

  it('allows a fresh generation after an interrupted task with no pending request', () => {
    const job = runningVideoJob();
    job.stages[0]!.status = 'interrupted';
    renderWorkspace(job);

    expect(within(screen.getByRole('form', { name: '视频生成' })).getByRole('button', { name: '重新生成' })).toBeEnabled();
    expect(screen.queryByRole('group', { name: '任务状态' })).not.toBeInTheDocument();
  });

  it('keeps the running task controls while its provider request is in progress', () => {
    const running = runningVideoJob();
    running.providerRequests = failedVideoRequestJob('waiting_remote').providerRequests;
    renderWorkspace(running);

    expect(screen.queryByRole('button', { name: '取回原视频' })).not.toBeInTheDocument();
  });

  it('resubmits a confirmed legacy price rejection with the selected model in one click', async () => {
    const rejected = failedVideoRequestJob('unknown_remote_acceptance');
    const reference = videoArtifact(1);
    reference.id = 'reference_image_1';
    reference.kind = 'reference_image';
    reference.metadata = { fileName: 'reference.png', mimeType: 'image/png', size: 1024 };
    rejected.artifacts = [reference];
    rejected.state.referenceImageArtifactId = reference.id;
    rejected.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('price changed'), 'Video price changed'),
      scope: { kind: 'creator-job', jobId: rejected.id }, source: 'provider',
      stageRunId: rejected.stages[0]!.id, code: 'creator_provider_resolution_required',
      publicFacts: { kind: 'http-rejected', httpStatus: 409, upstreamCode: 'video_price_changed' }
    }];
    const gatewayState = readyWanGatewayState();
    const getState = vi.fn(async () => gatewayState);
    const view = renderWorkspace(rejected, { gatewayState,
      gatewayAccountService: { getState },
      openArtifact: async () => new Response(new Blob(['reference'], { type: 'image/png' })) });

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(rejected.id,
      expect.objectContaining({ action: 'resolve-provider-request',
        input: { ledgerId: 'video_request', decision: 'cancel-scope' } })));
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(rejected.id,
      expect.objectContaining({ action: 'run-stage', input: { stageId: 'generate' } })));
    const actions = view.applyAction.mock.calls.map(([, request]) => request.action);
    expect(actions.indexOf('resolve-provider-request')).toBeLessThan(actions.indexOf('run-stage'));
    expect(actions.filter(action => action === 'run-stage')).toHaveLength(1);
    expect(getState).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('Wan 3.0');
    expect(mergedSettingsPatch(view.applyAction.mock.calls)).toMatchObject({ model: 'wan3.0-video' });
    expect(mergedSettingsPatch(view.applyAction.mock.calls)).not.toHaveProperty('videoPriceVersion');
    expect(screen.getByRole('button', { name: '移除参考图' })).toBeInTheDocument();
  });

  it.each(['zh-CN', 'en-US', 'sv-SE'] as const)('shows a safe, localized submission failure in %s', async language => {
    const failure = Object.assign(new Error('Authorization: Bearer sk-private-value'), {
      publicFacts: { kind: 'http-rejected', provider: 'opencreator-gateway-video', httpStatus: 402,
        upstreamCode: 'credits_insufficient', upstreamMessage: 'Authorization: Bearer sk-private-value' }
    });
    const view = renderWorkspace(creatorJob({ state: { prompt: 'A city at dusk' } }), {
      language, gatewayState: readyWanGatewayState(), runStageError: failure
    });

    fireEvent.click(screen.getByRole('button', { name: language === 'zh-CN' ? '生成' : language === 'sv-SE' ? 'Generera' : 'Generate' }));
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'run-stage' })));
    await waitFor(() => expect(document.querySelector('.creator-tool-error')).toHaveTextContent(
      language === 'zh-CN' ? '积分不足' : language === 'sv-SE' ? 'Krediterna räcker inte' : 'Insufficient credits'
    ));
    expect(document.querySelector('.creator-tool-error')).not.toHaveTextContent(/sk-private-value|Bearer|Authorization/);
  });

  it('queries a non-unknown request even when a price-change issue is present', async () => {
    const rejected = failedVideoRequestJob('waiting_remote');
    rejected.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('price changed'), 'Video price changed'),
      scope: { kind: 'creator-job', jobId: rejected.id }, source: 'provider',
      stageRunId: rejected.stages[0]!.id, code: 'creator_provider_resolution_required',
      publicFacts: { kind: 'http-rejected', httpStatus: 409, upstreamCode: 'video_price_changed' }
    }];
    const view = renderWorkspace(rejected);

    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(rejected.id,
      expect.objectContaining({ action: 'resolve-provider-request',
        input: { ledgerId: 'video_request', decision: 'query' } })));
  });

  it('does not resubmit a legacy price rejection when a remote request id exists', async () => {
    const rejected = failedVideoRequestJob('unknown_remote_acceptance');
    rejected.providerRequests[0]!.remoteTaskId = 'ocreq_existing';
    rejected.issues = [{ ...normalizePageIssue('runtime', 'creator.retry-stage', new Error('price changed'), 'Video price changed'),
      scope: { kind: 'creator-job', jobId: rejected.id }, source: 'provider', stageRunId: rejected.stages[0]!.id,
      code: 'creator_provider_resolution_required',
      publicFacts: { kind: 'http-rejected', httpStatus: 409, upstreamCode: 'video_price_changed' }
    }];
    const view = renderWorkspace(rejected);

    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(rejected.id,
      expect.objectContaining({ action: 'resolve-provider-request', input: { ledgerId: 'video_request', decision: 'query' } })));
    expect(view.applyAction.mock.calls.some(([, request]) => request.action === 'run-stage')).toBe(false);
  });

  it('allows a new video generation with the selected model after the old request failed', async () => {
    const view = renderWorkspace(failedVideoRequestJob('failed'), { gatewayState: readyWanGatewayState() });

    fireEvent.click(screen.getByRole('button', { name: '重新生成' }));
    await waitFor(() => expect(view.applyAction).toHaveBeenCalledWith(
      'creator_video_workspace',
      expect.objectContaining({ action: 'run-stage', input: { stageId: 'generate' } })
    ));
  });

  it('shows that Seedance reference-image generation follows the image ratio', async () => {
    const reference = videoArtifact(1);
    reference.id = 'reference_image_1';
    reference.kind = 'reference_image';
    reference.path = '/tmp/reference.png';
    reference.metadata = {
      fileName: 'reference.png',
      mimeType: 'image/png',
      size: 1024
    };
    const job = creatorJob({
      artifacts: [reference],
      state: {
        prompt: '让猫开始打字',
        provider: 'seedance',
        model: 'doubao-seedance-2-5-260628',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: reference.id,
        currentStep: 1,
        furthestStep: 1,
        currentStage: null
      }
    });

    const openArtifact = vi.fn(async () => new Response(
      new Blob(['reference'], { type: 'image/png' })
    ));
    renderWorkspace(job, { openArtifact });

    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    openVideoSettings();
    expect(screen.getByRole('radio', { name: '16:9' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '视频设置' })).toHaveTextContent('原图');
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, reference.id));
  });

  it('uses distinct English labels for video format and output format', async () => {
    const job = creatorJob({
      state: {
        prompt: 'A cinematic city reveal',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 2,
        furthestStep: 2,
        currentStage: null
      }
    });

    renderWorkspace(job, { language: 'en-US' });

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveValue('Local video service'));
    openVideoSettings('Video settings');
    expect(screen.getByRole('radiogroup', { name: 'Format' })).toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: 'Task summary' })).getByText('Output format')).toBeInTheDocument();
  });

  it('preserves an edited prompt when service defaults arrive late', async () => {
    let resolveConfig!: (value: CreatorServicesConfigResponse) => void;
    const pendingConfig = new Promise<CreatorServicesConfigResponse>(resolve => { resolveConfig = resolve; });
    renderWorkspace(creatorJob({ state: {
      provider: 'seedance', model: 'doubao-seedance-2-0-260128',
      duration: 5, currentStep: 1, furthestStep: 1
    } }), { creatorServicesService: { getConfig: () => pendingConfig } });
    const model = screen.getByRole('combobox', { name: '模型' });
    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), { target: { value: 'Edited before config' } });
    await act(async () => { resolveConfig({ config: createVideoConfig(), configuredCredentials: ['video.seedance.apiKey'] }); });
    expect(model).toHaveValue('本地视频服务');
    expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue('Edited before config');
  });

  it('selects the configured local video service for new tasks', async () => {
    renderWorkspace(creatorJob({}), {
      creatorServicesService: {
        getConfig: async () => ({ config: createVideoConfig(), configuredCredentials: ['video.seedance.apiKey'] })
      }
    });

    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    expect(screen.getByRole('complementary', { name: '任务摘要' })).toHaveTextContent('Seedance 2.5');
  });

  it('migrates the legacy Seedance 1.0 Pro service default to Seedance 2.5', async () => {
    const config = createVideoConfig();
    config.video.seedance.model = 'doubao-seedance-1-0-pro-250528';
    renderWorkspace(creatorJob({}), {
      creatorServicesService: {
        getConfig: async () => ({ config, configuredCredentials: ['video.seedance.apiKey'] })
      }
    });

    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    expect(screen.getByRole('complementary', { name: '任务摘要' })).toHaveTextContent('Seedance 2.5');
  });

  it('uses the configured local model for a task without adding it to the gateway catalog', async () => {
    const job = creatorJob({
      state: {
        prompt: '雨夜中的未来城市',
        provider: 'seedance',
        size: '1280x720',
        duration: 5,
        referenceImageArtifactId: null,
        currentStep: 1,
        furthestStep: 1,
        currentStage: null
      }
    });
    const getConfig = vi.fn(async (): Promise<CreatorServicesConfigResponse> => ({
      config: {
        ...createVideoConfig(),
        video: {
          ...createVideoConfig().video,
          provider: 'seedance',
          seedance: {
            ...createVideoConfig().video.seedance,
            model: 'doubao-seedance-2-0-260128'
          }
        }
      },
      configuredCredentials: ['video.seedance.apiKey']
    }));

    renderWorkspace(job, {
      creatorServicesService: { getConfig } as never
    });

    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本地视频服务'));
    expect(screen.getByRole('complementary', { name: '任务摘要' })).toHaveTextContent('Seedance 2.0');
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    expect(screen.queryByRole('option', { name: 'Seedance 2.5' })).not.toBeInTheDocument();
  });
});

function openVideoSettings(label = '视频设置') {
  fireEvent.click(screen.getByRole('button', { name: label }));
  return screen.getByRole('dialog', { name: label });
}

const defaultVideoServices = {
  getConfig: async () => ({
    config: createVideoConfig(),
    configuredCredentials: ['video.seedance.apiKey', 'video.veo.apiKey', 'video.kling.accessKey', 'video.kling.secretKey']
  })
};

function mergedSettingsPatch(calls: Array<[string, { action: string; input: { patch?: Record<string, CreatorJson> } }]>): Record<string, CreatorJson> {
  return Object.assign({}, ...calls.filter(([, request]) => request.action === 'update-settings').map(([, request]) => request.input.patch ?? {}));
}

function renderWorkspace(
  initialJob: CreatorJob,
  overrides: {
    openArtifact?: (jobId: string, artifactId: string) => Promise<Response>;
    uploadReferenceImage?: (jobId: string, input: { file: File; expectedRevision: number }) => Promise<unknown>;
    creatorServicesService?: { getConfig(): Promise<CreatorServicesConfigResponse> };
    language?: 'zh-CN' | 'en-US' | 'sv-SE';
    children?: ReactNode;
    gatewayState?: GatewayAccountState | null;
    gatewayAccountService?: unknown;
    onGatewayStateChange?: (state: GatewayAccountState) => void;
    accessGate?: boolean;
    runStageError?: Error;
    queryRequestStatus?: CreatorJob['providerRequests'][number]['status'];
  } = {}
) {
  const applyAction = vi.fn(async (_id: string, request: { action: string; input: { version?: CreatorJson; patch?: Record<string, CreatorJson>; decision?: string; ledgerId?: string } }) => {
    if (request.action === 'run-stage' && overrides.runStageError) throw overrides.runStageError;
    return ({
    job: { ...initialJob, revision: initialJob.revision + 1, state: { ...initialJob.state, ...(request.action === 'select-result-version' ? { resultVersion: request.input.version } : request.input.patch) },
      providerRequests: request.action === 'resolve-provider-request' && (request.input.decision === 'cancel-scope' || (request.input.decision === 'query' && overrides.queryRequestStatus))
        ? initialJob.providerRequests.map(item => item.id === request.input.ledgerId ? { ...item, status: request.input.decision === 'cancel-scope' ? 'canceled' as const : overrides.queryRequestStatus! } : item)
        : initialJob.providerRequests },
    receipt: {}
    });
  });
  const workspace = (options: typeof overrides) => (
    <LanguageProvider initialPreference={options.language ?? 'zh-CN'}>
      <CreatorSessionProvider
        initialJob={initialJob}
        onPreJobFailure={() => undefined}
        service={{
          applyAction,
          openArtifact: options.openArtifact ?? vi.fn(),
          uploadReferenceImage: options.uploadReferenceImage,
          runAgentTurn: vi.fn()
        } as never}
      >
        {options.accessGate ? <DashboardGenerationAccess gatewayState={options.gatewayState} gatewayAccountService={options.gatewayAccountService as never} onGatewayStateChange={options.onGatewayStateChange}>
          <OfficialServicesContext.Provider value={options.gatewayState}>
            <VideoGenerationWorkspace creatorServicesService={(options.creatorServicesService ?? defaultVideoServices) as never} gatewayAccountService={options.gatewayAccountService as never} onGatewayStateChange={options.onGatewayStateChange} onBack={vi.fn()} />
            {options.children}
          </OfficialServicesContext.Provider>
        </DashboardGenerationAccess> : <OfficialServicesContext.Provider value={options.gatewayState}>
        <VideoGenerationWorkspace
          creatorServicesService={(options.creatorServicesService ?? defaultVideoServices) as never}
          gatewayAccountService={options.gatewayAccountService as never}
          onGatewayStateChange={options.onGatewayStateChange}
          onBack={vi.fn()}
        />
        {options.children}
        </OfficialServicesContext.Provider>}
      </CreatorSessionProvider>
    </LanguageProvider>
  );
  const view = render(workspace(overrides));
  return {
    ...view,
    applyAction,
    rerenderWorkspace(patch: typeof overrides = {}) {
      view.rerender(workspace({ ...overrides, ...patch }));
    }
  };
}

function completedVideoJob(artifacts = [videoArtifact(1)]): CreatorJob {
  return creatorJob({
    status: 'completed',
    artifacts,
    state: {
      currentStep: 2,
      furthestStep: 2,
      resultVersion: artifacts.at(-1)!.version,
      resultSnapshots: artifacts.map(artifact => resultSnapshot(artifact.version, artifact))
    }
  });
}

function TaskRefreshControl() {
  const session = useCreatorSession();
  return <button type="button" onClick={() => session.applyRemoteSnapshot({
    ...session.job,
    revision: session.job.revision + 1,
    artifacts: session.job.artifacts.map(artifact => ({ ...artifact })),
    state: { ...session.state }
  })}>刷新任务</button>;
}

function runningVideoJob(options: {
  hasResult?: boolean;
  phase?: string;
  percent?: number;
  status?: CreatorStageRun['status'];
  retrying?: boolean;
} = {}): CreatorJob {
  const job = options.hasResult ? completedVideoJob() : creatorJob({ state: { currentStep: 2, furthestStep: 2 } });
  return {
    ...job,
    status: 'running',
    stages: [{
      id: 'running_video_stage', jobId: job.id, stageId: 'generate', executor: 'video',
      status: options.status ?? 'running', dispatchStatus: 'claimed', claimOwner: null,
      claimExpiresAt: null, attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null,
      progress: {
        phase: options.phase ?? 'generating', percent: options.percent ?? null,
        ...(options.retrying ? { refreshRetry: 2, message: 'The provider status connection was interrupted and will be retried' } : {})
      },
      errorCode: null, errorMessage: null,
      startedAt: options.status === 'queued' ? null : new Date().toISOString(), finishedAt: null
    }]
  };
}

function failedVideoRequestJob(status: CreatorJob['providerRequests'][number]['status']): CreatorJob {
  const running = runningVideoJob();
  const stage = running.stages[0]!;
  return {
    ...running,
    status: 'failed',
    state: { ...running.state, prompt: 'A girl eats the moon', videoServiceSource: 'gateway',
      officialModels: { video: 'wan3.0-video' }, size: '720p@16:9', duration: 5 },
    stages: [{ ...stage, status: 'failed', errorCode: 'creator_video_upstream_error',
      errorMessage: 'Video price has changed', progress: { phase: 'submitting',
        videoGenerationResultId: 'old_video_result', videoModelId: 'gemini-omni-flash-1.1' } }],
    providerRequests: [{
      id: 'video_request', jobId: running.id, provider: 'opencreator-gateway-video', stageRunId: stage.id,
      scopeKey: null, requestKey: 'old_request', requestHash: 'old_hash', remoteTaskId: null,
      billingSideEffect: true, status, resultArtifactId: null, generation: 1,
      resubmissionOf: null, createdAt: running.createdAt, updatedAt: running.updatedAt
    }]
  };
}

function readyWanGatewayState(): GatewayAccountState {
  return {
    source: 'gateway', transport: 'gateway', authState: 'signed_in', activationState: 'ready',
    account: { id: 'account', email: 'user@example.com', verified: true }, bindingVersion: 'account:1',
    models: [{ id: 'wan3.0-video', name: 'Wan 3.0', modality: 'video', capabilities: ['generate', 'image_to_video'],
      sizes: ['720p@16:9'], durations: [5], price: { version: 'wan-price-v2' },
      videoOptions: { profile: 'wan', maxImages: 10, maxVideos: 5, maxAudios: 5, firstLastFrames: true, framesExclusive: true, generateAudio: false } }],
    activationError: null
  };
}

function GenerationUpdateControls() {
  const session = useCreatorSession();
  function update(completed: boolean) {
    const artifact = videoArtifact(2);
    session.applyRemoteSnapshot({
      ...session.job,
      revision: session.job.revision + 1,
      status: completed ? 'completed' : 'running',
      artifacts: completed ? [...session.job.artifacts, artifact] : session.job.artifacts,
      state: completed ? { ...session.state, resultVersion: 2, resultSnapshots: [
        ...(session.state.resultSnapshots as CreatorJson[]), resultSnapshot(2, artifact)
      ] } : session.state,
      stages: session.job.stages.map(stage => ({ ...stage, status: completed ? 'succeeded' : 'running', progress: {
        phase: completed ? 'completed' : 'downloading', percent: completed ? 100 : 90
      } }))
    });
  }
  return <>
    <button type="button" onClick={() => update(false)}>更新生成进度</button>
    <button type="button" onClick={() => update(true)}>生成完成</button>
  </>;
}

function createVideoConfig() {
  return {
    proxy: '',
    llm: {
      baseUrl: '',
      apiKey: '',
      model: 'gpt-4o-mini',
      jsonMode: false,
      source: 'codex' as const
    },
    transcription: {
      provider: 'openai' as const,
      enableGpuAcceleration: false,
      openai: { baseUrl: '', apiKey: '', model: 'whisper-1' },
      fasterWhisper: { model: 'medium' as const },
      whisperKit: { model: 'large-v2' as const },
      whisperCpp: { model: 'tiny' as const },
      aliyun: {
        oss: { accessKeyId: '', accessKeySecret: '', bucket: '', region: 'cn-shanghai', endpoint: '' },
        speech: { accessKeyId: '', accessKeySecret: '', appKey: '' }
      },
      volcengine: {
        appId: '',
        accessToken: '',
        resourceId: 'volc.seedasr.auc',
        baseUrl: 'https://openspeech.bytedance.com'
      },
      funasr: { baseUrl: 'http://127.0.0.1:8000/v1', apiKey: '', model: 'sensevoice', timeoutMs: 120000 }
    },
    tts: {
      provider: 'openai' as const,
      openai: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' },
      minimax: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' },
      aliyun: { baseUrl: '', apiKey: '', model: '', defaultVoiceId: '' },
      volcengine: {
        baseUrl: 'https://openspeech.bytedance.com',
        accessToken: '',
        model: 'volcano_tts',
        defaultVoiceId: 'BV001_streaming',
        appId: ''
      }
    },
    image: {
      provider: 'openai' as const,
      openai: { baseUrl: '', apiKey: '', model: '' },
      jimeng: { baseUrl: '', apiKey: '', model: '' },
      kling: { baseUrl: '', accessKey: '', secretKey: '', model: '' },
      gemini: { baseUrl: '', apiKey: '', model: '' },
      codexNative: {}
    },
    video: {
      provider: 'seedance' as const,
      seedance: { baseUrl: '', apiKey: '', model: 'doubao-seedance-2-5-260628' },
      kling: { baseUrl: '', accessKey: '', secretKey: '', model: 'kling-v2-1-master' },
      veo: { baseUrl: '', apiKey: '', model: 'veo-3.1-generate-preview' }
    }
  };
}

function creatorJob(patch: Partial<CreatorJob>): CreatorJob {
  const createdAt = '2026-09-07T08:00:00.000Z';
  return {
    id: 'creator_video_workspace',
    projectId: 'project_1',
    templateId: 'video-generation',
    templateVersion: 1,
    status: 'draft',
    revision: 1,
    presetOrigin: null,
    state: {
      prompt: '',
      provider: 'seedance',
      size: '1280x720',
      duration: 5,
      referenceImageArtifactId: null,
      currentStep: 0,
      furthestStep: 0,
      currentStage: null
    },
    agentThreadId: null,
    stages: [],
    artifacts: [],
    providerRequests: [],
    activities: [],
    createdAt,
    updatedAt: createdAt,
    ...patch
  };
}

function videoArtifact(version: number): CreatorArtifact {
  return {
    id: `generated_video_v${version}`,
    jobId: 'creator_video_workspace',
    kind: 'generated_video',
    version,
    status: 'completed',
    path: `/tmp/generated-video-v${version}.mp4`,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      provider: version === 1 ? 'seedance' : 'veo',
      model: version === 1 ? 'seedance-model' : 'veo-model',
      videoSize: version === 1 ? '1280x720' : '720x1280',
      requestedDuration: version === 1 ? 5 : 8,
      duration: version === 1 ? 5 : 8,
      fileName: `OpenCreator-video-V${version}.mp4`,
      mimeType: 'video/mp4',
      bytes: version * 1024,
      resultVersion: version
    },
    createdAt: `2026-09-07T08:0${version}:00.000Z`
  };
}

function resultSnapshot(
  version: number,
  artifact: CreatorArtifact
): CreatorJson {
  return {
    version,
    createdAt: artifact.createdAt,
    action: 'stage-succeeded',
    stageId: 'generate',
    description: version === 1 ? '初次生成' : `第 ${version} 次生成`,
    artifactRefs: { generated_video: [artifact.id] },
    changedArtifactIds: [artifact.id],
    staleArtifactIds: [],
    state: {
      prompt: version === 1 ? '海岸公路' : '雨夜城市',
      provider: version === 1 ? 'seedance' : 'veo',
      size: version === 1 ? '1280x720' : '720x1280',
      duration: version === 1 ? 5 : 8,
      referenceImageArtifactId: null
    }
  };
}
