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
import { verifyCodexRuntime } from '../scripts/codex-runtime-contract.mjs';
import { stageCodexRuntime } from '../scripts/prepare-codex-runtime.mjs';

let tempRoot = '';

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('Codex Runtime package contract', () => {
  it('stages only manifest-pinned runtime and protocol files', () => {
    const fixture = createFixture();
    const result = stageCodexRuntime(fixture);

    expect(verifyCodexRuntime(result.outputRoot, process.platform, process.arch)).toMatchObject({
      version: '0.149.0',
      commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0'
    });
  });

  it('rejects wrong hashes, versions, platforms and extra files', () => {
    let fixture = createFixture();
    let result = stageCodexRuntime(fixture);
    writeFileSync(join(result.outputRoot, 'bin', executableName()), 'tampered');
    expect(() => verifyCodexRuntime(result.outputRoot, process.platform, process.arch)).toThrow(/hash mismatch/i);

    fixture = createFixture();
    result = stageCodexRuntime(fixture);
    expect(() => verifyCodexRuntime(result.outputRoot, process.platform, process.arch === 'x64' ? 'arm64' : 'x64')).toThrow(/targets/i);

    fixture = createFixture();
    const manifest = JSON.parse(readFileSync(fixture.manifestPath, 'utf8'));
    manifest.version = '0.148.0';
    writeFileSync(fixture.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    expect(() => stageCodexRuntime(fixture)).toThrow(/manifest is invalid/i);

    fixture = createFixture();
    result = stageCodexRuntime(fixture);
    writeFileSync(join(result.outputRoot, 'download-at-runtime.js'), 'fetch("https://example.com")');
    expect(() => verifyCodexRuntime(result.outputRoot, process.platform, process.arch)).toThrow(/file list differs/i);
  });
});

function createFixture() {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = mkdtempSync(join(tmpdir(), 'codex-runtime-contract-'));
  const sourceRoot = join(tempRoot, 'source');
  const protocolRoot = join(tempRoot, 'protocol');
  const outputRoot = join(tempRoot, 'output');
  const manifestPath = join(tempRoot, 'manifest.json');
  const binaryPath = join(sourceRoot, 'bin', executableName());
  mkdirSync(dirname(binaryPath), { recursive: true });
  writeFileSync(binaryPath, 'codex-0.149.0');

  const protocolFile = join(protocolRoot, 'typescript', 'v2', 'TurnStartParams.ts');
  mkdirSync(dirname(protocolFile), { recursive: true });
  writeFileSync(protocolFile, 'export type TurnStartParams = { threadId: string };\n');
  const protocolHash = sha256(readFileSync(protocolFile));
  writeFileSync(join(protocolRoot, 'metadata.ts'), 'export const source = "fixture";\n');
  writeFileSync(join(protocolRoot, 'protocol-manifest.json'), `${JSON.stringify({
    sourceTag: 'rust-v0.149.0',
    sourceCommit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
    aggregateSha256: 'a'.repeat(64),
    files: { 'typescript/v2/TurnStartParams.ts': protocolHash }
  }, null, 2)}\n`);

  writeFileSync(manifestPath, `${JSON.stringify({
    schemaVersion: 1,
    runtime: 'codex',
    version: '0.149.0',
    tag: 'rust-v0.149.0',
    commit: '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0',
    platform: process.platform,
    arch: process.arch,
    officialAsset: 'https://example.test/codex.zip',
    sourcePackage: 'npm:@openai/codex@0.149.0-fixture',
    binary: { relativePath: `bin/${executableName()}`, sha256: sha256(readFileSync(binaryPath)) },
    appServerProtocol: {
      sourceVersion: 'v0_149_0',
      relativePath: 'protocol/v0_149_0',
      schemaSha256: 'a'.repeat(64)
    },
    resources: [{
      path: `bin/${executableName()}`,
      sha256: sha256(readFileSync(binaryPath)),
      kind: 'executable'
    }],
    builtAt: '2026-08-21T00:00:00.000Z'
  }, null, 2)}\n`);

  return { sourceRoot, protocolRoot, outputRoot, manifestPath };
}

function executableName() {
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}
