import { describe, expect, it } from 'vitest';
import {
  resolveDesktopEnterpriseLaunchConfig
} from '../src/main/enterprise-launch-config-2026-07-30.js';

const runId = '123e4567-e89b-42d3-a456-426614174000';

describe('Desktop enterprise launch configuration', () => {
  it('accepts only a matching packaged E2E launch gate on a loopback origin', () => {
    expect(resolveDesktopEnterpriseLaunchConfig(
      ['Clawee', `--clawee-enterprise-e2e=${runId}`],
      {
        CLAWEE_ENTERPRISE_E2E_RUN_ID: runId,
        CLAWEE_ENTERPRISE_ORIGIN: 'http://127.0.0.1:1904'
      }
    )).toEqual({
      enterpriseOrigin: 'http://127.0.0.1:1904',
      enterpriseE2ERunId: runId
    });
  });

  it.each([
    {
      name: 'only environment signal',
      argv: ['Clawee'],
      env: {
        CLAWEE_ENTERPRISE_E2E_RUN_ID: runId,
        CLAWEE_ENTERPRISE_ORIGIN: 'http://127.0.0.1:1904'
      }
    },
    {
      name: 'only launch argument',
      argv: ['Clawee', `--clawee-enterprise-e2e=${runId}`],
      env: {
        CLAWEE_ENTERPRISE_ORIGIN: 'http://127.0.0.1:1904'
      }
    },
    {
      name: 'mismatched UUIDs',
      argv: ['Clawee', `--clawee-enterprise-e2e=${runId}`],
      env: {
        CLAWEE_ENTERPRISE_E2E_RUN_ID:
          '223e4567-e89b-42d3-a456-426614174000',
        CLAWEE_ENTERPRISE_ORIGIN: 'http://127.0.0.1:1904'
      }
    },
    {
      name: 'invalid UUID',
      argv: ['Clawee', '--clawee-enterprise-e2e=not-a-uuid'],
      env: {
        CLAWEE_ENTERPRISE_E2E_RUN_ID: 'not-a-uuid',
        CLAWEE_ENTERPRISE_ORIGIN: 'http://127.0.0.1:1904'
      }
    },
    {
      name: 'non-loopback origin',
      argv: ['Clawee', `--clawee-enterprise-e2e=${runId}`],
      env: {
        CLAWEE_ENTERPRISE_E2E_RUN_ID: runId,
        CLAWEE_ENTERPRISE_ORIGIN: 'https://enterprise.example'
      }
    },
    {
      name: 'duplicate launch arguments',
      argv: [
        'Clawee',
        `--clawee-enterprise-e2e=${runId}`,
        `--clawee-enterprise-e2e=${runId}`
      ],
      env: {
        CLAWEE_ENTERPRISE_E2E_RUN_ID: runId,
        CLAWEE_ENTERPRISE_ORIGIN: 'http://localhost:1904'
      }
    }
  ])('rejects $name before starting the Daemon', ({ argv, env }) => {
    expect(() => resolveDesktopEnterpriseLaunchConfig(argv, env)).toThrow(
      'ENTERPRISE_E2E_CONFIG_FORBIDDEN'
    );
  });

  it('normalizes an ordinary enterprise origin without enabling E2E identity', () => {
    expect(resolveDesktopEnterpriseLaunchConfig(['Clawee'], {
      CLAWEE_ENTERPRISE_ORIGIN: 'https://enterprise.example/'
    })).toEqual({
      enterpriseOrigin: 'https://enterprise.example'
    });
    expect(resolveDesktopEnterpriseLaunchConfig(['Clawee'], {})).toEqual({});
  });
});
