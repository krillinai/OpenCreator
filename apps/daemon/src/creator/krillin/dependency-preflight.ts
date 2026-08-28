import type { CreatorServicesConfig } from '@opencreator/protocol';
import {
  readKrillinRuntimeManifest,
  verifyKrillinRuntimeManifest
} from './manifest.js';

export function preflightKrillinDependencies(
  resourceRoot: string,
  config: CreatorServicesConfig
) {
  const manifest = readKrillinRuntimeManifest(resourceRoot);
  verifyKrillinRuntimeManifest(resourceRoot, manifest);
  return {
    manifest,
    config
  };
}
