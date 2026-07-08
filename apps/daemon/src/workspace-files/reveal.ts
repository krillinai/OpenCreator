import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { WorkspaceFileError } from './errors.js';

const execFileAsync = promisify(execFile);

export type RevealExecutor = (request: { absolutePath: string; mode: 'file' | 'directory' }) => Promise<void> | void;

export const defaultRevealExecutor: RevealExecutor = async ({ absolutePath, mode }) => {
  if (platform() !== 'darwin') {
    throw new WorkspaceFileError('REVEAL_UNAVAILABLE', 'Reveal is only available on macOS.');
  }
  const args = mode === 'file' ? ['-R', absolutePath] : [absolutePath];
  await execFileAsync('open', args);
};

export function createDefaultRevealExecutor(): RevealExecutor {
  return defaultRevealExecutor;
}
