import type { BuildServerInput } from './api/server.js';
import type {
  ScheduleBindingRepairResult,
  ScheduleCoordinator
} from './scheduler/coordinator.js';
import { resolveEnterpriseOrigin } from './enterprise/config-2026-07-30.js';
import { resolveEnterpriseCredentialIdentity } from './enterprise/credential-store-2026-07-30.js';

export function resolveProductionServerEnvironment(
  env: NodeJS.ProcessEnv = process.env
): Pick<
  BuildServerInput,
  | 'dataDir'
  | 'codexBin'
  | 'codexHome'
  | 'defaultCwd'
  | 'defaultProjectRoot'
  | 'enterpriseOrigin'
  | 'enterpriseE2ERunId'
> {
  const enterprise = resolveEnterpriseEnvironment(env);
  return {
    ...optionalEnvironmentValue('dataDir', env.CLAWEE_DATA_DIR),
    ...optionalEnvironmentValue('codexBin', env.CLAWEE_CODEX_BIN),
    ...optionalEnvironmentValue(
      'codexHome',
      env.CODEX_HOME ?? env.CLAWEE_CODEX_HOME
    ),
    ...optionalEnvironmentValue('defaultCwd', env.CLAWEE_DEFAULT_CWD),
    ...optionalEnvironmentValue(
      'defaultProjectRoot',
      env.CLAWEE_DEFAULT_PROJECT_ROOT
    ),
    ...enterprise
  };
}

export function createProductionServerInput(
  input: Omit<BuildServerInput, 'schedulerAutostart'>
): BuildServerInput {
  return {
    ...input,
    schedulerAutostart: true,
    agentToolsEnabled: true,
    persistentAppServerEnabled: input.persistentAppServerEnabled ?? true
  };
}

export function prepareSchedulerStartup(input: {
  coordinator: Pick<ScheduleCoordinator, 'ensureBindings'>;
  classifySessions?(): void;
}): ScheduleBindingRepairResult {
  const result = input.coordinator.ensureBindings();
  input.classifySessions?.();
  return result;
}

function optionalEnvironmentValue<Key extends keyof BuildServerInput>(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? {}
    : { [key]: normalized } as Record<Key, string>;
}

function resolveEnterpriseEnvironment(
  env: NodeJS.ProcessEnv
): Pick<BuildServerInput, 'enterpriseOrigin' | 'enterpriseE2ERunId'> {
  if (
    hasValue(env.CLAWEE_ENTERPRISE_KEYRING_SERVICE) ||
    hasValue(env.CLAWEE_ENTERPRISE_KEYRING_ACCOUNT)
  ) {
    throw new Error('ENTERPRISE_E2E_CONFIG_FORBIDDEN');
  }

  const originValue = normalizedValue(env.CLAWEE_ENTERPRISE_ORIGIN);
  const authorized = normalizedValue(env.CLAWEE_ENTERPRISE_E2E_AUTHORIZED);
  const runId = normalizedValue(env.CLAWEE_ENTERPRISE_E2E_RUN_ID);
  const hasE2EConfiguration = authorized !== undefined || runId !== undefined;

  let enterpriseOrigin: string | undefined;
  if (originValue !== undefined) {
    try {
      enterpriseOrigin = resolveEnterpriseOrigin(originValue).origin;
    } catch {
      if (hasE2EConfiguration) {
        throw new Error('ENTERPRISE_E2E_CONFIG_FORBIDDEN');
      }
      throw new Error('ENTERPRISE_ORIGIN_INVALID');
    }
  }

  if (!hasE2EConfiguration) {
    return enterpriseOrigin === undefined ? {} : { enterpriseOrigin };
  }
  if (
    authorized !== 'packaged-app' ||
    runId === undefined ||
    enterpriseOrigin === undefined ||
    !isLoopbackOrigin(enterpriseOrigin)
  ) {
    throw new Error('ENTERPRISE_E2E_CONFIG_FORBIDDEN');
  }
  try {
    resolveEnterpriseCredentialIdentity(runId);
  } catch {
    throw new Error('ENTERPRISE_E2E_CONFIG_FORBIDDEN');
  }

  return {
    enterpriseOrigin,
    enterpriseE2ERunId: runId
  };
}

function isLoopbackOrigin(origin: string): boolean {
  const hostname = new URL(origin).hostname.toLowerCase();
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1'
  );
}

function hasValue(value: string | undefined): boolean {
  return normalizedValue(value) !== undefined;
}

function normalizedValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
