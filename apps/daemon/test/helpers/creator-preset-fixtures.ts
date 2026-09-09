import {
  cpSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CreatorPresetSourceManifest } from '../../src/creator/presets/types.js';

export const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
export const officialPresetRoot = join(repositoryRoot, 'template');

export function copyOfficialPreset(input: {
  sourceRoot: string;
  module: CreatorPresetSourceManifest['module'];
  sourceId: string;
  id?: string;
  version?: number;
  status?: CreatorPresetSourceManifest['status'];
  update?: (manifest: CreatorPresetSourceManifest) => CreatorPresetSourceManifest;
}): string {
  const id = input.id ?? input.sourceId;
  const version = input.version ?? 1;
  const source = join(officialPresetRoot, input.module, input.sourceId, '1');
  const target = join(input.sourceRoot, input.module, id, String(version));
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  updatePresetManifest(target, manifest => {
    const normalized: CreatorPresetSourceManifest = {
      ...manifest,
      id,
      version,
      ...(input.status === undefined ? {} : { status: input.status })
    };
    return input.update?.(normalized) ?? normalized;
  });
  return target;
}

export function readPresetManifest(directory: string): CreatorPresetSourceManifest {
  return JSON.parse(readFileSync(join(directory, 'template.json'), 'utf8')) as CreatorPresetSourceManifest;
}

export function updatePresetManifest(
  directory: string,
  update: (manifest: CreatorPresetSourceManifest) => CreatorPresetSourceManifest
): void {
  const manifest = update(readPresetManifest(directory));
  writeFileSync(
    join(directory, 'template.json'),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
}

export function hashDirectory(root: string): string {
  const files: string[] = [];
  walk(root, files);
  files.sort();
  const aggregate = createHash('sha256');
  for (const file of files) {
    const contents = readFileSync(join(root, file));
    aggregate.update(file).update('\0');
    aggregate.update(createHash('sha256').update(contents).digest('hex')).update('\0');
  }
  return aggregate.digest('hex');

  function walk(directory: string, result: string[]) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, result);
      } else if (entry.isFile()) {
        result.push(relative(root, absolute).replaceAll('\\', '/'));
      }
    }
  }
}

export function directoryFiles(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  walk(root);
  return result;

  function walk(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        const key = relative(root, absolute).replaceAll('\\', '/');
        result[key] = createHash('sha256').update(readFileSync(absolute)).digest('hex');
        result[`${key}:size`] = String(statSync(absolute).size);
      }
    }
  }
}
