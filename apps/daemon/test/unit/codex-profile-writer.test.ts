import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCodexProfileOverlay } from '../../src/codex/profiles/config.js';
import {
  createProfileWriter,
  serializeCodexProfileOverlay
} from '../../src/codex/profiles/writer.js';

const tempDirs: string[] = [];

function createCodexHome(): string {
  const codexHome = mkdtempSync(join(tmpdir(), 'opencreator-codex-profile-writer-'));
  tempDirs.push(codexHome);
  writeFileSync(join(codexHome, 'config.toml'), 'approval_policy = "never"\n');
  return codexHome;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('codex profile writer', () => {
  it('creates, updates, and deletes an isolated profile overlay with backups', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });
    const profilePath = join(codexHome, 'review.config.toml');

    await writer.create('review', {
      model: 'gpt-5.3-codex',
      model_reasoning_effort: 'high'
    });

    expect(readFileSync(profilePath, 'utf8')).toContain('"model" = "gpt-5.3-codex"');

    await writer.update('review', {
      model: 'gpt-5.3-codex',
      model_reasoning_effort: 'medium'
    });

    expect(readFileSync(profilePath, 'utf8')).toContain('"model_reasoning_effort" = "medium"');
    const updateBackups = readdirSync(join(codexHome, 'backups'));
    expect(updateBackups.some((file) => file.startsWith('review.config.toml.'))).toBe(true);

    await writer.delete('review');

    expect(existsSync(profilePath)).toBe(false);
    const deleteBackups = readdirSync(join(codexHome, 'backups'));
    expect(deleteBackups.filter((file) => file.startsWith('review.config.toml.')).length).toBeGreaterThan(
      updateBackups.length
    );
  });

  it('does not destroy the original profile when a new config is invalid', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });
    const profilePath = join(codexHome, 'review.config.toml');

    await writer.create('review', { model: 'gpt-5.3-codex' });
    const original = readFileSync(profilePath, 'utf8');

    await expect(
      writer.update('review', { nested: { unsupported: true } } as never)
    ).rejects.toThrow(/CODEX_PROFILE_INVALID/);

    expect(readFileSync(profilePath, 'utf8')).toBe(original);
  });

  it('throws CODEX_PROFILE_EXISTS when creating an existing profile', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });

    await writer.create('review', { model: 'gpt-5.3-codex' });

    await expect(writer.create('review', { model: 'gpt-5.3-codex' })).rejects.toThrow(
      /CODEX_PROFILE_EXISTS/
    );
  });

  it('throws CODEX_PROFILE_NOT_FOUND when updating a missing profile', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });

    await expect(writer.update('review', { model: 'gpt-5.3-codex' })).rejects.toThrow(
      /CODEX_PROFILE_NOT_FOUND/
    );
  });

  it('throws CODEX_PROFILE_NOT_FOUND when deleting a missing profile', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });

    await expect(writer.delete('review')).rejects.toThrow(/CODEX_PROFILE_NOT_FOUND/);
  });

  it('serializes supported TOML profile overlay values', () => {
    const content = serializeCodexProfileOverlay({
      model: 'gpt-5.3-codex',
      include_plan_tool: true,
      max_tokens: 4096,
      experimental_features: ['writer', 'isolated']
    });

    expect(content).toContain('"model" = "gpt-5.3-codex"');
    expect(content).toContain('"include_plan_tool" = true');
    expect(content).toContain('"max_tokens" = 4096');
    expect(content).toContain('"experimental_features" = ["writer", "isolated"]');
  });

  it('rejects mixed-type arrays before writing invalid TOML', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });

    await expect(
      writer.create('review', { experimental_features: ['writer', 3, false] } as never)
    ).rejects.toThrow(/CODEX_PROFILE_INVALID/);

    expect(existsSync(join(codexHome, 'review.config.toml'))).toBe(false);
  });

  it('rejects mixed integer and float arrays before writing invalid TOML', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });

    await expect(
      writer.create('review', { nums: [1, 2.5] } as never)
    ).rejects.toThrow(/CODEX_PROFILE_INVALID/);

    expect(existsSync(join(codexHome, 'review.config.toml'))).toBe(false);
  });

  it('quotes dotted TOML keys so they remain primitive profile keys', () => {
    const content = serializeCodexProfileOverlay({ 'team.alpha': 'x' });

    expect(content).toContain('"team.alpha" = "x"');
  });

  it('writes dotted keys that round-trip through the profile overlay parser', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });
    const profilePath = join(codexHome, 'review.config.toml');

    await writer.create('review', { 'team.alpha': 'x' });

    const result = parseCodexProfileOverlay('review', readFileSync(profilePath, 'utf8'));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected parser success');
    expect(result.profile.config).toEqual({ 'team.alpha': 'x' });
  });

  it('does not modify base config.toml when writing a profile', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });
    const basePath = join(codexHome, 'config.toml');
    const originalBase = readFileSync(basePath, 'utf8');

    await writer.create('review', { model: 'gpt-5.3-codex' });
    await writer.update('review', { model: 'gpt-5.3-codex', model_reasoning_effort: 'medium' });

    expect(readFileSync(basePath, 'utf8')).toBe(originalBase);
  });

  it('rejects writes when base config.toml is invalid and does not create the profile overlay', async () => {
    const codexHome = createCodexHome();
    writeFileSync(join(codexHome, 'config.toml'), 'approval_policy = "never\n');
    const writer = createProfileWriter({ codexHome });

    await expect(writer.create('review', { model: 'gpt-5.3-codex' })).rejects.toThrow(
      /CODEX_CONFIG_INVALID/
    );

    expect(existsSync(join(codexHome, 'review.config.toml'))).toBe(false);
  });

  it('does not leave the codex home lock stuck after a failed write', async () => {
    const codexHome = createCodexHome();
    const basePath = join(codexHome, 'config.toml');
    const writer = createProfileWriter({ codexHome });

    writeFileSync(basePath, 'approval_policy = "never\n');
    await expect(writer.create('review', { model: 'gpt-5.3-codex' })).rejects.toThrow(/CODEX_CONFIG_INVALID/);

    writeFileSync(basePath, 'approval_policy = "never"\n');
    await writer.create('review', { model: 'gpt-5.3-codex' });

    expect(existsSync(join(codexHome, 'review.config.toml'))).toBe(true);
  });

  it('serializes concurrent writes to the same codex home without leaving temp files', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });

    await Promise.all([
      writer.create('a', { model: 'gpt-5.3-codex' }),
      writer.create('b', { model: 'gpt-5.3-codex', model_reasoning_effort: 'medium' })
    ]);

    expect(existsSync(join(codexHome, 'a.config.toml'))).toBe(true);
    expect(existsSync(join(codexHome, 'b.config.toml'))).toBe(true);
    expect(readdirSync(codexHome).filter((file) => file.includes('.tmp'))).toEqual([]);
  });

  it('removes temp files after rejecting invalid config before disk changes', async () => {
    const codexHome = createCodexHome();
    const writer = createProfileWriter({ codexHome });

    await expect(writer.create('review', { nested: { unsupported: true } } as never)).rejects.toThrow(
      /CODEX_PROFILE_INVALID/
    );

    expect(existsSync(join(codexHome, 'review.config.toml'))).toBe(false);
    expect(readdirSync(codexHome).filter((file) => file.includes('.tmp'))).toEqual([]);
  });
});
