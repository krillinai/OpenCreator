import { gatewayModelDisplayName, gatewayModelIdMatches, gatewayModelReady } from '@opencreator/protocol';
import {
  creatorPromptMaxLength,
  defaultVideoGenerationModels,
  gatewayVideoSizes,
  isPublicErrorFacts,
  readCreatorResultSnapshots,
  type CreatorArtifact,
  type CreatorJson,
  type CreatorServicesConfig,
  type CreatorServicesCredentialField,
  type CreatorStageRun,
  type GatewayAccountState,
  type GatewayModel,
  type GatewayVideoCatalog,
  type VideoGenerationDuration,
  type VideoGenerationProvider,
  type VideoGenerationSize
} from '@opencreator/protocol';
import { useGenerationAccess } from './DashboardGenerationAccess.js';
import {
  Clapperboard,
  Download,
  ImagePlus,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Trash2,
  WandSparkles,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { publicErrorReason } from '../issues/issue-catalog.js';
import OfficialModelSelect from '../../components/forms/OfficialModelSelect.js';
import { useOfficialServices } from './official-services.js';
import { readVideoReferences, videoReferenceIssue } from './OfficialVideoReferences.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import type { GatewayAccountSettingsService } from '../../services/gateway-account-service.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import ImageGenerationSettings, { type ImageGenerationSettingSection } from './ImageGenerationSettings.js';
import { CreatorTaskProgressNotice } from './CreatorCollaborationPanel.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import {
  captureCreatorClientFailure,
  createCreatorArtifactObjectUrl,
  useOptionalCreatorSession
} from './creator-session-store.js';
import './video-generation-workspace.css';

type VideoResultVersion = {
  value: number;
  description: string;
  artifact: CreatorArtifact;
  state: Record<string, CreatorJson>;
};
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
const localVideoModelId = '__local_video__';

const providerDurations: Record<VideoGenerationProvider, VideoGenerationDuration[]> = {
  seedance: [5, 10],
  kling: [5, 10],
  veo: [4, 6, 8]
};
const modelLabels: Record<string, string> = {
  'doubao-seedance-2-5-260628': 'Seedance 2.5',
  'doubao-seedance-2-0-260128': 'Seedance 2.0',
  'doubao-seedance-2-0-fast-260128': 'Seedance 2.0 Fast',
  'doubao-seedance-2-0-mini-260615': 'Seedance 2.0 Mini',
  'doubao-seedance-1-5-pro-251215': 'Seedance 1.5 Pro',
  'doubao-seedance-1-0-pro-fast-251015': 'Seedance 1.0 Pro Fast',
  'doubao-seedance-1-0-pro-250528': 'Seedance 1.0 Pro',
  'kling-v2-1-master': 'Kling 2.1 Master',
  'veo-3.1-generate-preview': 'Veo 3.1'
};

const samplePromptZh = '一辆复古红色跑车沿着海岸公路行驶，黄昏金色阳光，低机位跟拍，海风吹动路边植物，电影级真实质感，镜头运动平稳';
const samplePromptEn = 'A vintage red sports car driving along a coastal road at golden hour, low-angle tracking shot, sea breeze moving roadside plants, cinematic realism, smooth camera motion';
const samplePromptSv = 'En röd veteranbil kör längs en kustväg i gyllene kvällsljus, låg följande kamera, havsbrisen rör växterna längs vägen, filmisk realism och mjuka kamerarörelser';
const referenceImageTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
const maxReferenceImageBytes = 5 * 1024 * 1024;

export default function VideoGenerationWorkspace(props: {
  onBack(): void;
  promptHint?: string;
  embedded?: boolean;
  embeddedTabs?: ReactNode;
  forceComposer?: boolean;
  onGenerated?(): void;
  creatorServicesService?: CreatorServicesSettingsService | null;
  gatewayAccountService?: GatewayAccountSettingsService | null;
  onGatewayStateChange?(state: GatewayAccountState): void;
}) {
  const l = useLocalizedCopy();
  const requireGenerationAccess = useGenerationAccess();
  const session = useOptionalCreatorSession();
  const official = useOfficialServices('video', true, models => session?.job.stages.length === 0 && session.job.artifacts.length === 0
    ? preferredSeedanceVideoModel(models) : undefined);
  const mediaPreviewContextRef = useRef({ session, localize: l });
  mediaPreviewContextRef.current = { session, localize: l };
  const mediaPreviewJobId = session?.job.id;
  const canOpenMediaPreview = session?.openArtifact !== undefined;
  const [prompt, setPrompt] = useState(() => readString(session?.state.prompt));
  const [referenceImageFile, setReferenceImageFile] = useState<File>();
  const [referenceImageUrl, setReferenceImageUrl] = useState('');
  const initialProvider = readProvider(session?.state.provider);
  const settingsRevision = useRef(0);
  const [modelDefaults, setModelDefaults] = useState<Record<VideoGenerationProvider, string>>(
    () => ({ ...defaultVideoGenerationModels })
  );
  const [videoConfig, setVideoConfig] = useState<CreatorServicesConfig['video'] | null>(null);
  const [configuredCredentials, setConfiguredCredentials] = useState<CreatorServicesCredentialField[]>([]);
  const [publicCatalog, setPublicCatalog] = useState<GatewayVideoCatalog | undefined>(() => props.gatewayAccountService?.getCachedVideoCatalog?.());
  const [catalogState, setCatalogState] = useState<'loading' | 'ready' | 'error'>(() => props.gatewayAccountService?.getCachedVideoCatalog?.() ? 'ready' : 'loading');
  const catalogRequest = useRef(0);
  const catalogWork = useRef<{ service: GatewayAccountSettingsService; promise: Promise<GatewayVideoCatalog> }>();
  const [pendingModelId, setPendingModelId] = useState<string | undefined>(() => readOptionalModel(session?.state.pendingVideoModelId));
  const pendingValidation = useRef<string>();
  const [provider, setProvider] = useState<VideoGenerationProvider>(() => (
    initialProvider
  ));
  const [selectedSource, setSelectedSource] = useState<'manual' | 'gateway'>(() => (
    session?.state.videoServiceSource === 'manual' || session?.state.videoServiceSource === 'gateway'
      ? session.state.videoServiceSource
      : session?.state.officialModels || official.hasRememberedModel
        || (official.ready && official.model?.id === preferredSeedanceVideoModel(official.models)?.id)
        ? 'gateway' : 'manual'
  ));
  const usingOfficial = selectedSource === 'gateway';
  const shouldDefaultOfficial = session?.job.stages.length === 0 && session.job.artifacts.length === 0
    && !session.state.videoServiceSource && !session.state.pendingVideoModelId && official.ready
    && (official.hasRememberedModel || official.model?.id === preferredSeedanceVideoModel(official.models)?.id);
  useEffect(() => {
    if (shouldDefaultOfficial && selectedSource === 'manual') {
      setSelectedSource('gateway');
      session?.updateDraft({ videoServiceSource: 'gateway' }, {
        persist: session.job.id.startsWith('pending:') ? false : undefined,
        userEdited: false
      });
    }
  }, [shouldDefaultOfficial, selectedSource, session?.job.id]);
  const [model, setModel] = useState(() => readModel(session?.state.model, initialProvider));
  const [size, setSize] = useState<VideoGenerationSize>(() => readSize(session?.state.size, usingOfficial));
  const [duration, setDuration] = useState<VideoGenerationDuration>(() => (
    readDuration(session?.state.duration, readProvider(session?.state.provider), usingOfficial)
  ));
  const resultVersion = session?.job.state.resultVersion;
  const [videoUrl, setVideoUrl] = useState('');
  const [previewFailed, setPreviewFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const videoReferences = readVideoReferences(session?.state.videoReferences);
  const [taskControlPending, setTaskControlPending] = useState<'canceling' | 'resuming'>();
  const characterCount = useMemo(() => [...prompt.trim()].length, [prompt]);
  const selectedProvider = usingOfficial ? { zh: '官方服务', en: 'Official service' } : { zh: '本地视频服务', en: 'Local video service' };
  const localConfigured = videoConfig !== null && localVideoProviderReady(videoConfig, configuredCredentials, provider);
  const localModel: GatewayModel | undefined = videoConfig ? {
    id: localVideoModelId, name: l('本地视频服务', 'Local video service', 'Lokal videotjänst'),
    vendor: l('本地', 'Local', 'Lokal'), modality: 'video', capabilities: [],
    status: localConfigured ? 'ready' : 'temporarily_unavailable', durations: providerDurations[provider]
  } : undefined;
  const publicModels = publicCatalog?.models ?? [];
  const catalogModels = [...(localModel ? [localModel] : []), ...(official.official ? official.models : publicModels)];
  const loginRequiredModelIds = new Set(official.official ? [] : publicModels.map(item => item.id));
  const selectedCatalogId = usingOfficial ? official.selected ?? official.model?.id ?? '' : pendingModelId ?? (localConfigured ? localVideoModelId : '');
  function loadPublicCatalog(force = false) {
    const request = ++catalogRequest.current;
    const service = props.gatewayAccountService;
    if (!service?.getVideoCatalog) { setCatalogState('error'); return; }
    const cached = service.getCachedVideoCatalog?.();
    if (cached) { setPublicCatalog(cached); setCatalogState('ready'); }
    else setCatalogState('loading');
    const promise = !force && catalogWork.current?.service === service
      ? catalogWork.current.promise : service.getVideoCatalog({ refresh: force });
    catalogWork.current = { service, promise };
    void promise.then(catalog => {
      if (request === catalogRequest.current) { setPublicCatalog(catalog); setCatalogState('ready'); }
    }).catch(() => {
      if (request === catalogRequest.current) setCatalogState(cached ? 'ready' : 'error');
    }).finally(() => {
      if (catalogWork.current?.promise === promise) catalogWork.current = undefined;
    });
  }
  useEffect(() => {
    if (!official.official) loadPublicCatalog();
    return () => { catalogRequest.current++; };
  }, [props.gatewayAccountService, official.official]);
  const activeModel = usingOfficial ? official.model?.id ?? '' : model;
  const selectedModelLabel = usingOfficial && official.model ? gatewayModelDisplayName(official.model, l('官方模型', 'Official model')) : videoModelLabel(activeModel);
  const availableSizes = usingOfficial ? gatewayVideoSizes(official.model).map(videoSizeOption) : sizes;
  const selectedSize = availableSizes.find(item => item.value === size) ?? videoSizeOption(size);
  const availableRatios = [...new Set(availableSizes.map(item => item.ratio))];
  const resolutionSizes = availableSizes.filter(item => item.ratio === selectedSize.ratio);
  const referenceDuration = official.model?.videoOptions?.referenceDuration;
  const hasReferenceImage = !!referenceImageFile || (session?.job.artifacts ?? []).some(artifact => artifact.id === session?.state.referenceImageArtifactId && artifact.kind === 'reference_image') || videoReferences.some(ref => ref.role === 'image');
  const referenceSupported = !usingOfficial || official.model?.capabilities.includes('image_to_video') === true;
  const durations = usingOfficial ? (official.model?.durations ?? []).filter(value => !referenceDuration || !hasReferenceImage || value === referenceDuration) : providerDurations[provider];
  const serviceReady = (usingOfficial
    ? official.ready && availableSizes.length > 0 && durations.length > 0 : localConfigured);
  const resultVersions = useMemo(
    () => createVideoResultVersions(session?.job.artifacts ?? [], session?.state.resultSnapshots),
    [session?.job.artifacts, session?.state.resultSnapshots]
  );
  const latestVersion = resultVersions.at(-1)?.value;
  const selectedResult = props.forceComposer
    ? undefined
    : resultVersions.find(version => version.value === resultVersion) ?? resultVersions.at(-1);
  const selectedResultArtifactId = selectedResult?.artifact.id;
  const latestStage = session?.job.stages.filter(stage => stage.stageId === 'generate').at(-1);
  const latestStageIssue = session?.job.issues?.find(issue => (
    issue.stageRunId === latestStage?.id && issue.status !== 'resolved'
  ));
  const generating = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const busy = generating || submitting;
  const resumable = latestStage?.status === 'canceled'
    || latestStage?.status === 'interrupted'
    || isRecoverableVideoStage(latestStage);
  const runtimeError = latestStage?.status === 'failed'
    ? formatVideoError(
        { code: latestStage.errorCode, message: latestStage.errorMessage, publicFacts: latestStageIssue?.publicFacts },
        l,
        selectedModelLabel,
        provider
      )
    : session?.error === null || session?.error === undefined
      ? ''
      : formatVideoError(session.error, l, selectedModelLabel, provider);
  const previewError = previewFailed ? l(
    '视频预览加载失败，可以稍后重试或直接下载',
    'The video preview failed to load. Retry later or download the file.'
  ) : '';
  const visibleError = error || runtimeError || previewError;
  useEffect(() => {
    if (latestStage?.status === 'failed' || latestStage?.status === 'interrupted') setNotice('');
  }, [latestStage?.id, latestStage?.status]);
  const settingsDeepLink = readNeedsInputDeepLink(session?.state.needsInput);
  const activeReferenceArtifact = findArtifact(
    session?.job.artifacts ?? [],
    session?.state.referenceImageArtifactId,
    'reference_image'
  );
  const savedVideoImage = referenceImageFile || activeReferenceArtifact
    ? undefined : videoReferences.find(ref => ref.role === 'image');
  const selectedVideoReferences = savedVideoImage ? [savedVideoImage] : [];
  const currentReferenceName = referenceImageFile?.name
    ?? readArtifactString(activeReferenceArtifact, 'fileName')
    ?? savedVideoImage?.fileName;
  const referencePreviewArtifactId = referenceImageFile === undefined
    ? activeReferenceArtifact?.id
    : undefined;
  const followsReferenceRatio = !usingOfficial && provider === 'seedance' && Boolean(currentReferenceName);
  const resultSettings = selectedResult?.state;
  const resultOfficial = resultSettings?.videoServiceSource === 'gateway' || (!resultSettings?.videoServiceSource && !!resultSettings?.officialModels);
  const resultProvider = resultOfficial ? { value: 'seedance' as const, zh: '官方服务', en: 'Official service' } : providers.find(item => (
    item.value === readProvider(resultSettings?.provider)
  )) ?? providers[0]!;
  const resultSize = readSize(resultSettings?.size, resultOfficial);
  const resultSizeOption = videoSizeOption(resultSize);
  const resultWidth = readArtifactNumber(selectedResult?.artifact, 'width');
  const resultHeight = readArtifactNumber(selectedResult?.artifact, 'height');
  const resultRatio = resultWidth !== undefined && resultHeight !== undefined
    ? formatAspectRatio(resultWidth, resultHeight)
    : resultSizeOption.ratio;
  const resultResolution = resultWidth !== undefined && resultHeight !== undefined
    ? `${resultWidth}x${resultHeight}`
    : videoSizeDisplay(resultSize);
  const resultFormatLabel = resultWidth !== undefined && resultHeight !== undefined
    ? videoFormatLabel(resultWidth, resultHeight, l)
    : l(resultSizeOption.zh, resultSizeOption.en);
  const resultArtifactDuration = readVideoDuration(selectedResult?.artifact.metadata.duration);
  const resultDuration = resultArtifactDuration === undefined
    ? readDuration(resultSettings?.duration, resultProvider.value, resultOfficial)
    : Math.round(resultArtifactDuration * 100) / 100;
  const resultModel = readArtifactString(selectedResult?.artifact, 'model')
    ?? readOptionalModel(resultSettings?.model)
    ?? modelDefaults[resultProvider.value];
  const resultModelLabel = gatewayModelDisplayName(official.models.find(candidate => gatewayModelIdMatches(candidate.id, resultModel)) ?? { id: resultModel, name: modelLabels[resultModel] }, l('官方模型', 'Official model'));
  const shouldLoadDefaultProvider = session !== null && (
    session.state.provider === undefined || (
      session.state.providerSource === undefined
      && session.job.presetOrigin === null
      && session.job.stages.length === 0
      && session.job.artifacts.length === 0
    )
  );

  useEffect(() => {
    if (props.creatorServicesService === null || props.creatorServicesService === undefined) {
      return undefined;
    }
    let active = true;
    const revision = settingsRevision.current;
    void (props.creatorServicesService.getLocalVideoConfig?.() ?? props.creatorServicesService.getConfig())
      .then(response => {
        if (!active) return;
        const defaults = videoModelDefaults(response.config);
        setVideoConfig(response.config.video);
        setConfiguredCredentials(response.configuredCredentials ?? []);
        setModelDefaults(defaults);
        if (settingsRevision.current !== revision) return;
        const savedProvider = shouldLoadDefaultProvider ? undefined : readOptionalProvider(session?.state.provider);
        const candidates = [savedProvider, response.config.video.provider, ...providers.map(item => item.value)];
        const nextProvider = candidates.find(candidate => candidate && localVideoProviderReady(response.config.video, response.configuredCredentials ?? [], candidate))
          ?? savedProvider ?? response.config.video.provider;
        const nextModel = (shouldLoadDefaultProvider ? undefined : readOptionalModel(session?.state.model)) ?? defaults[nextProvider];
        const nextDuration = readDuration(session?.state.duration, nextProvider);
        setProvider(nextProvider);
        setModel(nextModel);
        setDuration(nextDuration);
      })
      .catch(cause => {
        if (!active) return;
        session?.captureCreatorFailure(
          'video-generation.load-service-config',
          cause,
          l('无法读取视频生成服务配置，请稍后重试。', 'Could not load video generation settings. Try again later.'),
          'client'
        );
      });
    return () => {
      active = false;
    };
  }, [props.creatorServicesService, session?.job.id]);

  useEffect(() => {
    if (!pendingModelId || official.authState !== 'signed_in' || official.activationState !== 'ready'
      || pendingValidation.current === pendingModelId || !props.gatewayAccountService) return;
    pendingValidation.current = pendingModelId;
    let active = true;
    void props.gatewayAccountService.getState({ refreshModels: true }).then(state => {
      if (!active) return;
      props.onGatewayStateChange?.(state);
      const ready = state.models.filter(item => item.modality === 'video' && gatewayModelReady(item));
      const requested = ready.find(item => gatewayModelIdMatches(item.id, pendingModelId));
      const recommended = ready.find(item => gatewayModelIdMatches(item.id, state.recommendedModels?.video))
        ?? ready.find(item => item.recommended);
      const chosen = requested ?? recommended ?? ready[0];
      if (chosen) {
        setSelectedSource('gateway');
        session?.updateDraft({ videoServiceSource: 'gateway', pendingVideoModelId: null, officialModels: { video: chosen.id } });
      }
      if (!requested) setNotice(chosen
        ? recommended
          ? l('所选模型当前账户不可用，已切换为推荐视频模型。', 'That model is unavailable for this account. A recommended video model is selected.', 'Modellen är inte tillgänglig för kontot. En rekommenderad videomodell har valts.')
          : l('所选模型当前账户不可用，已切换为可用视频模型。', 'That model is unavailable for this account. An available video model is selected.', 'Modellen är inte tillgänglig för kontot. En tillgänglig videomodell har valts.')
        : l('当前账户暂无可用的视频模型。', 'No video model is available for this account.', 'Inga videomodeller är tillgängliga för kontot.'));
      if (!chosen) session?.updateDraft({ pendingVideoModelId: null });
      setPendingModelId(undefined);
    }).catch(() => {
      if (active) { session?.updateDraft({ pendingVideoModelId: null }); setPendingModelId(undefined); setNotice(l('账户模型目录刷新失败，请重新选择模型。', 'Could not refresh your account models. Select a model again.', 'Kunde inte uppdatera kontots modeller. Välj en modell igen.')); }
    });
    return () => { active = false; };
  }, [pendingModelId, official.authState, official.activationState, props.gatewayAccountService, props.onGatewayStateChange, session?.job.id]);

  useEffect(() => {
    if (availableSizes.length && !availableSizes.some(item => item.value === size)) setSize(availableSizes[0]!.value);
    if (durations.length && !durations.includes(duration)) setDuration(durations[0]!);
  }, [usingOfficial, activeModel, size, duration, availableSizes.map(item => item.value).join(','), durations.join(',')]);

  useEffect(() => {
    const { session, localize } = mediaPreviewContextRef.current;
    if (referenceImageFile === undefined && (
      referencePreviewArtifactId === undefined || session === null || !canOpenMediaPreview
    )) {
      setReferenceImageUrl('');
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    setReferenceImageUrl('');
    const preview = referenceImageFile !== undefined
      ? captureCreatorClientFailure(
          session,
          'video-generation.load-local-reference-preview',
          localize('参考图预览加载失败，请重新选择图片。', 'The reference preview failed to load. Select the image again.'),
          () => URL.createObjectURL(referenceImageFile)
        )
      : createCreatorArtifactObjectUrl(
          session!,
          referencePreviewArtifactId!,
          'video-generation.load-reference-preview',
          localize('参考图预览加载失败，请稍后重试。', 'The reference preview failed to load. Try again later.')
        );
    void preview
      .then(url => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setReferenceImageUrl(objectUrl);
      })
      .catch(() => {
        if (active) setReferenceImageUrl('');
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [canOpenMediaPreview, mediaPreviewJobId, referenceImageFile, referencePreviewArtifactId]);

  useEffect(() => {
    const { session, localize } = mediaPreviewContextRef.current;
    if (selectedResultArtifactId === undefined || session === null || !canOpenMediaPreview) {
      setVideoUrl('');
      setPreviewFailed(false);
      return undefined;
    }
    let active = true;
    let objectUrl = '';
    setVideoUrl('');
    setPreviewFailed(false);
    void createCreatorArtifactObjectUrl(
      session,
      selectedResultArtifactId,
      'video-generation.load-result-preview',
      localize('视频预览加载失败，可以稍后重试或直接下载。', 'The video preview failed to load. Retry later or download the file.')
    )
      .then(url => {
        if (!active) {
          URL.revokeObjectURL(url);
          return;
        }
        objectUrl = url;
        setVideoUrl(objectUrl);
      })
      .catch(() => {
        if (active) setPreviewFailed(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [canOpenMediaPreview, mediaPreviewJobId, selectedResultArtifactId]);

  useEffect(() => {
    if (latestVersion !== undefined && !generating) {
      setNotice(l('视频已生成，可以预览或下载', 'The video is ready to preview or download'));
    }
  }, [generating, l, latestVersion]);

  function updatePrompt(value: string) {
    setPrompt(value);
    session?.updateDraft({ prompt: value });
    setError('');
  }

  function updateProvider(nextProvider: VideoGenerationProvider) {
    if (usingOfficial) return;
    settingsRevision.current += 1;
    const nextDurations = providerDurations[nextProvider];
    const nextDuration = nextDurations.includes(duration) ? duration : nextDurations[0]!;
    const nextModel = modelDefaults[nextProvider] || defaultVideoGenerationModels[nextProvider];
    setProvider(nextProvider);
    setModel(nextModel);
    setDuration(nextDuration);
    session?.updateDraft({
      provider: nextProvider,
      model: nextModel,
      duration: nextDuration
    });
    setError('');
  }

  function selectCatalogModel(id: string) {
    if (id === localVideoModelId) {
      setPendingModelId(undefined);
      pendingValidation.current = undefined;
      setSelectedSource('manual');
      session?.updateDraft({ videoServiceSource: 'manual', pendingVideoModelId: null }, { semantic: true });
      return;
    }
    if (official.official) {
      official.selectModel(id);
      setSelectedSource('gateway');
      session?.updateDraft({ videoServiceSource: 'gateway' }, { semantic: true });
      return;
    }
    if (!publicModels.some(item => gatewayModelIdMatches(item.id, id) && gatewayModelReady(item))) return;
    setPendingModelId(id);
    pendingValidation.current = undefined;
    session?.updateDraft({ pendingVideoModelId: id }, { semantic: true });
    requireGenerationAccess();
  }

  function updateSize(nextSize: VideoGenerationSize) {
    setSize(nextSize);
    session?.updateDraft({ size: nextSize });
    setError('');
  }

  function updateDuration(nextDuration: VideoGenerationDuration) {
    settingsRevision.current += 1;
    setDuration(nextDuration);
    session?.updateDraft({ duration: nextDuration });
    setError('');
  }

  function updateReferenceImage(file: File | null) {
    if (!file) return;
    if (
      !(referenceImageTypes as readonly string[]).includes(file.type)
      || file.size > maxReferenceImageBytes
    ) {
      setError(l(
        '请上传 5MB 以内的 JPG、PNG 或 WebP 图片',
        'Upload a JPG, PNG, or WebP image up to 5 MB'
      ));
      return;
    }
    setReferenceImageFile(file);
    setError('');
    setNotice(l('参考图已添加，将在生成时上传', 'Reference image added and will be uploaded when generation starts'));
  }

  function removeReferenceImage() {
    setReferenceImageFile(undefined);
    setReferenceImageUrl('');
    session?.updateDraft({ referenceImageArtifactId: null, videoReferences: [] }, { semantic: true });
    setError('');
    setNotice(l('参考图已移除', 'Reference image removed'));
  }

  async function generate() {
    if (busy || resumable) return;
    if (!requireGenerationAccess(!usingOfficial && !pendingModelId)) return;
    if (usingOfficial && official.ready && (!availableSizes.length || !durations.length)) {
      setError(l('当前模型缺少画幅或时长配置，请更换模型', 'The selected model has no available format or duration. Select another model.'));
      return;
    }
    if (usingOfficial && !serviceReady) { setError(l('官方视频服务暂不可用，请在账户页面检查连接状态', 'Official video service is unavailable. Check the connection in your account.')); return; }
    if (session === null) {
      setError(l(
        '视频生成服务暂不可用，请检查 Runtime 连接',
        'Video generation is unavailable. Check the Runtime connection.'
      ));
      return;
    }
    if (!prompt.trim()) {
      setError(l('请先描述需要生成的视频', 'Describe the video you want to create'));
      return;
    }
    if (!usingOfficial && !localConfigured) {
      setError(l('请先在设置中配置可用的本地视频服务。', 'Configure a ready local video service in Settings first.', 'Konfigurera en tillgänglig lokal videotjänst i inställningarna först.'));
      return;
    }
    if (!usingOfficial && savedVideoImage) {
      setError(l('请重新上传参考图后使用本地视频服务', 'Upload the reference image again to use a local video service'));
      return;
    }
    if (usingOfficial && hasReferenceImage && !referenceSupported) {
      setError(l('当前模型不支持参考图', 'The selected model does not support reference images'));
      return;
    }
    const referenceIssue = usingOfficial
      ? videoReferenceIssue(official.model, selectedVideoReferences, !!(referenceImageFile || activeReferenceArtifact))
      : undefined;
    if (referenceIssue) {
      setError(referenceIssue === 'frames' ? l('请先添加首帧', 'Add a first frame before a last frame') : referenceIssue === 'mixed' ? l('首尾帧不能与参考素材同时使用', 'First and last frames cannot be combined with reference media') : referenceIssue === 'audio' ? l('参考音频需要搭配参考图片', 'Reference audio requires reference images') : l('参考素材超出当前模型支持范围，请移除多余素材', 'Reference media exceeds the selected model limits. Remove unsupported references.'));
      return;
    }
    setError('');
    setNotice('');
    setSubmitting(true);
    session.updateDraft({
      prompt: prompt.trim(),
      videoServiceSource: selectedSource,
      provider: usingOfficial ? 'seedance' : provider,
      model: activeModel,
      size,
      duration,
      videoReferences: usingOfficial ? selectedVideoReferences : [],
      ...(usingOfficial ? { videoPriceVersion: official.model?.price?.version ?? null, generateAudio: official.model?.videoOptions?.generateAudio ? session.state.generateAudio ?? true : null } : {}),
      ...(usingOfficial ? official.draftPatch : {})
    }, { semantic: true });
    try {
      await session.flush();
      if (
        referenceImageFile !== undefined
        && !artifactMatchesFile(activeReferenceArtifact, referenceImageFile)
      ) {
        setNotice(l('正在上传参考图...', 'Uploading the reference image...'));
        await session.uploadReferenceImage(referenceImageFile);
        setReferenceImageFile(undefined);
      }
      const next = await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'generate' }
      });
      const submittedStage = next.stages.filter(stage => stage.stageId === 'generate').at(-1);
      setNotice(submittedStage?.status === 'failed' || submittedStage?.status === 'interrupted' ? '' : l(
        '视频生成任务已提交，可以离开当前页面，完成后会保留在项目中',
        'Video generation started. You can leave this page and return to the saved result later.'
      ));
      if (submittedStage?.status !== 'failed' && submittedStage?.status !== 'interrupted') props.onGenerated?.();
    } catch {} finally {
      setSubmitting(false);
    }
  }

  async function download() {
    if (selectedResult === undefined || session === null) return;
    try {
      let temporaryUrl: string | undefined;
      if (!videoUrl) {
        temporaryUrl = await createCreatorArtifactObjectUrl(
          session,
          selectedResult.artifact.id,
          'video-generation.download-result',
          l('视频下载失败，请稍后重试。', 'The video download failed. Try again later.')
        );
      }
      const link = document.createElement('a');
      link.href = videoUrl || temporaryUrl!;
      link.download = artifactFileName(selectedResult.artifact, selectedResult.value);
      link.click();
      if (temporaryUrl !== undefined) {
        window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 0);
      }
      setNotice(l('视频已开始下载', 'Video download started'));
    } catch (caught) {
      session.captureCreatorFailure(
        'video-generation.download-result',
        caught,
        l('视频下载失败，请稍后重试。', 'The video download failed. Try again later.'),
        'client'
      );
    }
  }

  async function cancelTask() {
    if (session === null || !generating || taskControlPending !== undefined) return;
    setTaskControlPending('canceling');
    setError('');
    try {
      await session.cancelJob();
      setNotice(l('已停止跟踪当前视频生成任务', 'Stopped tracking the current video generation task'));
    } catch {} finally {
      setTaskControlPending(undefined);
    }
  }

  async function resumeTask() {
    if (session === null || !resumable || taskControlPending !== undefined) return;
    setTaskControlPending('resuming');
    setError('');
    try {
      if (isRecoverableVideoStage(latestStage)) {
        await session.applyAction({
          actor: 'user',
          action: 'run-stage',
          input: { stageId: 'generate' }
        });
      } else {
        await session.resumeJob();
      }
      setNotice(l('正在继续查询原视频生成任务', 'Resuming the existing video generation task'));
    } catch {} finally {
      setTaskControlPending(undefined);
    }
  }

  function selectVersion(version: number) {
    setNotice(l(`正在查看 V${version}`, `Viewing V${version}`, `Visar V${version}`));
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updatePrompt(l(samplePromptZh, samplePromptEn, samplePromptSv));
      return l('示例提示词已填入，可以继续设置画幅和时长。', 'The sample prompt is ready. Continue with format and duration.');
    }
    if (/横屏|横版|landscape|16:9/i.test(command)) {
      updateSize('1280x720');
      return l('视频画幅已改为横屏 16:9。', 'Video format changed to landscape 16:9.');
    }
    if (/竖屏|竖版|portrait|9:16/i.test(command)) {
      updateSize('720x1280');
      return l('视频画幅已改为竖屏 9:16。', 'Video format changed to portrait 9:16.');
    }
    if (command.trim().length > 8) {
      updatePrompt(command.trim());
      return l('视频描述已同步，可以继续设置生成参数。', 'The video description is synchronized. Continue with generation settings.');
    }
    return l('请描述主体动作、场景、镜头运动、光线和视觉风格。', 'Describe the action, scene, camera movement, lighting, and visual style.');
  }

  const videoSettingSections: ImageGenerationSettingSection[] = [{
    id: 'format',
    label: l('画幅', 'Format'),
    value: selectedSize.ratio,
    options: availableRatios.map(ratio => ({ value: ratio, label: ratio })),
    ratio: true,
    disabled: followsReferenceRatio,
    onChange: ratio => {
      const sameResolution = availableSizes.find(item => item.ratio === ratio && videoResolutionLabel(item.value) === videoResolutionLabel(size));
      const next = sameResolution ?? availableSizes.find(item => item.ratio === ratio);
      if (next) updateSize(next.value);
    }
  }, {
    id: 'resolution',
    label: l('清晰度', 'Resolution'),
    value: size,
    options: resolutionSizes.map(item => ({ value: item.value, label: videoResolutionLabel(item.value) })),
    disabled: followsReferenceRatio,
    onChange: value => updateSize(value as VideoGenerationSize)
  }, {
    id: 'duration',
    label: l('视频时长', 'Video duration'),
    value: String(duration),
    options: durations.map(value => ({ value: String(value), label: l(`${value} 秒`, `${value}s`, `${value} sekunder`) })),
    slider: true,
    onChange: value => updateDuration(Number(value) as VideoGenerationDuration)
  }];
  const videoSettingsSummary = {
    aspectRatio: followsReferenceRatio ? l('原图', 'Source') : selectedSize.ratio,
    count: l(`${duration} 秒`, `${duration}s`, `${duration} sekunder`),
    resolution: followsReferenceRatio ? l('原图', 'Source') : videoResolutionLabel(size),
    quality: 'MP4'
  };

  return (
    <CreatorToolShell
      title={l('视频生成', 'Video Generation')}
      subtitle={l('根据文字或参考图生成 AI 视频片段', 'Generate an AI video clip from text or a reference image')}
      context={generating
        ? selectedResult
          ? l(`V${selectedResult.value} · 正在生成新版本`, `V${selectedResult.value} · Generating a new version`, `V${selectedResult.value} · Genererar en ny version`)
          : l('视频生成任务进行中', 'Video generation in progress', 'Videogenerering pågår')
        : selectedResult
        ? l(
            `V${selectedResult.value} · ${resultModelLabel} · ${resultRatio} · ${resultDuration} 秒`,
            `V${selectedResult.value} · ${resultModelLabel} · ${resultRatio} · ${resultDuration} seconds`,
            `V${selectedResult.value} · ${resultModelLabel} · ${resultRatio} · ${resultDuration} sekunder`
          )
          : `${selectedModelLabel} · ${followsReferenceRatio
            ? l('跟随参考图', 'Match reference image')
            : selectedSize.ratio} · ${duration}s`}
      taskSummary={<CreatorTaskSummary
        sourceIcon={Clapperboard}
        sourceLabel={l('视频描述', 'Prompt')}
        sourceValue={(selectedResult ? readString(resultSettings?.prompt) : prompt.trim()) || l('待添加', 'Not added', 'Inte tillagt')}
        compactSummary={selectedResult
          ? `${resultModelLabel} · ${resultRatio} · ${resultDuration}s · V${selectedResult.value}`
          : `${selectedModelLabel} · ${followsReferenceRatio ? l('跟随参考图', 'Match reference image') : selectedSize.ratio} · ${duration}s`}
        items={selectedResult ? [
          { label: l('视频服务', 'Provider'), value: l(resultProvider.zh, resultProvider.en) },
          { label: l('模型版本', 'Model version'), value: resultModelLabel },
          { label: l('画幅', 'Format'), value: `${resultFormatLabel} · ${resultRatio}` },
          { label: l('分辨率', 'Resolution'), value: resultResolution },
          { label: l('时长', 'Duration'), value: l(`${resultDuration} 秒`, `${resultDuration} seconds`, `${resultDuration} sekunder`) },
          { label: l('当前版本', 'Version'), value: `V${selectedResult.value}` }
        ] : [
          ...(currentReferenceName
            ? [{ label: l('参考图', 'Reference image'), value: currentReferenceName }]
            : []),
          { label: l('视频服务', 'Provider'), value: l(selectedProvider.zh, selectedProvider.en) },
          { label: l('模型版本', 'Model version'), value: selectedModelLabel },
          { label: l('画幅', 'Format'), value: followsReferenceRatio
            ? l('跟随参考图', 'Match reference image')
            : `${l(selectedSize.zh, selectedSize.en)} · ${selectedSize.ratio}` },
          { label: l('分辨率', 'Resolution'), value: followsReferenceRatio
            ? l('由模型根据参考图决定', 'Determined from the reference image')
            : videoSizeDisplay(size) },
          { label: l('时长', 'Duration'), value: l(`${duration} 秒`, `${duration} seconds`, `${duration} sekunder`) },
          { label: l('输出格式', 'Output format'), value: 'MP4' }
        ]}
      />}
      initialMessage={l(
        '描述你想生成的视频，包括主体动作、镜头和画面风格。',
        'Describe the video, including subject movement, camera direction, and visual style.'
      )}
      suggestions={[l('填入示例提示词', 'Use a sample prompt'), l('生成竖屏视频', 'Create a portrait video')]}
      placeholder={props.promptHint ?? l('描述需要生成的视频', 'Describe the video to generate')}
      onBack={props.onBack}
      onCommand={handleCommand}
      pageClassName="video-generation-workspace-page"
      contentClassName="media-generation-workspace-content"
      currentIssue={visibleError || undefined}
      onCancelTask={generating ? () => void cancelTask() : undefined}
      onResumeTask={resumable ? () => void resumeTask() : undefined}
      taskControlPending={taskControlPending}
      embedded={props.embedded && !selectedResult}
    >
      <div className="creator-tool-stack video-generation-studio">
        {!props.embedded ? <section className="video-generation-intro" aria-label={l('视频生成功能说明', 'Video generation overview')}>
          <p>{l(
            '描述主体动作、镜头和光线，选择模型、画幅与时长，生成可下载的视频片段。',
            'Describe the action, camera, and lighting, then choose a model, aspect ratio, and duration to generate a downloadable video clip.'
          )}</p>
          <div aria-label={l('功能特点', 'Features')}>
            <span>{l('文字或参考图', 'Text or Reference')}</span>
            <span>{l('多模型', 'Multi-Model')}</span>
            <span>{l('自定义画幅', 'Custom Ratios')}</span>
            <span>{l('MP4 输出', 'MP4 Output')}</span>
          </div>
        </section> : null}
        <form className="video-generation-composer" aria-label={l('视频生成', 'Video Generation')} onSubmit={event => {
          event.preventDefault();
          void generate();
        }}>
          <fieldset className="video-generation-fields" disabled={busy}>
            <div className="video-generation-editor">
              <div className="video-generation-composer-heading">
                {props.embeddedTabs ?? <h2 id="video-prompt-title"><Clapperboard size={18} strokeWidth={1.7} aria-hidden="true" />{l('视频', 'Video')}</h2>}
                {!props.embedded ? <span>{l('文字或参考图生成视频', 'Text or image to video')}</span> : null}
              </div>
              <div className="video-generation-reference" data-loaded={Boolean(currentReferenceName)}>
                  <label className="video-generation-reference-upload" title={!referenceSupported ? l('当前模型不支持参考图', 'The selected model does not support reference images') : currentReferenceName ? l('更换参考图', 'Replace reference') : l('添加参考图', 'Add reference image')}>
                    <input
                      type="file"
                      disabled={busy || !referenceSupported}
                      accept="image/jpeg,image/png,image/webp"
                      aria-label={l('上传视频参考图', 'Upload video reference image')}
                      onChange={event => {
                        updateReferenceImage(event.target.files?.[0] ?? null);
                        event.target.value = '';
                      }}
                    />
                    <span className="video-generation-reference-thumbnail">
                      {referenceImageUrl
                        ? <img src={referenceImageUrl} alt={l('视频参考图预览', 'Video reference preview')} />
                        : <ImagePlus size={24} strokeWidth={1.5} />}
                    </span>
                    {!currentReferenceName ? <span className="video-generation-reference-copy">
                      <span><strong>{l('参考图', 'Reference', 'Referens')}</strong>
                        <small>{l('选填', 'Optional')}</small></span>
                      <small>{l('支持 JPG、PNG、WebP，最大 5MB', 'JPG, PNG, or WebP, up to 5 MB')}</small>
                    </span> : null}
                    <span className="video-generation-reference-count">{currentReferenceName ? 1 : 0}/1</span>
                  </label>
                  {currentReferenceName ? (
                    <button
                      className="video-generation-reference-remove"
                      type="button"
                      disabled={busy}
                      onClick={removeReferenceImage}
                      aria-label={l('移除参考图', 'Remove reference image')}
                      title={l('移除参考图', 'Remove reference image')}
                    >
                      <X size={15} strokeWidth={1.8} />
                    </button>
                  ) : null}
              </div>
              <label className="creator-tool-field video-generation-prompt-field">
                <span className="video-generation-visually-hidden">{l('提示词', 'Prompt')}</span>
                <textarea
                  id="video-prompt-input"
                  rows={5}
                  disabled={busy}
                  maxLength={creatorPromptMaxLength}
                  value={prompt}
                  onChange={event => updatePrompt(event.target.value)}
                  placeholder={l(
                    '例如：低机位跟随一辆红色跑车驶过海岸公路，黄昏金色光线，镜头平稳',
                    'For example: A low-angle tracking shot following a red sports car along a coastal road at golden hour, smooth camera motion'
                  )}
                />
              </label>
              <div className="video-generation-prompt-tools">
                <button type="button" disabled={busy} title={l('填入示例提示词', 'Use sample prompt')} aria-label={l('填入示例提示词', 'Use sample prompt')} onClick={() => updatePrompt(l(samplePromptZh, samplePromptEn, samplePromptSv))}>
                  <WandSparkles size={16} strokeWidth={1.8} />
                </button>
                <button type="button" disabled={busy || !prompt} title={l('清空提示词', 'Clear prompt', 'Rensa prompt')} aria-label={l('清空提示词', 'Clear prompt', 'Rensa prompt')} onClick={() => updatePrompt('')}>
                  <Trash2 size={16} strokeWidth={1.8} />
                </button>
                <small>{characterCount} / {creatorPromptMaxLength}</small>
              </div>
            </div>
            <div className="video-generation-action-bar">
              <div className="video-generation-model-row">
                  <label className="creator-tool-field">
                    <OfficialModelSelect
                      label={l('模型', 'Model')}
                      value={selectedCatalogId}
                      disabled={busy}
                      layout="grouped"
                      compactOptions
                      loginRequiredModelIds={loginRequiredModelIds}
                      configureModel={localModel && !localConfigured ? {
                        id: localVideoModelId,
                        title: l('配置本地视频服务', 'Configure local video service', 'Konfigurera lokal videotjänst'),
                        onConfigure: () => { window.location.hash = '#/settings?tab=ai-services&section=video'; }
                      } : undefined}
                      onChange={selectCatalogModel}
                      models={catalogModels}
                    />
                  </label>
                {!official.official && catalogState !== 'ready' ? <div className="video-generation-catalog-status" role="status">
                  {catalogState === 'loading' ? l('正在加载官方视频模型…', 'Loading official video models…', 'Läser in officiella videomodeller…') : <>
                    <span>{l('官方视频模型目录加载失败', 'Official video models could not load', 'Kunde inte läsa in officiella videomodeller')}</span>
                    <button type="button" onClick={() => loadPublicCatalog(true)} aria-label={l('重试加载视频模型', 'Retry loading video models', 'Försök läsa in videomodeller igen')}><RefreshCw size={14} />{l('重试', 'Retry', 'Försök igen')}</button>
                  </>}
                </div> : null}
              </div>
              <ImageGenerationSettings
                label={l('视频设置', 'Video settings', 'Videoinställningar')}
                summary={videoSettingsSummary}
                sections={videoSettingSections}
                countIcon="clock"
                disabled={busy || !serviceReady}
                hideHeader={props.embedded}
              />
              <div className="video-generation-submit-row">
                {resumable ? (
                  <button className="creator-tool-primary" type="button" onClick={() => void resumeTask()} disabled={taskControlPending !== undefined}>
                    {taskControlPending === 'resuming' ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}
                    {l('继续任务', 'Resume task')}
                  </button>
                ) : (
                  <button className="creator-tool-primary" type="submit" disabled={busy}>
                    {busy ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : selectedResult ? <RotateCcw size={16} /> : <Sparkles size={16} />}
                    {busy ? l('正在生成', 'Generating') : selectedResult ? l('重新生成', 'Regenerate') : l('开始生成', 'Generate')}
                  </button>
                )}
              </div>
            </div>
          </fieldset>
        </form>

        {!props.embedded && (selectedResult || generating) ? (
          <section className="video-generation-output" aria-labelledby="video-output-title">
            <div className="creator-tool-panel-heading">
              <div>
                <h2 id="video-output-title">{selectedResult ? l('生成结果', 'Generated video') : l('生成视频', 'Generate video')}</h2>
                <p>{generating
                  ? selectedResult
                    ? l('新版本正在后台生成，可以继续预览和下载当前版本', 'A new version is generating in the background. You can still preview and download the current version.', 'En ny version genereras i bakgrunden. Du kan fortfarande förhandsgranska och ladda ner den nuvarande versionen.')
                    : l('任务正在后台生成，完成后会自动显示', 'The task is running in the background and will appear automatically')
                  : l('预览历史版本并下载需要的成片', 'Preview previous versions and download the video you need')}</p>
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
            {generating ? <CreatorTaskProgressNotice stageId="generate" /> : null}
            {selectedResult ? (
              <div className="video-generation-result" data-ratio={resultRatio}>
                {videoUrl ? (
                  <GeneratedVideoPreview src={videoUrl} duration={resultArtifactDuration} />
                ) : (
                  <div className="video-result-player-status" role="status">
                    {previewFailed ? previewError : (
                      <>
                        <LoaderCircle className="smart-dubbing-spinner" size={18} />
                        {l('正在加载视频预览', 'Loading video preview')}
                      </>
                    )}
                  </div>
                )}
                <div>
                  <span>
                    <strong>{artifactFileName(selectedResult.artifact, selectedResult.value)}</strong>
                    <small>
                      {formatBytes(readArtifactBytes(selectedResult.artifact))}
                      {' · '}{resultModelLabel}
                    </small>
                  </span>
                  <div>
                    <button className="creator-tool-primary" type="button" onClick={() => void download()}>
                      <Download size={15} />
                      {l('下载视频', 'Download video')}
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        {error ? (
          <p className="creator-tool-error" role="alert">
            {error}
            {settingsDeepLink ? (
              <>
                {' '}
                <a href={settingsDeepLink}>{l('打开 AI 服务设置', 'Open AI service settings')}</a>
              </>
            ) : null}
          </p>
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function GeneratedVideoPreview(props: { src: string; duration?: number }) {
  const localize = useLocalizedCopy();
  const [playback, setPlayback] = useState<{ src: string; currentTime: number; duration?: number }>({
    src: props.src,
    currentTime: 0
  });
  const currentTime = playback.src === props.src ? playback.currentTime : 0;
  const duration = (playback.src === props.src ? playback.duration : undefined) ?? props.duration;

  function updatePlayback(video: HTMLVideoElement) {
    if (video.currentSrc && video.currentSrc !== props.src) return;
    const currentTime = Number.isFinite(video.currentTime) && video.currentTime >= 0 ? video.currentTime : 0;
    const measuredDuration = readVideoDuration(video.duration);
    setPlayback(previous => {
      const duration = measuredDuration ?? (previous.src === props.src ? previous.duration : undefined);
      if (previous.src === props.src && previous.currentTime === currentTime && previous.duration === duration) return previous;
      return { src: props.src, currentTime, duration };
    });
  }

  return (
    <figure className="video-generation-preview">
      <video
        controls
        playsInline
        preload="metadata"
        src={props.src}
        aria-label={localize('生成视频预览', 'Generated video preview')}
        onLoadedMetadata={event => updatePlayback(event.currentTarget)}
        onDurationChange={event => updatePlayback(event.currentTarget)}
        onTimeUpdate={event => updatePlayback(event.currentTarget)}
        onSeeked={event => updatePlayback(event.currentTarget)}
      />
      <figcaption>
        <span>{localize('当前时间 / 总时长', 'Position / duration', 'Position / längd')}</span>
        <output aria-label={localize('播放时间', 'Playback time', 'Uppspelningstid')} aria-live="off">
          {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
        </output>
      </figcaption>
    </figure>
  );
}

function readVideoDuration(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function formatPlaybackTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '--:--';
  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const remainder = totalSeconds % 60;
  const clock = `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${clock}` : clock;
}

function createVideoResultVersions(
  artifacts: CreatorArtifact[],
  resultSnapshots: CreatorJson | undefined
): VideoResultVersion[] {
  const byId = new Map(artifacts.map(artifact => [artifact.id, artifact]));
  const snapshots = readCreatorResultSnapshots(resultSnapshots);
  const fromSnapshots = snapshots.flatMap(snapshot => {
    const artifact = (snapshot.artifactRefs.generated_video ?? [])
      .map(id => byId.get(id))
      .find((candidate): candidate is CreatorArtifact => candidate !== undefined);
    return artifact === undefined ? [] : [{
      value: snapshot.version,
      description: snapshot.description,
      artifact,
      state: snapshot.state
    }];
  });
  if (fromSnapshots.length > 0) return fromSnapshots;

  return artifacts
    .filter(artifact => (
      artifact.kind === 'generated_video'
      && artifact.path !== null
      && artifact.status !== 'stale'
    ))
    .map(artifact => ({
      value: readPositiveInteger(artifact.metadata.resultVersion) ?? artifact.version,
      description: 'Generate',
      artifact,
      state: {}
    }))
    .sort((left, right) => left.value - right.value);
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readProvider(value: CreatorJson | undefined): VideoGenerationProvider {
  return value === 'kling' || value === 'veo' ? value : 'seedance';
}

function readOptionalProvider(
  value: CreatorJson | undefined
): VideoGenerationProvider | undefined {
  return value === 'seedance' || value === 'kling' || value === 'veo'
    ? value
    : undefined;
}

function readModel(
  value: CreatorJson | undefined,
  provider: VideoGenerationProvider
): string {
  return readOptionalModel(value) ?? defaultVideoGenerationModels[provider];
}

function readOptionalModel(value: CreatorJson | undefined): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function videoModelDefaults(
  config: CreatorServicesConfig
): Record<VideoGenerationProvider, string> {
  return {
    seedance: config.video.seedance.model.trim() === 'doubao-seedance-1-0-pro-250528'
      ? defaultVideoGenerationModels.seedance
      : config.video.seedance.model.trim() || defaultVideoGenerationModels.seedance,
    kling: config.video.kling.model.trim() || defaultVideoGenerationModels.kling,
    veo: config.video.veo.model.trim() || defaultVideoGenerationModels.veo
  };
}

function localVideoProviderReady(
  config: CreatorServicesConfig['video'],
  credentials: CreatorServicesCredentialField[],
  provider: VideoGenerationProvider
): boolean {
  if (!config[provider].model.trim()) return false;
  return provider === 'kling'
    ? credentials.includes('video.kling.accessKey') && credentials.includes('video.kling.secretKey')
    : credentials.includes(`video.${provider}.apiKey` as CreatorServicesCredentialField);
}

function preferredSeedanceVideoModel(models: readonly GatewayModel[]): GatewayModel | undefined {
  const ready = models.filter(gatewayModelReady);
  return ready.find(model => /^seedance[ .-]*2[.-]5$/i.test(model.name?.trim() ?? ''))
    ?? ready.find(model => /seedance[ .-]*2[.-]5/i.test(`${model.name ?? ''} ${model.id}`));
}

function videoModelLabel(model: string): string {
  return modelLabels[model] ?? gatewayModelDisplayName({ id: model }, 'OpenCreator');
}

function videoSizeOption(value: string): typeof sizes[number] {
  const known = sizes.find(item => item.value === value);
  if (known) return known;
  const [resolution, ratio] = value.split('@');
  const match = /^(\d+)x(\d+)$/.exec(value);
  const width = Number(match?.[1]), height = Number(match?.[2]);
  const gcd = (a: number, b: number): number => b ? gcd(b, a % b) : a;
  const divisor = gcd(width, height);
  return { value: value as VideoGenerationSize, zh: resolution!, en: resolution!, ratio: ratio ?? (divisor ? `${width / divisor}:${height / divisor}` : '') };
}

function videoSizeDisplay(value: string): string { return value.replace('@', ' · '); }

function videoResolutionLabel(value: string): string { return value.split('@')[0] ?? value; }

function readSize(value: CreatorJson | undefined, official = false): VideoGenerationSize {
  if (official && typeof value === 'string' && /^(?:\d+x\d+|[A-Za-z0-9._-]+@\d+:\d+)$/.test(value)) return value as VideoGenerationSize;
  return value === '720x1280' || value === '1024x1024' ? value : '1280x720';
}

function readDuration(
  value: CreatorJson | undefined,
  provider: VideoGenerationProvider,
  official = false
): VideoGenerationDuration {
  if (official && typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 600) return value;
  const allowed = providerDurations[provider];
  return typeof value === 'number' && allowed.includes(value as VideoGenerationDuration)
    ? value as VideoGenerationDuration
    : allowed[0]!;
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

function readArtifactBytes(artifact: CreatorArtifact): number {
  const bytes = artifact.metadata.bytes ?? artifact.metadata.size;
  return typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
}

function readArtifactNumber(
  artifact: CreatorArtifact | undefined,
  key: string
): number | undefined {
  const value = artifact?.metadata[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function formatAspectRatio(width: number, height: number): string {
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.max(1, Math.round(left));
  let b = Math.max(1, Math.round(right));
  while (b > 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function videoFormatLabel(
  width: number,
  height: number,
  l: (zh: string, en: string) => string
): string {
  if (width === height) return l('方形', 'Square');
  return width > height ? l('横屏', 'Landscape') : l('竖屏', 'Portrait');
}

function readPositiveInteger(value: CreatorJson | undefined): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

function isRecoverableVideoStage(
  stage: CreatorStageRun | undefined
): boolean {
  return stage?.status === 'failed'
    && stage.errorCode === 'creator_video_upstream_error'
    && typeof stage.progress.videoGenerationResultId === 'string'
    && stage.progress.videoGenerationResultId.length > 0;
}

function readNeedsInputDeepLink(value: CreatorJson | undefined): string {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return '';
  return typeof value.deepLink === 'string' ? value.deepLink : '';
}

function artifactFileName(artifact: CreatorArtifact, version: number): string {
  return readArtifactString(artifact, 'fileName')
    ?? `OpenCreator-video-V${version}.mp4`;
}

function formatBytes(size: number) {
  if (size <= 0) return 'MP4';
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatVideoError(
  error: unknown,
  l: LocalizeCopy,
  modelLabel = '',
  provider: VideoGenerationProvider = 'seedance'
) {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  const message = typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message?: unknown }).message ?? '')
    : error instanceof Error
      ? error.message
      : '';
  if (code === 'creator_video_config_missing' || code === 'VIDEO_GENERATION_CONFIG_REQUIRED') {
    return l(
      '请先在设置的 AI 服务中配置视频生成服务',
      'Configure a video generation provider in AI Services first'
    );
  }
  if (code === 'creator_stage_interrupted_on_restart') {
    return l(
      'Runtime 重启中断了任务，可以继续查询原视频生成任务',
      'The Runtime restart interrupted this task. Resume it to continue checking the existing generation.'
    );
  }
  if (
    code === 'creator_video_model_unavailable'
    || isUnavailableModelMessage(message)
  ) {
    const selected = modelLabel || l('所选模型', 'the selected model');
    const consoleName = provider === 'seedance'
      ? l('方舟控制台', 'Ark Console')
      : l('服务商控制台', 'the provider console');
    return l(
      `当前账号未开通 ${selected}，请切换模型版本或前往${consoleName}开通`,
      `${selected} is not enabled for this account. Switch models or enable it in ${consoleName}.`
    );
  }
  if (typeof error === 'object' && error !== null && 'publicFacts' in error && isPublicErrorFacts(error.publicFacts)
    && error.publicFacts.kind !== 'unknown') {
    return publicErrorReason(error.publicFacts, l);
  }
  if (code === 'creator_video_upstream_error' || code === 'VIDEO_GENERATION_UPSTREAM_ERROR') {
    return l(
      '视频生成请求失败，请检查模型服务配置和网络后重试',
      'Video generation failed. Check the provider configuration and network, then retry.'
    );
  }
  return l('视频生成未完成，请检查模型服务配置后重试', 'Video generation did not complete. Check the provider settings, then retry.');
}

function isUnavailableModelMessage(message: string): boolean {
  return /(?:not activated|not enabled|not subscribed|no permission|permission denied|access denied).{0,80}(?:model|service)|(?:model|service).{0,80}(?:not activated|not enabled|not subscribed|no permission|permission denied|access denied)/i
    .test(message);
}
