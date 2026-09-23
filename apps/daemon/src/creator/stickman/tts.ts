export function stickmanEdgeTtsVoiceForLanguage(language: unknown): string {
  const value = typeof language === 'string' ? language.toLowerCase() : '';
  if (value.startsWith('zh')) return 'zh-CN-XiaoxiaoNeural';
  if (value.startsWith('ja')) return 'ja-JP-NanamiNeural';
  return 'en-US-AriaNeural';
}
