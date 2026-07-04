import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import type { CreateRuntimeThreadInput, RuntimeThread } from './types.js';

export type CreateThreadManagerInput = {
  dataDir: string;
};

export function createThreadManager(input: CreateThreadManagerInput) {
  return {
    createThread(request: CreateRuntimeThreadInput): RuntimeThread {
      const id = `thread_${nanoid(10)}`;
      const workspaceMode = request.workspaceMode ?? 'managed';
      const cwd =
        workspaceMode === 'managed'
          ? join(input.dataDir, 'workspaces', id)
          : request.cwd ?? process.cwd();
      mkdirSync(cwd, { recursive: true });

      return {
        id,
        cwd,
        canonicalCwd: realpathSync(cwd),
        workspaceMode,
        profile: request.profile ?? 'default',
        sandbox: request.sandbox ?? 'read-only',
        status: 'active'
      };
    }
  };
}
