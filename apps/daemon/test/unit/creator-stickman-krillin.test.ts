import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { krillinStageTypes } from '@opencreator/protocol';
import {
  resolveKrillinStageContract,
  validateResultArtifacts
} from '../../src/creator/krillin/adapter.js';
import { outputMappings } from '../../src/creator/krillin/cli-runner.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

function stage(stageId: string) {
  return {
    job: { id: 'job-1', templateId: 'stickman-video', state: {} },
    stageRun: { id: 'stage-1', stageId, progress: {} },
    inputArtifacts: []
  } as never;
}

describe('stickman KrillinAI mapping', () => {
  it('maps semantic stages onto the existing Krillin stage enum', () => {
    expect(krillinStageTypes).toEqual([
      'download',
      'subtitle',
      'tts',
      'render-horizontal',
      'render-vertical'
    ]);
    expect(resolveKrillinStageContract(stage('source-transcript'))).toMatchObject({
      stageType: 'subtitle',
      requiredOutputKinds: ['source_subtitle']
    });
    expect(resolveKrillinStageContract(stage('narration'))).toMatchObject({
      stageType: 'tts',
      outputAliases: { dubbed_audio: 'narration_audio' }
    });
    expect(resolveKrillinStageContract(stage('subtitles'))).toMatchObject({
      stageType: 'subtitle',
      requiredOutputKinds: ['bilingual_subtitle']
    });
    expect(resolveKrillinStageContract(stage('bilingual-render'))).toMatchObject({
      stageType: 'render-horizontal',
      outputAliases: { horizontal_video: 'bilingual_video' }
    });
    expect(outputMappings('narration')).toEqual([['tts_audio', 'narration_audio']]);
    expect(outputMappings('bilingual-render')).toEqual([['horizontal_video', 'bilingual_video']]);
  });

  it('rejects undeclared or missing stickman outputs and aliases valid subtitles', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'creator-stickman-krillin-'));
    const jobRoot = join(tempDir, 'job-1');
    mkdirSync(jobRoot, { recursive: true });

    await expect(validateResultArtifacts({
      stage: stage('source-transcript'),
      jobsRoot: tempDir,
      artifacts: [],
      ffprobe: 'unused'
    })).rejects.toMatchObject({ code: 'krillin_output_missing' });
    await expect(validateResultArtifacts({
      stage: stage('source-transcript'),
      jobsRoot: tempDir,
      artifacts: [{
        id: 'bad',
        kind: 'vertical_video',
        relativePath: 'job-1/bad.mp4'
      }],
      ffprobe: 'unused'
    })).rejects.toMatchObject({ code: 'krillin_output_mismatch' });

    const subtitlePath = join(jobRoot, 'source.srt');
    writeFileSync(subtitlePath, '1\n00:00:00,000 --> 00:00:01,000\n测试\n');
    const outputs = await validateResultArtifacts({
      stage: stage('source-transcript'),
      jobsRoot: tempDir,
      artifacts: [{
        id: 'source-subtitle',
        kind: 'source_subtitle',
        relativePath: 'job-1/source.srt'
      }],
      ffprobe: 'unused'
    });
    expect(outputs).toMatchObject([{ kind: 'source_subtitle', status: 'completed' }]);
  });
});
