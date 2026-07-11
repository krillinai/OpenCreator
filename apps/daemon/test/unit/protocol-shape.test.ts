import { describe, expect, it } from 'vitest';
import type {
  AgentEventEnvelope,
  CleanupDeleteRequest,
  CleanupDeleteResponse,
  CleanupPreviewResponse,
  CodexSkillMarketInstallRecordResponse,
  CodexSkillMarketMutationResponse,
  CreateScheduleRequest,
  RunDiagnosticsResponse,
  RunRequest,
  RunScheduleNowResponse,
  RuntimeErrorCode,
  WorkspaceDirectoryListRequest,
  WorkspaceDirectoryResponse,
  WorkspaceFileBlobRequest,
  WorkspaceFileContentResponse,
  WorkspaceFileContentRequest,
  WorkspaceFileKind,
  WorkspaceFileMeta,
  WorkspaceFileMetaRequest,
  WorkspaceFileNode,
  WorkspaceFileRevealRequest,
  WorkspaceFileSaveRequest,
  WorkspaceFileSaveResponse,
  WorkspaceFileRevealResponse,
  ScheduleDetailResponse,
  ScheduleOperationListResponse,
  ScheduleResponse
} from '@clawee/protocol';

describe('protocol shape', () => {
  it('allows a minimal run request', () => {
    const request: RunRequest = {
      prompt: 'hello',
      sandbox: 'read-only'
    };
    expect(request.prompt).toBe('hello');
  });

  it('allows a done event envelope', () => {
    const event: AgentEventEnvelope = {
      id: 'evt_1',
      runId: 'run_1',
      seq: 1,
      ts: '2026-07-04T00:00:00.000Z',
      type: 'done',
      payload: {
        type: 'done',
        status: 'succeeded',
        terminationReason: 'completed'
      },
      normalizerVersion: 1
    };
    expect(event.payload.status).toBe('succeeded');
  });

  it('keeps error codes as closed string literals', () => {
    const code: RuntimeErrorCode = 'CODEX_NOT_FOUND';
    expect(code).toBe('CODEX_NOT_FOUND');
  });

  it('allows schedule request and response shapes', () => {
    const request: CreateScheduleRequest = {
      name: 'daily status',
      cron: '0 9 * * *',
      prompt: 'Summarize the project state',
      profile: 'default',
      sandbox: 'workspace-write',
      concurrencyPolicy: 'skip',
      misfirePolicy: 'skip'
    };
    const response: ScheduleResponse = {
      id: 'sch_123',
      name: request.name,
      cron: request.cron,
      timezone: 'Asia/Shanghai',
      enabled: true,
      promptPreviewRedacted: 'Summarize the project state',
      profile: 'default',
      cwd: '/tmp/project',
      canonicalCwd: '/tmp/project',
      model: null,
      reasoning: null,
      sandbox: 'workspace-write',
      timeoutMs: 60000,
      concurrencyPolicy: 'skip',
      misfirePolicy: 'skip',
      nextRunAt: '2026-07-06T01:00:00.000Z',
      lastRunAt: null,
      lastRunId: null,
      lastStatus: null,
      pendingTrigger: false,
      createdAt: '2026-07-06T00:00:00.000Z',
      updatedAt: '2026-07-06T00:00:00.000Z'
    };
    const detail: ScheduleDetailResponse = {
      ...response,
      prompt: request.prompt
    };
    const runNow: RunScheduleNowResponse = {
      run: { id: 'run_1', status: 'running' },
      schedule: response,
      skipped: false,
      queued: false
    };
    const operations: ScheduleOperationListResponse = {
      operations: [
        {
          id: 'schop_1',
          operation: 'run_now',
          scheduleId: 'sch_123',
          status: 'succeeded',
          runId: 'run_1',
          errorCode: null,
          errorMessage: null,
          createdAt: '2026-07-06T00:00:01.000Z'
        }
      ]
    };

    expect(detail.prompt).toBe('Summarize the project state');
    expect(runNow.run?.id).toBe('run_1');
    expect(operations.operations[0]?.operation).toBe('run_now');
  });

  it('includes schedule not found as a closed error code', () => {
    const code: RuntimeErrorCode = 'SCHEDULE_NOT_FOUND';
    expect(code).toBe('SCHEDULE_NOT_FOUND');
  });

  it('allows skill market install record and mutation response shapes', () => {
    const record: CodexSkillMarketInstallRecordResponse = {
      skillId: 'frontend-slides',
      repository: 'zarazhangrui/frontend-slides',
      skillPath: '.',
      commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
      marketRevision: 1,
      installedAt: '2026-07-11T00:00:00.000Z',
      updatedAt: '2026-07-11T00:00:00.000Z'
    };
    const response: CodexSkillMarketMutationResponse = {
      skill: {
        id: 'frontend-slides',
        name: 'Frontend Slides',
        description: 'Slide helpers',
        status: 'valid',
        diagnostics: [],
        codexHome: '/tmp/codex-home',
        codexHomeMode: 'isolated',
        skillsPath: '/tmp/codex-home/skills',
        skillPath: '.',
        skillFilePath: '/tmp/codex-home/skills/frontend-slides/SKILL.md'
      },
      operation: {
        id: 'skillop_1',
        operation: 'install',
        skillId: 'frontend-slides',
        codexHome: '/tmp/codex-home',
        skillsPath: '/tmp/codex-home/skills',
        sourcePath: '/tmp/source/frontend-slides',
        targetPath: '/tmp/codex-home/skills/frontend-slides',
        status: 'succeeded',
        createdAt: '2026-07-11T00:00:00.000Z'
      },
      record
    };

    expect(response.record.marketRevision).toBe(1);
    expect(response.skill.id).toBe('frontend-slides');
  });

  it('includes skill market errors as closed error codes', () => {
    const notFound: RuntimeErrorCode = 'CODEX_SKILL_MARKET_ENTRY_NOT_FOUND';
    const notInstallable: RuntimeErrorCode = 'CODEX_SKILL_MARKET_NOT_INSTALLABLE';
    const downloadFailed: RuntimeErrorCode = 'CODEX_SKILL_MARKET_DOWNLOAD_FAILED';

    expect(notFound).toBe('CODEX_SKILL_MARKET_ENTRY_NOT_FOUND');
    expect(notInstallable).toBe('CODEX_SKILL_MARKET_NOT_INSTALLABLE');
    expect(downloadFailed).toBe('CODEX_SKILL_MARKET_DOWNLOAD_FAILED');
  });

  it('allows run diagnostics response shape', () => {
    const response: RunDiagnosticsResponse = {
      runId: 'run_123',
      files: [
        { name: 'meta.json', content: '{"id":"run_123"}' },
        { name: 'events.ndjson', content: '{"type":"done"}\n' }
      ],
      codexStatusSnapshot: {
        codexBin: 'codex',
        codexVersion: '0.0.0-test',
        codexHome: '/tmp/codex-home',
        codexHomeMode: 'isolated',
        codexHomeSource: 'isolated',
        codexHomeWritable: true,
        capabilities: { execJson: true },
        diagnostics: []
      },
      warnings: ['Diagnostics are redacted on a best-effort basis.']
    };

    expect(response.files[0]?.name).toBe('meta.json');
    expect(response.codexStatusSnapshot.codexHomeMode).toBe('isolated');
  });

  it('allows runtime cleanup request and response shapes', () => {
    const preview: CleanupPreviewResponse = {
      olderThanDays: 30,
      items: [
        {
          type: 'run_logs',
          id: 'run_123',
          path: '/tmp/runtime/runs/run_123',
          sizeBytes: 100,
          lastModifiedAt: '2026-07-06T00:00:00.000Z',
          reason: 'run logs older than 30 days'
        },
        {
          type: 'managed_thread_workspace',
          id: 'thread_123',
          path: '/tmp/runtime/workspaces/thread_123',
          sizeBytes: 200,
          lastModifiedAt: '2026-07-05T00:00:00.000Z',
          reason: 'archived managed thread workspace older than 30 days'
        }
      ],
      totalSizeBytes: 300,
      warnings: []
    };
    const request: CleanupDeleteRequest = { olderThanDays: 30, confirm: true };
    const deleted: CleanupDeleteResponse = {
      deleted: [
        {
          type: 'run_logs',
          id: 'run_123',
          path: '/tmp/runtime/runs/run_123',
          sizeBytes: 100
        }
      ],
      failed: [],
      totalDeletedBytes: 100,
      warnings: []
    };

    expect(preview.totalSizeBytes).toBe(300);
    expect(request.confirm).toBe(true);
    expect(deleted.deleted[0]?.type).toBe('run_logs');
  });

  it('includes cleanup failed as a closed error code', () => {
    const code: RuntimeErrorCode = 'CLEANUP_FAILED';
    expect(code).toBe('CLEANUP_FAILED');
  });

  it('allows workspace file meta shape', () => {
    const meta: WorkspaceFileMeta = {
      path: 'docs/readme.md',
      name: 'readme.md',
      type: 'file',
      kind: 'markdown',
      mime: 'text/markdown; charset=utf-8',
      size: 12,
      mtimeMs: 1000,
      versionToken: '1000:12:sha256:abc',
      previewable: true,
      editable: true,
      readonly: false
    };

    expect(meta.kind).toBe('markdown');
  });

  it('allows workspace file directory and file node shapes', () => {
    const directoryNode: WorkspaceFileNode = {
      path: 'docs',
      name: 'docs',
      depth: 0,
      type: 'directory',
      hasChildren: true,
      childrenLoaded: false,
      meta: {
        kind: 'directory',
        mime: 'inode/directory',
        size: 0,
        mtimeMs: 1000,
        previewable: false,
        editable: false,
        readonly: true,
        reason: 'directory'
      }
    };
    const fileNode: WorkspaceFileNode = {
      path: 'docs/readme.md',
      name: 'readme.md',
      depth: 1,
      type: 'file',
      meta: {
        kind: 'markdown',
        mime: 'text/markdown; charset=utf-8',
        size: 12,
        mtimeMs: 1000,
        previewable: true,
        editable: true,
        readonly: false
      }
    };

    expect(directoryNode.childrenLoaded).toBe(false);
    expect(fileNode.meta?.kind).toBe('markdown');
  });

  it('allows workspace directory response shape', () => {
    const listRequest: WorkspaceDirectoryListRequest = {
      threadId: 'thread_1',
      path: 'docs'
    };
    const metaRequest: WorkspaceFileMetaRequest = {
      threadId: 'thread_1',
      path: 'docs/readme.md'
    };
    const contentRequest: WorkspaceFileContentRequest = {
      threadId: 'thread_1',
      path: 'docs/readme.md'
    };
    const blobRequest: WorkspaceFileBlobRequest = {
      threadId: 'thread_1',
      path: 'docs/readme.png'
    };
    const response: WorkspaceDirectoryResponse = {
      threadId: 'thread_1',
      rootName: 'workspace',
      rootPathLabel: '/',
      path: '/',
      suggestedOpenPath: 'docs/readme.md',
      truncated: false,
      warnings: [],
      nodes: [
        {
          path: 'docs',
          name: 'docs',
          depth: 0,
          type: 'directory',
          hasChildren: true,
          childrenLoaded: false
        }
      ]
    };

    expect(listRequest.path).toBe('docs');
    expect(metaRequest.threadId).toBe('thread_1');
    expect(contentRequest.path).toBe('docs/readme.md');
    expect(blobRequest.path).toBe('docs/readme.png');
    expect(response.threadId).toBe('thread_1');
    expect(response.nodes[0]?.type).toBe('directory');
  });

  it('allows workspace file content, save and reveal request shapes', () => {
    const contentResponse: WorkspaceFileContentResponse = {
      meta: {
        path: 'docs/readme.md',
        name: 'readme.md',
        type: 'file',
        kind: 'markdown',
        mime: 'text/markdown; charset=utf-8',
        size: 12,
        mtimeMs: 1000,
        versionToken: '1000:12:sha256:abc',
        previewable: true,
        editable: true,
        readonly: false
      },
      content: '# readme',
      encoding: 'utf8'
    };
    const saveRequest: WorkspaceFileSaveRequest = {
      threadId: 'thread_1',
      path: 'docs/readme.md',
      content: '# updated',
      baseVersionToken: '1000:12:sha256:abc',
      overwriteConflict: false
    };
    const revealRequest: WorkspaceFileRevealRequest = {
      threadId: 'thread_1',
      path: 'docs/readme.md',
      mode: 'file'
    };
    const saveResponse: WorkspaceFileSaveResponse = {
      meta: contentResponse.meta,
      saved: true
    };
    const revealResponse: WorkspaceFileRevealResponse = {
      ok: true
    };

    expect(contentResponse.encoding).toBe('utf8');
    expect(saveRequest.baseVersionToken).toBe('1000:12:sha256:abc');
    expect(revealRequest.mode).toBe('file');
    expect(saveResponse.saved).toBe(true);
    expect(revealResponse.ok).toBe(true);
  });

  it('keeps workspace file runtime error codes closed', () => {
    const codes: RuntimeErrorCode[] = [
      'WORKSPACE_NOT_FOUND',
      'FILE_NOT_FOUND',
      'PATH_INVALID',
      'PATH_ESCAPE',
      'PATH_IGNORED',
      'FILE_TOO_LARGE',
      'UNSUPPORTED_FILE_TYPE',
      'FILE_NOT_EDITABLE',
      'FILE_CONFLICT',
      'PERMISSION_DENIED',
      'REVEAL_UNAVAILABLE'
    ];

    expect(codes).toHaveLength(11);
  });

  it('keeps workspace file kinds closed', () => {
    const kinds: WorkspaceFileKind[] = [
      'directory',
      'markdown',
      'text',
      'json',
      'code',
      'html',
      'image',
      'pdf',
      'binary',
      'unknown'
    ];

    expect(kinds).toHaveLength(10);
  });
});
