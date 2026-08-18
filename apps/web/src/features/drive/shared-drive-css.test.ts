import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/features/drive/shared-drive.css', 'utf8');

describe('shared drive typography', () => {
  it('keeps all visible text at twelve pixels or larger', () => {
    const fontSizes = Array.from(
      css.matchAll(/font-size:\s*(\d+)px/g),
      match => Number(match[1])
    );

    expect(fontSizes.length).toBeGreaterThan(0);
    expect(Math.min(...fontSizes)).toBeGreaterThanOrEqual(12);
  });

  it('uses readable sizes for primary file content', () => {
    expect(css).toMatch(/\.shared-drive-file-name strong\s*\{[^}]*font-size:\s*14px;/s);
    expect(css).toMatch(/\.shared-drive-file-name small\s*\{[^}]*font-size:\s*12px;/s);
    expect(css).toMatch(/\.shared-drive-file-meta dt\s*\{[^}]*font-size:\s*12px;/s);
  });

  it('uses a responsive asset grid and stable previews', () => {
    expect(css).toMatch(/\.shared-drive-file-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fill, minmax\(210px, 1fr\)\);/s);
    expect(css).toMatch(/\.shared-drive-file-preview\s*\{[^}]*aspect-ratio:\s*16 \/ 9;/s);
    expect(css).toMatch(/\.shared-drive-file-card\s*\{[^}]*border-radius:\s*8px;/s);
  });
});
