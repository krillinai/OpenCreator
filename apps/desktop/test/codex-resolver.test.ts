import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseWindowsWhereOutput,
  parseEnvironmentOutput,
  resolveCodexEnvironment as resolveProductionCodexEnvironment,
  validateManualCodexPath
} from '../src/main/codex-resolver.js';

let tempDir = '';
const resolveCodexEnvironment = (
  input: Parameters<typeof resolveProductionCodexEnvironment>[0] = {}
) => resolveProductionCodexEnvironment({
  ...input,
  applicationRoots: input.applicationRoots
    ?? (input.homeDir === undefined ? [] : [join(input.homeDir, 'Applications')])
});

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Desktop Codex resolver', () => {
  it('parses only the environment enclosed by fixed markers', () => {
    const output = [
      'shell noise',
      '\0__OPENCREATOR_ENV_START__',
      '\0PATH=/custom/bin',
      '\0CODEX_HOME=/custom/codex',
      '\0__OPENCREATOR_ENV_END__',
      '\0more noise'
    ].join('');
    expect(parseEnvironmentOutput(output)).toEqual({
      PATH: '/custom/bin',
      CODEX_HOME: '/custom/codex'
    });
  });

  it('prefers a valid saved executable and resolves CODEX_HOME', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const bin = join(tempDir, 'codex');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);

    const result = await resolveCodexEnvironment({
      savedCodexBin: bin,
      processEnv: {
        PATH: '',
        CODEX_HOME: join(tempDir, 'codex-home'),
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: bin,
      codexHome: join(tempDir, 'codex-home'),
      source: 'saved'
    });
  });

  it('rejects a non-executable manual path', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const bin = join(tempDir, 'codex');
    writeFileSync(bin, 'not executable');
    expect(validateManualCodexPath(bin, { homeDir: tempDir, platform: 'darwin' }))
      .toBeUndefined();
  });

  it('resolves Codex bundled inside a manually selected ChatGPT app', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const app = join(tempDir, 'ChatGPT.app');
    const bin = join(app, 'Contents', 'Resources', 'codex');
    mkdirSync(join(bin, '..'), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);

    expect(validateManualCodexPath(app, { homeDir: tempDir, platform: 'darwin' }))
      .toBe(bin);
  });

  it('resolves Codex bundled inside a manually selected Codex app', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const app = join(tempDir, 'Codex.app');
    const bin = join(app, 'Contents', 'Resources', 'codex');
    mkdirSync(join(bin, '..'), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);

    expect(validateManualCodexPath(app, { homeDir: tempDir, platform: 'darwin' }))
      .toBe(bin);
  });

  it('rejects a manually selected app whose bundled Codex is not executable', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const app = join(tempDir, 'ChatGPT.app');
    const bin = join(app, 'Contents', 'Resources', 'codex');
    mkdirSync(join(bin, '..'), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');

    expect(validateManualCodexPath(app, { homeDir: tempDir, platform: 'darwin' }))
      .toBeUndefined();
  });

  it('parses absolute Codex candidates from where.exe output', () => {
    expect(parseWindowsWhereOutput([
      'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
      'relative\\codex.cmd',
      '',
      'D:\\Tools\\codex.exe'
    ].join('\r\n'))).toEqual([
      'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.cmd',
      'D:\\Tools\\codex.exe'
    ]);
  });

  it('resolves a Windows .cmd candidate returned by where.exe', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const bin = join(tempDir, 'codex.cmd');
    writeFileSync(bin, '@echo off\r\n');

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '',
        PATHEXT: '.EXE;.CMD;.BAT',
        CODEX_HOME: join(tempDir, 'codex-home')
      },
      homeDir: tempDir,
      platform: 'win32',
      windowsWhereCandidates: [bin]
    });

    expect(result).toMatchObject({
      codexBin: bin,
      source: 'process_path'
    });
  });

  it('returns a valid saved candidate without waiting for a slow login shell', async () => {
    if (process.platform === 'win32') return;
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const bin = join(tempDir, 'codex');
    const pidPath = join(tempDir, 'shell.pid');
    const slowShell = join(tempDir, 'slow-shell');
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    writeFileSync(slowShell, [
      '#!/bin/sh',
      `printf '%s' "$$" > ${JSON.stringify(pidPath)}`,
      "trap '' TERM",
      'sleep 10'
    ].join('\n'));
    chmodSync(bin, 0o755);
    chmodSync(slowShell, 0o755);
    const startedAt = Date.now();

    const result = await resolveCodexEnvironment({
      successfulCodexBin: bin,
      processEnv: {
        PATH: '',
        SHELL: slowShell,
        CODEX_HOME: join(tempDir, 'codex-home')
      },
      homeDir: tempDir,
      shellTimeoutMs: 5_000,
      fastCandidateShellTimeoutMs: 50
    });

    expect(result?.codexBin).toBe(bin);
    expect(Date.now() - startedAt).toBeLessThan(4_000);
    if (existsSync(pidPath)) {
      const pid = Number(readFileSync(pidPath, 'utf8'));
      expect(isProcessAlive(pid)).toBe(false);
    }
  });

  it('loads interactive shell configuration when resolving Codex', async () => {
    if (process.platform === 'win32') return;
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const binDir = join(tempDir, 'version manager', 'bin');
    const bin = join(binDir, 'codex');
    const shell = join(tempDir, 'interactive-shell');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    writeFileSync(shell, [
      '#!/bin/sh',
      'interactive=0',
      'command=',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -i|--interactive) interactive=1 ;;',
      '    -c|--command) shift; command="$1" ;;',
      '  esac',
      '  shift',
      'done',
      '[ "$interactive" = 1 ] || exit 42',
      'export PATH="$OPENCREATOR_TEST_CODEX_DIR:/usr/bin:/bin"',
      'exec /bin/sh -c "$command"'
    ].join('\n'));
    chmodSync(bin, 0o755);
    chmodSync(shell, 0o755);

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: shell,
        OPENCREATOR_TEST_CODEX_DIR: binDir
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 3_000
    });

    expect(result).toMatchObject({
      codexBin: bin,
      source: 'login_shell'
    });
  });

  it('finds Codex installed under an nvm-managed Node version', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const binDir = join(
      tempDir,
      '.nvm',
      'versions',
      'node',
      'v22.14.0',
      'bin'
    );
    const bin = join(binDir, 'codex');
    const nodeBin = join(binDir, 'node');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(bin, '#!/usr/bin/env node\n');
    writeFileSync(nodeBin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);
    chmodSync(nodeBin, 0o755);

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: bin,
      source: 'common_path'
    });
    expect(result?.env.PATH?.split(':')[0]).toBe(binDir);
  });

  it('honors CODEX_BIN and an explicit npm global prefix outside PATH', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const configuredBin = join(tempDir, 'configured', 'codex');
    const npmPrefixBin = join(tempDir, 'npm-prefix', 'bin', 'codex');
    mkdirSync(join(configuredBin, '..'), { recursive: true });
    mkdirSync(join(npmPrefixBin, '..'), { recursive: true });
    writeFileSync(configuredBin, '#!/bin/sh\nexit 0\n');
    writeFileSync(npmPrefixBin, '#!/bin/sh\nexit 0\n');
    chmodSync(configuredBin, 0o755);
    chmodSync(npmPrefixBin, 0o755);

    const configured = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/false',
        CODEX_BIN: configuredBin,
        NPM_CONFIG_PREFIX: join(tempDir, 'npm-prefix')
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });
    expect(configured).toMatchObject({
      codexBin: configuredBin,
      source: 'manual'
    });

    const npmPrefix = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/false',
        NPM_CONFIG_PREFIX: join(tempDir, 'npm-prefix')
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });
    expect(npmPrefix).toMatchObject({
      codexBin: npmPrefixBin,
      source: 'common_path'
    });
  });

  it('launches the native Codex binary behind an npm wrapper', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const prefix = join(tempDir, 'node-prefix');
    const publicBinDir = join(prefix, 'bin');
    const wrapper = join(publicBinDir, 'codex');
    const packageRoot = join(
      prefix,
      'lib',
      'node_modules',
      '@openai',
      'codex'
    );
    const wrapperTarget = join(packageRoot, 'bin', 'codex.js');
    const nativePackage = join(
      packageRoot,
      'node_modules',
      '@openai',
      'codex-darwin-arm64'
    );
    const nativeBin = join(
      nativePackage,
      'vendor',
      'aarch64-apple-darwin',
      'codex',
      'codex'
    );
    const vendorPath = join(
      nativePackage,
      'vendor',
      'aarch64-apple-darwin',
      'path'
    );
    mkdirSync(publicBinDir, { recursive: true });
    mkdirSync(join(wrapperTarget, '..'), { recursive: true });
    mkdirSync(join(nativeBin, '..'), { recursive: true });
    mkdirSync(vendorPath, { recursive: true });
    writeFileSync(wrapperTarget, '#!/usr/bin/env node\n');
    writeFileSync(nativeBin, '#!/bin/sh\nexit 0\n');
    chmodSync(wrapperTarget, 0o755);
    chmodSync(nativeBin, 0o755);
    symlinkSync('../lib/node_modules/@openai/codex/bin/codex.js', wrapper);

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: publicBinDir,
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      arch: 'arm64',
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: realpathSync(nativeBin),
      source: 'process_path'
    });
    expect(result?.env.PATH?.split(':')).toEqual(expect.arrayContaining([
      publicBinDir,
      realpathSync(vendorPath),
      join(realpathSync(nativeBin), '..')
    ]));
  });

  it('prefers the newest semantic Node version when PATH is minimal', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const oldBinDir = join(tempDir, '.nvm', 'versions', 'node', 'v9.9.0', 'bin');
    const newBinDir = join(tempDir, '.nvm', 'versions', 'node', 'v22.14.0', 'bin');
    mkdirSync(oldBinDir, { recursive: true });
    mkdirSync(newBinDir, { recursive: true });
    for (const binDir of [oldBinDir, newBinDir]) {
      const bin = join(binDir, 'codex');
      writeFileSync(bin, '#!/bin/sh\nexit 0\n');
      chmodSync(bin, 0o755);
    }

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result?.codexBin).toBe(join(newBinDir, 'codex'));
  });

  it('finds the Codex CLI bundled inside the ChatGPT macOS app', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const bin = join(
      tempDir,
      'Applications',
      'ChatGPT.app',
      'Contents',
      'Resources',
      'codex'
    );
    mkdirSync(join(bin, '..'), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: bin,
      source: 'application_bundle'
    });
  });

  it('prefers the unified ChatGPT app over a runnable CLI in common paths', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const commonBin = join(tempDir, '.local', 'bin', 'codex');
    const chatGptBin = join(
      tempDir,
      'Applications',
      'ChatGPT.app',
      'Contents',
      'Resources',
      'codex'
    );
    mkdirSync(join(commonBin, '..'), { recursive: true });
    mkdirSync(join(chatGptBin, '..'), { recursive: true });
    writeFileSync(commonBin, '#!/bin/sh\nexit 0\n');
    writeFileSync(chatGptBin, '#!/bin/sh\nexit 0\n');
    chmodSync(commonBin, 0o755);
    chmodSync(chatGptBin, 0o755);

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: chatGptBin,
      source: 'application_bundle'
    });
  });

  it('prefers ChatGPT.app over the legacy Codex.app bundle', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const chatGptBin = join(
      tempDir,
      'Applications',
      'ChatGPT.app',
      'Contents',
      'Resources',
      'codex'
    );
    const legacyCodexBin = join(
      tempDir,
      'Applications',
      'Codex.app',
      'Contents',
      'Resources',
      'codex'
    );
    for (const bin of [chatGptBin, legacyCodexBin]) {
      mkdirSync(join(bin, '..'), { recursive: true });
      writeFileSync(bin, '#!/bin/sh\nexit 0\n');
      chmodSync(bin, 0o755);
    }

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: chatGptBin,
      source: 'application_bundle'
    });
  });

  it('discovers Codex inside a renamed macOS application bundle', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const bin = join(
      tempDir,
      'Applications',
      'OpenAI Desktop.app',
      'Contents',
      'Resources',
      'codex'
    );
    mkdirSync(join(bin, '..'), { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: bin,
      source: 'application_bundle'
    });
  });

  it('skips a stale executable wrapper and falls back to the ChatGPT app Codex', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const staleBin = join(tempDir, '.local', 'bin', 'codex');
    const chatGptBin = join(
      tempDir,
      'Applications',
      'ChatGPT.app',
      'Contents',
      'Resources',
      'codex'
    );
    mkdirSync(join(staleBin, '..'), { recursive: true });
    mkdirSync(join(chatGptBin, '..'), { recursive: true });
    writeFileSync(staleBin, [
      '#!/bin/sh',
      `exec ${JSON.stringify(join(
        tempDir,
        'Desktop',
        'Codex.app',
        'Contents',
        'Resources',
        'codex'
      ))} "$@"`
    ].join('\n'));
    writeFileSync(chatGptBin, '#!/bin/sh\nexit 0\n');
    chmodSync(staleBin, 0o755);
    chmodSync(chatGptBin, 0o755);

    const result = await resolveCodexEnvironment({
      successfulCodexBin: staleBin,
      savedCodexBin: staleBin,
      processEnv: {
        PATH: `${join(tempDir, '.local', 'bin')}:/usr/bin:/bin`,
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: chatGptBin,
      source: 'application_bundle'
    });
  });

  it('keeps searching after a saved Codex path becomes invalid', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const binDir = join(tempDir, 'path with spaces');
    const bin = join(binDir, 'codex');
    mkdirSync(binDir, { recursive: true });
    writeFileSync(bin, '#!/bin/sh\nexit 0\n');
    chmodSync(bin, 0o755);

    const result = await resolveCodexEnvironment({
      savedCodexBin: join(tempDir, 'removed', 'codex'),
      processEnv: {
        PATH: `${binDir}:/usr/bin:/bin`,
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result).toMatchObject({
      codexBin: bin,
      source: 'process_path'
    });
  });

  it('adds intermediate symlink directories so Codex can find its Node runtime', async () => {
    if (process.platform === 'win32') return;
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-codex-resolver-'));
    const publicBinDir = join(tempDir, '.local', 'bin');
    const nodeBinDir = join(tempDir, '.local', 'node-current', 'bin');
    const packageBinDir = join(
      tempDir,
      '.local',
      'node-current',
      'lib',
      'node_modules',
      '@openai',
      'codex',
      'bin'
    );
    const publicCodex = join(publicBinDir, 'codex');
    const nodeCodex = join(nodeBinDir, 'codex');
    const packageCodex = join(packageBinDir, 'codex.js');
    mkdirSync(publicBinDir, { recursive: true });
    mkdirSync(nodeBinDir, { recursive: true });
    mkdirSync(packageBinDir, { recursive: true });
    writeFileSync(packageCodex, '#!/usr/bin/env node\n');
    writeFileSync(join(nodeBinDir, 'node'), '#!/bin/sh\nexit 0\n');
    chmodSync(packageCodex, 0o755);
    chmodSync(join(nodeBinDir, 'node'), 0o755);
    symlinkSync('../lib/node_modules/@openai/codex/bin/codex.js', nodeCodex);
    symlinkSync(nodeCodex, publicCodex);

    const result = await resolveCodexEnvironment({
      processEnv: {
        PATH: '/usr/bin:/bin',
        SHELL: '/bin/false'
      },
      homeDir: tempDir,
      platform: 'darwin',
      shellTimeoutMs: 100
    });

    expect(result?.codexBin).toBe(publicCodex);
    expect(result?.env.PATH?.split(':').slice(0, 2)).toEqual([
      publicBinDir,
      nodeBinDir
    ]);
  });
});

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
