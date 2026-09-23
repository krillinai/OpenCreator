import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { generateImageContents } from '../../src/image-generation/provider.js';

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00
]);

describe('codex-native provider dispatch', () => {
  let root = '';

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
    root = '';
  });

  it('uses the local Codex provider with no image-service configuration', async () => {
    root = await mkdtemp(join(tmpdir(), 'opencreator-native-dispatch-'));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      data: [{ b64_json: png.toString('base64') }]
    }), { status: 200 })) as typeof fetch;
    const config = createDefaultCreatorServicesConfig();
    config.image.provider = 'codex-native';

    const result = await generateImageContents({
      prompt: 'an original orange cat',
      provider: 'codex-native',
      size: '1024x1024',
      quality: 'medium',
      count: 1
    }, config, {
      fetchImpl,
      codexNative: {
        codexHome: join(root, 'codex-home'),
        readProvider: async () => ({
          baseUrl: 'https://forward.example.test/v1',
          apiKey: 'local-codex-secret',
          model: 'gpt-image-1'
        })
      }
    });

    expect(result).toMatchObject({ model: 'gpt-image-1' });
    expect(result.contents[0]).toMatchObject({ content: png, mime: 'image/png' });
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('https://forward.example.test/v1/images/generations'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer local-codex-secret' })
      })
    );
  });

  it('rejects native requests for more than one image before reading the provider', async () => {
    const config = createDefaultCreatorServicesConfig();
    const readProvider = vi.fn();
    config.image.provider = 'codex-native';

    await expect(generateImageContents({
      prompt: 'cat',
      provider: 'codex-native',
      size: '1024x1024',
      quality: 'low',
      count: 2
    }, config, {
      codexNative: {
        codexHome: 'C:\\codex-home',
        readProvider
      }
    })).rejects.toMatchObject({
      code: 'unsupported_capability',
      message: expect.stringContaining('one image')
    });
    expect(readProvider).not.toHaveBeenCalled();
  });

  it('sends Codex reference images through the provider edit endpoint', async () => {
    const config = createDefaultCreatorServicesConfig();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => (
      new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }), { status: 200 })
    ));
    const first = Buffer.concat([png, Buffer.from('first-reference')]);
    const second = Buffer.concat([png, Buffer.from('second-reference')]);

    await generateImageContents({
      prompt: 'keep the same character',
      provider: 'codex-native',
      size: '1024x1024',
      quality: 'medium',
      count: 1
    }, config, {
      fetchImpl: fetchMock as typeof fetch,
      referenceImages: [
        { content: first, mime: 'image/png' },
        { content: second, mime: 'image/png' }
      ],
      codexNative: {
        codexHome: '/codex-home',
        readProvider: async () => ({
          baseUrl: 'https://forward.example.test/v1',
          apiKey: 'local-codex-secret',
          model: 'gpt-image-1'
        })
      }
    });

    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toBe('https://forward.example.test/v1/images/edits');
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request?.headers).toMatchObject({
      Authorization: 'Bearer local-codex-secret',
      'Content-Type': expect.stringContaining('multipart/form-data; boundary=')
    });
    const body = Buffer.from(request?.body as ArrayBuffer).toString('latin1');
    expect(body.match(/name="image\[\]"/g)).toHaveLength(2);
    expect(body.indexOf('first-reference')).toBeLessThan(body.indexOf('second-reference'));
  });

  it('reports missing native runtime settings as configuration error without API fallback', async () => {
    const config = createDefaultCreatorServicesConfig();
    config.image.provider = 'codex-native';
    const fetchImpl = vi.fn() as typeof fetch;

    await expect(generateImageContents({
      prompt: 'cat',
      provider: 'codex-native',
      size: '1024x1024',
      quality: 'low',
      count: 1
    }, config, { fetchImpl })).rejects.toMatchObject({
      code: 'config_missing'
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
