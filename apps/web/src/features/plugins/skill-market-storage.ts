import {
  readJsonFromStorage,
  writeJsonToStorage,
} from '../../storage/browser-storage.js';

export const savedSkillIdsStorageKey = 'clawee.skill-market.saved.v1';

export function readSavedSkillIds(): string[] {
  const value = readJsonFromStorage<unknown>(savedSkillIdsStorageKey);
  if (value === null) return [];
  if (!isStringArray(value)) {
    window.localStorage.removeItem(savedSkillIdsStorageKey);
    return [];
  }
  return [...value];
}

export function writeSavedSkillIds(ids: readonly string[]): void {
  writeJsonToStorage(savedSkillIdsStorageKey, normalizeSavedSkillIds(ids));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function normalizeSavedSkillIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawId of ids) {
    const id = rawId.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  return normalized;
}
