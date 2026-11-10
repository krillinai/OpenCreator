import {
  createDefaultCreatorServicesConfig,
  gatewayModelIdMatches,
  gatewayModelReady,
  type CreatorServicesConfig,
  type GatewayModel,
  type ImageGenerationProvider
} from '@opencreator/protocol';
import { ArrowUpRight, Check } from 'lucide-react';
import ModelBrandIcon from '../../components/brand/ModelBrandIcon.js';
import { officialModelLabel } from '../../components/forms/OfficialModelSelect.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import type { useOfficialServices } from './official-services.js';
import './ImageGenerationDiscovery.css';

const defaultImageConfig = createDefaultCreatorServicesConfig().image;
const localModelOrder = ['openai', 'gemini', 'jimeng', 'kling'] as const;

const templates = [
  {
    id: 'info-poster',
    titleZh: '中文信息海报',
    titleEn: 'Editorial info poster',
    image: '/skill-market/examples/gpt-image-2-info-poster.png',
    ratio: '3:2',
    promptZh: '为“高效创作者的周末计划”设计一张中文信息海报，米白纸张背景，黑色粗体大标题，搭配明黄、浅蓝和珊瑚橙的信息卡片，网格排版清晰，文字准确可读，现代编辑设计风格',
    promptEn: 'Design an English editorial info poster titled “A Creative Weekend”, warm off-white paper background, bold black headline, yellow, pale blue, and coral information cards, clean grid layout, crisp readable typography, modern editorial design'
  },
  {
    id: 'product-visual',
    titleZh: '电商产品主图',
    titleEn: 'E-commerce product visual',
    image: '/skill-market/examples/nano-banana-pro-product-visual.png',
    ratio: '3:2',
    promptZh: '为一瓶无糖气泡水制作高端电商主图，透明玻璃瓶与清爽的标签设计，产品位于画面中央，周围有少量冰块、柠檬片和飞溅水花，柔和自然光，干净浅色背景，真实商业摄影',
    promptEn: 'Create a premium e-commerce hero image for a bottle of sparkling water, clear glass bottle with a fresh minimal label, centered product, a few ice cubes, lemon slices, and subtle water splashes, soft daylight, clean pale background, realistic commercial photography'
  },
  {
    id: 'riverside-village',
    titleZh: '河畔村落',
    titleEn: 'Riverside village',
    image: '/dashboard/templates/seedream-showcase.webp',
    ratio: '16:9',
    promptZh: '清晨的河畔传统村落，水面倒映木质房屋与远处青山，薄雾沿河流缓缓散开，暖色阳光照亮屋檐，真实摄影，自然细节丰富，宁静而富有电影感，广角构图',
    promptEn: 'A traditional riverside village at sunrise, wooden houses and distant green mountains reflected in calm water, thin mist drifting along the river, warm sunlight across the rooftops, realistic photography, rich natural detail, quiet cinematic atmosphere, wide composition'
  },
  {
    id: 'space-habitat',
    titleZh: '太空居所',
    titleEn: 'Space habitat',
    image: '/dashboard/templates/retrofuturism.webp',
    ratio: '16:9',
    promptZh: '未来太空居所的巨大弧形观景窗，窗外是蓝色地球与辽阔星空，室内有温暖的灯光、绿植和简洁家具，复古未来主义，真实材质，电影级光影，超广角构图',
    promptEn: 'A vast curved observation window inside a futuristic space habitat, blue Earth and deep star fields outside, warm interior lighting, green plants and minimal furniture, retrofuturism, tactile materials, cinematic lighting, ultra-wide composition'
  },
  {
    id: 'mountain-hut',
    titleZh: '雪山小屋',
    titleEn: 'Mountain hideaway',
    image: '/dashboard/templates/nb21-mountain-hut.webp',
    ratio: '16:9',
    promptZh: '雪山深处的一座红色木屋，屋顶覆盖厚雪，周围是高耸雪山与清冷蓝天，温暖灯光从窗户透出，真实风光摄影，色彩对比鲜明，空气清澈，史诗感构图',
    promptEn: 'A small red cabin deep in snow-covered mountains, thick snow on the roof, towering peaks and a crisp blue sky, warm light glowing from the windows, realistic landscape photography, striking color contrast, clear air, epic composition'
  },
  {
    id: 'golden-field',
    titleZh: '金色麦田',
    titleEn: 'Golden wheat field',
    image: '/dashboard/templates/nb21-wheat-field.webp',
    ratio: '16:9',
    promptZh: '金色麦田中的轻盈白色长裙，微风吹动麦穗与裙摆，午后阳光柔和明亮，远处是低矮山丘与淡蓝色天空，真实人像摄影，自然肤色，浅景深，温暖自由的夏日氛围',
    promptEn: 'A flowing white dress in a golden wheat field, breeze moving through the wheat and fabric, soft bright afternoon sunlight, low hills and a pale blue sky in the distance, realistic portrait photography, natural skin tones, shallow depth of field, warm carefree summer mood'
  }
] as const;

export default function ImageGenerationDiscovery(props: {
  official: ReturnType<typeof useOfficialServices>;
  provider: ImageGenerationProvider;
  providers: Array<{ value: ImageGenerationProvider; zh: string; en: string }>;
  imageConfig: CreatorServicesConfig['image'] | null;
  busy: boolean;
  onProviderChange(provider: ImageGenerationProvider): void;
  onTemplate(prompt: string, aspectRatio: string): void;
}) {
  const l = useLocalizedCopy();
  const config = props.imageConfig ?? defaultImageConfig;
  const officialModels = [...props.official.models]
    .sort((left, right) => popularModelScore(right) - popularModelScore(left))
    .slice(0, 4);
  const localModels = localModelOrder.flatMap(value => {
    const item = props.providers.find(provider => provider.value === value);
    return item ? [{ ...item, configuredModel: config[value].model }] : [];
  });

  return (
    <div className="image-generation-discovery">
      <section className="image-generation-popular" aria-labelledby="image-popular-models-title">
        <header className="image-generation-section-heading">
          <div>
            <h2 id="image-popular-models-title">{l('热门模型', 'Popular models')}</h2>
            <p>{l('按画面类型选择模型，点击即可切换', 'Choose a model for your visual style. Select a card to switch.')}</p>
          </div>
        </header>
        <div className="image-generation-model-cards">
          {props.official.official ? officialModels.map(model => {
            const name = officialModelLabel(model, l('自动选择', 'Automatic'));
            const selected = gatewayModelIdMatches(props.official.selected ?? props.official.model?.id, model.id);
            return (
              <ModelCard
                key={model.id}
                name={name}
                description={modelStrength(`${model.id} ${model.name ?? ''}`, l)}
                image={modelArtwork(`${model.id} ${model.name ?? ''}`)}
                iconModel={model}
                selected={selected}
                disabled={props.busy || !props.official.selectable || !gatewayModelReady(model)}
                onClick={() => props.official.selectModel(model.id)}
                label={l(`选择模型 ${name}`, `Use model ${name}`)}
              />
            );
          }) : localModels.map(item => {
            const name = l(item.zh, item.en);
            return (
              <ModelCard
                key={item.value}
                name={name}
                detail={item.configuredModel}
                description={modelStrength(item.value, l)}
                image={modelArtwork(item.value)}
                iconModel={{ id: item.value, name: item.en }}
                selected={props.provider === item.value}
                disabled={props.busy}
                onClick={() => props.onProviderChange(item.value)}
                label={l(`选择模型 ${name}`, `Use model ${name}`)}
              />
            );
          })}
        </div>
      </section>

      <section className="image-generation-templates" aria-labelledby="image-prompt-templates-title">
        <header className="image-generation-section-heading">
          <div>
            <h2 id="image-prompt-templates-title">{l('提示词模版', 'Prompt templates')}</h2>
            <p>{l('从精选画面开始，一键填入提示词，再继续调整', 'Start with a curated scene, fill the prompt in one click, then refine it.')}</p>
          </div>
        </header>
        <div className="image-generation-template-grid">
          {templates.map(template => {
            const title = l(template.titleZh, template.titleEn);
            return (
              <button
                type="button"
                className="image-generation-template-card"
                key={template.id}
                aria-label={l(`使用模版 ${title}`, `Use template ${title}`)}
                disabled={props.busy}
                onClick={() => props.onTemplate(l(template.promptZh, template.promptEn), template.ratio)}
              >
                <span className="image-generation-template-artwork">
                  <img src={template.image} alt="" loading="lazy" decoding="async" />
                  <span className="image-generation-template-tag">{title}</span>
                  <span className="image-generation-template-open" aria-hidden="true"><ArrowUpRight size={17} /></span>
                </span>
                <span className="image-generation-template-copy">
                  <strong>{title}</strong>
                  <small>{template.ratio} · {l('填入提示词', 'Use prompt')}</small>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function ModelCard(props: {
  name: string;
  detail?: string;
  description: string;
  image: string;
  iconModel: Pick<GatewayModel, 'id' | 'name'>;
  selected: boolean;
  disabled: boolean;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      className="image-generation-model-card"
      aria-label={props.label}
      aria-pressed={props.selected}
      data-selected={props.selected}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span className="image-generation-model-artwork">
        <img src={props.image} alt="" loading="lazy" decoding="async" />
        <span className="image-generation-model-name">
          <ModelBrandIcon model={props.iconModel} />
          <span><strong>{props.name}</strong>{props.detail ? <small>{props.detail}</small> : null}</span>
        </span>
        {props.selected ? <span className="image-generation-model-selected"><Check size={13} aria-hidden="true" /></span> : null}
      </span>
      <span className="image-generation-model-description">{props.description}</span>
    </button>
  );
}

function popularModelScore(model: GatewayModel) {
  const identity = `${model.id} ${model.name ?? ''}`;
  const preferred = /gpt[- ]?image|nano[- ]?banana|seedream|gemini|jimeng|kling/i.test(identity);
  return Number(model.recommended) * 20 + Number(preferred) * 10 + Number(gatewayModelReady(model));
}

function modelArtwork(identity: string) {
  if (/openai|gpt[- ]?image|codex/i.test(identity)) return '/skill-market/examples/gpt-image-2-info-poster.png';
  if (/gemini|nano[- ]?banana|google/i.test(identity)) return '/skill-market/examples/nano-banana-pro-product-visual.png';
  if (/seedream|jimeng|doubao|bytedance/i.test(identity)) return '/dashboard/templates/seedream-showcase.webp';
  if (/kling/i.test(identity)) return '/dashboard/templates/retrofuturism.webp';
  return '/dashboard/templates/nb21-mountain-hut.webp';
}

function modelStrength(identity: string, l: LocalizeCopy) {
  if (/openai|gpt[- ]?image|codex/i.test(identity)) return l('精准提示词、清晰文字与商业海报', 'Precise prompts, clean typography, and editorial visuals.');
  if (/gemini|nano[- ]?banana|google/i.test(identity)) return l('多参考图编辑与快速风格控制', 'Multi-reference edits with fast style control.');
  if (/seedream|jimeng|doubao|bytedance/i.test(identity)) return l('电影感写实画面与戏剧化光影', 'Cinematic realism and dramatic lighting.');
  if (/kling/i.test(identity)) return l('一致的人物表现与品牌视觉', 'Consistent portraits and brand visuals.');
  return l('高质量文字生图与丰富画面细节', 'High-quality text-to-image generation with rich detail.');
}
