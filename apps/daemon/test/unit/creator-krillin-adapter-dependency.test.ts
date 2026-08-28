import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';

const preflightKrillinDependencies = vi.hoisted(() => vi.fn());

vi.mock('../../src/creator/krillin/dependency-preflight.js', () => ({
  preflightKrillinDependencies
}));

import { createKrillinExecutor } from '../../src/creator/krillin/adapter.js';

describe('KrillinAI configured transcription dependency', () => {
  it('prepares the selected local provider before applying YouTube caption logic', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.transcription.provider = 'whisperkit';
    preflightKrillinDependencies.mockReturnValue({
      manifest: { resources: [] },
      config
    });
    const preparationStopped = new Error('preparation stopped');
    const ensure = vi.fn(async () => {
      throw preparationStopped;
    });
    const executor = createKrillinExecutor({
      resourceRoot: '/tmp/opencreator-krillin-runtime',
      jobsRoot: '/tmp/opencreator-jobs',
      configStore: {
        read: vi.fn(async () => config)
      } as never,
      dependencyLoader: {
        root: '/tmp/opencreator-krillin-dependencies',
        capabilities: vi.fn(),
        ensure
      },
      runtimeHost: {} as never
    });

    await expect(executor.run({
      signal: new AbortController().signal,
      stageRun: {
        stageId: 'subtitle',
        progress: {}
      },
      options: {
        source: 'https://www.youtube.com/watch?v=demo',
        captionSource: 'any'
      },
      reportProgress: vi.fn()
    } as never)).rejects.toBe(preparationStopped);

    expect(ensure).toHaveBeenCalledWith(expect.objectContaining({ config }));
  });
});
