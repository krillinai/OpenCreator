import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerChannelRoutes } from '../../src/api/routes.channel.js';
import {
  ChannelPipelineError,
  type ChannelPipelineService
} from '../../src/channel/service.js';

describe('channel API routes', () => {
  let server: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    server = Fastify({ logger: false });
  });

  afterEach(async () => {
    await server.close();
    vi.restoreAllMocks();
  });

  it('exposes health and status through the Channel adapter', async () => {
    const service = {
      health: vi.fn(async () => ({
        repoPath: '/tmp/channel',
        repoConfigured: true,
        repoAvailable: true,
        pyprojectPresent: true,
        uvAvailable: true,
        uvVersion: 'uv 0.6.0'
      })),
      status: vi.fn(async () => ({
        command: ['uv', 'run', '--no-sync', 'pipeline', 'status'],
        cwd: '/tmp/channel',
        exitCode: 0,
        signal: null,
        stdout: 'ready',
        stderr: '',
        timedOut: false
      }))
    } as unknown as ChannelPipelineService;

    await registerChannelRoutes(server, service);
    const health = await server.inject({ method: 'GET', url: '/channel/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().repoConfigured).toBe(true);

    const status = await server.inject({ method: 'GET', url: '/channel/status' });
    expect(status.statusCode).toBe(200);
    expect(status.json().exitCode).toBe(0);
    expect(service.status).toHaveBeenCalledTimes(1);
  });

  it('maps Channel configuration and command failures to API errors', async () => {
    const service = {
      health: vi.fn(async () => ({
        repoPath: null,
        repoConfigured: false,
        repoAvailable: false,
        pyprojectPresent: false,
        uvAvailable: false,
        uvVersion: null
      })),
      status: vi.fn(async () => {
        throw new ChannelPipelineError(
          'CHANNEL_REPO_NOT_CONFIGURED',
          'Set OPENCREATOR_CHANNEL_REPO or CHANNEL_REPO to the Channel checkout root',
          409
        );
      }),
      ingest: vi.fn(),
      process: vi.fn(),
      publish: vi.fn()
    } as unknown as ChannelPipelineService;

    await registerChannelRoutes(server, service);
    const failed = await server.inject({ method: 'GET', url: '/channel/status' });
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error.code).toBe('CHANNEL_REPO_NOT_CONFIGURED');
  });

  it('forwards validated publish requests to the service', async () => {
    const service = {
      health: vi.fn(),
      status: vi.fn(),
      ingest: vi.fn(),
      process: vi.fn(),
      publish: vi.fn(async () => ({
        command: ['uv', 'run', '--no-sync', 'pipeline', 'publish'],
        cwd: '/tmp/channel',
        exitCode: 0,
        signal: null,
        stdout: 'published',
        stderr: '',
        timedOut: false
      }))
    } as unknown as ChannelPipelineService;

    await registerChannelRoutes(server, service);
    const response = await server.inject({
      method: 'POST',
      url: '/channel/publish',
      payload: { jobId: '0123456789abcdef0123456789abcdef', targets: ['manual'] }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().stdout).toBe('published');
    expect(service.publish).toHaveBeenCalledWith({
      jobId: '0123456789abcdef0123456789abcdef',
      targets: ['manual']
    });
  });
});
