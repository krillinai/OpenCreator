import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname, join } from 'node:path';
import { createCodexIsolatedHome } from '../../codex/probe-home.js';

export type CreatorAgentBootstrapResult = {
  available: boolean;
  codexHome: string;
  skillPath: string;
  guideId: 'opencreator-runtime';
  guideVersion: number;
  hash: string;
  error?: string;
};

export function bootstrapCreatorAgentRuntime(input: {
  sourceCodexHome: string;
  runtimeRoot: string;
  bundledSkillDir: string;
}): CreatorAgentBootstrapResult {
  const codexHome = join(input.runtimeRoot, 'codex-home');
  const skillPath = join(codexHome, 'skills', 'opencreator-runtime');
  try {
    createCodexIsolatedHome(input.sourceCodexHome, codexHome);
    const manifest = JSON.parse(readFileSync(join(input.bundledSkillDir, 'manifest.json'), 'utf8')) as { version: number };
    const hash = hashSkill(input.bundledSkillDir);
    const currentHash = existsSync(join(skillPath, '.opencreator-hash'))
      ? readFileSync(join(skillPath, '.opencreator-hash'), 'utf8').trim()
      : '';
    if (currentHash !== hash) syncSkill(input.bundledSkillDir, skillPath, hash);
    return {
      available: true,
      codexHome,
      skillPath,
      guideId: 'opencreator-runtime',
      guideVersion: manifest.version,
      hash
    };
  } catch (error) {
    return {
      available: false,
      codexHome,
      skillPath,
      guideId: 'opencreator-runtime',
      guideVersion: 1,
      hash: '',
      error: error instanceof Error ? error.message : 'Creator Agent bootstrap failed'
    };
  }
}

function syncSkill(source: string, destination: string, hash: string): void {
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}`;
  const backup = `${destination}.previous`;
  rmSync(temporary, { recursive: true, force: true });
  cpSync(source, temporary, { recursive: true, force: true });
  writeFileSync(join(temporary, '.opencreator-hash'), `${hash}\n`, { mode: 0o600 });
  rmSync(backup, { recursive: true, force: true });
  if (existsSync(destination)) renameSync(destination, backup);
  try {
    renameSync(temporary, destination);
    rmSync(backup, { recursive: true, force: true });
  } catch (error) {
    if (existsSync(backup) && !existsSync(destination)) renameSync(backup, destination);
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function hashSkill(path: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(join(path, 'SKILL.md')));
  hash.update(readFileSync(join(path, 'manifest.json')));
  return hash.digest('hex');
}
