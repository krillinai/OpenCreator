import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { ChevronDown, ChevronUp, Merge, Pause, Play, Scissors, ZoomIn, ZoomOut } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { SubtitleCue } from './VideoTranslationResultWorkspace.js';
import { mergeSubtitle, retimeSubtitle, splitSubtitle, subtitleSeconds, subtitleTimestamp, waveformPeaks } from './subtitle-editing.js';

// Keep waveform decoding bounded while allowing normal high-bitrate videos.
const MAX_WAVEFORM_BYTES = 256 * 1024 * 1024;

function waveformSvgPath(peaks: number[]) {
  const sortedPeaks = peaks.filter(Number.isFinite).sort((left, right) => left - right);
  const reference = sortedPeaks[Math.floor(Math.max(0, sortedPeaks.length - 1) * .99)] ?? 0;
  const scale = reference > 0 ? 1 / reference : 1;
  return peaks.map((peak, i, all) => {
    const x = i * 10000 / Math.max(1, all.length - 1);
    const normalized = Math.min(1, Math.max(0, peak * scale));
    return `M${x.toFixed(1)},${(30 - normalized * 28).toFixed(1)}v${(normalized * 56).toFixed(1)}`;
  }).join('');
}

function useWaveform(src: string | undefined, duration: number) {
  const [result, setResult] = useState<{ src?: string; peaks: number[]; duration: number; status: 'loading' | 'ready' | 'unavailable' }>({ peaks: [], duration: 0, status: 'loading' });
  useEffect(() => {
    if (!src) return;
    const controller = new AbortController();
    if (duration > 1800) {
      setResult({ src, peaks: [], duration: 0, status: 'unavailable' });
      return;
    }
    setResult({ src, peaks: [], duration: 0, status: 'loading' });
    void (async () => {
      const response = await fetch(src, { signal: controller.signal });
      if (!response.ok || Number(response.headers.get('content-length')) > MAX_WAVEFORM_BYTES || !response.body) throw new Error('Waveform input unavailable');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_WAVEFORM_BYTES) throw new Error('Waveform input too large');
          chunks.push(value);
        }
      } finally { await reader.cancel().catch(() => {}); }
      if (controller.signal.aborted) return;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      // Decode at a low sample rate: the waveform needs amplitude, not playback-quality PCM.
      const context = new OfflineAudioContext(1, 1, 8000);
      const audio = await context.decodeAudioData(bytes.buffer);
      if (controller.signal.aborted) return;
      const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
      setResult({ src, peaks: waveformPeaks(channels, Math.min(12000, Math.ceil(audio.duration * 30))), duration: audio.duration, status: 'ready' });
    })().catch(() => {
      if (!controller.signal.aborted) setResult({ src, peaks: [], duration: 0, status: 'unavailable' });
    });
    return () => controller.abort();
  }, [src, duration > 1800]);
  return result.src === src ? result : { peaks: [], duration: 0, status: 'loading' as const };
}

export default function SubtitleTimeline(props: {
  defaultCollapsed?: boolean;
  defaultHeight?: number;
  onLayoutChange?(layout: { collapsed: boolean; height: number }): void;
  cues: SubtitleCue[];
  src?: string;
  voiceSrc?: string;
  currentTime: number;
  duration: number;
  playing: boolean;
  selectedId?: number;
  readOnly: boolean;
  onSelect(id: number): void;
  onSeek(time: number): void;
  onTogglePlay(): void;
  onPlaybackChange(playing: boolean): void;
  onChange(cues: SubtitleCue[]): void;
}) {
  const l = useLocalizedCopy();
  const [zoom, setZoom] = useState(1);
  const [collapsed, setCollapsed] = useState(Boolean(props.defaultCollapsed));
  const [height, setHeight] = useState(props.defaultHeight ?? 200);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [error, setError] = useState('');
  const [dragCue, setDragCue] = useState<SubtitleCue>();
  const drag = useRef<{ cue: SubtitleCue; x: number; mode: 'move' | 'start' | 'end'; pixelsPerSecond: number }>();
  const scrub = useRef<{ pointerId: number; resume: boolean }>();
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const waveform = useWaveform(collapsed ? undefined : props.src, props.duration);
  const voiceWaveform = useWaveform(collapsed ? undefined : props.voiceSrc, props.duration);
  const duration = Math.max(1, props.duration, waveform.duration, voiceWaveform.duration, ...props.cues.map(cue => subtitleSeconds(cue.end) || 0));
  const clipTop = props.voiceSrc ? 150 : 98;
  const selected = props.cues.find(cue => cue.id === props.selectedId);
  const canSplit = selected && props.currentTime - subtitleSeconds(selected.start) >= 0.08
    && subtitleSeconds(selected.end) - props.currentTime >= 0.08;
  const canMerge = selected && props.cues.findIndex(cue => cue.id === selected.id) < props.cues.length - 1;
  const displayed = dragCue ? props.cues.map(cue => cue.id === dragCue.id ? dragCue : cue) : props.cues;
  const lanes: number[] = [];
  const positioned = displayed.map(cue => {
    const start = subtitleSeconds(cue.start), end = subtitleSeconds(cue.end);
    let lane = lanes.findIndex(until => until <= start);
    if (lane === -1) lane = lanes.length;
    lanes[lane] = end;
    return { cue, start, end, lane };
  });
  const tickCount = Math.max(2, Math.round(Math.floor(viewportWidth / 110) * zoom));
  const waveformPath = useMemo(() => waveformSvgPath(waveform.peaks), [waveform.peaks]);
  const voiceWaveformPath = useMemo(() => waveformSvgPath(voiceWaveform.peaks), [voiceWaveform.peaks]);

  useEffect(() => { props.onLayoutChange?.({ collapsed, height }); }, [collapsed, height, props.onLayoutChange]);

  useEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setViewportWidth(scroll.clientWidth));
    observer.observe(scroll);
    setViewportWidth(scroll.clientWidth);
    return () => observer.disconnect();
  }, [collapsed]);

  useEffect(() => { setError(''); }, [props.selectedId]);

  useEffect(() => {
    if (props.voiceSrc) setHeight(value => Math.max(value, Math.min(280, window.innerHeight * .5)));
  }, [props.voiceSrc]);

  useEffect(() => {
    if (scrub.current || !props.playing || !scrollRef.current || !trackRef.current) return;
    const scroll = scrollRef.current;
    const x = props.currentTime / duration * trackRef.current.scrollWidth;
    if (x < scroll.scrollLeft || x > scroll.scrollLeft + scroll.clientWidth - 40) scroll.scrollLeft = Math.max(0, x - 80);
  }, [props.currentTime, props.playing, duration]);

  function pointTime(clientX: number) {
    const rect = trackRef.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * duration));
  }

  function beginScrub(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || scrub.current) return;
    event.preventDefault();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    scrub.current = { pointerId: event.pointerId, resume: Boolean(props.src && props.playing) };
    if (scrub.current.resume) props.onPlaybackChange(false);
    props.onSeek(pointTime(event.clientX));
  }

  function finishScrub(event: PointerEvent<HTMLDivElement>, seek = false) {
    const active = scrub.current;
    if (!active || active.pointerId !== event.pointerId) return;
    if (seek) props.onSeek(pointTime(event.clientX));
    scrub.current = undefined;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (active.resume) props.onPlaybackChange(true);
  }

  function positionKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      props.onSeek(event.key === 'Home' ? 0 : event.key === 'End' ? duration : Math.max(0, Math.min(duration, props.currentTime + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 5 : .1))));
    } else if (props.src && (event.key === ' ' || event.key === 'Enter')) {
      event.preventDefault();
      if (!event.repeat && !scrub.current) props.onTogglePlay();
    }
  }

  function beginDrag(event: PointerEvent<HTMLElement>, cue: SubtitleCue, mode: 'move' | 'start' | 'end') {
    if (event.button !== 0 || props.readOnly) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    props.onSelect(cue.id);
    props.onSeek(subtitleSeconds(cue.start));
    drag.current = { cue, x: event.clientX, mode, pixelsPerSecond: trackRef.current!.getBoundingClientRect().width / duration };
  }

  function moveDrag(event: PointerEvent<HTMLElement>, commit = false) {
    const active = drag.current;
    if (!active) return;
    const delta = (event.clientX - active.x) / active.pixelsPerSecond;
    const start = subtitleSeconds(active.cue.start), end = subtitleSeconds(active.cue.end);
    const shift = Math.max(-start, Math.min(duration - end, delta));
    const nextStart = active.mode === 'move' ? start + shift : active.mode === 'start' ? Math.max(0, Math.min(end - .08, start + delta)) : start;
    const nextEnd = active.mode === 'move' ? end + shift : active.mode === 'end' ? Math.min(duration, Math.max(start + .08, end + delta)) : end;
    const next = retimeSubtitle(props.cues, active.cue.id, nextStart, nextEnd);
    if (commit) { drag.current = undefined; setDragCue(undefined); props.onChange(next); }
    else setDragCue(next.find(cue => cue.id === active.cue.id));
  }

  function timingInput(field: 'start' | 'end') {
    if (!selected) return null;
    const label = field === 'start' ? l('开始时间', 'Start time') : l('结束时间', 'End time');
    return <label className="subtitle-timeline-time-field">{label}<input key={`${selected.id}-${selected[field]}`} type="number" min={0} step="0.001"
      aria-label={label} disabled={props.readOnly} defaultValue={subtitleSeconds(selected[field])} dir="ltr"
      onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
      onBlur={event => {
        const value = event.currentTarget.value === '' ? Number.NaN : event.currentTarget.valueAsNumber;
        const next = retimeSubtitle(props.cues, selected.id, field === 'start' ? value : subtitleSeconds(selected.start), field === 'end' ? value : subtitleSeconds(selected.end));
        if (next === props.cues) {
          event.currentTarget.value = String(subtitleSeconds(selected[field]));
          setError(l('结束时间须晚于开始时间至少 0.08 秒。', 'End time must be at least 0.08 seconds after start time.'));
        } else { setError(''); props.onChange(next); }
      }} /></label>;
  }

  return <section className="subtitle-timeline" style={{ '--subtitle-timeline-height': `${height}px` } as CSSProperties}
    data-collapsed={collapsed} aria-label={l('字幕时间轴', 'Subtitle timeline')}>
    {!collapsed ? <div className="subtitle-timeline-resizer" role="separator" tabIndex={0} aria-orientation="horizontal"
      aria-label={l('调整时间轴高度', 'Resize timeline')} aria-valuemin={160} aria-valuemax={Math.max(160, Math.round(window.innerHeight * .5))} aria-valuenow={height}
      onKeyDown={event => {
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault(); setHeight(value => Math.max(160, Math.min(window.innerHeight * .5, value + (event.key === 'ArrowUp' ? 20 : -20))));
        }
      }}
      onPointerDown={event => { event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.dragY = String(event.clientY); event.currentTarget.dataset.dragHeight = String(height); }}
      onPointerMove={event => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) setHeight(Math.max(160, Math.min(window.innerHeight * .5, Number(event.currentTarget.dataset.dragHeight) + Number(event.currentTarget.dataset.dragY) - event.clientY)));
      }} onPointerUp={event => event.currentTarget.releasePointerCapture(event.pointerId)} /> : null}
    <div className="subtitle-timeline-toolbar">
      {props.src ? <button type="button" onClick={props.onTogglePlay} title={l('播放 / 暂停', 'Play / pause')} aria-label={l('播放 / 暂停', 'Play / pause')}>
        {props.playing ? <Pause size={16} /> : <Play size={16} />}
      </button> : null}
      <span className="subtitle-timeline-time" dir="ltr">{subtitleTimestamp(props.currentTime)} <span>/ {subtitleTimestamp(duration)}</span></span>
      {collapsed ? <input className="subtitle-timeline-compact-seek" type="range" min={0} max={duration} step="0.01"
        value={Math.min(props.currentTime, duration)} aria-label={l('字幕预览进度', 'Subtitle preview progress')}
        onChange={event => props.onSeek(event.currentTarget.valueAsNumber)} /> : null}
      {!collapsed ? <div className="subtitle-timeline-tools">
        <button type="button" disabled={props.readOnly || !canSplit} onClick={() => selected && props.onChange(splitSubtitle(props.cues, selected.id, props.currentTime))}
          title={l('在播放位置拆分', 'Split at playhead')}><Scissors size={15} /><span>{l('拆分', 'Split')}</span></button>
        <button type="button" disabled={props.readOnly || !canMerge} onClick={() => selected && props.onChange(mergeSubtitle(props.cues, selected.id))}
          title={l('与下一条合并', 'Merge with next')}><Merge size={15} /><span>{l('合并', 'Merge')}</span></button>
      </div> : null}
      {!collapsed ? <div className="subtitle-timeline-timing">{timingInput('start')}{timingInput('end')}</div> : null}
      {!collapsed ? <div className="subtitle-timeline-zoom">
        <button type="button" aria-label={l('缩小时间轴', 'Zoom out timeline')} disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value / 1.5))}><ZoomOut size={15} /></button>
        <span>{Math.round(zoom * 100)}%</span>
        <button type="button" aria-label={l('放大时间轴', 'Zoom in timeline')} disabled={zoom >= 16} onClick={() => setZoom(value => Math.min(16, value * 1.5))}><ZoomIn size={15} /></button>
      </div> : null}
      <button type="button" aria-label={collapsed ? l('展开时间轴', 'Expand timeline') : l('收起时间轴', 'Collapse timeline')} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
        {collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        {collapsed ? <span>{l('调整时间', 'Adjust timing')}</span> : null}
      </button>
    </div>
    {error ? <p className="subtitle-timeline-error" role="alert">{error}</p> : null}
    {!collapsed ? <div className="subtitle-timeline-scroll" ref={scrollRef} dir="ltr">
      <div className="subtitle-timeline-track" ref={trackRef} style={{ width: `${zoom * 100}%`, minHeight: `${clipTop + 7 + Math.max(1, lanes.length) * 40}px` }}>
        <div className="subtitle-timeline-seek" role="slider" tabIndex={0} aria-label={l('播放位置', 'Playback position')}
          aria-valuemin={0} aria-valuemax={duration} aria-valuenow={props.currentTime} aria-valuetext={subtitleTimestamp(props.currentTime)}
          aria-keyshortcuts={props.src ? 'Space Enter ArrowLeft ArrowRight Home End' : 'ArrowLeft ArrowRight Home End'}
          onPointerDown={beginScrub}
          onPointerMove={event => { if (scrub.current?.pointerId === event.pointerId) props.onSeek(pointTime(event.clientX)); }}
          onPointerUp={event => finishScrub(event, true)} onPointerCancel={event => finishScrub(event)}
          onLostPointerCapture={event => finishScrub(event)}
          onDoubleClick={() => { if (props.src) props.onTogglePlay(); }}
          onKeyDown={positionKeyDown}>
          <div className="subtitle-timeline-ruler" aria-hidden="true">
            {Array.from({ length: tickCount }, (_, i) => <span key={i} style={{ left: `${i / tickCount * 100}%` }}>{subtitleTimestamp(duration * i / tickCount).replace(/^00:/, '').replace(',', '.')}</span>)}
          </div>
          <div className="subtitle-timeline-waveform" aria-hidden="true" style={{ width: `${(waveform.duration || duration) / duration * 100}%` }}>
            {waveform.status === 'ready' ? <svg viewBox="0 0 10000 60" preserveAspectRatio="none"><path d={waveformPath} /></svg> : null}
          </div>
          {waveform.status !== 'ready' ? <span className="subtitle-timeline-waveform-status" role="status">
            {!props.src ? l('仅字幕时间轴', 'Subtitle timing only') : waveform.status === 'loading' ? l('正在生成音频波形…', 'Generating audio waveform…')
              : l('无法生成此媒体的波形，仍可调整字幕时间。', 'Waveform unavailable for this media. Subtitle timing is still editable.')}
          </span> : null}
        </div>
        {props.voiceSrc ? <div className="subtitle-timeline-voice" role="slider" tabIndex={0} aria-label={l('目标语言配音试听', 'Target-language dubbing preview')}
          aria-valuemin={0} aria-valuemax={duration} aria-valuenow={props.currentTime} aria-valuetext={subtitleTimestamp(props.currentTime)}
          onPointerDown={beginScrub} onPointerMove={event => { if (scrub.current?.pointerId === event.pointerId) props.onSeek(pointTime(event.clientX)); }}
          onPointerUp={event => finishScrub(event, true)} onPointerCancel={event => finishScrub(event)} onLostPointerCapture={event => finishScrub(event)}
          onDoubleClick={() => { if (props.src) props.onTogglePlay(); }} onKeyDown={positionKeyDown}>
          <span>{l('配音', 'Dubbing')}</span>
          {voiceWaveform.status === 'ready' ? <svg aria-hidden="true" viewBox="0 0 10000 60" preserveAspectRatio="none"
            style={{ width: `${voiceWaveform.duration / duration * 100}%` }}><path d={voiceWaveformPath} /></svg> : null}
        </div> : null}
        {positioned.filter(({ start, end }) => Number.isFinite(start) && end > start).map(({ cue, start, end, lane }) => <div key={cue.id}
          className="subtitle-timeline-clip" data-selected={props.selectedId === cue.id} data-active={props.currentTime >= start && props.currentTime < end}
          data-focused={props.playing || props.selectedId === undefined
            ? props.currentTime >= start && props.currentTime < end
            : props.selectedId === cue.id}
          style={{ left: `${start / duration * 100}%`, width: `${(end - start) / duration * 100}%`, top: `${clipTop + lane * 40}px` }}>
          <button type="button" className="subtitle-timeline-clip-body" title={`${cue.start} – ${cue.end}\n${cue.text}`}
            onFocus={() => props.onSelect(cue.id)} onClick={() => { props.onSelect(cue.id); props.onSeek(start); }}
            onPointerDown={event => beginDrag(event, cue, 'move')} onPointerMove={event => moveDrag(event)} onPointerUp={event => moveDrag(event, true)}
            onPointerCancel={() => { drag.current = undefined; setDragCue(undefined); }}
            onKeyDown={event => {
              if (!props.readOnly && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
                event.preventDefault(); const delta = Math.max(-start, Math.min(duration - end, (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? .5 : .05)));
                props.onChange(retimeSubtitle(props.cues, cue.id, start + delta, end + delta));
              }
            }} dir="auto">{cue.text}</button>
          {!props.readOnly ? (['start', 'end'] as const).map(edge => <span key={edge} role="slider" tabIndex={0}
            className={`subtitle-timeline-clip-handle subtitle-timeline-clip-${edge}`} aria-label={edge === 'start' ? l('开始时间', 'Start time') : l('结束时间', 'End time')}
            aria-valuemin={edge === 'start' ? 0 : start + .08} aria-valuemax={edge === 'start' ? end - .08 : duration} aria-valuenow={edge === 'start' ? start : end}
            onPointerDown={event => beginDrag(event, cue, edge)} onPointerMove={event => moveDrag(event)} onPointerUp={event => moveDrag(event, true)}
            onPointerCancel={() => { drag.current = undefined; setDragCue(undefined); }}
            onKeyDown={event => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
              event.preventDefault(); const delta = (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? .5 : .05);
              props.onChange(retimeSubtitle(props.cues, cue.id, edge === 'start' ? Math.max(0, start + delta) : start, edge === 'end' ? Math.min(duration, end + delta) : end));
            }} />) : null}
        </div>)}
        <div className="subtitle-timeline-playhead" style={{ left: `${props.currentTime / duration * 100}%` }} aria-hidden="true" />
      </div>
    </div> : null}
  </section>;
}
