export const smartDubbingVoices = [
  'nova',
  'alloy',
  'echo',
  'onyx',
  'shimmer',
  'fable'
] as const;

export type SmartDubbingVoice = typeof smartDubbingVoices[number];

export const smartDubbingStyles = [
  'natural',
  'professional',
  'warm',
  'energetic',
  'calm',
  'storytelling'
] as const;

export type SmartDubbingStyle = typeof smartDubbingStyles[number];
export type SmartDubbingFormat = 'mp3' | 'wav';

export type CreateSmartDubbingRequest = {
  text: string;
  voice: SmartDubbingVoice;
  style: SmartDubbingStyle;
  speed: number;
  format: SmartDubbingFormat;
};

export type SmartDubbingResult = {
  id: string;
  fileName: string;
  mime: 'audio/mpeg' | 'audio/wav';
  size: number;
  provider: 'openai';
  model: string;
  voice: SmartDubbingVoice;
  style: SmartDubbingStyle;
  speed: number;
  format: SmartDubbingFormat;
  characterCount: number;
  createdAt: string;
};

export type SmartDubbingResultResponse = {
  result: SmartDubbingResult;
};
