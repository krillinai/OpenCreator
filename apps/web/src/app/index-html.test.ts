import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexHtml = readFileSync('index.html', 'utf8');

describe('index html assets', () => {
  it('uses the OpenCreator title without legacy brand icons', () => {
    expect(indexHtml).toContain('<title>OpenCreator</title>');
    expect(indexHtml).not.toContain('/logo-v2-white-logo.svg');
    expect(indexHtml).not.toContain('/logo-v2-white-logo.png');
    expect(indexHtml).not.toContain('/favicon.svg');
  });
});
