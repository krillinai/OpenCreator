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
  const defaults = localizedDefaults(preset, locale);
  return highlightBuilders[preset.module](defaults, locale);
}

export function createCreatorPresetPrompt(
  preset: CompiledCreatorPreset,
  locale: CreatorPresetLocale
): string | null {
  return readString(localizedDefaults(preset, locale).prompt) ?? null;
}

export function createCreatorPresetTags(
  preset: Pick<CompiledCreatorPreset, 'tags'>,
  locale: CreatorPresetLocale
): string[] {
  return preset.tags.map(tag => {
    const labels = presetTagLabels[tag.trim().toLowerCase()];
    if (labels === undefined) return tag;
    return locale === 'en-US' ? labels[1] : labels[0];
  });
}

function localizedDefaults(
  preset: CompiledCreatorPreset,
  locale: CreatorPresetLocale
): Record<string, CreatorJson> {
  return deepMergeCreatorJson(
    preset.defaults,
    preset.defaultsByLocale?.[locale] ?? {}
  );
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

const presetTagLabels: Record<string, [string, string]> = {
  action: ['动作', 'Action'],
  advertising: ['广告', 'Advertising'],
  aerial: ['航拍', 'Aerial'],
  animation: ['动画', 'Animation'],
  audio: ['音频', 'Audio'],
  bilibili: ['B站', 'Bilibili'],
  bilingual: ['双语', 'Bilingual'],
  business: ['商务', 'Business'],
  'camera-motion': ['镜头运动', 'Camera motion'],
  'character-interaction': ['角色互动', 'Character interaction'],
  cinematic: ['电影感', 'Cinematic'],
  'condensed-source': ['精简提示词', 'Condensed prompt'],
  cooking: ['烹饪', 'Cooking'],
  corporate: ['企业', 'Corporate'],
  cover: ['封面', 'Cover'],
  'crane-up': ['上升摇臂', 'Crane up'],
  documentary: ['纪录片', 'Documentary'],
  'dolly-zoom': ['滑动变焦', 'Dolly zoom'],
  download: ['下载', 'Download'],
  'drone-orbit': ['无人机环绕', 'Drone orbit'],
  dubbing: ['配音', 'Dubbing'],
  dv: ['DV', 'DV'],
  ecommerce: ['电商', 'E-commerce'],
  editorial: ['编辑风格', 'Editorial'],
  fantasy: ['奇幻', 'Fantasy'],
  'first-person': ['第一人称', 'First person'],
  growth: ['成长', 'Growth'],
  horizontal: ['横屏', 'Horizontal'],
  image: ['图像', 'Image'],
  'image-to-video': ['图生视频', 'Image to video'],
  insight: ['洞察', 'Insight'],
  jewelry: ['珠宝', 'Jewelry'],
  knowledge: ['知识', 'Knowledge'],
  'martial-arts': ['武术', 'Martial arts'],
  'multi-reference': ['多参考图', 'Multiple references'],
  'multi-stage': ['多阶段', 'Multi-stage'],
  mystery: ['悬疑', 'Mystery'],
  narration: ['旁白', 'Narration'],
  news: ['资讯', 'News'],
  nostalgic: ['怀旧', 'Nostalgic'],
  'pan-right': ['向右摇摄', 'Pan right'],
  parkour: ['跑酷', 'Parkour'],
  'personal-brand': ['个人品牌', 'Personal brand'],
  'platinum-red': ['白金红', 'Platinum red'],
  portrait: ['人像', 'Portrait'],
  poster: ['海报', 'Poster'],
  product: ['商品', 'Product'],
  professional: ['专业', 'Professional'],
  psychology: ['心理学', 'Psychology'],
  'rack-focus': ['焦点切换', 'Rack focus'],
  'red-blue-white': ['红蓝白', 'Red blue white'],
  'reference-image': ['参考图片', 'Reference image'],
  'reference-template': ['参考模板', 'Reference template'],
  reveal: ['揭示镜头', 'Reveal'],
  'sci-fi': ['科幻', 'Sci-fi'],
  'short-video': ['短视频', 'Short video'],
  skateboard: ['滑板', 'Skateboard'],
  social: ['社交媒体', 'Social media'],
  square: ['方形', 'Square'],
  'stop-motion': ['定格动画', 'Stop motion'],
  story: ['故事', 'Story'],
  storytelling: ['故事讲述', 'Storytelling'],
  subtitles: ['字幕', 'Subtitles'],
  'text-to-video': ['文生视频', 'Text to video'],
  translation: ['翻译', 'Translation'],
  ugc: ['UGC', 'UGC'],
  vertical: ['竖屏', 'Vertical'],
  video: ['视频', 'Video'],
  voice: ['声音', 'Voice'],
  warm: ['温暖', 'Warm'],
  watercolor: ['水彩', 'Watercolor'],
  wealth: ['财富', 'Wealth'],
  youtube: ['YouTube', 'YouTube'],
  产品摄影: ['产品摄影', 'Product photography'],
  产品视觉: ['产品视觉', 'Product visuals'],
  人像摄影: ['人像摄影', 'Portrait photography'],
  传统文化: ['传统文化', 'Traditional culture'],
  体育视觉: ['体育视觉', 'Sports visuals'],
  信息图表: ['信息图表', 'Infographics'],
  创意摄影: ['创意摄影', 'Creative photography'],
  商业广告: ['商业广告', 'Commercial advertising'],
  图片转绘: ['图片转绘', 'Image transformation'],
  地图视觉: ['地图视觉', 'Map visuals'],
  多视角一致性: ['多视角一致性', 'Multi-view consistency'],
  工业设计: ['工业设计', 'Industrial design'],
  建筑空间: ['建筑空间', 'Architecture and interiors'],
  影视叙事: ['影视叙事', 'Cinematic storytelling'],
  微缩场景: ['微缩场景', 'Miniature scenes'],
  手工材质: ['手工材质', 'Handcrafted textures'],
  手绘插画: ['手绘插画', 'Hand-drawn illustration'],
  拼贴设计: ['拼贴设计', 'Collage design'],
  教育科普: ['教育科普', 'Educational content'],
  旅行城市: ['旅行城市', 'Travel and cities'],
  时尚美妆: ['时尚美妆', 'Fashion and beauty'],
  未来科技: ['未来科技', 'Future technology'],
  概念艺术: ['概念艺术', 'Concept art'],
  活动物料: ['活动物料', 'Event collateral'],
  海报设计: ['海报设计', 'Poster design'],
  游戏视觉: ['游戏视觉', 'Game visuals'],
  电商视觉: ['电商视觉', 'E-commerce visuals'],
  社交媒体: ['社交媒体', 'Social media'],
  等轴测: ['等轴测', 'Isometric'],
  系列视觉: ['系列视觉', 'Visual series'],
  编辑设计: ['编辑设计', 'Editorial design'],
  网页界面: ['网页界面', 'Web interfaces'],
  自然植物: ['自然植物', 'Nature and botanicals'],
  视频缩略图: ['视频缩略图', 'Video thumbnails'],
  角色场景: ['角色场景', 'Character scenes'],
  设计参考: ['设计参考', 'Design reference'],
  食品饮料: ['食品饮料', 'Food and beverage']
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
