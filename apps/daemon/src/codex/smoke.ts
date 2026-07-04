import { spawnSync } from 'node:child_process';

export type SmokeCommandResult = {
  command: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export function runSmokeCommand(command: string[]): SmokeCommandResult {
  const [bin, ...args] = command;
  if (!bin) {
    throw new Error('empty command');
  }

  const result = spawnSync(bin, args, {
    encoding: 'utf8',
    timeout: 30000
  });

  return {
    command,
    exitCode: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}
