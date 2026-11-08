import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SubtitleTimeline from './SubtitleTimeline.js';

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent {
    pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
    }
  });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('No media in unit tests')));
});
afterEach(() => vi.unstubAllGlobals());

async function setup(playing = false, src = 'blob:video') {
  const callbacks = { onSelect: vi.fn(), onSeek: vi.fn(), onTogglePlay: vi.fn(), onPlaybackChange: vi.fn(), onChange: vi.fn() };
  const { container } = render(<SubtitleTimeline cues={[]} src={src} currentTime={5} duration={20}
    playing={playing} readOnly {...callbacks} />);
  if (src) await screen.findByText('无法生成此媒体的波形，仍可调整字幕时间。');
  const slider = screen.getByRole('slider', { name: '播放位置' });
  const waveform = container.querySelector('.subtitle-timeline-waveform')!;
  // A zoomed track scrolled 100px beyond the viewport's left edge.
  vi.spyOn(container.querySelector('.subtitle-timeline-track')!, 'getBoundingClientRect')
    .mockReturnValue({ left: -100, width: 1000 } as DOMRect);
  let captured: number | undefined;
  Object.assign(slider, {
    setPointerCapture: (id: number) => { captured = id; },
    hasPointerCapture: (id: number) => captured === id,
    releasePointerCapture: () => { captured = undefined; }
  });
  return { ...callbacks, slider, waveform };
}

describe('SubtitleTimeline playback controls', () => {
  it('seeks directly on the waveform and scrubs across a scrolled track while paused', async () => {
    const ui = await setup();
    fireEvent.pointerDown(ui.waveform, { button: 2, clientX: 150 });
    expect(ui.onSeek).not.toHaveBeenCalled();
    fireEvent.pointerDown(ui.waveform, { button: 0, pointerId: 3, clientX: 150 });
    expect(ui.slider).toHaveFocus();
    expect(ui.onSeek).toHaveBeenLastCalledWith(5);
    fireEvent.pointerMove(ui.slider, { pointerId: 4, clientX: 400 });
    expect(ui.onSeek).toHaveBeenCalledTimes(1);
    fireEvent.pointerMove(ui.slider, { pointerId: 3, clientX: 400 });
    expect(ui.onSeek).toHaveBeenLastCalledWith(10);
    fireEvent.pointerUp(ui.slider, { pointerId: 3, clientX: 1200 });
    expect(ui.onSeek).toHaveBeenLastCalledWith(20);
    fireEvent.pointerMove(ui.slider, { pointerId: 3, clientX: 0 });
    expect(ui.onSeek).toHaveBeenCalledTimes(3);
    expect(ui.onPlaybackChange).not.toHaveBeenCalled();
    expect(ui.onChange).not.toHaveBeenCalled();
  });

  it.each(['pointerUp', 'pointerCancel', 'lostPointerCapture'] as const)('pauses and resumes playback exactly once on %s', async event => {
    const ui = await setup(true);
    fireEvent.pointerDown(ui.waveform, { button: 0, pointerId: 1, clientX: 200 });
    expect(ui.onPlaybackChange.mock.calls).toEqual([[false]]);
    fireEvent[event](ui.slider, { pointerId: 1, clientX: 300 });
    fireEvent.lostPointerCapture(ui.slider, { pointerId: 1 });
    expect(ui.onPlaybackChange.mock.calls).toEqual([[false], [true]]);
    expect(ui.onSeek).toHaveBeenLastCalledWith(event === 'pointerUp' ? 8 : 6);
  });

  it('supports direct playback shortcuts without repeating toggles while a key is held', async () => {
    const ui = await setup();
    fireEvent.doubleClick(ui.waveform);
    fireEvent.keyDown(ui.slider, { key: ' ' });
    fireEvent.keyDown(ui.slider, { key: ' ', repeat: true });
    fireEvent.keyDown(ui.slider, { key: 'Enter' });
    expect(ui.onTogglePlay).toHaveBeenCalledTimes(3);
    fireEvent.keyDown(ui.slider, { key: 'ArrowRight', shiftKey: true });
    expect(ui.onSeek).toHaveBeenLastCalledWith(10);
    fireEvent.keyDown(ui.slider, { key: 'Home' });
    expect(ui.onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.keyDown(ui.slider, { key: 'End' });
    expect(ui.onSeek).toHaveBeenLastCalledWith(20);
  });

  it('keeps seeking available without offering playback for subtitle-only projects', async () => {
    const ui = await setup(false, '');
    fireEvent.doubleClick(ui.waveform);
    fireEvent.keyDown(ui.slider, { key: ' ' });
    expect(ui.onTogglePlay).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '播放 / 暂停' })).toBeNull();
    fireEvent.pointerDown(ui.waveform, { button: 0, clientX: 150 });
    fireEvent.pointerUp(ui.slider, { clientX: 200 });
    expect(ui.onSeek).toHaveBeenLastCalledWith(6);
  });

  it('generates a waveform for a normal high-bitrate video above the old size limit', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes, {
      headers: { 'content-length': String(128 * 1024 * 1024) }
    })));
    vi.stubGlobal('OfflineAudioContext', class {
      async decodeAudioData() {
        return {
          duration: 20,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0, .5, 0, -.25])
        };
      }
    });
    render(<SubtitleTimeline cues={[]} src="blob:large-video" currentTime={5} duration={20}
      playing={false} readOnly onSelect={vi.fn()} onSeek={vi.fn()} onTogglePlay={vi.fn()}
      onPlaybackChange={vi.fn()} onChange={vi.fn()} />);
    await waitFor(() => expect(document.querySelector('.subtitle-timeline-waveform svg')).not.toBeNull());
    expect(document.querySelector('.subtitle-timeline-waveform path')?.getAttribute('d')).toContain('v56.0');
    expect(screen.queryByText('无法生成此媒体的波形，仍可调整字幕时间。')).toBeNull();
  });

  it('shows only the dubbing waveform when available, then returns to the source waveform', async () => {
    const fetchMedia = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMedia);
    vi.stubGlobal('OfflineAudioContext', class {
      async decodeAudioData() {
        return {
          duration: 20,
          numberOfChannels: 1,
          getChannelData: () => new Float32Array([0, .5, 0, -.25])
        };
      }
    });
    const callbacks = { onSelect: vi.fn(), onSeek: vi.fn(), onTogglePlay: vi.fn(), onPlaybackChange: vi.fn(), onChange: vi.fn() };
    const props = { cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: 'Hello' }],
      src: 'blob:source', currentTime: 0, duration: 20, playing: false, readOnly: true, ...callbacks };
    const { container, rerender } = render(<SubtitleTimeline {...props} voiceSrc="blob:dub" />);
    await waitFor(() => expect(container.querySelector('.subtitle-timeline-waveform svg')).not.toBeNull());
    expect(fetchMedia).toHaveBeenCalledExactlyOnceWith('blob:dub', { signal: expect.any(AbortSignal) });
    expect(container.querySelectorAll('.subtitle-timeline-waveform svg')).toHaveLength(1);
    expect(container.querySelector('.subtitle-timeline-voice')).toBeNull();
    expect(container.querySelector('.subtitle-timeline-clip')).toHaveStyle({ top: '98px' });

    rerender(<SubtitleTimeline {...props} />);
    await waitFor(() => expect(fetchMedia).toHaveBeenCalledTimes(2));
    expect(fetchMedia).toHaveBeenLastCalledWith('blob:source', { signal: expect.any(AbortSignal) });
    await waitFor(() => expect(container.querySelector('.subtitle-timeline-waveform svg')).not.toBeNull());
    expect(container.querySelectorAll('.subtitle-timeline-waveform svg')).toHaveLength(1);
  });
});
