import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'toml';
import type { ResolvedCodexHome } from '../home.js';
import { parseCodexProfileOverlay, profileNameFromFileName } from './config.js';
import type { CodexProfile, TomlProfileConfig } from './types.js';
import { createProfileWriter } from './writer.js';

export type ProfileManager = {
  listProfiles(): { profiles: CodexProfile[]; diagnostics: string[]; baseConfigValid: boolean };
  getProfile(name: string): CodexProfile | undefined;
  createProfile(name: string, config: TomlProfileConfig): Promise<void>;
  updateProfile(name: string, config: TomlProfileConfig): Promise<void>;
  deleteProfile(name: string): Promise<void>;
  validateProfileForRun(name: string): { ok: true } | { ok: false; code: string; message: string };
};

export function createProfileManager(input: { codexHome: ResolvedCodexHome }): ProfileManager {
  const writer = createProfileWriter({ codexHome: input.codexHome.path });

  return {
    listProfiles() {
      return listProfiles(input.codexHome);
    },
    getProfile(name) {
      return listProfiles(input.codexHome).profiles.find((profile) => profile.name === name);
    },
    createProfile(name, config) {
      assertWritable(input.codexHome.writable);
      return writer.create(name, config);
    },
    updateProfile(name, config) {
      assertWritable(input.codexHome.writable);
      return writer.update(name, config);
    },
    deleteProfile(name) {
      assertWritable(input.codexHome.writable);
      return writer.delete(name);
    },
    validateProfileForRun(name) {
      const result = listProfiles(input.codexHome);
      if (!result.baseConfigValid) {
        return {
          ok: false,
          code: 'CODEX_CONFIG_INVALID',
          message: result.diagnostics.join('; ')
        };
      }

      if (name === 'default') return { ok: true };

      const profile = result.profiles.find((candidate) => candidate.name === name);
      if (profile === undefined) {
        return {
          ok: false,
          code: 'CODEX_PROFILE_NOT_FOUND',
          message: `Profile not found: ${name}`
        };
      }
      if (profile.status === 'invalid') {
        return {
          ok: false,
          code: 'CODEX_PROFILE_INVALID',
          message: `Profile is invalid: ${name}: ${profile.diagnostics.join('; ')}`
        };
      }
      return { ok: true };
    }
  };
}

function listProfiles(codexHome: ResolvedCodexHome): {
  profiles: CodexProfile[];
  diagnostics: string[];
  baseConfigValid: boolean;
} {
  const diagnostics: string[] = [];
  const baseConfigValid = validateBaseConfig(codexHome.path, diagnostics);
  const profiles = readProfileFiles(codexHome, diagnostics);

  return {
    profiles: profiles.sort((left, right) => left.name.localeCompare(right.name)),
    diagnostics,
    baseConfigValid
  };
}

function readProfileFiles(codexHome: ResolvedCodexHome, diagnostics: string[]): CodexProfile[] {
  if (!existsSync(codexHome.path)) return [];

  const entries = readCodexHomeEntries(codexHome.path, diagnostics);
  if (entries === undefined) return [];

  return entries
    .filter((entry) => entry.isFile())
    .flatMap((entry) => {
      const name = profileNameFromFileName(entry.name);
      if (name === undefined) return [];

      const filePath = join(codexHome.path, entry.name);
      const profile = readProfileFile(codexHome, name, entry.name, filePath, diagnostics);
      return profile === undefined ? [] : [profile];
    });
}

function readCodexHomeEntries(codexHome: string, diagnostics: string[]): Dirent[] | undefined {
  try {
    return readdirSync(codexHome, { withFileTypes: true });
  } catch (error) {
    diagnostics.push(`Failed to scan codex home ${codexHome}: ${formatError(error)}`);
    return undefined;
  }
}

function readProfileFile(
  codexHome: ResolvedCodexHome,
  name: string,
  fileName: string,
  filePath: string,
  diagnostics: string[]
): CodexProfile | undefined {
  let content: string;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch (error) {
    diagnostics.push(`Failed to read profile ${fileName}: ${formatError(error)}`);
    return undefined;
  }

  const parsed = parseCodexProfileOverlay(name, content);
  let updatedAt: string | undefined;
  try {
    updatedAt = statSync(filePath).mtime.toISOString();
  } catch (error) {
    diagnostics.push(`Failed to stat profile ${fileName}: ${formatError(error)}`);
  }

  return {
    ...parsed.profile,
    codexHomeMode: codexHome.mode,
    updatedAt
  };
}

function validateBaseConfig(codexHome: string, diagnostics: string[]): boolean {
  const baseConfigPath = join(codexHome, 'config.toml');
  if (!existsSync(baseConfigPath)) return true;

  let content: string;
  try {
    content = readFileSync(baseConfigPath, 'utf8');
  } catch (error) {
    diagnostics.push(`Failed to read config.toml: ${formatError(error)}`);
    return false;
  }

  try {
    parse(content);
    return true;
  } catch (error) {
    diagnostics.push(`Failed to parse config.toml: ${formatError(error)}`);
    return false;
  }
}

function assertWritable(writable: boolean): void {
  if (!writable) throw new Error('CODEX_HOME_READ_ONLY: Codex home is read-only');
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
