import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { shell } from 'electron';
import type { DesktopHostResult } from '../shared/types.js';

export function ensureDefaultProjectDirectory(root: string): string {
  const path = join(resolve(root), 'Clawee', 'Default Project');
  mkdirSync(path, { recursive: true });
  return path;
}

export function createNamedProjectDirectory(root: string, name: string): string {
  const normalizedName = name.trim();
  if (normalizedName.length === 0) throw new Error('项目名称不能为空');
  if (normalizedName.length > 80) throw new Error('项目名称不能超过 80 个字符');
  if (
    normalizedName === '.'
    || normalizedName === '..'
    || normalizedName.includes('/')
    || normalizedName.includes('\\')
    || normalizedName.includes('\0')
  ) {
    throw new Error('项目名称不能包含路径分隔符');
  }

  const projectRoot = join(resolve(root), 'Clawee');
  const path = join(projectRoot, normalizedName);
  mkdirSync(projectRoot, { recursive: true });
  if (existsSync(path)) throw new Error('同名项目已存在');
  mkdirSync(path);
  return path;
}

export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Only HTTPS links are allowed');
  await shell.openExternal(parsed.toString());
}

export async function revealPath(path: string): Promise<DesktopHostResult> {
  if (!existsSync(path)) {
    return { ok: false, code: 'FAILED', message: '路径不存在' };
  }
  shell.showItemInFolder(path);
  return { ok: true };
}
