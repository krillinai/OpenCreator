import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync('index.html', 'utf8');

describe('index html assets', () => {
  it('uses the Clawee mark as the browser tab icon', () => {
    expect(indexHtml).toContain('<link rel="icon" type="image/svg+xml" href="/logo-v2-white-logo.svg" />');
    expect(indexHtml).not.toContain('/logo-v2-white-logo.png');
    expect(indexHtml).not.toContain('/favicon.svg');
  });
});
