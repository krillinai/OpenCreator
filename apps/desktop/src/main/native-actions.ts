import { existsSync } from 'node:fs';
import { shell } from 'electron';
import type { DesktopHostResult } from '../shared/types.js';

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
