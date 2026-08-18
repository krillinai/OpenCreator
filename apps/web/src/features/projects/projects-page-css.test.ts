import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const projectsCss = readFileSync('src/features/projects/projects-page.css', 'utf8');

describe('projects page CSS', () => {
  it('uses an outer search focus state and segmented project categories', () => {
    expect(projectsCss).toContain('.projects-search:focus-within');
    expect(projectsCss).toContain('width: min(260px, 36vw)');
    expect(projectsCss).toContain('.projects-dimension-tabs button[aria-selected="true"]');
    expect(projectsCss).toContain('.projects-category-tabs button[aria-selected="true"]');
    expect(projectsCss).toContain('.project-output-grid');
    expect(projectsCss).not.toContain('.projects-toolbar');
    expect(projectsCss).not.toContain('.projects-page input:focus-visible');
  });
});
