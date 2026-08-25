import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CodexResolutionError,
  resolveCodexEnvironment,
  validateManualCodexPath
} from '../src/main/codex-resolver.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Desktop Codex resolver', () => {
  it('uses the bundled absolute binary and isolated Home by default', async () => {
    const fixture = createBundledFixture();
    const pathCodex = join(tempDir, 'path', executableName());
    mkdirSync(dirname(pathCodex), { recursive: true });
    writeFileSync(pathCodex, 'different-codex');

    const result = await resolveCodexEnvironment({
      runtimeRoot: fixture.runtimeRoot,
      userDataDir: fixture.userDataDir,
      processEnv: { PATH: dirname(pathCodex), CODEX_HOME: join(tempDir, 'global-home') }
    });

    expect(result).toMatchObject({
      codexBin: fixture.binary,
      codexHome: join(fixture.userDataDir, 'runtime', 'codex', 'home'),
      source: 'bundled',
      version: '0.149.0',
      commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0'
    });
    expect(result?.env.PATH).toBe(dirname(pathCodex));
    expect(result?.env.CODEX_HOME).not.toBe(join(tempDir, 'global-home'));
  });

  it('does not fall back to PATH when the bundled binary is missing or tampered', async () => {
    let fixture = createBundledFixture();
    rmSync(fixture.binary);
    await expect(resolveCodexEnvironment({
      runtimeRoot: fixture.runtimeRoot,
      userDataDir: fixture.userDataDir,
      processEnv: { PATH: join(tempDir, 'path-with-codex') }
    })).rejects.toMatchObject({ code: 'codex_runtime_missing' });

    fixture = createBundledFixture();
    writeFileSync(fixture.binary, 'tampered');
    await expect(resolveCodexEnvironment({
      runtimeRoot: fixture.runtimeRoot,
      userDataDir: fixture.userDataDir,
      processEnv: { PATH: join(tempDir, 'path-with-codex') }
    })).rejects.toMatchObject({ code: 'codex_runtime_hash_mismatch' });
  });

  it('requires an explicit external mode path and separates its Home', async () => {
    createBundledFixture();
    const external = join(tempDir, executableName());
    writeFileSync(external, 'external-codex');

    const result = await resolveCodexEnvironment({
      mode: 'external',
      externalCodexBin: external,
      userDataDir: join(tempDir, 'user-data'),
      probeVersion: () => 'codex-cli 0.149.0'
    });

    expect(result).toMatchObject({
      source: 'external',
      codexBin: external,
      codexHome: join(tempDir, 'user-data', 'runtime', 'codex', 'external-home')
    });
  });

  it('rejects an incompatible external version', async () => {
    createBundledFixture();
    const external = join(tempDir, executableName());
    writeFileSync(external, 'external-codex');

    await expect(resolveCodexEnvironment({
      mode: 'external',
      externalCodexBin: external,
      userDataDir: join(tempDir, 'user-data'),
      probeVersion: () => 'codex-cli 0.148.0'
    })).rejects.toMatchObject({ code: 'codex_runtime_version_mismatch' });
  });

  it('accepts only an explicit native Codex file for external mode', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const executable = join(tempDir, executableName());
    const wrapper = join(tempDir, process.platform === 'win32' ? 'codex.cmd' : 'codex-wrapper');
    writeFileSync(executable, 'codex');
    writeFileSync(wrapper, 'wrapper');

    expect(validateManualCodexPath(executable)).toBe(executable);
    expect(validateManualCodexPath(wrapper)).toBeUndefined();
    expect(validateManualCodexPath(tempDir)).toBeUndefined();
  });

  it('returns structured diagnostics for manifest version mismatch', async () => {
    const fixture = createBundledFixture();
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8'));
    manifest.version = '0.148.0';
    writeFileSync(fixture.manifestPath, JSON.stringify(manifest));
    let captured: unknown;

    await expect(resolveCodexEnvironment({
      runtimeRoot: fixture.runtimeRoot,
      userDataDir: fixture.userDataDir,
      onDiagnostics: value => { captured = value; }
    })).rejects.toBeInstanceOf(CodexResolutionError);
    expect(captured).toMatchObject({
      mode: 'bundled',
      errorCode: 'codex_runtime_version_mismatch'
    });
  });
});

function createBundledFixture() {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
  const runtimeRoot = join(tempDir, 'codex-runtime');
  const userDataDir = join(tempDir, 'user-data');
  const binary = join(runtimeRoot, 'bin', executableName());
  const manifestPath = join(runtimeRoot, 'manifest.json');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, 'codex-0.149.0');
  writeFileSync(manifestPath, JSON.stringify({
    version: '0.149.0',
    commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
    platform: process.platform,
    arch: process.arch,
    binary: {
      relativePath: `bin/${executableName()}`,
      sha256: createHash('sha256').update(readFileSync(binary)).digest('hex')
    }
  }));
  return { runtimeRoot, userDataDir, binary, manifestPath };
}

function executableName() {
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}
