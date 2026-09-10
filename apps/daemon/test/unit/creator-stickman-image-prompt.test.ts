import { describe, expect, it } from 'vitest';
import { stickmanStyleContractSchema, type StickmanShot } from '../../src/creator/stickman/contracts.js';
import {
  buildStickmanImagePrompt,
  shouldUsePreviousShotReference
} from '../../src/creator/stickman/image-prompt.js';

describe('stickman image prompt compiler', () => {
  it('keeps character, style, and shot semantics in separate explicit contracts', () => {
    const prompt = buildStickmanImagePrompt({
      visualProfile: visualProfile(),
      shot: shot(),
      hasStyleReference: true,
      hasPreviousShotReference: true
    });

    expect(prompt).toContain('Reference Image 1 is the CHARACTER IDENTITY source of truth');
    expect(prompt).toContain('Reference Image 2 is the STYLE source of truth');
    expect(prompt).toContain('Reference Image 3 is the PREVIOUS SHOT');
    expect(prompt).toContain('do not simply copy the previous frame');
    expect(prompt).toContain('do not copy its person, objects, composition, text, or scene');
    expect(prompt).toContain('Preserve: blunt bob haircut and sailor-collar school uniform');
    expect(prompt).toContain('Medium: graphite pencil drawing');
    expect(prompt).toContain('Semantic anchor: 珍贵物品发出淡金色光泽，吸引女孩注意');
    expect(prompt).toContain('Concrete scene: 女孩在茂密森林深处发现发光的旧盒子');
    expect(prompt).toContain('Composition and action: 女孩位于左侧前景，伸手靠近右侧石头上的盒子');
    expect(prompt).toContain('Required objects: 女孩; 旧盒子; 石头; 树木');
  });

  it('translates color and complex environments through the selected monochrome style', () => {
    const prompt = buildStickmanImagePrompt({
      visualProfile: visualProfile(),
      shot: shot(),
      hasStyleReference: false,
      hasPreviousShotReference: false
    });

    expect(prompt).toContain('translate every color into grayscale value or white highlight');
    expect(prompt).toContain('pale golden glow describes meaning and emphasis, not permission to introduce yellow');
    expect(prompt).toContain('reduce forests to a few trees while preserving required spatial relationships');
    expect(prompt).toContain('never remove an action-critical object');
    expect(prompt).toContain('Never produce: photography, colored cartoon, dense realistic environment');
    expect(prompt).not.toContain('PREVIOUS SHOT');
  });

  it('uses the previous shot only for non-initial shots with explicit continuity', () => {
    expect(shouldUsePreviousShotReference(shot(), 0)).toBe(false);
    expect(shouldUsePreviousShotReference(shot(), 1)).toBe(true);
    expect(shouldUsePreviousShotReference({ ...shot(), continuityReason: '' }, 1)).toBe(false);
  });
});

function visualProfile() {
  return stickmanStyleContractSchema.parse({
    contract: 'stickman-visual-profile-v2',
    ratio: '16:9',
    character: {
      assetId: 'stickman.character.student',
      revision: 1,
      identity: {
        preserve: 'blunt bob haircut and sailor-collar school uniform',
        prohibit: 'glasses, trousers, or a different outfit'
      },
      references: [{
        role: 'identity-primary',
        sha256: 'a'.repeat(64),
        bytes: 100,
        mimeType: 'image/png'
      }]
    },
    style: {
      assetId: 'stickman.style.paper-pencil',
      revision: 1,
      rendering: {
        medium: 'graphite pencil drawing',
        surface: 'light paper with subtle grain',
        linework: 'bold imperfect pencil contours',
        shading: 'restrained graphite hatching',
        palette: 'black, paper white, and graphite gray only',
        sceneDensity: 'one concrete location with only story-critical objects',
        composition: 'one full-frame narrative moment',
        characterRendering: 'preserve the selected identity in pencil'
      },
      semanticRenderingRules: {
        color: 'translate every color into grayscale value or white highlight',
        light: 'use white space and sparse rays instead of colored glow',
        complexEnvironment: 'reduce forests to a few trees while preserving required spatial relationships'
      },
      forbiddenDirections: ['photography', 'colored cartoon', 'dense realistic environment'],
      references: []
    }
  });
}

function shot(): StickmanShot {
  return {
    id: 'shot-01',
    sourceSegmentId: 'segment-01',
    semanticAnchor: '珍贵物品发出淡金色光泽，吸引女孩注意',
    visualDescription: '女孩在茂密森林深处发现发光的旧盒子',
    compositionAndAction: '女孩位于左侧前景，伸手靠近右侧石头上的盒子',
    keyObjects: ['女孩', '旧盒子', '石头', '树木'],
    continuityReason: '延续上一镜头的行进方向',
    motion: 'push-in',
    motionReason: '聚焦发现瞬间',
    startSeconds: 0,
    endSeconds: 4,
    durationSeconds: 4
  };
}
