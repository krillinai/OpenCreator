const MAX_ID_BYTES = 512;

export function deepLinkToRoute(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'opencreator:') return undefined;

  const rawSegments = [url.hostname, ...url.pathname.split('/')]
    .filter(segment => segment.length > 0);
  const segments: string[] = [];
  for (const segment of rawSegments) {
    const decoded = strictDecode(segment);
    if (decoded === undefined) return undefined;
    segments.push(decoded);
  }
  const queryValues = parseStrictQuery(url.search);
  if (queryValues === undefined) return undefined;

  if (segments[0] === 'new' && segments.length === 1) return '#/';
  if (segments[0] === 'tasks' && segments.length === 1) return '#/tasks';
  if (segments[0] !== 'thread' || segments.length !== 2) return undefined;
  const threadId = validateId(segments[1]);
  if (threadId === undefined) return undefined;

  const query = new URLSearchParams();
  const runId = optionalValidatedId(queryValues.get('runId'));
  const approvalId = optionalValidatedId(queryValues.get('approvalId'));
  if (runId === false || approvalId === false) return undefined;
  if (typeof runId === 'string') query.set('runId', runId);
  if (typeof approvalId === 'string') query.set('approvalId', approvalId);
  const suffix = query.toString();
  const route = `#/thread/${encodeURIComponent(threadId)}`;
  return suffix.length === 0 ? route : `${route}?${suffix}`;
}

export function findDeepLink(argv: string[]): string | undefined {
  return argv.find(value => value.startsWith('opencreator://'));
}

function optionalValidatedId(
  value: string | undefined
): string | undefined | false {
  if (value === undefined) return undefined;
  return validateId(value) ?? false;
}

function validateId(value: string | undefined): string | undefined {
  if (
    value === undefined
    || value.length === 0
    || Buffer.byteLength(value, 'utf8') > MAX_ID_BYTES
    || /[\u0000-\u001f\u007f\ufffd]/.test(value)
  ) {
    return undefined;
  }
  return value;
}

function parseStrictQuery(search: string): Map<string, string> | undefined {
  const values = new Map<string, string>();
  if (search.length <= 1) return values;
  for (const pair of search.slice(1).split('&')) {
    const separator = pair.indexOf('=');
    const rawKey = separator < 0 ? pair : pair.slice(0, separator);
    const rawValue = separator < 0 ? '' : pair.slice(separator + 1);
    const key = strictDecode(rawKey.replace(/\+/g, ' '));
    const value = strictDecode(rawValue.replace(/\+/g, ' '));
    if (key === undefined || value === undefined) return undefined;
    values.set(key, value);
  }
  return values;
}

function strictDecode(value: string): string | undefined {
  if (/%(?![0-9a-f]{2})/i.test(value)) return undefined;
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes('\ufffd') ? undefined : decoded;
  } catch {
    return undefined;
  }
}
