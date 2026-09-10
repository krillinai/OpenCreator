export type KrillinCliExecutionAttempt = {
  options: Record<string, unknown>;
  continueOnErrorCode?: string;
};

export function createKrillinCliExecutionPlan(
  stageId: string,
  options: Record<string, unknown>
): KrillinCliExecutionAttempt[] {
  return [{
    options: stageId === 'subtitle' && stringOption(options, 'captionSource') === undefined
      ? { ...options, captionSource: 'any' }
      : options
  }];
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
