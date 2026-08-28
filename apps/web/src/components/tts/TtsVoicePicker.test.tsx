import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
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
            scenario: '自然对话',
            kind: 'builtin' as const,
            recommended: true
          },
          {
            id: 'Ethan',
            name: '晨煦',
            provider: 'aliyun' as const,
            language: '中文',
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
    expect(select).toHaveValue('Cherry');
    expect(screen.getByRole('option', { name: '芊悦 (Cherry) · 推荐' })).toBeInTheDocument();
    expect(screen.getByText('自然对话 · 中文')).toBeInTheDocument();
    expect(onVoiceResolved).toHaveBeenCalledWith(expect.objectContaining({
      id: 'Cherry',
      name: '芊悦'
    }));

    fireEvent.change(select, { target: { value: 'Ethan' } });

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

    await screen.findByRole('option', { name: '芊悦 (Cherry) · 推荐' });
    fireEvent.click(screen.getByRole('button', { name: '试听当前音色' }));

    expect(await screen.findByRole('button', { name: '暂停音色试听' })).toBeInTheDocument();
    expect(tts.previewTtsVoice).toHaveBeenCalledWith({
      provider: 'aliyun',
      model: 'qwen3-tts-flash',
      voiceId: 'Cherry'
    });
    expect(play).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: '暂停音色试听' }));
    expect(pause).toHaveBeenCalled();
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
});
