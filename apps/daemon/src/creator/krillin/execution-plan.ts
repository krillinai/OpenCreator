export type KrillinCliExecutionAttempt = {
  options: Record<string, unknown>;
  continueOnErrorCode?: string;
};

export function createKrillinCliExecutionPlan(
  stageId: string,
  source: string | undefined,
  options: Record<string, unknown>
): KrillinCliExecutionAttempt[] {
  if (stageId !== 'subtitle') {
    return [{ options }];
  }

  const captionSource = stringOption(options, 'captionSource') ?? 'any';
  if (!isYouTubeSource(source) || captionSource === 'whisper') {
    return [{ options }];
  }
  if (captionSource !== 'any') {
    return [{ options }];
  }

  return [
    {
      options: { ...options, captionSource: 'platform' },
      continueOnErrorCode: 'platform_caption_failed'
    },
    {
      options: { ...options, captionSource: 'whisper' }
    }
  ];
}

export function isYouTubeSource(value: string | undefined): boolean {
  if (value === undefined) return false;
  try {
    const hostname = new URL(value).hostname.toLowerCase().replace(/\.$/, '');
    return hostname === 'youtu.be'
      || hostname === 'youtube.com'
      || hostname.endsWith('.youtube.com')
      || hostname === 'youtube-nocookie.com'
      || hostname.endsWith('.youtube-nocookie.com');
  } catch {
    return false;
  }
}

function stringOption(options: Record<string, unknown>, name: string): string | undefined {
  const value = options[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
