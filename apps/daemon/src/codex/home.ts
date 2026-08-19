import { homedir } from 'node:os';
import { join } from 'node:path';
import type { CodexHomeMode, CodexHomeSource } from '@opencreator/protocol';
import { expandHome } from '../platform/paths.js';

export type ResolveCodexHomeInput = {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  isolatedHome?: string;
};

export type ResolvedCodexHome = {
  path: string;
  mode: CodexHomeMode;
  source: CodexHomeSource;
  writable: boolean;
};

export function resolveCodexHome(input: ResolveCodexHomeInput = {}): ResolvedCodexHome {
  const env = input.env ?? process.env;
  const homeDir = input.homeDir ?? homedir();

  if (input.isolatedHome !== undefined) {
    return {
      path: expandHome(input.isolatedHome, homeDir),
      mode: 'isolated',
      source: 'isolated',
      writable: true
    };
  }

  if (env.CODEX_HOME && env.CODEX_HOME.trim().length > 0) {
    return {
      path: expandHome(env.CODEX_HOME, homeDir),
      mode: 'global',
      source: 'env',
      writable: false
    };
  }

  return {
    path: join(homeDir, '.codex'),
    mode: 'global',
    source: 'default',
    writable: false
  };
}
