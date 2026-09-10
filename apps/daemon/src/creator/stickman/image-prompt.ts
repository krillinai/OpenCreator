import type { StickmanShot, StickmanStyleContract } from './contracts.js';

export const STICKMAN_CHARACTER_REFERENCE_PREPARATION = 'original-bytes-v2';
export const STICKMAN_IMAGE_PROMPT_CONTRACT = 'stickman-visual-profile-prompt-v2';

export function shouldUsePreviousShotReference(shot: StickmanShot, shotIndex: number): boolean {
  return shotIndex > 0 && shot.continuityReason.trim().length > 0;
}

export function buildStickmanImagePrompt(input: {
  visualProfile: StickmanStyleContract;
  shot: StickmanShot;
  hasStyleReference: boolean;
  hasPreviousShotReference: boolean;
}): string {
  const { character, style } = input.visualProfile;
  const referenceInstructions = input.hasStyleReference
    ? [
        'Reference Image 1 is the CHARACTER IDENTITY source of truth. Preserve who the protagonist is; do not borrow its original pose, framing, or background.',
        'Reference Image 2 is the STYLE source of truth. Borrow only its medium, surface, linework, shading, and palette; do not copy its person, objects, composition, text, or scene.'
      ]
    : [
        'Reference Image 1 is the CHARACTER IDENTITY source of truth. Preserve who the protagonist is; do not borrow its original pose, framing, or background.',
        'There is no style reference image. Follow the complete rendering contract below exactly.'
      ];
  if (input.hasPreviousShotReference) {
    const previousReferenceNumber = input.hasStyleReference ? 3 : 2;
    referenceInstructions.push(
      `Reference Image ${previousReferenceNumber} is the PREVIOUS SHOT from the same narrative sequence. Preserve recurring objects, their recognizable shape and relative scale, the location, and the established visual state.`,
      'Use the previous shot only for continuity. Follow the current shot for camera distance, composition, protagonist pose, action, and lighting; do not simply copy the previous frame.'
    );
  }

  return [
    'Create exactly one full-frame 16:9 narrative image for a recurring stick-figure video.',
    '',
    '[REFERENCE RESPONSIBILITIES]',
    ...referenceInstructions,
    '',
    '[CHARACTER IDENTITY - WHAT MUST REMAIN THE SAME]',
    `Preserve: ${character.identity.preserve}.`,
    `Forbidden identity changes: ${character.identity.prohibit}.`,
    'Keep the same head and face, hair, eyewear, clothing silhouette, outfit details, accessories, age presentation, gender presentation, and stick-figure proportions in every shot.',
    'Only pose, facial expression, camera framing, and interaction with scene objects may change.',
    'Secondary people may appear only when required by the shot. Keep them subordinate and visually distinct from the protagonist.',
    '',
    '[VISUAL STYLE - HOW EVERYTHING MUST BE DRAWN]',
    `Medium: ${style.rendering.medium}.`,
    `Surface: ${style.rendering.surface}.`,
    `Linework: ${style.rendering.linework}.`,
    `Shading: ${style.rendering.shading}.`,
    `Palette: ${style.rendering.palette}.`,
    `Scene density: ${style.rendering.sceneDensity}.`,
    `Composition: ${style.rendering.composition}.`,
    `Character rendering: ${style.rendering.characterRendering}.`,
    '',
    '[SEMANTIC-TO-VISUAL TRANSLATION]',
    `Color words: ${style.semanticRenderingRules.color}.`,
    `Light words: ${style.semanticRenderingRules.light}.`,
    `Complex environments: ${style.semanticRenderingRules.complexEnvironment}.`,
    'A source phrase such as pale golden glow describes meaning and emphasis, not permission to introduce yellow. Translate it through the selected palette and lighting rules.',
    '',
    '[SHOT CONTENT - WHAT THIS FRAME MUST COMMUNICATE]',
    `Semantic anchor: ${input.shot.semanticAnchor}.`,
    `Concrete scene: ${input.shot.visualDescription}.`,
    `Composition and action: ${input.shot.compositionAndAction}.`,
    `Required objects: ${input.shot.keyObjects.join('; ')}.`,
    `Continuity from adjacent shots: ${input.shot.continuityReason || 'No additional continuity constraint.'}.`,
    'Preserve the semantic anchor first. Simplify decorative details when necessary, but never remove an action-critical object or change the stated relationship between subjects and objects.',
    'Express one immediately readable moment, with a clear protagonist silhouette and a coherent foreground, middle ground, and background.',
    '',
    '[HARD EXCLUSIONS]',
    `Never produce: ${style.forbiddenDirections.join(', ')}.`,
    'Do not add captions, labels, letters, numbers, logos, watermarks, subtitles, interfaces, character sheets, collages, or split-panel layouts.'
  ].join('\n');
}
