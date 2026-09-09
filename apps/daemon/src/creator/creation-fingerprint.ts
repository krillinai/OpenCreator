import { createHash } from 'node:crypto';
import type {
  CreatorJson,
  CreatorPresetRef
} from '@opencreator/protocol';

export type BlankCreationFingerprint = {
  mode: 'blank';
  projectId: string;
  templateId: string;
  templateVersion: number;
  resolvedStateHash: string;
};

export type PresetCreationFingerprint = {
  mode: 'preset';
  projectId: string;
  preset: CreatorPresetRef & { contentHash: string };
  locale: 'zh-CN' | 'en-US';
  templateId: string;
  templateVersion: number;
  resolvedStateHash: string;
};

export function createBlankCreationFingerprint(input: {
  projectId: string;
  templateId: string;
  templateVersion: number;
  state: Record<string, CreatorJson>;
}): string {
  return hashFingerprint({
    mode: 'blank',
    projectId: input.projectId,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    resolvedStateHash: hashCreatorState(input.state)
  });
}

export function createPresetCreationFingerprint(input: {
  projectId: string;
  preset: CreatorPresetRef & { contentHash: string };
  locale: 'zh-CN' | 'en-US';
  templateId: string;
  templateVersion: number;
  state: Record<string, CreatorJson>;
}): string {
  return hashFingerprint({
    mode: 'preset',
    projectId: input.projectId,
    preset: input.preset,
    locale: input.locale,
    templateId: input.templateId,
    templateVersion: input.templateVersion,
    resolvedStateHash: hashCreatorState(input.state)
  });
}

export function hashCreatorState(state: Record<string, CreatorJson>): string {
  return sha256(canonicalCreatorJson(state));
}

export function canonicalCreatorJson(value: CreatorJson | Record<string, CreatorJson>): string {
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalCreatorJson(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalCreatorJson(child)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashFingerprint(
  value: BlankCreationFingerprint | PresetCreationFingerprint
): string {
  return sha256(canonicalCreatorJson(value as unknown as Record<string, CreatorJson>));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
