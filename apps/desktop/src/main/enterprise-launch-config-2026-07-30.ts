const ENTERPRISE_E2E_ARGUMENT = '--clawee-enterprise-e2e';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type DesktopEnterpriseLaunchConfig = {
  enterpriseOrigin?: string;
  enterpriseE2ERunId?: string;
};

export function resolveDesktopEnterpriseLaunchConfig(
  argv: readonly string[],
  env: NodeJS.ProcessEnv
): DesktopEnterpriseLaunchConfig {
  const argumentValues = argv
    .filter(argument => (
      argument === ENTERPRISE_E2E_ARGUMENT
      || argument.startsWith(`${ENTERPRISE_E2E_ARGUMENT}=`)
    ))
    .map(argument => (
      argument === ENTERPRISE_E2E_ARGUMENT
        ? undefined
        : normalizedValue(argument.slice(ENTERPRISE_E2E_ARGUMENT.length + 1))
    ));
  const environmentRunId = normalizedValue(
    env.CLAWEE_ENTERPRISE_E2E_RUN_ID
  );
  const hasE2ESignal =
    argumentValues.length > 0 || environmentRunId !== undefined;
  const enterpriseOrigin = resolveEnterpriseOrigin(
    env.CLAWEE_ENTERPRISE_ORIGIN,
    hasE2ESignal
  );

  if (!hasE2ESignal) {
    return enterpriseOrigin === undefined ? {} : { enterpriseOrigin };
  }

  const argumentRunId = argumentValues[0];
  if (
    argumentValues.length !== 1
    || argumentRunId === undefined
    || environmentRunId === undefined
    || argumentRunId !== environmentRunId
    || !UUID_PATTERN.test(argumentRunId)
    || enterpriseOrigin === undefined
    || !isLoopbackOrigin(enterpriseOrigin)
  ) {
    throw new Error('ENTERPRISE_E2E_CONFIG_FORBIDDEN');
  }

  return {
    enterpriseOrigin,
    enterpriseE2ERunId: argumentRunId
  };
}

function resolveEnterpriseOrigin(
  value: string | undefined,
  e2eConfiguration: boolean
): string | undefined {
  const normalized = normalizedValue(value);
  if (normalized === undefined) return undefined;

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error(
      e2eConfiguration
        ? 'ENTERPRISE_E2E_CONFIG_FORBIDDEN'
        : 'ENTERPRISE_ORIGIN_INVALID'
    );
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0
    || url.password.length > 0
    || (url.pathname !== '' && url.pathname !== '/')
    || url.search.length > 0
    || url.hash.length > 0
  ) {
    throw new Error(
      e2eConfiguration
        ? 'ENTERPRISE_E2E_CONFIG_FORBIDDEN'
        : 'ENTERPRISE_ORIGIN_INVALID'
    );
  }
  return url.origin;
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase();
  return (
    hostname === '127.0.0.1'
    || hostname === 'localhost'
    || hostname === '[::1]'
    || hostname === '::1'
  );
}

function normalizedValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
