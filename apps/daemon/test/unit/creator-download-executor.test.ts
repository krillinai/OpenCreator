import type {
  CreatorArtifact,
  CreatorJob,
  CreatorStageRun,
  DownloadProbe
} from '@opencreator/protocol';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDownloadExecutor } from '../../src/creator/download/executor.js';
import { parseDownloadProbe } from '../../src/creator/download/probe-parser.js';
import type { CreatorExecutorInput } from '../../src/creator/executor.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator download executor', () => {
  it('normalizes real video and MP3 choices without exposing arbitrary state format ids', () => {
    const probe = parsedProbe();

    expect(probe).toMatchObject({
      requestedUrl: 'https://www.youtube.com/watch?v=demo',
      platform: 'youtube',
      uploader: 'OpenCreator',
      width: 1920,
      height: 1080
    });
    expect(probe.options).toEqual([
      expect.objectContaining({
        id: 'video-1080-1',
        mediaType: 'video',
        container: 'mp4',
        videoFormatId: '137',
        audioFormatId: '140',
        estimatedBytes: 120
      }),
      expect.objectContaining({
        id: 'video-360-2',
        mediaType: 'video',
        videoFormatId: '18'
      }),
      expect.objectContaining({
        id: 'audio-mp3-320',
        mediaType: 'audio',
        bitrateKbps: 320,
        audioFormatId: '140',
        transcode: 'mp3'
      }),
      expect.objectContaining({ id: 'audio-mp3-192' }),
      expect.objectContaining({ id: 'audio-mp3-128' })
    ]);
  });

  it('offers MP3 extraction when the source only has a combined media format', () => {
    const probe = parseDownloadProbe({
      id: 'progressive-only',
      title: 'Progressive only',
      webpage_url: 'https://www.youtube.com/watch?v=progressive-only',
      extractor_key: 'Youtube',
      duration: 10,
      formats: [{
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        tbr: 500,
        filesize: 30,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }]
    }, 'https://www.youtube.com/watch?v=progressive-only');

    expect(probe.options).toEqual([
      expect.objectContaining({
        id: 'video-360-1',
        videoFormatId: '18'
      }),
      expect.objectContaining({
        id: 'audio-mp3-320',
        audioFormatId: '18',
        transcode: 'mp3'
      }),
      expect.objectContaining({ id: 'audio-mp3-192' }),
      expect.objectContaining({ id: 'audio-mp3-128' })
    ]);
  });

  it('accepts null metadata fields emitted by real yt-dlp probes', () => {
    const probe = parseDownloadProbe({
      id: 'nullable-fields',
      title: 'Nullable fields',
      webpage_url: 'https://www.youtube.com/watch?v=nullable-fields',
      extractor_key: 'Youtube',
      uploader: null,
      channel: null,
      thumbnail: null,
      width: null,
      height: null,
      formats: [{
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        fps: null,
        tbr: null,
        abr: null,
        filesize: null,
        filesize_approx: null,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }, {
        format_id: 'storyboard',
        ext: 'mhtml',
        width: null,
        height: null,
        fps: null,
        tbr: null,
        abr: null,
        filesize: null,
        filesize_approx: null,
        vcodec: null,
        acodec: null
      }]
    }, 'https://www.youtube.com/watch?v=nullable-fields');

    expect(probe).toMatchObject({
      uploader: null,
      thumbnailUrl: null,
      width: 640,
      height: 360
    });
    expect(probe.options).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'video-360-1',
        videoFormatId: '18'
      })
    ]));
  });

  it('estimates video size from duration and bitrate instead of using audio bytes alone', () => {
    const probe = parseDownloadProbe({
      id: 'estimated-size',
      title: 'Estimated size',
      webpage_url: 'https://www.youtube.com/watch?v=estimated-size',
      extractor_key: 'Youtube',
      duration: 100,
      formats: [{
        format_id: 'video',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        tbr: 4_000,
        filesize: null,
        filesize_approx: null,
        vcodec: 'avc1',
        acodec: 'none'
      }, {
        format_id: 'audio',
        ext: 'm4a',
        abr: 128,
        filesize: 1_600_000,
        vcodec: 'none',
        acodec: 'mp4a'
      }]
    }, 'https://www.youtube.com/watch?v=estimated-size');

    expect(probe.options[0]).toMatchObject({
      id: 'video-1080-1',
      estimatedBytes: 51_600_000
    });
  });

  it('downloads the selected video option with bundled ffmpeg and emits verified metadata', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'video-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const reportProgress = vi.fn();
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-360-2'
      },
      progress: {
        optionId: 'video-1080-1',
        mediaType: 'video',
        sourceUrl: probe.requestedUrl
      },
      inputArtifacts: [probeArtifact],
      reportProgress
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '--ffmpeg-location',
      binaries.ffmpegPath,
      '--progress',
      '--progress-delta',
      '0.5',
      '-f',
      '137+140',
      '--merge-output-format',
      'mp4'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video',
      status: 'completed',
      metadata: expect.objectContaining({
        fileName: 'download.mp4',
        mimeType: 'video/mp4',
        size: 14,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        optionId: 'video-1080-1',
        selectedHeight: 1080,
        videoCodec: 'h264',
        audioCodec: 'aac',
        playbackCompatible: true,
        normalizedForPlayback: false
      })
    })]);
    const downloadPercents = reportProgress.mock.calls
      .map(([progress]) => progress)
      .filter(progress => progress.phase === 'downloading')
      .map(progress => Number(progress.percent));
    expect(downloadPercents).toHaveLength(3);
    expect(downloadPercents).toEqual(
      [...downloadPercents].sort((left, right) => left - right)
    );
    expect(downloadPercents[1]).toBeCloseTo(79.5, 1);
    expect(downloadPercents.at(-1)).toBeGreaterThan(downloadPercents[1]!);
    expect(reportProgress).toHaveBeenLastCalledWith(expect.objectContaining({
      status: 'succeeded',
      phase: 'completed',
      percent: 100
    }));
  });

  it('converts VP9 MP4 downloads to H.264 for local playback', async () => {
    const binaries = await fakeBinaries({ videoCodec: 'vp9' });
    const workdir = join(tempDir, 'vp9-video-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const reportProgress = vi.fn();
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      inputArtifacts: [probeArtifact],
      reportProgress
    }));

    const ffmpegArgs = JSON.parse(
      await readFile(join(workdir, 'ffmpeg-args.json'), 'utf8')
    ) as string[];
    expect(ffmpegArgs).toEqual(expect.arrayContaining([
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_video',
      path: expect.stringMatching(/\.playable\.mp4$/),
      metadata: expect.objectContaining({
        fileName: 'download.mp4',
        videoCodec: 'h264',
        audioCodec: 'aac',
        pixelFormat: 'yuv420p',
        playbackCompatible: true,
        normalizedForPlayback: true
      })
    })]);
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'normalizing_media',
      percent: 98
    }));
    expect(reportProgress).toHaveBeenCalledWith(expect.objectContaining({
      phase: 'normalizing_media',
      percent: 98.5
    }));
  });

  it('extracts the selected audio option as an MP3 source artifact', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'audio-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: probe.requestedUrl,
        mediaType: 'audio',
        selectedOptionId: 'audio-mp3-192'
      },
      inputArtifacts: [probeArtifact]
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '-f',
      '140',
      '--extract-audio',
      '--audio-format',
      'mp3',
      '--audio-quality',
      '192K'
    ]));
    expect(result.outputs).toEqual([expect.objectContaining({
      kind: 'source_audio',
      metadata: expect.objectContaining({
        fileName: 'download.mp3',
        mimeType: 'audio/mpeg',
        mediaType: 'audio',
        selectedBitrateKbps: 192,
        hasAudio: true,
        hasVideo: false
      })
    })]);
  });

  it('rejects a stale probe after the source URL changes', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'stale-work');
    await mkdir(workdir, { recursive: true });
    const probe = parsedProbe();
    const probeArtifact = await writeProbeArtifact(workdir, probe);
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'download',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=changed',
        mediaType: 'video',
        selectedOptionId: 'video-1080-1'
      },
      inputArtifacts: [probeArtifact]
    }))).rejects.toMatchObject({ code: 'download_probe_stale' });
  });

  it('routes probe requests through the configured media proxy', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'probe-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args).toEqual(expect.arrayContaining([
      '--proxy',
      'http://127.0.0.1:7897',
      '--dump-single-json'
    ]));
  });

  it('passes portable runtime prefix arguments and environment to yt-dlp', async () => {
    const binaries = await fakeBinaries({ portableRuntime: true });
    const workdir = join(tempDir, 'portable-probe-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }));

    const args = JSON.parse(
      await readFile(join(workdir, 'args.json'), 'utf8')
    ) as string[];
    expect(args[0]).toBe('--portable-runtime');
    expect(JSON.parse(
      await readFile(join(workdir, 'runtime-env.json'), 'utf8')
    )).toEqual({
      sslCertificateFile: '/runtime/cacert.pem'
    });
  });

  it('keeps probe progress indeterminate until video information is ready', async () => {
    const binaries = await fakeBinaries();
    const workdir = join(tempDir, 'probe-progress-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);
    const reportProgress = vi.fn();

    const result = await executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      },
      reportProgress
    }));

    expect(reportProgress.mock.calls.map(([progress]) => progress)).toEqual([
      expect.objectContaining({
        phase: 'validating',
        percent: null
      }),
      expect.objectContaining({
        phase: 'probing_source',
        percent: null
      }),
      expect.objectContaining({
        phase: 'completed',
        percent: 100
      })
    ]);
    expect(result.progress).toEqual(expect.objectContaining({
      phase: 'completed',
      percent: 100
    }));
  });

  it('classifies platform connection timeouts without exposing raw yt-dlp logs', async () => {
    const binaries = await fakeBinaries({
      failure: "ERROR: Unable to download API page: Connection to www.youtube.com timed out."
    });
    const workdir = join(tempDir, 'network-failure-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({
      code: 'network_unavailable',
      message: 'Unable to connect to the video platform. Check the network or proxy settings.'
    });
  });

  it('recommends updating yt-dlp when the platform extractor is outdated', async () => {
    const binaries = await fakeBinaries({
      failure: 'ERROR: Signature extraction failed. Please update to the latest version.'
    });
    const workdir = join(tempDir, 'outdated-extractor-work');
    await mkdir(workdir, { recursive: true });
    const executor = createDownloadExecutor(binaries);

    await expect(executor.run(stageInput({
      workdir,
      stageId: 'probe',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({
      code: 'yt_dlp_update_recommended',
      message: 'The video platform extractor may be outdated'
    });
  });

  it('rejects misleading domains that only end with a supported domain name', async () => {
    const config = createDefaultCreatorServicesConfig();
    const executor = createDownloadExecutor({
      configStore: { read: async () => config },
      ytDlpPath: '/missing/yt-dlp',
      ffmpegPath: '/missing/ffmpeg',
      ffprobePath: '/missing/ffprobe'
    });

    await expect(executor.run(stageInput({
      workdir: '/tmp',
      stageId: 'probe',
      state: {
        sourceUrl: 'https://notyoutube.com/watch?v=demo'
      }
    }))).rejects.toMatchObject({ code: 'unsupported_source' });

    await expect(executor.run(stageInput({
      workdir: '/tmp',
      stageId: 'probe',
      state: {
        sourceUrl: 'file://youtube.com/etc/passwd'
      }
    }))).rejects.toMatchObject({ code: 'unsupported_source' });
  });
});

function parsedProbe(): DownloadProbe {
  return parseDownloadProbe({
    id: 'demo',
    title: 'Creator Download',
    webpage_url: 'https://www.youtube.com/watch?v=demo',
    extractor_key: 'Youtube',
    uploader: 'OpenCreator',
    thumbnail: 'https://i.ytimg.com/vi/demo/hqdefault.jpg',
    duration: 12,
    width: 1920,
    height: 1080,
    formats: [
      {
        format_id: '137',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 4_500,
        filesize: 100,
        vcodec: 'avc1',
        acodec: 'none'
      },
      {
        format_id: '399',
        ext: 'mp4',
        width: 1920,
        height: 1080,
        fps: 30,
        tbr: 5_000,
        filesize: 120,
        vcodec: 'av01',
        acodec: 'none'
      },
      {
        format_id: '140',
        ext: 'm4a',
        abr: 128,
        filesize: 20,
        vcodec: 'none',
        acodec: 'mp4a'
      },
      {
        format_id: '18',
        ext: 'mp4',
        width: 640,
        height: 360,
        tbr: 500,
        filesize: 30,
        vcodec: 'avc1',
        acodec: 'mp4a'
      }
    ]
  }, 'https://www.youtube.com/watch?v=demo');
}

async function fakeBinaries(input?: {
  failure?: string;
  videoCodec?: string;
  portableRuntime?: boolean;
}): Promise<{
  configStore: {
    read(): Promise<ReturnType<typeof createDefaultCreatorServicesConfig>>;
  };
  ytDlpPath: string;
  ytDlpPrefixArgs?: string[];
  ytDlpEnv?: NodeJS.ProcessEnv;
  ffmpegPath: string;
  ffprobePath: string;
}> {
  tempDir = await mkdtemp(join(tmpdir(), 'creator-download-executor-'));
  const ytDlpPath = join(tempDir, 'yt-dlp');
  const ffmpegPath = join(tempDir, 'ffmpeg');
  const ffprobePath = join(tempDir, 'ffprobe');
  const failure = input?.failure;
  const videoCodec = input?.videoCodec ?? 'h264';
  await writeExecutable(ytDlpPath, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
writeFileSync(join(process.cwd(), 'args.json'), JSON.stringify(args));
writeFileSync(join(process.cwd(), 'runtime-env.json'), JSON.stringify({
  sslCertificateFile: process.env.SSL_CERT_FILE ?? null
}));
${failure === undefined ? '' : `process.stderr.write(${JSON.stringify(failure)} + '\\n'); process.exit(1);`}
if (args.includes('--dump-single-json')) {
  process.stdout.write(JSON.stringify({
    id: 'demo',
    title: 'Creator Download',
    webpage_url: 'https://www.youtube.com/watch?v=demo',
    extractor_key: 'Youtube',
    formats: [{
      format_id: '18',
      ext: 'mp4',
      width: 640,
      height: 360,
      vcodec: 'avc1',
      acodec: 'mp4a'
    }]
  }));
  process.exit(0);
}
const audio = args.includes('--extract-audio');
const output = join(process.cwd(), audio ? 'download.mp3' : 'download.mp4');
writeFileSync(output, audio ? 'download-audio' : 'download-video');
if (args.includes('--progress')) {
  process.stderr.write('[download] 42.0% of 100B\\n');
  if (!audio) {
    process.stderr.write('[download] 100% of 100B\\n');
    process.stderr.write('[download] 10.0% of 20B\\n');
  }
}
process.stderr.write(audio ? '[ExtractAudio] Destination\\n' : '[Merger] Merging formats\\n');
process.stdout.write(output + '\\n');
`);
  await writeExecutable(ffmpegPath, `#!/usr/bin/env node
import { copyFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
writeFileSync(join(process.cwd(), 'ffmpeg-args.json'), JSON.stringify(args));
const inputIndex = args.indexOf('-i');
copyFileSync(args[inputIndex + 1], args.at(-1));
process.stderr.write('out_time=00:00:06.000000\\n');
`);
  await writeExecutable(ffprobePath, `#!/usr/bin/env node
const path = process.argv.at(-1) ?? '';
const audio = path.endsWith('.mp3');
const compatible = path.endsWith('.playable.mp4');
process.stdout.write(JSON.stringify({
  format: { duration: '12' },
  streams: audio
    ? [{ codec_type: 'audio', codec_name: 'mp3' }]
    : [
        {
          codec_type: 'video',
          codec_name: compatible ? 'h264' : ${JSON.stringify(videoCodec)},
          pix_fmt: 'yuv420p',
          width: 1920,
          height: 1080
        },
        { codec_type: 'audio', codec_name: 'aac' }
      ]
}));
`);
  const config = createDefaultCreatorServicesConfig();
  config.proxy = 'http://127.0.0.1:7897';
  return {
    configStore: { read: async () => config },
    ytDlpPath: input?.portableRuntime ? process.execPath : ytDlpPath,
    ...(input?.portableRuntime
      ? {
          ytDlpPrefixArgs: [ytDlpPath, '--portable-runtime'],
          ytDlpEnv: {
            SSL_CERT_FILE: '/runtime/cacert.pem'
          }
        }
      : {}),
    ffmpegPath,
    ffprobePath
  };
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o755);
}

async function writeProbeArtifact(
  workdir: string,
  probe: DownloadProbe
): Promise<CreatorArtifact> {
  const path = join(workdir, 'probe.json');
  await writeFile(path, JSON.stringify(probe));
  return {
    id: 'probe_artifact',
    jobId: 'download_job',
    kind: 'download_probe',
    version: 1,
    status: 'completed',
    path,
    sourceArtifactIds: [],
    metadata: {},
    createdAt: '2026-08-30T00:00:00.000Z'
  };
}

function stageInput(input: {
  workdir: string;
  stageId: 'probe' | 'download';
  state: CreatorJob['state'];
  progress?: CreatorStageRun['progress'];
  inputArtifacts?: CreatorArtifact[];
  reportProgress?: CreatorExecutorInput['reportProgress'];
}): CreatorExecutorInput {
  const createdAt = '2026-08-30T00:00:00.000Z';
  const job: CreatorJob = {
    id: 'download_job',
    projectId: 'project_1',
    templateId: 'video-download',
    templateVersion: 2,
    status: 'running',
    revision: 1,
    state: input.state,
    agentThreadId: null,
    stages: [],
    artifacts: input.inputArtifacts ?? [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
  const stageRun: CreatorStageRun = {
    id: `stage_${input.stageId}`,
    jobId: job.id,
    stageId: input.stageId,
    executor: 'download',
    status: 'running',
    dispatchStatus: 'claimed',
    claimOwner: 'test',
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: null,
    progress: input.progress ?? {},
    errorCode: null,
    errorMessage: null,
    startedAt: createdAt,
    finishedAt: null
  };
  return {
    stageRun,
    job,
    inputArtifacts: input.inputArtifacts ?? [],
    workdir: input.workdir,
    signal: new AbortController().signal,
    reportProgress: input.reportProgress ?? vi.fn()
  };
}
