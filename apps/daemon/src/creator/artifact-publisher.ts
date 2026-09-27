import type { CreatorJob, ProjectResponse } from '@opencreator/protocol';
import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';

const publishableKinds = new Set([
  'source_subtitle',
  'target_subtitle',
  'bilingual_subtitle',
  'dubbed_audio',
  'horizontal_video',
  'vertical_video',
  'auto_clip_video',
  'clean_video',
  'bilingual_video',
  'cover_image',
  'generated_image',
  'generated_video',
  'publish_copy',
  'script_manifest',
  'clip_candidates'
]);

export async function publishCreatorArtifacts(input: {
  job: CreatorJob;
  project: ProjectResponse;
  outputRoot: string;
}): Promise<string[]> {
  const published: string[] = [];
  for (const artifact of input.job.artifacts) {
    if (
      artifact.path === null
      || artifact.status !== 'completed'
      || !publishableKinds.has(artifact.kind)
    ) continue;

    const version = positiveInteger(artifact.metadata.resultVersion) ?? artifact.version;
    const directory = resolve(
      input.outputRoot,
      safeSegment(`${input.project.name}-${input.project.id}`),
      safeSegment(`${input.job.templateId}-${input.job.id}`),
      `V${version}`
    );
    await mkdir(directory, { recursive: true });
    const sourceName = typeof artifact.metadata.fileName === 'string'
      ? artifact.metadata.fileName
      : basename(artifact.path);
    const extension = extname(sourceName) || extname(artifact.path);
    const destination = join(
      directory,
      `${safeSegment(`${artifact.kind}-${artifact.version}`)}${extension}`
    );
    const temporary = `${destination}.tmp-${process.pid}`;
    try {
      await copyFile(artifact.path, temporary);
      await rename(temporary, destination);
      published.push(destination);
    } finally {
      await rm(temporary, { force: true });
    }
  }
  return published;
}

function safeSegment(value: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
  return normalized.length > 0 ? normalized.slice(0, 120) : 'untitled';
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}
