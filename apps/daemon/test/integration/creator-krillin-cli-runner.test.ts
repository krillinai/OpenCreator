import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';
import { runKrillinCli } from '../../src/creator/krillin/cli-runner.js';
import type { KrillinRuntimeManifest } from '../../src/creator/krillin/manifest.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('KrillinAI CLI runner', () => {
  it('writes private config, invokes the official CLI shape, maps outputs, and removes secrets', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-krillin-cli-'));
    const resourceRoot = join(tempDir, 'runtime');
    const jobsRoot = join(tempDir, 'jobs');
    const workdir = join(jobsRoot, 'job-1', 'stage-run-1');
    const source = join(jobsRoot, 'job-1', 'imports', 'source.mp4');
    const cli = join(resourceRoot, 'bin', process.platform === 'win32' ? 'krillinai-cli.exe' : 'krillinai-cli');
    mkdirSync(dirname(cli), { recursive: true });
    mkdirSync(dirname(source), { recursive: true });
    mkdirSync(workdir, { recursive: true });
    writeFileSync(source, 'fixture-video');
    writeFileSync(cli, `#!${process.execPath}\n${FAKE_CLI}`);
    if (process.platform !== 'win32') chmodSync(cli, 0o755);

    const manifest: KrillinRuntimeManifest = {
      version: 1,
      platform: process.platform,
      arch: process.arch,
      resources: [{
        path: relative(resourceRoot, cli).replaceAll('\\', '/'),
        sha256: 'a'.repeat(64),
        kind: 'executable'
      }]
    };
    const config = createDefaultCreatorServicesConfig();
    config.llm.apiKey = 'llm-test-secret';
    config.transcription.openai.apiKey = 'transcription-test-secret';
    const progress: Array<Record<string, unknown>> = [];
    const stage = {
      stageRun: {
        id: 'stage-run-1',
        stageId: 'subtitle',
        progress: {}
      },
      job: {
        id: 'job-1',
        state: {}
      },
      inputArtifacts: [],
      workdir,
      signal: new AbortController().signal,
      reportProgress(value: Record<string, unknown>) {
        progress.push(value);
      }
    } as unknown as CreatorExecutorInput;

    const artifacts = await runKrillinCli({
      resourceRoot,
      jobsRoot,
      manifest,
      stage,
      config,
      artifacts: [{ id: 'source-1', kind: 'source_video', path: source }],
      options: {
        originLanguage: 'en',
        targetLanguage: 'zh_cn',
        captionSource: 'any',
        bilingualTop: false
      }
    });

    expect(artifacts.map(artifact => artifact.kind)).toEqual([
      'source_video',
      'source_subtitle',
      'target_subtitle',
      'bilingual_subtitle'
    ]);
    expect(JSON.parse(readFileSync(join(workdir, 'observed-args.json'), 'utf8'))).toEqual(expect.arrayContaining([
      'subtitle',
      source,
      '--origin-lang',
      'en',
      '--target-lang',
      'zh_cn',
      '--bilingual-top=false'
    ]));
    expect(readFileSync(join(workdir, 'observed-config.toml'), 'utf8')).toContain('transcription-test-secret');
    expect(existsSync(join(workdir, '.krillin-cli'))).toBe(false);
    expect(progress.at(-1)).toMatchObject({
      krillinMode: 'cli',
      providerStatus: 'succeeded',
      percent: 100
    });
  });
});

const FAKE_CLI = String.raw`
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
const workdir = args[args.indexOf('--workdir') + 1];
mkdirSync(workdir, { recursive: true });
writeFileSync(join(workdir, 'observed-args.json'), JSON.stringify(args));
writeFileSync(
  join(workdir, 'observed-config.toml'),
  readFileSync(join(process.cwd(), 'config', 'config.toml'))
);
const outputs = {
  origin_video: join(workdir, 'origin_video.mp4'),
  origin_srt: join(workdir, 'origin_language_srt.srt'),
  target_srt: join(workdir, 'target_language_srt.srt'),
  bilingual_srt: join(workdir, 'bilingual_srt.srt')
};
writeFileSync(outputs.origin_video, 'video');
writeFileSync(outputs.origin_srt, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
writeFileSync(outputs.target_srt, '1\n00:00:00,000 --> 00:00:01,000\n你好\n');
writeFileSync(outputs.bilingual_srt, '1\n00:00:00,000 --> 00:00:01,000\n你好\nHello\n');
process.stdout.write(JSON.stringify({ ok: true, stage: 'subtitle', outputs }) + '\n');
`;
