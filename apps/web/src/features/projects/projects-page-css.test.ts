import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const projectsCss = readFileSync('src/features/projects/projects-page.css', 'utf8');

describe('projects page CSS', () => {
  it('uses the outer field focus state without drawing an inner select outline', () => {
    expect(projectsCss).toContain('.projects-sort:focus-within');
    expect(projectsCss).not.toContain('.projects-page select:focus-visible');
    expect(projectsCss).not.toContain('.projects-page input:focus-visible');
  });
});
