export const VOLCENGINE_TTS_V3_AUDIO_CODE = 0;
export const VOLCENGINE_TTS_V3_COMPLETE_CODE = 20000000;

type VolcengineV3Frame = {
  kind: 'audio';
  data: Buffer;
} | {
  kind: 'complete';
};

export function parseVolcengineV3Audio(payload: string): Buffer {
  const chunks: Buffer[] = [];
  let completed = false;
  for (const line of payload.split(/\r?\n/)) {
    const frame = parseVolcengineV3Frame(line);
    if (frame === undefined) continue;
    if (frame.kind === 'complete') {
      completed = true;
      break;
    }
    chunks.push(frame.data);
  }
  if (chunks.length === 0) {
    throw new Error(
      completed
        ? 'Volcengine TTS 2.0 completed without audio'
        : 'Volcengine TTS 2.0 response did not contain audio'
    );
  }
  return Buffer.concat(chunks);
}

export function parseVolcengineV3Frame(line: string): VolcengineV3Frame | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  const jsonText = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
  if (!jsonText) return undefined;

  let decoded: unknown;
  try {
    decoded = JSON.parse(jsonText);
  } catch {
    throw new Error(`Volcengine TTS 2.0 returned a non-JSON frame: ${truncateFrame(jsonText)}`);
  }

  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    throw new Error(`Volcengine TTS 2.0 returned a non-object frame: ${truncateFrame(jsonText)}`);
  }

  const payload = decoded as { code?: unknown; message?: unknown; data?: unknown };
  if (typeof payload.code !== 'number' || !Number.isFinite(payload.code)) {
    throw new Error(`Volcengine TTS 2.0 frame is missing a numeric code: ${truncateFrame(jsonText)}`);
  }
  if (payload.code === VOLCENGINE_TTS_V3_COMPLETE_CODE) {
    return { kind: 'complete' };
  }
  if (payload.code !== VOLCENGINE_TTS_V3_AUDIO_CODE) {
    const message = typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : String(payload.code);
    throw new Error(`Volcengine TTS 2.0 failed: ${message}`);
  }
  if (typeof payload.data !== 'string' || payload.data.length === 0) {
    return undefined;
  }
  return { kind: 'audio', data: decodeVolcengineV3Audio(payload.data) };
}

function decodeVolcengineV3Audio(value: string): Buffer {
  const normalized = value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new Error('Volcengine TTS 2.0 returned invalid audio encoding');
  }
  const data = Buffer.from(normalized, 'base64');
  if (data.length === 0) {
    throw new Error('Volcengine TTS 2.0 returned invalid audio');
  }
  return data;
}

function truncateFrame(value: string): string {
  const compact = value.replace(/\s+/g, ' ');
  return compact.length > 120 ? `${compact.slice(0, 117)}...` : compact;
}
