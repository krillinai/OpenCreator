import type {
  CreatorTtsProvider,
  CreatorTtsVoice
} from '@opencreator/protocol';

const QWEN3_TTS_FLASH = 'qwen3-tts-flash';
const QWEN3_TTS_FLASH_2025_11_27 = 'qwen3-tts-flash-2025-11-27';
const QWEN3_TTS_FLASH_2025_09_18 = 'qwen3-tts-flash-2025-09-18';

type AliyunVoiceDefinition = Omit<
  CreatorTtsVoice,
  'provider' | 'kind' | 'supportedModels'
>;

const initialQwen3Voices: AliyunVoiceDefinition[] = [
  { id: 'Cherry', name: '芊悦', language: 'zh-CN', gender: 'female', scenario: '阳光积极', recommended: true },
  { id: 'Serena', name: '苏瑶', language: 'zh-CN', gender: 'female', scenario: '温柔叙事' },
  { id: 'Ethan', name: '晨煦', language: 'zh-CN', gender: 'male', scenario: '阳光男声' },
  { id: 'Chelsie', name: '千雪', language: 'zh-CN', gender: 'female', scenario: '二次元' },
  { id: 'Momo', name: '茉兔', language: 'multi', gender: 'female', scenario: '撒娇搞怪' },
  { id: 'Vivian', name: '十三', language: 'multi', gender: 'female', scenario: '可爱小暴躁' },
  { id: 'Moon', name: '月白', language: 'multi', gender: 'male', scenario: '率性帅气' },
  { id: 'Maia', name: '四月', language: 'multi', gender: 'female', scenario: '知性温柔' },
  { id: 'Kai', name: '凯', language: 'multi', gender: 'male', scenario: '舒缓自然' },
  { id: 'Nofish', name: '不吃鱼', language: 'multi', gender: 'male', scenario: '自然设计师' },
  { id: 'Bella', name: '萌宝', language: 'multi', gender: 'female', scenario: '活泼萝莉' }
];

const currentQwen3Voices: AliyunVoiceDefinition[] = [
  ...initialQwen3Voices,
  { id: 'Jennifer', name: '詹妮弗', language: 'multi', gender: 'female', scenario: '电影质感美语' },
  { id: 'Ryan', name: '甜茶', language: 'multi', gender: 'male', scenario: '戏感张力' },
  { id: 'Katerina', name: '卡捷琳娜', language: 'multi', gender: 'female', scenario: '成熟御姐' },
  { id: 'Aiden', name: '艾登', language: 'multi', gender: 'male', scenario: '美语青年' },
  { id: 'Eldric Sage', name: '沧明子', language: 'multi', gender: 'male', scenario: '沉稳睿智老者' },
  { id: 'Mia', name: '乖小妹', language: 'multi', gender: 'female', scenario: '温顺乖巧' },
  { id: 'Mochi', name: '沙小弥', language: 'multi', gender: 'male', scenario: '聪慧少年' },
  { id: 'Bellona', name: '燕铮莺', language: 'multi', gender: 'female', scenario: '洪亮热血' },
  { id: 'Vincent', name: '田叔', language: 'multi', gender: 'male', scenario: '沙哑豪迈' },
  { id: 'Bunny', name: '萌小姬', language: 'multi', gender: 'female', scenario: '萌系萝莉' },
  { id: 'Neil', name: '阿闻', language: 'multi', gender: 'male', scenario: '新闻主持' },
  { id: 'Elias', name: '墨讲师', language: 'multi', gender: 'female', scenario: '知识讲解' },
  { id: 'Arthur', name: '徐大爷', language: 'multi', gender: 'male', scenario: '乡土故事' },
  { id: 'Nini', name: '邻家妹妹', language: 'multi', gender: 'female', scenario: '甜软亲切' },
  { id: 'Seren', name: '小婉', language: 'multi', gender: 'female', scenario: '舒缓助眠' },
  { id: 'Pip', name: '顽屁小孩', language: 'multi', gender: 'male', scenario: '调皮童声' },
  { id: 'Stella', name: '少女阿月', language: 'multi', gender: 'female', scenario: '甜美少女' },
  { id: 'Bodega', name: '博德加', language: 'multi', gender: 'male', scenario: '西班牙男声' },
  { id: 'Sonrisa', name: '索尼莎', language: 'multi', gender: 'female', scenario: '拉美女声' },
  { id: 'Alek', name: '阿列克', language: 'multi', gender: 'male', scenario: '俄语男声' },
  { id: 'Dolce', name: '多尔切', language: 'multi', gender: 'male', scenario: '意大利男声' },
  { id: 'Sohee', name: '素熙', language: 'multi', gender: 'female', scenario: '韩语女声' },
  { id: 'Ono Anna', name: '小野杏', language: 'multi', gender: 'female', scenario: '日语少女' },
  { id: 'Lenn', name: '莱恩', language: 'multi', gender: 'male', scenario: '德语青年' },
  { id: 'Emilien', name: '埃米尔安', language: 'multi', gender: 'male', scenario: '法语青年' },
  { id: 'Andre', name: '安德雷', language: 'multi', gender: 'male', scenario: '磁性沉稳' },
  { id: 'Radio Gol', name: '拉迪奥·戈尔', language: 'multi', gender: 'male', scenario: '足球解说' },
  { id: 'Jada', name: '上海-阿珍', language: 'zh-shanghai', gender: 'female', scenario: '上海话' },
  { id: 'Dylan', name: '北京-晓东', language: 'zh-beijing', gender: 'male', scenario: '北京话' },
  { id: 'Li', name: '南京-老李', language: 'zh-nanjing', gender: 'male', scenario: '南京话' },
  { id: 'Marcus', name: '陕西-秦川', language: 'zh-shaanxi', gender: 'male', scenario: '陕西话' },
  { id: 'Roy', name: '闽南-阿杰', language: 'zh-minnan', gender: 'male', scenario: '闽南语' },
  { id: 'Peter', name: '天津-李彼得', language: 'zh-tianjin', gender: 'male', scenario: '天津话' },
  { id: 'Sunny', name: '四川-晴儿', language: 'zh-sichuan', gender: 'female', scenario: '四川话' },
  { id: 'Eric', name: '四川-程川', language: 'zh-sichuan', gender: 'male', scenario: '四川话' },
  { id: 'Rocky', name: '粤语-阿强', language: 'zh-yue', gender: 'male', scenario: '粤语' },
  { id: 'Kiki', name: '粤语-阿清', language: 'zh-yue', gender: 'female', scenario: '粤语' }
];

export function listBundledTtsVoices(
  provider: Exclude<CreatorTtsProvider, 'edge-tts'>,
  model: string
): CreatorTtsVoice[] | undefined {
  if (provider !== 'aliyun') return undefined;
  const normalizedModel = model.trim().toLowerCase();
  const definitions = normalizedModel === QWEN3_TTS_FLASH_2025_09_18
    ? initialQwen3Voices
    : (
        normalizedModel === QWEN3_TTS_FLASH
        || normalizedModel === QWEN3_TTS_FLASH_2025_11_27
      )
        ? currentQwen3Voices
        : undefined;
  if (definitions === undefined) return undefined;
  return definitions.map(voice => ({
    ...voice,
    provider,
    kind: 'builtin',
    supportedModels: supportedModelsForVoice(voice.id)
  }));
}

function supportedModelsForVoice(voiceId: string): string[] {
  const models = [QWEN3_TTS_FLASH, QWEN3_TTS_FLASH_2025_11_27];
  if (initialQwen3Voices.some(voice => voice.id === voiceId)) {
    models.push(QWEN3_TTS_FLASH_2025_09_18);
  }
  return models;
}
