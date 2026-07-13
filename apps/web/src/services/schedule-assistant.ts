import type { AgentEventEnvelope, RunResponse } from '@clawee/protocol';
import type {
  ScheduleFrequency,
  ScheduleRepeat,
} from '../features/schedules/schedule-frequency.js';
import type { SubscribeRunEventsInput } from '../runtime/sse.js';
import type { ConnectionConfig } from '../runtime/types.js';

export type ScheduleAssistantDraft = {
  name: string;
  prompt: string;
  frequency: ScheduleFrequency;
};

export type ScheduleAssistantInput = {
  description: string;
  cwd: string;
  profile: string;
  timezone: string;
};

export type ScheduleAssistantService = {
  generate(input: ScheduleAssistantInput): Promise<ScheduleAssistantDraft>;
};

type ScheduleAssistantDependencies = {
  runService: {
    startStandaloneRun(input: {
      prompt: string;
      cwd?: string;
      profile?: string;
    }): Promise<RunResponse>;
    cancelRun(id: string): Promise<{ id: string; canceled: boolean }>;
  };
  subscribeRunEvents(input: SubscribeRunEventsInput): Promise<void>;
  connection: ConnectionConfig;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

const DEFAULT_GENERATION_TIMEOUT_MS = 90_000;

export function createScheduleAssistant(
  dependencies: ScheduleAssistantDependencies
): ScheduleAssistantService {
  return {
    async generate(input) {
      const run = await dependencies.runService.startStandaloneRun({
        prompt: buildAssistantPrompt(input),
        cwd: input.cwd,
        profile: input.profile,
      });

      let finalMessage = '';
      let deltaMessage = '';
      let terminalStatus: 'succeeded' | 'failed' | 'canceled' | undefined;
      let eventError: Error | undefined;
      let streamError: Error | undefined;
      let timedOut = false;
      const abortController = new AbortController();
      const timeout = globalThis.setTimeout(() => {
        timedOut = true;
        abortController.abort();
        void dependencies.runService.cancelRun(run.id).catch(() => undefined);
      }, dependencies.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS);

      try {
        await dependencies.subscribeRunEvents({
          baseUrl: dependencies.connection.baseUrl,
          token: dependencies.connection.token,
          runId: run.id,
          fetchImpl: dependencies.fetchImpl,
          signal: abortController.signal,
          onEvent(event) {
            if (event.type === 'assistant_message') {
              if (event.payload.delivery === 'message') {
                finalMessage = event.payload.text;
              } else {
                deltaMessage += event.payload.text;
              }
            }
            if (event.type === 'error') {
              eventError = new Error(event.payload.message);
            }
            if (event.type === 'done') {
              terminalStatus = event.payload.status;
            }
          },
          onError(error) {
            streamError = error;
          },
        });
      } finally {
        globalThis.clearTimeout(timeout);
      }

      if (timedOut) throw new Error('Clawee 生成计划超时，请重试');
      if (streamError !== undefined) throw formatGenerationError(streamError);
      if (eventError !== undefined) throw formatGenerationError(eventError);
      if (terminalStatus !== 'succeeded') {
        throw new Error(
          terminalStatus === 'canceled'
            ? 'Clawee 已取消生成计划'
            : 'Clawee 没有成功生成计划'
        );
      }

      return parseScheduleAssistantResponse(finalMessage || deltaMessage);
    },
  };
}

function formatGenerationError(error: Error): Error {
  if (/\bspawn\b.*\bENOENT\b/i.test(error.message)) {
    return new Error('Clawee 无法启动，请检查所选项目目录是否存在，或重启服务后重试');
  }
  return error;
}

export function parseScheduleAssistantResponse(value: string): ScheduleAssistantDraft {
  const json = extractJson(value);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('Clawee 返回的计划格式无法识别，请重试');
  }
  if (!isRecord(parsed)) {
    throw new Error('Clawee 返回的计划格式无法识别，请重试');
  }

  const name = readNonEmptyString(parsed.name);
  const prompt = readNonEmptyString(parsed.prompt);
  const repeat = readRepeat(parsed.repeat);
  const time = readTime(parsed.time);
  const days = readDays(parsed.days);
  if (name === undefined || prompt === undefined || repeat === undefined || time === undefined) {
    throw new Error('Clawee 返回的计划信息不完整，请重试');
  }

  return {
    name,
    prompt,
    frequency: {
      repeat,
      time,
      days: normalizeAssistantDays(repeat, days),
    },
  };
}

function buildAssistantPrompt(input: ScheduleAssistantInput): string {
  return [
    '你是 Clawee 的计划任务配置助手。',
    '不要调用工具，不要修改文件，只根据用户描述生成一个计划任务草稿。',
    `用户所在时区：${input.timezone}`,
    '只输出一个 JSON 对象，不要输出 Markdown 或解释。',
    'JSON 格式：',
    '{"name":"简短标题","prompt":"任务执行时要交给 Agent 的完整指令","repeat":"hourly|daily|weekdays|weekly|custom","time":"HH:mm","days":[1,2,3]}',
    'days 使用 0=周日、1=周一 ... 6=周六；weekly 只填一天；custom 可填多天；其他类型填空数组。',
    '如果用户没有给出精确时间，使用 09:00；如果没有给出频率，使用 daily。',
    `用户描述：${input.description.trim()}`,
  ].join('\n');
}

function extractJson(value: string): string {
  const trimmed = value.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1] !== undefined) return fenced[1].trim();
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

function readRepeat(value: unknown): Exclude<ScheduleRepeat, 'advanced'> | undefined {
  return value === 'hourly'
    || value === 'daily'
    || value === 'weekdays'
    || value === 'weekly'
    || value === 'custom'
    ? value
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  return match === null ? undefined : `${match[1]}:${match[2]}`;
}

function readDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (day): day is number => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6
  );
}

function normalizeAssistantDays(
  repeat: Exclude<ScheduleRepeat, 'advanced'>,
  days: number[]
): number[] {
  if (repeat === 'weekly') return [days[0] ?? 1];
  if (repeat === 'custom') {
    const normalized = Array.from(new Set(days));
    return normalized.length > 0 ? normalized : [1];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
