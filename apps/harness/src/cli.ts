import type {
  AgentEventEnvelope,
  NotificationAcknowledgeResponse,
  NotificationOutboxListResponse,
  RunRequest
} from '@opencreator/protocol';
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { consumeNotificationBatch, notificationRoute } from './notification-host.js';

type ParsedArgs = {
  command: string;
  flags: Record<string, string | boolean>;
  positional: string[];
};

type RequestOptions = {
  baseUrl: string;
  token: string;
};

const args = parseArgs(process.argv.slice(2));

try {
  await dispatch(args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function dispatch(input: ParsedArgs): Promise<void> {
  if (input.command === '' || input.flags.help === true) {
    printUsage();
    return;
  }

  const options = requestOptions(input.flags);

  if (input.command === 'run') {
    const prompt = stringFlag(input.flags, 'prompt') ?? input.positional.join(' ');
    if (prompt.length === 0) throw new Error('run requires --prompt or positional prompt text');

    const body: RunRequest = {
      prompt,
      cwd: stringFlag(input.flags, 'cwd'),
      profile: stringFlag(input.flags, 'profile'),
      sandbox: sandboxFlag(input.flags),
      threadId: stringFlag(input.flags, 'thread-id'),
      resumeMode: resumeModeFlag(input.flags),
      model: stringFlag(input.flags, 'model'),
      reasoning: reasoningFlag(input.flags)
    };

    printJson(await apiFetch(options, '/runs', { method: 'POST', body }));
    return;
  }

  if (input.command === 'events') {
    const runId = requiredRunId(input);
    await streamEvents(options, runId, numberFlag(input.flags, 'after-seq') ?? 0);
    return;
  }

  if (input.command === 'cancel') {
    const runId = requiredRunId(input);
    printJson(await apiFetch(options, `/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }));
    return;
  }

  if (input.command === 'history') {
    const limit = numberFlag(input.flags, 'limit');
    const suffix = limit === undefined ? '' : `?limit=${encodeURIComponent(String(limit))}`;
    printJson(await apiFetch(options, `/runs${suffix}`));
    return;
  }

  if (input.command === 'diagnostics') {
    const runId = requiredRunId(input);
    const diagnostics = await apiFetch(options, `/runs/${encodeURIComponent(runId)}/diagnostics`);
    const output = stringFlag(input.flags, 'output');
    if (output === undefined) {
      printJson(diagnostics);
    } else {
      writeFileSync(output, `${JSON.stringify(diagnostics, null, 2)}\n`);
      console.log(output);
    }
    return;
  }

  if (input.command === 'notifications') {
    await consumeNotifications(options, input.flags);
    return;
  }

  throw new Error(`Unknown command: ${input.command}`);
}

function parseArgs(raw: string[]): ParsedArgs {
  if (raw[0] === '--') return parseArgs(raw.slice(1));

  const [first = '', ...tail] = raw;
  const command = first.startsWith('--') ? '' : first;
  const rest = first.startsWith('--') ? raw : tail;
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];

  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === undefined) continue;
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }

    const keyValue = value.slice(2);
    const equalsIndex = keyValue.indexOf('=');
    if (equalsIndex >= 0) {
      flags[keyValue.slice(0, equalsIndex)] = keyValue.slice(equalsIndex + 1);
      continue;
    }

    const key = keyValue;
    const next = rest[index + 1];
    if (next !== undefined && !next.startsWith('--')) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }

  return { command, flags, positional };
}

function requestOptions(flags: Record<string, string | boolean>): RequestOptions {
  const baseUrl = stringFlag(flags, 'base-url') ?? process.env.OPENCREATOR_DAEMON_URL;
  const token = stringFlag(flags, 'token') ?? process.env.OPENCREATOR_DAEMON_TOKEN;
  if (baseUrl === undefined || baseUrl.length === 0) {
    throw new Error('Missing --base-url or OPENCREATOR_DAEMON_URL');
  }
  if (token === undefined || token.length === 0) {
    throw new Error('Missing --token or OPENCREATOR_DAEMON_TOKEN');
  }
  return { baseUrl: baseUrl.replace(/\/$/, ''), token };
}

async function apiFetch(
  options: RequestOptions,
  path: string,
  init: { method?: string; body?: unknown } = {}
): Promise<unknown> {
  const response = await fetch(`${options.baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${options.token}`,
      ...(init.body === undefined ? {} : { 'content-type': 'application/json' })
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body)
  });

  const text = await response.text();
  const parsed = text.length === 0 ? undefined : JSON.parse(text);
  if (!response.ok) {
    const message = isApiError(parsed)
      ? `${parsed.error.code}: ${parsed.error.message}`
      : `HTTP ${response.status}`;
    throw new Error(message);
  }
  return parsed;
}

async function streamEvents(options: RequestOptions, runId: string, afterSeq: number): Promise<void> {
  const response = await fetch(
    `${options.baseUrl}/runs/${encodeURIComponent(runId)}/events?afterSeq=${afterSeq}`,
    { headers: { authorization: `Bearer ${options.token}` } }
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (response.body === null) throw new Error('SSE response has no body');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split(/\n\n/);
    buffer = frames.pop() ?? '';
    for (const frame of frames) printSseFrame(frame);
  }

  if (buffer.trim().length > 0) printSseFrame(buffer);
}

async function consumeNotifications(
  options: RequestOptions,
  flags: Record<string, string | boolean>
): Promise<void> {
  let after = stringFlag(flags, 'after') ?? '0';
  if (!/^\d+$/.test(after)) throw new Error('--after must be a non-negative integer');
  const limit = numberFlag(flags, 'limit') ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error('--limit must be an integer between 1 and 100');
  }
  const intervalMs = numberFlag(flags, 'interval-ms') ?? 5_000;
  if (!Number.isInteger(intervalMs) || intervalMs < 100) {
    throw new Error('--interval-ms must be an integer of at least 100');
  }
  const watch = flags.watch === true;
  const click = flags.click === true;
  const client = {
    async list(cursor: string, pageLimit: number): Promise<NotificationOutboxListResponse> {
      return await apiFetch(
        options,
        `/notifications?after=${encodeURIComponent(cursor)}&limit=${pageLimit}`
      ) as NotificationOutboxListResponse;
    },
    async acknowledge(ids: string[]): Promise<NotificationAcknowledgeResponse> {
      return await apiFetch(options, '/notifications/acknowledge', {
        method: 'POST',
        body: { ids }
      }) as NotificationAcknowledgeResponse;
    }
  };
  const adapter = {
    async show(
      notification: NotificationOutboxListResponse['notifications'][number],
      onClick: () => Promise<void>
    ) {
      console.log(JSON.stringify({
        type: 'notification',
        notification,
        route: notificationRoute(notification)
      }));
      if (click) await onClick();
    },
    async openRoute(route: string) {
      console.log(JSON.stringify({ type: 'open_route', route }));
    }
  };

  do {
    const result = await consumeNotificationBatch({
      after,
      limit,
      client,
      adapter
    });
    after = result.nextCursor;
    if (!watch) return;
    await delay(intervalMs);
  } while (true);
}

function printSseFrame(frame: string): void {
  const dataLines = frame
    .split(/\n/)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart());
  if (dataLines.length === 0) return;
  const event = JSON.parse(dataLines.join('\n')) as AgentEventEnvelope;
  console.log(JSON.stringify(event));
}

function requiredRunId(input: ParsedArgs): string {
  const runId = stringFlag(input.flags, 'run-id') ?? input.positional[0];
  if (runId === undefined || runId.length === 0) throw new Error(`${input.command} requires a run id`);
  return runId;
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === 'string' ? value : undefined;
}

function numberFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number`);
  return parsed;
}

function sandboxFlag(flags: Record<string, string | boolean>): RunRequest['sandbox'] {
  const value = stringFlag(flags, 'sandbox');
  if (value === undefined) return undefined;
  if (value === 'read-only' || value === 'workspace-write' || value === 'danger-full-access') return value;
  throw new Error('--sandbox must be read-only, workspace-write, or danger-full-access');
}

function resumeModeFlag(flags: Record<string, string | boolean>): RunRequest['resumeMode'] {
  const value = stringFlag(flags, 'resume-mode');
  if (value === undefined) return undefined;
  if (value === 'new_thread' || value === 'resume_thread') return value;
  throw new Error('--resume-mode must be new_thread or resume_thread');
}

function reasoningFlag(flags: Record<string, string | boolean>): RunRequest['reasoning'] {
  const value = stringFlag(flags, 'reasoning');
  if (value === undefined) return undefined;
  if (value === 'default' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') {
    return value;
  }
  throw new Error('--reasoning must be default, low, medium, high, or xhigh');
}

function isApiError(value: unknown): value is { error: { code: string; message: string } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as { error?: unknown }).error === 'object' &&
    (value as { error?: unknown }).error !== null
  );
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function printUsage(): void {
  console.log(`Usage:
  pnpm harness run --base-url <url> --token <token> --prompt <text> [--cwd <dir>]
  pnpm harness events --base-url <url> --token <token> <run_id> [--after-seq <n>]
  pnpm harness cancel --base-url <url> --token <token> <run_id>
  pnpm harness history --base-url <url> --token <token> [--limit <n>]
  pnpm harness diagnostics --base-url <url> --token <token> <run_id> [--output <file>]
  pnpm harness notifications --base-url <url> --token <token> [--after <cursor>] [--watch]

Environment:
  OPENCREATOR_DAEMON_URL, OPENCREATOR_DAEMON_TOKEN
`);
}
