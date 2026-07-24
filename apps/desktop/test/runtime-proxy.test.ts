import { describe, expect, it } from 'vitest';
import {
  MAX_RUNTIME_REQUEST_BODY_BYTES,
  createRuntimeProxyTarget,
  isRuntimeRequestUrl,
  readBoundedRequestBody
} from '../src/main/runtime-proxy.js';

describe('Desktop Runtime proxy', () => {
  it('matches only the exact runtime route prefix', () => {
    expect(isRuntimeRequestUrl(new URL('clawee-app://app/.clawee/runtime'))).toBe(true);
    expect(isRuntimeRequestUrl(new URL('clawee-app://app/.clawee/runtime/healthz'))).toBe(true);
    expect(isRuntimeRequestUrl(new URL('clawee-app://app/.clawee/runtimeevil'))).toBe(false);
    expect(isRuntimeRequestUrl(new URL('clawee-app://bootstrap/.clawee/runtime'))).toBe(false);
  });

  it('accepts only an explicit loopback daemon origin', () => {
    expect(createRuntimeProxyTarget(
      new URL('clawee-app://app/.clawee/runtime/healthz?full=1'),
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
        new URL('clawee-app://app/.clawee/runtime/healthz'),
        address
      ), address).toThrow();
    }
  });

  it('rejects encoded and unencoded network paths before URL construction', () => {
    for (const requestUrl of [
      'clawee-app://app/.clawee/runtime//attacker.example/path',
      'clawee-app://app/.clawee/runtime/%2f%2fattacker.example/path',
      'clawee-app://app/.clawee/runtime/%2F%5cattacker.example/path',
      'clawee-app://app/.clawee/runtime/%5c%5cattacker.example/path',
      'clawee-app://app/.clawee/runtime/%00healthz',
      'clawee-app://app/.clawee/runtime/%'
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
});
