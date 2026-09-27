import { parentPort, workerData } from 'node:worker_threads';
import {
  readKrillinRuntimeManifest,
  verifyKrillinRuntimeManifest
} from './manifest.js';

type VerificationWorkerInput = {
  resourceRoot: string;
  cachePath: string;
};

const input = workerData as VerificationWorkerInput;

try {
  const manifest = readKrillinRuntimeManifest(input.resourceRoot);
  const result = verifyKrillinRuntimeManifest(input.resourceRoot, manifest, {
    cachePath: input.cachePath
  });
  parentPort?.postMessage({ ok: true, cacheHit: result.cacheHit });
} catch (error) {
  parentPort?.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error)
  });
}
