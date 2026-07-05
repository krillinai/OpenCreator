import { lstatSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ParseSkillMarkdownResult } from './types.js';

const SKILL_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

export function isValidSkillId(id: string): boolean {
  return id.length > 0 && id !== '.' && id !== '..' && SKILL_ID_PATTERN.test(id);
}

export function assertValidSkillId(id: string): void {
  if (!isValidSkillId(id)) throw new Error(`CODEX_SKILL_INVALID: invalid skill id: ${id}`);
}

export function deriveSkillId(input: { requestedId?: string; sourcePath: string }): string {
  const id = input.requestedId ?? basename(input.sourcePath);
  assertValidSkillId(id);
  return id;
}

export function parseSkillMarkdown(content: string): ParseSkillMarkdownResult {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return { ok: false, diagnostics: ['SKILL.md missing frontmatter'] };
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { ok: false, diagnostics: ['SKILL.md frontmatter is not closed'] };

  const frontmatter = normalized.slice(4, end);
  const values: Record<string, string> = {};
  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(':');
    if (separator === -1) {
      return { ok: false, diagnostics: [`SKILL.md frontmatter line is invalid: ${line}`] };
    }
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();
    values[key] = unquoteYamlString(rawValue);
  }

  if (typeof values.name !== 'string' || values.name.trim().length === 0) {
    return { ok: false, diagnostics: ['SKILL.md frontmatter name must be a non-empty string'] };
  }
  if (typeof values.description !== 'string' || values.description.trim().length === 0) {
    return { ok: false, diagnostics: ['SKILL.md frontmatter description must be a non-empty string'] };
  }

  return {
    ok: true,
    metadata: {
      name: values.name,
      description: values.description
    },
    diagnostics: []
  };
}

export function assertNoSymlinks(root: string): void {
  const stat = lstatSync(root);
  if (stat.isSymbolicLink()) throw new Error(`CODEX_SKILL_INVALID: symlink is not allowed: ${root}`);
  if (!stat.isDirectory()) return;

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const childStat = lstatSync(path);
    if (childStat.isSymbolicLink()) {
      throw new Error(`CODEX_SKILL_INVALID: symlink is not allowed: ${path}`);
    }
    if (childStat.isDirectory()) assertNoSymlinks(path);
  }
}

function unquoteYamlString(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
