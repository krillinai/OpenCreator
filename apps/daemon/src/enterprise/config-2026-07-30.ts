export const DEFAULT_ENTERPRISE_ORIGIN = 'http://1.13.175.31:1904';
export const ENTERPRISE_JSON_TIMEOUT_MS = 15_000;
export const ENTERPRISE_DOWNLOAD_TIMEOUT_MS = 120_000;
export const ENTERPRISE_DOCUMENT_UPLOAD_TIMEOUT_MS = 5 * 60_000;
export const ENTERPRISE_PACKAGE_MAX_BYTES = 50 * 1024 * 1024;

export type EnterpriseOriginConfig = {
  origin: string;
  transportSecurity: 'insecure_http' | 'secure_https';
};

export function resolveEnterpriseOrigin(
  value = DEFAULT_ENTERPRISE_ORIGIN
): EnterpriseOriginConfig {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ENTERPRISE_ORIGIN_INVALID');
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== '' && url.pathname !== '/') ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error('ENTERPRISE_ORIGIN_INVALID');
  }

  return {
    origin: url.origin,
    transportSecurity: url.protocol === 'https:' ? 'secure_https' : 'insecure_http'
  };
}
