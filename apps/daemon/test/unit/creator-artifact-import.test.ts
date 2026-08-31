import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createCreatorArtifactImportService,
  CreatorArtifactImportError
} from '../../src/creator/artifact-import.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('creator artifact import', () => {
  it.each(['video-translation', 'auto-clip'])(
    'imports a downloaded video into a %s job without fetching the source again',
    async templateId => {
      const runtime = await setup();
      const source = runtime.service.createJob({
        projectId: 'project_1',
        templateId: 'video-download'
      });
      const sourcePath = join(tempDir, 'downloaded-video.mp4');
      await writeFile(sourcePath, 'downloaded-video');
      const sourceArtifact = runtime.repository.insertArtifact({
        jobId: source.id,
        kind: 'source_video',
        status: 'completed',
        path: sourcePath,
        sourceArtifactIds: [],
        metadata: {
          fileName: 'Creator Demo.mp4',
          mimeType: 'video/mp4',
          size: 16,
          sha256: 'source-sha256',
          duration: 12,
          width: 1920,
          height: 1080,
          hasVideo: true,
          hasAudio: true
        }
      });
      const target = runtime.service.createJob({
        projectId: 'project_1',
        templateId
      });

      const imported = await runtime.imports.importArtifact(target.id, {
        expectedRevision: target.revision,
        sourceJobId: source.id,
        artifactId: sourceArtifact.id,
        kind: 'source_video'
      });

      expect(imported.deduplicated).toBe(false);
      expect(imported.artifact).toMatchObject({
        kind: 'source_video',
        status: 'completed',
        sourceArtifactIds: [sourceArtifact.id],
        metadata: {
          source: 'artifact-import',
          importedFromJobId: source.id,
          importedFromArtifactId: sourceArtifact.id,
          fileName: 'Creator Demo.mp4'
        }
      });
      expect(imported.artifact.path).not.toBe(sourcePath);
      expect(await readFile(imported.artifact.path!, 'utf8')).toBe('downloaded-video');
      expect(imported.job).toMatchObject({
        status: 'draft',
        state: {
          sourceType: 'file',
          sourceUrl: '',
          sourceArtifactId: imported.artifact.id,
          sourceFileName: 'Creator Demo.mp4',
          sourceFileSize: 16,
          sourceFileSha256: 'source-sha256'
        }
      });
      runtime.db.close();
    }
  );

  it('rejects imports across project boundaries', async () => {
    const runtime = await setup();
    const source = runtime.service.createJob({
      projectId: 'project_1',
      templateId: 'video-download'
    });
    const sourcePath = join(tempDir, 'source.mp4');
    await writeFile(sourcePath, 'video');
    const artifact = runtime.repository.insertArtifact({
      jobId: source.id,
      kind: 'source_video',
      status: 'completed',
      path: sourcePath,
      sourceArtifactIds: [],
      metadata: { fileName: 'source.mp4' }
    });
    const target = runtime.service.createJob({
      projectId: 'project_2',
      templateId: 'video-translation'
    });

    await expect(runtime.imports.importArtifact(target.id, {
      expectedRevision: target.revision,
      sourceJobId: source.id,
      artifactId: artifact.id,
      kind: 'source_video'
    })).rejects.toEqual(expect.objectContaining<Partial<CreatorArtifactImportError>>({
      code: 'creator_artifact_import_forbidden',
      statusCode: 403
    }));
    runtime.db.close();
  });

  it('rejects unsupported target templates before importing a file', async () => {
    const runtime = await setup();
    const source = runtime.service.createJob({
      projectId: 'project_1',
      templateId: 'video-download'
    });
    const sourcePath = join(tempDir, 'source.mp4');
    await writeFile(sourcePath, 'video');
    const artifact = runtime.repository.insertArtifact({
      jobId: source.id,
      kind: 'source_video',
      status: 'completed',
      path: sourcePath,
      sourceArtifactIds: [],
      metadata: { fileName: 'source.mp4' }
    });
    const target = runtime.service.createJob({
      projectId: 'project_1',
      templateId: 'image-generation'
    });

    await expect(runtime.imports.importArtifact(target.id, {
      expectedRevision: target.revision,
      sourceJobId: source.id,
      artifactId: artifact.id,
      kind: 'source_video'
    })).rejects.toEqual(expect.objectContaining<Partial<CreatorArtifactImportError>>({
      code: 'creator_artifact_import_unsupported',
      statusCode: 400
    }));
    runtime.db.close();
  });
});

async function setup() {
  tempDir = await mkdtemp(join(tmpdir(), 'creator-artifact-import-'));
  const db = openRuntimeDatabase(join(tempDir, 'runtime.sqlite'));
  const repository = createCreatorRepository(db);
  const service = createCreatorService({
    repository,
    templates: createDefaultCreatorTemplateRegistry()
  });
  const imports = createCreatorArtifactImportService({
    jobsRoot: join(tempDir, 'jobs'),
    creator: service
  });
  return { db, repository, service, imports };
}
