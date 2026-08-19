import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  prepareEnterpriseUserConfig
} from '../src/main/enterprise-user-config-2026-08-06.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('Desktop enterprise user config', () => {
  it('copies the bundled config to the user directory on first launch', () => {
    const fixture = createFixture('gateway = "https://gateway.example"\n');
    const prepared = prepareEnterpriseUserConfig(fixture);

    expect(prepared).toEqual({
      path: fixture.userPath
    });
    expect(readFileSync(fixture.userPath, 'utf8')).toBe(
      'gateway = "https://gateway.example"\n'
    );
  });

  it('preserves config modified after installation', () => {
    const fixture = createFixture('gateway = "https://bundled.example"\n');
    mkdirSync(join(fixture.root, '.opencreator'), { recursive: true });
    writeFileSync(
      fixture.userPath,
      'gateway = "https://customer.example"\nagent_id = "opencreator_existing"\n'
    );

    expect(prepareEnterpriseUserConfig(fixture)).toEqual({
      path: fixture.userPath
    });
    expect(readFileSync(fixture.userPath, 'utf8')).toBe(
      'gateway = "https://customer.example"\nagent_id = "opencreator_existing"\n'
    );
  });
});

function createFixture(contents: string) {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-enterprise-gateway-'));
  tempRoots.push(root);
  const bundledPath = join(root, 'bundled.toml');
  const userPath = join(root, '.opencreator', 'config.toml');
  writeFileSync(bundledPath, contents);
  return { root, bundledPath, userPath };
}
