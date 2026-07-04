import { join } from 'node:path';

export function expandHome(input: string, homeDir: string): string {
  if (input === '~') return homeDir;
  if (input.startsWith('~/')) return join(homeDir, input.slice(2));
  return input;
}
