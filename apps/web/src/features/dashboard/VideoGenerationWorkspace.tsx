import { useEffect, useMemo, useState } from 'react';
import type {
  VideoGenerationDuration,
  VideoGenerationProvider,
  VideoGenerationReferenceImage,
  VideoGenerationResult,
  VideoGenerationSize
} from '@opencreator/protocol';
import {
  Check,
  Clapperboard,
  Download,
  Film,
  LoaderCircle,
  Plus,
  RotateCcw,
  Sparkles,
  WandSparkles,
  X
} from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { VideoGenerationService } from '../../services/video-generation-service.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';

type VideoStep = 0 | 1 | 2;

const sizes: Array<{ value: VideoGenerationSize; zh: string; en: string; ratio: string }> = [
  { value: '1280x720', zh: '横屏', en: 'Landscape', ratio: '16:9' },
  { value: '720x1280', zh: '竖屏', en: 'Portrait', ratio: '9:16' },
  { value: '1024x1024', zh: '方形', en: 'Square', ratio: '1:1' }
];

const providers: Array<{ value: VideoGenerationProvider; zh: string; en: string }> = [
  { value: 'seedance', zh: 'Seedance', en: 'Seedance' },
  { value: 'kling', zh: '可灵', en: 'Kling' },
  { value: 'veo', zh: 'Veo', en: 'Veo' }
];

const providerDurations: Record<VideoGenerationProvider, VideoGenerationDuration[]> = {
  seedance: [5, 10],
  kling: [5, 10],
  veo: [4, 6, 8]
};

const samplePromptZh = '一辆复古红色跑车沿着海岸公路行驶，黄昏金色阳光，低机位跟拍，海风吹动路边植物，电影级真实质感，镜头运动平稳';
const samplePromptEn = 'A vintage red sports car driving along a coastal road at golden hour, low-angle tracking shot, sea breeze moving roadside plants, cinematic realism, smooth camera motion';
const referenceImageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
const maxReferenceImageBytes = 5 * 1024 * 1024;

export default function VideoGenerationWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  service?: VideoGenerationService;
}) {
  const l = useLocalizedCopy();
  const [currentStep, setCurrentStep] = useState<VideoStep>(0);
  const [furthestStep, setFurthestStep] = useState<VideoStep>(0);
  const [prompt, setPrompt] = useState('');
  const [referenceImageFile, setReferenceImageFile] = useState<File>();
  const [referenceImageUrl, setReferenceImageUrl] = useState('');
  const [provider, setProvider] = useState<VideoGenerationProvider>('seedance');
  const [size, setSize] = useState<VideoGenerationSize>('1280x720');
  const [duration, setDuration] = useState<VideoGenerationDuration>(5);
  const [result, setResult] = useState<VideoGenerationResult>();
  const [videoUrl, setVideoUrl] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const characterCount = useMemo(() => [...prompt.trim()].length, [prompt]);
  const selectedSize = sizes.find(item => item.value === size) ?? sizes[0]!;
  const selectedProvider = providers.find(item => item.value === provider) ?? providers[0]!;
  const durations = providerDurations[provider];

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => {
    if (!referenceImageFile) {
      setReferenceImageUrl('');
      return;
    }
    const url = URL.createObjectURL(referenceImageFile);
    setReferenceImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [referenceImageFile]);

  useEffect(() => {
    if (!result || !props.service) return;
    if (result.status === 'failed') {
      setGenerating(false);
      setError(result.error || l('视频生成失败，请调整提示词后重试', 'Video generation failed. Adjust the prompt and retry.'));
      return;
    }
    if (result.status === 'completed') {
      if (videoUrl) {
        setGenerating(false);
        return;
      }
      let active = true;
      void props.service.openContent(result.id)
        .then(response => response.blob())
        .then(blob => {
          if (!active) return;
          setVideoUrl(URL.createObjectURL(blob));
          setGenerating(false);
          setNotice(l('视频已生成，可以预览或下载', 'The video is ready to preview or download'));
        })
        .catch(caught => {
          if (!active) return;
          setGenerating(false);
          setError(formatVideoError(caught, l));
        });
      return () => {
        active = false;
      };
    }

    let active = true;
    const timer = window.setTimeout(() => {
      void props.service!.get(result.id)
        .then(response => {
          if (active) setResult(response.result);
        })
        .catch(caught => {
          if (!active) return;
          setGenerating(false);
          setError(formatVideoError(caught, l));
        });
    }, 2500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [l, props.service, result, videoUrl]);

  function openStep(step: VideoStep) {
    setCurrentStep(step);
    setFurthestStep(previous => Math.max(previous, step) as VideoStep);
  }

  function nextStep() {
    setError('');
    if (currentStep === 0 && characterCount === 0) {
      setError(l('请先描述需要生成的视频', 'Describe the video you want to create'));
      return;
    }
    openStep(Math.min(2, currentStep + 1) as VideoStep);
  }

  function updatePrompt(value: string) {
    setPrompt(value);
    setResult(undefined);
    setError('');
  }

  function updateProvider(nextProvider: VideoGenerationProvider) {
    const nextDurations = providerDurations[nextProvider];
    setProvider(nextProvider);
    if (!nextDurations.includes(duration)) setDuration(nextDurations[0]!);
    setResult(undefined);
  }

  function updateReferenceImage(file: File | null) {
    if (!file) return;
    if (!(referenceImageTypes as readonly string[]).includes(file.type) || file.size > maxReferenceImageBytes) {
      setError(l('请上传 5MB 以内的 JPG、PNG 或 WebP 图片', 'Upload a JPG, PNG, or WebP image up to 5 MB'));
      return;
    }
    setReferenceImageFile(file);
    setResult(undefined);
    setError('');
    setNotice(l('参考图已添加', 'Reference image added'));
  }

  function removeReferenceImage() {
    setReferenceImageFile(undefined);
    setResult(undefined);
    setError('');
    setNotice(l('参考图已移除', 'Reference image removed'));
  }

  async function generate() {
    if (generating) return;
    if (!props.service) {
      setError(l('视频生成服务暂不可用，请检查 Runtime 连接', 'Video generation is unavailable. Check the Runtime connection.'));
      return;
    }
    setGenerating(true);
    setResult(undefined);
    setVideoUrl('');
    setError('');
    setNotice('');
    try {
      const referenceImage = referenceImageFile
        ? await readReferenceImage(referenceImageFile)
        : undefined;
      const response = await props.service.generate({
        prompt,
        provider,
        size,
        duration,
        ...(referenceImage ? { referenceImage } : {})
      });
      setResult(response.result);
      if (response.result.status === 'failed') setGenerating(false);
    } catch (caught) {
      setGenerating(false);
      setError(formatVideoError(caught, l));
    }
  }

  function download() {
    if (!result?.fileName || !videoUrl) return;
    const link = document.createElement('a');
    link.href = videoUrl;
    link.download = result.fileName;
    link.click();
    setNotice(l('视频已开始下载', 'Video download started'));
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updatePrompt(l(samplePromptZh, samplePromptEn));
      openStep(0);
      return l('示例提示词已填入，可以继续设置画幅和时长。', 'The sample prompt is ready. Continue with format and duration.');
    }
    if (/横屏|横版|landscape|16:9/i.test(command)) {
      setSize('1280x720');
      openStep(1);
      return l('视频画幅已改为横屏 16:9。', 'Video format changed to landscape 16:9.');
    }
    if (/竖屏|竖版|portrait|9:16/i.test(command)) {
      setSize('720x1280');
      openStep(1);
      return l('视频画幅已改为竖屏 9:16。', 'Video format changed to portrait 9:16.');
    }
    const providerMatch = providers.find(item => command.toLowerCase().includes(item.value) || command.includes(item.zh) || command.toLowerCase().includes(item.en.toLowerCase()));
    if (providerMatch) {
      updateProvider(providerMatch.value);
      openStep(1);
      return l(`视频服务已改为${providerMatch.zh}。`, `Video provider changed to ${providerMatch.en}.`);
    }
    const durationMatch = command.match(/(?:时长|duration)?\s*(4|5|6|8|10)\s*(?:秒|s|seconds?)/i);
    if (durationMatch && durations.includes(Number(durationMatch[1]) as VideoGenerationDuration)) {
      setDuration(Number(durationMatch[1]) as VideoGenerationDuration);
      openStep(1);
      return l(`视频时长已改为 ${durationMatch[1]} 秒。`, `Video duration changed to ${durationMatch[1]} seconds.`);
    }
    if (command.trim().length > 8) {
      updatePrompt(command.trim());
      openStep(0);
      return l('视频描述已同步，可以继续设置生成参数。', 'The video description is synchronized. Continue with generation settings.');
    }
    return l('请描述主体动作、场景、镜头运动、光线和视觉风格。', 'Describe the action, scene, camera movement, lighting, and visual style.');
  }

  const statusLabel = result?.status === 'queued'
    ? l('正在排队', 'Queued')
    : result?.status === 'in_progress'
      ? l('正在生成', 'Generating')
      : l('正在提交任务', 'Submitting job');

  return (
    <CreatorToolShell
      title={l('视频生成', 'Video Generation')}
      subtitle={l('从文字创意生成可预览和下载的视频', 'Turn a written idea into a previewable, downloadable video')}
      context={result?.status === 'completed' ? l('视频已完成', 'Video ready') : result && result.status !== 'failed' ? `${statusLabel} · ${result.progress}%` : currentStep === 0 ? l('正在编辑视频描述', 'Editing video description') : currentStep === 1 ? `${l(selectedSize.zh, selectedSize.en)} · ${duration}s` : l('等待生成', 'Ready to generate')}
      initialMessage={l('描述你想生成的视频，包括主体动作、镜头和画面风格。', 'Describe the video, including subject movement, camera direction, and visual style.')}
      suggestions={[l('填入示例提示词', 'Use a sample prompt'), l('生成竖屏视频', 'Create a portrait video')]}
      placeholder={props.promptHint ?? l('描述需要生成的视频', 'Describe the video to generate')}
      onBack={props.onBack}
      onCommand={handleCommand}
      contentClassName="media-generation-workspace-content"
    >
      <div className="creator-tool-stack media-generation-stack">
        <nav className="video-translation-steps creator-tool-steps" aria-label={l('视频生成流程', 'Video generation workflow')}>
          <ol>
            {[l('视频描述', 'Prompt'), l('生成设置', 'Settings'), l('生成视频', 'Generate')].map((label, index) => {
              const active = currentStep === index;
              const completed = index < currentStep;
              return <li key={label} data-active={active} data-completed={completed}><button type="button" disabled={index > furthestStep} aria-current={active ? 'step' : undefined} onClick={() => openStep(index as VideoStep)}><span>{completed ? <Check size={13} strokeWidth={2.2} /> : index + 1}</span><strong>{label}</strong></button></li>;
            })}
          </ol>
        </nav>

        <div className="media-generation-step-scroll">
          {currentStep === 0 ? (
            <section className="creator-tool-panel media-generation-prompt-panel" aria-labelledby="video-prompt-title">
              <div className="creator-tool-panel-heading"><div><h2 id="video-prompt-title">{l('视频描述', 'Video prompt')}</h2><p>{l('写清主体动作、环境、镜头运动、光线和风格，最多 4000 字', 'Describe action, setting, camera movement, lighting, and style, up to 4,000 characters')}</p></div><small>{characterCount} / 4000</small></div>
              <div className="video-generation-prompt-inputs">
                <div className="video-reference-field">
                  <span className="video-reference-label">{l('参考图', 'Reference')}</span>
                  <div className="video-reference-upload-wrap">
                    <label className="video-reference-upload" title={l('上传 JPG、PNG 或 WebP 图片，最大 5MB', 'Upload a JPG, PNG, or WebP image up to 5 MB')}>
                      <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={l('上传视频参考图', 'Upload video reference image')} onChange={event => updateReferenceImage(event.target.files?.[0] ?? null)} />
                      <span className="video-reference-thumbnail" data-loaded={referenceImageFile ? 'true' : 'false'}>{referenceImageFile ? <img src={referenceImageUrl} alt={l('视频参考图预览', 'Video reference preview')} /> : <><Plus size={22} strokeWidth={1.6} /><small>{l('添加图片', 'Add image')}</small></>}</span>
                    </label>
                    {referenceImageFile ? <button className="video-reference-remove" type="button" onClick={removeReferenceImage} aria-label={l('移除参考图', 'Remove reference image')} title={l('移除参考图', 'Remove reference image')}><X size={15} strokeWidth={1.8} /></button> : null}
                  </div>
                  <small className="video-reference-meta" title={referenceImageFile?.name ?? l('支持 JPG、PNG、WebP，最大 5MB', 'JPG, PNG, or WebP, up to 5 MB')}>{referenceImageFile?.name ?? l('选填', 'Optional')}</small>
                </div>
                <label className="creator-tool-field"><span>{l('提示词', 'Prompt')}</span><textarea rows={12} maxLength={4000} value={prompt} onChange={event => updatePrompt(event.target.value)} placeholder={l('例如：低机位跟随一辆红色跑车驶过海岸公路，黄昏金色光线，镜头平稳', 'For example: A low-angle tracking shot following a red sports car along a coastal road at golden hour, smooth camera motion')} /></label>
              </div>
              <button className="smart-dubbing-sample" type="button" onClick={() => updatePrompt(l(samplePromptZh, samplePromptEn))}><WandSparkles size={14} strokeWidth={1.8} />{l('填入示例提示词', 'Use sample prompt')}</button>
            </section>
          ) : null}

          {currentStep === 1 ? (
            <section className="creator-tool-panel" aria-labelledby="video-settings-title">
              <div className="creator-tool-panel-heading"><div><h2 id="video-settings-title">{l('生成设置', 'Generation settings')}</h2><p>{l('分别设置视频服务、画幅、分辨率和时长', 'Set the video provider, format, resolution, and duration independently')}</p></div></div>
              <div className="video-generation-settings-grid">
                <label className="creator-tool-field"><span>{l('视频服务', 'Video provider')}</span><select value={provider} onChange={event => updateProvider(event.target.value as VideoGenerationProvider)}>{providers.map(item => <option key={item.value} value={item.value}>{l(item.zh, item.en)}</option>)}</select></label>
                <label className="creator-tool-field"><span>{l('画幅', 'Format')}</span><select value={size} onChange={event => { setSize(event.target.value as VideoGenerationSize); setResult(undefined); }}>{sizes.map(item => <option key={item.value} value={item.value}>{l(item.zh, item.en)} · {item.ratio} · {item.value}</option>)}</select></label>
                <label className="creator-tool-field"><span>{l('视频时长', 'Video duration')}</span><select value={duration} onChange={event => { setDuration(Number(event.target.value) as VideoGenerationDuration); setResult(undefined); }}>{durations.map(value => <option key={value} value={value}>{value} {l('秒', 'seconds')}</option>)}</select></label>
              </div>
              <div className="media-generation-setting-note"><Film size={17} strokeWidth={1.7} /><span><strong>{l('生成时间', 'Generation time')}</strong><small>{l('视频生成通常需要几分钟，任务提交后页面会自动刷新进度', 'Video generation typically takes several minutes. Progress refreshes automatically after submission.')}</small></span></div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <div className="creator-task-final-grid media-generation-final-grid">
              <section className="creator-tool-panel media-generation-output-panel" aria-labelledby="video-output-title">
                <div className="creator-tool-panel-heading"><div><h2 id="video-output-title">{videoUrl ? l('生成结果', 'Generated video') : l('生成视频', 'Generate video')}</h2><p>{videoUrl ? l('预览成片并下载视频文件', 'Preview and download the finished video') : result && result.status !== 'failed' ? l('任务已提交，完成后会自动载入成片', 'The job is running. The finished video will load automatically.') : l('确认设置后提交视频生成任务', 'Review the settings, then submit the generation job')}</p></div></div>
                {videoUrl && result?.status === 'completed' ? (
                  <div className="video-generation-result" data-ratio={selectedSize.ratio}><video controls src={videoUrl} aria-label={l('生成视频预览', 'Generated video preview')} /><div><span><strong>{result.fileName}</strong><small>{result.size ? formatBytes(result.size) : 'MP4'} · {result.model}</small></span><div><button type="button" onClick={generate} disabled={generating}><RotateCcw size={15} />{l('重新生成', 'Regenerate')}</button><button className="creator-tool-primary" type="button" onClick={download}><Download size={15} />{l('下载视频', 'Download video')}</button></div></div></div>
                ) : result && (result.status === 'queued' || result.status === 'in_progress') ? (
                  <div className="video-generation-progress" role="status"><span><LoaderCircle className="smart-dubbing-spinner" size={25} /></span><strong>{statusLabel}</strong><p>{l('可以停留在当前页面，完成后将自动显示预览', 'Stay on this page. The preview will appear automatically when complete.')}</p><div><span style={{ width: `${Math.max(4, result.progress)}%` }} /></div><small>{result.progress}%</small></div>
                ) : (
                  <div className="smart-dubbing-ready"><span><Clapperboard size={24} strokeWidth={1.6} /></span><strong>{l('准备生成视频', 'Ready to generate video')}</strong><p>{l(`${l(selectedProvider.zh, selectedProvider.en)} · ${selectedSize.ratio} · ${duration} 秒 · ${size}`, `${selectedProvider.en} · ${selectedSize.ratio} · ${duration} seconds · ${size}`)}</p></div>
                )}
              </section>
              <CreatorTaskSummary sourceIcon={Clapperboard} sourceLabel={l('视频描述', 'Prompt')} sourceValue={prompt.trim()} items={[...(referenceImageFile ? [{ label: l('参考图', 'Reference image'), value: referenceImageFile.name }] : []), { label: l('视频服务', 'Provider'), value: l(selectedProvider.zh, selectedProvider.en) }, { label: l('画幅', 'Format'), value: `${l(selectedSize.zh, selectedSize.en)} · ${selectedSize.ratio}` }, { label: l('分辨率', 'Resolution'), value: size }, { label: l('时长', 'Duration'), value: l(`${duration} 秒`, `${duration} seconds`) }, { label: l('输出格式', 'Format'), value: 'MP4' }]} />
            </div>
          ) : null}
          {error ? <p className="creator-tool-error" role="alert">{error}</p> : null}
          {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        </div>

        <footer className="video-translation-wizard-actions media-generation-actions" aria-label={l('视频生成操作', 'Video generation actions')}>
          <button className="video-translation-secondary-action" type="button" onClick={() => currentStep === 0 ? props.onBack() : openStep((currentStep - 1) as VideoStep)}>{currentStep === 0 ? l('返回', 'Back') : l('上一步', 'Back')}</button>
          {currentStep < 2 ? <button className="video-translation-primary-action" type="button" onClick={nextStep}>{l('继续', 'Continue')}</button> : null}
          {currentStep === 2 && !videoUrl && !(result && (result.status === 'queued' || result.status === 'in_progress')) ? <button className="video-translation-primary-action" type="button" onClick={generate} disabled={generating}>{generating ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}{generating ? l('正在提交', 'Submitting') : l('开始生成', 'Generate')}</button> : null}
        </footer>
      </div>
    </CreatorToolShell>
  );
}

function readReferenceImage(file: File): Promise<VideoGenerationReferenceImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('REFERENCE_IMAGE_READ_FAILED'));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const separator = value.indexOf(',');
      if (separator < 0) {
        reject(new Error('REFERENCE_IMAGE_READ_FAILED'));
        return;
      }
      resolve({
        mime: file.type as VideoGenerationReferenceImage['mime'],
        data: value.slice(separator + 1)
      });
    };
    reader.readAsDataURL(file);
  });
}

function formatBytes(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatVideoError(error: unknown, l: (zh: string, en: string) => string) {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code?: unknown }).code) : '';
  if (error instanceof Error && error.message === 'REFERENCE_IMAGE_READ_FAILED') return l('参考图读取失败，请重新选择图片', 'The reference image could not be read. Choose it again.');
  if (code === 'VIDEO_GENERATION_CONFIG_REQUIRED') return l('请先在设置的 AI 服务中配置视频生成 API Key', 'Configure a video generation API key in AI Services first');
  if (code === 'VIDEO_GENERATION_UPSTREAM_ERROR') return l('视频生成请求失败，请检查模型服务配置和网络后重试', 'Video generation failed. Check the model service configuration and network, then retry.');
  return error instanceof Error ? error.message : l('视频生成失败，请稍后重试', 'Video generation failed. Try again later.');
}
