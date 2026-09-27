import { describe, expect, it } from 'vitest';
import { publicFactsFromFailure, publicFactsFromHttpResponse } from '../../src/creator/public-error-facts.js';
import { creatorServiceErrorInfo } from '../../src/creator-services/upstream-fetch.js';

describe('public error facts', () => {
  it('classifies only known network codes through nested causes', () => {
    const error = new Error('Authorization: Bearer secret', {
      cause: Object.assign(new Error('private endpoint'), { code: 'ENOTFOUND' })
    });
    expect(publicFactsFromFailure(error, 'openai')).toEqual({
      kind: 'dns', provider: 'openai', upstreamCode: 'ENOTFOUND'
    });
    expect(JSON.stringify(publicFactsFromFailure(error, 'openai'))).not.toContain('secret');
  });

  it('preserves validated facts from a wrapped failure and leaves unknown failures unconfirmed', () => {
    const cause = Object.assign(new Error('private response'), {
      publicFacts: { kind: 'rate-limited', provider: 'openai', httpStatus: 429, upstreamCode: 'quota_exceeded' }
    });
    expect(publicFactsFromFailure(new Error('wrapped', { cause }))).toEqual(cause.publicFacts);
    expect(publicFactsFromFailure(Object.assign(new Error('secret'), { code: 'PRIVATE_TOKEN' })))
      .toEqual({ kind: 'unknown' });
    expect(publicFactsFromFailure(Object.assign(new Error('private'), { code: 'krillin_auth_failed' })))
      .toEqual({ kind: 'unauthorized' });
  });

  it('uses HTTP status and safe upstream code as separate facts', () => {
    expect(publicFactsFromHttpResponse(403, 'gemini', 'PERMISSION_DENIED')).toEqual({
      kind: 'unauthorized', provider: 'gemini', upstreamCode: 'PERMISSION_DENIED', httpStatus: 403
    });
  });

  it('rejects token-like upstream codes and arbitrary provider messages', async () => {
    const response = new Response(JSON.stringify({
      error: { code: 'sk-private-long-secret-value-that-must-not-leak', message: 'Bearer private' }
    }), { status: 403 });
    const info = await creatorServiceErrorInfo(response, 'Image generation', 'openai');
    expect(info.publicFacts).toEqual({ kind: 'unauthorized', provider: 'openai', httpStatus: 403 });
    expect(JSON.stringify(info)).not.toContain('private');
  });
});
