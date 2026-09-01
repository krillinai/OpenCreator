import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const runtimeManifestSchema = z.object({
  version: z.literal(1),
  platform: z.string().min(1),
  arch: z.string().min(1),
  remotionVersion: z.literal('4.0.473'),
  chromiumVersion: z.string().min(1),
  bundlePath: z.string().min(1),
  browserExecutable: z.string().min(1),
  resources: z.array(z.object({
    path: z.string().min(1),
    kind: z.enum(['bundle', 'browser', 'font', 'character']),
    sha256: z.string().regex(/^[a-f0-9]{64}$/i),
    bytes: z.number().int().nonnegative(),
    version: z.string().min(1),
    platform: z.string().min(1),
    arch: z.string().min(1)
  }).strict()).min(1)
}).strict();

export type StickmanRemotionRuntime = {
  root: string;
  bundlePath: string;
  browserExecutable: string;
};

export function readStickmanRemotionRuntime(rootPath: string): StickmanRemotionRuntime {
  const root = resolve(rootPath);
  const manifest = runtimeManifestSchema.parse(JSON.parse(
    readFileSync(resolveInside(root, 'manifest.json'), 'utf8')
  ));
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error('stickman_runtime_wrong_platform');
  }
  for (const resource of manifest.resources) {
    const path = resolveInside(root, resource.path);
    if (!existsSync(path) || !statSync(path).isFile()) {
      throw new Error(`stickman_runtime_resource_missing: ${resource.path}`);
    }
  }
  return {
    root,
    bundlePath: resolveInside(root, manifest.bundlePath),
    browserExecutable: resolveInside(root, manifest.browserExecutable)
  };
}

export function resolveInside(root: string, child: string): string {
  const target = resolve(root, child);
  const value = relative(resolve(root), target);
  if (value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value))) {
    return target;
  }
  throw new Error(`stickman_runtime_path_escape: ${child}`);
}
