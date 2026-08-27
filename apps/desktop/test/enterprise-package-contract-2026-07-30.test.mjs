import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertEnterpriseReleaseTransport,
  readEnterpriseGatewayPackageConfig
} from '../scripts/enterprise-package-contract-2026-07-30.mjs';

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('Desktop enterprise package contract', () => {
  it('allows HTTP only for unpacked dir builds', () => {
    expect(assertEnterpriseReleaseTransport({
      mode: 'dir',
      origin: 'http://127.0.0.1:1904'
    })).toEqual({
      origin: 'http://127.0.0.1:1904',
      transportSecurity: 'insecure_http'
    });
    expect(() => assertEnterpriseReleaseTransport({
      mode: 'dist',
      origin: 'http://127.0.0.1:1904'
    })).toThrow('ENTERPRISE_RELEASE_REQUIRES_HTTPS');
    expect(() => assertEnterpriseReleaseTransport({
      mode: 'release',
      origin: 'http://enterprise.example'
    })).toThrow('ENTERPRISE_RELEASE_REQUIRES_HTTPS');
    expect(assertEnterpriseReleaseTransport({
      mode: 'release',
      origin: 'https://enterprise.example/'
    })).toEqual({
      origin: 'https://enterprise.example',
      transportSecurity: 'secure_https'
    });
  });

  it('reads gateway configuration without packaging the local agent id', () => {
    const root = mkdtempSync(join(tmpdir(), 'opencreator-gateway-contract-'));
    tempRoots.push(root);
    const path = join(root, 'gateway.json');
    writeFileSync(path, 'gateway = "https://enterprise.example/"\n');

    expect(readEnterpriseGatewayPackageConfig(path, 'release')).toEqual({
      gateway: 'https://enterprise.example',
      transportSecurity: 'secure_https'
    });

    writeFileSync(
      path,
      'gateway = "https://enterprise.example"\n'
      + 'agent_id = "opencreator_550e8400-e29b-41d4-a716-446655440000"\n'
    );
    expect(readEnterpriseGatewayPackageConfig(path, 'release')).toEqual({
      gateway: 'https://enterprise.example',
      transportSecurity: 'secure_https'
    });

    writeFileSync(
      path,
      'gateway = "https://enterprise.example"\nextra = true\n'
    );
    expect(() => readEnterpriseGatewayPackageConfig(path, 'release')).toThrow(
      'ENTERPRISE_CONFIG_INVALID'
    );

    writeFileSync(
      path,
      'gateway = "https://enterprise.example"\nagent_id = "invalid"\n'
    );
    expect(() => readEnterpriseGatewayPackageConfig(path, 'release')).toThrow(
      'ENTERPRISE_CONFIG_INVALID'
    );
  });
});
