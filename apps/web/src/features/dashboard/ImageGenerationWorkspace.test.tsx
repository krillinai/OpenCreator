import { changeControl } from '../../test/select-option.js';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  CreatorActionRequest,
  CreatorArtifact,
  CreatorJob,
  CreatorJson,
  GatewayAccountState
} from '@opencreator/protocol';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { AppLanguage } from '../../i18n/language.js';
import ImageGenerationWorkspace from './ImageGenerationWorkspace.js';
import { CreatorSessionProvider, useOptionalCreatorSession, type CreatorSessionContextValue } from './creator-session-store.js';
import { OfficialServicesContext } from './official-services.js';

describe('ImageGenerationWorkspace', () => {
  it.each([
    { provider: 'gemini' as const, model: 'gemini-2.5-flash-image', ratios: 10, resolutions: [], qualities: [] },
    { provider: 'gemini' as const, model: 'gemini-3-pro-image-preview', ratios: 10, resolutions: ['1K', '2K', '4K'], qualities: [] },
    { provider: 'gemini' as const, model: 'gemini-3.1-flash-image-preview', ratios: 14, resolutions: ['1K', '2K', '4K', '512'], qualities: [] },
    { provider: 'jimeng' as const, model: 'doubao-seedream-4-0-250828', ratios: 10, resolutions: ['2K', '4K'], qualities: [] },
    { provider: 'kling' as const, model: 'kling-v2-1', ratios: 7, resolutions: [], qualities: [] },
    { provider: 'openai' as const, model: 'gpt-image-2', ratios: 9, resolutions: ['1K', '2K'], qualities: ['low', 'medium', 'high', 'auto'] },
    { provider: 'openai' as const, model: 'gpt-image-2.5-sunburst', ratios: 9, resolutions: ['1K', '2K'], qualities: ['low', 'medium', 'high', 'xhigh', 'max', 'auto'] },
    { provider: 'openai' as const, model: 'custom-model', ratios: 0, resolutions: [], qualities: [] }
  ])('matches manual controls to $model', async ({ provider, model, ratios, resolutions, qualities }) => {
    const fixture = createFixture();
    const config = createDefaultCreatorServicesConfig();
    config.image[provider].model = model;
    const getConfig = vi.fn(async () => ({ config }));
    renderWorkspace(fixture, { ...fixture.currentJob(), state: { prompt: 'A city', provider, providerSource: 'user' } }, { getConfig });
    await act(async () => { await Promise.resolve(); });
    const settings = openImageSettings();
    const format = within(settings).queryByRole('radiogroup', { name: '图片画幅' });
    if (ratios) expect(within(format!).getAllByRole('radio')).toHaveLength(ratios);
    else expect(format).not.toBeInTheDocument();
    for (const [label, values] of [['分辨率', resolutions], ['图片质量', qualities]] as const) {
      const control = within(settings).queryByRole('radiogroup', { name: label });
      if (values.length) expect(within(control!).getAllByRole('radio').map(option => option.getAttribute('data-value'))).toEqual(values);
      else expect(control).not.toBeInTheDocument();
    }
    expect(getConfig).toHaveBeenCalledOnce();
    expect(fixture.applyAction).not.toHaveBeenCalled();
  });

  it('submits Gemini settings and resets incompatible selections when switching models', async () => {
    const fixture = createFixture();
    const config = createDefaultCreatorServicesConfig();
    config.image.gemini.model = 'gemini-3-pro-image-preview';
    renderWorkspace(fixture, { ...fixture.currentJob(), state: { prompt: 'A city', provider: 'gemini', providerSource: 'user' } }, { getConfig: async () => ({ config }) });
    const settings = openImageSettings();
    await within(settings).findByRole('radiogroup', { name: '分辨率' });
    chooseImageSetting('图片画幅', '21:9');
    chooseImageSetting('分辨率', '4K');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'run-stage' })));
    expect(fixture.currentJob().state)
      .toMatchObject({ aspectRatio: '21:9', resolution: '4K', modelQuality: '' });
    fireEvent.click(screen.getByRole('combobox', { name: '模型' }));
    fireEvent.click(screen.getByRole('button', { name: 'OpenAI 2 个模型' }));
    fireEvent.click(screen.getByRole('option', { name: 'GPT Image' }));
    openImageSettings();
    expect(screen.getByRole('radio', { name: '1:1' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '1K' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '标准' })).toHaveAttribute('aria-checked', 'true');
  });

  it('falls back to GPT when the default Codex provider is unavailable', async () => {
    const fixture = createFixture({ pending: true });
    const config = createDefaultCreatorServicesConfig();
    renderWorkspace(fixture, fixture.currentJob(), {
      getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })),
      getCodexImageStatus: vi.fn(async () => ({ ready: false }))
    });

    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('GPT Image'));
    expect(fixture.ensureJob).not.toHaveBeenCalled();
  });

  it('persists an inherited provider together with its model parameters when generating an existing draft', async () => {
    const fixture = createFixture();
    const config = createDefaultCreatorServicesConfig();
    config.image.provider = 'gemini';
    config.image.gemini.model = 'gemini-3-pro-image-preview';
    renderWorkspace(fixture, fixture.currentJob(), { getConfig: async () => ({ config }) });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('Gemini'));
    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), { target: { value: 'A city' } });
    openImageSettings();
    chooseImageSetting('图片画幅', '16:9');
    chooseImageSetting('分辨率', '4K');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'run-stage' })));
    expect(fixture.currentJob().state).toMatchObject({ provider: 'gemini', aspectRatio: '16:9', resolution: '4K' });
  });

  it('uses official image metadata and constrains candidate count to the selected model', async () => {
    const fixture = createFixture();
    const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', models: [{ id: 'vendor/image', modality: 'image', capabilities: [], imageOptions: { aspectRatios: ['16:9', '9:16'], resolutions: ['1K', '2K'], qualities: ['standard', 'hd'], outputFormats: ['jpeg'], maxImages: 1, maxReferences: 0 } }], activationError: null };
    renderWorkspace(fixture, { ...fixture.currentJob(), state: { prompt: 'city', currentStep: 1, furthestStep: 1 } }, { getConfig: vi.fn() }, state);
    const settings = openImageSettings();
    expect(screen.getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'true');
    expect(within(settings).getByRole('radiogroup', { name: '图片质量' })).toHaveTextContent('标准高清');
    chooseImageSetting('分辨率', '2K');
    chooseImageSetting('图片质量', '高清');
    expect(screen.queryByRole('radio', { name: '4 张' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '1 张' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalled());
    const update = fixture.applyAction.mock.calls.find(([, request]) => request.action === 'update-settings');
    expect(update?.[1].input.patch).toMatchObject({ aspectRatio: '16:9', resolution: '2K', officialQuality: 'hd', candidateCount: 1 });
  });
  it('shows a four-image batch as four images and clears unsupported references before submission', async () => {
    const fixture = createFixture();
    const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@test', verified: true }, bindingVersion: '1', models: [{ id: 'midjourney-v8.2', catalogSchema: 2, modality: 'image', capabilities: ['generate'], imageOptions: { maxImages: 1, imagesPerRequest: 4, maxReferences: 0 } }], activationError: null };
    const reference = { ...imageArtifact('creator_job_image_ui', 1, new Date().toISOString()), kind: 'reference_image' as const };
    renderWorkspace(fixture, { ...fixture.currentJob(), artifacts: [reference], state: { prompt: 'city', currentStep: 1, furthestStep: 1, referenceImageArtifactId: reference.id } }, { getConfig: vi.fn() }, state);
    openImageSettings();
    expect(screen.getByRole('radio', { name: '4 张' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('radio', { name: '1 张' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('上传图像生成参考图')).not.toBeInTheDocument();
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'update-settings', input: expect.objectContaining({ patch: expect.objectContaining({ referenceImageArtifactId: null }) }) })));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ action: 'run-stage' })));
    expect(fixture.currentJob().state.candidateCount).toBe(1);
    expect(fixture.uploadReferenceImage).not.toHaveBeenCalled();
  });
  it('allows only official image choices and submits the task choice without changing defaults', async () => {
    const fixture = createFixture();
    const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', selectedModels: { image: 'official/first' }, models: [{ id: 'official/first', modality: 'image', capabilities: [] }, { id: 'official/second', modality: 'image', capabilities: ['edit'] }], activationError: null };
    const getConfig = vi.fn();
    renderWorkspace(fixture, { ...fixture.currentJob(), state: { prompt: 'city skyline', provider: 'codex-native', currentStep: 1, furthestStep: 1 } }, { getConfig }, state);
    const model = screen.getByRole('combobox', { name: '图片模型' });
    fireEvent.click(model);
    expect(within(screen.getByRole('listbox', { name: '图片模型' })).getAllByRole('option').map(option => option.getAttribute('aria-label'))).toEqual(['first', 'second']);
    expect(screen.queryByRole('combobox', { name: '模型' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'second' }));
    await waitFor(() => expect(model).toHaveValue('second'));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith('creator_job_image_ui', expect.objectContaining({ action: 'run-stage', input: { stageId: 'generate' } })));
    const update = fixture.applyAction.mock.calls.find(([, request]) => request.action === 'update-settings');
    expect(update?.[1].input.patch).toMatchObject({ provider: 'openai', officialModels: { image: 'official/second' } });
    expect(state.selectedModels?.image).toBe('official/first');
    expect(getConfig).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:image-generation-reference')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
  });

  it('validates and submits prompt and settings directly without persisting wizard steps', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请先描述需要生成的画面');
    expect(fixture.applyAction).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), { target: { value: '  A coastal landscape  ' } });
    openImageSettings();
    chooseImageSetting('图片画幅', '3:2');
    chooseImageSetting('图片质量', '高清');
    fireEvent.click(screen.getByRole('radio', { name: '4 张' }));
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith('creator_job_image_ui', expect.objectContaining({ action: 'run-stage' })));
    const updates = fixture.applyAction.mock.calls.filter(([, request]) => request.action === 'update-settings');
    expect(updates.at(-1)?.[1].input.patch).toMatchObject({ prompt: 'A coastal landscape', aspectRatio: '3:2', modelQuality: 'high', candidateCount: 4 });
    for (const [, request] of updates) {
      expect(request.input.patch).not.toHaveProperty('currentStep');
      expect(request.input.patch).not.toHaveProperty('furthestStep');
    }
  });

  it('previews, removes and reselects the same reference file in the single form', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const input = screen.getByLabelText('上传图像生成参考图');
    const image = new File([png('reference')], 'reference.png', { type: 'image/png' });
    changeControl(input, { target: { files: [image] } });
    expect(await screen.findByRole('img', { name: '图像生成参考图' })).toBeVisible();
    expect(document.querySelector('.image-generation-reference')).toHaveTextContent('reference.png');
    expect(document.querySelector('.image-generation-reference')).toHaveTextContent('1/1');
    fireEvent.click(screen.getByRole('button', { name: '移除参考图' }));
    expect(screen.queryByRole('img', { name: '图像生成参考图' })).not.toBeInTheDocument();
    changeControl(input, { target: { files: [image] } });
    expect(await screen.findByRole('img', { name: '图像生成参考图' })).toBeVisible();
    expect(input).toHaveValue('');
  });

  it('prevents duplicate submissions and settings changes while a reference uploads', async () => {
    const fixture = createFixture();
    let release!: () => void;
    const pendingUpload = new Promise<void>(resolve => { release = resolve; });
    const upload = fixture.uploadReferenceImage.getMockImplementation()!;
    fixture.uploadReferenceImage.mockImplementationOnce(async (...args) => {
      await pendingUpload;
      return upload(...args);
    });
    renderWorkspace(fixture);
    const form = screen.getByRole('form', { name: '图像生成' });
    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), { target: { value: 'A landscape' } });
    changeControl(screen.getByLabelText('上传图像生成参考图'), {
      target: { files: [new File([png('reference')], 'reference.png', { type: 'image/png' })] }
    });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(fixture.uploadReferenceImage).toHaveBeenCalledOnce());
    expect(screen.getByRole('textbox', { name: '提示词' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '正在生成' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '图片设置' })).toBeDisabled();
    fireEvent.submit(form);
    await act(async () => { release(); });
    await waitFor(() => expect(fixture.applyAction.mock.calls.filter(([, request]) => request.action === 'run-stage')).toHaveLength(1));
    expect(fixture.uploadReferenceImage).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: '开始生成' })).toBeEnabled();
  });

  it.each([
    { language: 'zh-CN' as const, form: '图像生成', prompt: '提示词', format: '图片画幅', settings: '图片设置', generate: '开始生成', clear: '清空提示词', summary: '任务摘要' },
    { language: 'en-US' as const, form: 'Image Generation', prompt: 'Prompt', format: 'Image format', settings: 'Image settings', generate: 'Generate', clear: 'Clear prompt', summary: 'Task summary' },
    { language: 'sv-SE' as const, form: 'Bildgenerering', prompt: 'Prompt', format: 'Bildformat', settings: 'Bildinställningar', generate: 'Generera', clear: 'Rensa prompt', summary: 'Uppgiftssammanfattning' }
  ])('localizes the single-page controls and task summary in $language', copy => {
    const fixture = createFixture();
    renderWorkspace(fixture, fixture.currentJob(), undefined, undefined, copy.language);
    const form = screen.getByRole('form', { name: copy.form });
    expect(within(form).getByRole('textbox', { name: copy.prompt })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: copy.settings })).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: copy.generate })).toBeEnabled();
    expect(within(form).getByRole('button', { name: copy.clear })).toBeDisabled();
    expect(within(openImageSettings(copy.settings)).getByRole('radiogroup', { name: copy.format })).toBeInTheDocument();
    expect(within(screen.getByRole('complementary', { name: 'OpenCreator' })).getByRole('complementary', { name: copy.summary })).toBeInTheDocument();
  });

  it('places model selection in the bottom toolbar and the reference upload beside the prompt', () => {
    const fixture = createFixture({ pending: true });
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '图像生成 操作区' });
    const prompt = within(workspace).getByRole('textbox', { name: '提示词' });
    const referenceUpload = within(workspace).getByLabelText('上传图像生成参考图');
    const editor = prompt.closest('.image-generation-editor');
    const model = within(workspace).getByRole('combobox', { name: '模型' });

    expect(editor).toContainElement(referenceUpload);
    expect(editor).toHaveTextContent('JPG、PNG、WebP，最大 20 MB');
    expect(editor).toHaveTextContent('0/1');
    expect(model.closest('.image-generation-action-bar')).not.toBeNull();
    expect(prompt).toHaveAttribute('rows', '7');
    expect(referenceUpload.compareDocumentPosition(prompt) & Node.DOCUMENT_POSITION_FOLLOWING)
      .not.toBe(0);
  });

  it.each([
    { language: 'zh-CN' as const, model: '模型', jimeng: '即梦' },
    { language: 'en-US' as const, model: 'Model', jimeng: 'Jimeng' },
    { language: 'el-GR' as const, model: 'Μοντέλο', jimeng: 'Jimeng' }
  ])('searches and selects branded image models without submitting in $language', copy => {
    const fixture = createFixture({ pending: true });
    renderWorkspace(fixture, fixture.currentJob(), undefined, undefined, copy.language);
    const model = screen.getByRole('combobox', { name: copy.model });
    expect(model.tagName).toBe('INPUT');
    fireEvent.click(model);
    const options = within(screen.getByRole('listbox', { name: copy.model })).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options.every(option => option.querySelector('[data-brand="openai"] img'))).toBe(true);
    const catalog = document.querySelector('.official-model-catalog-brands')!;
    for (const brand of ['openai', 'bytedance', 'kling', 'google']) {
      expect(catalog.querySelector(`[data-brand="${brand}"] img`)).not.toBeNull();
    }
    fireEvent.click(screen.getByRole('button', { name: /ByteDance/ }));
    const byteDanceOptions = within(screen.getByRole('listbox', { name: copy.model })).getAllByRole('option');
    expect(byteDanceOptions).toHaveLength(1);
    expect(byteDanceOptions[0]).toHaveAccessibleName(copy.jimeng);
    changeControl(model, { target: { value: 'jimeng' } });
    expect(within(screen.getByRole('listbox', { name: copy.model })).getAllByRole('option')).toHaveLength(1);
    expect(model).toHaveValue('jimeng');
    fireEvent.keyDown(model, { key: 'Enter' });
    expect(model).toHaveValue(copy.jimeng);
    expect(model.parentElement?.querySelector('[data-brand="bytedance"] img')).not.toBeNull();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(fixture.ensureJob).not.toHaveBeenCalled();
    expect(fixture.applyAction).not.toHaveBeenCalled();
  });

  it('expands and collapses the editor without changing or submitting the draft', () => {
    const fixture = createFixture();
    renderWorkspace(fixture, { ...fixture.currentJob(), state: { prompt: 'A bright studio', provider: 'openai' } });
    const prompt = screen.getByRole('textbox', { name: '提示词' });
    fireEvent.click(screen.getByRole('button', { name: '展开编辑区' }));
    expect(prompt).toHaveAttribute('rows', '14');
    expect(screen.getByRole('button', { name: '收起编辑区' })).toHaveAttribute('aria-expanded', 'true');
    expect(prompt).toHaveValue('A bright studio');
    fireEvent.click(screen.getByRole('button', { name: '收起编辑区' }));
    expect(prompt).toHaveAttribute('rows', '7');
    expect(fixture.applyAction).not.toHaveBeenCalled();
  });

  it('validates required reference input while typing and blocks generation until uploaded', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const prompt = screen.getByRole('textbox', { name: '提示词' });
    fireEvent.change(prompt, { target: { value: '以上传的人物照片为唯一主体，生成复古海报' } });
    expect(prompt).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('请先上传参考图');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(screen.getByRole('textbox', { name: '提示词' })).toBeInTheDocument();
    expect(fixture.uploadReferenceImage).not.toHaveBeenCalled();
    expect(fixture.applyAction).not.toHaveBeenCalled();
    await act(async () => {
      changeControl(screen.getByLabelText('上传图像生成参考图'), { target: { files: [new File([png('reference')], 'reference.png', { type: 'image/png' })] } });
    });
    expect(prompt).toHaveAttribute('aria-invalid', 'false');
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    await waitFor(() => expect(fixture.uploadReferenceImage).toHaveBeenCalledOnce());
  });

  it('blocks generation from a restored settings step with a missing reference', () => {
    const fixture = createFixture();
    renderWorkspace(fixture, { ...fixture.currentJob(), state: {
      ...fixture.currentJob().state, prompt: 'Edit the attached photo', currentStep: 2, furthestStep: 2
    } });
    fireEvent.click(screen.getByRole('button', { name: '开始生成' }));
    expect(screen.getByRole('textbox', { name: '提示词' })).toBeInTheDocument();
    expect(fixture.applyAction).not.toHaveBeenCalled();
  });

  it('shows the actual stage failure instead of discarding it for a generic service error', () => {
    const fixture = createFixture();
    const job = fixture.currentJob();
    renderWorkspace(fixture, { ...job, status: 'failed', stages: [{
      id: 'stage-failed', jobId: job.id, stageId: 'generate', executor: 'image',
      status: 'failed', dispatchStatus: 'finished', claimOwner: null, claimExpiresAt: null,
      attempt: 1, idempotencyKey: null, scopeKey: null, inputFingerprint: null, progress: {},
      errorCode: 'image_generation_failed', errorMessage: 'Codex 无法获取所需的参考图，请先上传图片后重试。 token=private-secret',
      startedAt: job.createdAt, finishedAt: job.createdAt
    }] });
    expect(screen.getByRole('alert')).toHaveTextContent('Codex 无法获取所需的参考图，请先上传图片后重试');
    expect(screen.getByRole('alert')).not.toHaveTextContent('private-secret');
  });

  it.each([
    ['empty.png', '', 'image/png'],
    ['file.txt', 'text', 'text/plain']
  ])('rejects an invalid reference before uploading (%s)', (name, content, type) => {
    const file = new File([content], name, { type });
    const fixture = createFixture();
    renderWorkspace(fixture);
    changeControl(screen.getByLabelText('上传图像生成参考图'), { target: { files: [file] } });
    expect(screen.getByRole('alert')).toHaveTextContent('参考图必须是非空的 PNG、JPEG 或 WebP 图片，且不超过 20 MB。');
    expect(fixture.uploadReferenceImage).not.toHaveBeenCalled();
  });

  it('keeps preview URLs and image nodes across repeated job snapshots, but reloads changed results', async () => {
    const fixture = createFixture();
    const artifact = imageArtifact(fixture.currentJob().id, 1, fixture.currentJob().createdAt);
    const job: CreatorJob = { ...fixture.currentJob(), status: 'completed', artifacts: [artifact] };
    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => 'blob:result-1').mockImplementationOnce(() => 'blob:result-2');
    const view = renderWorkspace(fixture, job);
    const image = await screen.findByRole('img', { name: '生成图片 1' });
    expect(image).toHaveAttribute('src', 'blob:result-1');
    for (let revision = 1; revision <= 3; revision += 1) {
      await view.pushSnapshot({ ...structuredClone(job), revision });
      expect(screen.getByRole('img', { name: '生成图片 1' })).toBe(image);
      expect(image).toHaveAttribute('src', 'blob:result-1');
    }
    expect(fixture.openArtifact).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    await view.pushSnapshot({ ...job, revision: 4, artifacts: [artifact, imageArtifact(job.id, 2, job.createdAt)] });
    await waitFor(() => expect(screen.getByRole('img', { name: '生成图片 1' })).toHaveAttribute('src', 'blob:result-2'));
    expect(fixture.openArtifact).toHaveBeenCalledTimes(2);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result-1');
    view.unmount();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result-2');
  });

  it('releases preview URLs when an in-flight fetch finishes after unmount', async () => {
    const fixture = createFixture();
    let finish!: (response: Response) => void;
    fixture.openArtifact.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const artifact = imageArtifact(fixture.currentJob().id, 1, fixture.currentJob().createdAt);
    const view = renderWorkspace(fixture, { ...fixture.currentJob(), artifacts: [artifact] });
    await waitFor(() => expect(fixture.openArtifact).toHaveBeenCalledOnce());
    view.unmount();
    await act(async () => { finish(new Response(new Blob([png('result')], { type: 'image/png' }))); });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:image-generation-reference');
  });

  it('does not persist an untouched pending project', async () => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture({ pending: true });
      renderWorkspace(fixture);

      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(fixture.ensureJob).not.toHaveBeenCalled();
      expect(fixture.applyAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('inherits Codex and its single-candidate limit from AI service settings', async () => {
    const fixture = createFixture({ pending: true });
    const config = createDefaultCreatorServicesConfig();
    config.image.provider = 'codex-native';
    renderWorkspace(fixture, fixture.currentJob(), {
      getConfig: vi.fn(async () => ({ config, configuredCredentials: [] })),
      getCodexImageStatus: vi.fn(async () => ({ ready: true }))
    });

    fireEvent.change(screen.getByRole('textbox', { name: '提示词' }), {
      target: { value: '使用默认 Codex 生成一张图片' }
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue('本机 Codex 生图'));
    openImageSettings();
    expect(screen.getByRole('radio', { name: '1 张' })).toHaveAttribute('aria-checked', 'true');
    expect(fixture.ensureJob).not.toHaveBeenCalled();
  });

  it.each([
    ['gemini', 'Gemini'],
    ['jimeng', '即梦'],
    ['kling', '可灵']
  ] as const)('keeps the preset-selected %s provider', async (provider, label) => {
    vi.useFakeTimers();
    try {
      const fixture = createFixture();
      const initialJob: CreatorJob = {
        ...fixture.currentJob(),
        presetOrigin: {
          module: 'image-generation',
          id: `${provider}-preset`,
          version: 1,
          locale: 'zh-CN',
          title: `${label} 模板`,
          contentHash: 'a'.repeat(64)
        },
        state: {
          ...fixture.currentJob().state,
          provider,
          currentStep: 1,
          furthestStep: 1
        }
      };

      renderWorkspace(fixture, initialJob);
      expect(screen.getByRole('combobox', { name: '模型' })).toHaveValue(label);
      await act(() => vi.advanceTimersByTimeAsync(500));
      expect(fixture.applyAction).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('opens saved wizard drafts with prompt and settings together and the summary above the conversation', () => {
    const fixture = createFixture();
    const initialJob: CreatorJob = {
      ...fixture.currentJob(),
      state: {
        ...fixture.currentJob().state,
        prompt: '一张产品主视觉',
        currentStep: 1,
        furthestStep: 1
      }
    };

    renderWorkspace(fixture, initialJob);

    const workspace = screen.getByRole('region', { name: '图像生成 操作区' });
    expect(within(workspace).getByRole('textbox', { name: '提示词' })).toHaveValue('一张产品主视觉');
    expect(within(workspace).getByRole('button', { name: '图片设置' })).toBeInTheDocument();
    expect(within(workspace).getByRole('button', { name: '开始生成' })).toBeInTheDocument();
    expect(within(workspace).queryByRole('navigation', { name: '图像生成流程' })).not.toBeInTheDocument();
    expect(within(workspace).queryByRole('button', { name: '继续' })).not.toBeInTheDocument();
    expect(within(workspace).queryByRole('complementary', { name: '任务摘要' })).not.toBeInTheDocument();
    const summary = screen.getByRole('complementary', { name: '任务摘要' });
    const panel = summary.closest('.creator-collaboration-panel')!;
    expect(panel.querySelector('.creator-collaboration-task-summary')).toContainElement(summary);
    expect(summary.compareDocumentPosition(panel.querySelector('.creator-collaboration-messages')!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(summary).toHaveTextContent('一张产品主视觉');
  });

  it('opens an existing project on its persisted result version', async () => {
    const fixture = createFixture();
    const createdAt = fixture.currentJob().createdAt;
    const versionOne = imageArtifact(fixture.currentJob().id, 1, createdAt);
    const versionTwo = imageArtifact(fixture.currentJob().id, 2, createdAt);
    const initialJob: CreatorJob = {
      ...fixture.currentJob(),
      status: 'completed',
      artifacts: [versionOne, versionTwo],
      state: {
        ...fixture.currentJob().state,
        currentStep: 1,
        furthestStep: 2,
        resultVersion: 1,
        latestResultVersion: 2,
        resultSnapshots: [
          imageResultSnapshot(1, versionOne, createdAt),
          imageResultSnapshot(2, versionTwo, createdAt)
        ]
      }
    };

    renderWorkspace(fixture, initialJob);

    expect(await screen.findByRole('heading', { name: '生成结果' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
    await waitFor(() => expect(fixture.openArtifact).toHaveBeenCalledWith(
      initialJob.id,
      versionOne.id
    ));
  });

  it('uploads the selected reference before starting image generation', async () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    const workspace = screen.getByRole('region', { name: '图像生成 操作区' });
    const reference = new File([png('reference')], 'reference.png', {
      type: 'image/png',
      lastModified: 123
    });

    fireEvent.change(within(workspace).getByRole('textbox', { name: '提示词' }), {
      target: { value: '参考上传图片的主体和构图生成新画面' }
    });
    changeControl(within(workspace).getByLabelText('上传图像生成参考图'), {
      target: { files: [reference] }
    });
    fireEvent.click(within(workspace).getByRole('button', { name: '开始生成' }));

    await waitFor(() => expect(fixture.uploadReferenceImage).toHaveBeenCalledWith(
      'creator_job_image_ui',
      expect.objectContaining({ file: reference })
    ));
    await waitFor(() => expect(fixture.applyAction).toHaveBeenCalledWith(
      'creator_job_image_ui',
      expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'generate' }
      })
    ));
    const uploadOrder = fixture.uploadReferenceImage.mock.invocationCallOrder[0]!;
    const runOrder = fixture.applyAction.mock.invocationCallOrder.at(-1)!;
    expect(uploadOrder).toBeLessThan(runOrder);
  });

  it('keeps the sample guide hidden', () => {
    const fixture = createFixture();
    renderWorkspace(fixture);
    expect(screen.queryByRole('complementary', { name: '图像风格引导' })).not.toBeInTheDocument();
  });

});

function openImageSettings(label = '图片设置') {
  fireEvent.click(screen.getByRole('button', { name: label }));
  return screen.getByRole('dialog', { name: label });
}

function chooseImageSetting(label: string, value: string) {
  fireEvent.click(within(screen.getByRole('radiogroup', { name: label })).getByRole('radio', { name: value }));
}

function renderWorkspace(
  fixture: ReturnType<typeof createFixture>,
  initialJob = fixture.currentJob(),
  creatorServicesService?: {
    getConfig(): Promise<unknown>;
    getCodexImageStatus?(): Promise<{ ready: boolean }>;
  },
  gatewayState?: GatewayAccountState,
  language: AppLanguage = 'zh-CN'
) {
  let currentSession: CreatorSessionContextValue | null = null;
  const view = render(
    <LanguageProvider initialPreference={language}>
      <CreatorSessionProvider
        initialJob={initialJob}
        ensureJob={fixture.ensureJob}
        service={{
          applyAction: fixture.applyAction,
          uploadReferenceImage: fixture.uploadReferenceImage,
          openArtifact: fixture.openArtifact,
          runAgentTurn: vi.fn()
        } as never}
      >
        <OfficialServicesContext.Provider value={gatewayState}>
        <SessionObserver onSession={session => { currentSession = session; }} />
        <ImageGenerationWorkspace
          onBack={vi.fn()}
          creatorServicesService={creatorServicesService as never}
        />
        </OfficialServicesContext.Provider>
      </CreatorSessionProvider>
    </LanguageProvider>
  );
  return { ...view, async pushSnapshot(job: CreatorJob) {
    await act(async () => { currentSession!.applyRemoteSnapshot(job); });
  } };
}

function SessionObserver(props: { onSession(session: CreatorSessionContextValue | null): void }) {
  props.onSession(useOptionalCreatorSession());
  return null;
}

function imageArtifact(jobId: string, resultVersion: number, createdAt: string): CreatorArtifact {
  return {
    id: `generated_image_v${resultVersion}`,
    jobId,
    kind: 'generated_image',
    version: resultVersion,
    status: 'completed',
    path: `/tmp/generated-image-v${resultVersion}.png`,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      candidate: 1,
      resultVersion,
      fileName: `generated-image-v${resultVersion}.png`,
      mimeType: 'image/png'
    },
    createdAt
  };
}

function imageResultSnapshot(
  version: number,
  artifact: CreatorArtifact,
  createdAt: string
): CreatorJson {
  return {
    version,
    createdAt,
    action: 'stage-succeeded',
    stageId: 'generate',
    description: `生成图片 V${version}`,
    artifactRefs: { generated_image: [artifact.id] },
    changedArtifactIds: [artifact.id],
    staleArtifactIds: [],
    state: {
      prompt: `第 ${version} 版图片`,
      provider: 'openai',
      size: '1024x1024',
      quality: 'medium',
      candidateCount: 1
    }
  };
}

function createFixture(options: { pending?: boolean } = {}) {
  const createdAt = '2026-09-01T08:00:00.000Z';
  let job: CreatorJob = {
    id: options.pending ? 'pending:project_1:image-generation' : 'creator_job_image_ui',
    projectId: 'project_1',
    templateId: 'image-generation',
    templateVersion: options.pending ? 1 : 2,
    status: 'draft',
    revision: 0,
    presetOrigin: null,
    state: options.pending ? {} : {
      prompt: '',
      provider: 'openai',
      size: '1024x1024',
      quality: 'medium',
      candidateCount: 2,
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
    updatedAt: createdAt
  };

  const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
    const patch = request.action === 'update-settings'
      ? request.input.patch as Record<string, CreatorJson>
      : {};
    job = {
      ...job,
      revision: job.revision + 1,
      state: { ...job.state, ...patch }
    };
    return {
      job,
      receipt: {
        actor: 'user' as const,
        action: request.action,
        summary: request.action,
        affectedArtifacts: [],
        newRevision: job.revision,
        createdAt
      }
    };
  });

  const ensureJob = vi.fn(async (state: Record<string, CreatorJson>) => {
    job = {
      ...job,
      id: 'creator_job_image_ui',
      templateVersion: 2,
      state
    };
    return job;
  });

  const uploadReferenceImage = vi.fn(async (_jobId: string, input: {
    file: File;
    expectedRevision: number;
  }) => {
    const artifact: CreatorArtifact = {
      id: 'reference_artifact_image_1',
      jobId: job.id,
      kind: 'reference_image',
      version: 1,
      status: 'completed',
      path: '/tmp/reference.png',
      scopeKey: null,
      inputFingerprint: null,
      sha256: null,
      sourceArtifactIds: [],
      metadata: {
        fileName: input.file.name,
        size: input.file.size,
        lastModified: input.file.lastModified,
        mimeType: input.file.type
      },
      createdAt
    };
    job = {
      ...job,
      revision: job.revision + 1,
      artifacts: [...job.artifacts, artifact],
      state: { ...job.state, referenceImageArtifactId: artifact.id }
    };
    return { job, artifact, deduplicated: false };
  });

  return {
    currentJob: () => job,
    ensureJob,
    applyAction,
    uploadReferenceImage,
    openArtifact: vi.fn(async () => (
      new Response(new Blob([png('reference')], { type: 'image/png' }))
    ))
  };
}

function png(label: string): ArrayBuffer {
  return Uint8Array.from(Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from(label.padEnd(24, '.'))
  ])).buffer;
}
