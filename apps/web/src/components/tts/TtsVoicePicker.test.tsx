import { changeControl } from '../../test/select-option.js';
import { selectOption } from '../../test/select-option.js';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { TtsVoicePicker } from './TtsVoicePicker.js';

type TtsVoiceService = Pick<
  CreatorServicesSettingsService,
  'getTtsVoices' | 'previewTtsVoice'
>;

function createService(options?: {
  rejectVoices?: boolean;
}) {
  const getTtsVoices = options?.rejectVoices
    ? vi.fn(async () => {
        throw new Error('voice catalog unavailable');
      })
    : vi.fn(async () => ({
        provider: 'aliyun' as const,
        model: 'qwen3-tts-flash',
        voices: [
          {
            id: 'Cherry',
            name: '芊悦',
            provider: 'aliyun' as const,
            language: '中文',
            previewLanguages: ['en', 'ja', 'zh'],
            scenario: '自然对话',
            kind: 'builtin' as const,
            recommended: true
          },
          {
            id: 'Ethan',
            name: '晨煦',
            provider: 'aliyun' as const,
            language: '中文',
            previewLanguages: ['en'],
            kind: 'builtin' as const
          }
        ]
      }));
  const previewTtsVoice = vi.fn(async () => new Response(
    new Blob(['preview-audio'], { type: 'audio/mpeg' })
  ));
  return {
    service: {
      getTtsVoices,
      previewTtsVoice
    } as TtsVoiceService,
    getTtsVoices,
    previewTtsVoice
  };
}

describe('TtsVoicePicker', () => {
  it.each(['zh-CN', 'en-US'] as const)('shows catalog descriptions in %s and filters by gender, traits and use cases', async language => {
    const tts = createService();
    const catalog = await tts.service.getTtsVoices('aliyun', 'qwen3-tts-flash');
    const getTtsVoices = vi.fn(async () => ({ ...catalog, voices: catalog.voices.map((voice, index) => ({ ...voice,
      gender: index === 0 ? 'female' : 'male',
      traits: { zh: [index === 0 ? '温暖' : '自信'], en: [index === 0 ? 'Warm' : 'Confident'] },
      useCases: { zh: [index === 0 ? '旁白' : '教学'], en: [index === 0 ? 'Narration' : 'Education'] }
    })) }));
    const onChange = vi.fn();
    const zh = language === 'zh-CN';
    render(<LanguageProvider initialPreference={language}><TtsVoicePicker id="voice" presentation="library"
      provider="aliyun" model="qwen3-tts-flash" value="Cherry" service={{ ...tts.service, getTtsVoices }} onChange={onChange} /></LanguageProvider>);
    const entry = await screen.findByRole('button', { name: `${zh ? '默认音色' : 'Default voice'} 芊悦` });
    expect(entry).toHaveTextContent(zh ? '女声 · 温暖' : 'Female · Warm');
    fireEvent.click(entry);
    expect(screen.getByRole('radio', { name: /芊悦/ })).toHaveTextContent(zh ? '旁白' : 'Narration');
    selectOption(screen.getByRole('combobox', { name: zh ? '全部性别' : 'All genders' }), zh ? '男声' : 'Male');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /晨煦/ })).toBeInTheDocument();
    selectOption(screen.getByRole('combobox', { name: zh ? '全部性别' : 'All genders' }), '');
    selectOption(screen.getByRole('combobox', { name: zh ? '全部风格' : 'All styles' }), zh ? '温暖' : 'Warm');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /芊悦/ })).toBeInTheDocument();
    selectOption(screen.getByRole('combobox', { name: zh ? '全部风格' : 'All styles' }), '');
    selectOption(screen.getByRole('combobox', { name: zh ? '全部场景' : 'All use cases' }), zh ? '教学' : 'Education');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /晨煦/ })).toBeInTheDocument();
    selectOption(screen.getByRole('combobox', { name: zh ? '全部场景' : 'All use cases' }), '');
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: zh ? 'Confident' : '自信' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(tts.previewTtsVoice).not.toHaveBeenCalled();
  });

  it('refreshes voice descriptions when the catalog changes without changing the selected voice', async () => {
    const tts = createService();
    const catalog = await tts.service.getTtsVoices('aliyun', 'qwen3-tts-flash');
    const getTtsVoices = vi.fn(async () => catalog);
    const props = { id: 'voice', provider: 'aliyun' as const, model: 'qwen3-tts-flash', value: 'Cherry',
      service: { ...tts.service, getTtsVoices }, onChange: vi.fn() };
    const view = render(<TtsVoicePicker {...props} catalogKey="v1" />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('芊悦'));
    getTtsVoices.mockResolvedValue({ ...catalog, voices: catalog.voices.map(voice => ({ ...voice, gender: 'female', traits: { zh: ['温暖'] } })) });
    view.rerender(<TtsVoicePicker {...props} catalogKey="v2" />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveTextContent('女声 · 温暖'));
    expect(getTtsVoices).toHaveBeenCalledTimes(2);
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('loads voices and reports the selected catalog entry', async () => {
    const onChange = vi.fn();
    const onVoiceResolved = vi.fn();
    const tts = createService();

    render(
      <TtsVoicePicker
        id="voice"
        provider="aliyun"
        model="qwen3-tts-flash"
        value="Cherry"
        service={tts.service}
        onChange={onChange}
        onVoiceResolved={onVoiceResolved}
      />
    );

    const select = await screen.findByRole('combobox', { name: '默认音色' });
    await waitFor(() => expect(select).toHaveAttribute('data-value', 'Cherry'));
    // The selected voice shows its language inline; the scenario is the group header.
    expect(select).toHaveTextContent('芊悦 (Cherry) · 推荐');
    expect(select).toHaveTextContent('中文');
    expect(screen.queryByText('自然对话 · 中文')).not.toBeInTheDocument();
    fireEvent.click(select);
    expect(screen.getByRole('group', { name: '自然对话' })).toBeInTheDocument();
    await waitFor(() => {
      expect(onVoiceResolved).toHaveBeenCalledWith(expect.objectContaining({
        id: 'Cherry',
        name: '芊悦'
      }));
    });

    fireEvent.click(screen.getByRole('option', { name: /^晨煦 \(Ethan\)/ }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();

    expect(onChange).toHaveBeenCalledWith('Ethan', expect.objectContaining({
      id: 'Ethan',
      name: '晨煦'
    }));
    expect(tts.getTtsVoices).toHaveBeenCalledWith('aliyun', 'qwen3-tts-flash');
  });

  it('previews and pauses the current voice', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:voice-preview')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const tts = createService();

    render(
      <TtsVoicePicker
        id="voice"
        provider="aliyun"
        model="qwen3-tts-flash"
        value="Cherry"
        service={tts.service}
        onChange={vi.fn()}
      />
    );

    const select = await screen.findByRole('combobox', { name: '默认音色' });
    await waitFor(() => expect(select).toHaveTextContent('芊悦 (Cherry) · 推荐'));
    fireEvent.click(screen.getByRole('button', { name: '试听当前音色' }));

    expect(await screen.findByRole('button', { name: '暂停音色试听' })).toBeInTheDocument();
    expect(tts.previewTtsVoice).toHaveBeenCalledWith({
      provider: 'aliyun',
      model: 'qwen3-tts-flash',
      language: 'zh-CN',
      voiceId: 'Cherry'
    });
    expect(play).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '暂停音色试听' }));
    expect(pause).toHaveBeenCalled();
  });

  it.each(['select', 'library'] as const)('only lists stored preview languages in %s and ignores stale audio after switching languages', async presentation => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:language-preview') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const tts = createService();
    const pending: Array<(response: Response) => void> = [];
    tts.previewTtsVoice.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const onChange = vi.fn();
    const view = render(<TtsVoicePicker id="voice" presentation={presentation} allowPreviewLanguage
      provider="aliyun" model="qwen3-tts-flash" value="Cherry" service={tts.service} onChange={onChange} />);
    const language = screen.getByRole('combobox', { name: '试听语言' });
    await waitFor(() => expect(language).toHaveAttribute('data-value', 'zh'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    const voiceField = presentation === 'library' ? screen.getByRole('button', { name: '默认音色 芊悦' }) : screen.getByRole('combobox', { name: '默认音色' });
    expect(language.compareDocumentPosition(voiceField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(language);
    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('英语'), expect.stringContaining('日语'), expect.stringContaining('中文')
    ]));
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.queryByRole('option', { name: /德语/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /^日语/ }));
    const changeLanguage = (name: string) => {
      fireEvent.click(language);
      fireEvent.click(screen.getByRole('option', { name: new RegExp(`^${name}`) }));
    };
    expect(tts.previewTtsVoice).not.toHaveBeenCalled();
    const preview = () => {
      if (presentation === 'library') fireEvent.click(screen.getByRole('button', { name: '默认音色 芊悦' }));
      fireEvent.click(screen.getByRole('button', { name: presentation === 'library' ? '试听 · 芊悦' : '试听当前音色' }));
    };
    preview();
    expect(tts.previewTtsVoice).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'ja', voiceId: 'Cherry' }));
    changeLanguage('英语');
    const response = () => new Response(new Blob(['audio'], { type: 'audio/mpeg' }), { headers: { 'Content-Language': 'ja' } });
    await act(async () => { pending[0]!(response()); });
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByText(/所选语言暂无样音，当前试听/)).not.toBeInTheDocument();
    changeLanguage('日语');
    preview();
    await act(async () => { pending[1]!(response()); });
    expect(play).toHaveBeenCalledOnce();
    expect(screen.getByText('当前试听：日语')).toBeInTheDocument();
    changeLanguage('英语');
    expect(pause).toHaveBeenCalled();
    expect(screen.queryByText(/所选语言暂无样音，当前试听/)).not.toBeInTheDocument();
    expect(tts.previewTtsVoice).toHaveBeenCalledTimes(2);
    expect(onChange).not.toHaveBeenCalled();
    view.unmount();
  });

  it('filters voices by the outer preview language without changing an existing voice or falling back to another language', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:voice-language') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const tts = createService();
    const onChange = vi.fn();
    render(<TtsVoicePicker id="voice" presentation="library" allowPreviewLanguage
      provider="aliyun" model="qwen3-tts-flash" value="Ethan" service={tts.service} onChange={onChange} />);
    const entry = await screen.findByRole('button', { name: '默认音色 晨煦' });
    const language = screen.getByRole('combobox', { name: '试听语言' });
    fireEvent.click(language);
    const search = screen.getByRole('combobox', { name: '搜索语言' });
    expect(search).toHaveFocus();
    fireEvent.change(search, { target: { value: 'japan' } });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(language).toHaveAttribute('data-value', 'ja');
    expect(language).toHaveFocus();
    expect(entry).toHaveTextContent('晨煦');
    expect(entry).toHaveTextContent('此语言暂无该音色样音');
    fireEvent.click(entry);
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: '试听 · 晨煦' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '试听 · 芊悦' }));
    expect(tts.previewTtsVoice).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'ja', voiceId: 'Cherry' }));
    expect(language).toHaveAttribute('data-value', 'ja');
    expect(onChange).not.toHaveBeenCalled();
    await screen.findByRole('button', { name: '暂停 · 芊悦' });
    fireEvent.click(screen.getByRole('radio', { name: /芊悦/ }));
    expect(onChange).toHaveBeenCalledWith('Cherry', expect.objectContaining({ id: 'Cherry' }));
  });

  it('uses the new model sample languages and keeps existing voices available if no preview metadata exists', async () => {
    const tts = createService();
    const catalog = await tts.service.getTtsVoices('aliyun', 'qwen3-tts-flash');
    const getTtsVoices = vi.fn(async () => catalog);
    const props = { id: 'voice', presentation: 'library' as const, allowPreviewLanguage: true, provider: 'aliyun' as const,
      model: 'qwen3-tts-flash', value: 'Cherry', service: { ...tts.service, getTtsVoices }, onChange: vi.fn() };
    const view = render(<TtsVoicePicker {...props} />);
    const language = screen.getByRole('combobox', { name: '试听语言' });
    await waitFor(() => expect(language).toHaveAttribute('data-value', 'zh'));
    getTtsVoices.mockResolvedValue({ ...catalog, voices: catalog.voices.map(voice => ({ ...voice, previewLanguages: ['en'] })) });
    view.rerender(<TtsVoicePicker {...props} model="new-model" />);
    await waitFor(() => expect(language).toHaveAttribute('data-value', 'en'));
    fireEvent.click(language);
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.keyDown(screen.getByRole('combobox', { name: '搜索语言' }), { key: 'Escape' });
    expect(language).toHaveFocus();
    getTtsVoices.mockResolvedValue({ ...catalog, voices: catalog.voices.map(voice => ({ ...voice, previewLanguages: [] })) });
    view.rerender(<TtsVoicePicker {...props} model="no-samples" />);
    await waitFor(() => expect(language).toBeDisabled());
    fireEvent.click(await screen.findByRole('button', { name: '默认音色 芊悦' }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '试听 · 芊悦' })).toBeDisabled();
    expect(props.onChange).not.toHaveBeenCalled();
    expect(tts.previewTtsVoice).not.toHaveBeenCalled();
  });

  it('localizes voice details and opens the list above the field by default', async () => {
    const getTtsVoices = vi.fn(async () => ({
      provider: 'openai' as const,
      model: 'gpt-4o-mini-tts',
      voices: [
        { id: 'alloy', name: 'Alloy', provider: 'openai' as const, language: 'multi', scenario: '均衡', kind: 'builtin' as const },
        { id: 'yue', name: '阿粤', provider: 'openai' as const, language: 'zh-yue', scenario: '粤语', kind: 'builtin' as const }
      ]
    }));
    const rect = { top: 600, bottom: 640, left: 20, right: 320, width: 300, height: 40, x: 20, y: 600, toJSON: () => ({}) };
    const getRect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rect as DOMRect);

    render(
      <LanguageProvider initialPreference="en-US">
        <TtsVoicePicker
          id="voice"
          provider="openai"
          model="gpt-4o-mini-tts"
          value="alloy"
          service={{ getTtsVoices, previewTtsVoice: vi.fn() } as never}
          onChange={vi.fn()}
        />
      </LanguageProvider>
    );

    const select = await screen.findByRole('combobox', { name: 'Default voice' });
    await waitFor(() => expect(select).toHaveTextContent('Multilingual'));
    fireEvent.click(select);
    expect(screen.getByRole('group', { name: 'Balanced' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Cantonese' })).toBeInTheDocument();
    expect(screen.queryByText('均衡')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: /阿粤.*Cantonese/ })).toBeInTheDocument();
    expect(screen.getByRole('listbox').parentElement).toHaveStyle({ transform: 'translateY(-100%)' });

    fireEvent.keyDown(select, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    getRect.mockRestore();
  });

  it('shows a retryable error when the voice catalog cannot be loaded', async () => {
    const tts = createService({ rejectVoices: true });

    render(
      <TtsVoicePicker
        id="voice"
        provider="aliyun"
        model="qwen3-tts-flash"
        value=""
        service={tts.service}
        onChange={vi.fn()}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('无法加载音色列表');
    fireEvent.click(screen.getByRole('button', { name: '刷新音色列表' }));
    await waitFor(() => expect(tts.getTtsVoices).toHaveBeenCalledTimes(2));
  });

  it('accepts a cloned Volcengine speaker ID after enabling custom voice mode', async () => {
    const onChange = vi.fn();
    const tts = createService();

    render(
      <TtsVoicePicker
        id="voice"
        provider="volcengine"
        model="seed-icl-2.0"
        value=""
        service={tts.service}
        onChange={onChange}
      />
    );

    expect(screen.queryByLabelText('克隆 / 自定义 Speaker ID')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: '使用克隆或自定义音色' }));
    const input = await screen.findByLabelText('克隆 / 自定义 Speaker ID');
    changeControl(input, { target: { value: 'S_cloned_speaker' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith('S_cloned_speaker', expect.objectContaining({
      id: 'S_cloned_speaker',
      kind: 'custom'
    }));
  });

  it('restores the official voice and preserves the custom draft when toggling modes', async () => {
    const onChange = vi.fn();
    const tts = createService();
    const props = {
      id: 'voice',
      provider: 'volcengine' as const,
      model: 'seed-tts-2.0',
      service: tts.service,
      onChange
    };
    const view = render(<TtsVoicePicker {...props} value="Cherry" />);
    await screen.findByRole('combobox', { name: '默认音色' });
    await waitFor(() => expect(tts.getTtsVoices).toHaveBeenCalled());

    const toggle = screen.getByRole('checkbox', { name: '使用克隆或自定义音色' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    const input = screen.getByLabelText('克隆 / 自定义 Speaker ID');
    changeControl(input, { target: { value: 'S_cloned_speaker' } });
    fireEvent.blur(input);
    view.rerender(<TtsVoicePicker {...props} value="S_cloned_speaker" />);

    expect(toggle).toBeChecked();
    expect(input).toHaveValue('S_cloned_speaker');
    fireEvent.click(toggle);
    expect(onChange).toHaveBeenLastCalledWith('Cherry', expect.objectContaining({ id: 'Cherry' }));
    expect(screen.queryByLabelText('克隆 / 自定义 Speaker ID')).not.toBeInTheDocument();

    view.rerender(<TtsVoicePicker {...props} value="Cherry" />);
    fireEvent.click(toggle);
    expect(screen.getByLabelText('克隆 / 自定义 Speaker ID')).toHaveValue('S_cloned_speaker');
  });

  it('filters the library by search, metadata and category, and resets an empty result', async () => {
    const tts = createService();
    const catalog = await tts.service.getTtsVoices('aliyun', 'qwen3-tts-flash');
    const service = {
      ...tts.service,
      getTtsVoices: vi.fn(async () => ({ ...catalog, voices: [
        { ...catalog.voices[0]!, gender: 'female' },
        { ...catalog.voices[1]!, gender: 'male', language: 'en-US', scenario: '自然对话', kind: 'custom' as const }
      ] }))
    };
    render(<TtsVoicePicker id="voice" presentation="library" provider="aliyun" model="qwen3-tts-flash" value="Cherry" service={service} onChange={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: '默认音色 芊悦' }));
    await screen.findByRole('radio', { name: /芊悦/ });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'eThAn' } });
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /晨煦/ })).toHaveAttribute('aria-checked', 'false');
    selectOption(screen.getByRole('combobox', { name: '全部性别' }), '女声');
    expect(screen.getByText('没有匹配的音色')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '全部' }).at(-1)!);
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    selectOption(screen.getByRole('combobox', { name: '全部语言' }), '中文');
    selectOption(screen.getByRole('combobox', { name: '全部风格' }), '自然对话');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    selectOption(screen.getByRole('combobox', { name: '全部语言' }), '');
    fireEvent.click(screen.getByRole('button', { name: '推荐' }));
    expect(screen.getByRole('radio', { name: /芊悦/ })).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: /晨煦/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '自定义音色' }));
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /晨煦/ })).toBeInTheDocument();
  });

  it('supports keyboard selection in the voice library', async () => {
    const tts = createService();
    const onChange = vi.fn();
    render(<TtsVoicePicker id="voice" presentation="library" provider="aliyun" model="qwen3-tts-flash" value="Cherry" service={tts.service} onChange={onChange} />);
    fireEvent.click(await screen.findByRole('button', { name: '默认音色 芊悦' }));
    const selected = await screen.findByRole('radio', { name: /芊悦/ });
    const next = screen.getByRole('radio', { name: /晨煦/ });
    expect(selected).toHaveAttribute('tabindex', '0');
    expect(next).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(selected, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenCalledWith('Ethan', expect.objectContaining({ id: 'Ethan' }));
    expect(next).toHaveFocus();
    fireEvent.keyDown(next, { key: 'Home' });
    expect(selected).toHaveFocus();
  });

  it('opens the library from one entry, closes on Escape or outside input, and restores focus after choosing', async () => {
    const tts = createService();
    const onChange = vi.fn();
    render(<><button type="button">Outside</button><TtsVoicePicker id="voice" presentation="library" provider="aliyun" model="qwen3-tts-flash" value="Cherry" service={tts.service} onChange={onChange} /></>);
    const entry = await screen.findByRole('button', { name: '默认音色 芊悦' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(entry);
    const search = await screen.findByRole('searchbox');
    expect(search).toHaveFocus();
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(entry).toHaveFocus();
    fireEvent.click(entry);
    fireEvent.click(await screen.findByRole('radio', { name: /晨煦/ }));
    expect(onChange).toHaveBeenCalledWith('Ethan', expect.objectContaining({ id: 'Ethan' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(entry).toHaveFocus();
    fireEvent.click(entry);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(entry).toHaveAttribute('aria-expanded', 'false');
  });

  it('previews library voices independently and ignores stale responses after switching or disabling', async () => {
    const createUrl = vi.fn(() => 'blob:library-preview');
    const revokeUrl = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createUrl });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeUrl });
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const tts = createService();
    const pending: Array<(response: Response) => void> = [];
    tts.previewTtsVoice.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const onChange = vi.fn();
    const props = { id: 'voice', presentation: 'library' as const, provider: 'aliyun' as const, model: 'qwen3-tts-flash', value: 'Cherry', service: tts.service, onChange };
    const view = render(<TtsVoicePicker {...props} />);
    fireEvent.click(await screen.findByRole('button', { name: '默认音色 芊悦' }));
    await screen.findByRole('radio', { name: /芊悦/ });
    fireEvent.click(screen.getByRole('button', { name: '试听 · 晨煦' }));
    fireEvent.click(screen.getByRole('button', { name: '试听 · 芊悦' }));
    const response = () => new Response(new Blob(['preview'], { type: 'audio/mpeg' }));
    await act(async () => { pending[1]!(response()); });
    expect(await screen.findByRole('button', { name: '暂停 · 芊悦' })).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { pending[0]!(response()); });
    expect(play).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: /芊悦/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('button', { name: '试听 · 晨煦' }));
    expect(pause).toHaveBeenCalled();
    expect(revokeUrl).toHaveBeenCalledWith('blob:library-preview');
    view.rerender(<TtsVoicePicker {...props} disabled />);
    await act(async () => { pending[2]!(response()); });
    expect(play).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '默认音色 芊悦' })).toBeDisabled();
    view.unmount();
  });
});
