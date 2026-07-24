import { describe, expect, it } from 'vitest';
import {
  buildDevProxyTarget,
  parseDevDaemonConfig
} from './dev-proxy-target.js';

describe('Vite Runtime proxy target', () => {
  it('accepts only a loopback HTTP daemon with a non-empty token', () => {
    expect(parseDevDaemonConfig({
      address: '127.0.0.1:60764',
      token: 'secret'
    })).toEqual({
      baseUrl: 'http://127.0.0.1:60764',
      token: 'secret'
    });

    for (const address of [
      'localhost:60764',
      'https://127.0.0.1:60764',
      'http://127.0.0.2:60764',
      'http://127.0.0.1:60764/path'
    ]) {
      expect(() => parseDevDaemonConfig({ address, token: 'secret' })).toThrow();
    }
    expect(() => parseDevDaemonConfig({
      address: '127.0.0.1:60764',
      token: ''
    })).toThrow();
  });

  it('keeps runtime requests on the validated daemon origin', () => {
    expect(buildDevProxyTarget(
      'http://127.0.0.1:60764',
      '/.clawee/runtime/healthz?full=1'
    ).toString()).toBe('http://127.0.0.1:60764/healthz?full=1');
  });

  it('rejects prefix collisions and network-path variants', () => {
    for (const incomingUrl of [
      '/.clawee/runtimeevil',
      '/.clawee/runtime//attacker.example/path',
      '/.clawee/runtime/%2f%2fattacker.example/path',
      '/.clawee/runtime/%5c%5cattacker.example/path',
      '/.clawee/runtime/%00healthz',
      '/.clawee/runtime/%'
    ]) {
      expect(() => buildDevProxyTarget(
        'http://127.0.0.1:60764',
        incomingUrl
      ), incomingUrl).toThrow();
    }
  });
});
