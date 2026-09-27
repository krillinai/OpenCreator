import {
  wechatArticleLayoutStyles,
  wechatArticleSourceLimit,
  type CreatorArtifact,
  type CreatorJson,
  type WechatArticleImageStyleId,
  type WechatArticleLayoutCategoryId,
  type WechatArticleLayoutStyleId,
  type WechatArticlePresetId,
  type WechatArticlePresetCategoryId,
  type WechatArticleSourceLink,
  type WechatArticleTopic
} from '@opencreator/protocol';
import {
  localizeWritingTemplate,
  normalizeWritingTemplateId,
  writingTemplates as wechatArticlePresetCatalog,
  type WritingTemplateDomainId
} from '@opencreator/writing-templates';
import {
  Check,
  Clipboard,
  ChevronDown,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  ImageUp,
  Library,
  Link2,
  LoaderCircle,
  Minus,
  PackageOpen,
  Plus,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { copyRichContent } from '../../components/markdown/clipboard.js';
import { MarkdownRenderer } from '../../components/markdown/MarkdownRenderer.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import {
  createCreatorArtifactObjectUrl,
  readCreatorArtifactText,
  useOptionalCreatorSession
} from './creator-session-store.js';

type ArticleStep = 0 | 1 | 2 | 3 | 4 | 5;
type ArticleWorkspacePhase = 'compose' | 'result';
type ArticleResultTab = 'outputs' | 'images' | 'settings';
type ArticleToast = { id: number; message: string };
type ArticleEditorPart =
  | { kind: 'text'; markdown: string }
  | { kind: 'image'; markdown: string; alt: string; href: string; src: string; artifactId: string };
type ArticleImageUploadIntent =
  | { mode: 'insert'; partIndex: number; offset: number }
  | { mode: 'replace'; partIndex: number; artifactId: string; href: string };
type ArticleImageDropTarget = { partIndex: number; offset: number; top: number };
type ArticleTemplateCategory = 'all' | WechatArticlePresetCategoryId;
type ArticleTemplateTopFilter = 'all' | 'popular' | 'community' | WritingTemplateDomainId;
type TemplateLibraryAnchor = { left: number; width: number };

const stepLabels = [
  ['内容灵感', 'Inspiration'],
  ['写作要求', 'Writing brief'],
  ['选择选题', 'Choose topic'],
  ['确认大纲', 'Review outline'],
  ['编辑文章', 'Edit article'],
  ['排版预览', 'Layout & preview']
] as const;

const articleTemplateCategories: ReadonlyArray<{
  id: ArticleTemplateCategory;
  zh: string;
  en: string;
}> = [
  { id: 'all', zh: '全部模板', en: 'All templates' },
  { id: 'analysis', zh: '深度观点', en: 'Analysis' },
  { id: 'story', zh: '故事人物', en: 'Stories' },
  { id: 'practical', zh: '教程干货', en: 'Practical' },
  { id: 'news', zh: '热点解读', en: 'News' }
];

const articleTemplateTopFilters: ReadonlyArray<{
  id: ArticleTemplateTopFilter;
  zh: string;
  en: string;
}> = [
  { id: 'all', zh: '全部', en: 'All' },
  { id: 'popular', zh: '热门', en: 'Popular' },
  { id: 'community', zh: '社区', en: 'Community' },
  { id: 'technology', zh: '科技', en: 'Technology' },
  { id: 'finance', zh: '财经', en: 'Finance' },
  { id: 'emotion', zh: '情感', en: 'Relationships' },
  { id: 'workplace', zh: '职场', en: 'Workplace' },
  { id: 'education', zh: '教育', en: 'Education' },
  { id: 'research', zh: '科研', en: 'Research' },
  { id: 'lifestyle', zh: '生活', en: 'Lifestyle' }
];

const articleTemplateInlineFilters = articleTemplateTopFilters.filter(filter => (
  filter.id !== 'all' && filter.id !== 'community'
));

const articleImageDensityOptions = [
  { id: 'few', count: 2, zh: '少图', en: 'Few' },
  { id: 'balanced', count: 5, zh: '适中', en: 'Balanced' },
  { id: 'many', count: 8, zh: '多图', en: 'Many' }
] as const;

const articleLayoutCategoryOptions: ReadonlyArray<{
  id: WechatArticleLayoutCategoryId;
  zh: string;
  en: string;
}> = [
  { id: 'recommended', zh: '推荐', en: 'Recommended' },
  { id: 'technology', zh: '科技', en: 'Technology' },
  { id: 'business', zh: '商业', en: 'Business' },
  { id: 'news', zh: '资讯', en: 'News' },
  { id: 'lifestyle', zh: '生活', en: 'Lifestyle' },
  { id: 'humanities', zh: '人文', en: 'Humanities' }
];

const articleImageStyleOptions: ReadonlyArray<{
  id: WechatArticleImageStyleId;
  zh: string;
  en: string;
  descriptionZh: string;
  descriptionEn: string;
  previewSrc: string;
}> = [
  { id: 'editorial', zh: '杂志视觉', en: 'Editorial', descriptionZh: '克制、有重点的编辑配图', descriptionEn: 'Polished editorial composition', previewSrc: '/dashboard/wechat-article/image-styles/editorial-v2.webp' },
  { id: 'minimal', zh: '极简概念', en: 'Minimal', descriptionZh: '留白与视觉隐喻', descriptionEn: 'Negative space and visual metaphor', previewSrc: '/dashboard/wechat-article/image-styles/minimal-v2.webp' },
  { id: 'documentary', zh: '纪实摄影', en: 'Documentary', descriptionZh: '真实场景与自然光线', descriptionEn: 'Natural, credible real-world scenes', previewSrc: '/dashboard/wechat-article/image-styles/documentary-v2.webp' },
  { id: 'illustration', zh: '现代插画', en: 'Illustration', descriptionZh: '叙事感与印刷质感', descriptionEn: 'Narrative editorial illustration', previewSrc: '/dashboard/wechat-article/image-styles/illustration.webp' },
  { id: 'three-dimensional', zh: '3D 视觉', en: '3D Visual', descriptionZh: '材质、空间与柔和光影', descriptionEn: 'Tactile materials and soft lighting', previewSrc: '/dashboard/wechat-article/image-styles/three-dimensional-v2.webp' },
  { id: 'infographic', zh: '数据图解', en: 'Infographic', descriptionZh: '结构清晰的信息可视化', descriptionEn: 'Structured information visualization', previewSrc: '/dashboard/wechat-article/image-styles/infographic.webp' }
];

export default function WechatArticleWorkspace(props: {
  onBack(): void;
  promptHint?: string;
}) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const wechatArticlePresets = useMemo(
    () => wechatArticlePresetCatalog.map(preset => localizeWritingTemplate(
      preset,
      language === 'sv-SE' ? 'en-US' : language
    )),
    [language]
  );
  const session = useOptionalCreatorSession();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const articleImageInputRef = useRef<HTMLInputElement>(null);
  const articleImageUploadIntentRef = useRef<ArticleImageUploadIntent>();
  const activeArticleSelectionRef = useRef<{ partIndex: number; offset: number }>();
  const draggedArticleImagePartRef = useRef<number>();
  const templateLibraryAnchorRef = useRef<HTMLDivElement>(null);
  const articlePreviewRef = useRef<HTMLDivElement>(null);
  const toastIdRef = useRef(0);
  const pendingSourceParseRef = useRef(false);
  const [currentStep, setCurrentStep] = useState<ArticleStep>(() => readStep(session?.state.currentStep));
  const [furthestStep, setFurthestStep] = useState<ArticleStep>(() => readStep(session?.state.furthestStep));
  const [sourceLinks, setSourceLinks] = useState<WechatArticleSourceLink[]>(() => readLinks(session?.state.sourceLinks));
  const [urlInput, setUrlInput] = useState('');
  const [writingPrompt, setWritingPrompt] = useState(() => readString(session?.state.writingPrompt));
  const [topicCount, setTopicCount] = useState(() => readTopicCount(session?.state.topicCount));
  const [topicCountDraft, setTopicCountDraft] = useState(() => String(readTopicCount(session?.state.topicCount)));
  const [topics, setTopics] = useState<WechatArticleTopic[]>(() => readTopics(session?.state.topics));
  const [selectedTopicId, setSelectedTopicId] = useState(() => readString(session?.state.selectedTopicId));
  const [outline, setOutline] = useState(() => readString(session?.state.outline));
  const initialPreset = readPreset(session?.state.presetId);
  const [presetId, setPresetId] = useState<WechatArticlePresetId>(initialPreset);
  const [templatePrompt, setTemplatePrompt] = useState(() => (
    readString(session?.state.templatePrompt)
      || wechatArticlePresets.find(preset => preset.id === initialPreset)?.instructions
      || ''
  ));
  const [layoutStyleId, setLayoutStyleId] = useState<WechatArticleLayoutStyleId>(() => (
    readLayoutStyle(session?.state.layoutStyleId)
  ));
  const [layoutCategoryId, setLayoutCategoryId] = useState<WechatArticleLayoutCategoryId>('recommended');
  const [templateLibraryOpen, setTemplateLibraryOpen] = useState(false);
  const [templateLibraryAnchor, setTemplateLibraryAnchor] = useState<TemplateLibraryAnchor>();
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateTopFilter, setTemplateTopFilter] = useState<ArticleTemplateTopFilter>('popular');
  const [templateCategory, setTemplateCategory] = useState<ArticleTemplateCategory>('all');
  const [previewPresetId, setPreviewPresetId] = useState<WechatArticlePresetId>(initialPreset);
  const [articleMarkdown, setArticleMarkdown] = useState(() => readString(session?.state.articleMarkdown));
  const [autoGenerateImages, setAutoGenerateImages] = useState(() => readBoolean(session?.state.autoGenerateImages, true));
  const [articleImageCount, setArticleImageCount] = useState(() => readArticleImageCount(session?.state.articleImageCount));
  const [articleImageStyleId, setArticleImageStyleId] = useState<WechatArticleImageStyleId>(() => readArticleImageStyle(session?.state.articleImageStyleId));
  const [articleImageUrls, setArticleImageUrls] = useState<Record<string, string>>({});
  const [uploadingArticleImage, setUploadingArticleImage] = useState(false);
  const [draggedArticleImagePartIndex, setDraggedArticleImagePartIndex] = useState<number>();
  const [articleImageDropTarget, setArticleImageDropTarget] = useState<ArticleImageDropTarget>();
  const [copyingArticle, setCopyingArticle] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sourceDragActive, setSourceDragActive] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<ArticleToast | null>(null);
  const [taskControlPending, setTaskControlPending] = useState<'canceling' | 'resuming'>();

  function commitTopicCount() {
    const parsed = Number(topicCountDraft);
    const value = topicCountDraft.trim() && Number.isFinite(parsed)
      ? Math.max(3, Math.min(10, Math.trunc(parsed)))
      : topicCount;
    setTopicCount(value);
    setTopicCountDraft(String(value));
    session?.updateDraft({ topicCount: value });
  }

  const selectedDocumentIds = useMemo(
    () => readStringArray(session?.state.sourceDocumentArtifactIds),
    [session?.state.sourceDocumentArtifactIds]
  );
  const documentArtifacts = useMemo(() => selectedDocuments(
    session?.job.artifacts ?? [],
    selectedDocumentIds
  ), [session?.job.artifacts, selectedDocumentIds]);
  const sourceCount = sourceLinks.length + selectedDocumentIds.length;
  const remainingSourceCount = Math.max(0, wechatArticleSourceLimit - sourceCount);
  const sourceLimitReached = remainingSourceCount === 0;
  const sourcesArtifact = latestArtifact(session?.job.artifacts ?? [], 'article_sources');
  const topicsArtifact = latestArtifact(session?.job.artifacts ?? [], 'article_topics');
  const outlineArtifact = latestArtifact(session?.job.artifacts ?? [], 'article_outline');
  const articleArtifact = latestArtifact(session?.job.artifacts ?? [], 'article_markdown');
  const manualArticleImageArtifactIds = useMemo(
    () => readStringArray(session?.state.manualArticleImageArtifactIds),
    [session?.state.manualArticleImageArtifactIds]
  );
  const hiddenArticleImageArtifactIds = useMemo(
    () => readStringArray(session?.state.hiddenArticleImageArtifactIds),
    [session?.state.hiddenArticleImageArtifactIds]
  );
  const articleImagePlacementCustomized = readBoolean(session?.state.articleImagePlacementCustomized, false);
  const generatedArticleImageArtifacts = useMemo(
    () => latestArticleImages(session?.job.artifacts ?? [])
      .filter(artifact => !hiddenArticleImageArtifactIds.includes(artifact.id)),
    [hiddenArticleImageArtifactIds, session?.job.artifacts]
  );
  const manualArticleImageArtifacts = useMemo(
    () => selectedManualArticleImages(session?.job.artifacts ?? [], manualArticleImageArtifactIds)
      .filter(artifact => !hiddenArticleImageArtifactIds.includes(artifact.id)),
    [hiddenArticleImageArtifactIds, manualArticleImageArtifactIds, session?.job.artifacts]
  );
  const articleImageArtifacts = useMemo(
    () => [...generatedArticleImageArtifacts, ...manualArticleImageArtifacts],
    [generatedArticleImageArtifacts, manualArticleImageArtifacts]
  );
  const articleImageSetKey = useMemo(
    () => generatedArticleImageArtifacts.map(artifact => artifact.id).join('|'),
    [generatedArticleImageArtifacts]
  );
  const articleImagePreviewSources = useMemo(() => {
    const sources: Record<string, string> = {};
    for (const artifact of articleImageArtifacts) {
      const fileName = readString(artifact.metadata.fileName);
      const url = articleImageUrls[artifact.id];
      if (!fileName || !url) continue;
      sources[fileName] = url;
      sources[`./${fileName}`] = url;
    }
    return sources;
  }, [articleImageArtifacts, articleImageUrls]);
  const articleImageArtifactsByHref = useMemo(() => {
    const artifacts: Record<string, CreatorArtifact> = {};
    for (const artifact of articleImageArtifacts) {
      const fileName = readString(artifact.metadata.fileName);
      if (!fileName) continue;
      artifacts[fileName] = artifact;
      artifacts[`./${fileName}`] = artifact;
    }
    return artifacts;
  }, [articleImageArtifacts]);
  const articleEditorParts = useMemo(
    () => splitArticleEditorParts(articleMarkdown, articleImagePreviewSources, articleImageArtifactsByHref),
    [articleImageArtifactsByHref, articleImagePreviewSources, articleMarkdown]
  );
  const articleDocumentArtifacts = useMemo(
    () => latestArticleDocuments(session?.job.artifacts ?? []),
    [session?.job.artifacts]
  );
  const finalDocumentArtifact = articleDocumentArtifacts.find(artifact => readString(artifact.metadata.documentFormat) === 'markdown')
    ?? articleDocumentArtifacts[0];
  const [workspacePhase, setWorkspacePhase] = useState<ArticleWorkspacePhase>(() => (
    readWorkspacePhase(session?.state.workspacePhase, finalDocumentArtifact !== undefined)
  ));
  const [resultTab, setResultTab] = useState<ArticleResultTab>('outputs');
  const knownDocumentArtifactIdRef = useRef(finalDocumentArtifact?.id);
  const placedArticleImageSetRef = useRef('');
  const latestStage = session?.job.stages.at(-1);
  const running = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const documentRunning = running && latestStage?.stageId === 'document';
  const imageRunning = running && latestStage?.stageId === 'images';
  const sessionErrorMessage = formatArticleSessionError(session?.error?.code, session?.error?.message, l);
  const visibleError = error || (latestStage?.status === 'failed'
    ? formatArticleStageError(latestStage.errorCode, latestStage.errorMessage, readString(latestStage.progress.message), l)
    : sessionErrorMessage);
  const selectedTopic = topics.find(topic => topic.id === selectedTopicId);
  const selectedPreset = wechatArticlePresets.find(preset => preset.id === presetId);
  const selectedLayout = wechatArticleLayoutStyles.find(style => style.id === layoutStyleId);
  const selectedArticleImageStyle = articleImageStyleOptions.find(style => style.id === articleImageStyleId);
  const articleCharacterCount = useMemo(() => countArticleCharacters(articleMarkdown), [articleMarkdown]);
  const filteredLayoutStyles = useMemo(
    () => wechatArticleLayoutStyles.filter(style => style.categories.includes(layoutCategoryId)),
    [layoutCategoryId]
  );
  const topFilteredPresets = useMemo(() => wechatArticlePresets.filter(preset => {
    if (templateTopFilter === 'all') return true;
    if (templateTopFilter === 'popular') return preset.status === 'featured';
    if (templateTopFilter === 'community') return preset.source.type === 'github';
    return preset.domains.includes(templateTopFilter);
  }), [templateTopFilter, wechatArticlePresets]);
  const filteredPresets = useMemo(() => {
    const query = templateQuery.trim().toLocaleLowerCase();
    return topFilteredPresets.filter(preset => {
      const matchesCategory = templateCategory === 'all' || preset.categoryId === templateCategory;
      const matchesQuery = !query || [preset.name, preset.description, preset.author, preset.source.repository ?? '', ...preset.tags]
        .some(value => value.toLocaleLowerCase().includes(query));
      return matchesCategory && matchesQuery;
    });
  }, [templateCategory, templateQuery, topFilteredPresets]);
  const previewPreset = filteredPresets.find(preset => preset.id === previewPresetId) ?? filteredPresets[0];

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => {
      setToast(current => current?.id === toast.id ? null : current);
    }, 4_000);
    return () => window.clearTimeout(timer);
  }, [toast?.id]);

  useEffect(() => {
    const catalogPreset = wechatArticlePresetCatalog.find(preset => preset.id === presetId);
    const localizedPreset = wechatArticlePresets.find(preset => preset.id === presetId);
    if (catalogPreset === undefined || localizedPreset === undefined) return;
    const defaultInstructions = [
      catalogPreset.instructions,
      ...Object.values(catalogPreset.localizations).map(localization => localization.instructions)
    ];
    if (!defaultInstructions.includes(templatePrompt) || templatePrompt === localizedPreset.instructions) return;
    setTemplatePrompt(localizedPreset.instructions);
    session?.updateDraft({ templatePrompt: localizedPreset.instructions });
  }, [language, presetId, session, templatePrompt, wechatArticlePresets]);

  useEffect(() => {
    if (session === null || articleImageArtifacts.length === 0 || typeof URL.createObjectURL !== 'function') {
      setArticleImageUrls({});
      return undefined;
    }
    let active = true;
    const objectUrls: string[] = [];
    void Promise.all(articleImageArtifacts.map(async artifact => {
      const url = await createCreatorArtifactObjectUrl(
        session,
        artifact.id,
        'wechat-article.load-image-preview',
        l('文章配图加载失败，请稍后重试。', 'Article images failed to load. Try again later.')
      );
      objectUrls.push(url);
      return [artifact.id, url] as const;
    })).then(entries => {
      if (active) setArticleImageUrls(Object.fromEntries(entries));
    }).catch(() => {
      if (active) setArticleImageUrls({});
    });
    return () => {
      active = false;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [articleImageArtifacts, l, session?.captureCreatorFailure, session?.openArtifact]);

  useEffect(() => {
    if (!templateLibraryOpen) return;
    const update = () => updateTemplateLibraryAnchor();
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [templateLibraryOpen]);

  useEffect(() => {
    if (!pendingSourceParseRef.current || sourcesArtifact === undefined) return;
    pendingSourceParseRef.current = false;
    const next = Math.max(furthestStep, 1) as ArticleStep;
    setCurrentStep(1);
    setFurthestStep(next);
    session?.updateDraft({ currentStep: 1, furthestStep: next });
    const parsedCount = readNumber(sourcesArtifact.metadata.sourceCount);
    const automaticCount = readNumber(sourcesArtifact.metadata.automaticTranscriptCount);
    showToast(automaticCount > 0
      ? l(`已解析 ${parsedCount} 个内容灵感，其中 ${automaticCount} 个视频使用自动字幕`, `${parsedCount} inspiration sources parsed; ${automaticCount} video transcripts are automatic.`)
      : l(`已解析 ${parsedCount} 个内容灵感`, `${parsedCount} inspiration sources parsed.`), 'success');
  }, [sourcesArtifact?.id]);

  useEffect(() => {
    if (
      pendingSourceParseRef.current
      && latestStage?.stageId === 'sources'
      && (latestStage.status === 'failed' || latestStage.status === 'canceled')
    ) {
      pendingSourceParseRef.current = false;
    }
  }, [latestStage?.id, latestStage?.status]);

  useEffect(() => {
    if (!templateLibraryOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTemplateLibraryOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [templateLibraryOpen]);

  useEffect(() => {
    if (
      finalDocumentArtifact === undefined
      || finalDocumentArtifact.id === knownDocumentArtifactIdRef.current
    ) return;
    knownDocumentArtifactIdRef.current = finalDocumentArtifact.id;
    setWorkspacePhase('result');
    setResultTab('outputs');
    session?.updateDraft({ workspacePhase: 'result' });
  }, [finalDocumentArtifact?.id]);

  useEffect(() => {
    const saved = readTopics(session?.state.topics);
    if (saved.length > 0) {
      setTopics(saved);
      advanceTo(2);
      return;
    }
    const generated = readTopics(topicsArtifact?.metadata.topics);
    if (generated.length === 0) return;
    setTopics(generated);
    setSelectedTopicId(current => generated.some(topic => topic.id === current) ? current : '');
    advanceTo(2);
  }, [topicsArtifact?.id]);

  useEffect(() => {
    const saved = readString(session?.state.outline);
    if (saved) {
      setOutline(saved);
      advanceTo(3);
      return;
    }
    const generated = readString(outlineArtifact?.metadata.outline);
    if (!generated) return;
    setOutline(generated);
    advanceTo(3);
  }, [outlineArtifact?.id]);

  useEffect(() => {
    if (session === null || articleArtifact === undefined) return;
    const saved = readString(session.state.articleMarkdown);
    if (saved) {
      setArticleMarkdown(saved);
      advanceTo(4);
      return;
    }
    let active = true;
    void readCreatorArtifactText(
      session,
      articleArtifact.id,
      'wechat-article.load-result',
      l('文章内容加载失败，请在 Agent 区域查看诊断。', 'The article failed to load. Review the diagnosis in the Agent panel.')
    )
      .then(markdown => {
        if (!active) return;
        setArticleMarkdown(markdown.trim());
        advanceTo(4);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [articleArtifact?.id, l, session?.captureCreatorFailure, session?.openArtifact]);

  useEffect(() => {
    if (!articleImageSetKey || !articleMarkdown.trim() || placedArticleImageSetRef.current === articleImageSetKey) return;
    placedArticleImageSetRef.current = articleImageSetKey;
    if (
      articleImagePlacementCustomized
      && generatedArticleImageArtifacts.every(artifact => articleMarkdown.includes(`](${articleImageMarkdownHref(artifact)})`))
    ) return;
    const nextMarkdown = insertGeneratedArticleImages(articleMarkdown, generatedArticleImageArtifacts);
    if (nextMarkdown === articleMarkdown) return;
    setArticleMarkdown(nextMarkdown);
    session?.updateDraft({ articleMarkdown: nextMarkdown });
    showToast(l('配图已插入正文对应位置', 'Images were inserted into the relevant article sections.'), 'success');
  }, [articleImagePlacementCustomized, articleImageSetKey, articleMarkdown, generatedArticleImageArtifacts, session]);

  function advanceTo(step: ArticleStep) {
    setCurrentStep(previous => Math.max(previous, step) as ArticleStep);
    setFurthestStep(previous => Math.max(previous, step) as ArticleStep);
  }

  function openStep(step: ArticleStep) {
    if (step > furthestStep) return;
    setCurrentStep(step);
    session?.updateDraft({ currentStep: step, furthestStep: Math.max(furthestStep, step) });
  }

  function updateArticleEditorPart(partIndex: number, markdown: string) {
    const nextMarkdown = articleEditorParts
      .map((part, index) => index === partIndex && part.kind === 'text' ? markdown : part.markdown)
      .join('');
    setArticleMarkdown(nextMarkdown);
    session?.updateDraft({ articleMarkdown: nextMarkdown });
  }

  function rememberArticleEditorSelection(partIndex: number, offset: number) {
    activeArticleSelectionRef.current = { partIndex, offset };
  }

  function openArticleImagePicker(intent?: ArticleImageUploadIntent) {
    if (uploadingArticleImage) return;
    if (intent !== undefined) {
      articleImageUploadIntentRef.current = intent;
    } else {
      const activeSelection = activeArticleSelectionRef.current;
      if (activeSelection !== undefined && articleEditorParts[activeSelection.partIndex]?.kind === 'text') {
        articleImageUploadIntentRef.current = { mode: 'insert', ...activeSelection };
      } else {
        let partIndex = articleEditorParts.length - 1;
        while (partIndex > 0 && articleEditorParts[partIndex]?.kind !== 'text') partIndex -= 1;
        const part = articleEditorParts[partIndex];
        articleImageUploadIntentRef.current = {
          mode: 'insert',
          partIndex: Math.max(0, partIndex),
          offset: part?.kind === 'text' ? part.markdown.length : articleMarkdown.length
        };
      }
    }
    if (articleImageInputRef.current !== null) articleImageInputRef.current.value = '';
    articleImageInputRef.current?.click();
  }

  async function uploadArticleImage(file: File) {
    if (session === null || uploadingArticleImage) return;
    const intent = articleImageUploadIntentRef.current;
    if (intent === undefined) return;
    setUploadingArticleImage(true);
    try {
      const artifact = await session.uploadArticleImage(file);
      const fileName = readString(artifact.metadata.fileName);
      if (!fileName) throw new Error('Uploaded article image has no file name');
      const alt = imageAltFromFileName(readString(artifact.metadata.originalFileName) || file.name, l);
      const imageMarkdown = `![${alt}](./${fileName})`;
      let nextMarkdown = articleEditorParts.map((part, index) => {
        if (index !== intent.partIndex) return part.markdown;
        if (intent.mode === 'replace' && part.kind === 'image') return imageMarkdown;
        if (intent.mode !== 'insert' || part.kind !== 'text') return part.markdown;
        return insertMarkdownImageAt(part.markdown, intent.offset, imageMarkdown);
      }).join('');
      if (intent.mode === 'insert' && articleEditorParts[intent.partIndex]?.kind !== 'text') {
        nextMarkdown = insertMarkdownImageAt(articleMarkdown, articleMarkdown.length, imageMarkdown);
      }
      const replacedArtifact = intent.mode === 'replace'
        ? articleImageArtifacts.find(candidate => candidate.id === intent.artifactId)
        : undefined;
      const replacingGeneratedImage = replacedArtifact !== undefined
        && replacedArtifact.metadata.source !== 'local-upload';
      const hiddenIds = replacingGeneratedImage
        ? [...new Set([...hiddenArticleImageArtifactIds, replacedArtifact.id])]
        : hiddenArticleImageArtifactIds;
      const nextManualIds = intent.mode === 'replace'
        && replacedArtifact?.metadata.source === 'local-upload'
        && !nextMarkdown.includes(`](${intent.href})`)
        ? [...new Set([...manualArticleImageArtifactIds.filter(id => id !== replacedArtifact.id), artifact.id])]
        : undefined;
      setArticleMarkdown(nextMarkdown);
      session.updateDraft({
        articleMarkdown: nextMarkdown,
        hiddenArticleImageArtifactIds: hiddenIds,
        ...(nextManualIds === undefined ? {} : { manualArticleImageArtifactIds: nextManualIds })
      });
      showToast(intent.mode === 'replace'
        ? l('图片已替换', 'Image replaced.')
        : l('图片已插入正文', 'Image inserted into the article.'), 'success');
    } catch (cause) {
      session.captureCreatorFailure('wechat-article.upload-image', cause, formatArticleImageUploadError(cause, l), 'upload');
    } finally {
      setUploadingArticleImage(false);
      articleImageUploadIntentRef.current = undefined;
    }
  }

  function removeArticleImage(partIndex: number, artifactId: string, href: string) {
    const nextMarkdown = articleEditorParts
      .map((part, index) => index === partIndex && part.kind === 'image' ? '' : part.markdown)
      .join('')
      .replace(/\n{3,}/gu, '\n\n');
    const artifact = articleImageArtifacts.find(candidate => candidate.id === artifactId);
    const hiddenIds = artifact?.metadata.source === 'local-upload'
      ? hiddenArticleImageArtifactIds
      : [...new Set([...hiddenArticleImageArtifactIds, artifactId])];
    const nextManualIds = artifact?.metadata.source === 'local-upload'
      && !nextMarkdown.includes(`](${href})`)
      ? manualArticleImageArtifactIds.filter(id => id !== artifactId)
      : manualArticleImageArtifactIds;
    setArticleMarkdown(nextMarkdown);
    session?.updateDraft({
      articleMarkdown: nextMarkdown,
      hiddenArticleImageArtifactIds: hiddenIds,
      manualArticleImageArtifactIds: nextManualIds
    });
    showToast(l('图片已从正文移除', 'Image removed from the article.'), 'success');
  }

  function moveArticleImage(targetPartIndex: number, offset: number) {
    const sourcePartIndex = draggedArticleImagePartRef.current;
    const sourcePart = sourcePartIndex === undefined ? undefined : articleEditorParts[sourcePartIndex];
    const targetPart = articleEditorParts[targetPartIndex];
    if (sourcePart?.kind !== 'image' || targetPart?.kind !== 'text') return;
    const nextMarkdown = articleEditorParts.map((part, index) => {
      if (index === sourcePartIndex) return '';
      if (index === targetPartIndex) return insertMarkdownImageAt(part.markdown, offset, sourcePart.markdown);
      return part.markdown;
    }).join('').replace(/\n{3,}/gu, '\n\n');
    setArticleMarkdown(nextMarkdown);
    session?.updateDraft({
      articleMarkdown: nextMarkdown,
      articleImagePlacementCustomized: true
    });
    draggedArticleImagePartRef.current = undefined;
    setDraggedArticleImagePartIndex(undefined);
    setArticleImageDropTarget(undefined);
    showToast(l('图片位置已更新', 'Image position updated.'), 'success');
  }

  function addSourceLink() {
    setError('');
    let url: URL;
    try {
      url = new URL(urlInput.trim());
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error();
    } catch {
      setError(l('请输入有效的网页或视频链接', 'Enter a valid webpage or video URL.'));
      return;
    }
    if (sourceLinks.some(link => link.url === url.toString())) {
      setError(l('这个链接已经添加过了', 'This URL has already been added.'));
      return;
    }
    if (sourceLimitReached) {
      setError(l(`内容灵感最多添加 ${wechatArticleSourceLimit} 个`, `You can add up to ${wechatArticleSourceLimit} inspiration sources.`));
      return;
    }
    const kind = isVideoUrl(url) ? 'video' : 'webpage';
    const next = [...sourceLinks, {
      id: createId('source'),
      url: url.toString(),
      kind,
      label: url.hostname
    } satisfies WechatArticleSourceLink];
    setSourceLinks(next);
    setUrlInput('');
    session?.updateDraft({ sourceLinks: next });
  }

  function removeSourceLink(id: string) {
    const next = sourceLinks.filter(link => link.id !== id);
    setSourceLinks(next);
    session?.updateDraft({ sourceLinks: next });
  }

  function removeDocument(id: string) {
    const next = selectedDocumentIds.filter(artifactId => artifactId !== id);
    session?.updateDraft({ sourceDocumentArtifactIds: next });
  }

  async function uploadDocuments(files: FileList | File[] | null) {
    if (session === null || files === null || files.length === 0) return;
    const selectedFiles = Array.from(files);
    if (selectedFiles.length > remainingSourceCount) {
      setError(remainingSourceCount === 0
        ? l(`内容灵感最多添加 ${wechatArticleSourceLimit} 个`, `You can add up to ${wechatArticleSourceLimit} inspiration sources.`)
        : l(`还可以添加 ${remainingSourceCount} 个内容灵感，请减少本次选择的文件`, `You can add ${remainingSourceCount} more inspiration sources. Select fewer files.`));
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    setUploading(true);
    setError('');
    setToast(null);
    try {
      for (const file of selectedFiles) await session.uploadSourceDocument(file);
      showToast(l('文件已加入内容灵感', 'Files added to inspiration.'), 'success');
    } catch (cause) {
      session.captureCreatorFailure('wechat-article.upload-document', cause, formatDocumentUploadError(cause, l), 'upload');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function openFilePicker() {
    if (fileInputRef.current === null || sourceLimitReached || uploading) return;
    fileInputRef.current.value = '';
    fileInputRef.current.click();
  }

  function showToast(message: string, _tone: 'success') {
    toastIdRef.current += 1;
    setToast({ id: toastIdRef.current, message });
  }

  async function continueFromInspiration() {
    if (session === null || uploading || running) return;
    setError('');
    if (sourceCount === 0) {
      const next = Math.max(furthestStep, 1) as ArticleStep;
      setCurrentStep(1);
      setFurthestStep(next);
      session.updateDraft({ currentStep: 1, furthestStep: next });
      return;
    }
    setTopics([]);
    setSelectedTopicId('');
    setOutline('');
    setArticleMarkdown('');
    pendingSourceParseRef.current = true;
    const started = await runStage('sources', {
      sourceLinks,
      sourceDocumentArtifactIds: selectedDocumentIds,
      topics: [],
      selectedTopicId: '',
      outline: '',
      articleMarkdown: '',
      currentStep: 0
    });
    if (!started) pendingSourceParseRef.current = false;
  }

  async function continueFromBrief() {
    setError('');
    if (!writingPrompt.trim() && sourceLinks.length === 0 && documentArtifacts.length === 0) {
      setError(l('没有内容灵感时，请至少填写一个写作主题或要求', 'Add a writing topic or instruction when no inspiration is provided.'));
      return;
    }
    session?.updateDraft({ writingPrompt, topicCount, presetId, layoutStyleId, templatePrompt });
    const next = Math.max(furthestStep, 2) as ArticleStep;
    setFurthestStep(next);
    setCurrentStep(2);
    await generateTopics();
  }

  async function runStage(stageId: 'sources' | 'topics' | 'outline' | 'article' | 'images' | 'document', patch: Record<string, CreatorJson>): Promise<boolean> {
    if (session === null || running) return false;
    setError('');
    session.updateDraft(patch, { semantic: true });
    try {
      await session.flush();
      await session.applyAction({ actor: 'user', action: 'run-stage', input: { stageId } });
      return true;
    } catch {
      return false;
    }
  }

  async function generateTopics() {
    if (!writingPrompt.trim() && sourceLinks.length === 0 && documentArtifacts.length === 0) {
      setError(l('请填写写作主题，或添加至少一个内容灵感', 'Enter a writing topic or add at least one inspiration source.'));
      openStep(1);
      return;
    }
    setTopics([]);
    setSelectedTopicId('');
    setOutline('');
    setArticleMarkdown('');
    await runStage('topics', {
      sourceLinks,
      writingPrompt: writingPrompt.trim(),
      topicCount,
      presetId,
      templatePrompt: templatePrompt.trim(),
      topics: [],
      selectedTopicId: '',
      outline: '',
      articleMarkdown: '',
      currentStep: 2,
      furthestStep: Math.max(furthestStep, 2)
    });
  }

  async function generateOutline() {
    if (selectedTopic === undefined) {
      setError(l('请先选择一个选题', 'Select a topic first.'));
      return;
    }
    const nextFurthestStep = Math.max(furthestStep, 3) as ArticleStep;
    setCurrentStep(3);
    setFurthestStep(nextFurthestStep);
    setOutline('');
    setArticleMarkdown('');
    await runStage('outline', {
      topics,
      selectedTopicId,
      outline: '',
      articleMarkdown: '',
      currentStep: 3,
      furthestStep: nextFurthestStep
    });
  }

  async function generateArticle() {
    if (!outline.trim()) {
      setError(l('请先确认文章大纲', 'Review the article outline first.'));
      return;
    }
    setArticleMarkdown('');
    await runStage('article', {
      topics,
      selectedTopicId,
      outline: outline.trim(),
      writingPrompt: writingPrompt.trim(),
      presetId,
      layoutStyleId,
      templatePrompt: templatePrompt.trim(),
      articleMarkdown: '',
      currentStep: 4,
      furthestStep: Math.max(furthestStep, 4)
    });
  }

  async function generateArticleImages() {
    if (!articleMarkdown.trim() || !autoGenerateImages || running) return;
    const started = await runStage('images', {
      articleMarkdown: articleMarkdown.trim(),
      autoGenerateImages,
      articleImageCount,
      articleImageStyleId,
      articleImagePlacementCustomized: false,
      currentStep: 4,
      furthestStep: Math.max(furthestStep, 4)
    });
    if (started) {
      showToast(l(`正在生成 ${articleImageCount} 张配图`, `Generating ${articleImageCount} article images.`), 'success');
    }
  }

  function updateArticleImageCount(value: number) {
    const next = Math.max(1, Math.min(10, Math.round(value)));
    setArticleImageCount(next);
    session?.updateDraft({ articleImageCount: next });
  }

  function updateAutoGenerateImages(enabled: boolean) {
    setAutoGenerateImages(enabled);
    session?.updateDraft({ autoGenerateImages: enabled });
  }

  function selectArticleImageStyle(id: WechatArticleImageStyleId) {
    setArticleImageStyleId(id);
    session?.updateDraft({ articleImageStyleId: id });
  }

  function updateTopic(id: string, field: keyof Pick<WechatArticleTopic, 'title' | 'angle' | 'summary'>, value: string) {
    const next = topics.map(topic => topic.id === id ? { ...topic, [field]: value } : topic);
    setTopics(next);
    session?.updateDraft({ topics: next });
  }

  function selectPreset(id: WechatArticlePresetId) {
    const preset = wechatArticlePresets.find(candidate => candidate.id === id)!;
    session?.clearError();
    setPresetId(id);
    setTemplatePrompt(preset.instructions);
    session?.updateDraft({ presetId: id, templatePrompt: preset.instructions });
  }

  function clearPreset() {
    session?.clearError();
    setPresetId('');
    setPreviewPresetId('');
    setTemplatePrompt('');
    session?.updateDraft({ presetId: '', templatePrompt: '' });
  }

  function openTemplateLibrary() {
    updateTemplateLibraryAnchor();
    setPreviewPresetId(presetId);
    setTemplateQuery('');
    setTemplateTopFilter('popular');
    setTemplateCategory('all');
    setTemplateLibraryOpen(true);
  }

  function updateTemplateLibraryAnchor() {
    const rect = templateLibraryAnchorRef.current?.getBoundingClientRect();
    if (rect === undefined || rect.width <= 0) return;
    const left = Math.max(18, Math.round(rect.left));
    setTemplateLibraryAnchor({
      left,
      width: Math.max(320, Math.min(Math.round(rect.width), window.innerWidth - left - 18))
    });
  }

  function usePreviewPreset() {
    if (previewPreset === undefined) return;
    selectPreset(previewPreset.id);
    setTemplateLibraryOpen(false);
  }

  function selectTemplateTopFilter(id: ArticleTemplateTopFilter) {
    setTemplateTopFilter(id);
    setTemplateCategory('all');
    setTemplateQuery('');
  }

  function selectInlineTemplateTopFilter(id: ArticleTemplateTopFilter) {
    selectTemplateTopFilter(templateTopFilter === id ? 'all' : id);
  }

  function selectLayoutStyle(id: WechatArticleLayoutStyleId) {
    setLayoutStyleId(id);
    session?.updateDraft({ layoutStyleId: id });
  }

  async function copyMarkdown() {
    const preview = articlePreviewRef.current;
    if (preview === null || copyingArticle) return;
    setCopyingArticle(true);
    try {
      const result = await copyRichContent(preview, articleMarkdown);
      if (result === 'rich') {
        showToast(l('图文和排版已复制，可直接粘贴', 'Article content, images, and styling copied.'), 'success');
      } else if (result === 'plain') {
        showToast(l('当前浏览器不支持复制图文，已复制 Markdown', 'Rich copy is unavailable; Markdown was copied instead.'), 'success');
      } else {
        session?.captureCreatorFailure(
          'wechat-article.copy-result',
          new Error('clipboard_copy_failed'),
          l('复制失败，请手动选择正文。', 'Copy failed. Select the article manually.'),
          'client'
        );
      }
    } catch (cause) {
      session?.captureCreatorFailure(
        'wechat-article.copy-result',
        cause,
        l('复制失败，请手动选择正文。', 'Copy failed. Select the article manually.'),
        'client'
      );
    } finally {
      setCopyingArticle(false);
    }
  }

  async function generateDocument() {
    if (!articleMarkdown.trim() || running) return;
    setWorkspacePhase('result');
    setResultTab('outputs');
    await runStage('document', {
      articleMarkdown,
      layoutStyleId,
      workspacePhase: 'result',
      currentStep: 5,
      furthestStep: 5
    });
  }

  async function downloadDocument(artifact: CreatorArtifact) {
    if (session === null || typeof URL.createObjectURL !== 'function') return;
    setError('');
    try {
      const url = await createCreatorArtifactObjectUrl(
        session,
        artifact.id,
        'wechat-article.download-document',
        l('文档下载失败，请在 Agent 区域查看诊断。', 'The document download failed. Review the diagnosis in the Agent panel.')
      );
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = readString(artifact.metadata.fileName)
        || `${safeFileName(selectedTopic?.title || l('公众号文章', 'wechat-article'))}.md`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showToast(l('文档已开始下载', 'The document download has started.'), 'success');
    } catch (cause) {
      session.captureCreatorFailure('wechat-article.download-document', cause, l('文档下载失败，请重试。', 'The document download failed. Try again.'));
    }
  }

  async function downloadArticleImage(artifact: CreatorArtifact) {
    if (session === null || typeof URL.createObjectURL !== 'function') return;
    try {
      const existingUrl = articleImageUrls[artifact.id];
      let temporaryUrl = '';
      if (!existingUrl) {
        temporaryUrl = await createCreatorArtifactObjectUrl(
          session,
          artifact.id,
          'wechat-article.download-image',
          l('配图下载失败，请在 Agent 区域查看诊断。', 'The image download failed. Review the diagnosis in the Agent panel.')
        );
      }
      const anchor = document.createElement('a');
      anchor.href = existingUrl || temporaryUrl;
      anchor.download = readString(artifact.metadata.fileName) || `article-image-${readNumber(artifact.metadata.imageIndex) || 1}.png`;
      anchor.click();
      if (temporaryUrl) window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 0);
    } catch (cause) {
      session.captureCreatorFailure('wechat-article.download-image', cause, l('配图下载失败，请重试。', 'The image download failed. Try again.'));
    }
  }

  function adjustArticle() {
    setWorkspacePhase('compose');
    setCurrentStep(4);
    setFurthestStep(5);
    setResultTab('outputs');
    knownDocumentArtifactIdRef.current = finalDocumentArtifact?.id;
    session?.updateDraft({ workspacePhase: 'compose', currentStep: 4, furthestStep: 5 });
  }

  async function cancelTask() {
    if (session === null || taskControlPending !== undefined) return;
    setTaskControlPending('canceling');
    try { await session.cancelJob(); } catch { /* The session reports the failure to Agent. */ }
    finally { setTaskControlPending(undefined); }
  }

  async function resumeTask() {
    if (session === null || taskControlPending !== undefined) return;
    setTaskControlPending('resuming');
    try { await session.resumeJob(); } catch { /* The session reports the failure to Agent. */ }
    finally { setTaskControlPending(undefined); }
  }

  const context = workspacePhase === 'result'
    ? finalDocumentArtifact === undefined
      ? l('正在生成文章文档', 'Generating the article document')
      : l('文章文档与配图产出', 'Article documents and image outputs')
    : currentStep === 0
    ? l(`${sourceCount} 个内容灵感`, `${sourceCount} inspiration sources`)
    : currentStep === 1
      ? l('正在设置写作要求与模板', 'Setting the writing brief and template')
      : currentStep === 2
        ? l(`${topics.length} 个候选选题`, `${topics.length} topic options`)
        : currentStep === 3
          ? l('正在确认文章大纲', 'Reviewing the article outline')
          : currentStep === 4
            ? l('正在编辑微信公众号文章', 'Editing the WeChat article')
            : l('正在选择排版并预览成稿', 'Choosing a layout and previewing the final article');

  return (
    <CreatorToolShell
      title={l('文章写作', 'Article Writer')}
      subtitle={l('公众号、X 等平台文章', 'Articles for WeChat, X, and more')}
      context={context}
      stepLabel={workspacePhase === 'result'
        ? documentRunning
          ? l('正在生成文档', 'Generating document')
          : l('项目结果', 'Project results')
        : running
          ? l('正在生成内容', 'Generating content')
          : l(stepLabels[currentStep]![0], stepLabels[currentStep]![1])}
      currentIssue={visibleError || undefined}
      quickActions={latestStage?.status === 'failed' && (
        latestStage.errorCode === 'creator_llm_config_missing'
        || latestStage.errorCode === 'creator_image_config_missing'
      ) ? [{
        id: 'open-ai-services',
        label: latestStage.errorCode === 'creator_llm_config_missing'
          ? l('打开文本模型设置', 'Open text model settings')
          : l('打开图像生成设置', 'Open image generation settings'),
        kind: 'action',
        onAction: () => { window.location.hash = latestStage.errorCode === 'creator_llm_config_missing'
          ? '#/settings?tab=ai-services&section=text'
          : '#/settings?tab=ai-services&section=image'; }
      }] : undefined}
      suggestions={[l('选题更有观点一些', 'Make the topics more opinionated'), l('让文章更简洁', 'Make the article more concise')]}
      placeholder={props.promptHint ?? l('描述文章主题、读者和表达要求', 'Describe the topic, audience, and writing style')}
      onBack={props.onBack}
      onCancelTask={() => void cancelTask()}
      onResumeTask={() => void resumeTask()}
      taskControlPending={taskControlPending}
      contentClassName="wechat-article-workspace-content"
    >
      <div className="creator-tool-stack wechat-article-stack" data-phase={workspacePhase} data-step={currentStep}>
        {toast ? (
          <div className="wechat-article-toast" data-tone="success" role="status">
            <span><Check size={17} /></span>
            <div>
              <p>{toast.message}</p>
            </div>
            <button type="button" aria-label={l('关闭提示', 'Dismiss notification')} onClick={() => {
              setToast(null);
            }}><X size={15} /></button>
          </div>
        ) : null}
        {workspacePhase === 'compose' ? <nav className="video-translation-steps creator-tool-steps wechat-article-steps" aria-label={l('文章写作流程', 'Article writing workflow')}>
          <ol>
            {stepLabels.map(([zh, en], index) => {
              const active = currentStep === index;
              const completed = index < currentStep;
              return (
                <li key={zh} data-active={active} data-completed={completed}>
                  <button type="button" disabled={index > furthestStep} aria-current={active ? 'step' : undefined} onClick={() => openStep(index as ArticleStep)}>
                    <span>{completed ? <Check size={13} /> : index + 1}</span>
                    <strong>{l(zh, en)}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav> : null}

        {workspacePhase === 'compose' ? <div className="wechat-article-scroll" data-step={currentStep}>
          {currentStep === 0 ? (
            <section className="creator-tool-panel wechat-inspiration-panel">
              <div className="creator-tool-panel-heading wechat-inspiration-heading">
                <div><h2>{l('添加内容灵感', 'Add inspiration')}</h2><p>{l('添加视频、网页或本地文档，为选题和写作提供参考。也可以不添加，直接进入下一步。', 'Add videos, webpages, or local documents as writing references, or continue without them.')}</p></div>
              </div>
              <div className="wechat-inspiration-workbench">
                <aside className="wechat-inspiration-library" aria-label={l('内容灵感', 'Inspiration library')}>
                  <header>
                    <div>
                      <strong>{l('内容灵感', 'Inspiration')}</strong>
                      <span>{l('本次写作使用的全部资料', 'All references used for this article')}</span>
                    </div>
                    <b aria-label={l(`已添加 ${sourceCount} 个，最多 ${wechatArticleSourceLimit} 个`, `${sourceCount} of ${wechatArticleSourceLimit} sources added`)}>{sourceCount}/{wechatArticleSourceLimit}</b>
                  </header>
                  {sourceCount > 0 ? (
                    <div className="wechat-source-list">
                      {sourceLinks.map(link => (
                        <div key={link.id}><span><Link2 size={15} /></span><div><strong>{link.kind === 'video' ? l('视频链接', 'Video') : l('网页链接', 'Webpage')}</strong><small>{link.url}</small></div><button type="button" aria-label={l(`移除 ${link.url}`, `Remove ${link.url}`)} title={l('移除', 'Remove')} onClick={() => removeSourceLink(link.id)}><X size={16} /></button></div>
                      ))}
                      {documentArtifacts.map(artifact => {
                        const fileName = readString(artifact.metadata.fileName) || l('灵感文件', 'Inspiration file');
                        return <div key={artifact.id}><span><FileText size={15} /></span><div><strong>{fileName}</strong><small>{formatBytes(readNumber(artifact.metadata.bytes))}</small></div><button type="button" aria-label={l(`移除 ${fileName}`, `Remove ${fileName}`)} title={l('移除', 'Remove')} onClick={() => removeDocument(artifact.id)}><X size={16} /></button></div>;
                      })}
                    </div>
                  ) : <div className="wechat-empty-source"><FileText size={22} /><strong>{l('还没有内容灵感', 'No inspiration yet')}</strong><p>{l('从右侧添加链接或文件。没有资料也可以继续写作。', 'Add a link or file from the right. You can also continue without sources.')}</p></div>}
                </aside>

                <div className="wechat-inspiration-add">
                  <div className="wechat-inspiration-link-section">
                    <div><strong>{l('添加链接', 'Add a link')}</strong><span>{l('支持 YouTube、B站和普通网页', 'Supports YouTube, Bilibili, and webpages')}</span></div>
                    <label className="creator-tool-field">
                      <span>{l('视频或网页链接', 'Video or webpage URL')}</span>
                      <div className="wechat-inline-input">
                        <Link2 size={16} aria-hidden="true" />
                        <input aria-label={l('视频或网页链接', 'Video or webpage URL')} disabled={sourceLimitReached} value={urlInput} onChange={event => setUrlInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addSourceLink(); } }} placeholder="https://" />
                        <button type="button" disabled={sourceLimitReached} onClick={addSourceLink}><Plus size={16} /><span>{l('添加', 'Add')}</span></button>
                      </div>
                    </label>
                  </div>

                  <div
                    className="wechat-inspiration-dropzone"
                    data-active={sourceDragActive}
                    data-disabled={sourceLimitReached || uploading}
                    onDragEnter={event => { event.preventDefault(); if (!sourceLimitReached && !uploading) setSourceDragActive(true); }}
                    onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = sourceLimitReached || uploading ? 'none' : 'copy'; }}
                    onDragLeave={event => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSourceDragActive(false);
                    }}
                    onDrop={event => {
                      event.preventDefault();
                      setSourceDragActive(false);
                      if (!sourceLimitReached && !uploading) void uploadDocuments(event.dataTransfer.files);
                    }}
                  >
                    <span className="wechat-inspiration-drop-icon">{uploading ? <LoaderCircle className="smart-dubbing-spinner" size={22} /> : <Upload size={22} />}</span>
                    <strong>{uploading ? l('正在上传文件', 'Uploading files') : l('上传本地文件', 'Upload local files')}</strong>
                    <p>{sourceLimitReached
                      ? l('已达到 10 个内容灵感上限', 'The 10-source limit has been reached.')
                      : l('拖放文件到这里，或从电脑中选择', 'Drop files here, or choose them from your computer.')}</p>
                    <button type="button" disabled={sourceLimitReached || uploading} onClick={openFilePicker}>{l('选择文件', 'Choose files')}</button>
                    <small>{l('PDF、Markdown、TXT、HTML，单个文件不超过 25 MB', 'PDF, Markdown, TXT, or HTML, up to 25 MB each')}</small>
                  </div>

                  <div className="wechat-inspiration-capacity">
                    <span>{l(`还可以添加 ${remainingSourceCount} 个内容灵感`, `${remainingSourceCount} inspiration slots remaining`)}</span>
                    <small>{l('链接和文件合计最多 10 个', 'Links and files share the 10-source limit')}</small>
                  </div>
                  <input ref={fileInputRef} hidden multiple type="file" accept=".pdf,.txt,.md,.markdown,.html,.htm,application/pdf,text/plain,text/markdown,text/html" onChange={event => void uploadDocuments(event.target.files)} />
                </div>
              </div>
            </section>
          ) : null}

          {currentStep === 1 ? (
            <div className="wechat-brief-grid" ref={templateLibraryAnchorRef}>
              <section className="creator-tool-panel wechat-writing-brief-panel">
                <div className="creator-tool-panel-heading"><div><h2>{l('写作要求', 'Writing brief')}</h2><p>{l('说明主题、目标读者、篇幅、语气和必须覆盖的观点', 'Describe the topic, audience, length, tone, and required points.')}</p></div></div>
                <label className="creator-tool-field"><span>{l('提示词', 'Instructions')}</span><textarea rows={15} value={writingPrompt} onChange={event => { setWritingPrompt(event.target.value); session?.updateDraft({ writingPrompt: event.target.value }); }} placeholder={l('例如：面向 AI 产品经理，写一篇 2000 字左右的深度分析，重点讨论实际落地中的三个误区。', 'For example: Write a 2,000-word analysis for AI product managers, focusing on three common implementation mistakes.')} /></label>
                <label className="creator-tool-field wechat-topic-count"><span>{l('候选选题数量', 'Topic options')}</span><input type="number" min={3} max={10} value={topicCountDraft} onChange={event => setTopicCountDraft(event.target.value)} onBlur={commitTopicCount} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitTopicCount(); } }} /></label>
              </section>
              <section className="creator-tool-panel wechat-template-selection-panel">
                <div className="creator-tool-panel-heading"><div><h2>{l('写作模板', 'Writing template')}</h2><p>{l('模板负责文章结构，写作要求仍以左侧提示词为准', 'The template guides structure while the writing brief remains primary.')}</p></div></div>
                {selectedPreset ? <>
                  <div className="wechat-current-template">
                    <span><Library size={18} /></span>
                    <div>
                      <strong>{selectedPreset.name}</strong>
                      {selectedPreset.source.type === 'github' ? <small className="wechat-template-community-badge">{l('社区模板', 'Community')}</small> : null}
                      <p>{selectedPreset.description}</p>
                      <div>{selectedPreset.tags.map(tag => <i key={tag}>{tag}</i>)}</div>
                    </div>
                    <button type="button" aria-label={l('取消文章模板', 'Clear article template')} title={l('取消选择', 'Clear selection')} onClick={clearPreset}><X size={15} /></button>
                  </div>
                  <button className="wechat-template-library-trigger" type="button" onClick={openTemplateLibrary}><Library size={15} />{l('更换模板', 'Change template')}</button>
                  <details className="wechat-template-instructions">
                    <summary>{l('模板补充要求', 'Template instructions')}<ChevronDown size={15} /></summary>
                    <label className="creator-tool-field"><textarea aria-label={l('模板补充要求', 'Template instructions')} rows={8} value={templatePrompt} onChange={event => { setTemplatePrompt(event.target.value); session?.updateDraft({ templatePrompt: event.target.value }); }} /></label>
                  </details>
                </> : <>
                  <div className="wechat-template-inline-filters" role="group" aria-label={l('写作模板标签', 'Writing template tags')}>
                    {articleTemplateInlineFilters.map(filter => <button key={filter.id} type="button" aria-pressed={templateTopFilter === filter.id} data-selected={templateTopFilter === filter.id} onClick={() => selectInlineTemplateTopFilter(filter.id)}>{l(filter.zh, filter.en)}</button>)}
                  </div>
                  <div className="wechat-template-inline-list" role="group" aria-label={l('文章模板列表', 'Article template list')}>
                    {topFilteredPresets.map(preset => <button key={preset.id} type="button" onClick={() => selectPreset(preset.id)}><span><FileText size={15} /></span><div><strong>{preset.name}</strong><p>{preset.description}</p></div>{preset.source.type === 'github' ? <small>{l('社区', 'Community')}</small> : null}</button>)}
                  </div>
                  <button className="wechat-template-library-trigger" type="button" onClick={openTemplateLibrary}><Library size={15} />{l('查看全部模板', 'Browse all templates')}</button>
                </>}
              </section>
            </div>
          ) : null}

          {currentStep === 2 ? (
            <section className="creator-tool-panel wechat-topics-panel">
              <div className="creator-tool-panel-heading"><div><h2>{l('候选选题', 'Topic options')}</h2><p>{l('生成后可以直接修改标题、角度和摘要，再选择一个继续', 'Edit any title, angle, or summary, then choose one to continue.')}</p></div><button className="wechat-generate-button" type="button" disabled={running} onClick={() => void generateTopics()}>{running && latestStage?.stageId === 'topics' ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}{topics.length ? l('重新生成', 'Regenerate') : l('生成选题', 'Generate topics')}</button></div>
              {topics.length ? <div className="wechat-topic-list">{topics.map((topic, index) => <article key={topic.id} data-selected={selectedTopicId === topic.id} onClick={() => { setSelectedTopicId(topic.id); session?.updateDraft({ selectedTopicId: topic.id }); }}><header><span>{String(index + 1).padStart(2, '0')}</span><input aria-label={l('选题标题', 'Topic title')} value={topic.title} onClick={event => event.stopPropagation()} onChange={event => updateTopic(topic.id, 'title', event.target.value)} /><button type="button" aria-label={l('选择选题', 'Select topic')}><span>{selectedTopicId === topic.id ? <Check size={14} /> : null}</span></button></header><label>{l('切入角度', 'Angle')}<textarea rows={2} value={topic.angle} onClick={event => event.stopPropagation()} onChange={event => updateTopic(topic.id, 'angle', event.target.value)} /></label><label>{l('内容摘要', 'Summary')}<textarea rows={3} value={topic.summary} onClick={event => event.stopPropagation()} onChange={event => updateTopic(topic.id, 'summary', event.target.value)} /></label></article>)}</div> : <div className="wechat-generation-empty"><Sparkles size={25} /><strong>{running ? l('正在分析来源并生成选题', 'Analyzing sources and generating topics') : l('准备生成候选选题', 'Ready to generate topic options')}</strong><p>{l('默认生成 5 个方向不同、可直接编辑的选题', 'Generate five distinct, editable topic options by default.')}</p></div>}
            </section>
          ) : null}

          {currentStep === 3 ? (
            <section className="creator-tool-panel wechat-outline-panel">
              <div className="creator-tool-panel-heading"><div><h2>{l('文章大纲', 'Article outline')}</h2></div>{outline ? <button className="wechat-generate-button" type="button" disabled={running} onClick={() => void generateOutline()}><Sparkles size={16} />{l('重新生成', 'Regenerate')}</button> : null}</div>
              {outline ? <label className="creator-tool-field"><textarea aria-label={l('文章大纲编辑器', 'Article outline editor')} className="wechat-outline-editor" rows={22} value={outline} onChange={event => { setOutline(event.target.value); session?.updateDraft({ outline: event.target.value }); }} /></label> : <div className="wechat-generation-empty"><FileText size={25} /><strong>{running ? l('正在生成文章大纲', 'Generating the outline') : l('选题已确定', 'Topic selected')}</strong><p>{selectedTopic?.title}</p><button className="creator-tool-primary" type="button" disabled={running} onClick={() => void generateOutline()}>{running ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}{l('生成大纲', 'Generate outline')}</button></div>}
            </section>
          ) : null}

          {currentStep === 4 ? (
            <section className="creator-tool-panel wechat-article-panel">
              <div className="creator-tool-panel-heading"><div className="wechat-article-title-row"><h2>{l('文章正文', 'Article')}</h2>{articleMarkdown ? <span className="wechat-article-character-count">{l(`${formatNumber(articleCharacterCount)} 字`, `${formatNumber(articleCharacterCount)} characters`)}</span> : null}</div>{articleMarkdown ? <div className="wechat-article-toolbar"><button className="wechat-insert-image-button" type="button" disabled={uploadingArticleImage} onClick={() => openArticleImagePicker()}>{uploadingArticleImage ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <ImagePlus size={16} />}{l('插入图片', 'Insert image')}</button><button className="wechat-generate-button" type="button" disabled={running} onClick={() => void generateArticle()}>{running ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}{l('重新生成', 'Regenerate')}</button></div> : null}</div>
              {articleMarkdown ? <div className="wechat-article-edit-workbench">
                <div className="wechat-article-editor-pane">
                  <div className="wechat-article-editor" aria-label={l('文章正文', 'Article body')}>
                    {articleEditorParts.map((part, index) => part.kind === 'image' ? (
                      <figure
                        className="wechat-article-inline-image"
                        key={`${part.href}-${index}`}
                        data-markdown={part.markdown}
                        data-dragging={draggedArticleImagePartIndex === index}
                        draggable={!uploadingArticleImage}
                        onDragStart={event => {
                          draggedArticleImagePartRef.current = index;
                          setDraggedArticleImagePartIndex(index);
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', part.markdown);
                        }}
                        onDragEnd={() => {
                          draggedArticleImagePartRef.current = undefined;
                          setDraggedArticleImagePartIndex(undefined);
                          setArticleImageDropTarget(undefined);
                        }}
                      >
                        <img src={part.src} alt={part.alt} />
                        <div className="wechat-article-inline-image-actions">
                          <button type="button" title={l('替换图片', 'Replace image')} aria-label={l('替换图片', 'Replace image')} disabled={uploadingArticleImage} onClick={() => openArticleImagePicker({ mode: 'replace', partIndex: index, artifactId: part.artifactId, href: part.href })}><ImageUp size={15} /></button>
                          <button type="button" title={l('删除图片', 'Delete image')} aria-label={l('删除图片', 'Delete image')} onClick={() => removeArticleImage(index, part.artifactId, part.href)}><Trash2 size={15} /></button>
                        </div>
                      </figure>
                    ) : (
                      <ArticleEditorTextBlock
                        key={`text-${index}`}
                        value={part.markdown}
                        onChange={markdown => updateArticleEditorPart(index, markdown)}
                        onSelect={offset => rememberArticleEditorSelection(index, offset)}
                        imageDragging={draggedArticleImagePartIndex !== undefined}
                        imageDropTarget={articleImageDropTarget?.partIndex === index ? articleImageDropTarget : undefined}
                        trimLeadingWhitespace={articleEditorParts[index - 1]?.kind === 'image'}
                        trimTrailingWhitespace={articleEditorParts[index + 1]?.kind === 'image'}
                        onImageDragOver={target => setArticleImageDropTarget({ partIndex: index, ...target })}
                        onImageDragLeave={() => setArticleImageDropTarget(current => current?.partIndex === index ? undefined : current)}
                        onImageDrop={offset => moveArticleImage(index, offset)}
                        label={index === 0 ? l('文章正文编辑器', 'Article editor') : l(`文章正文编辑器第 ${index + 1} 段`, `Article editor section ${index + 1}`)}
                      />
                    ))}
                  </div>
                  <input ref={articleImageInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={event => { const file = event.target.files?.[0]; if (file !== undefined) void uploadArticleImage(file); }} />
                </div>
                <aside className="wechat-article-image-panel" aria-label={l('文章配图设置', 'Article image settings')}>
                  <header className="wechat-article-image-heading">
                    <div><span><ImageIcon size={16} /></span><div><strong>{l('文章配图', 'Article images')}</strong><small>{l('根据正文自动规划并生成', 'Plan and generate from the article')}</small></div></div>
                    <label className="wechat-image-toggle"><input type="checkbox" checked={autoGenerateImages} onChange={event => updateAutoGenerateImages(event.target.checked)} /><span aria-hidden="true" /></label>
                  </header>
                  <div className="wechat-article-image-settings" data-disabled={!autoGenerateImages}>
                    <div className="wechat-image-setting-block">
                      <div className="wechat-image-setting-label"><strong>{l('配图数量', 'Image count')}</strong><span>{articleImageCount}</span></div>
                      <div className="wechat-image-density" role="group" aria-label={l('配图数量档位', 'Image density')}>
                        {articleImageDensityOptions.map(option => <button key={option.id} type="button" aria-pressed={articleImageCount === option.count} data-selected={articleImageCount === option.count} disabled={!autoGenerateImages} onClick={() => updateArticleImageCount(option.count)}>{l(option.zh, option.en)}</button>)}
                      </div>
                      <div className="wechat-image-count-control">
                        <button type="button" aria-label={l('减少配图数量', 'Decrease image count')} disabled={!autoGenerateImages || articleImageCount <= 1} onClick={() => updateArticleImageCount(articleImageCount - 1)}><Minus size={14} /></button>
                        <input type="range" min={1} max={10} step={1} value={articleImageCount} disabled={!autoGenerateImages} aria-label={l('配图数量', 'Image count')} onChange={event => updateArticleImageCount(Number(event.target.value))} />
                        <button type="button" aria-label={l('增加配图数量', 'Increase image count')} disabled={!autoGenerateImages || articleImageCount >= 10} onClick={() => updateArticleImageCount(articleImageCount + 1)}><Plus size={14} /></button>
                      </div>
                    </div>
                    <div className="wechat-image-setting-block">
                      <div className="wechat-image-setting-label"><strong>{l('生图风格', 'Image style')}</strong></div>
                      <div className="wechat-image-style-grid" role="group" aria-label={l('生图风格', 'Image style')}>
                        {articleImageStyleOptions.map(style => <button key={style.id} type="button" data-style={style.id} data-selected={articleImageStyleId === style.id} aria-pressed={articleImageStyleId === style.id} disabled={!autoGenerateImages} onClick={() => selectArticleImageStyle(style.id)}><img src={style.previewSrc} alt="" aria-hidden="true" /><strong>{l(style.zh, style.en)}</strong><small>{l(style.descriptionZh, style.descriptionEn)}</small>{articleImageStyleId === style.id ? <b><Check size={11} /></b> : null}</button>)}
                      </div>
                    </div>
                    <button className="wechat-generate-images" type="button" disabled={!autoGenerateImages || imageRunning || running} onClick={() => void generateArticleImages()}>{imageRunning ? <LoaderCircle className="smart-dubbing-spinner" size={15} /> : <Sparkles size={15} />}{imageRunning ? l('正在生成配图', 'Generating images') : articleImageArtifacts.length > 0 ? l(`重新生成 ${articleImageCount} 张`, `Regenerate ${articleImageCount}`) : l(`生成 ${articleImageCount} 张配图`, `Generate ${articleImageCount} images`)}</button>
                  </div>
                </aside>
              </div> : <div className="wechat-generation-empty"><FileText size={25} /><strong>{running ? l('正在撰写文章', 'Writing the article') : l('大纲已确认', 'Outline ready')}</strong><p>{l('将按照选题、大纲、来源和文章模板生成完整正文', 'Generate the full article from the topic, outline, sources, and article template.')}</p><button className="creator-tool-primary" type="button" disabled={running} onClick={() => void generateArticle()}>{running ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}{l('开始写作', 'Write article')}</button></div>}
            </section>
          ) : null}

          {currentStep === 5 ? (
            <section className="creator-tool-panel wechat-article-panel">
              <div className="wechat-layout-workbench">
                <div className="wechat-layout-preview-pane">
                  <div className="wechat-layout-preview-heading"><h2>{l('文章预览', 'Article preview')}</h2><button type="button" disabled={!articleMarkdown || copyingArticle} onClick={() => void copyMarkdown()}>{copyingArticle ? <LoaderCircle className="smart-dubbing-spinner" size={14} /> : <Clipboard size={14} />}{copyingArticle ? l('正在复制', 'Copying') : l('复制图文', 'Copy article')}</button></div>
                  <div ref={articlePreviewRef} className="wechat-article-preview" data-layout={layoutStyleId}><MarkdownRenderer text={articleMarkdown} variant="document" resolveImageSrc={href => articleImagePreviewSources[href]} /></div>
                </div>
                <aside className="wechat-layout-sidebar" aria-label={l('排版模板', 'Layout templates')}>
                  <div className="wechat-layout-sidebar-heading"><strong>{l('排版模板', 'Layout templates')}</strong></div>
                  <div className="wechat-layout-filters" role="group" aria-label={l('排版模板分类', 'Layout template categories')}>
                    {articleLayoutCategoryOptions.map(category => (
                      <button
                        key={category.id}
                        type="button"
                        data-selected={layoutCategoryId === category.id}
                        aria-pressed={layoutCategoryId === category.id}
                        onClick={() => setLayoutCategoryId(category.id)}
                      >
                        {l(category.zh, category.en)}
                      </button>
                    ))}
                  </div>
                  <div className="wechat-layout-list">
                    {filteredLayoutStyles.map(style => (
                      <button key={style.id} type="button" data-layout={style.id} data-selected={layoutStyleId === style.id} onClick={() => selectLayoutStyle(style.id)}>
                        <WechatArticleStylePreview layout={style.id} />
                        <div className="wechat-layout-meta">
                          <strong>{style.name}</strong>
                          <small>{style.description}</small>
                          <span className="wechat-layout-features">{style.features.map(feature => <i key={feature}>{feature}</i>)}</span>
                        </div>
                        {layoutStyleId === style.id ? <span className="wechat-layout-selected"><Check size={13} /></span> : null}
                      </button>
                    ))}
                  </div>
                </aside>
              </div>
            </section>
          ) : null}

        </div> : (
          <section className="video-result-workspace wechat-result-workspace" aria-label={l('公众号文章项目产出', 'WeChat article project outputs')}>
            <div className="video-result-toolbar">
              <div className="video-result-tabs" role="tablist" aria-label={l('文章结果类型', 'Article result types')}>
                <button type="button" role="tab" aria-selected={resultTab === 'outputs'} onClick={() => setResultTab('outputs')}>
                  <PackageOpen size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('作品', 'Works')}
                </button>
                <button type="button" role="tab" aria-selected={resultTab === 'images'} onClick={() => setResultTab('images')}>
                  <ImageIcon size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('配图', 'Images')}
                </button>
                <button type="button" role="tab" aria-selected={resultTab === 'settings'} onClick={() => setResultTab('settings')}>
                  <Settings2 size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('任务设置', 'Settings')}
                </button>
              </div>
            </div>

            <div className="creator-result-layout">
              <div className="video-result-pane">
                {resultTab === 'outputs' ? (
                  <>
                    <header className="video-result-pane-heading">
                      <div>
                        <h2>{finalDocumentArtifact ? l('文章文档', 'Article documents') : l('正在生成文档', 'Generating documents')}</h2>
                        <p>{finalDocumentArtifact
                          ? l('已生成 Markdown、HTML 和 PDF，可按发布场景下载使用', 'Markdown, HTML, and PDF are ready for different publishing workflows.')
                          : l('正在整理你确认的正文和排版设置', 'Preparing the approved article and layout settings.')}</p>
                      </div>
                      <button type="button" onClick={adjustArticle}>
                        <Settings2 size={15} strokeWidth={1.8} aria-hidden="true" />
                        {l('调整文章', 'Adjust article')}
                      </button>
                    </header>

                    {finalDocumentArtifact ? (
                      <div className="wechat-result-content">
                        <div className="wechat-result-document-list">
                          {articleDocumentArtifacts.map(artifact => {
                            const format = articleDocumentFormat(artifact);
                            const formatLabel = articleDocumentFormatLabel(format);
                            return <div className="video-result-file-row" key={artifact.id}>
                              <span aria-hidden="true"><FileText size={19} strokeWidth={1.7} /></span>
                              <div>
                                <strong>{readString(artifact.metadata.fileName) || `wechat-article.${format}`}</strong>
                                <small>{formatLabel} · {formatBytes(readNumber(artifact.metadata.bytes))}</small>
                              </div>
                              <button
                                type="button"
                                onClick={() => void downloadDocument(artifact)}
                                aria-label={l(`下载 ${formatLabel} 文档`, `Download ${formatLabel} document`)}
                                title={l(`下载 ${formatLabel} 文档`, `Download ${formatLabel} document`)}
                              >
                                <Download size={16} strokeWidth={1.8} aria-hidden="true" />
                              </button>
                            </div>;
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="video-result-empty">
                        {documentRunning
                          ? <LoaderCircle className="smart-dubbing-spinner" size={26} aria-hidden="true" />
                          : <FileText size={26} strokeWidth={1.5} aria-hidden="true" />}
                        <strong>{documentRunning ? l('正在生成文章文档', 'Generating the article document') : l('尚未生成文章文档', 'No article document yet')}</strong>
                        <p>{documentRunning
                          ? l('完成后会自动显示 Markdown、HTML 和 PDF 文档', 'Markdown, HTML, and PDF will appear automatically when ready.')
                          : l('返回调整文章后可以重新生成', 'Return to the article and generate it again.')}</p>
                      </div>
                    )}
                  </>
                ) : resultTab === 'images' ? (
                  <>
                    <header className="video-result-pane-heading">
                      <div>
                        <h2>{l('文章配图', 'Article images')}</h2>
                        <p>{articleImageArtifacts.length > 0
                          ? l(`${articleImageArtifacts.length} 张配图已插入正文，也可以单独下载`, `${articleImageArtifacts.length} images are placed in the article and can be downloaded separately.`)
                          : l('当前文章没有生成或插入配图', 'This article has no generated or inserted images.')}</p>
                      </div>
                      <button type="button" onClick={adjustArticle}>
                        <Settings2 size={15} strokeWidth={1.8} aria-hidden="true" />
                        {l('调整配图', 'Adjust images')}
                      </button>
                    </header>
                    {articleImageArtifacts.length > 0 ? <section className="wechat-result-image-assets">
                      <header><div><strong>{l('全部配图', 'All images')}</strong><small>{l(`${articleImageArtifacts.length} 张可单独下载`, `${articleImageArtifacts.length} downloadable images`)}</small></div><span>{l(selectedArticleImageStyle?.zh ?? '文章配图', selectedArticleImageStyle?.en ?? 'Article images')}</span></header>
                      <div>{articleImageArtifacts.map((artifact, index) => <article key={artifact.id}>
                        <div>{articleImageUrls[artifact.id] ? <img src={articleImageUrls[artifact.id]} alt={`${l('文章配图', 'Article image')} ${index + 1}`} /> : <ImageIcon size={20} />}</div>
                        <section><strong>{readString(artifact.metadata.caption) || `${l('配图', 'Image')} ${index + 1}`}</strong><small>{readString(artifact.metadata.placementHeading) || '-'}</small></section>
                        <button type="button" aria-label={`${l('下载配图', 'Download image')} ${index + 1}`} onClick={() => void downloadArticleImage(artifact)}><Download size={15} /></button>
                      </article>)}</div>
                    </section> : <div className="video-result-empty">
                      <ImageIcon size={26} strokeWidth={1.5} aria-hidden="true" />
                      <strong>{l('暂无文章配图', 'No article images')}</strong>
                      <p>{l('返回文章编辑可以开启自动配图或手动插入图片', 'Return to article editing to generate or insert images.')}</p>
                    </div>}
                  </>
                ) : (
                  <>
                    <header className="video-result-pane-heading">
                      <div><h2>{l('当前文档设置', 'Current document settings')}</h2></div>
                      <button type="button" onClick={adjustArticle}>
                        <Settings2 size={15} strokeWidth={1.8} aria-hidden="true" />
                        {l('调整设置', 'Adjust settings')}
                      </button>
                    </header>
                    <dl className="video-result-settings">
                      <div><dt>{l('选定选题', 'Topic')}</dt><dd>{selectedTopic?.title || '-'}</dd></div>
                      <div><dt>{l('文章模板', 'Article template')}</dt><dd>{selectedPreset?.name || '-'}</dd></div>
                      <div><dt>{l('排版风格', 'Layout style')}</dt><dd>{selectedLayout?.name || '-'}</dd></div>
                      <div><dt>{l('文章配图', 'Article images')}</dt><dd>{autoGenerateImages ? l(`${articleImageArtifacts.length || articleImageCount} 张 · ${selectedArticleImageStyle?.zh ?? ''}`, `${articleImageArtifacts.length || articleImageCount} · ${selectedArticleImageStyle?.en ?? ''}`) : l('未启用', 'Disabled')}</dd></div>
                      <div><dt>{l('内容灵感', 'Inspiration')}</dt><dd>{sourceCount}</dd></div>
                      <div><dt>{l('正文字符数', 'Characters')}</dt><dd>{formatNumber([...articleMarkdown].length)}</dd></div>
                      <div><dt>{l('文档格式', 'Document formats')}</dt><dd>Markdown (.md) / HTML (.html) / PDF (.pdf)</dd></div>
                    </dl>
                  </>
                )}
              </div>

              <CreatorTaskSummary
                sourceIcon={FileText}
                sourceLabel={l('文章标题', 'Article title')}
                sourceValue={readString(finalDocumentArtifact?.metadata.title) || selectedTopic?.title || l('公众号文章', 'WeChat article')}
                items={[
                  { label: l('文章模板', 'Article template'), value: selectedPreset?.name || '-' },
                  { label: l('排版风格', 'Layout style'), value: selectedLayout?.name || '-' },
                  { label: l('文章配图', 'Article images'), value: autoGenerateImages ? l(`${articleImageArtifacts.length || articleImageCount} 张`, String(articleImageArtifacts.length || articleImageCount)) : l('未启用', 'Disabled') },
                  { label: l('正文字符数', 'Characters'), value: formatNumber(readNumber(finalDocumentArtifact?.metadata.characterCount) || [...articleMarkdown].length) },
                  { label: l('内容灵感', 'Inspiration'), value: String(sourceCount) }
                ]}
                note={finalDocumentArtifact
                  ? l('已生成可下载的 Markdown、HTML 和 PDF 文档', 'Downloadable Markdown, HTML, and PDF documents are ready.')
                  : l('文档生成完成后会自动出现在这里', 'The document will appear here when generation finishes.')}
              />
            </div>

          </section>
        )}

        {templateLibraryOpen ? createPortal(
          <div className="wechat-template-library-overlay" style={templateLibraryAnchor ? {
            '--wechat-template-library-left': `${templateLibraryAnchor.left}px`,
            '--wechat-template-library-width': `${templateLibraryAnchor.width}px`
          } as CSSProperties : undefined} onMouseDown={event => {
            if (event.target === event.currentTarget) setTemplateLibraryOpen(false);
          }}>
            <section className="wechat-template-library" role="dialog" aria-modal="true" aria-labelledby="wechat-template-library-title">
              <header>
                <div><h2 id="wechat-template-library-title">{l('文章模板库', 'Article template library')}</h2><p>{l('按写作场景查找模板，选择后仍可修改补充要求', 'Find a template by writing scenario and customize it afterward.')}</p></div>
                <button type="button" aria-label={l('关闭模板库', 'Close template library')} onClick={() => setTemplateLibraryOpen(false)}><X size={18} /></button>
              </header>
              <div className="wechat-template-top-filters" role="group" aria-label={l('模板标签', 'Template tags')}>
                {articleTemplateTopFilters.map(filter => <button key={filter.id} type="button" aria-pressed={templateTopFilter === filter.id} data-selected={templateTopFilter === filter.id} onClick={() => selectTemplateTopFilter(filter.id)}>{l(filter.zh, filter.en)}</button>)}
              </div>
              <div className="wechat-template-library-body">
                <aside className="wechat-template-categories" aria-label={l('模板分类', 'Template categories')}>
                  {articleTemplateCategories.map(category => {
                    const count = category.id === 'all'
                      ? topFilteredPresets.length
                      : topFilteredPresets.filter(preset => preset.categoryId === category.id).length;
                    return <button key={category.id} type="button" data-selected={templateCategory === category.id} onClick={() => setTemplateCategory(category.id)}><span>{l(category.zh, category.en)}</span><small>{count}</small></button>;
                  })}
                </aside>
                <div className="wechat-template-browser">
                  <label className="wechat-template-search"><Search size={16} /><input autoFocus aria-label={l('搜索文章模板', 'Search article templates')} value={templateQuery} onChange={event => setTemplateQuery(event.target.value)} placeholder={l('搜索模板、场景或关键词', 'Search templates, scenarios, or keywords')} /></label>
                  {filteredPresets.length > 0 ? <div className="wechat-template-grid">{filteredPresets.map(preset => {
                    return <button key={preset.id} type="button" data-selected={previewPreset?.id === preset.id} onClick={() => setPreviewPresetId(preset.id)}><span><FileText size={17} /></span><strong>{preset.name}</strong>{preset.source.type === 'github' ? <small className="wechat-template-community-badge">{l('社区', 'Community')}</small> : null}<p>{preset.description}</p><div>{preset.tags.slice(0, 2).map(tag => <i key={tag}>{tag}</i>)}</div>{previewPreset?.id === preset.id ? <b><Check size={13} /></b> : null}</button>;
                  })}</div> : <div className="wechat-template-empty"><Search size={22} /><strong>{l('没有匹配的模板', 'No matching templates')}</strong><p>{l('试试其他关键词或分类', 'Try another keyword or category.')}</p></div>}
                </div>
                <aside className="wechat-template-detail">
                  {previewPreset ? <>
                    <span>{l(articleTemplateCategories.find(category => category.id === previewPreset.categoryId)?.zh ?? '其他', articleTemplateCategories.find(category => category.id === previewPreset.categoryId)?.en ?? 'Other')}</span>
                    <h3>{previewPreset.name}</h3>
                    <p>{previewPreset.description}</p>
                    <div className="wechat-template-detail-tags">{previewPreset.tags.map(tag => <i key={tag}>{tag}</i>)}</div>
                    {previewPreset.source.type === 'github' ? <div className="wechat-template-source"><div><strong>{l('社区贡献', 'Community contribution')}</strong><span>{previewPreset.author}</span></div>{previewPreset.source.url ? <a href={previewPreset.source.url} target="_blank" rel="noreferrer" aria-label={l('查看模板来源', 'View template source')}><ExternalLink size={14} /></a> : null}<small>{previewPreset.source.license} · {previewPreset.version}</small></div> : null}
                    <div className="wechat-template-structure"><strong>{l('推荐结构', 'Suggested structure')}</strong><ol>{previewPreset.structure.map(item => <li key={item}>{item}</li>)}</ol></div>
                    <button type="button" onClick={usePreviewPreset}>{previewPreset.id === presetId ? l('继续使用这个模板', 'Keep using this template') : l('使用这个模板', 'Use this template')}</button>
                  </> : null}
                </aside>
              </div>
            </section>
          </div>, document.body
        ) : null}

        {workspacePhase === 'compose' ? <div className="wechat-article-footer-stack">
          <footer className="video-translation-wizard-actions wechat-article-actions">
            <button className="video-translation-secondary-action" type="button" onClick={() => currentStep === 0 ? props.onBack() : openStep((currentStep - 1) as ArticleStep)}>{currentStep === 0 ? l('返回', 'Back') : l('上一步', 'Back')}</button>
            {currentStep === 0 ? <button className="video-translation-primary-action" type="button" disabled={running || uploading} onClick={() => void continueFromInspiration()}>{running && latestStage?.stageId === 'sources' ? <LoaderCircle className="smart-dubbing-spinner" size={15} /> : null}{sourceCount > 0 ? l('解析灵感并继续', 'Parse inspiration and continue') : l('继续', 'Continue')}</button> : null}
            {currentStep === 1 ? <button className="video-translation-primary-action" type="button" disabled={running} onClick={() => void continueFromBrief()}>{l('继续生成选题', 'Continue to topics')}</button> : null}
            {currentStep === 2 && topics.length > 0 ? <button className="video-translation-primary-action" type="button" disabled={!selectedTopicId || running} onClick={() => void generateOutline()}><Sparkles size={15} />{l('生成大纲', 'Generate outline')}</button> : null}
            {currentStep === 3 && outline ? <button className="video-translation-primary-action" type="button" disabled={running} onClick={() => { setCurrentStep(4); setFurthestStep(Math.max(furthestStep, 4) as ArticleStep); void generateArticle(); }}>{l('确认大纲，开始写作', 'Approve outline and write')}</button> : null}
            {currentStep === 4 && articleMarkdown ? <button className="video-translation-primary-action" type="button" disabled={running} onClick={() => { setCurrentStep(5); setFurthestStep(5); session?.updateDraft({ currentStep: 5, furthestStep: 5 }); }}>{l('完成编辑，选择排版', 'Finish editing and choose layout')}</button> : null}
            {currentStep === 5 ? <button className="video-translation-primary-action" type="button" disabled={!articleMarkdown || running} onClick={() => void generateDocument()}>{documentRunning ? <LoaderCircle className="smart-dubbing-spinner" size={15} /> : <PackageOpen size={15} />}{documentRunning ? l('正在生成文档', 'Generating document') : l('生成文档', 'Generate document')}</button> : null}
          </footer>
        </div> : null}
      </div>
    </CreatorToolShell>
  );
}

function ArticleEditorTextBlock(props: {
  value: string;
  label: string;
  imageDragging: boolean;
  imageDropTarget?: { offset: number; top: number };
  trimLeadingWhitespace: boolean;
  trimTrailingWhitespace: boolean;
  onChange(value: string): void;
  onSelect(offset: number): void;
  onImageDragOver(target: { offset: number; top: number }): void;
  onImageDragLeave(): void;
  onImageDrop(offset: number): void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const displayed = articleEditorDisplayValue(
    props.value,
    props.trimLeadingWhitespace,
    props.trimTrailingWhitespace
  );

  useLayoutEffect(() => {
    const textarea = ref.current;
    if (textarea === null) return;
    textarea.style.height = '0px';
    textarea.style.height = `${displayed.value ? Math.max(48, textarea.scrollHeight) : 18}px`;
  }, [displayed.value]);

  return (
    <div
      className="wechat-article-editor-text-block"
      data-image-drop-active={props.imageDropTarget !== undefined}
      data-markdown={props.value}
    >
      <textarea
        ref={ref}
        className="wechat-article-editor-segment"
        data-empty={displayed.value.length === 0}
        value={displayed.value}
        onChange={event => props.onChange(`${displayed.prefix}${event.target.value}${displayed.suffix}`)}
        onClick={event => props.onSelect(displayed.prefix.length + event.currentTarget.selectionStart)}
        onKeyUp={event => props.onSelect(displayed.prefix.length + event.currentTarget.selectionStart)}
        onSelect={event => props.onSelect(displayed.prefix.length + event.currentTarget.selectionStart)}
        onDragOver={event => {
          if (!props.imageDragging) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          props.onImageDragOver(articleImageDropPoint(event.currentTarget, event.clientY));
        }}
        onDragLeave={props.onImageDragLeave}
        onDrop={event => {
          if (!props.imageDragging) return;
          event.preventDefault();
          props.onImageDrop(displayed.prefix.length + articleImageDropPoint(event.currentTarget, event.clientY).offset);
        }}
        aria-label={props.label}
      />
      {props.imageDropTarget !== undefined ? (
        <span
          className="wechat-article-image-drop-indicator"
          style={{ top: props.imageDropTarget.top }}
          aria-hidden="true"
        />
      ) : null}
    </div>
  );
}

function articleEditorDisplayValue(
  value: string,
  trimLeadingWhitespace: boolean,
  trimTrailingWhitespace: boolean
): { value: string; prefix: string; suffix: string } {
  const prefix = trimLeadingWhitespace
    ? /^(?:[ \t]*\n)+/u.exec(value)?.[0] ?? ''
    : '';
  const withoutPrefix = value.slice(prefix.length);
  const suffix = trimTrailingWhitespace
    ? /(?:\n[ \t]*)+$/u.exec(withoutPrefix)?.[0] ?? ''
    : '';
  return {
    value: withoutPrefix.slice(0, withoutPrefix.length - suffix.length),
    prefix,
    suffix
  };
}

function articleImageDropPoint(
  textarea: HTMLTextAreaElement,
  clientY: number
): { offset: number; top: number } {
  const rect = textarea.getBoundingClientRect();
  if (rect.height <= 0 || textarea.clientWidth <= 0) {
    return { offset: textarea.selectionStart, top: 0 };
  }
  const offsets = articleParagraphBoundaryOffsets(textarea.value);
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement('div');
  mirror.style.position = 'fixed';
  mirror.style.left = '-100000px';
  mirror.style.top = '0';
  mirror.style.visibility = 'hidden';
  mirror.style.pointerEvents = 'none';
  mirror.style.boxSizing = computed.boxSizing;
  mirror.style.width = `${textarea.clientWidth}px`;
  mirror.style.padding = computed.padding;
  mirror.style.border = computed.border;
  mirror.style.font = computed.font;
  mirror.style.letterSpacing = computed.letterSpacing;
  mirror.style.lineHeight = computed.lineHeight;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = computed.overflowWrap || 'break-word';
  mirror.style.wordBreak = computed.wordBreak;

  const markers: Array<{ offset: number; element: HTMLSpanElement }> = [];
  let cursor = 0;
  offsets.forEach(offset => {
    mirror.append(document.createTextNode(textarea.value.slice(cursor, offset)));
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.append(marker);
    markers.push({ offset, element: marker });
    cursor = offset;
  });
  mirror.append(document.createTextNode(textarea.value.slice(cursor)));
  document.body.append(mirror);
  const targetY = clientY - rect.top + textarea.scrollTop;
  const positions = markers.map(marker => ({
    offset: marker.offset,
    top: marker.element.offsetTop
  }));
  mirror.remove();
  const closest = positions.reduce((best, candidate) => (
    Math.abs(candidate.top - targetY) < Math.abs(best.top - targetY) ? candidate : best
  ));
  return {
    offset: closest.offset,
    top: Math.max(0, Math.min(rect.height, closest.top - textarea.scrollTop))
  };
}

function articleParagraphBoundaryOffsets(value: string): number[] {
  const offsets = new Set<number>([0, value.length]);
  for (const match of value.matchAll(/\n[ \t]*\n/gu)) {
    if (match.index !== undefined) offsets.add(match.index + match[0].length);
  }
  return [...offsets].sort((left, right) => left - right);
}

function WechatArticleStylePreview(props: { layout: WechatArticleLayoutStyleId }) {
  return (
    <span className="wechat-layout-sample" data-layout={props.layout} aria-hidden="true">
      <i className="wechat-layout-sample-kicker" />
      <i className="wechat-layout-sample-title" />
      <i className="wechat-layout-sample-lead" />
      <i className="wechat-layout-sample-heading"><b>01</b><em /></i>
      <i className="wechat-layout-sample-lines"><b /><b /><b /></i>
      <i className="wechat-layout-sample-callout"><b /><em /></i>
    </span>
  );
}

function readStep(value: CreatorJson | undefined): ArticleStep {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 5 ? value as ArticleStep : 0;
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readNumber(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function readBoolean(value: CreatorJson | undefined, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readStringArray(value: CreatorJson | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function readTopicCount(value: CreatorJson | undefined): number {
  return typeof value === 'number' ? Math.max(3, Math.min(10, Math.round(value))) : 5;
}

function readArticleImageCount(value: CreatorJson | undefined): number {
  return typeof value === 'number' ? Math.max(1, Math.min(10, Math.round(value))) : 5;
}

function readArticleImageStyle(value: CreatorJson | undefined): WechatArticleImageStyleId {
  return articleImageStyleOptions.some(style => style.id === value)
    ? value as WechatArticleImageStyleId
    : 'editorial';
}

function splitArticleEditorParts(
  markdown: string,
  imageSources: Record<string, string>,
  artifactsByHref: Record<string, CreatorArtifact>
): ArticleEditorPart[] {
  const parts: ArticleEditorPart[] = [];
  const imagePattern = /!\[([^\]\n]*)\]\(([^)\s]+)\)/gu;
  let cursor = 0;

  for (const match of markdown.matchAll(imagePattern)) {
    const href = match[2]!;
    const src = imageSources[href];
    const artifact = artifactsByHref[href];
    if (!src || artifact === undefined || match.index === undefined) continue;
    if (match.index > cursor) parts.push({ kind: 'text', markdown: markdown.slice(cursor, match.index) });
    parts.push({
      kind: 'image',
      markdown: match[0],
      alt: match[1]?.trim() || '',
      href,
      src,
      artifactId: artifact.id
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < markdown.length || parts.length === 0) {
    parts.push({ kind: 'text', markdown: markdown.slice(cursor) });
  }
  return parts;
}

function readPreset(value: CreatorJson | undefined): WechatArticlePresetId {
  const normalized = normalizeWritingTemplateId(readString(value));
  return wechatArticlePresetCatalog.some(preset => preset.id === normalized) ? normalized : '';
}

function readLayoutStyle(value: CreatorJson | undefined): WechatArticleLayoutStyleId {
  return wechatArticleLayoutStyles.some(style => style.id === value)
    ? value as WechatArticleLayoutStyleId
    : 'minimal';
}

function readWorkspacePhase(value: CreatorJson | undefined, hasDocument: boolean): ArticleWorkspacePhase {
  if (value === 'compose' || value === 'result') return value;
  return hasDocument ? 'result' : 'compose';
}

function readLinks(value: CreatorJson | undefined): WechatArticleSourceLink[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.url !== 'string') return [];
    if (item.kind !== 'video' && item.kind !== 'webpage') return [];
    return [{ id: item.id, url: item.url, kind: item.kind, label: typeof item.label === 'string' ? item.label : '' }];
  });
}

function readTopics(value: CreatorJson | undefined): WechatArticleTopic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string') return [];
    return [{ id: item.id, title: item.title, angle: typeof item.angle === 'string' ? item.angle : '', summary: typeof item.summary === 'string' ? item.summary : '' }];
  });
}

function isRecord(value: CreatorJson): value is Record<string, CreatorJson> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function latestArtifact(artifacts: CreatorArtifact[], kind: string): CreatorArtifact | undefined {
  return [...artifacts].reverse().find(artifact => artifact.kind === kind && artifact.status === 'completed');
}

function latestArticleDocuments(artifacts: CreatorArtifact[]): CreatorArtifact[] {
  const documents = artifacts.filter(artifact => artifact.kind === 'article_document' && artifact.status === 'completed');
  if (documents.length === 0) return [];
  const latestVersion = Math.max(...documents.map(artifact => readNumber(artifact.metadata.resultVersion) || artifact.version || 1));
  const formatOrder = new Map([['markdown', 0], ['html', 1], ['pdf', 2]]);
  return documents
    .filter(artifact => (readNumber(artifact.metadata.resultVersion) || artifact.version || 1) === latestVersion)
    .sort((left, right) => (
      (formatOrder.get(articleDocumentFormat(left)) ?? 99)
      - (formatOrder.get(articleDocumentFormat(right)) ?? 99)
    ));
}

function articleDocumentFormat(artifact: CreatorArtifact): string {
  const explicit = readString(artifact.metadata.documentFormat).toLowerCase();
  if (explicit) return explicit;
  const fileName = readString(artifact.metadata.fileName).toLowerCase();
  if (fileName.endsWith('.html')) return 'html';
  if (fileName.endsWith('.pdf')) return 'pdf';
  return 'markdown';
}

function articleDocumentFormatLabel(format: string): string {
  if (format === 'html') return 'HTML';
  if (format === 'pdf') return 'PDF';
  return 'Markdown';
}

function latestArticleImages(artifacts: CreatorArtifact[]): CreatorArtifact[] {
  const images = artifacts.filter(artifact => (
    artifact.kind === 'article_image'
    && artifact.status === 'completed'
    && artifact.metadata.source !== 'local-upload'
  ));
  if (images.length === 0) return [];
  const latestVersion = Math.max(...images.map(artifact => readNumber(artifact.metadata.resultVersion) || artifact.version || 1));
  return images
    .filter(artifact => (readNumber(artifact.metadata.resultVersion) || artifact.version || 1) === latestVersion)
    .sort((left, right) => readNumber(left.metadata.imageIndex) - readNumber(right.metadata.imageIndex));
}

function selectedManualArticleImages(artifacts: CreatorArtifact[], ids: string[]): CreatorArtifact[] {
  const selected = new Map(artifacts
    .filter(artifact => (
      artifact.kind === 'article_image'
      && artifact.status === 'completed'
      && artifact.metadata.source === 'local-upload'
      && ids.includes(artifact.id)
    ))
    .map(artifact => [artifact.id, artifact]));
  return ids.flatMap(id => selected.get(id) ?? []);
}

function insertMarkdownImageAt(markdown: string, requestedOffset: number, imageMarkdown: string): string {
  const offset = Math.max(0, Math.min(markdown.length, requestedOffset));
  const before = markdown.slice(0, offset);
  const after = markdown.slice(offset);
  const leadingBreak = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trailingBreak = after.length === 0 || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  return `${before}${leadingBreak}${imageMarkdown}${trailingBreak}${after}`;
}

function articleImageMarkdownHref(artifact: CreatorArtifact): string {
  const fileName = readString(artifact.metadata.fileName);
  return fileName ? `./${fileName}` : '';
}

function imageAltFromFileName(fileName: string, l: (zh: string, en: string) => string): string {
  const baseName = fileName.replace(/\.[^.]+$/u, '').trim();
  return baseName && !isOpaqueImageFileName(baseName)
    ? baseName
    : l('文章配图', 'Article image');
}

function isOpaqueImageFileName(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
    || /^[0-9a-f]{24,}$/iu.test(value);
}

function insertGeneratedArticleImages(markdown: string, artifacts: CreatorArtifact[]): string {
  const cleanMarkdown = stripGeneratedArticleImages(markdown);
  const lines = cleanMarkdown.split('\n');
  const headings = lines.flatMap((line, lineIndex) => {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    return match === null ? [] : [{ lineIndex, level: match[1]!.length, normalized: normalizeArticleHeading(match[2]!) }];
  });
  const sectionHeadings = headings.filter(heading => heading.level >= 2);
  const fallbackHeadings = sectionHeadings.length > 0 ? sectionHeadings : headings;
  const placements = new Map<number, string[]>();

  artifacts.forEach((artifact, index) => {
    const requestedHeading = normalizeArticleHeading(readString(artifact.metadata.placementHeading));
    const matchedHeading = requestedHeading
      ? headings.find(heading => heading.normalized === requestedHeading)
        ?? headings.find(heading => heading.normalized.includes(requestedHeading) || requestedHeading.includes(heading.normalized))
      : undefined;
    const fallbackIndex = fallbackHeadings.length === 0
      ? lines.length - 1
      : Math.min(fallbackHeadings.length - 1, Math.floor(index * fallbackHeadings.length / Math.max(1, artifacts.length)));
    const lineIndex = matchedHeading?.lineIndex ?? fallbackHeadings[fallbackIndex]?.lineIndex ?? lines.length - 1;
    const fileName = readString(artifact.metadata.fileName) || `article-image-${String(index + 1).padStart(2, '0')}.png`;
    const caption = sanitizeMarkdownImageAlt(readString(artifact.metadata.caption) || `文章配图 ${index + 1}`);
    const references = placements.get(lineIndex) ?? [];
    references.push(`![${caption}](./${fileName})`);
    placements.set(lineIndex, references);
  });

  const output: string[] = [];
  lines.forEach((line, lineIndex) => {
    output.push(line);
    const references = placements.get(lineIndex);
    if (references !== undefined) output.push('', ...references.flatMap(reference => [reference, '']));
  });
  return output.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function stripGeneratedArticleImages(markdown: string): string {
  return markdown
    .replace(/^[ \t]*!\[[^\]\n]*\]\((?:\.\/)?article-image-\d+\.(?:png|jpe?g|webp)\)[ \t]*$/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeArticleHeading(value: string): string {
  return value
    .replace(/^#{1,6}\s*/, '')
    .replace(/[\s*_`\[\]()（）【】《》:：,.，。!?！？-]+/g, '')
    .toLocaleLowerCase();
}

function sanitizeMarkdownImageAlt(value: string): string {
  return value.replace(/[\[\]\r\n]+/g, ' ').trim();
}

function selectedDocuments(artifacts: CreatorArtifact[], ids: string[]): CreatorArtifact[] {
  return artifacts.filter(artifact => ids.includes(artifact.id) && artifact.kind === 'source_document' && artifact.status === 'completed');
}

function isVideoUrl(url: URL): boolean {
  return /(^|\.)(youtube\.com|youtu\.be|bilibili\.com|b23\.tv)$/i.test(url.hostname);
}

function createId(prefix: string): string {
  return typeof crypto.randomUUID === 'function' ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}`;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function countArticleCharacters(markdown: string): number {
  const visibleText = markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s*(?:```|~~~).*$/gmu, '')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/^\s*(?:#{1,6}|>|[-+*]|\d+[.)])\s+/gmu, '')
    .replace(/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/gmu, '')
    .replace(/<[^>]+>/gu, '')
    .replace(/[*_~|]/gu, '')
    .replace(/\s+/gu, '');
  return [...visibleText].length;
}

function formatDocumentUploadError(
  cause: unknown,
  l: (zh: string, en: string) => string
): string {
  const candidate = cause as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : String(cause);
  if (code === 'creator_document_too_large' || /Document exceeds the \d+ byte limit/i.test(message)) {
    return l('文件不能超过 25 MB', 'The file must be 25 MB or smaller.');
  }
  if (code === 'creator_document_empty') return l('不能上传空文件', 'The file is empty.');
  if (code === 'creator_document_type_unsupported') {
    return l('仅支持 PDF、Markdown、TXT 和 HTML 文件', 'Only PDF, Markdown, TXT, and HTML files are supported.');
  }
  return l('文件上传失败，请在 Agent 区域查看诊断后重试', 'File upload failed. Review the diagnosis in the Agent panel and retry.');
}

function formatArticleImageUploadError(
  cause: unknown,
  l: (zh: string, en: string) => string
): string {
  const candidate = cause as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  const message = typeof candidate?.message === 'string' ? candidate.message : String(cause);
  if (code === 'creator_reference_too_large') {
    return l('图片不能超过 20 MB', 'The image must be 20 MB or smaller.');
  }
  if (code === 'creator_reference_empty') return l('不能上传空图片', 'The image is empty.');
  if (code === 'creator_reference_invalid' || code === 'creator_reference_type_unsupported') {
    return l('仅支持 PNG、JPG 和 WebP 图片', 'Only PNG, JPG, and WebP images are supported.');
  }
  return l('图片上传失败，请在 Agent 区域查看诊断后重试', 'Image upload failed. Review the diagnosis in the Agent panel and retry.');
}

function formatArticleStageError(
  code: string | null | undefined,
  message: string | null | undefined,
  sourceName: string,
  l: (zh: string, en: string) => string
): string {
  const target = sourceName ? `：${sourceName}` : '';
  if (code === 'creator_source_transcript_missing') {
    return l(`没有找到可用的视频字幕${target}`, `No usable video subtitles were found${sourceName ? `: ${sourceName}` : ''}.`);
  }
  if (code === 'creator_runtime_dependency_missing') {
    return l('缺少视频解析组件，暂时无法读取视频字幕', 'The video parser is unavailable, so subtitles cannot be read.');
  }
  if (code === 'creator_source_empty') {
    return l(`没有提取到可用正文${target}`, `No readable content was extracted${sourceName ? `: ${sourceName}` : ''}.`);
  }
  if (code === 'creator_source_unavailable') {
    return l(`无法读取这个内容灵感，请检查链接或文件${target}`, `This inspiration source could not be read${sourceName ? `: ${sourceName}` : ''}.`);
  }
  if (code === 'creator_image_config_missing') {
    return l('请先配置图像生成服务', 'Configure an image generation service first.');
  }
  if (code === 'image_generation_failed') {
    return l('文章配图生成失败，请检查图像服务后重试', 'Article image generation failed. Check the image service and try again.');
  }
  return l('生成失败，请在 Agent 区域查看诊断后重试', 'Generation failed. Review the diagnosis in the Agent panel and retry.');
}

function formatArticleSessionError(
  code: string | undefined,
  message: string | undefined,
  l: (zh: string, en: string) => string
): string {
  if (!message) return '';
  if (isPresetValidationError(message)) {
    return l('文章模板状态已更新，请刷新页面后重新选择', 'The article template state changed. Refresh the page and choose again.');
  }
  if (code === 'creator_revision_conflict') {
    return l('文章已在其他位置更新，请刷新后继续', 'The article changed elsewhere. Refresh before continuing.');
  }
  return l('文章操作失败，请在 Agent 区域查看诊断后重试', 'The article operation failed. Review the diagnosis in the Agent panel and retry.');
}

function isPresetValidationError(message: string): boolean {
  try {
    const issues = JSON.parse(message) as unknown;
    return Array.isArray(issues) && issues.some(issue => (
      isUnknownRecord(issue)
      && Array.isArray(issue.path)
      && issue.path.includes('presetId')
    ));
  } catch {
    return message.includes('presetId')
      && (message.includes('invalid_enum_value') || message.includes('Unknown writing template'));
  }
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeFileName(value: string): string {
  return value.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').slice(0, 80) || 'wechat-article';
}
