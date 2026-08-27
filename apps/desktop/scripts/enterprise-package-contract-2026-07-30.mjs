import { readFileSync } from 'node:fs';
import { parse, stringify } from '@iarna/toml';

const ENTERPRISE_AGENT_ID_PATTERN =
  /^opencreator_[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertEnterpriseReleaseTransport(input) {
  const url = parseOrigin(input.origin);
  const transportSecurity =
    url.protocol === 'https:' ? 'secure_https' : 'insecure_http';
  if (input.mode !== 'dir' && transportSecurity !== 'secure_https') {
    throw new Error(
      `ENTERPRISE_RELEASE_REQUIRES_HTTPS: ${url.origin}`
    );
  }
  return {
    origin: url.origin,
    transportSecurity
  };
}

export function readEnterpriseGatewayPackageConfig(path, mode) {
  let parsed;
  try {
    parsed = parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`ENTERPRISE_CONFIG_INVALID: ${path}`);
  }
  if (
    parsed === null
    || typeof parsed !== 'object'
    || Array.isArray(parsed)
    || typeof parsed.gateway !== 'string'
    || Object.keys(parsed).some(key => (
      key !== 'gateway' && key !== 'agent_id'
    ))
    || (
      parsed.agent_id !== undefined
      && (
        typeof parsed.agent_id !== 'string'
        || !ENTERPRISE_AGENT_ID_PATTERN.test(parsed.agent_id)
      )
    )
  ) {
    throw new Error(`ENTERPRISE_CONFIG_INVALID: ${path}`);
  }
  const release = assertEnterpriseReleaseTransport({
    mode,
    origin: parsed.gateway.trim()
  });
  return {
    gateway: release.origin,
    transportSecurity: release.transportSecurity
  };
}

export function serializeEnterpriseGatewayPackageConfig(gateway) {
  return stringify({ gateway });
}

function parseOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ENTERPRISE_ORIGIN_INVALID');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0
    || url.password.length > 0
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new Error('ENTERPRISE_ORIGIN_INVALID');
  }
  return url;
}
