import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { skillsPathForCodexHome } from './scanner.js';
import { assertNoSymlinks, assertValidSkillId, deriveSkillId, parseSkillMarkdown } from './validator.js';

export type SkillInstaller = {
  install(input: { sourcePath: string; id?: string; overwrite?: boolean }): Promise<{ id: string; backupPath: string | null }>;
  delete(id: string): Promise<{ id: string; backupPath: string | null }>;
  rollback(input: { id: string; backupPath: string | null }): Promise<void>;
};

const locks = new Map<string, Promise<void>>();
let fileCounter = 0;

export function createSkillInstaller(input: { codexHome: string }): SkillInstaller {
  return {
    install(request) {
      return withSkillsLock(input.codexHome, () => installSkill(input.codexHome, request));
    },
    delete(id) {
      return withSkillsLock(input.codexHome, () => deleteSkill(input.codexHome, id));
    },
    rollback(request) {
      return withSkillsLock(input.codexHome, () => rollbackSkill(input.codexHome, request));
    }
  };
}

async function withSkillsLock<T>(codexHome: string, operation: () => T | Promise<T>): Promise<T> {
  const previous = locks.get(codexHome) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolveRelease) => {
    release = resolveRelease;
  });
  const chained = previous.then(() => current, () => current);
  locks.set(codexHome, chained);

  try {
    await previous.catch(() => undefined);
    return await operation();
  } finally {
    release();
    if (locks.get(codexHome) === chained) locks.delete(codexHome);
  }
}

function installSkill(
  codexHome: string,
  request: { sourcePath: string; id?: string; overwrite?: boolean }
): { id: string; backupPath: string | null } {
  if (!existsSync(request.sourcePath)) {
    throw new Error(`CODEX_SKILL_INVALID: sourcePath does not exist: ${request.sourcePath}`);
  }
  const requestedPathStat = lstatSync(request.sourcePath);
  if (requestedPathStat.isSymbolicLink()) {
    throw new Error(`CODEX_SKILL_INVALID: symlink is not allowed: ${request.sourcePath}`);
  }
  const sourcePath = realpathSync(request.sourcePath);
  if (!statSync(sourcePath).isDirectory()) {
    throw new Error(`CODEX_SKILL_INVALID: sourcePath must be a directory: ${request.sourcePath}`);
  }
  assertNoSymlinks(sourcePath);

  const skillFile = join(sourcePath, 'SKILL.md');
  if (!existsSync(skillFile)) throw new Error(`CODEX_SKILL_INVALID: SKILL.md is required: ${skillFile}`);
  const parsed = parseSkillMarkdown(readFileSync(skillFile, 'utf8'));
  if (!parsed.ok) throw new Error(`CODEX_SKILL_INVALID: ${parsed.diagnostics.join('; ')}`);

  const id = deriveSkillId({ requestedId: request.id, sourcePath });
  const skillsPath = skillsPathForCodexHome(codexHome);
  const targetPath = ensurePathInside(skillsPath, id);
  const tempPath = ensurePathInside(skillsPath, `.tmp-install-${id}-${process.pid}-${Date.now()}-${nextFileCounter()}`);
  let backupPath: string | null = null;

  mkdirSync(skillsPath, { recursive: true });
  try {
    if (existsSync(targetPath) && request.overwrite !== true) {
      throw new Error(`CODEX_SKILL_EXISTS: ${id}`);
    }

    cpSync(sourcePath, tempPath, { recursive: true, force: false, errorOnExist: true });
    assertNoSymlinks(tempPath);
    const tempSkill = join(tempPath, 'SKILL.md');
    const tempParsed = parseSkillMarkdown(readFileSync(tempSkill, 'utf8'));
    if (!tempParsed.ok) throw new Error(`CODEX_SKILL_INVALID: ${tempParsed.diagnostics.join('; ')}`);

    if (existsSync(targetPath)) {
      backupPath = backupSkill(codexHome, id, targetPath);
      rmSync(targetPath, { recursive: true, force: true });
    }

    renameSync(tempPath, targetPath);
    return { id, backupPath };
  } catch (error) {
    rmSync(tempPath, { recursive: true, force: true });
    throw error;
  }
}

function deleteSkill(codexHome: string, id: string): { id: string; backupPath: string | null } {
  assertValidSkillId(id);
  const skillsPath = skillsPathForCodexHome(codexHome);
  const targetPath = ensurePathInside(skillsPath, id);
  if (!existsSync(targetPath)) throw new Error(`CODEX_SKILL_NOT_FOUND: ${id}`);

  const backupPath = backupSkill(codexHome, id, targetPath);
  rmSync(targetPath, { recursive: true, force: true });
  return { id, backupPath };
}

function rollbackSkill(codexHome: string, request: { id: string; backupPath: string | null }): void {
  assertValidSkillId(request.id);
  const skillsPath = skillsPathForCodexHome(codexHome);
  const targetPath = ensurePathInside(skillsPath, request.id);
  const tempPath = ensurePathInside(
    skillsPath,
    `.tmp-rollback-${request.id}-${process.pid}-${Date.now()}-${nextFileCounter()}`
  );
  const currentTempPath = ensurePathInside(
    skillsPath,
    `.tmp-rollback-current-${request.id}-${process.pid}-${Date.now()}-${nextFileCounter()}`
  );

  rmSync(tempPath, { recursive: true, force: true });
  rmSync(currentTempPath, { recursive: true, force: true });
  if (request.backupPath === null) {
    try {
      rmSync(targetPath, { recursive: true, force: true });
      return;
    } catch (error) {
      throw wrapSkillWriteFailed(error, `rollback failed for skill: ${request.id}`);
    }
  }

  try {
    if (!existsSync(request.backupPath)) {
      throw new Error(`backupPath does not exist: ${request.backupPath}`);
    }
    const backupStat = lstatSync(request.backupPath);
    if (backupStat.isSymbolicLink() || !backupStat.isDirectory()) {
      throw new Error(`backupPath must be a real directory: ${request.backupPath}`);
    }
    assertNoSymlinks(request.backupPath);
    cpSync(request.backupPath, tempPath, { recursive: true, force: false, errorOnExist: true });
    assertNoSymlinks(tempPath);
  } catch (error) {
    rmSync(tempPath, { recursive: true, force: true });
    throw wrapSkillWriteFailed(error, `rollback failed for skill: ${request.id}`);
  }

  let currentSnapshotCreated = false;
  try {
    if (existsSync(targetPath)) {
      renameSync(targetPath, currentTempPath);
      currentSnapshotCreated = true;
    }
    renameSync(tempPath, targetPath);
    rmSync(currentTempPath, { recursive: true, force: true });
  } catch (error) {
    if (currentSnapshotCreated && !existsSync(targetPath) && existsSync(currentTempPath)) {
      try {
        renameSync(currentTempPath, targetPath);
        currentSnapshotCreated = false;
      } catch {
        // Preserve the snapshot path in the wrapped error below.
      }
    }
    const tempMessage = existsSync(tempPath) ? `; prepared backup remains at ${tempPath}` : '';
    const currentMessage = currentSnapshotCreated && existsSync(currentTempPath)
      ? `; previous target remains at ${currentTempPath}`
      : '';
    throw wrapSkillWriteFailed(error, `rollback failed for skill: ${request.id}${tempMessage}${currentMessage}`);
  }
}

function backupSkill(codexHome: string, id: string, targetPath: string): string {
  const backupRoot = join(codexHome, 'backups', 'skills');
  mkdirSync(backupRoot, { recursive: true });
  const backupPath = join(
    backupRoot,
    `${id}.${new Date().toISOString().replace(/[:.]/g, '-')}.${nextFileCounter()}.bak`
  );
  cpSync(targetPath, backupPath, { recursive: true, force: false, errorOnExist: true });
  return backupPath;
}

function ensurePathInside(parent: string, childName: string): string {
  const target = resolve(parent, childName);
  const normalizedParent = resolve(parent);
  const relativeTarget = relative(normalizedParent, target);
  if (
    relativeTarget !== ''
    && relativeTarget !== '..'
    && !relativeTarget.startsWith(`..${sep}`)
    && !isAbsolute(relativeTarget)
  ) {
    return target;
  }
  throw new Error(`CODEX_SKILL_INVALID: target path escapes skills directory: ${childName}`);
}

function nextFileCounter(): number {
  fileCounter = (fileCounter + 1) % Number.MAX_SAFE_INTEGER;
  return fileCounter;
}

function wrapSkillWriteFailed(error: unknown, message: string): Error {
  if (error instanceof Error && error.message.startsWith('CODEX_SKILL_WRITE_FAILED:')) return error;
  return new Error(`CODEX_SKILL_WRITE_FAILED: ${message}`, { cause: error });
}
