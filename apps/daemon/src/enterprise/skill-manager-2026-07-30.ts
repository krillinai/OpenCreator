import type {
  CodexSkillResponse,
  EnterpriseSkillDetailResponse,
  EnterpriseSkillListResponse,
  EnterpriseSkillMutationResponse,
  EnterpriseSkillResponse,
  RuntimeErrorCode
} from '@clawee/protocol';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type {
  SkillManager,
  SkillWriteTransaction
} from '../codex/skills/manager.js';
import type { SkillMarketRecordRepository } from '../codex/skills/market-records.js';
import type {
  EnterpriseInstallRecordRepository,
  EnterpriseSkillInstallRecord
} from './install-records-2026-07-30.js';
import type {
  EnterpriseHttpClient,
  EnterpriseRemoteSkill,
  EnterpriseRemoteSkillDetail
} from './http-client-2026-07-30.js';
import { EnterpriseHttpError } from './http-client-2026-07-30.js';
import type { EnterpriseSessionManager } from './session-manager-2026-07-30.js';
import { EnterpriseSessionError } from './session-manager-2026-07-30.js';
import { extractEnterpriseSkillPackage } from './skill-package-2026-07-30.js';
import { computeEnterpriseSkillContentDigest } from './skill-content-digest-2026-07-30.js';

export type EnterpriseSkillManager = {
  listSkills(): Promise<EnterpriseSkillListResponse>;
  getSkillDetail(skillId: string): Promise<EnterpriseSkillDetailResponse>;
  installSkill(skillId: string): Promise<EnterpriseSkillMutationResponse>;
  updateSkill(skillId: string): Promise<EnterpriseSkillMutationResponse>;
};

export class EnterpriseSkillManagerError extends Error {
  constructor(
    readonly code: RuntimeErrorCode,
    readonly statusCode: number
  ) {
    super(`${code}: enterprise skill operation failed`);
    this.name = 'EnterpriseSkillManagerError';
  }
}

export function computeEnterpriseSkillState(input: {
  remote?: EnterpriseRemoteSkill;
  local?: CodexSkillResponse;
  publicRecordExists?: boolean;
  enterpriseRecord?: EnterpriseSkillInstallRecord;
  localContentSha256?: string;
}): EnterpriseSkillResponse {
  const identity = input.remote ?? input.enterpriseRecord;
  if (identity === undefined) {
    throw new Error('ENTERPRISE_PROTOCOL_ERROR: skill identity is required');
  }

  const base = {
    skillId: identity.skillId,
    name: identity.name,
    ...(input.remote?.description === undefined
      ? {}
      : { description: input.remote.description }),
    ...(input.remote?.version === undefined
      ? {}
      : { version: input.remote.version }),
    ...(input.enterpriseRecord?.version === undefined
      ? {}
      : { installedVersion: input.enterpriseRecord.version }),
    ...(input.remote?.updatedAt === undefined
      ? {}
      : { updatedAt: input.remote.updatedAt })
  };

  if (input.local === undefined) {
    return {
      ...base,
      status: 'not_installed',
      integrity: 'not_applicable',
      actions: ['install']
    };
  }
  if (input.local.status !== 'valid') {
    return {
      ...base,
      status: 'invalid',
      integrity: 'unknown',
      actions: []
    };
  }
  if (
    input.publicRecordExists === true ||
    (
      input.enterpriseRecord !== undefined &&
      (
        input.enterpriseRecord.skillId !== identity.skillId ||
        input.enterpriseRecord.name !== identity.name
      )
    )
  ) {
    return {
      ...base,
      status: 'name_conflict',
      integrity: 'unknown',
      actions: []
    };
  }
  if (input.enterpriseRecord === undefined) {
    return {
      ...base,
      status: 'installed_unknown_source',
      integrity: 'unknown',
      actions: ['use']
    };
  }

  const integrity =
    input.localContentSha256 === undefined
      ? 'unknown'
      : input.localContentSha256 ===
          input.enterpriseRecord.installedContentSha256
        ? 'verified'
        : 'local_changed';
  const status =
    input.remote === undefined
      ? 'unpublished'
      : input.remote.packageSha256 === input.enterpriseRecord.packageSha256
        ? 'installed'
        : 'update_available';
  const actions =
    integrity === 'local_changed'
      ? ['use'] as const
      : status === 'update_available'
        ? ['update', 'use'] as const
        : ['use'] as const;

  return {
    ...base,
    status,
    integrity,
    actions: [...actions]
  };
}

export function createEnterpriseSkillManager(input: {
  dataDir: string;
  sessionManager: EnterpriseSessionManager;
  httpClient: EnterpriseHttpClient;
  skillManager: SkillManager;
  publicRecords: SkillMarketRecordRepository;
  records: EnterpriseInstallRecordRepository;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
  computeContentDigest?: (path: string) => Promise<string>;
  extractPackage?: typeof extractEnterpriseSkillPackage;
  cleanupWorkDir?: (path: string) => void | Promise<void>;
}): EnterpriseSkillManager {
  const sleep = input.sleep ?? (milliseconds => delay(milliseconds));
  const now = input.now ?? (() => new Date());
  const computeContentDigest =
    input.computeContentDigest ?? computeEnterpriseSkillContentDigest;
  const extractPackage = input.extractPackage ?? extractEnterpriseSkillPackage;
  const cleanupWorkDir =
    input.cleanupWorkDir ??
    (path => rm(path, { force: true, recursive: true }));

  async function requireToken(): Promise<string> {
    try {
      return await input.sessionManager.requireAccessToken();
    } catch (error) {
      if (error instanceof EnterpriseSessionError) {
        throw new EnterpriseSkillManagerError(error.code, error.statusCode);
      }
      throw error;
    }
  }

  async function retryRead<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (error instanceof EnterpriseHttpError) {
          if (error.code === 'ENTERPRISE_UNAUTHORIZED') {
            await input.sessionManager.invalidateUnauthorized();
            throw new EnterpriseSkillManagerError(
              'ENTERPRISE_SESSION_EXPIRED',
              401
            );
          }
          const retryable =
            error.code === 'ENTERPRISE_SERVICE_UNAVAILABLE' ||
            error.code === 'ENTERPRISE_RATE_LIMITED';
          if (retryable && attempt < 2) {
            const fallback = attempt === 0 ? 250 : 500;
            const wait =
              error.code === 'ENTERPRISE_RATE_LIMITED'
                ? Math.min(error.retryAfterMs ?? fallback, 2_000)
                : fallback;
            await sleep(wait);
            continue;
          }
          throw managerErrorFromHttp(error);
        }
        throw error;
      }
    }
    throw new EnterpriseSkillManagerError(
      'ENTERPRISE_SERVICE_UNAVAILABLE',
      503
    );
  }

  async function listSkills(): Promise<EnterpriseSkillListResponse> {
    const accessToken = await requireToken();
    const remoteSkills = await retryRead(
      () => input.httpClient.listSkills(accessToken)
    );
    return {
      skills: await aggregateRemoteList(remoteSkills),
      refreshedAt: now().toISOString()
    };
  }

  async function aggregateRemoteList(
    remoteSkills: EnterpriseRemoteSkill[]
  ): Promise<EnterpriseSkillResponse[]> {
    const localByName = new Map(
      input.skillManager.listSkills().skills.map(skill => [skill.id, skill])
    );
    const remoteIds = new Set(remoteSkills.map(skill => skill.skillId));
    const results: EnterpriseSkillResponse[] = [];

    for (const remote of remoteSkills) {
      const local = localByName.get(remote.name);
      const record = resolveRecordForRemote(remote);
      results.push(computeEnterpriseSkillState({
        remote,
        ...(local === undefined ? {} : { local }),
        publicRecordExists: input.publicRecords.getRecord(remote.name) !== undefined,
        ...(record === undefined ? {} : { enterpriseRecord: record }),
        ...(await localDigest(local, record))
      }));
    }

    for (const record of input.records.listRecords()) {
      if (remoteIds.has(record.skillId)) continue;
      const local = localByName.get(record.name);
      if (local === undefined) continue;
      results.push(computeEnterpriseSkillState({
        local,
        enterpriseRecord: record,
        publicRecordExists: input.publicRecords.getRecord(record.name) !== undefined,
        ...(await localDigest(local, record))
      }));
    }
    return results;
  }

  function resolveRecordForRemote(
    remote: EnterpriseRemoteSkill
  ): EnterpriseSkillInstallRecord | undefined {
    const byName = input.records.getByName(remote.name);
    if (byName !== undefined && byName.skillId !== remote.skillId) return byName;
    return input.records.getBySkillId(remote.skillId) ?? byName;
  }

  async function localDigest(
    local: CodexSkillResponse | undefined,
    record: EnterpriseSkillInstallRecord | undefined
  ): Promise<{ localContentSha256?: string }> {
    if (local?.status !== 'valid' || record === undefined) return {};
    try {
      return {
        localContentSha256: await computeContentDigest(local.skillPath)
      };
    } catch {
      return {};
    }
  }

  async function getSkillDetail(
    skillId: string
  ): Promise<EnterpriseSkillDetailResponse> {
    const accessToken = await requireToken();
    const remote = await retryRead(
      () => input.httpClient.getSkillDetail(accessToken, skillId)
    );
    const local = input.skillManager.getSkill(remote.name);
    const record = resolveRecordForRemote(remote);
    return {
      ...computeEnterpriseSkillState({
        remote,
        ...(local === undefined ? {} : { local }),
        publicRecordExists: input.publicRecords.getRecord(remote.name) !== undefined,
        ...(record === undefined ? {} : { enterpriseRecord: record }),
        ...(await localDigest(local, record))
      }),
      ...(remote.changelog === undefined
        ? {}
        : { changelog: remote.changelog })
    };
  }

  async function mutateSkill(
    skillId: string,
    overwrite: boolean
  ): Promise<EnterpriseSkillMutationResponse> {
    const accessToken = await requireToken();
    let detail: EnterpriseRemoteSkillDetail;
    try {
      detail = await input.httpClient.getSkillDetail(accessToken, skillId);
    } catch (error) {
      if (
        error instanceof EnterpriseHttpError &&
        (
          error.code === 'ENTERPRISE_SKILL_NOT_FOUND' ||
          error.code === 'ENTERPRISE_SKILL_VERSION_CHANGED'
        )
      ) {
        await refreshCatalogQuietly(accessToken);
      }
      throw mapMutationError(error);
    }

    const parent = join(input.dataDir, 'enterprise-skill-installs');
    await mkdir(parent, { mode: 0o700, recursive: true });
    const workDir = await mkdtemp(join(parent, 'mutation-'));
    const archivePath = join(workDir, 'package.zip');
    const extractionPath = join(workDir, 'extracted');
    let workDirCleaned = false;

    try {
      try {
        await input.httpClient.downloadSkillPackage({
          accessToken,
          skillId: detail.skillId,
          versionId: detail.versionId,
          expectedSha256: detail.packageSha256,
          destinationPath: archivePath
        });
      } catch (error) {
        if (
          error instanceof EnterpriseHttpError &&
          error.code === 'ENTERPRISE_SKILL_PACKAGE_HASH_MISMATCH'
        ) {
          const latest = await input.httpClient.getSkillDetail(
            accessToken,
            skillId
          ).catch(() => undefined);
          if (
            latest !== undefined &&
            (
              latest.versionId !== detail.versionId ||
              latest.packageSha256 !== detail.packageSha256
            )
          ) {
            throw new EnterpriseSkillManagerError(
              'ENTERPRISE_SKILL_VERSION_CHANGED',
              409
            );
          }
        }
        throw mapMutationError(error);
      }

      let extracted;
      try {
        extracted = await extractPackage({
          archivePath,
          extractionPath,
          expectedName: detail.name
        });
      } catch (error) {
        throw mapMutationError(error);
      }

      return await input.skillManager.withWriteTransaction(
        async transaction => {
          const record = assertMutationAllowed({
            detail,
            overwrite,
            transaction
          });
          if (overwrite) {
            const local = transaction.getSkill(detail.name)!;
            const currentDigest = await computeContentDigest(local.skillPath);
            if (currentDigest !== record!.installedContentSha256) {
              throw new EnterpriseSkillManagerError(
                'ENTERPRISE_SKILL_LOCAL_CHANGED',
                409
              );
            }
          }

          const result = await transaction.installSkill({
            id: detail.name,
            sourcePath: extracted.sourcePath,
            ...(overwrite ? { overwrite: true } : {}),
            confirmWriteToCodexHome: true
          });
          const backupPath = result.operation.backupPath ?? null;
          if (overwrite && result.operation.operation !== 'overwrite') {
            throw await rollbackError(
              transaction,
              detail.name,
              backupPath,
              new EnterpriseSkillManagerError(
                'ENTERPRISE_SKILL_SOURCE_CONFLICT',
                409
              )
            );
          }

          try {
            const targetDigest = await computeContentDigest(
              result.skill.skillPath
            );
            if (targetDigest !== extracted.contentSha256) {
              throw new Error('installed content digest mismatch');
            }
            await cleanupWorkDir(workDir);
            workDirCleaned = true;

            const futureRecord: EnterpriseSkillInstallRecord = {
              skillId: detail.skillId,
              name: detail.name,
              versionId: detail.versionId,
              version: detail.version,
              packageSha256: detail.packageSha256,
              installedContentSha256: targetDigest,
              installedAt: record?.installedAt ?? now().toISOString(),
              updatedAt: now().toISOString()
            };
            const response: EnterpriseSkillMutationResponse = {
              skill: computeEnterpriseSkillState({
                remote: detail,
                local: result.skill,
                enterpriseRecord: futureRecord,
                localContentSha256: targetDigest
              }),
              localSkill: result.skill,
              operation: result.operation
            };

            input.records.upsertRecord({
              skillId: futureRecord.skillId,
              name: futureRecord.name,
              versionId: futureRecord.versionId,
              version: futureRecord.version,
              packageSha256: futureRecord.packageSha256,
              installedContentSha256: futureRecord.installedContentSha256
            });
            return response;
          } catch (error) {
            throw await rollbackError(
              transaction,
              detail.name,
              backupPath,
              new EnterpriseSkillManagerError(
                'ENTERPRISE_SKILL_INSTALL_FAILED',
                500
              )
            );
          }
        }
      );
    } finally {
      if (!workDirCleaned) {
        await Promise.resolve(cleanupWorkDir(workDir)).catch(() => undefined);
      }
    }
  }

  function assertMutationAllowed(request: {
    detail: EnterpriseRemoteSkillDetail;
    overwrite: boolean;
    transaction: SkillWriteTransaction;
  }): EnterpriseSkillInstallRecord | undefined {
    const local = request.transaction.getSkill(request.detail.name);
    const publicRecord = input.publicRecords.getRecord(request.detail.name);
    const bySkillId = input.records.getBySkillId(request.detail.skillId);
    const byName = input.records.getByName(request.detail.name);
    const correctRecord =
      bySkillId !== undefined &&
      bySkillId.name === request.detail.name &&
      (byName === undefined || byName.skillId === request.detail.skillId)
        ? bySkillId
        : undefined;

    if (!request.overwrite) {
      const conflictingEnterpriseRecord =
        (byName !== undefined && byName.skillId !== request.detail.skillId) ||
        (bySkillId !== undefined && bySkillId.name !== request.detail.name);
      if (
        local !== undefined ||
        publicRecord !== undefined ||
        conflictingEnterpriseRecord
      ) {
        throw new EnterpriseSkillManagerError(
          'ENTERPRISE_SKILL_SOURCE_CONFLICT',
          409
        );
      }
      return correctRecord;
    }

    if (
      local?.status !== 'valid' ||
      publicRecord !== undefined ||
      correctRecord === undefined
    ) {
      throw new EnterpriseSkillManagerError(
        'ENTERPRISE_SKILL_SOURCE_CONFLICT',
        409
      );
    }
    return correctRecord;
  }

  async function refreshCatalogQuietly(accessToken: string): Promise<void> {
    await input.httpClient.listSkills(accessToken).catch(() => undefined);
  }

  return {
    listSkills,
    getSkillDetail,
    installSkill(skillId) {
      return mutateSkill(skillId, false);
    },
    updateSkill(skillId) {
      return mutateSkill(skillId, true);
    }
  };
}

async function rollbackError(
  transaction: SkillWriteTransaction,
  skillName: string,
  backupPath: string | null,
  error: EnterpriseSkillManagerError
): Promise<EnterpriseSkillManagerError> {
  try {
    await transaction.rollbackSkillInstall(skillName, backupPath);
    return error;
  } catch {
    return new EnterpriseSkillManagerError(
      'ENTERPRISE_SKILL_INSTALL_FAILED',
      500
    );
  }
}

function mapMutationError(error: unknown): EnterpriseSkillManagerError {
  if (error instanceof EnterpriseSkillManagerError) return error;
  if (error instanceof EnterpriseHttpError) return managerErrorFromHttp(error);
  if (error instanceof Error) {
    const code = error.message.split(':', 1)[0];
    if (code === 'ENTERPRISE_SKILL_PACKAGE_INVALID') {
      return new EnterpriseSkillManagerError(code, 422);
    }
  }
  return new EnterpriseSkillManagerError(
    'ENTERPRISE_SKILL_INSTALL_FAILED',
    500
  );
}

function managerErrorFromHttp(
  error: EnterpriseHttpError
): EnterpriseSkillManagerError {
  const statusCode = error.statusCode ?? defaultStatusCode(error.code);
  return new EnterpriseSkillManagerError(error.code, statusCode);
}

function defaultStatusCode(code: RuntimeErrorCode): number {
  switch (code) {
    case 'ENTERPRISE_INVALID_REQUEST':
      return 400;
    case 'ENTERPRISE_UNAUTHORIZED':
    case 'ENTERPRISE_SESSION_EXPIRED':
      return 401;
    case 'ENTERPRISE_FORBIDDEN':
      return 403;
    case 'ENTERPRISE_SKILL_NOT_FOUND':
      return 404;
    case 'ENTERPRISE_SKILL_VERSION_CHANGED':
    case 'ENTERPRISE_SKILL_SOURCE_CONFLICT':
    case 'ENTERPRISE_SKILL_LOCAL_CHANGED':
      return 409;
    case 'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE':
      return 413;
    case 'ENTERPRISE_RATE_LIMITED':
      return 429;
    case 'ENTERPRISE_SKILL_PACKAGE_INVALID':
    case 'ENTERPRISE_SKILL_PACKAGE_HASH_MISMATCH':
      return 422;
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return 503;
    default:
      return 500;
  }
}
