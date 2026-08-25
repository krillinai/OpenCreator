import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  ThreadResumeParams,
  ThreadStartParams,
  TurnStartParams
} from '../../src/codex/generated/v0_149_0/index.js';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const GENERATED_ROOT = resolve(TEST_DIR, '../../src/codex/generated/v0_149_0');

describe('Codex app-server protocol rust-v0.149.0', () => {
  it('pins the stable tag, commit and generated content hash', () => {
    const manifest = JSON.parse(readFileSync(resolve(GENERATED_ROOT, 'protocol-manifest.json'), 'utf8')) as {
      sourceTag: string;
      sourceCommit: string;
      aggregateSha256: string;
      files: Record<string, string>;
    };

    expect(manifest.sourceTag).toBe('rust-v0.149.0');
    expect(manifest.sourceCommit).toBe('758ef40f50c1a458425c7cfbf1eb12cbc07af0b0');
    expect(manifest.aggregateSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.keys(manifest.files)).toContain('typescript/v2/TurnStartParams.ts');
  });

  it('keeps developer instructions on thread start and resume only', () => {
    const threadStart = readSchema('v2/ThreadStartParams.json');
    const threadResume = readSchema('v2/ThreadResumeParams.json');
    const turnStart = readSchema('v2/TurnStartParams.json');

    expect(threadStart.properties).toHaveProperty('developerInstructions');
    expect(threadResume.properties).toHaveProperty('developerInstructions');
    expect(turnStart.properties).not.toHaveProperty('developerInstructions');
    expect(turnStart.required).toEqual(expect.arrayContaining(['threadId', 'input']));
  });

  it('compiles the critical request shapes without widening to any', () => {
    const threadStart = {
      cwd: 'D:/creator/job',
      developerInstructions: 'Use the OpenCreator tool contract.'
    } satisfies ThreadStartParams;
    const threadResume = {
      threadId: 'thread-1',
      developerInstructions: 'Use the OpenCreator tool contract.'
    } satisfies ThreadResumeParams;
    const turnStart = {
      threadId: 'thread-1',
      input: [{ type: 'text', text: 'Continue the creator job.', text_elements: [] }]
    } satisfies TurnStartParams;

    expect(threadStart.developerInstructions).toBeTruthy();
    expect(threadResume.threadId).toBe('thread-1');
    expect(turnStart.input).toHaveLength(1);
  });

  it('rejects generation from a commit other than the approved stable commit', () => {
    const script = resolve(TEST_DIR, '../../scripts/generate-codex-app-server-protocol.mjs');
    const codexRepo = resolve(TEST_DIR, '../../../../codex');

    expect(() => execFileSync(process.execPath, [
      script,
      '--source-repo', codexRepo,
      '--expected-commit', '0000000000000000000000000000000000000000',
      '--output', resolve(TEST_DIR, '../../../../.tmp/codex-protocol-invalid')
    ], { stdio: 'pipe' })).toThrow();
  });
});

function readSchema(name: string): { properties: Record<string, unknown>; required?: string[] } {
  return JSON.parse(readFileSync(resolve(GENERATED_ROOT, 'json', name), 'utf8')) as {
    properties: Record<string, unknown>;
    required?: string[];
  };
}
