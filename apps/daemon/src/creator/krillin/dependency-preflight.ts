import type { CreatorServicesConfig } from '@opencreator/protocol';
import {
  readKrillinRuntimeManifest,
  verifyKrillinRuntimeManifest
} from './manifest.js';

export function preflightKrillinDependencies(
  resourceRoot: string,
  config: CreatorServicesConfig,
  input: { cachePath?: string } = {}
) {
  const manifest = readKrillinRuntimeManifest(resourceRoot);
  verifyKrillinRuntimeManifest(resourceRoot, manifest, {
    cachePath: input.cachePath
  });
  return {
    manifest,
    config
  };
}
