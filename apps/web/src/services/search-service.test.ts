import { describe, expect, it, vi } from 'vitest';
import type { RuntimeClient } from '../runtime/client.js';
import { createSearchService } from './search-service.js';

describe('SearchService', () => {
  it('encodes conversation search filters and cursor', async () => {
    const get = vi.fn(async (_path: string) => ({
      results: [],
      hasMore: false
    }));
    const service = createSearchService(createClient(get));

    await service.searchConversations({
      query: '页面 / path',
      limit: 20,
      cursor: 'cursor+/=',
      cwd: '/Users/wulien/项目',
      itemTypes: ['assistant_message', 'file_change'],
      createdAfter: '2026-07-01T00:00:00.000Z',
      createdBefore: '2026-07-12T00:00:00.000Z'
    });

    expect(get).toHaveBeenCalledWith(
      '/search/conversations?query=%E9%A1%B5%E9%9D%A2+%2F+path'
      + '&limit=20'
      + '&cursor=cursor%2B%2F%3D'
      + '&cwd=%2FUsers%2Fwulien%2F%E9%A1%B9%E7%9B%AE'
      + '&types=assistant_message%2Cfile_change'
      + '&createdAfter=2026-07-01T00%3A00%3A00.000Z'
      + '&createdBefore=2026-07-12T00%3A00%3A00.000Z'
    );
  });
});

function createClient(get: (path: string) => Promise<unknown>): RuntimeClient {
  return {
    get<T>(path: string): Promise<T> {
      return get(path) as Promise<T>;
    }
  } as RuntimeClient;
}
