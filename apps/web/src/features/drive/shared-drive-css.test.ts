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
    expect(css).toMatch(/\.shared-drive-table th,\s*\.shared-drive-table td\s*\{[^}]*font-size:\s*13px;/s);
    expect(css).toMatch(/\.shared-drive-file-name strong\s*\{[^}]*font-size:\s*14px;/s);
    expect(css).toMatch(/\.shared-drive-file-name small\s*\{[^}]*font-size:\s*12px;/s);
  });

  it('keeps the right-side control slot evenly padded', () => {
    expect(css).toMatch(/\.shared-drive-table th:nth-child\(6\)\s*\{\s*width:\s*86px;\s*\}/);
    expect(css).toMatch(/\.shared-drive-table \.shared-drive-actions-cell\s*\{[^}]*padding-right:\s*12px;[^}]*padding-left:\s*12px;/s);
    expect(css).toMatch(/\.shared-drive-row-actions\s*\{[^}]*width:\s*100%;[^}]*justify-content:\s*center;/s);
  });
});
