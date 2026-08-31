import type { BuildServerInput } from './api/server.js';
import type {
  ScheduleBindingRepairResult,
  ScheduleCoordinator
} from './scheduler/coordinator.js';
import { readEnterpriseClientConfig } from './enterprise/client-config-2026-08-06.js';

const ENTERPRISE_CONFIG_ARGUMENT = '--opencreator-enterprise-config';
const ENTERPRISE_E2E_RUN_ID_ARGUMENT = '--opencreator-enterprise-e2e-run-id';
const ENTERPRISE_E2E_AUTHORIZED_ARGUMENT =
  '--opencreator-enterprise-e2e-authorized';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveProductionServerEnvironment(
  env: NodeJS.ProcessEnv = process.env
): Pick<
  BuildServerInput,
  | 'dataDir'
  | 'codexBin'
  | 'codexHome'
  | 'defaultCwd'
  | 'defaultProjectRoot'
  | 'creatorYtDlpPath'
> {
  assertEnterpriseEnvironmentUnused(env);
  return {
    ...optionalEnvironmentValue('dataDir', env.OPENCREATOR_DATA_DIR),
    ...optionalEnvironmentValue('codexBin', env.OPENCREATOR_CODEX_BIN),
    ...optionalEnvironmentValue(
      'codexHome',
      env.CODEX_HOME ?? env.OPENCREATOR_CODEX_HOME
    ),
    ...optionalEnvironmentValue('defaultCwd', env.OPENCREATOR_DEFAULT_CWD),
    ...optionalEnvironmentValue(
      'defaultProjectRoot',
      env.OPENCREATOR_DEFAULT_PROJECT_ROOT
    ),
    ...optionalEnvironmentValue(
      'creatorYtDlpPath',
      env.OPENCREATOR_YT_DLP_PATH
    )
  };
}

export function resolveEnterpriseStartupArguments(
  argv: readonly string[] = process.argv,
  readConfig: (path: string) => string = path =>
    readEnterpriseClientConfig(path).gateway
): Pick<
  BuildServerInput,
  'enterpriseConfigPath' | 'enterpriseOrigin' | 'enterpriseE2ERunId'
> {
  const configPath = singleArgumentValue(argv, ENTERPRISE_CONFIG_ARGUMENT);
  if (configPath === undefined) {
    throw new Error('ENTERPRISE_CONFIG_REQUIRED');
  }
  const enterpriseOrigin = readConfig(configPath);
  const runId = singleArgumentValue(argv, ENTERPRISE_E2E_RUN_ID_ARGUMENT);
  const authorized = singleArgumentValue(
    argv,
    ENTERPRISE_E2E_AUTHORIZED_ARGUMENT
  );
  const hasE2EConfiguration = runId !== undefined || authorized !== undefined;
  if (!hasE2EConfiguration) {
    return {
      enterpriseConfigPath: configPath,
      enterpriseOrigin
    };
  }
  if (
    runId === undefined
    || authorized !== 'packaged-app'
    || !UUID_PATTERN.test(runId)
    || !isLoopbackOrigin(enterpriseOrigin)
  ) {
    throw new Error('ENTERPRISE_E2E_CONFIG_FORBIDDEN');
  }
  return {
    enterpriseConfigPath: configPath,
    enterpriseOrigin,
    enterpriseE2ERunId: runId
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

function assertEnterpriseEnvironmentUnused(env: NodeJS.ProcessEnv): void {
  const forbiddenKeys = [
    'OPENCREATOR_ENTERPRISE_ORIGIN',
    'OPENCREATOR_ENTERPRISE_E2E_AUTHORIZED',
    'OPENCREATOR_ENTERPRISE_E2E_RUN_ID'
  ];
  if (forbiddenKeys.some(key => hasValue(env[key]))) {
    throw new Error('ENTERPRISE_ENV_CONFIG_FORBIDDEN');
  }
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

function singleArgumentValue(
  argv: readonly string[],
  name: string
): string | undefined {
  const matches = argv.filter(argument => (
    argument === name || argument.startsWith(`${name}=`)
  ));
  if (matches.length > 1 || matches[0] === name) {
    throw new Error(
      name === ENTERPRISE_CONFIG_ARGUMENT
        ? 'ENTERPRISE_CONFIG_INVALID'
        : 'ENTERPRISE_E2E_CONFIG_FORBIDDEN'
    );
  }
  if (matches.length === 0) return undefined;
  const value = normalizedValue(matches[0]!.slice(name.length + 1));
  if (value !== undefined) return value;
  throw new Error(
    name === ENTERPRISE_CONFIG_ARGUMENT
      ? 'ENTERPRISE_CONFIG_INVALID'
      : 'ENTERPRISE_E2E_CONFIG_FORBIDDEN'
  );
}

function normalizedValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? undefined
    : normalized;
}
