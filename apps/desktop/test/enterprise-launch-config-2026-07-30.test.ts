import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveDesktopEnterpriseLaunchConfig
} from '../src/main/enterprise-launch-config-2026-07-30.js';

const runId = '123e4567-e89b-42d3-a456-426614174000';
const configPath = resolve('tmp', 'opencreator-enterprise-e2e', 'config.toml');

describe('Desktop enterprise launch configuration', () => {
  it('accepts only a matching packaged E2E launch gate', () => {
    expect(resolveDesktopEnterpriseLaunchConfig(
      [
        'OpenCreator',
        `--opencreator-enterprise-e2e=${runId}`,
        `--opencreator-enterprise-e2e-config=${configPath}`
      ],
      {
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID: runId
      }
    )).toEqual({
      enterpriseE2ERunId: runId,
      enterpriseE2EConfigPath: configPath
    });
  });

  it.each([
    {
      name: 'only environment signal',
      argv: ['OpenCreator'],
      env: {
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID: runId
      }
    },
    {
      name: 'only launch argument',
      argv: ['OpenCreator', `--opencreator-enterprise-e2e=${runId}`],
      env: {}
    },
    {
      name: 'mismatched UUIDs',
      argv: [
        'OpenCreator',
        `--opencreator-enterprise-e2e=${runId}`,
        `--opencreator-enterprise-e2e-config=${configPath}`
      ],
      env: {
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID:
          '223e4567-e89b-42d3-a456-426614174000'
      }
    },
    {
      name: 'invalid UUID',
      argv: [
        'OpenCreator',
        '--opencreator-enterprise-e2e=not-a-uuid',
        `--opencreator-enterprise-e2e-config=${configPath}`
      ],
      env: {
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID: 'not-a-uuid'
      }
    },
    {
      name: 'duplicate launch arguments',
      argv: [
        'OpenCreator',
        `--opencreator-enterprise-e2e=${runId}`,
        `--opencreator-enterprise-e2e=${runId}`,
        `--opencreator-enterprise-e2e-config=${configPath}`
      ],
      env: {
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID: runId
      }
    },
    {
      name: 'missing E2E config path',
      argv: ['OpenCreator', `--opencreator-enterprise-e2e=${runId}`],
      env: {
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID: runId
      }
    },
    {
      name: 'relative E2E config path',
      argv: [
        'OpenCreator',
        `--opencreator-enterprise-e2e=${runId}`,
        '--opencreator-enterprise-e2e-config=.opencreator/config.toml'
      ],
      env: {
        OPENCREATOR_ENTERPRISE_E2E_RUN_ID: runId
      }
    }
  ])('rejects $name before starting the Daemon', ({ argv, env }) => {
    expect(() => resolveDesktopEnterpriseLaunchConfig(argv, env)).toThrow(
      'ENTERPRISE_E2E_CONFIG_FORBIDDEN'
    );
  });

  it('does not add E2E identity during an ordinary launch', () => {
    expect(resolveDesktopEnterpriseLaunchConfig(
      ['OpenCreator'],
      {}
    )).toEqual({});
  });
});
