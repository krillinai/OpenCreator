import { useEffect, useMemo, useState } from 'react';
import type {
  ImageGenerationQuality,
  ImageGenerationProvider,
  ImageGenerationResult,
  ImageGenerationSize
} from '@opencreator/protocol';
import {
  Check,
  Download,
  Image as ImageIcon,
  Images,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  WandSparkles
} from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { ImageGenerationService } from '../../services/image-generation-service.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';

type ImageStep = 0 | 1 | 2;

const sizes: Array<{ value: ImageGenerationSize; zh: string; en: string; ratio: string }> = [
  { value: '1024x1024', zh: '方形', en: 'Square', ratio: '1:1' },
  { value: '1536x1024', zh: '横向', en: 'Landscape', ratio: '3:2' },
  { value: '1024x1536', zh: '竖向', en: 'Portrait', ratio: '2:3' }
];

const qualities: Array<{ value: ImageGenerationQuality; zh: string; en: string }> = [
  { value: 'low', zh: '快速', en: 'Fast' },
  { value: 'medium', zh: '标准', en: 'Standard' },
  { value: 'high', zh: '高清', en: 'High' }
];

const providers: Array<{ value: ImageGenerationProvider; zh: string; en: string }> = [
  { value: 'openai', zh: 'GPT Image', en: 'GPT Image' },
  { value: 'jimeng', zh: '即梦', en: 'Jimeng' },
  { value: 'kling', zh: '可灵', en: 'Kling' },
  { value: 'gemini', zh: 'Gemini', en: 'Gemini' }
];

const samplePromptZh = '一间通透的现代创意工作室，清晨自然光从落地窗照入，桌面有相机、手稿和绿植，真实摄影质感，构图干净，细节丰富';
const samplePromptEn = 'A bright modern creative studio at sunrise, natural light through floor-to-ceiling windows, a camera, sketches, and plants on the desk, realistic photography, clean composition, rich detail';

export default function ImageGenerationWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  service?: ImageGenerationService;
}) {
  const l = useLocalizedCopy();
  const [currentStep, setCurrentStep] = useState<ImageStep>(0);
  const [furthestStep, setFurthestStep] = useState<ImageStep>(0);
  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<ImageGenerationProvider>('openai');
  const [size, setSize] = useState<ImageGenerationSize>('1024x1024');
  const [quality, setQuality] = useState<ImageGenerationQuality>('medium');
  const [count, setCount] = useState(2);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<ImageGenerationResult>();
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const characterCount = useMemo(() => [...prompt.trim()].length, [prompt]);
  const selectedSize = sizes.find(item => item.value === size) ?? sizes[0]!;
  const selectedQuality = qualities.find(item => item.value === quality) ?? qualities[1]!;
  const selectedProvider = providers.find(item => item.value === provider) ?? providers[0]!;

  useEffect(() => () => {
    imageUrls.forEach(url => URL.revokeObjectURL(url));
  }, [imageUrls]);

  function openStep(step: ImageStep) {
    setCurrentStep(step);
    setFurthestStep(previous => Math.max(previous, step) as ImageStep);
  }

  function nextStep() {
    setError('');
    if (currentStep === 0 && characterCount === 0) {
      setError(l('请先描述需要生成的画面', 'Describe the image you want to create'));
      return;
    }
    openStep(Math.min(2, currentStep + 1) as ImageStep);
  }

  function updatePrompt(value: string) {
    setPrompt(value);
    setResult(undefined);
    setError('');
  }

  async function generate() {
    if (generating) return;
    if (!props.service) {
      setError(l('图像生成服务暂不可用，请检查 Runtime 连接', 'Image generation is unavailable. Check the Runtime connection.'));
      return;
    }
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const response = await props.service.generate({ prompt, provider, size, quality, count });
      const urls = await Promise.all(response.result.images.map(async image => {
        const content = await props.service!.openContent(response.result.id, image.index);
        return URL.createObjectURL(await content.blob());
      }));
      setImageUrls(urls);
      setResult(response.result);
      setNotice(l('图片已生成，可以预览或下载', 'Images are ready to preview or download'));
    } catch (caught) {
      setError(formatImageError(caught, l));
    } finally {
      setGenerating(false);
    }
  }

  function download(index: number) {
    const asset = result?.images[index];
    const url = imageUrls[index];
    if (!asset || !url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = asset.fileName;
    link.click();
    setNotice(l(`图片 ${index + 1} 已开始下载`, `Image ${index + 1} download started`));
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updatePrompt(l(samplePromptZh, samplePromptEn));
      openStep(0);
      return l('示例提示词已填入，可以继续设置画幅和质量。', 'The sample prompt is ready. Continue with format and quality.');
    }
    if (/横向|横版|landscape|3:2/i.test(command)) {
      setSize('1536x1024');
      openStep(1);
      return l('画幅已改为横向 3:2。', 'Format changed to landscape 3:2.');
    }
    if (/竖向|竖版|portrait|2:3/i.test(command)) {
      setSize('1024x1536');
      openStep(1);
      return l('画幅已改为竖向 2:3。', 'Format changed to portrait 2:3.');
    }
    if (/方形|square|1:1/i.test(command)) {
      setSize('1024x1024');
      openStep(1);
      return l('画幅已改为方形 1:1。', 'Format changed to square 1:1.');
    }
    const providerMatch = providers.find(item => command.toLowerCase().includes(item.value) || command.includes(item.zh) || command.toLowerCase().includes(item.en.toLowerCase()));
    if (providerMatch) {
      setProvider(providerMatch.value);
      setResult(undefined);
      openStep(1);
      return l(`图像服务已改为${providerMatch.zh}。`, `Image provider changed to ${providerMatch.en}.`);
    }
    if (command.trim().length > 8) {
      updatePrompt(command.trim());
      openStep(0);
      return l('画面描述已同步，可以继续设置生成参数。', 'The image description is synchronized. Continue with generation settings.');
    }
    return l('请描述画面主体、环境、风格、光线和构图。', 'Describe the subject, setting, style, lighting, and composition.');
  }

  return (
    <CreatorToolShell
      title={l('图像生成', 'Image Generation')}
      subtitle={l('从文字创意生成可下载的视觉素材', 'Create downloadable visual assets from a written idea')}
      context={result ? l(`${result.count} 张图片已完成`, `${result.count} images ready`) : currentStep === 0 ? l('正在编辑画面描述', 'Editing image description') : currentStep === 1 ? `${l(selectedSize.zh, selectedSize.en)} · ${selectedSize.ratio}` : l('等待生成', 'Ready to generate')}
      initialMessage={l('描述你想生成的画面，我会帮你整理画幅、质量和输出数量。', 'Describe the image you want, then set its format, quality, and output count.')}
      suggestions={[l('填入示例提示词', 'Use a sample prompt'), l('生成横向图片', 'Create a landscape image')]}
      placeholder={props.promptHint ?? l('描述需要生成的图片', 'Describe the image to generate')}
      onBack={props.onBack}
      onCommand={handleCommand}
      contentClassName="media-generation-workspace-content"
    >
      <div className="creator-tool-stack media-generation-stack">
        <nav className="video-translation-steps creator-tool-steps" aria-label={l('图像生成流程', 'Image generation workflow')}>
          <ol>
            {[l('画面描述', 'Prompt'), l('生成设置', 'Settings'), l('生成图片', 'Generate')].map((label, index) => {
              const active = currentStep === index;
              const completed = index < currentStep;
              return <li key={label} data-active={active} data-completed={completed}><button type="button" disabled={index > furthestStep} aria-current={active ? 'step' : undefined} onClick={() => openStep(index as ImageStep)}><span>{completed ? <Check size={13} strokeWidth={2.2} /> : index + 1}</span><strong>{label}</strong></button></li>;
            })}
          </ol>
        </nav>

        <div className="media-generation-step-scroll">
          {currentStep === 0 ? (
            <section className="creator-tool-panel media-generation-prompt-panel" aria-labelledby="image-prompt-title">
              <div className="creator-tool-panel-heading"><div><h2 id="image-prompt-title">{l('画面描述', 'Image prompt')}</h2><p>{l('写清主体、环境、风格、光线与构图，最多 4000 字', 'Describe subject, setting, style, lighting, and composition, up to 4,000 characters')}</p></div><small>{characterCount} / 4000</small></div>
              <label className="creator-tool-field"><span>{l('提示词', 'Prompt')}</span><textarea rows={12} maxLength={4000} value={prompt} onChange={event => updatePrompt(event.target.value)} placeholder={l('例如：一位产品设计师站在明亮的工作室中，真实摄影，柔和侧光，画面简洁', 'For example: A product designer in a bright studio, realistic photography, soft side lighting, clean composition')} /></label>
              <button className="smart-dubbing-sample" type="button" onClick={() => updatePrompt(l(samplePromptZh, samplePromptEn))}><WandSparkles size={14} strokeWidth={1.8} />{l('填入示例提示词', 'Use sample prompt')}</button>
            </section>
          ) : null}

          {currentStep === 1 ? (
            <section className="creator-tool-panel" aria-labelledby="image-settings-title">
              <div className="creator-tool-panel-heading"><div><h2 id="image-settings-title">{l('生成设置', 'Generation settings')}</h2><p>{l('设置图片画幅、质量和一次生成数量', 'Set the image format, quality, and number of outputs')}</p></div></div>
              <div className="media-generation-control"><span>{l('图像服务', 'Image provider')}</span><div className="creator-tool-segmented media-generation-provider-options" role="radiogroup" aria-label={l('图像服务', 'Image provider')}>{providers.map(item => <button type="button" role="radio" aria-checked={provider === item.value} aria-selected={provider === item.value} key={item.value} onClick={() => { setProvider(item.value); setResult(undefined); }}>{l(item.zh, item.en)}</button>)}</div></div>
              <div className="media-generation-control"><span>{l('画幅', 'Format')}</span><div className="media-generation-option-grid" role="radiogroup" aria-label={l('图片画幅', 'Image format')}>{sizes.map(item => <button type="button" role="radio" aria-checked={size === item.value} data-selected={size === item.value} key={item.value} onClick={() => { setSize(item.value); setResult(undefined); }}><span className="media-generation-ratio-swatch" data-ratio={item.ratio} /><strong>{l(item.zh, item.en)}</strong><small>{item.ratio} · {item.value}</small></button>)}</div></div>
              <div className="media-generation-control"><span>{l('生成质量', 'Quality')}</span><div className="creator-tool-segmented" role="radiogroup" aria-label={l('图片质量', 'Image quality')}>{qualities.map(item => <button type="button" role="radio" aria-checked={quality === item.value} aria-selected={quality === item.value} key={item.value} onClick={() => { setQuality(item.value); setResult(undefined); }}>{l(item.zh, item.en)}</button>)}</div></div>
              <div className="media-generation-control"><span>{l('生成数量', 'Number of images')}</span><div className="creator-tool-segmented" role="radiogroup" aria-label={l('生成数量', 'Number of images')}>{[1, 2, 4].map(value => <button type="button" role="radio" aria-checked={count === value} aria-selected={count === value} key={value} onClick={() => { setCount(value); setResult(undefined); }}>{value} {l('张', value === 1 ? 'image' : 'images')}</button>)}</div></div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <div className="creator-task-final-grid media-generation-final-grid">
              <section className="creator-tool-panel media-generation-output-panel" aria-labelledby="image-output-title">
                <div className="creator-tool-panel-heading"><div><h2 id="image-output-title">{result ? l('生成结果', 'Generated images') : l('生成图片', 'Generate images')}</h2><p>{result ? l('查看大图并下载需要的方案', 'Preview and download any image') : l('确认设置后开始生成图片', 'Review the settings, then start generating')}</p></div></div>
                {result && imageUrls.length > 0 ? (
                  <div className="image-generation-result-grid" data-count={result.count} data-ratio={selectedSize.ratio}>{result.images.map((asset, index) => <article key={asset.index}><img src={imageUrls[index]} alt={`${l('生成图片', 'Generated image')} ${index + 1}`} /><footer><span><strong>{l('方案', 'Option')} {index + 1}</strong><small>{formatBytes(asset.size)}</small></span><button type="button" onClick={() => download(index)} aria-label={`${l('下载图片', 'Download image')} ${index + 1}`} title={l('下载', 'Download')}><Download size={16} strokeWidth={1.8} /></button></footer></article>)}</div>
                ) : (
                  <div className="smart-dubbing-ready"><span><Images size={24} strokeWidth={1.6} /></span><strong>{l('准备生成图片', 'Ready to generate images')}</strong><p>{l(`${l(selectedProvider.zh, selectedProvider.en)} · ${count} 张 ${selectedSize.ratio} 图片 · ${l(selectedQuality.zh, selectedQuality.en)}质量`, `${selectedProvider.en} · ${count} ${selectedSize.ratio} images · ${selectedQuality.en} quality`)}</p><button className="creator-tool-primary" type="button" onClick={generate} disabled={generating}>{generating ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}{generating ? l('正在生成', 'Generating') : l('开始生成', 'Generate')}</button></div>
                )}
                {result ? <div className="media-generation-result-actions"><button type="button" onClick={generate} disabled={generating}><RotateCcw size={15} />{l('重新生成', 'Regenerate')}</button></div> : null}
              </section>
              <CreatorTaskSummary sourceIcon={ImageIcon} sourceLabel={l('画面描述', 'Prompt')} sourceValue={prompt.trim()} items={[{ label: l('图像服务', 'Provider'), value: l(selectedProvider.zh, selectedProvider.en) }, { label: l('画幅', 'Format'), value: `${l(selectedSize.zh, selectedSize.en)} · ${selectedSize.ratio}` }, { label: l('分辨率', 'Resolution'), value: size }, { label: l('质量', 'Quality'), value: l(selectedQuality.zh, selectedQuality.en) }, { label: l('生成数量', 'Images'), value: String(count) }]} />
            </div>
          ) : null}
          {error ? <p className="creator-tool-error" role="alert">{error}</p> : null}
          {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        </div>

        <footer className="video-translation-wizard-actions media-generation-actions">
          <button className="video-translation-secondary-action" type="button" onClick={() => currentStep === 0 ? props.onBack() : openStep((currentStep - 1) as ImageStep)}>{currentStep === 0 ? l('返回', 'Back') : l('上一步', 'Back')}</button>
          {currentStep < 2 ? <button className="video-translation-primary-action" type="button" onClick={nextStep}>{l('继续', 'Continue')}</button> : null}
        </footer>
      </div>
    </CreatorToolShell>
  );
}

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatImageError(error: unknown, l: (zh: string, en: string) => string) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (code === 'IMAGE_GENERATION_CONFIG_REQUIRED') return l('请先在设置的 AI 服务中配置图像生成 API Key', 'Configure an image generation API key in AI Services first');
  if (code === 'IMAGE_GENERATION_UPSTREAM_ERROR') return l('图像生成请求失败，请检查服务配置和网络后重试', 'Image generation failed. Check the service configuration and network, then retry.');
  return error instanceof Error ? error.message : l('图片生成失败，请稍后重试', 'Image generation failed. Try again later.');
}
