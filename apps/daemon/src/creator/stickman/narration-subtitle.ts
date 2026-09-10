import type { StickmanAudioTiming, StickmanScriptManifest } from './contracts.js';

export function renderStickmanNarrationSrt(
  segments: StickmanScriptManifest['segments']
): string {
  let cursor = 0;
  return `${segments.map((segment, index) => {
    const start = cursor;
    cursor += Math.round(segment.estimatedDurationSeconds * 1_000);
    return `${index + 1}\n${srtTimestamp(start)} --> ${srtTimestamp(cursor)}\n${segment.narration}`;
  }).join('\n\n')}\n`;
}

export function renderStickmanTimedNarrationSrt(
  script: StickmanScriptManifest,
  timing: StickmanAudioTiming
): string {
  const narrationById = new Map(script.segments.map(segment => [segment.id, segment.narration]));
  return `${timing.segments.map((segment, index) => {
    const narration = narrationById.get(segment.segmentId);
    if (narration === undefined) throw new Error(`narration_segment_missing: ${segment.segmentId}`);
    return `${index + 1}\n${srtTimestamp(Math.round(segment.startSeconds * 1_000))} --> ${srtTimestamp(Math.round(segment.endSeconds * 1_000))}\n${narration}`;
  }).join('\n\n')}\n`;
}

function srtTimestamp(milliseconds: number): string {
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(remainder).padStart(3, '0')}`;
}
