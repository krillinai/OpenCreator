import {
  sha256Text,
  verifyFileIntegrityWithCache
} from '@opencreator/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const resourceSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  kind: z.enum(['executable', 'model', 'asset']),
  provider: z.string().optional(),
  model: z.string().optional()
}).strict();

const ytDlpRuntimeSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('standalone'),
    version: z.string().min(1),
    executable: z.string().min(1)
  }).strict(),
  z.object({
    mode: z.literal('python'),
    version: z.string().min(1),
    pythonVersion: z.string().min(1),
    executable: z.string().min(1),
    script: z.string().min(1),
    certificateBundle: z.string().min(1)
  }).strict()
]);

const cliSourceSchema = z.object({
  kind: z.enum(['local-source', 'configured-binary', 'vendor-release']),
  revision: z.string().min(1).optional(),
  dirty: z.boolean().optional()
}).strict();

const manifestSchema = z.object({
  version: z.number().int().positive(),
  runtimeMode: z.literal('cli').optional(),
  cliVersion: z.string().min(1).optional(),
  sourceCommit: z.string().min(1).optional(),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  integrationPatchSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  platform: z.string().min(1),
  arch: z.string().min(1),
  upstreamCommit: z.string().optional(),
  cliSource: cliSourceSchema.optional(),
  ytDlp: ytDlpRuntimeSchema.optional(),
  resources: z.array(resourceSchema)
}).strict();

export type KrillinRuntimeManifest = z.infer<typeof manifestSchema>;

export function readKrillinRuntimeManifest(resourceRoot: string): KrillinRuntimeManifest {
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(resolve(resourceRoot, 'manifest.json'), 'utf8')));
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error('dependency_not_packaged: runtime platform mismatch');
  }
  return manifest;
}

export function verifyKrillinRuntimeManifest(
  resourceRoot: string,
  manifest: KrillinRuntimeManifest,
  input: { cachePath?: string } = {}
): { cacheHit: boolean } {
  const root = resolve(resourceRoot);
  const result = verifyFileIntegrityWithCache({
    cachePath: input.cachePath,
    identity: root,
    fingerprint: sha256Text(JSON.stringify(manifest)),
    files: manifest.resources.map(resource => ({
      key: resource.path,
      path: resolveInside(root, resource.path),
      sha256: resource.sha256
    }))
  });
  if (!result.verified) {
    throw new Error(
      result.reason === 'hash_mismatch'
        ? `dependency_hash_mismatch: ${result.key}`
        : `dependency_not_packaged: ${result.key}`
    );
  }
  return { cacheHit: result.cacheHit };
}

export function resolveInside(root: string, relative: string): string {
  const absoluteRoot = resolve(root);
  const result = resolve(absoluteRoot, relative);
  if (result !== absoluteRoot && !result.startsWith(`${absoluteRoot}\\`) && !result.startsWith(`${absoluteRoot}/`)) {
    throw new Error('resource_path_escape');
  }
  return result;
}
