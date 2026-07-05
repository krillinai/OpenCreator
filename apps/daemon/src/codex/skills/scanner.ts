import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedCodexHome } from '../home.js';
import type { CodexSkillResponse, SkillScanResult } from './types.js';
import { isValidSkillId, parseSkillMarkdown } from './validator.js';

export function skillsPathForCodexHome(codexHome: string): string {
  return join(codexHome, 'skills');
}

export function scanCodexSkills(input: { codexHome: ResolvedCodexHome }): SkillScanResult {
  const skillsPath = skillsPathForCodexHome(input.codexHome.path);
  const diagnostics: string[] = [];
  const skills = readSkillDirectories(input.codexHome, skillsPath, diagnostics);

  return {
    codexHome: input.codexHome.path,
    codexHomeMode: input.codexHome.mode,
    skillsPath,
    skillsWritable: true,
    requiresWriteConfirmation: input.codexHome.mode === 'global',
    skills: skills.sort((left, right) => left.id.localeCompare(right.id)),
    diagnostics
  };
}

function readSkillDirectories(
  codexHome: ResolvedCodexHome,
  skillsPath: string,
  diagnostics: string[]
): CodexSkillResponse[] {
  if (!existsSync(skillsPath)) return [];

  let entries: Dirent[];
  try {
    entries = readdirSync(skillsPath, { withFileTypes: true });
  } catch (error) {
    diagnostics.push(`Failed to scan skills directory ${skillsPath}: ${formatError(error)}`);
    return [];
  }

  return entries
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const skill = readSkillDirectory(codexHome, skillsPath, entry.name, diagnostics);
      return skill === undefined ? [] : [skill];
    });
}

function readSkillDirectory(
  codexHome: ResolvedCodexHome,
  skillsPath: string,
  id: string,
  diagnostics: string[]
): CodexSkillResponse | undefined {
  if (!isValidSkillId(id)) {
    diagnostics.push(`Ignoring invalid skill directory name: ${id}`);
    return undefined;
  }

  const skillPath = join(skillsPath, id);
  const skillFilePath = join(skillPath, 'SKILL.md');
  let updatedAt: string | undefined;
  try {
    updatedAt = statSync(skillPath).mtime.toISOString();
  } catch (error) {
    diagnostics.push(`Failed to stat skill ${id}: ${formatError(error)}`);
  }

  let content: string;
  try {
    content = readFileSync(skillFilePath, 'utf8');
  } catch (error) {
    return invalidSkill(codexHome, skillsPath, skillPath, skillFilePath, id, [
      `Failed to read SKILL.md: ${formatError(error)}`
    ], updatedAt);
  }

  const parsed = parseSkillMarkdown(content);
  if (!parsed.ok) {
    return invalidSkill(codexHome, skillsPath, skillPath, skillFilePath, id, parsed.diagnostics, updatedAt);
  }

  return {
    id,
    name: parsed.metadata.name,
    description: parsed.metadata.description,
    status: 'valid',
    diagnostics: [],
    codexHome: codexHome.path,
    codexHomeMode: codexHome.mode,
    skillsPath,
    skillPath,
    skillFilePath,
    updatedAt
  };
}

function invalidSkill(
  codexHome: ResolvedCodexHome,
  skillsPath: string,
  skillPath: string,
  skillFilePath: string,
  id: string,
  skillDiagnostics: string[],
  updatedAt?: string
): CodexSkillResponse {
  return {
    id,
    status: 'invalid',
    diagnostics: skillDiagnostics,
    codexHome: codexHome.path,
    codexHomeMode: codexHome.mode,
    skillsPath,
    skillPath,
    skillFilePath,
    updatedAt
  };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
