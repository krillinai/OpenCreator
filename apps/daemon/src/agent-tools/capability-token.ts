import { createHash, randomBytes } from 'node:crypto';

export const AGENT_CAPABILITY_SCOPES = [
  'schedule:get',
  'schedule:create',
  'schedule:update',
  'schedule:pause',
  'schedule:resume',
  'schedule:run_now'
] as const;

export type AgentCapabilityScope = typeof AGENT_CAPABILITY_SCOPES[number];

export type AgentCapabilityGrant = {
  runId: string;
  threadId: string;
  createdBy: 'api' | 'schedule';
  scopes: AgentCapabilityScope[];
  issuedAt: string;
  expiresAt: string;
};

export type AgentCapabilityTokenErrorCode =
  | 'CAPABILITY_STORE_CLOSED'
  | 'CAPABILITY_TOKEN_MISSING'
  | 'CAPABILITY_TOKEN_INVALID'
  | 'CAPABILITY_TOKEN_EXPIRED'
  | 'CAPABILITY_TOKEN_REVOKED'
  | 'CAPABILITY_SCOPE_FORBIDDEN'
  | 'CAPABILITY_RUN_FORBIDDEN'
  | 'CAPABILITY_THREAD_FORBIDDEN';

export class AgentCapabilityTokenError extends Error {
  readonly code: AgentCapabilityTokenErrorCode;
  readonly statusCode: number;

  constructor(code: AgentCapabilityTokenErrorCode, statusCode: number, message: string) {
    super(message);
    this.name = 'AgentCapabilityTokenError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export type AgentCapabilityTokenStore = {
  issue(input: {
    runId: string;
    threadId: string;
    createdBy: 'api' | 'schedule';
    scopes: AgentCapabilityScope[];
  }): { token: string; expiresAt: string };
  authorize(
    token: string | undefined,
    requirement: {
      scope: AgentCapabilityScope;
      runId?: string;
      threadId?: string;
    }
  ): AgentCapabilityGrant;
  revokeRun(runId: string): number;
  cleanupExpired(): number;
  close(): void;
};

type CapabilityRecord = AgentCapabilityGrant & {
  expiresAtMs: number;
  revoked: boolean;
};

type Clock = {
  now(): number;
};

type Timers = {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type AgentCapabilityTokenStoreOptions = {
  ttlMs?: number;
  cleanupIntervalMs?: number;
  clock?: Clock;
  timers?: Timers;
  createSecret?(): string;
};

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 60 * 1000;
const CAPABILITY_PREFIX = 'clwcap_';
const MAX_TOKEN_LENGTH = 512;
const MUTATION_SCOPES = new Set<AgentCapabilityScope>([
  'schedule:create',
  'schedule:update',
  'schedule:pause',
  'schedule:resume',
  'schedule:run_now'
]);

export function createAgentCapabilityTokenStore(
  options: AgentCapabilityTokenStoreOptions = {}
): AgentCapabilityTokenStore {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
  const clock = options.clock ?? { now: () => Date.now() };
  const timers = options.timers ?? {
    setInterval: (callback, ms) => setInterval(callback, ms),
    clearInterval: handle => clearInterval(handle as ReturnType<typeof setInterval>)
  };
  const createSecret = options.createSecret ?? (
    () => `${CAPABILITY_PREFIX}${randomBytes(32).toString('base64url')}`
  );
  const records = new Map<string, CapabilityRecord>();
  const digestsByRun = new Map<string, Set<string>>();
  let closed = false;

  const cleanupTimer = timers.setInterval(() => {
    cleanupExpired();
  }, cleanupIntervalMs);
  unrefTimer(cleanupTimer);

  function issue(input: {
    runId: string;
    threadId: string;
    createdBy: 'api' | 'schedule';
    scopes: AgentCapabilityScope[];
  }): { token: string; expiresAt: string } {
    if (closed) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_STORE_CLOSED',
        503,
        'Capability token store is closed'
      );
    }
    if (input.runId.trim().length === 0 || input.threadId.trim().length === 0) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_TOKEN_INVALID',
        400,
        'Capability binding is invalid'
      );
    }
    const scopes = uniqueScopes(input.scopes);
    if (scopes.length === 0) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_SCOPE_FORBIDDEN',
        403,
        'At least one capability scope is required'
      );
    }
    if (
      input.createdBy === 'schedule'
      && scopes.some(scope => MUTATION_SCOPES.has(scope))
    ) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_SCOPE_FORBIDDEN',
        403,
        'Automatic schedule runs cannot receive mutation scopes'
      );
    }

    const token = createSecret();
    const digest = digestToken(token);
    const issuedAtMs = clock.now();
    const expiresAtMs = issuedAtMs + ttlMs;
    const record: CapabilityRecord = {
      runId: input.runId,
      threadId: input.threadId,
      createdBy: input.createdBy,
      scopes,
      issuedAt: new Date(issuedAtMs).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      expiresAtMs,
      revoked: false
    };
    records.set(digest, record);
    const runDigests = digestsByRun.get(input.runId) ?? new Set<string>();
    runDigests.add(digest);
    digestsByRun.set(input.runId, runDigests);
    return { token, expiresAt: record.expiresAt };
  }

  function authorize(
    token: string | undefined,
    requirement: {
      scope: AgentCapabilityScope;
      runId?: string;
      threadId?: string;
    }
  ): AgentCapabilityGrant {
    if (token === undefined || token.length === 0) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_TOKEN_MISSING',
        401,
        'Capability token is required'
      );
    }
    if (
      token.length > MAX_TOKEN_LENGTH
      || !token.startsWith(CAPABILITY_PREFIX)
    ) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_TOKEN_INVALID',
        401,
        'Capability token is invalid'
      );
    }

    const digest = digestToken(token);
    const record = records.get(digest);
    if (record === undefined) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_TOKEN_INVALID',
        401,
        'Capability token is invalid'
      );
    }
    if (record.expiresAtMs <= clock.now()) {
      removeRecord(digest, record);
      throw new AgentCapabilityTokenError(
        'CAPABILITY_TOKEN_EXPIRED',
        401,
        'Capability token has expired'
      );
    }
    if (record.revoked) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_TOKEN_REVOKED',
        401,
        'Capability token has been revoked'
      );
    }
    if (!record.scopes.includes(requirement.scope)) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_SCOPE_FORBIDDEN',
        403,
        'Capability scope is not allowed'
      );
    }
    if (requirement.runId !== undefined && requirement.runId !== record.runId) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_RUN_FORBIDDEN',
        403,
        'Capability run binding does not match'
      );
    }
    if (
      requirement.threadId !== undefined
      && requirement.threadId !== record.threadId
    ) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_THREAD_FORBIDDEN',
        403,
        'Capability thread binding does not match'
      );
    }
    return {
      runId: record.runId,
      threadId: record.threadId,
      createdBy: record.createdBy,
      scopes: [...record.scopes],
      issuedAt: record.issuedAt,
      expiresAt: record.expiresAt
    };
  }

  function revokeRun(runId: string): number {
    const digests = digestsByRun.get(runId);
    if (digests === undefined) return 0;
    let revoked = 0;
    for (const digest of digests) {
      const record = records.get(digest);
      if (record === undefined || record.revoked) continue;
      record.revoked = true;
      revoked += 1;
    }
    return revoked;
  }

  function cleanupExpired(): number {
    const now = clock.now();
    let removed = 0;
    for (const [digest, record] of records) {
      if (record.expiresAtMs > now) continue;
      removeRecord(digest, record);
      removed += 1;
    }
    return removed;
  }

  function removeRecord(digest: string, record: CapabilityRecord): void {
    records.delete(digest);
    const runDigests = digestsByRun.get(record.runId);
    runDigests?.delete(digest);
    if (runDigests?.size === 0) digestsByRun.delete(record.runId);
  }

  function close(): void {
    if (closed) return;
    closed = true;
    timers.clearInterval(cleanupTimer);
    records.clear();
    digestsByRun.clear();
  }

  return {
    issue,
    authorize,
    revokeRun,
    cleanupExpired,
    close
  };
}

function uniqueScopes(scopes: AgentCapabilityScope[]): AgentCapabilityScope[] {
  const allowed = new Set<AgentCapabilityScope>(AGENT_CAPABILITY_SCOPES);
  const result: AgentCapabilityScope[] = [];
  for (const scope of scopes) {
    if (!allowed.has(scope)) {
      throw new AgentCapabilityTokenError(
        'CAPABILITY_SCOPE_FORBIDDEN',
        403,
        'Capability scope is not recognized'
      );
    }
    if (!result.includes(scope)) result.push(scope);
  }
  return result;
}

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function unrefTimer(handle: unknown): void {
  if (
    typeof handle === 'object'
    && handle !== null
    && 'unref' in handle
    && typeof handle.unref === 'function'
  ) {
    handle.unref();
  }
}
