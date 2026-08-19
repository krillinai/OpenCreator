import type { CodexHomeMode } from '@opencreator/protocol';

export type CodexProfileStatus = 'valid' | 'invalid';
export type TomlPrimitive = string | number | boolean;
export type TomlProfileValue = TomlPrimitive | TomlPrimitive[];
export type TomlProfileConfig = Record<string, TomlProfileValue>;

export type CodexProfile = {
  name: string;
  status: CodexProfileStatus;
  config: TomlProfileConfig;
  diagnostics: string[];
  source: `${string}.config.toml`;
  codexHomeMode: CodexHomeMode;
  updatedAt?: string;
};

export type ParseProfileConfigResult =
  | { ok: true; profile: Omit<CodexProfile, 'codexHomeMode'>; diagnostics: string[] }
  | { ok: false; profile: Omit<CodexProfile, 'codexHomeMode'>; diagnostics: string[] };

export type ValidationResult = { ok: true } | { ok: false; message: string };
