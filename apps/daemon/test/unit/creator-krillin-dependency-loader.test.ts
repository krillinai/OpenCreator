import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import { createKrillinDependencyLoader } from '../../src/creator/krillin/dependency-loader.js';

describe('KrillinAI on-demand dependency loader', () => {
  it('does not prepare WhisperKit when OpenAI is selected without an API key', async () => {
    let installs = 0;
    const loader = createKrillinDependencyLoader({
      root: '/tmp/opencreator-test-dependencies',
      platform: 'darwin',
      arch: 'arm64',
      whisperKitInstaller: {
        async isInstalled() {
          return false;
        },
        async install() {
          installs += 1;
        }
      }
    });
    const config = createDefaultCreatorServicesConfig();

    await loader.ensure({
      config,
      signal: new AbortController().signal,
      reportProgress() {}
    });

    expect(installs).toBe(0);
  });

  it('reports capabilities for the loader Runtime', () => {
    const loader = createKrillinDependencyLoader({
      root: '/tmp/opencreator-test-dependencies',
      platform: 'darwin',
      arch: 'arm64'
    });

    expect(loader.capabilities()).toMatchObject({
      platform: 'darwin',
      arch: 'arm64',
      transcription: {
        providers: expect.arrayContaining([
          expect.objectContaining({ provider: 'whisperkit', available: true }),
          expect.objectContaining({ provider: 'faster-whisper', available: false })
        ])
      }
    });
  });

  it('prepares WhisperKit once and reuses it for later stages', async () => {
    let installed = false;
    let installs = 0;
    const phases: string[] = [];
    const loader = createKrillinDependencyLoader({
      root: '/tmp/opencreator-test-dependencies',
      platform: 'darwin',
      arch: 'arm64',
      whisperKitInstaller: {
        async isInstalled() {
          return installed;
        },
        async install(input) {
          installs += 1;
          input.onPhase('cli');
          input.onPhase('model');
          installed = true;
        }
      }
    });
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisperkit';
    const ensure = () => loader.ensure({
      config,
      signal: new AbortController().signal,
      reportProgress(progress) {
        if (typeof progress.dependencyPhase === 'string') {
          phases.push(progress.dependencyPhase);
        }
      }
    });

    await Promise.all([ensure(), ensure()]);
    await ensure();

    expect(installs).toBe(1);
    expect(phases).toContain('download');
    expect(phases).toContain('cli');
    expect(phases).toContain('model');
  });

  it('rejects WhisperKit on unsupported platforms without installing anything', async () => {
    let installs = 0;
    const loader = createKrillinDependencyLoader({
      root: '/tmp/opencreator-test-dependencies',
      platform: 'linux',
      arch: 'x64',
      whisperKitInstaller: {
        async isInstalled() {
          return false;
        },
        async install() {
          installs += 1;
        }
      }
    });
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisperkit';

    await expect(loader.ensure({
      config,
      signal: new AbortController().signal,
      reportProgress() {}
    })).rejects.toMatchObject({ code: 'dependency_not_packaged' });
    expect(installs).toBe(0);
  });
});
