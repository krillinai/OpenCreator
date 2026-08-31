import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { parse } from '@iarna/toml';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
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
  it.skipIf(process.platform === 'win32')('writes private config, invokes the official CLI shape, maps outputs, and removes secrets', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-krillin-cli-'));
    const resourceRoot = join(tempDir, 'runtime');
    const jobsRoot = join(tempDir, 'jobs');
    const dependencyRoot = join(tempDir, 'dependencies');
    const workdir = join(jobsRoot, 'job-1', 'stage-run-1');
    const source = join(jobsRoot, 'job-1', 'imports', 'source.mp4');
    const cli = join(resourceRoot, 'bin', process.platform === 'win32' ? 'krillinai-cli.exe' : 'krillinai-cli');
    const ffmpeg = join(resourceRoot, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    const ytDlp = join(tempDir, 'managed-yt-dlp');
    const whisperKit = join(
      dependencyRoot,
      'bin',
      process.platform === 'win32' ? 'whisperkit-cli.exe' : 'whisperkit-cli'
    );
    mkdirSync(dirname(cli), { recursive: true });
    mkdirSync(dirname(whisperKit), { recursive: true });
    mkdirSync(dirname(source), { recursive: true });
    mkdirSync(workdir, { recursive: true });
    writeFileSync(source, 'fixture-video');
    writeFileSync(cli, `#!${process.execPath}\n${FAKE_CLI}`);
    writeFileSync(ffmpeg, 'fixture-ffmpeg');
    writeFileSync(ytDlp, 'fixture-yt-dlp');
    writeFileSync(whisperKit, 'fixture-whisperkit');
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
    config.transcription.provider = 'whisperkit';
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
      dependencyRoot,
      manifest,
      stage,
      config,
      artifacts: [{ id: 'source-1', kind: 'source_video', path: source }],
      options: {
        originLanguage: 'en',
        targetLanguage: 'zh_cn',
        captionSource: 'any',
        bilingualTop: false
      },
      ytDlpRuntime: {
        version: '2026.08.31.120000',
        executable: process.execPath,
        prefixArgs: ['-I', '-B', ytDlp],
        env: { SSL_CERT_FILE: '/tmp/opencreator-cacert.pem' },
        script: ytDlp
      }
    });

    expect(artifacts.map(artifact => artifact.kind)).toEqual([
      'source_video',
      'source_subtitle',
      'target_subtitle',
      'bilingual_subtitle',
      'vertical_subtitle'
    ]);
    expect(JSON.parse(readFileSync(join(workdir, 'observed-args.json'), 'utf8'))).toEqual(expect.arrayContaining([
      'subtitle',
      `local:${source}`,
      '--origin-lang',
      'en',
      '--target-lang',
      'zh_cn',
      '--bilingual-top=false'
    ]));
    expect(readFileSync(join(workdir, 'observed-config.toml'), 'utf8')).toContain('transcription-test-secret');
    expect(JSON.parse(readFileSync(join(workdir, 'observed-dependencies.json'), 'utf8'))).toEqual({
      resourceRoot: join(workdir, '.krillin-cli'),
      offline: '1',
      bin: join(realpathSync(workdir), '.krillin-cli', 'bin'),
      models: realpathSync(join(dependencyRoot, 'models')),
      ffmpeg: realpathSync(ffmpeg),
      whisperKit: realpathSync(whisperKit),
      ytDlp: realpathSync(ytDlp)
    });
    expect(existsSync(join(workdir, '.krillin-cli'))).toBe(false);
    expect(existsSync(join(dependencyRoot, 'bin', '.yt-dlp-last-check'))).toBe(true);
    expect(existsSync(join(dependencyRoot, 'models'))).toBe(true);
    expect(progress.at(-1)).toMatchObject({
      krillinMode: 'cli',
      providerStatus: 'succeeded',
      percent: 100
    });
  });

  it.skipIf(process.platform === 'win32')('overrides the configured TTS provider and model from the job snapshot', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-krillin-cli-tts-'));
    const resourceRoot = join(tempDir, 'runtime');
    const jobsRoot = join(tempDir, 'jobs');
    const dependencyRoot = join(tempDir, 'dependencies');
    const workdir = join(jobsRoot, 'job-tts', 'stage-run-tts');
    const subtitle = join(jobsRoot, 'job-tts', 'artifacts', 'target.srt');
    const cli = join(resourceRoot, 'bin', 'krillinai-cli');
    mkdirSync(dirname(cli), { recursive: true });
    mkdirSync(dirname(subtitle), { recursive: true });
    mkdirSync(workdir, { recursive: true });
    writeFileSync(subtitle, '1\n00:00:00,000 --> 00:00:01,000\n你好\n');
    writeFileSync(cli, `#!${process.execPath}\n${FAKE_CLI}`);
    chmodSync(cli, 0o755);

    const manifest: KrillinRuntimeManifest = {
      version: 1,
      platform: process.platform,
      arch: process.arch,
      resources: [{
        path: relative(resourceRoot, cli).replaceAll('\\', '/'),
        sha256: 'b'.repeat(64),
        kind: 'executable'
      }]
    };
    const config = createDefaultCreatorServicesConfig();
    config.tts.provider = 'openai';
    config.tts.openai.model = 'gpt-4o-mini-tts';
    config.tts.aliyun.apiKey = 'dashscope-key';
    const progress: Array<Record<string, unknown>> = [];
    const stage = {
      stageRun: {
        id: 'stage-run-tts',
        stageId: 'tts',
        progress: {}
      },
      job: {
        id: 'job-tts',
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
      dependencyRoot,
      manifest,
      stage,
      config,
      artifacts: [{ id: 'subtitle-1', kind: 'target_subtitle', path: subtitle }],
      options: {
        ttsProvider: 'aliyun',
        ttsModel: 'qwen3-tts-instruct-flash',
        voiceCode: 'Cherry'
      }
    });

    expect(artifacts.map(artifact => artifact.kind)).toEqual(['dubbed_audio']);
    expect(JSON.parse(readFileSync(join(workdir, 'observed-args.json'), 'utf8'))).toEqual([
      'tts',
      '--workdir',
      workdir,
      '--task-id',
      'stage-run-tts',
      '--input-srt',
      subtitle,
      '--line-mode',
      'target-only',
      '--voice',
      'Cherry'
    ]);
    const observed = parse(readFileSync(join(workdir, 'observed-config.toml'), 'utf8')) as {
      tts: {
        provider: string;
        openai: { model: string };
        aliyun: { api_key: string; model: string };
      };
    };
    expect(observed.tts).toMatchObject({
      provider: 'aliyun',
      openai: { model: 'gpt-4o-mini-tts' },
      aliyun: {
        api_key: 'dashscope-key',
        model: 'qwen3-tts-instruct-flash'
      }
    });

    progress.length = 0;
    await expect(runKrillinCli({
      resourceRoot,
      jobsRoot,
      dependencyRoot,
      manifest,
      stage,
      config,
      artifacts: [{ id: 'subtitle-1', kind: 'target_subtitle', path: subtitle }],
      options: {
        ttsProvider: 'aliyun',
        ttsModel: 'qwen3-tts-instruct-flash',
        voiceCode: 'FAIL'
      }
    })).rejects.toMatchObject({
      code: 'generate_speech_failed',
      message: 'fixture TTS failed'
    });
    expect(progress).toEqual([
      {
        krillinMode: 'cli',
        providerStatus: 'running',
        percent: 5
      },
      {
        krillinMode: 'cli',
        providerStatus: 'running',
        percent: 64,
        phase: 'generating_voice',
        krillinEventPayload: {
          percent: 64,
          phase: 'generating_voice',
          message: 'generating'
        }
      },
      {
        krillinMode: 'cli',
        providerStatus: 'failed',
        phase: 'failed',
        krillinEventPayload: {
          phase: 'failed',
          message: 'fixture TTS failed'
        }
      }
    ]);
  });

  it.skipIf(process.platform === 'win32')('selects the short vertical subtitle without changing horizontal subtitle selection', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-krillin-cli-render-'));
    const resourceRoot = join(tempDir, 'runtime');
    const jobsRoot = join(tempDir, 'jobs');
    const dependencyRoot = join(tempDir, 'dependencies');
    const cli = join(resourceRoot, 'bin', 'krillinai-cli');
    const source = join(jobsRoot, 'job-render', 'artifacts', 'source.mp4');
    const target = join(jobsRoot, 'job-render', 'artifacts', 'target.srt');
    const bilingual = join(jobsRoot, 'job-render', 'artifacts', 'bilingual.srt');
    const vertical = join(jobsRoot, 'job-render', 'artifacts', 'vertical.srt');
    mkdirSync(dirname(cli), { recursive: true });
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(cli, `#!${process.execPath}\n${FAKE_CLI}`);
    writeFileSync(source, 'fixture-video');
    writeFileSync(target, '1\n00:00:00,000 --> 00:00:01,000\n目标字幕\n');
    writeFileSync(bilingual, '1\n00:00:00,000 --> 00:00:01,000\n目标字幕\nSource subtitle\n');
    writeFileSync(vertical, '1\n00:00:00,000 --> 00:00:01,000\n竖屏短字幕\n');
    chmodSync(cli, 0o755);

    const manifest: KrillinRuntimeManifest = {
      version: 1,
      platform: process.platform,
      arch: process.arch,
      resources: [{
        path: relative(resourceRoot, cli).replaceAll('\\', '/'),
        sha256: 'c'.repeat(64),
        kind: 'executable'
      }]
    };
    const config = createDefaultCreatorServicesConfig();
    const artifacts = [
      { id: 'source-1', kind: 'source_video', path: source },
      { id: 'vertical-1', kind: 'vertical_subtitle', path: vertical },
      { id: 'target-1', kind: 'target_subtitle', path: target },
      { id: 'bilingual-1', kind: 'bilingual_subtitle', path: bilingual }
    ];
    const run = async (
      stageId: 'render-horizontal' | 'render-vertical',
      stageRunId: string,
      inputs = artifacts
    ) => {
      const workdir = join(jobsRoot, 'job-render', stageRunId);
      mkdirSync(workdir, { recursive: true });
      const stage = {
        stageRun: {
          id: stageRunId,
          stageId,
          progress: {}
        },
        job: {
          id: 'job-render',
          state: {}
        },
        inputArtifacts: [],
        workdir,
        signal: new AbortController().signal,
        reportProgress() {}
      } as unknown as CreatorExecutorInput;
      await runKrillinCli({
        resourceRoot,
        jobsRoot,
        dependencyRoot,
        manifest,
        stage,
        config,
        artifacts: inputs,
        options: { bilingual: true }
      });
      return JSON.parse(readFileSync(join(workdir, 'observed-args.json'), 'utf8')) as string[];
    };
    const selectedSubtitle = (args: string[]) => args[args.indexOf('--subtitle') + 1];

    expect(selectedSubtitle(await run('render-vertical', 'stage-run-vertical'))).toBe(vertical);
    expect(selectedSubtitle(await run(
      'render-vertical',
      'stage-run-vertical-fallback',
      artifacts.filter(artifact => artifact.kind !== 'vertical_subtitle')
    ))).toBe(target);
    expect(selectedSubtitle(await run('render-horizontal', 'stage-run-horizontal'))).toBe(bilingual);
  });
});

const FAKE_CLI = String.raw`
const { mkdirSync, readFileSync, realpathSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const args = process.argv.slice(2);
const workdir = args[args.indexOf('--workdir') + 1];
mkdirSync(workdir, { recursive: true });
writeFileSync(join(workdir, 'observed-args.json'), JSON.stringify(args));
writeFileSync(
  join(workdir, 'observed-config.toml'),
  readFileSync(join(process.cwd(), 'config', 'config.toml'))
);
const voiceIndex = args.indexOf('--voice');
const shouldFail = args[0] === 'tts' && voiceIndex >= 0 && args[voiceIndex + 1] === 'FAIL';
if (shouldFail) {
  process.stdout.write(JSON.stringify({
    type: 'progress',
    phase: 'generating_voice',
    percent: 64,
    message: 'generating'
  }) + '\n');
  process.stdout.write(JSON.stringify({
    ok: false,
    stage: 'tts',
    error: {
      code: 'generate_speech_failed',
      message: 'fixture TTS failed',
      retryable: true
    }
  }) + '\n');
  process.exitCode = 1;
  return;
}
let outputs;
if (args[0] === 'tts') {
  outputs = {
    tts_audio: join(workdir, 'dubbed_audio.wav')
  };
  writeFileSync(outputs.tts_audio, 'audio');
} else if (args[0] === 'render-horizontal') {
  outputs = {
    horizontal_video: join(workdir, 'horizontal_video.mp4')
  };
  writeFileSync(outputs.horizontal_video, 'video');
} else if (args[0] === 'render-vertical') {
  outputs = {
    vertical_video: join(workdir, 'vertical_video.mp4')
  };
  writeFileSync(outputs.vertical_video, 'video');
} else {
  writeFileSync(join(workdir, 'observed-dependencies.json'), JSON.stringify({
    resourceRoot: process.env.KRILLINAI_RESOURCE_ROOT,
    offline: process.env.KRILLINAI_OFFLINE_DEPENDENCIES,
    bin: realpathSync(join(process.cwd(), 'bin')),
    models: realpathSync(join(process.cwd(), 'models')),
    ffmpeg: realpathSync(join(process.env.KRILLINAI_RESOURCE_ROOT, 'bin', 'ffmpeg')),
    whisperKit: realpathSync(join(process.env.KRILLINAI_RESOURCE_ROOT, 'bin', 'whisperkit-cli')),
    ytDlp: realpathSync(join(
      process.env.KRILLINAI_RESOURCE_ROOT,
      'bin',
      process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    ))
  }));
  outputs = {
    origin_video: join(workdir, 'origin_video.mp4'),
    origin_srt: join(workdir, 'origin_language_srt.srt'),
    target_srt: join(workdir, 'target_language_srt.srt'),
    bilingual_srt: join(workdir, 'bilingual_srt.srt'),
    short_origin_mixed_srt: join(workdir, 'short_origin_mixed_srt.srt')
  };
  writeFileSync(outputs.origin_video, 'video');
  writeFileSync(outputs.origin_srt, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
  writeFileSync(outputs.target_srt, '1\n00:00:00,000 --> 00:00:01,000\n你好\n');
  writeFileSync(outputs.bilingual_srt, '1\n00:00:00,000 --> 00:00:01,000\n你好\nHello\n');
  writeFileSync(outputs.short_origin_mixed_srt, '1\n00:00:00,000 --> 00:00:01,000\nHello\n');
}
process.stdout.write(JSON.stringify({ ok: true, stage: args[0], outputs }) + '\n');
`;
