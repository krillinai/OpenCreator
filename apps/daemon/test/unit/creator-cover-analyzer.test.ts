import { describe, expect, it, vi } from 'vitest';
import { generateCoverBrief } from '../../src/creator/cover/analyzer.js';

describe('creator cover analyzer', () => {
  it('keeps provider HTTP facts without leaking response text', async () => {
    const request = generateCoverBrief({
      baseUrl: 'https://example.com/v1', apiKey: 'test-key', model: 'text-model', proxy: '',
      metadata: { id: 'video-1', title: 'A title' },
      userPrompt: '', language: 'en-US', headlineOverride: '', subheadlineOverride: '',
      signal: new AbortController().signal,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        error: { code: 'rate_limit_exceeded', message: 'api_key=private' }
      }), { status: 429 }))
    });
    await expect(request).rejects.toMatchObject({
      publicFacts: { kind: 'rate-limited', provider: 'llm', httpStatus: 429, upstreamCode: 'rate_limit_exceeded' }
    });
    await expect(request).rejects.not.toThrow('private');
  });

  it('generates copy only in the requested language and preserves overrides', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        messages: Array<{ content: string }>;
      };
      expect(request.messages[0]?.content).toContain('不要设计画面、人物、场景、构图或 imagePrompt');
      expect(request.messages[0]?.content).toContain('English');
      expect(request.messages[0]?.content).toContain('"Build Better Habits"');
      expect(request.messages[0]?.content).toContain('"A practical system that lasts"');
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              title: 'How to Build Better Habits',
              summary: 'A practical habit-building system.',
              headline: 'Build Better Habits',
              subheadline: 'A practical system that lasts',
              emphasisTerms: ['Better Habits'],
              language: 'en-US'
            })
          }
        }]
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    });

    const brief = await generateCoverBrief({
      baseUrl: 'https://example.com/v1',
      apiKey: 'test-key',
      model: 'text-model',
      proxy: '',
      metadata: {
        id: 'video-1',
        title: 'How to Build Better Habits',
        description: 'A practical system for lasting behavior change.'
      },
      userPrompt: 'Focus on repeatable systems',
      language: 'en-US',
      headlineOverride: 'Build Better Habits',
      subheadlineOverride: 'A practical system that lasts',
      signal: new AbortController().signal,
      fetchImpl
    });

    expect(brief).toEqual({
      title: 'How to Build Better Habits',
      summary: 'A practical habit-building system.',
      headline: 'Build Better Habits',
      subheadline: 'A practical system that lasts',
      emphasisTerms: ['Better Habits'],
      language: 'en-US'
    });
  });
});
