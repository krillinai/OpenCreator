import type { BuildServerInput } from './api/server.js';
import type {
  ScheduleBindingRepairResult,
  ScheduleCoordinator
} from './scheduler/coordinator.js';

export function resolveProductionServerEnvironment(
  env: NodeJS.ProcessEnv = process.env
): Pick<BuildServerInput, 'dataDir' | 'codexBin' | 'codexHome' | 'defaultCwd'> {
  return {
    ...optionalEnvironmentValue('dataDir', env.CLAWEE_DATA_DIR),
    ...optionalEnvironmentValue('codexBin', env.CLAWEE_CODEX_BIN),
    ...optionalEnvironmentValue(
      'codexHome',
      env.CODEX_HOME ?? env.CLAWEE_CODEX_HOME
    ),
    ...optionalEnvironmentValue('defaultCwd', env.CLAWEE_DEFAULT_CWD)
  };
}

export function createProductionServerInput(
  input: Omit<BuildServerInput, 'schedulerAutostart'>
): BuildServerInput {
  return {
    ...input,
    schedulerAutostart: true,
    agentToolsEnabled: true
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

function optionalEnvironmentValue<
  Key extends 'dataDir' | 'codexBin' | 'codexHome' | 'defaultCwd'
>(
  key: Key,
  value: string | undefined
): Partial<Record<Key, string>> {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0
    ? {}
    : { [key]: normalized } as Record<Key, string>;
}
