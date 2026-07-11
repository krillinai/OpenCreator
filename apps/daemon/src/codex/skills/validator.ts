import { lstatSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseDocument } from 'yaml';
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
  const normalized = content.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return { ok: false, diagnostics: ['SKILL.md missing frontmatter'] };
  }

  const end = normalized.indexOf('\n---\n', 4);
  if (end === -1) return { ok: false, diagnostics: ['SKILL.md frontmatter is not closed'] };

  const frontmatter = normalized.slice(4, end);
  const document = parseDocument(frontmatter, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      ok: false,
      diagnostics: document.errors.map((error) => `SKILL.md frontmatter is invalid: ${error.message}`)
    };
  }
  const values = document.toJS();

  if (!isRecord(values) || typeof values.name !== 'string' || values.name.trim().length === 0) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
