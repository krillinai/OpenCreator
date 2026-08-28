import { describe, expect, it } from 'vitest';
import {
  MAX_RUNTIME_REQUEST_BODY_BYTES,
  createRuntimeProxyTarget,
  isStreamingRuntimeUploadRequest,
  isRuntimeRequestUrl,
  readBoundedRequestBody
} from '../src/main/runtime-proxy.js';

describe('Desktop Runtime proxy', () => {
  it('matches only the exact runtime route prefix', () => {
    expect(isRuntimeRequestUrl(new URL('opencreator-app://app/.opencreator/runtime'))).toBe(true);
    expect(isRuntimeRequestUrl(new URL('opencreator-app://app/.opencreator/runtime/healthz'))).toBe(true);
    expect(isRuntimeRequestUrl(new URL('opencreator-app://app/.opencreator/runtimeevil'))).toBe(false);
    expect(isRuntimeRequestUrl(new URL('opencreator-app://bootstrap/.opencreator/runtime'))).toBe(false);
  });

  it('accepts only an explicit loopback daemon origin', () => {
    expect(createRuntimeProxyTarget(
      new URL('opencreator-app://app/.opencreator/runtime/healthz?full=1'),
      'http://127.0.0.1:60764'
    ).toString()).toBe('http://127.0.0.1:60764/healthz?full=1');

    for (const address of [
      'http://localhost:60764',
      'http://127.0.0.2:60764',
      'https://127.0.0.1:60764',
      'http://user@127.0.0.1:60764',
      'http://127.0.0.1:60764/path',
      'http://127.0.0.1:60764?query=1',
      'http://127.0.0.1:60764#fragment',
      'http://127.0.0.1:70000'
    ]) {
      expect(() => createRuntimeProxyTarget(
        new URL('opencreator-app://app/.opencreator/runtime/healthz'),
        address
      ), address).toThrow();
    }
  });

  it('rejects encoded and unencoded network paths before URL construction', () => {
    for (const requestUrl of [
      'opencreator-app://app/.opencreator/runtime//attacker.example/path',
      'opencreator-app://app/.opencreator/runtime/%2f%2fattacker.example/path',
      'opencreator-app://app/.opencreator/runtime/%2F%5cattacker.example/path',
      'opencreator-app://app/.opencreator/runtime/%5c%5cattacker.example/path',
      'opencreator-app://app/.opencreator/runtime/%00healthz',
      'opencreator-app://app/.opencreator/runtime/%'
    ]) {
      expect(() => createRuntimeProxyTarget(
        new URL(requestUrl),
        'http://127.0.0.1:60764'
      ), requestUrl).toThrow();
    }
  });

  it('stops reading a streaming body once the 10 MiB limit is exceeded', async () => {
    let pullCount = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pullCount += 1;
        controller.enqueue(new Uint8Array(6 * 1024 * 1024));
        if (pullCount >= 3) controller.close();
      }
    });

    await expect(readBoundedRequestBody({
      headers: new Headers(),
      body: body as unknown as Request['body']
    })).rejects.toMatchObject({
      status: 413,
      code: 'RUNTIME_PAYLOAD_TOO_LARGE'
    });
    expect(pullCount).toBe(2);
  });

  it('rejects an oversized Content-Length before consuming the body', async () => {
    let pulled = false;
    const body = {
      getReader() {
        pulled = true;
        throw new Error('body should not be consumed');
      }
    } as unknown as ReadableStream<Uint8Array>;

    await expect(readBoundedRequestBody({
      headers: new Headers({
        'Content-Length': String(MAX_RUNTIME_REQUEST_BODY_BYTES + 1)
      }),
      body: body as unknown as Request['body']
    })).rejects.toMatchObject({ status: 413 });
    expect(pulled).toBe(false);
  });

  it('streams only the exact Creator source upload route and content type', () => {
    const target = new URL(
      'http://127.0.0.1:60764/creator/jobs/creator_job_abc-123/source-video'
    );
    expect(isStreamingRuntimeUploadRequest(target, {
      method: 'POST',
      headers: new Headers({
        'content-type': 'application/vnd.opencreator.creator-source; charset=binary'
      })
    })).toBe(true);

    for (const input of [
      {
        target,
        method: 'PUT',
        contentType: 'application/vnd.opencreator.creator-source'
      },
      {
        target: new URL(
          'http://127.0.0.1:60764/creator/jobs/creator_job_abc-123/actions'
        ),
        method: 'POST',
        contentType: 'application/vnd.opencreator.creator-source'
      },
      {
        target: new URL(
          'http://127.0.0.1:60764/creator/jobs/not-a-creator-job/source-video'
        ),
        method: 'POST',
        contentType: 'application/vnd.opencreator.creator-source'
      },
      {
        target,
        method: 'POST',
        contentType: 'application/octet-stream'
      }
    ]) {
      expect(isStreamingRuntimeUploadRequest(input.target, {
        method: input.method,
        headers: new Headers({ 'content-type': input.contentType })
      })).toBe(false);
    }
  });
});
