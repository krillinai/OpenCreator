import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  configureMacDirectorySigning,
  findDeveloperIdIdentity
} from '../scripts/mac-signing.mjs';

const identity =
  'Developer ID Application: Junxi YIN (NVRH5R5DJ5)';
const identities = () => (
  `  1) ABCDEF "${identity}"\n`
  + '     1 valid identities found\n'
);

describe('macOS directory signing', () => {
  it('keeps ordinary local packages ad-hoc without accessing a private key', () => {
    const result = configureMacDirectorySigning({
      platform: 'darwin',
      env: {},
      signed: false
    });

    expect(result.mode).toBe('adhoc');
    expect(result.args).toContain('--config.mac.identity=null');
    expect(result.args).toContain('--config.mac.notarize=false');
    expect(result.builderEnv.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false');
  });

  it('uses the configured Developer ID for an explicitly signed package', () => {
    const result = configureMacDirectorySigning({
      platform: 'darwin',
      env: {},
      signed: true,
      teamId: 'NVRH5R5DJ5',
      findIdentities: identities
    });

    expect(result).toMatchObject({
      mode: 'developer-id',
      teamId: 'NVRH5R5DJ5',
      identity
    });
    expect(result.args).toEqual(['--config.mac.notarize=false']);
    expect(result.builderEnv.CSC_NAME).toBe(
      'Junxi YIN (NVRH5R5DJ5)'
    );
  });

  it('does not implicitly access a configured signing certificate', () => {
    const result = configureMacDirectorySigning({
      platform: 'darwin',
      env: { CSC_NAME: identity },
      signed: false
    });

    expect(result.mode).toBe('adhoc');
    expect(result.builderEnv.CSC_NAME).toBe(identity);
  });

  it('rejects signed directory packaging outside macOS', () => {
    expect(() => configureMacDirectorySigning({
      platform: 'linux',
      env: {},
      signed: true
    })).toThrow(/only supported on macOS/i);
  });

  it('requires the expected Team identity', () => {
    expect(findDeveloperIdIdentity('NVRH5R5DJ5', identities)).toBe(identity);
    expect(() => findDeveloperIdIdentity('OTHERTEAM', identities)).toThrow(
      /Missing Developer ID Application identity/
    );
  });

  it('excludes manifest-pinned Runtime resources from full App signing', () => {
    const builderConfig = readFileSync(
      new URL('../electron-builder.yml', import.meta.url),
      'utf8'
    );

    expect(builderConfig).toContain(
      "'.*/Contents/Resources/(?!daemon/.*\\.node$).*'"
    );
  });
});
