import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it } from 'vitest';
import {
  createKrillinDependencyLoader,
  promoteDependencyPath
} from '../../src/creator/krillin/dependency-loader.js';

describe('KrillinAI on-demand dependency loader', () => {
  it('waits and retries when Windows temporarily locks a downloaded dependency', async () => {
    let attempts = 0;
    const delays: number[] = [];

    await promoteDependencyPath('staged', 'installed', {
      async renamePath() {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
        }
      },
      async wait(milliseconds) {
        delays.push(milliseconds);
      }
    });

    expect(attempts).toBe(3);
    expect(delays).toEqual([100, 200]);
  });

  it('does not enable Windows x64 Whisper.cpp on ARM64', async () => {
    const loader = createKrillinDependencyLoader({ root: '/tmp/whispercpp', platform: 'win32', arch: 'arm64' });
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisper.cpp';
    expect(loader.capabilities().transcription.providers.find(value => value.provider === 'whisper.cpp')?.available).toBe(false);
    await expect(loader.ensure({ config, signal: new AbortController().signal, reportProgress() {} })).rejects.toThrow('unavailable');
  });

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

  it('prepares each selected Whisper.cpp model once on Windows x64', async () => {
    const installed = new Set<string>();
    const installs: string[] = [];
    const phases: string[] = [];
    const loader = createKrillinDependencyLoader({
      root: 'C:\\opencreator-test-dependencies',
      platform: 'win32',
      arch: 'x64',
      whisperCppInstaller: {
        async isInstalled(_root, model) {
          return installed.has(model);
        },
        async install(input) {
          installs.push(input.model);
          input.onPhase('cli');
          input.onPhase('model');
          installed.add(input.model);
        }
      }
    });
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisper.cpp';
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
    config.transcription.whisperCpp.model = 'medium';
    await ensure();

    expect(installs).toEqual(['tiny', 'medium']);
    expect(phases).toContain('download');
    expect(phases).toContain('cli');
    expect(phases).toContain('model');
  });

  it('passes large-v3-turbo through the dependency loader', async () => {
    let installed = false;
    let selectedModel = '';
    const loader = createKrillinDependencyLoader({
      root: 'C:\\opencreator-test-dependencies', platform: 'win32', arch: 'x64',
      whisperCppInstaller: {
        async isInstalled() { return installed; },
        async install(input) {
          selectedModel = input.model;
          installed = true;
        }
      }
    });
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisper.cpp';
    config.transcription.whisperCpp.model = 'large-v3-turbo';

    await loader.ensure({ config, signal: new AbortController().signal, reportProgress() {} });

    expect(selectedModel).toBe('large-v3-turbo');
  });

  it('does not accept a large-v3-turbo install that fails post-install verification', async () => {
    const loader = createKrillinDependencyLoader({
      root: 'C:\\opencreator-test-dependencies', platform: 'win32', arch: 'x64',
      whisperCppInstaller: {
        async isInstalled() { return false; },
        async install() {}
      }
    });
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisper.cpp';
    config.transcription.whisperCpp.model = 'large-v3-turbo';

    await expect(loader.ensure({
      config,
      signal: new AbortController().signal,
      reportProgress() {}
    })).rejects.toThrow('dependency verification failed after installation');
  });

  it('rejects Whisper.cpp outside Windows x64 without installing anything', async () => {
    let installs = 0;
    const loader = createKrillinDependencyLoader({
      root: '/tmp/opencreator-test-dependencies',
      platform: 'win32',
      arch: 'arm64',
      whisperCppInstaller: {
        async isInstalled() {
          return false;
        },
        async install() {
          installs += 1;
        }
      }
    });
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisper.cpp';

    await expect(loader.ensure({
      config,
      signal: new AbortController().signal,
      reportProgress() {}
    })).rejects.toMatchObject({ code: 'dependency_not_packaged' });
    expect(installs).toBe(0);
  });
});
