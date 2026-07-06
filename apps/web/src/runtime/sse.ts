import type { AgentEventEnvelope } from '@clawee/protocol';
import { assertKnownEventType, isRecord } from './validators.js';

export type SseFrame = {
  id?: string;
  event?: string;
  data: string;
};

export type SubscribeRunEventsInput = {
  baseUrl: string;
  token: string;
  runId: string;
  fromSeq?: number;
  fetchImpl?: typeof fetch;
  onEvent(event: AgentEventEnvelope): void;
  onError(error: Error): void;
  signal?: AbortSignal;
};

type SseParser = {
  parseChunk(chunk: string): SseFrame[];
};

let defaultParser = createSseParser();

export function parseSseChunk(chunk: string): SseFrame[] {
  return defaultParser.parseChunk(chunk);
}

export function sseEventsToFrames(lines: string[]): SseFrame[] {
  defaultParser = createSseParser();
  const frames = parseSseChunk(lines.join(''));
  defaultParser = createSseParser();
  return frames;
}

export async function subscribeRunEvents(input: SubscribeRunEventsInput): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${input.baseUrl.replace(/\/+$/, '')}/runs/${encodeURIComponent(input.runId)}/events?fromSeq=${input.fromSeq ?? 0}`;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${input.token}` },
    signal: input.signal
  });

  if (!response.ok) throw new Error(`SSE request failed with ${response.status}`);
  if (response.body === null) throw new Error('SSE response body is empty');

  const parser = createSseParser();
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      for (const frame of parser.parseChunk(read.value)) {
        const event = parseAgentEvent(frame.data);
        if (event !== undefined) input.onEvent(event);
      }
    }
  } catch (error) {
    if (!input.signal?.aborted) input.onError(error instanceof Error ? error : new Error(String(error)));
  } finally {
    reader.releaseLock();
  }
}

function createSseParser(): SseParser {
  let buffer = '';

  return {
    parseChunk(chunk: string): SseFrame[] {
      buffer += chunk;
      const frames: SseFrame[] = [];
      let boundary = buffer.indexOf('\n\n');

      while (boundary >= 0) {
        const rawFrame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseFrame(rawFrame);
        if (frame !== undefined) frames.push(frame);
        boundary = buffer.indexOf('\n\n');
      }

      return frames;
    }
  };
}

function parseFrame(rawFrame: string): SseFrame | undefined {
  const frame: Partial<SseFrame> = {};
  const data: string[] = [];

  for (const line of rawFrame.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('id:')) frame.id = line.slice(3).trimStart();
    if (line.startsWith('event:')) frame.event = line.slice(6).trimStart();
    if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }

  if (data.length === 0) return undefined;
  return { ...frame, data: data.join('\n') };
}

function parseAgentEvent(raw: string): AgentEventEnvelope | undefined {
  const parsed = JSON.parse(raw) as unknown;
  if (!isRecord(parsed) || typeof parsed.type !== 'string') return undefined;
  if (!assertKnownEventType(parsed.type)) return undefined;
  return parsed as AgentEventEnvelope;
}
