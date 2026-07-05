import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { join, resolve } from 'node:path';
import { skillsPathForCodexHome } from './scanner.js';
import { assertNoSymlinks, assertValidSkillId, deriveSkillId, parseSkillMarkdown } from './validator.js';

export type SkillInstaller = {
  install(input: { sourcePath: string; id?: string; overwrite?: boolean }): Promise<{ id: string; backupPath: string | null }>;
  delete(id: string): Promise<{ id: string; backupPath: string | null }>;
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
  if (target !== normalizedParent && target.startsWith(`${normalizedParent}/`)) return target;
  throw new Error(`CODEX_SKILL_INVALID: target path escapes skills directory: ${childName}`);
}

function nextFileCounter(): number {
  fileCounter = (fileCounter + 1) % Number.MAX_SAFE_INTEGER;
  return fileCounter;
}
