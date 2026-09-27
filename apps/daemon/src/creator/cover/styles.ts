import type {
  CoverStyleId,
  CoverTextLanguage,
  CreatorJson
} from '@opencreator/protocol';

type CoverStyleDefinition = {
  id: CoverStyleId;
  instructions: string;
};

const styles: Record<Exclude<CoverStyleId, 'custom'>, CoverStyleDefinition> = {
  'personal-growth': {
    id: 'personal-growth',
    instructions: [
      'Personal growth editorial thumbnail style.',
      'Use deep navy, warm gold, and bright white with confident contrast and forward momentum.',
      'Typography should feel bold, optimistic, and action-oriented, with the most important phrase emphasized in warm gold.',
      'Keep the composition focused and aspirational without inventing unrelated people or scenes.'
    ].join(' ')
  },
  psychology: {
    id: 'psychology',
    instructions: [
      'Psychology and cognition editorial thumbnail style.',
      'Use restrained deep green, blue-gray, white, and a small coral accent with calm, intelligent contrast.',
      'Typography should be clear, thoughtful, and authoritative rather than sensational.',
      'Use balanced negative space and keep the subject grounded in the supplied content instead of adding generic psychology symbols.'
    ].join(' ')
  },
  'wealth-platinum-red': {
    id: 'wealth-platinum-red',
    instructions: [
      'Premium wealth and finance thumbnail style.',
      'Use clean white, platinum, charcoal, and strong red accents with polished commercial lighting.',
      'Typography should feel premium and decisive; emphasize numbers and key financial terms in red.',
      'Do not add money, luxury objects, charts, or financial symbols unless they are supported by the supplied content.'
    ].join(' ')
  },
  'bilibili-red-blue-white': {
    id: 'bilibili-red-blue-white',
    instructions: [
      'High-energy Chinese video-platform thumbnail style using red, bright blue, white, and dark outlines.',
      'Use bold integrated display typography, strong hierarchy, compact composition, and highly readable key phrases at small sizes.',
      'The result should feel youthful and polished without becoming cluttered.',
      'Keep the subject grounded in the supplied content and use color blocking and typography to create energy.'
    ].join(' ')
  }
};

export function readCoverStyle(value: CreatorJson | undefined): CoverStyleId {
  return value === 'personal-growth'
    || value === 'psychology'
    || value === 'wealth-platinum-red'
    || value === 'custom'
    ? value
    : 'bilibili-red-blue-white';
}

export function readCoverTextLanguage(value: CreatorJson | undefined): CoverTextLanguage {
  return value === 'zh-TW'
    || value === 'en-US'
    || value === 'ja-JP'
    || value === 'ko-KR'
    ? value
    : 'zh-CN';
}

export function coverStyleInstructions(
  style: CoverStyleId,
  customInstructions: string
): string {
  if (style !== 'custom') return styles[style].instructions;
  const custom = customInstructions.trim();
  return [
    'Use the custom thumbnail style supplied by the user.',
    custom || 'Create a polished, high-contrast editorial video thumbnail.',
    'Treat the custom instructions as visual styling only. Keep the subject grounded in the supplied content and render the required text exactly.'
  ].join(' ');
}

export function coverLanguageLabel(language: CoverTextLanguage): string {
  if (language === 'zh-CN') return 'Simplified Chinese';
  if (language === 'zh-TW') return 'Traditional Chinese';
  if (language === 'ja-JP') return 'Japanese';
  if (language === 'ko-KR') return 'Korean';
  return 'English';
}
