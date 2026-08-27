import {
  readCreatorResultSnapshots,
  type CreatorArtifact,
  type CreatorJson,
  type ImageGenerationProvider,
  type ImageGenerationQuality,
  type ImageGenerationSize
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
import { useEffect, useMemo, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

type ImageStep = 0 | 1 | 2;
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
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const restoredResults = session?.job.artifacts.some(artifact => artifact.kind === 'generated_image') === true;
  const restoredStep = readImageStep(session?.state.currentStep, restoredResults ? 2 : 0);
  const [currentStep, setCurrentStep] = useState<ImageStep>(restoredStep);
  const [furthestStep, setFurthestStep] = useState<ImageStep>(() => (
    Math.max(
      restoredStep,
      readImageStep(session?.state.furthestStep, restoredStep),
      restoredResults ? 2 : 0
    ) as ImageStep
  ));
  const [prompt, setPrompt] = useState(() => readString(session?.state.prompt));
  const [provider, setProvider] = useState<ImageGenerationProvider>(() => readProvider(session?.state.provider));
  const [size, setSize] = useState<ImageGenerationSize>(() => readSize(session?.state.size));
  const [quality, setQuality] = useState<ImageGenerationQuality>(() => readQuality(session?.state.quality));
  const [count, setCount] = useState(() => readCount(session?.state.candidateCount));
  const [resultVersion, setResultVersion] = useState<number>();
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [previewError, setPreviewError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const characterCount = useMemo(() => [...prompt.trim()].length, [prompt]);
  const selectedSize = sizes.find(item => item.value === size) ?? sizes[0]!;
  const selectedQuality = qualities.find(item => item.value === quality) ?? qualities[1]!;
  const selectedProvider = providers.find(item => item.value === provider) ?? providers[0]!;
  const resultVersions = useMemo(
    () => createImageResultVersions(session?.job.artifacts ?? [], session?.state.resultSnapshots),
    [session?.job.artifacts, session?.state.resultSnapshots]
  );
  const latestVersion = resultVersions.at(-1)?.value;
  const selectedResult = resultVersions.find(version => version.value === resultVersion)
    ?? resultVersions.at(-1);
  const latestStage = session?.job.stages.filter(stage => stage.stageId === 'generate').at(-1);
  const generating = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const runtimeError = latestStage?.status === 'failed'
    ? formatImageError({ code: latestStage.errorCode, message: latestStage.errorMessage }, l)
    : session?.error === null || session?.error === undefined
      ? ''
      : formatImageError(session.error, l);
  const visibleError = error || runtimeError || previewError;
  const resultSettings = selectedResult?.state;
  const resultSize = readSize(resultSettings?.size);
  const resultSizeOption = sizes.find(item => item.value === resultSize) ?? sizes[0]!;
  const resultProvider = providers.find(item => item.value === readProvider(resultSettings?.provider))
    ?? providers[0]!;
  const resultQuality = qualities.find(item => item.value === readQuality(resultSettings?.quality))
    ?? qualities[1]!;

  useEffect(() => {
    if (latestVersion !== undefined) setResultVersion(latestVersion);
  }, [latestVersion]);

  useEffect(() => {
    const artifacts = selectedResult?.artifacts ?? [];
    if (session === null || artifacts.length === 0) {
      setImageUrls({});
      setPreviewError('');
      return undefined;
    }
    let active = true;
    const objectUrls: string[] = [];
    setImageUrls({});
    setPreviewError('');
    void Promise.all(artifacts.map(async artifact => {
      const response = await session.openArtifact(artifact.id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      objectUrls.push(url);
      return [artifact.id, url] as const;
    })).then(entries => {
      if (active) setImageUrls(Object.fromEntries(entries));
    }).catch(cause => {
      if (active) {
        setPreviewError(l(
          '图片预览加载失败，可以稍后重试或重新生成',
          `Image previews failed to load: ${cause instanceof Error ? cause.message : String(cause)}`
        ));
      }
    });
    return () => {
      active = false;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
    };
  }, [l, selectedResult?.artifacts, session?.openArtifact]);

  useEffect(() => {
    if (latestVersion !== undefined && !generating) {
      setNotice(l('图片已生成，可以预览或下载', 'Images are ready to preview or download'));
    }
  }, [generating, l, latestVersion]);

  function openStep(step: ImageStep) {
    const nextFurthestStep = Math.max(furthestStep, step) as ImageStep;
    setCurrentStep(step);
    setFurthestStep(nextFurthestStep);
    session?.updateDraft({
      currentStep: step,
      furthestStep: nextFurthestStep
    });
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
    session?.updateDraft({ prompt: value });
    setError('');
  }

  function updateProvider(value: ImageGenerationProvider) {
    setProvider(value);
    session?.updateDraft({ provider: value });
    setError('');
  }

  function updateSize(value: ImageGenerationSize) {
    setSize(value);
    session?.updateDraft({ size: value });
    setError('');
  }

  function updateQuality(value: ImageGenerationQuality) {
    setQuality(value);
    session?.updateDraft({ quality: value });
    setError('');
  }

  function updateCount(value: number) {
    setCount(value);
    session?.updateDraft({ candidateCount: value });
    setError('');
  }

  async function generate() {
    if (generating) return;
    if (session === null) {
      setError(l(
        '图像生成服务暂不可用，请检查 Runtime 连接',
        'Image generation is unavailable. Check the Runtime connection.'
      ));
      return;
    }
    if (!prompt.trim()) {
      setError(l('请先描述需要生成的画面', 'Describe the image you want to create'));
      openStep(0);
      return;
    }
    setError('');
    setNotice('');
    session.updateDraft({
      prompt: prompt.trim(),
      provider,
      size,
      quality,
      candidateCount: count
    }, { semantic: true });
    try {
      await session.flush();
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'generate' }
      });
      setNotice(l('生成任务已提交，完成后会自动显示结果', 'Generation started. Results will appear automatically.'));
    } catch (caught) {
      setError(formatImageError(caught, l));
    }
  }

  async function download(artifact: CreatorArtifact, index: number) {
    if (session === null) return;
    try {
      const existingUrl = imageUrls[artifact.id];
      let temporaryUrl: string | undefined;
      if (existingUrl === undefined) {
        const response = await session.openArtifact(artifact.id);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        temporaryUrl = URL.createObjectURL(await response.blob());
      }
      const link = document.createElement('a');
      link.href = existingUrl ?? temporaryUrl!;
      link.download = artifactFileName(artifact, selectedResult?.value ?? 1, index + 1);
      link.click();
      if (temporaryUrl !== undefined) window.setTimeout(() => URL.revokeObjectURL(temporaryUrl), 0);
      setNotice(l(`图片 ${index + 1} 已开始下载`, `Image ${index + 1} download started`));
    } catch (caught) {
      setError(formatImageError(caught, l));
    }
  }

  function selectVersion(version: number) {
    setResultVersion(version);
    openStep(2);
    setNotice(l(`正在查看 V${version}`, `Viewing V${version}`));
  }

  function handleCommand(command: string) {
    if (/示例|sample/i.test(command)) {
      updatePrompt(l(samplePromptZh, samplePromptEn));
      openStep(0);
      return l('示例提示词已填入，可以继续设置画幅和质量。', 'The sample prompt is ready. Continue with format and quality.');
    }
    if (/横向|横版|landscape|3:2/i.test(command)) {
      updateSize('1536x1024');
      openStep(1);
      return l('画幅已改为横向 3:2。', 'Format changed to landscape 3:2.');
    }
    if (/竖向|竖版|portrait|2:3/i.test(command)) {
      updateSize('1024x1536');
      openStep(1);
      return l('画幅已改为竖向 2:3。', 'Format changed to portrait 2:3.');
    }
    if (/方形|square|1:1/i.test(command)) {
      updateSize('1024x1024');
      openStep(1);
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
      openStep(1);
      return l(
        `图像服务已改为${providerMatch.zh}。`,
        `Image provider changed to ${providerMatch.en}.`
      );
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
      context={selectedResult
        ? l(`V${selectedResult.value} · ${selectedResult.artifacts.length} 张图片`, `V${selectedResult.value} · ${selectedResult.artifacts.length} images`)
        : currentStep === 0
          ? l('正在编辑画面描述', 'Editing image description')
          : currentStep === 1
            ? `${l(selectedSize.zh, selectedSize.en)} · ${selectedSize.ratio}`
            : generating
              ? l('正在生成', 'Generating')
              : l('等待生成', 'Ready to generate')}
      initialMessage={l('描述你想生成的画面，我会帮你整理画幅、质量和输出数量。', 'Describe the image you want, then set its format, quality, and output count.')}
      suggestions={[l('填入示例提示词', 'Use a sample prompt'), l('生成横向图片', 'Create a landscape image')]}
      placeholder={props.promptHint ?? l('描述需要生成的图片', 'Describe the image to generate')}
      onBack={props.onBack}
      onCommand={handleCommand}
      pageClassName="image-generation-workspace-page"
      contentClassName="media-generation-workspace-content"
    >
      <div className="creator-tool-stack media-generation-stack">
        <nav className="video-translation-steps creator-tool-steps image-generation-steps" aria-label={l('图像生成流程', 'Image generation workflow')}>
          <ol>
            {[l('画面描述', 'Prompt'), l('生成设置', 'Settings'), l('生成图片', 'Generate')].map((label, index) => {
              const active = currentStep === index;
              const completed = index < currentStep;
              return (
                <li key={label} data-active={active} data-completed={completed}>
                  <button
                    type="button"
                    disabled={index > furthestStep}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => openStep(index as ImageStep)}
                  >
                    <span>{completed ? <Check size={13} strokeWidth={2.2} /> : index + 1}</span>
                    <strong>{label}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="media-generation-step-scroll">
          {currentStep === 0 ? (
            <section className="creator-tool-panel media-generation-prompt-panel" aria-labelledby="image-prompt-title">
              <div className="creator-tool-panel-heading">
                <div>
                  <h2 id="image-prompt-title">{l('画面描述', 'Image prompt')}</h2>
                  <p>{l('写清主体、环境、风格、光线与构图，最多 4000 字', 'Describe subject, setting, style, lighting, and composition, up to 4,000 characters')}</p>
                </div>
                <small>{characterCount} / 4000</small>
              </div>
              <label className="creator-tool-field">
                <span>{l('提示词', 'Prompt')}</span>
                <textarea
                  rows={12}
                  maxLength={4000}
                  value={prompt}
                  onChange={event => updatePrompt(event.target.value)}
                  placeholder={l('例如：一位产品设计师站在明亮的工作室中，真实摄影，柔和侧光，画面简洁', 'For example: A product designer in a bright studio, realistic photography, soft side lighting, clean composition')}
                />
              </label>
              <button className="smart-dubbing-sample" type="button" onClick={() => updatePrompt(l(samplePromptZh, samplePromptEn))}>
                <WandSparkles size={14} strokeWidth={1.8} />
                {l('填入示例提示词', 'Use sample prompt')}
              </button>
            </section>
          ) : null}

          {currentStep === 1 ? (
            <section className="creator-tool-panel" aria-labelledby="image-settings-title">
              <div className="creator-tool-panel-heading">
                <div>
                  <h2 id="image-settings-title">{l('生成设置', 'Generation settings')}</h2>
                  <p>{l('设置图片画幅、质量和一次生成数量', 'Set the image format, quality, and number of outputs')}</p>
                </div>
              </div>
              <div className="media-generation-control">
                <span>{l('图像服务', 'Image provider')}</span>
                <div className="creator-tool-segmented media-generation-provider-options" role="radiogroup" aria-label={l('图像服务', 'Image provider')}>
                  {providers.map(item => (
                    <button type="button" role="radio" aria-checked={provider === item.value} aria-selected={provider === item.value} key={item.value} onClick={() => updateProvider(item.value)}>
                      {l(item.zh, item.en)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="media-generation-control">
                <span>{l('画幅', 'Format')}</span>
                <div className="media-generation-option-grid" role="radiogroup" aria-label={l('图片画幅', 'Image format')}>
                  {sizes.map(item => (
                    <button type="button" role="radio" aria-checked={size === item.value} data-selected={size === item.value} key={item.value} onClick={() => updateSize(item.value)}>
                      <span className="media-generation-ratio-swatch" data-ratio={item.ratio} />
                      <strong>{l(item.zh, item.en)}</strong>
                      <small>{item.ratio} · {item.value}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="media-generation-control">
                <span>{l('生成质量', 'Quality')}</span>
                <div className="creator-tool-segmented" role="radiogroup" aria-label={l('图片质量', 'Image quality')}>
                  {qualities.map(item => (
                    <button type="button" role="radio" aria-checked={quality === item.value} aria-selected={quality === item.value} key={item.value} onClick={() => updateQuality(item.value)}>
                      {l(item.zh, item.en)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="media-generation-control">
                <span>{l('生成数量', 'Number of images')}</span>
                <div className="creator-tool-segmented" role="radiogroup" aria-label={l('生成数量', 'Number of images')}>
                  {[1, 2, 4].map(value => (
                    <button type="button" role="radio" aria-checked={count === value} aria-selected={count === value} key={value} onClick={() => updateCount(value)}>
                      {value} {l('张', value === 1 ? 'image' : 'images')}
                    </button>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <div className="creator-task-final-grid media-generation-final-grid">
              <section className="creator-tool-panel media-generation-output-panel" aria-labelledby="image-output-title">
                <div className="creator-tool-panel-heading">
                  <div>
                    <h2 id="image-output-title">{selectedResult ? l('生成结果', 'Generated images') : l('生成图片', 'Generate images')}</h2>
                    <p>{selectedResult ? l('查看历史版本并下载需要的方案', 'Review versions and download any image') : l('确认设置后开始生成图片', 'Review the settings, then start generating')}</p>
                  </div>
                  {selectedResult ? (
                    <CreatorResultVersionMenu
                      version={selectedResult.value}
                      versions={resultVersions.map((version, index) => ({
                        value: version.value,
                        description: index === 0
                          ? l('初次生成', 'Initial generation')
                          : l(`第 ${index + 1} 次生成`, `Generation ${index + 1}`)
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
                    <div className="media-generation-result-actions">
                      <button type="button" onClick={() => void generate()} disabled={generating}>
                        {generating ? <LoaderCircle className="smart-dubbing-spinner" size={15} /> : <RotateCcw size={15} />}
                        {generating ? l('正在生成', 'Generating') : l('重新生成', 'Regenerate')}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="smart-dubbing-ready">
                    <span><Images size={24} strokeWidth={1.6} /></span>
                    <strong>{generating ? l('正在生成图片', 'Generating images') : l('准备生成图片', 'Ready to generate images')}</strong>
                    <p>{l(
                      `${l(selectedProvider.zh, selectedProvider.en)} · ${count} 张 ${selectedSize.ratio} 图片 · ${l(selectedQuality.zh, selectedQuality.en)}质量`,
                      `${selectedProvider.en} · ${count} ${selectedSize.ratio} images · ${selectedQuality.en} quality`
                    )}</p>
                    <button className="creator-tool-primary" type="button" onClick={() => void generate()} disabled={generating}>
                      {generating ? <LoaderCircle className="smart-dubbing-spinner" size={16} /> : <Sparkles size={16} />}
                      {generating ? l('正在生成', 'Generating') : l('开始生成', 'Generate')}
                    </button>
                  </div>
                )}
              </section>
              <CreatorTaskSummary
                sourceIcon={ImageIcon}
                sourceLabel={l('画面描述', 'Prompt')}
                sourceValue={selectedResult ? readString(resultSettings?.prompt) : prompt.trim()}
                items={selectedResult ? [
                  { label: l('图像服务', 'Provider'), value: l(resultProvider.zh, resultProvider.en) },
                  { label: l('画幅', 'Format'), value: `${l(resultSizeOption.zh, resultSizeOption.en)} · ${resultSizeOption.ratio}` },
                  { label: l('分辨率', 'Resolution'), value: resultSize },
                  { label: l('质量', 'Quality'), value: l(resultQuality.zh, resultQuality.en) },
                  { label: l('当前版本', 'Version'), value: `V${selectedResult.value}` }
                ] : [
                  { label: l('图像服务', 'Provider'), value: l(selectedProvider.zh, selectedProvider.en) },
                  { label: l('画幅', 'Format'), value: `${l(selectedSize.zh, selectedSize.en)} · ${selectedSize.ratio}` },
                  { label: l('分辨率', 'Resolution'), value: size },
                  { label: l('质量', 'Quality'), value: l(selectedQuality.zh, selectedQuality.en) },
                  { label: l('生成数量', 'Images'), value: String(count) }
                ]}
              />
            </div>
          ) : null}
          {visibleError ? <p className="creator-tool-error" role="alert">{visibleError}</p> : null}
          {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        </div>

        <footer className="video-translation-wizard-actions media-generation-actions">
          <button className="video-translation-secondary-action" type="button" onClick={() => currentStep === 0 ? props.onBack() : openStep((currentStep - 1) as ImageStep)}>
            {currentStep === 0 ? l('返回', 'Back') : l('上一步', 'Back')}
          </button>
          {currentStep < 2 ? (
            <button className="video-translation-primary-action" type="button" onClick={nextStep}>
              {l('继续', 'Continue')}
            </button>
          ) : null}
        </footer>
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
      description: '生成图片',
      artifacts: versionArtifacts.sort(compareCandidates),
      state: {}
    }));
}

function readImageStep(value: CreatorJson | undefined, fallback: ImageStep): ImageStep {
  return value === 0 || value === 1 || value === 2 ? value : fallback;
}

function compareCandidates(left: CreatorArtifact, right: CreatorArtifact) {
  return readCandidate(left, left.version) - readCandidate(right, right.version);
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function readProvider(value: CreatorJson | undefined): ImageGenerationProvider {
  return value === 'jimeng' || value === 'kling' || value === 'gemini' ? value : 'openai';
}

function readSize(value: CreatorJson | undefined): ImageGenerationSize {
  return value === '1536x1024' || value === '1024x1536' ? value : '1024x1024';
}

function readQuality(value: CreatorJson | undefined): ImageGenerationQuality {
  return value === 'low' || value === 'high' ? value : 'medium';
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
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate?.code === 'string' ? candidate.code : '';
  if (code === 'creator_image_config_missing') {
    return l('请先在设置的 AI 服务中配置所选图像服务', 'Configure the selected image provider in AI Services first');
  }
  if (code === 'image_generation_failed') {
    return l('图像生成请求失败，请检查服务配置和网络后重试', 'Image generation failed. Check the service configuration and network, then retry.');
  }
  if (code === 'creator_stage_canceled') {
    return l('图像生成任务已取消', 'Image generation was canceled');
  }
  return typeof candidate?.message === 'string'
    ? candidate.message
    : error instanceof Error
      ? error.message
      : l('图片生成失败，请稍后重试', 'Image generation failed. Try again later.');
}
