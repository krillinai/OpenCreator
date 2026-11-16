import { isIP } from 'node:net';

export type FailureDiagnostic = {
  version: 1;
  operation: string;
  causes: Array<{ name: string; code?: string }>;
  steps?: Array<{ operation: string; code: string; result: 'fallback' | 'failed' }>;
  process?: { tool: string; version?: string; exit_code?: number };
  network?: {
    route: 'direct' | 'proxy' | 'unknown';
    peer: 'proxy' | 'platform' | 'gateway' | 'unknown';
    platform?: string;
    proxy_scope?: 'loopback' | 'private' | 'public' | 'unknown';
    proxy_port?: number;
    reason?: string;
  };
  evidence?: string[];
  frames?: string[];
  missing?: string[];
};

const MAX_DIAGNOSTIC_BYTES = 4_096;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const evidencePattern = /^(?:api_page_failed|connection_refused|connection_reset|dns_failed|timeout|tls_failed|proxy_failed|network_unreachable|format_unavailable|login_required|disk_full|extractor_failed|http_[1-5][0-9]{2}|internal_attempts_[1-9][0-9]{0,2})$/;
const missingValues = new Set(['process_output_unrecognized', 'network_peer_unknown', 'stack_unavailable']);

function safeIdentifier(value: unknown): string | undefined {
  return typeof value === 'string' && identifier.test(value)
    && !value.split(/[._:-]/).some(part => part.length >= 32)
    && !/^(?:sk[-_]|AIza|AKIA|ASIA|gh[pousr]_|github_pat_|eyJ)/i.test(value)
    ? value : undefined;
}

export function extractDiagnosticEvidence(text: string): string[] {
  const findings: string[] = [];
  const add = (matched: boolean, label: string) => { if (matched) findings.push(label); };
  add(/unable to download api page/i.test(text), 'api_page_failed');
  add(/(?:econnrefused|connection refused|\[errno (?:61|111)\])/i.test(text), 'connection_refused');
  add(/(?:econnreset|connection reset)/i.test(text), 'connection_reset');
  add(/(?:enotfound|eai_again|name or service not known|failed to resolve|name resolution)/i.test(text), 'dns_failed');
  add(/(?:timed? out|etimedout)/i.test(text), 'timeout');
  add(/(?:certificate verify|tls handshake|ssl error)/i.test(text), 'tls_failed');
  add(/(?:proxyerror|proxy connection|proxy server)/i.test(text), 'proxy_failed');
  add(/(?:network is unreachable|enetunreach)/i.test(text), 'network_unreachable');
  add(/(?:requested format is not available|no video formats found)/i.test(text), 'format_unavailable');
  add(/(?:sign in to confirm|login required|fresh cookies)/i.test(text), 'login_required');
  add(/(?:no space left|enospc)/i.test(text), 'disk_full');
  add(/(?:unable to extract|extractor error|signature extraction failed)/i.test(text), 'extractor_failed');
  const status = /(?:http error|status code:?)\s*([1-5]\d\d)\b/i.exec(text);
  if (status) findings.push(`http_${status[1]}`);
  const attempts = /after\s+([1-9]\d{0,2})\s+attempts?\b/i.exec(text);
  if (attempts) findings.push(`internal_attempts_${attempts[1]}`);
  return findings.slice(0, 12);
}

function platformFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const host = new URL(value).hostname.toLowerCase();
    for (const [platform, domains] of Object.entries({
      youtube: ['youtube.com', 'youtu.be', 'googlevideo.com'],
      bilibili: ['bilibili.com', 'b23.tv'],
      douyin: ['douyin.com'],
      tiktok: ['tiktok.com'],
      instagram: ['instagram.com'],
      facebook: ['facebook.com', 'fb.watch'],
      x: ['x.com', 'twitter.com'],
      xiaohongshu: ['xiaohongshu.com', 'xhslink.com'],
      pinterest: ['pinterest.com'],
      reddit: ['reddit.com']
    })) {
      if (domains.some(domain => host === domain || host.endsWith(`.${domain}`))) return platform;
    }
  } catch { /* URL is diagnostic input, not a reason to fail execution. */ }
  return undefined;
}

function proxyDetails(proxy: string): Pick<NonNullable<FailureDiagnostic['network']>, 'proxy_scope' | 'proxy_port'> {
  try {
    const value = new URL(proxy);
    const host = value.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const scope = host === 'localhost' || host === '::1' || host.startsWith('127.') ? 'loopback'
      : isIP(host) === 4 && /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(host) ? 'private'
        : isIP(host) === 0 ? 'unknown' : 'public';
    const port = Number(value.port);
    return { proxy_scope: scope, ...(Number.isInteger(port) && port > 0 && port <= 65535 ? { proxy_port: port } : {}) };
  } catch {
    return { proxy_scope: 'unknown' };
  }
}

export function processFailureDiagnostic(input: {
  operation: string;
  tool: string;
  version?: string;
  exitCode?: number | null;
  output: string;
  proxy?: string;
  sourceUrl?: string;
}): FailureDiagnostic {
  try {
    const evidence = extractDiagnosticEvidence(input.output);
    const proxyError = /(?:proxyerror|proxy connection|proxy server)/i.test(input.output);
    const reportedProxy = proxyError
      ? /\b(?:at|to)\s+(https?:\/\/[^\s)]+)/i.exec(input.output)?.[1]
      : undefined;
    const proxy = input.proxy?.trim() || reportedProxy;
    const route = proxyError || proxy ? 'proxy' : input.proxy === undefined ? 'unknown' : 'direct';
    const peer = proxyError ? 'proxy'
      : route === 'direct' && /(?:connection refused|econnrefused|\[errno (?:61|111)\])|(?:http error|status code:?)\s*[1-5]\d\d/i.test(input.output) ? 'platform'
        : 'unknown';
    const reason = evidence.find(item => ['connection_refused', 'connection_reset', 'dns_failed', 'timeout', 'tls_failed', 'network_unreachable'].includes(item));
    const platform = platformFromUrl(input.sourceUrl);
    return sanitizeFailureDiagnostic({
      version: 1,
      operation: input.operation,
      causes: [],
      process: {
        tool: input.tool,
        ...(input.version === undefined ? {} : { version: input.version }),
        ...(input.exitCode === null || input.exitCode === undefined ? {} : { exit_code: input.exitCode })
      },
      network: {
        route, peer,
        ...(route === 'proxy' && proxy ? proxyDetails(proxy) : {}),
        ...(platform === undefined ? {} : { platform }),
        ...(reason === undefined ? {} : { reason })
      },
      ...(evidence.length ? { evidence } : { missing: ['process_output_unrecognized'] }),
      ...(peer === 'unknown' ? { missing: [...(evidence.length ? [] : ['process_output_unrecognized']), 'network_peer_unknown'] } : {})
    }) ?? { version: 1, operation: 'unknown', causes: [], missing: ['process_output_unrecognized'] };
  } catch {
    return { version: 1, operation: 'unknown', causes: [], missing: ['process_output_unrecognized'] };
  }
}

export function attachFailureDiagnostic<T extends Error>(error: T, diagnostic: FailureDiagnostic): T {
  try {
    Object.defineProperty(error, 'failureDiagnostic', { value: diagnostic, configurable: true });
  } catch { /* Diagnostic metadata must not replace the original error. */ }
  return error;
}

export function failureDiagnosticFromError(error: unknown, operation: string): FailureDiagnostic | undefined {
  const causes: FailureDiagnostic['causes'] = [];
  let current = error;
  let attached: FailureDiagnostic | undefined;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && current instanceof Error && !seen.has(current); depth++) {
    seen.add(current);
    const code = safeIdentifier((current as Error & { code?: unknown }).code);
    causes.push({ name: safeIdentifier(current.name) ?? 'Error', ...(code === undefined ? {} : { code }) });
    attached ??= sanitizeFailureDiagnostic((current as Error & { failureDiagnostic?: unknown }).failureDiagnostic);
    current = current.cause;
  }
  if (!causes.length) return undefined;
  const frames = error instanceof Error ? (error.stack ?? '').split('\n').slice(1).flatMap(line => {
    const match = /((?:apps\/daemon\/src|packages\/protocol\/src)\/[A-Za-z0-9_./-]+\.(?:ts|js)):(\d+):\d+/.exec(line);
    return match && !match[1]!.split('/').includes('..') ? [`${match[1]}:${match[2]}`] : [];
  }).slice(0, 3) : [];
  return sanitizeFailureDiagnostic({
    version: 1,
    operation: attached?.operation ?? operation,
    causes,
    ...(attached?.steps === undefined ? {} : { steps: attached.steps }),
    ...(attached?.process === undefined ? {} : { process: attached.process }),
    ...(attached?.network === undefined ? {} : { network: attached.network }),
    ...(attached?.evidence === undefined ? {} : { evidence: attached.evidence }),
    ...(frames.length ? { frames } : {}),
    ...(attached?.missing === undefined ? {} : { missing: attached.missing })
  });
}

export function sanitizeFailureDiagnostic(value: unknown): FailureDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const input = value as Partial<FailureDiagnostic>;
  const operation = safeIdentifier(input.operation);
  if (input.version !== 1 || operation === undefined || !Array.isArray(input.causes)) return undefined;
  const causes = input.causes.slice(0, 3).flatMap(item => {
    const name = safeIdentifier(item?.name);
    const code = safeIdentifier(item?.code);
    return name ? [{ name, ...(code ? { code } : {}) }] : [];
  });
  const steps = Array.isArray(input.steps) ? input.steps.slice(0, 4).flatMap(item => {
    const step = safeIdentifier(item?.operation);
    const code = safeIdentifier(item?.code);
    return step && code && (item.result === 'fallback' || item.result === 'failed')
      ? [{ operation: step, code, result: item.result }] : [];
  }) : [];
  const tool = safeIdentifier(input.process?.tool);
  const version = safeIdentifier(input.process?.version);
  const exitCode = input.process?.exit_code;
  const process = tool ? { tool, ...(version ? { version } : {}),
    ...(Number.isInteger(exitCode) && exitCode! >= -255 && exitCode! <= 255 ? { exit_code: exitCode } : {}) } : undefined;
  const network = input.network && ['direct', 'proxy', 'unknown'].includes(input.network.route)
    && ['proxy', 'platform', 'gateway', 'unknown'].includes(input.network.peer) ? {
      route: input.network.route,
      peer: input.network.peer,
      ...(safeIdentifier(input.network.platform) ? { platform: input.network.platform } : {}),
      ...(['loopback', 'private', 'public', 'unknown'].includes(input.network.proxy_scope ?? '')
        ? { proxy_scope: input.network.proxy_scope } : {}),
      ...(Number.isInteger(input.network.proxy_port) && input.network.proxy_port! > 0 && input.network.proxy_port! <= 65535
        ? { proxy_port: input.network.proxy_port } : {}),
      ...(safeIdentifier(input.network.reason) ? { reason: input.network.reason } : {})
    } as FailureDiagnostic['network'] : undefined;
  const evidence = Array.isArray(input.evidence) ? input.evidence.slice(0, 12).filter(item => typeof item === 'string' && evidencePattern.test(item)) : [];
  const frames = Array.isArray(input.frames) ? input.frames.slice(0, 3).filter(item => typeof item === 'string'
    && /^(?:apps\/daemon\/src|packages\/protocol\/src)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:ts|js):\d{1,6}$/.test(item)) : [];
  const missing = Array.isArray(input.missing) ? input.missing.slice(0, 3).filter(item => missingValues.has(item)) : [];
  const diagnostic: FailureDiagnostic = {
    version: 1, operation, causes,
    ...(steps.length ? { steps } : {}),
    ...(process ? { process } : {}),
    ...(network ? { network } : {}),
    ...(evidence.length ? { evidence } : {}),
    ...(frames.length ? { frames } : {}),
    ...(missing.length ? { missing } : {})
  };
  return Buffer.byteLength(JSON.stringify(diagnostic), 'utf8') <= MAX_DIAGNOSTIC_BYTES ? diagnostic : undefined;
}
