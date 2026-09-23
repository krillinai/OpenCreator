import type { StickmanRatio } from '@opencreator/protocol';

export function renderStickmanPublishCopy(input: {
  title: string;
  language: string;
  durationSeconds: number;
  ratio: StickmanRatio;
  narration: string[];
}): string {
  const description = input.narration.join(' ').replace(/\s+/g, ' ').trim();
  const roundedDuration = Math.max(1, Math.round(input.durationSeconds));
  const minutes = Math.floor(roundedDuration / 60);
  const seconds = roundedDuration % 60;
  const format = input.ratio === '9:16' ? 'YouTube Short (9:16)' : 'YouTube video (16:9)';
  const hashtags = input.ratio === '9:16'
    ? '#Shorts #StickFigure #Explained'
    : '#StickFigure #Explained';
  return [
    `# ${input.title.trim()}`,
    '',
    'Description:',
    description,
    '',
    `Language: ${input.language.trim()}`,
    `Duration: ${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`,
    `Format: ${format}`,
    '',
    `Hashtags: ${hashtags}`
  ].join('\n') + '\n';
}
