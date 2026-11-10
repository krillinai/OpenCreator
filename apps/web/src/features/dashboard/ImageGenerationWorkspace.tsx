import {
  creatorPromptMaxLength,
  createDefaultCreatorServicesConfig,
  imageModelOptions,
  imageSizeAspectRatio,
  type CreatorServicesConfig,
  imagePromptRequiresReference,
  readCreatorResultSnapshots,
  safePublicErrorMessage,
  type PublicErrorFacts,
  type CreatorArtifact,
  type CreatorJson,
  type ImageGenerationProvider,
  type ImageGenerationQuality,
  type ImageGenerationSize
} from '@opencreator/protocol';
import { OfficialModelField, useOfficialServices } from './official-services.js';
import { useGenerationAccess } from './DashboardGenerationAccess.js';
import {
  Download,
  Image as ImageIcon,
  ImagePlus,
  Images,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
  WandSparkles
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import OfficialModelSelect from '../../components/forms/OfficialModelSelect.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import ImageGenerationSettings, { type ImageGenerationSettingSection } from './ImageGenerationSettings.js';
import ImageGenerationDiscovery from './ImageGenerationDiscovery.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import { publicErrorReason } from '../issues/issue-catalog.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import {
  captureCreatorClientFailure,
  createCreatorArtifactObjectUrl,
  CreatorPreflightBlockedError,
  useOptionalCreatorSession
} from './creator-session-store.js';
import './image-generation-workspace.css';

type ImageResultVersion = {
  value: number;
  description: string;
  artifacts: CreatorArtifact[];
  state: Record<string, CreatorJson>;
};

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
  { value: 'codex-native', zh: '本机 Codex 生图', en: 'Local Codex image generation' },
  { value: 'openai', zh: 'GPT Image', en: 'GPT Image' },
  { value: 'jimeng', zh: '即梦', en: 'Jimeng' },
  { value: 'kling', zh: '可灵', en: 'Kling' },
  { value: 'gemini', zh: 'Gemini', en: 'Gemini' }
];
const defaultImageConfig = createDefaultCreatorServicesConfig().image;

const samplePromptZh = '一间通透的现代创意工作室，清晨自然光从落地窗照入，桌面有相机、手稿和绿植，真实摄影质感，构图干净，细节丰富';
const samplePromptEn = 'A bright modern creative studio at sunrise, natural light through floor-to-ceiling windows, a camera, sketches, and plants on the desk, realistic photography, clean composition, rich detail';
const samplePromptSv = 'En ljus modern kreativ studio i gryningen, naturligt ljus genom fönster från golv till tak, en kamera, skisser och växter på skrivbordet, realistiskt fotografi, ren komposition och rika detaljer';

export default function ImageGenerationWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  embedded?: boolean;
  embeddedTabs?: ReactNode;
  forceComposer?: boolean;
  onGenerated?(): void;
  creatorServicesService?: CreatorServicesSettingsService | null;
}) {
  const l = useLocalizedCopy();
  const requireGenerationAccess = useGenerationAccess();
  const session = useOptionalCreatorSession();
  const official = useOfficialServices('image');
  const [prompt, setPrompt] = useState(() => readString(session?.state.prompt));
  const [provider, setProvider] = useState<ImageGenerationProvider>(() => readProvider(session?.state.provider));
  const [size, setSize] = useState<ImageGenerationSize>(() => readSize(session?.state.size));
  const [quality, setQuality] = useState<ImageGenerationQuality>(() => readQuality(session?.state.quality));
  const [count, setCount] = useState(() => readCount(session?.state.candidateCount));
  const [aspectRatio, setAspectRatio] = useState(() => readString(session?.state.aspectRatio));
  const [resolution, setResolution] = useState(() => readString(session?.state.resolution));
  const [officialQuality, setOfficialQuality] = useState(() => readString(session?.state.officialQuality));
  const [modelQuality, setModelQuality] = useState(() => readString(session?.state.modelQuality));
  const [imageConfig, setImageConfig] = useState<CreatorServicesConfig['image'] | null>(null);
  const [codexImageReady, setCodexImageReady] = useState<boolean>();
  const configuredModel = provider === 'codex-native' ? '' : (imageConfig ?? defaultImageConfig)[provider].model;
  const imageOptions = useMemo(() => official.official
    ? official.model?.imageOptions ?? {}
    : provider === 'codex-native' ? undefined : imageModelOptions(provider, configuredModel),
  [official.official, official.model, provider, configuredModel]);
  const activeQuality = official.official ? officialQuality : modelQuality;
  useEffect(() => {
    if (official.official) return;
    let active = true;
    void props.creatorServicesService?.getConfig().then(response => {
      if (active) setImageConfig(response.config.image);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [props.creatorServicesService, official.official]);
  useEffect(() => {
    if (!imageOptions || official.taskRunning) return;
    const inheritedRatio = aspectRatio || imageSizeAspectRatio(size);
    const inheritedQuality = activeQuality || quality;
    const nextRatio = imageOptions.aspectRatios?.includes(inheritedRatio) ? inheritedRatio : imageOptions.aspectRatios?.[0] ?? '';
    const nextResolution = imageOptions.resolutions?.includes(resolution) ? resolution : imageOptions.resolutions?.[0] ?? '';
    const nextQuality = imageOptions.qualities?.includes(inheritedQuality) ? inheritedQuality : imageOptions.qualities?.[0] ?? '';
    const nextCount = Math.min(count, official.official ? official.model?.imageOptions?.maxImages ?? 4 : 4);
    setAspectRatio(nextRatio); setResolution(nextResolution);
    if (official.official) setOfficialQuality(nextQuality); else setModelQuality(nextQuality);
    if (nextCount !== count) setCount(nextCount);
    if (official.official && (nextRatio !== aspectRatio || nextResolution !== resolution || nextQuality !== activeQuality || nextCount !== count)) {
      session?.updateDraft({ aspectRatio: nextRatio, resolution: nextResolution, officialQuality: nextQuality, candidateCount: nextCount });
    }
  }, [imageOptions, official.taskRunning, official.official, aspectRatio, resolution, activeQuality, count, size, quality]);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState('');
  const resultVersion = session?.job.state.resultVersion;
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const characterCount = useMemo(() => [...prompt.trim()].length, [prompt]);
  const selectedSize = imageOptions ? { value: resolution, zh: aspectRatio || l('默认', 'Default'), en: aspectRatio || l('默认', 'Default'), ratio: aspectRatio || l('默认', 'Default') } : sizes.find(item => item.value === size) ?? sizes[0]!;
  const selectedQuality = imageOptions ? { zh: imageQualityLabel(activeQuality, l) || l('默认', 'Default'), en: imageQualityLabel(activeQuality, l) || l('默认', 'Default') } : qualities.find(item => item.value === quality) ?? qualities[1]!;
  const selectedProvider = official.official ? { zh: '官方服务', en: 'Official service' } : providers.find(item => item.value === provider) ?? providers[0]!;
  const resultVersions = useMemo(
    () => createImageResultVersions(session?.job.artifacts ?? [], session?.state.resultSnapshots),
    [session?.job.artifacts, session?.state.resultSnapshots]
  );
  const latestVersion = resultVersions.at(-1)?.value;
  const selectedResult = props.forceComposer
    ? undefined
    : resultVersions.find(version => version.value === resultVersion) ?? resultVersions.at(-1);
  const latestStage = session?.job.stages.filter(stage => stage.stageId === 'generate').at(-1);
  const generating = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const busy = generating || submitting;
  const runtimeError = latestStage?.status === 'failed'
    ? formatImageError({ code: latestStage.errorCode, message: latestStage.errorMessage,
        publicFacts: session?.issues.find(issue => issue.stageRunId === latestStage.id)?.publicFacts }, l)
    : session?.error === null || session?.error === undefined
      ? ''
      : formatImageError(session.error, l);
  const visibleError = error || (props.embedded ? '' : runtimeError || previewError);
  const resultSettings = selectedResult?.state;
  const resultSize = readSize(resultSettings?.size);
  const resultSizeOption = typeof resultSettings?.aspectRatio === 'string' && resultSettings.aspectRatio
    ? { value: readString(resultSettings.resolution), zh: resultSettings.aspectRatio, en: resultSettings.aspectRatio, ratio: resultSettings.aspectRatio }
    : sizes.find(item => item.value === resultSize) ?? sizes[0]!;
  const resultProvider = resultSettings?.officialModels ? { zh: '官方服务', en: 'Official service' } : providers.find(item => item.value === readProvider(resultSettings?.provider))
    ?? providers[0]!;
  const savedModelQuality = readString(resultSettings?.officialModels ? resultSettings.officialQuality : resultSettings?.modelQuality);
  const resultQuality = savedModelQuality || resultSettings?.modelQuality === ''
    ? { zh: imageQualityLabel(savedModelQuality, l) || l('默认', 'Default'), en: imageQualityLabel(savedModelQuality, l) || l('默认', 'Default') }
    : qualities.find(item => item.value === readQuality(resultSettings?.quality)) ?? qualities[1]!;
  const outputBatchSize = official.model?.catalogSchema === 2 ? official.model.imageOptions?.imagesPerRequest ?? 1 : 1;
  const supportsReferenceImage = (session === null || session.job.id.startsWith('pending:') || session.job.templateVersion >= 2)
    && (!official.official || official.model?.catalogSchema !== 2 || (official.model.capabilities.includes('edit') && (official.model.imageOptions?.maxReferences ?? 0) > 0));
  const activeReferenceArtifact = findArtifact(
    session?.job.artifacts ?? [],
    session?.state.referenceImageArtifactId,
    'reference_image'
  );
  const missingReference = (imagePromptRequiresReference(prompt) || official.model?.capabilities.includes('reference_required'))
    && referenceFile === null && activeReferenceArtifact === undefined;
  const referenceValidationMessage = missingReference ? l(
    '当前提示词需要基于已有图片生成，请先上传参考图；如需纯文字生图，请移除对上传图片或原图的要求。',
    'This prompt requires an existing image. Upload a reference, or remove the uploaded/original image requirements for text-only generation.'
  ) : '';
  const previewContext = useRef({ session, l });
  previewContext.current = { session, l };
  // Snapshots replace artifact arrays frequently; only changed file identities need a new preview.
  const resultPreviewKey = JSON.stringify({
    jobId: session?.job.id,
    artifacts: (selectedResult?.artifacts ?? []).map(artifact => [artifact.id, artifact.version, artifact.sha256, artifact.path])
  });
  const referencePreviewKey = JSON.stringify([session?.job.id, activeReferenceArtifact?.id,
    activeReferenceArtifact?.version, activeReferenceArtifact?.sha256, activeReferenceArtifact?.path]);
  const currentReferenceName = referenceFile?.name
    ?? readArtifactString(activeReferenceArtifact, 'fileName');
  useEffect(() => {
    if (supportsReferenceImage || official.taskRunning || busy) return;
    if (referenceFile !== null) setReferenceFile(null);
    if (activeReferenceArtifact !== undefined) {
      session?.updateDraft({ referenceImageArtifactId: null }, { semantic: true });
    }
  }, [supportsReferenceImage, official.taskRunning, busy, referenceFile, activeReferenceArtifact?.id, session?.updateDraft]);
  const shouldLoadDefaultProvider = session !== null
    && (
      session.state.provider === undefined
      || (
        session.state.providerSource === undefined
        && session.job.presetOrigin === null
        && session.job.stages.length === 0
        && session.job.artifacts.length === 0
      )
    );

  useEffect(() => {
    setCodexImageReady(undefined);
    if (official.official || !shouldLoadDefaultProvider || imageConfig?.provider !== 'codex-native') return;
    const service = props.creatorServicesService;
    if (!service?.getCodexImageStatus) {
      setCodexImageReady(false);
      return;
    }
    let active = true;
    void service.getCodexImageStatus().then(status => {
      if (active) setCodexImageReady(status.ready);
    }).catch(() => {
      if (active) setCodexImageReady(false);
    });
    return () => { active = false; };
  }, [imageConfig?.provider, official.official, props.creatorServicesService, shouldLoadDefaultProvider]);

  useEffect(() => {
    if (official.official) return;
    if (session === null || !shouldLoadDefaultProvider) return;
    if (!imageConfig) return;
    if (imageConfig.provider === 'codex-native' && codexImageReady === undefined) return;
    const nextProvider = imageConfig.provider === 'codex-native' && !codexImageReady
      ? 'openai'
      : imageConfig.provider;
    const nextCount = nextProvider === 'codex-native' ? 1 : count;
    setProvider(nextProvider);
    setCount(nextCount);
    session.updateDraft(
      { providerSource: 'default' },
      { persist: false }
    );
  }, [codexImageReady, count, imageConfig, session, shouldLoadDefaultProvider, official.official]);

  useEffect(() => {
    const { session, l } = previewContext.current;
    const [, artifactId] = JSON.parse(referencePreviewKey) as Array<string | number | null>;
    if (referenceFile === null) {
      if (typeof artifactId !== 'string' || session === null) {
        setReferencePreview('');
        return undefined;
      }
      let active = true;
      let objectUrl = '';
      void createCreatorArtifactObjectUrl(
        session,
        artifactId,
        'image-generation.load-reference-preview',
        l('参考图预览加载失败，请稍后重试。', 'The reference preview failed to load. Try again later.')
      )
        .then(url => {
          objectUrl = url;
          if (active) setReferencePreview(objectUrl);
          else URL.revokeObjectURL(url);
        })
        .catch(() => {
          if (active) setReferencePreview('');
        });
      return () => {
        active = false;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }
    let active = true;
    let objectUrl = '';
    void captureCreatorClientFailure(
      session,
      'image-generation.load-local-reference-preview',
      l('参考图预览加载失败，请重新选择图片。', 'The reference preview failed to load. Select the image again.'),
      () => URL.createObjectURL(referenceFile)
    ).then(url => {
      objectUrl = url;
      if (active) setReferencePreview(url);
      else URL.revokeObjectURL(url);
    }).catch(() => { if (active) setReferencePreview(''); });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [referencePreviewKey, referenceFile]);

  useEffect(() => {
    const { session, l } = previewContext.current;
    const { artifacts } = JSON.parse(resultPreviewKey) as { artifacts: Array<[string, number, string | null, string | null]> };
    if (session === null || artifacts.length === 0) {
      setImageUrls({});
      setPreviewError('');
      return undefined;
    }
    let active = true;
    const objectUrls: string[] = [];
    setImageUrls({});
    setPreviewError('');
    void Promise.all(artifacts.map(async ([artifactId]) => {
      const url = await createCreatorArtifactObjectUrl(
        session,
        artifactId,
        'image-generation.load-result-preview',
        l('图片预览加载失败，可以稍后重试或重新生成。', 'Image previews failed to load. Retry later or generate them again.')
      );
      if (active) objectUrls.push(url);
      else URL.revokeObjectURL(url);
      return [artifactId, url] as const;
    })).then(entries => {
      if (active) setImageUrls(Object.fromEntries(entries));
    }).catch(() => {
      if (active) {
        setPreviewError(l(
          '图片预览加载失败，可以稍后重试或重新生成',
          'Image previews failed to load. Retry later or generate them again.'
        ));
      }
    });
    return () => {
      active = false;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [resultPreviewKey]);

  useEffect(() => {
    if (latestVersion !== undefined && !generating) {
      setNotice(l('图片已生成，可以预览或下载', 'Images are ready to preview or download'));
    }
  }, [generating, l, latestVersion]);

  function updatePrompt(value: string) {
    setPrompt(value);
    session?.updateDraft({ prompt: value });
    setError('');
  }

  function applyTemplate(value: string, ratio: string) {
    updatePrompt(value);
    if (imageOptions?.aspectRatios?.includes(ratio)) {
      setAspectRatio(ratio);
      session?.updateDraft({ aspectRatio: ratio });
    }
    setNotice(l('已填入模版提示词，可以继续调整', 'Template prompt added. You can keep refining it.'));
    const input = document.getElementById('image-prompt-input');
    input?.focus({ preventScroll: true });
    if (input && typeof input.scrollIntoView === 'function') {
      input.scrollIntoView({
        behavior: typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'center'
      });
    }
  }

  function updateProvider(value: ImageGenerationProvider) {
    if (official.official) return;
    setProvider(value);
    const options = imageModelOptions(value, value === 'codex-native' ? '' : (imageConfig ?? defaultImageConfig)[value].model);
    const nextRatio = options.aspectRatios?.includes(aspectRatio) ? aspectRatio : options.aspectRatios?.[0] ?? '';
    const nextResolution = options.resolutions?.includes(resolution) ? resolution : options.resolutions?.[0] ?? '';
    const nextQuality = options.qualities?.includes(modelQuality) ? modelQuality : options.qualities?.includes(quality) ? quality : options.qualities?.[0] ?? '';
    setAspectRatio(nextRatio); setResolution(nextResolution); setModelQuality(nextQuality);
    const nextCount = value === 'codex-native' ? 1 : count;
    if (nextCount !== count) setCount(nextCount);
    session?.updateDraft({
      provider: value,
      providerSource: 'user',
      candidateCount: nextCount,
      aspectRatio: value === 'codex-native' ? '' : nextRatio,
      resolution: nextResolution,
      modelQuality: nextQuality
    });
    setError('');
  }

  function updateSize(value: ImageGenerationSize) {
    setSize(value);
    const nextRatio = imageSizeAspectRatio(value);
    if (imageOptions?.aspectRatios?.includes(nextRatio)) setAspectRatio(nextRatio);
    session?.updateDraft({ size: value, ...(imageOptions?.aspectRatios?.includes(nextRatio) ? { aspectRatio: nextRatio } : {}) });
    setError('');
  }

  function updateQuality(value: ImageGenerationQuality) {
    setQuality(value);
    const manualQuality = !official.official && imageOptions?.qualities?.includes(value);
    if (manualQuality) setModelQuality(value);
    session?.updateDraft({ quality: value, ...(manualQuality ? { modelQuality: value } : {}) });
    setError('');
  }

  function updateCount(value: number) {
    if (!official.official && provider === 'codex-native' && value !== 1) return;
    setCount(value);
    session?.updateDraft({ candidateCount: value });
    setError('');
  }

  function chooseReference(file: File | null) {
    if (file !== null && (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)
      || file.size === 0 || file.size > 20 * 1024 * 1024)) {
      setError(l('参考图必须是非空的 PNG、JPEG 或 WebP 图片，且不超过 20 MB。',
        'Select a non-empty PNG, JPEG, or WebP reference image no larger than 20 MB.'));
      return;
    }
    setReferenceFile(file);
    setError('');
  }

  function clearReference() {
    setReferenceFile(null);
    setReferencePreview('');
    session?.updateDraft({ referenceImageArtifactId: null }, { semantic: true });
  }

  async function generate() {
    if (busy) return;
    if (!requireGenerationAccess()) return;
    if (official.official && !official.ready) { setError(l('官方图片服务暂不可用，请在账户页面检查连接状态', 'Official image service is unavailable. Check the connection in your account.')); return; }
    if (session === null) {
      setError(l(
        '图像生成服务暂不可用，请检查 Runtime 连接',
        'Image generation is unavailable. Check the Runtime connection.'
      ));
      return;
    }
    if (!prompt.trim()) {
      setError(l('请先描述需要生成的画面', 'Describe the image you want to create'));
      return;
    }
    if (missingReference) {
      setError(referenceValidationMessage);
      return;
    }
    setError('');
    setNotice('');
    setSubmitting(true);
    session.updateDraft({
      prompt: prompt.trim(),
      provider: official.official ? 'openai' : provider,
      size,
      quality,
      candidateCount: count,
      ...(official.official ? { ...official.draftPatch, aspectRatio, resolution, officialQuality } : { aspectRatio: imageOptions ? aspectRatio : '', resolution: imageOptions ? resolution : '', modelQuality: imageOptions ? modelQuality : quality })
    }, { semantic: true });
    try {
      await session.flush();
      if (referenceFile !== null && !artifactMatchesFile(activeReferenceArtifact, referenceFile)) {
        setNotice(l('正在上传参考图...', 'Uploading the reference image...'));
        await session.uploadReferenceImage(referenceFile);
        setReferenceFile(null);
      }
      const next = await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'generate' }
      });
      const submittedStage = next.stages.filter(stage => stage.stageId === 'generate').at(-1);
      setNotice(l('生成任务已提交，完成后会自动显示结果', 'Generation started. Results will appear automatically.'));
      if (submittedStage?.status !== 'failed' && submittedStage?.status !== 'interrupted') props.onGenerated?.();
    } catch {} finally {
      setSubmitting(false);
    }
  }

  async function download(artifact: CreatorArtifact, index: number) {
    if (session === null) return;
    try {
      const existingUrl = imageUrls[artifact.id];
      let temporaryUrl: string | undefined;
      if (existingUrl === undefined) {
        temporaryUrl = await createCreatorArtifactObjectUrl(
          session,
          artifact.id,
          'image-generation.download-result',
          l('图片下载失败，请稍后重试。', 'The image download failed. Try again later.')
        );
      }
      const link = document.createElement('a');
      link.href = existingUrl ?? temporaryUrl!;
      link.download = artifactFileName(artifact, selectedResult?.value ?? 1, index + 1);
      link.click();
      if (temporaryUrl !== undefined) window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 0);
      setNotice(l(`图片 ${index + 1} 已开始下载`, `Image ${index + 1} download started`, `Nedladdning av bild ${index + 1} har startat`));
    } catch (caught) {
      session.captureCreatorFailure(
        'image-generation.download-result',
        caught,
        l('图片下载失败，请稍后重试。', 'The image download failed. Try again later.'),
        'client'
      );
    }
  }

  function selectVersion(version: number) {
    setNotice(l(`正在查看 V${version}`, `Viewing V${version}`, `Visar V${version}`));
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updatePrompt(l(samplePromptZh, samplePromptEn, samplePromptSv));
      return l('示例提示词已填入，可以继续设置画幅和质量。', 'The sample prompt is ready. Continue with format and quality.');
    }
    if (/横向|横版|landscape|3:2/i.test(command)) {
      updateSize('1536x1024');
      return l('画幅已改为横向 3:2。', 'Format changed to landscape 3:2.');
    }
    if (/竖向|竖版|portrait|2:3/i.test(command)) {
      updateSize('1024x1536');
      return l('画幅已改为竖向 2:3。', 'Format changed to portrait 2:3.');
    }
    if (/方形|square|1:1/i.test(command)) {
      updateSize('1024x1024');
      return l('画幅已改为方形 1:1。', 'Format changed to square 1:1.');
    }
    const normalized = command.toLowerCase();
    const providerMatch = providers.find(item => (
      normalized.includes(item.value)
      || command.includes(item.zh)
      || normalized.includes(item.en.toLowerCase())
    ));
    if (providerMatch) {
      updateProvider(providerMatch.value);
      return l(
        `图像服务已改为${providerMatch.zh}。`,
        `Image provider changed to ${providerMatch.en}.`
      );
    }
    if (command.trim().length > 8) {
      updatePrompt(command.trim());
      return l('画面描述已同步，可以继续设置生成参数。', 'The image description is synchronized. Continue with generation settings.');
    }
    return l('请描述画面主体、环境、风格、光线和构图。', 'Describe the subject, setting, style, lighting, and composition.');
  }

  const imageSettingSections: ImageGenerationSettingSection[] = [{
    id: 'aspect-ratio',
    label: l('图片画幅', 'Image format'),
    value: imageOptions ? aspectRatio : size,
    options: imageOptions
      ? (imageOptions.aspectRatios ?? []).map(value => ({ value, label: value }))
      : sizes.map(item => ({ value: item.value, label: item.ratio })),
    ratio: true,
    onChange: value => {
      if (imageOptions) {
        setAspectRatio(value);
        session?.updateDraft({ aspectRatio: value });
      } else updateSize(readSize(value));
    }
  }];
  if (imageOptions?.resolutions?.length) {
    imageSettingSections.push({
      id: 'resolution',
      label: l('分辨率', 'Resolution'),
      value: resolution,
      options: imageOptions.resolutions.map(value => ({ value, label: value })),
      onChange: value => {
        setResolution(value);
        session?.updateDraft({ resolution: value });
      }
    });
  }
  imageSettingSections.push({
    id: 'quality',
    label: l('图片质量', 'Image quality'),
    value: imageOptions ? activeQuality : quality,
    options: imageOptions
      ? (imageOptions.qualities ?? []).map(value => ({ value, label: imageQualityLabel(value, l) }))
      : qualities.map(item => ({ value: item.value, label: l(item.zh, item.en) })),
    onChange: value => {
      if (!imageOptions) {
        updateQuality(readQuality(value));
      } else if (official.official) {
        setOfficialQuality(value);
        session?.updateDraft({ officialQuality: value });
      } else {
        setModelQuality(value);
        session?.updateDraft({ modelQuality: value });
      }
    }
  }, {
    id: 'count',
    label: l('生成数量', 'Number of images'),
    value: String(count),
    options: (!official.official && provider === 'codex-native' ? [1] : [1, 2, 4]
      .filter(value => value <= (official.official ? official.model?.imageOptions?.maxImages ?? 4 : 4)))
      .map(value => ({
        value: String(value),
        label: `${value * outputBatchSize} ${l('张', value * outputBatchSize === 1 ? 'image' : 'images')}`
      })),
    onChange: value => updateCount(Number(value))
  });
  const imageSettingsSummary = {
    aspectRatio: selectedSize.ratio,
    count: String(count * outputBatchSize),
    resolution: imageOptions ? resolution || l('默认', 'Default') : size,
    quality: l(selectedQuality.zh, selectedQuality.en)
  };
  const promptField = <div className="creator-tool-field image-generation-prompt-field">
    <span id="image-prompt-label" className="image-generation-visually-hidden">{l('提示词', 'Prompt')}</span>
    <textarea
      id="image-prompt-input"
      rows={5}
      maxLength={creatorPromptMaxLength}
      value={prompt}
      onChange={event => updatePrompt(event.target.value)}
      aria-labelledby="image-prompt-label"
      aria-invalid={missingReference}
      aria-describedby={missingReference ? 'image-reference-validation' : undefined}
      placeholder={l('例如：一位产品设计师站在明亮的工作室中，真实摄影，柔和侧光，画面简洁', 'For example: A product designer in a bright studio, realistic photography, soft side lighting, clean composition')}
    />
    {missingReference ? <p id="image-reference-validation" className="creator-services-inline-note" role="status">{referenceValidationMessage}</p> : null}
  </div>;

  return (
    <CreatorToolShell
      title={l('图像生成', 'Image Generation')}
      subtitle={l('从文字创意生成可下载的视觉素材', 'Create downloadable visual assets from a written idea')}
      context={busy
        ? l('正在生成图片', 'Generating images')
        : selectedResult
          ? l(`V${selectedResult.value} · ${selectedResult.artifacts.length} 张图片`, `V${selectedResult.value} · ${selectedResult.artifacts.length} images`, `V${selectedResult.value} · ${selectedResult.artifacts.length} bilder`)
          : `${l(selectedProvider.zh, selectedProvider.en)} · ${selectedSize.ratio} · ${count * outputBatchSize}`}
      taskSummary={<CreatorTaskSummary
        sourceIcon={ImageIcon}
        sourceLabel={l('画面描述', 'Prompt')}
        sourceValue={(selectedResult ? readString(resultSettings?.prompt) : prompt.trim()) || l('待添加', 'Not added', 'Inte tillagt')}
        compactSummary={selectedResult
          ? `${l(resultProvider.zh, resultProvider.en)} · ${resultSizeOption.ratio} · V${selectedResult.value}`
          : `${l(selectedProvider.zh, selectedProvider.en)} · ${selectedSize.ratio} · ${l(`${count * outputBatchSize} 张`, `${count * outputBatchSize} images`, `${count * outputBatchSize} bilder`)}`}
        items={selectedResult ? [
          { label: l('图像服务', 'Provider'), value: l(resultProvider.zh, resultProvider.en) },
          { label: l('画幅', 'Format'), value: resultSettings?.aspectRatio ? resultSizeOption.ratio : `${l(resultSizeOption.zh, resultSizeOption.en)} · ${resultSizeOption.ratio}` },
          { label: l('分辨率', 'Resolution'), value: readString(resultSettings?.resolution) || (resultSettings?.aspectRatio ? l('默认', 'Default') : resultSize) },
          { label: l('质量', 'Quality'), value: l(resultQuality.zh, resultQuality.en) },
          { label: l('当前版本', 'Version'), value: `V${selectedResult.value}` }
        ] : [
          ...(currentReferenceName ? [{ label: l('参考图', 'Reference image'), value: currentReferenceName }] : []),
          { label: l('图像服务', 'Provider'), value: l(selectedProvider.zh, selectedProvider.en) },
          { label: l('画幅', 'Format'), value: imageOptions ? selectedSize.ratio : `${l(selectedSize.zh, selectedSize.en)} · ${selectedSize.ratio}` },
          { label: l('分辨率', 'Resolution'), value: imageOptions ? resolution || l('默认', 'Default') : size },
          { label: l('质量', 'Quality'), value: l(selectedQuality.zh, selectedQuality.en) },
          { label: l('生成数量', 'Images'), value: String(count) }
        ]}
      />}
      initialMessage={l('描述你想生成的画面，我会帮你整理画幅、质量和输出数量。', 'Describe the image you want, then set its format, quality, and output count.')}
      currentIssue={visibleError || undefined}
      suggestions={[l('填入示例提示词', 'Use a sample prompt'), l('生成横向图片', 'Create a landscape image')]}
      placeholder={props.promptHint ?? l('描述需要生成的图片', 'Describe the image to generate')}
      onBack={props.onBack}
      onCommand={handleCommand}
      pageClassName="image-generation-workspace-page"
      contentClassName="media-generation-workspace-content"
      embedded={props.embedded && !selectedResult}
    >
      <div className="creator-tool-stack image-generation-studio">
        <form className="image-generation-composer" aria-label={l('图像生成', 'Image Generation')} onSubmit={event => {
          event.preventDefault();
          void generate();
        }}>
          <fieldset className="image-generation-fields" disabled={busy}>
            <div className="image-generation-editor">
              <div className="image-generation-composer-heading">
                {props.embeddedTabs ?? <h2 id="image-prompt-title"><ImageIcon size={17} strokeWidth={1.7} aria-hidden="true" />{l('图像', 'Image', 'Bild')}</h2>}
                {!props.embedded ? <span>{l('文字生成图像', 'Text to image', 'Text till bild')}</span> : null}
              </div>
              {supportsReferenceImage ? (
                <div className="image-generation-reference" data-loaded={Boolean(currentReferenceName)}>
                  <label className="image-generation-reference-upload" title={currentReferenceName ? l('更换参考图', 'Replace reference') : l('添加参考图', 'Add reference image')}>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      aria-label={l('上传图像生成参考图', 'Upload an image generation reference')}
                      onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) chooseReference(file);
                        event.target.value = '';
                      }}
                    />
                    <span className="image-generation-reference-thumbnail">
                      {referencePreview ? <img src={referencePreview} alt={l('图像生成参考图', 'Image generation reference')} /> : <ImagePlus size={24} strokeWidth={1.5} />}
                    </span>
                    <span className="image-generation-reference-copy">
                      <span><strong>{currentReferenceName ?? l('参考图', 'Reference', 'Referens')}</strong>
                        {!currentReferenceName ? <small>{l('选填', 'Optional')}</small> : null}</span>
                      <small>{currentReferenceName ? l('更换参考图', 'Replace reference') : l('JPG、PNG、WebP，最大 20 MB', 'JPG, PNG, WebP, up to 20 MB', 'JPG, PNG, WebP, högst 20 MB')}</small>
                    </span>
                    <span className="image-generation-reference-count">{currentReferenceName ? 1 : 0}/1</span>
                  </label>
                  {currentReferenceName ? <button className="image-generation-reference-remove" type="button" onClick={clearReference}
                    aria-label={l('移除参考图', 'Remove reference')} title={l('移除参考图', 'Remove reference')}>
                    <X size={16} strokeWidth={1.8} />
                  </button> : null}
                </div>
              ) : null}
              {promptField}
              <div className="image-generation-prompt-tools">
                <button type="button" title={l('填入示例提示词', 'Use sample prompt')} aria-label={l('填入示例提示词', 'Use sample prompt')} onClick={() => updatePrompt(l(samplePromptZh, samplePromptEn, samplePromptSv))}>
                  <WandSparkles size={16} strokeWidth={1.8} />
                </button>
                <button type="button" disabled={!prompt} title={l('清空提示词', 'Clear prompt', 'Rensa prompt')} aria-label={l('清空提示词', 'Clear prompt', 'Rensa prompt')} onClick={() => updatePrompt('')}>
                  <Trash2 size={16} strokeWidth={1.8} />
                </button>
                <small>{characterCount} / {creatorPromptMaxLength}</small>
              </div>
            </div>
            <div className="image-generation-action-bar">
              <div className="image-generation-model-row">
                {official.official ? <OfficialModelField label={l('图片模型', 'Image model')} service={official} disabled={busy} /> : (
                  <label className="creator-tool-field image-generation-provider-picker">
                    <OfficialModelSelect
                      label={l('模型', 'Model')}
                      value={provider}
                      disabled={busy}
                      layout="catalog"
                      onChange={value => updateProvider(readProvider(value))}
                      models={providers.map(item => ({
                        id: item.value,
                        name: l(item.zh, item.en),
                        modality: 'image',
                        capabilities: []
                      }))}
                    />
                  </label>
                )}
              </div>
              <ImageGenerationSettings
                label={l('图片设置', 'Image settings', 'Bildinställningar')}
                summary={imageSettingsSummary}
                sections={imageSettingSections.filter(section => section.options.length > 0)}
                disabled={busy || official.taskRunning || (official.official && !official.ready)}
                hideHeader={props.embedded}
              />
              <div className="image-generation-submit-row">
                <button className="creator-tool-primary" type="submit" disabled={busy}>
                  {busy ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : selectedResult ? <RotateCcw size={16} /> : <Sparkles size={16} />}
                  {busy ? l('正在生成', 'Generating') : selectedResult ? l('重新生成', 'Regenerate') : l('开始生成', 'Generate')}
                </button>
              </div>
            </div>
          </fieldset>
        </form>

        {!props.embedded && (selectedResult || generating) ? (
          <section className="image-generation-output media-generation-output-panel" aria-labelledby="image-output-title">
            <div className="creator-tool-panel-heading">
              <div>
                <h2 id="image-output-title">{selectedResult ? l('生成结果', 'Generated images') : l('生成图片', 'Generate images')}</h2>
                <p>{generating ? l('任务正在后台运行，完成后会自动显示', 'The task is running in the background and will appear automatically') : l('查看历史版本并下载需要的方案', 'Review versions and download any image')}</p>
              </div>
              {selectedResult ? (
                <CreatorResultVersionMenu
                  version={selectedResult.value}
                  versions={resultVersions.map((version, index) => ({
                    value: version.value,
                    description: index === 0
                      ? l('初次生成', 'Initial generation')
                      : l(`第 ${index + 1} 次生成`, `Generation ${index + 1}`, `Generering ${index + 1}`)
                  }))}
                  onVersionChange={selectVersion}
                />
              ) : null}
            </div>
            {selectedResult ? (
              <>
                <div className="image-generation-result-grid" data-count={selectedResult.artifacts.length} data-ratio={resultSizeOption.ratio}>
                  {selectedResult.artifacts.map((artifact, index) => (
                    <article key={artifact.id}>
                      {imageUrls[artifact.id] ? (
                        <img src={imageUrls[artifact.id]} alt={`${l('生成图片', 'Generated image')} ${index + 1}`} />
                      ) : (
                        <div className="video-result-player-status" role="status">
                          <LoaderCircle className="smart-dubbing-spinner" size={18} />
                          {l('正在加载预览', 'Loading preview')}
                        </div>
                      )}
                      <footer>
                        <span>
                          <strong>{l('方案', 'Option')} {readCandidate(artifact, index + 1)}</strong>
                          <small>{formatBytes(readArtifactBytes(artifact))}</small>
                        </span>
                        <button type="button" onClick={() => void download(artifact, index)} aria-label={`${l('下载图片', 'Download image')} ${index + 1}`} title={l('下载', 'Download')}>
                          <Download size={16} strokeWidth={1.8} />
                        </button>
                      </footer>
                    </article>
                  ))}
                </div>
              </>
            ) : (
              <div className="smart-dubbing-ready">
                <span><Images size={24} strokeWidth={1.6} /></span>
                <strong>{generating ? l('正在生成图片', 'Generating images') : l('准备生成图片', 'Ready to generate images')}</strong>
                <p>{l(
                  `${l(selectedProvider.zh, selectedProvider.en)} · ${count * outputBatchSize} 张 ${selectedSize.ratio} 图片 · ${l(selectedQuality.zh, selectedQuality.en)}质量`,
                  `${selectedProvider.en} · ${count} ${selectedSize.ratio} images · ${selectedQuality.en} quality`,
                  `${l(selectedProvider.zh, selectedProvider.en)} · ${count} bilder i ${selectedSize.ratio} · ${l(selectedQuality.zh, selectedQuality.en)} kvalitet`
                )}</p>
              </div>
            )}
          </section>
        ) : null}
        {visibleError ? <p className="creator-tool-error" role="alert">{visibleError}</p> : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        {!props.embedded ? (
          <ImageGenerationDiscovery
            official={official}
            provider={provider}
            providers={providers}
            imageConfig={imageConfig}
            busy={busy}
            onProviderChange={updateProvider}
            onTemplate={applyTemplate}
          />
        ) : null}
      </div>
    </CreatorToolShell>
  );
}

function createImageResultVersions(
  artifacts: CreatorArtifact[],
  resultSnapshots: CreatorJson | undefined
): ImageResultVersion[] {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const snapshots = readCreatorResultSnapshots(resultSnapshots);
  const fromSnapshots = snapshots.flatMap(snapshot => {
    const resultArtifacts = (snapshot.artifactRefs.generated_image ?? [])
      .map(id => byId.get(id))
      .filter((artifact): artifact is CreatorArtifact => artifact !== undefined);
    return resultArtifacts.length === 0 ? [] : [{
      value: snapshot.version,
      description: snapshot.description,
      artifacts: resultArtifacts.sort(compareCandidates),
      state: snapshot.state
    }];
  });
  if (fromSnapshots.length > 0) return fromSnapshots;

  const grouped = new Map<number, CreatorArtifact[]>();
  for (const artifact of artifacts) {
    if (artifact.kind !== 'generated_image' || artifact.path === null || artifact.status === 'stale') continue;
    const version = readPositiveInteger(artifact.metadata.resultVersion) ?? artifact.version;
    grouped.set(version, [...(grouped.get(version) ?? []), artifact]);
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left - right)
    .map(([value, versionArtifacts]) => ({
      value,
      description: 'Generate',
      artifacts: versionArtifacts.sort(compareCandidates),
      state: {}
    }));
}

function compareCandidates(left: CreatorArtifact, right: CreatorArtifact) {
  return readCandidate(left, left.version) - readCandidate(right, right.version);
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function findArtifact(
  artifacts: CreatorArtifact[],
  artifactId: CreatorJson | undefined,
  kind: string
): CreatorArtifact | undefined {
  return typeof artifactId === 'string'
    ? artifacts.find(artifact => (
        artifact.id === artifactId
        && artifact.kind === kind
        && artifact.status === 'completed'
      ))
    : undefined;
}

function artifactMatchesFile(artifact: CreatorArtifact | undefined, file: File): boolean {
  return artifact !== undefined
    && artifact.metadata.fileName === file.name
    && artifact.metadata.size === file.size
    && artifact.metadata.lastModified === file.lastModified;
}

function readArtifactString(
  artifact: CreatorArtifact | undefined,
  key: string
): string | undefined {
  const value = artifact?.metadata[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function readProvider(value: CreatorJson | undefined): ImageGenerationProvider {
  return value === 'jimeng' || value === 'kling' || value === 'gemini' || value === 'codex-native'
    ? value
    : 'openai';
}

function readSize(value: CreatorJson | undefined): ImageGenerationSize {
  return value === '1536x1024' || value === '1024x1536' ? value : '1024x1024';
}

function readQuality(value: CreatorJson | undefined): ImageGenerationQuality {
  return value === 'low' || value === 'high' ? value : 'medium';
}

function imageQualityLabel(value: string, l: LocalizeCopy): string {
  switch (value.toLowerCase()) {
    case 'low': return l('快速', 'Fast');
    case 'medium':
    case 'standard': return l('标准', 'Standard');
    case 'high':
    case 'hd': return l('高清', 'High');
    case 'auto': return l('自动选择', 'Automatic', 'Automatiskt');
    case 'xhigh': return `${l('高清', 'High')}+`;
    case 'max': return l('最高', 'Maximum', 'Maximal');
    default: return value;
  }
}

function readCount(value: CreatorJson | undefined): number {
  return typeof value === 'number' && (value === 1 || value === 2 || value === 4) ? value : 2;
}

function readPositiveInteger(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function readCandidate(artifact: CreatorArtifact, fallback: number): number {
  return readPositiveInteger(artifact.metadata.candidate) ?? fallback;
}

function readArtifactBytes(artifact: CreatorArtifact): number {
  const bytes = artifact.metadata.bytes;
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function artifactFileName(artifact: CreatorArtifact, version: number, candidate: number): string {
  const fileName = artifact.metadata.fileName;
  if (typeof fileName === 'string' && fileName.trim()) return fileName;
  const extension = artifact.metadata.mimeType === 'image/jpeg'
    ? 'jpg'
    : artifact.metadata.mimeType === 'image/webp'
      ? 'webp'
      : 'png';
  return `OpenCreator-image-V${version}-${candidate}.${extension}`;
}

function formatBytes(size: number) {
  if (size <= 0) return '';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatImageError(error: unknown, l: (zh: string, en: string) => string) {
  if (error instanceof CreatorPreflightBlockedError) {
    const message = error.result.blocked.map(item => item.message).filter(Boolean).join('；');
    return message || l('启动前检查未通过，请检查任务配置', 'Preflight checks failed. Review the task settings.');
  }
  const candidate = error as { code?: unknown; message?: unknown; publicFacts?: PublicErrorFacts; issue?: { publicFacts?: PublicErrorFacts } };
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const facts = candidate?.issue?.publicFacts ?? candidate?.publicFacts;
  if (facts !== undefined && (facts.kind !== 'unknown' || facts.upstreamMessage !== undefined)) {
    return publicErrorReason(facts, l);
  }
  const message = safePublicErrorMessage(candidate?.message);
  if (message && (code === 'image_generation_failed' || code === 'creator_stage_input_missing'
    || code === 'unsupported_capability' || code === 'creator_image_config_missing')) return message;
  if (code === 'creator_image_config_missing') {
    return l('请先在设置的 AI 服务中配置所选图像服务', 'Configure the selected image provider in AI Services first');
  }
  if (code === 'image_generation_failed') {
    return l('图像生成请求失败，请检查服务配置和网络后重试', 'Image generation failed. Check the service configuration and network, then retry.');
  }
  if (code === 'creator_stage_canceled') {
    return l('图像生成任务已取消', 'Image generation was canceled');
  }
  return l('图片生成未完成，请检查图像服务配置后重试', 'Image generation did not complete. Check the image provider settings, then retry.');
}
