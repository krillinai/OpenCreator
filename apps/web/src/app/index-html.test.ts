import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync('index.html', 'utf8');

describe('index html assets', () => {
  it('uses the Clawee mark as the browser tab icon', () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/png" href="/logo.png" />');
    expect(indexHtml).not.toContain('/favicon.svg');
  });
});
