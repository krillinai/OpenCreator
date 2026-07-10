import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const lightfallSource = readFileSync('src/components/effects/Lightfall.tsx', 'utf8');

describe('Lightfall source contracts', () => {
  it('does not clear the canvas to a blank frame during resize', () => {
    expect(lightfallSource).toContain('if (rect.width <= 0 || rect.height <= 0) return;');
    expect(lightfallSource).toContain('renderer.render({ scene: mesh });');
  });
});
