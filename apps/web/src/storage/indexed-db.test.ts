import { describe, expect, it } from 'vitest';
import { createIndexedDbStore } from './indexed-db.js';

describe('IndexedDB store', () => {
  it('saves and loads mock file content', async () => {
    const store = createIndexedDbStore('opencreator.web.test');
    await store.saveFile({ path: 'docs/demo.md', content: '# Demo', updatedAt: '2026-07-06T00:00:00.000Z' });

    await expect(store.getFile('docs/demo.md')).resolves.toMatchObject({
      path: 'docs/demo.md',
      content: '# Demo'
    });
  });

  it('rejects files larger than 512KB', async () => {
    const store = createIndexedDbStore('opencreator.web.test.limit');
    const content = 'x'.repeat(512 * 1024 + 1);

    try {
      await store.saveFile({ path: 'large.txt', content, updatedAt: '2026-07-06T00:00:00.000Z' });
      throw new Error('Expected saveFile to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain('MOCK_FILE_TOO_LARGE');
    }
  });
});
