import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  copyOfficialPreset,
  hashDirectory,
  repositoryRoot,
  updatePresetManifest
} from '../helpers/creator-preset-fixtures.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator presets CLI', () => {
  it('validates compiles and preserves the previous catalog after invalid input', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-presets-cli-'));
    const sourceRoot = join(tempDir, 'template');
    const outputRoot = join(tempDir, 'output');
    mkdirSync(sourceRoot, { recursive: true });
    const preset = copyOfficialPreset({
      sourceRoot,
      module: 'cover-generator',
      sourceId: 'personal-growth'
    });

    const validated = runCli('validate', sourceRoot, outputRoot);
    expect(validated.status).toBe(0);
    expect(validated.stdout).toContain('Validated 1 creator presets');
    expect(() => readFileSync(join(outputRoot, 'catalog.json'))).toThrow();

    const compiled = runCli('compile', sourceRoot, outputRoot);
    expect(compiled.status).toBe(0);
    expect(compiled.stdout).toMatch(/catalog=[a-f0-9]{64} assets=[a-f0-9]{64}/);
    const before = hashDirectory(outputRoot);

    updatePresetManifest(preset, manifest => ({
      ...manifest,
      runtimeTemplate: { id: 'cover-generator', version: 2 }
    }));
    const failed = runCli('compile', sourceRoot, outputRoot);
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(
      'cover-generator/personal-growth/1/template.json.runtimeTemplate'
    );
    expect(hashDirectory(outputRoot)).toBe(before);
  });
});

function runCli(command: 'validate' | 'compile', sourceRoot: string, outputRoot: string) {
  return spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'apps/daemon/scripts/creator-presets.ts',
      command
    ],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        OPENCREATOR_PRESET_SOURCE_ROOT: sourceRoot,
        OPENCREATOR_PRESET_CATALOG_ROOT: outputRoot
      },
      encoding: 'utf8'
    }
  );
}
