import { createHash } from 'node:crypto';
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  statSync
} from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const resourceSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  kind: z.enum(['executable', 'model', 'asset']),
  provider: z.string().optional(),
  model: z.string().optional()
}).strict();

const manifestSchema = z.object({
  version: z.number().int().positive(),
  runtimeMode: z.enum(['cli', 'service']).optional(),
  serviceVersion: z.string().min(1).optional(),
  cliVersion: z.string().min(1).optional(),
  protocolVersion: z.literal(1).optional(),
  protocolSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  integrationPatchSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  platform: z.string().min(1),
  arch: z.string().min(1),
  upstreamCommit: z.string().optional(),
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

export function verifyKrillinRuntimeManifest(resourceRoot: string, manifest: KrillinRuntimeManifest): void {
  for (const resource of manifest.resources) {
    const path = resolveInside(resourceRoot, resource.path);
    if (!statSync(path).isFile()) throw new Error(`dependency_not_packaged: ${resource.path}`);
    const actual = hashFile(path);
    if (actual !== resource.sha256.toLowerCase()) throw new Error(`dependency_hash_mismatch: ${resource.path}`);
  }
}

export function requirePackagedProvider(
  manifest: KrillinRuntimeManifest,
  provider: string,
  model?: string
): void {
  if (['openai', 'aliyun', 'edge-tts', 'minimax', 'openai-compatible'].includes(provider)) return;
  const found = manifest.resources.some(resource => (
    resource.provider === provider && (model === undefined || resource.model === model)
  ));
  if (!found) throw new Error(`dependency_not_packaged: ${provider}${model ? `/${model}` : ''}`);
}

export function resolveInside(root: string, relative: string): string {
  const absoluteRoot = resolve(root);
  const result = resolve(absoluteRoot, relative);
  if (result !== absoluteRoot && !result.startsWith(`${absoluteRoot}\\`) && !result.startsWith(`${absoluteRoot}/`)) {
    throw new Error('resource_path_escape');
  }
  return result;
}

function hashFile(path: string): string {
  const digest = createHash('sha256');
  const descriptor = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead: number;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return digest.digest('hex');
}
