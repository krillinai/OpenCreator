import type {
  CreatorJson,
  CreatorPresetHighlight,
  CreatorRuntimeWorkspace
} from '@opencreator/protocol';
import { deepMergeCreatorJson } from './requirements.js';
import type {
  CompiledCreatorPreset,
  CreatorPresetLocale
} from './types.js';

export function createCreatorPresetHighlights(
  preset: CompiledCreatorPreset,
  locale: CreatorPresetLocale
): CreatorPresetHighlight[] {
  const defaults = deepMergeCreatorJson(
    preset.defaults,
    preset.defaultsByLocale?.[locale] ?? {}
  );
  return highlightBuilders[preset.module](defaults, locale);
}

const highlightBuilders: Record<
  CreatorRuntimeWorkspace,
  (
    defaults: Record<string, CreatorJson>,
    locale: CreatorPresetLocale
  ) => CreatorPresetHighlight[]
> = {
  'video-translation': (defaults, locale) => {
    const style = readRecord(defaults.subtitleStyle);
    const colors = [
      readColor(style?.primaryColor),
      readColor(style?.secondaryColor)
    ].filter((color): color is string => color !== undefined);
    return [
      textHighlight(
        `${languageLabel(readString(defaults.sourceLanguage), locale)}`
        + ` → ${languageLabel(readString(defaults.targetLanguage), locale)}`
      ),
      textHighlight([
        defaults.bilingual === true
          ? localize(locale, '双语字幕', 'Bilingual subtitles')
          : localize(locale, '单语字幕', 'Single-language subtitles'),
        defaults.dubbing === true
          ? localize(locale, '含配音', 'Dubbing')
          : undefined,
        defaults.subtitlePosition === 'bottom'
          ? localize(locale, '底部', 'Bottom')
          : localize(locale, '顶部', 'Top')
      ].filter((value): value is string => value !== undefined).join(' · ')),
      {
        text: [
          fontPresetLabel(readString(style?.fontPreset), locale),
          fontWeightLabel(readString(style?.fontWeight), locale),
          fontSizeLabel(readString(style?.fontSize), locale)
        ].join(' · '),
        colors
      },
      textHighlight(videoOutputLabel(defaults, locale))
    ];
  },
  'video-download': (defaults, locale) => [
    textHighlight(defaults.mediaType === 'audio'
      ? localize(locale, '提取 MP3 音频', 'Extract MP3 audio')
      : localize(locale, '下载最高画质视频', 'Download highest-quality video'))
  ],
  'image-generation': (defaults, locale) => [
    textHighlight(formatSize(readString(defaults.size))),
    textHighlight(qualityLabel(readString(defaults.quality), locale)),
    textHighlight(countLabel(readNumber(defaults.candidateCount), locale, 'image'))
  ],
  'video-generation': (defaults, locale) => [
    textHighlight(formatSize(readString(defaults.size))),
    textHighlight(localize(
      locale,
      `${readNumber(defaults.duration) ?? 5} 秒`,
      `${readNumber(defaults.duration) ?? 5} sec`
    ))
  ],
  'cover-generator': (defaults, locale) => [
    textHighlight(coverStyleLabel(readString(defaults.coverStyle), locale)),
    textHighlight(readString(defaults.ratio) ?? '16:9'),
    textHighlight(coverLanguageLabel(readString(defaults.coverTextLanguage), locale)),
    textHighlight(countLabel(readNumber(defaults.candidateCount), locale, 'image'))
  ],
  'smart-dubbing': (defaults, locale) => [
    textHighlight(dubbingStyleLabel(readString(defaults.style), locale)),
    textHighlight(`${formatSpeed(readNumber(defaults.speed))}x`),
    textHighlight((readString(defaults.format) ?? 'mp3').toUpperCase())
  ]
};

function textHighlight(text: string): CreatorPresetHighlight {
  return { text, colors: [] };
}

function languageLabel(value: string | undefined, locale: CreatorPresetLocale): string {
  const labels: Record<string, [string, string]> = {
    en: ['英语', 'English'],
    en_us: ['英语', 'English'],
    zh: ['中文', 'Chinese'],
    zh_cn: ['简体中文', 'Simplified Chinese'],
    zh_tw: ['繁体中文', 'Traditional Chinese'],
    ja: ['日语', 'Japanese'],
    ja_jp: ['日语', 'Japanese'],
    ko: ['韩语', 'Korean'],
    ko_kr: ['韩语', 'Korean'],
    es: ['西班牙语', 'Spanish'],
    fr: ['法语', 'French'],
    de: ['德语', 'German']
  };
  const normalized = value?.trim().toLowerCase().replaceAll('-', '_') ?? '';
  const label = labels[normalized];
  if (label === undefined) return value?.trim() || localize(locale, '自动', 'Auto');
  return locale === 'en-US' ? label[1] : label[0];
}

function fontPresetLabel(value: string | undefined, locale: CreatorPresetLocale): string {
  const labels: Record<string, [string, string]> = {
    system: ['系统字体', 'System'],
    sans: ['无衬线', 'Sans serif'],
    serif: ['衬线体', 'Serif'],
    rounded: ['圆体', 'Rounded']
  };
  return localizedValue(labels, value, locale, ['无衬线', 'Sans serif']);
}

function fontWeightLabel(value: string | undefined, locale: CreatorPresetLocale): string {
  const labels: Record<string, [string, string]> = {
    regular: ['常规', 'Regular'],
    medium: ['中等', 'Medium'],
    bold: ['粗体', 'Bold']
  };
  return localizedValue(labels, value, locale, ['粗体', 'Bold']);
}

function fontSizeLabel(value: string | undefined, locale: CreatorPresetLocale): string {
  const labels: Record<string, [string, string]> = {
    small: ['小字', 'Small'],
    medium: ['中字', 'Medium'],
    large: ['大字', 'Large']
  };
  return localizedValue(labels, value, locale, ['中字', 'Medium']);
}

function videoOutputLabel(
  defaults: Record<string, CreatorJson>,
  locale: CreatorPresetLocale
): string {
  if (defaults.composeVideo !== true) {
    return localize(locale, '字幕与翻译稿', 'Subtitles and transcript');
  }
  if (defaults.videoFormat === 'vertical') {
    return localize(locale, '竖屏成片', 'Vertical video');
  }
  if (defaults.videoFormat === 'all') {
    return localize(locale, '横竖屏成片', 'Horizontal and vertical video');
  }
  return localize(locale, '横屏成片', 'Horizontal video');
}

function qualityLabel(value: string | undefined, locale: CreatorPresetLocale): string {
  const labels: Record<string, [string, string]> = {
    low: ['快速质量', 'Fast quality'],
    medium: ['标准质量', 'Standard quality'],
    high: ['高清质量', 'High quality']
  };
  return localizedValue(labels, value, locale, ['标准质量', 'Standard quality']);
}

function coverStyleLabel(value: string | undefined, locale: CreatorPresetLocale): string {
  const labels: Record<string, [string, string]> = {
    'personal-growth': ['个人成长风格', 'Personal growth'],
    psychology: ['心理学风格', 'Psychology'],
    'wealth-platinum-red': ['财富白金红', 'Wealth platinum red'],
    'bilibili-red-blue-white': ['B站红蓝白', 'Bilibili red blue white'],
    custom: ['自定义风格', 'Custom style']
  };
  return localizedValue(labels, value, locale, ['自定义风格', 'Custom style']);
}

function coverLanguageLabel(value: string | undefined, locale: CreatorPresetLocale): string {
  const labels: Record<string, [string, string]> = {
    auto: ['自动文字语言', 'Automatic text language'],
    'zh-CN': ['简体中文文字', 'Simplified Chinese text'],
    'zh-TW': ['繁体中文文字', 'Traditional Chinese text'],
    'en-US': ['英文文字', 'English text'],
    'ja-JP': ['日文文字', 'Japanese text'],
    'ko-KR': ['韩文文字', 'Korean text']
  };
  return localizedValue(labels, value, locale, ['自动文字语言', 'Automatic text language']);
}

function dubbingStyleLabel(value: string | undefined, locale: CreatorPresetLocale): string {
  const labels: Record<string, [string, string]> = {
    natural: ['自然表达', 'Natural'],
    professional: ['专业播报', 'Professional'],
    warm: ['温暖表达', 'Warm'],
    energetic: ['活力表达', 'Energetic'],
    calm: ['沉静旁白', 'Calm'],
    storytelling: ['故事讲述', 'Storytelling']
  };
  return localizedValue(labels, value, locale, ['自然表达', 'Natural']);
}

function localizedValue(
  labels: Record<string, [string, string]>,
  value: string | undefined,
  locale: CreatorPresetLocale,
  fallback: [string, string]
): string {
  const label = value === undefined ? fallback : labels[value] ?? fallback;
  return locale === 'en-US' ? label[1] : label[0];
}

function countLabel(
  value: number | undefined,
  locale: CreatorPresetLocale,
  item: 'image'
): string {
  const count = value ?? 1;
  if (locale === 'en-US') return `${count} ${item}${count === 1 ? '' : 's'}`;
  return `${count} 张`;
}

function formatSize(value: string | undefined): string {
  return (value ?? '1024x1024').replace('x', ' × ');
}

function formatSpeed(value: number | undefined): string {
  return (value ?? 1).toFixed(2).replace(/\.?0+$/, '');
}

function readRecord(value: CreatorJson | undefined): Record<string, CreatorJson> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : undefined;
}

function readString(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function readNumber(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readColor(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && /^#[0-9A-Fa-f]{6}$/.test(value)
    ? value.toUpperCase()
    : undefined;
}

function localize(
  locale: CreatorPresetLocale,
  zh: string,
  en: string
): string {
  return locale === 'en-US' ? en : zh;
}
