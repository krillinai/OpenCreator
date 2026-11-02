import { isPublicErrorFacts, publicErrorKindForCode, sanitizePublicErrorFacts, type PublicErrorFacts } from '@opencreator/protocol';

const ERROR_KINDS: Record<string, PublicErrorFacts['kind']> = {
  auth_required: 'unauthorized',
  services_not_ready: 'configuration',
  ERR_FS_FILE_TOO_LARGE: 'storage',
  EFBIG: 'storage',
  ENOTFOUND: 'dns',
  EAI_AGAIN: 'dns',
  ECONNREFUSED: 'connection-refused',
  ECONNRESET: 'connection-reset',
  EPIPE: 'connection-reset',
  ETIMEDOUT: 'timeout',
  UND_ERR_CONNECT_TIMEOUT: 'timeout',
  UND_ERR_HEADERS_TIMEOUT: 'timeout',
  UND_ERR_BODY_TIMEOUT: 'timeout',
  CERT_HAS_EXPIRED: 'tls',
  DEPTH_ZERO_SELF_SIGNED_CERT: 'tls',
  SELF_SIGNED_CERT_IN_CHAIN: 'tls',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'tls',
  ERR_TLS_CERT_ALTNAME_INVALID: 'tls'
};

export function publicFactsFromFailure(
  error: unknown,
  provider?: string,
  options: { timedOut?: boolean } = {}
): PublicErrorFacts {
  const supplied = findPublicFacts(error);
  if (supplied !== undefined) return supplied;
  const code = findKnownErrorCode(error);
  const kind = options.timedOut
    ? 'timeout'
    : code === undefined
      ? publicErrorKindForCode(errorCode(error) ?? '') ?? 'unknown'
      : ERROR_KINDS[code]!;
  return {
    kind,
    ...(provider === undefined ? {} : { provider }),
    ...(code === undefined ? {} : { upstreamCode: code })
  };
}

function errorCode(error: unknown): string | undefined {
  return error !== null && typeof error === 'object'
    && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : undefined;
}

function findPublicFacts(error: unknown): PublicErrorFacts | undefined {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const facts = (current as { publicFacts?: unknown }).publicFacts;
    if (facts !== null && typeof facts === 'object') {
      const sanitized = sanitizePublicErrorFacts(facts as PublicErrorFacts);
      if (isPublicErrorFacts(sanitized)) return sanitized;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export function publicFactsFromHttpResponse(
  status: number,
  provider?: string,
  upstreamCode?: string
): PublicErrorFacts {
  const kind: PublicErrorFacts['kind'] = status === 429
    ? 'rate-limited'
    : status === 401 || status === 403
      ? 'unauthorized'
      : status >= 500
        ? 'unavailable'
        : 'http-rejected';
  return {
    kind,
    httpStatus: status,
    ...(provider === undefined ? {} : { provider }),
    ...(upstreamCode === undefined ? {} : { upstreamCode })
  };
}

function findKnownErrorCode(error: unknown): string | undefined {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 4 && current !== null && typeof current === 'object'; depth += 1) {
    if (seen.has(current)) break;
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === 'string' && ERROR_KINDS[code] !== undefined) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
