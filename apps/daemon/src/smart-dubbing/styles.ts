import type { SmartDubbingStyle } from '@opencreator/protocol';

const styleInstructions: Record<SmartDubbingStyle, string> = {
  natural: 'Speak naturally with clear articulation and balanced pacing.',
  professional: 'Use a polished, confident, professional presentation style.',
  warm: 'Use a warm, friendly, approachable tone with gentle pacing.',
  energetic: 'Use an energetic, upbeat delivery while keeping every word clear.',
  calm: 'Use a calm, steady, reassuring tone with measured pauses.',
  storytelling: 'Use an expressive storytelling cadence with natural emphasis and pauses.'
};

export function smartDubbingInstructions(style: SmartDubbingStyle): string {
  return styleInstructions[style];
}
