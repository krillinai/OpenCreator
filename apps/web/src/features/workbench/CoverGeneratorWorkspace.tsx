import { useEffect, useState } from 'react';
import { Check, Download, ImagePlus, Images, Link2, Settings2, Sparkles, UploadCloud } from 'lucide-react';
import CreatorToolShell from './CreatorToolShell.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';

type CoverRatio = '16:9' | '1:1' | '9:16';
type CoverStep = 0 | 1;
type CoverResultTab = 'options' | 'references' | 'settings';
type CoverResultVersion = {
  value: number;
  description: string;
  signature: string;
  ratio: CoverRatio;
  prompt: string;
  youtubeUrl: string;
  reference: File | null;
};

const coverImages = [
  '/workbench/templates/video-localization.jpg',
  '/workbench/templates/animated-story.jpg',
  '/workbench/templates/ai-video-insane.jpg',
  '/workbench/templates/digital-presenter.jpg'
];
const defaultPromptZh = '面向创作者的 AI 视频工作流，主体清晰，高对比标题，专业但有冲击力';
const defaultPromptEn = 'An AI video workflow for creators, with a clear subject, high-contrast title, and a professional, bold look';

function isValidUrl(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value.trim()).protocol); } catch { return false; }
}

export default function CoverGeneratorWorkspace(props: { onBack(): void; promptHint?: string }) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const [ratio, setRatio] = useState<CoverRatio>('16:9');
  const [prompt, setPrompt] = useState(() => l(defaultPromptZh, defaultPromptEn));
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [reference, setReference] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState('');
  const [notice, setNotice] = useState('');
  const [currentStep, setCurrentStep] = useState<CoverStep>(0);
  const [furthestStep, setFurthestStep] = useState<CoverStep>(0);
  const [resultTab, setResultTab] = useState<CoverResultTab>('options');
  const [resultVersion, setResultVersion] = useState(0);
  const [resultVersions, setResultVersions] = useState<CoverResultVersion[]>([]);
  const canGenerate = prompt.trim().length > 0 || isValidUrl(youtubeUrl);
  const signature = createCoverSignature({ ratio, prompt, youtubeUrl, reference });
  const selectedResult = resultVersions.find(version => version.value === resultVersion);
  const hasPendingChanges = selectedResult !== undefined && selectedResult.signature !== signature;
  const nextVersion = resultVersions.reduce((highest, version) => Math.max(highest, version.value), 0) + 1;

  useEffect(() => {
    setPrompt(current => current === defaultPromptZh || current === defaultPromptEn ? l(defaultPromptZh, defaultPromptEn) : current);
  }, [l, language]);

  useEffect(() => {
    if (!reference || typeof URL.createObjectURL !== 'function') {
      setReferencePreview('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(reference);
    setReferencePreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [reference]);

  function generate(overrides?: { youtubeUrl?: string; prompt?: string; ratio?: CoverRatio }) {
    const nextUrl = overrides?.youtubeUrl ?? youtubeUrl;
    const nextPrompt = overrides?.prompt ?? prompt;
    const nextRatio = overrides?.ratio ?? ratio;
    if (!nextPrompt.trim() && !isValidUrl(nextUrl)) {
      setNotice(l('请填写封面提示词或 YouTube 视频链接', 'Enter a thumbnail prompt or YouTube link'));
      setCurrentStep(0);
      return false;
    }
    const nextSignature = createCoverSignature({ ratio: nextRatio, prompt: nextPrompt, youtubeUrl: nextUrl, reference });
    if (selectedResult?.signature === nextSignature) {
      setCurrentStep(1);
      setFurthestStep(1);
      setResultTab('options');
      setNotice(l(`设置没有变化，继续查看 V${resultVersion}，未创建新版本。`, `Nothing changed. Continuing with V${resultVersion}; no new version was created.`));
      return true;
    }
    const version = nextVersion;
    setResultVersions(current => [...current, {
      value: version,
      description: version === 1 ? l('初次生成', 'Initial generation') : l(`基于 V${resultVersion} 调整`, `Adjusted from V${resultVersion}`),
      signature: nextSignature,
      ratio: nextRatio,
      prompt: nextPrompt,
      youtubeUrl: nextUrl,
      reference
    }]);
    setResultVersion(version);
    setResultTab('options');
    setCurrentStep(1);
    setFurthestStep(1);
    setNotice(version === 1 ? l('已生成 4 个封面方案，V1 已完成', 'Generated four thumbnail options. V1 is ready.') : l(`V${version} 已生成完成，之前的版本仍可查看`, `V${version} is ready. Previous versions remain available.`));
    return true;
  }

  function selectVersion(version: number) {
    const result = resultVersions.find(item => item.value === version);
    if (!result) return;
    setResultVersion(result.value);
    setRatio(result.ratio);
    setPrompt(result.prompt);
    setYoutubeUrl(result.youtubeUrl);
    setReference(result.reference);
    setResultTab('options');
    setCurrentStep(1);
    setFurthestStep(1);
    setNotice(l(`正在查看 V${result.value}`, `Viewing V${result.value}`));
  }

  function handleCommand(command: string) {
    const foundUrl = command.match(/https?:\/\/[^\s,，。;；]+/i)?.[0];
    if (foundUrl) {
      setYoutubeUrl(foundUrl);
      setCurrentStep(0);
      if (/生成|generate/i.test(command)) {
        generate({ youtubeUrl: foundUrl });
        return l('已读取视频主题并生成 4 个封面方案。你可以在结果页比较和下载。', 'I analyzed the video topic and generated four options. Compare and download them in the results.');
      }
      return l('YouTube 链接已同步，可以继续补充视觉要求或直接生成。', 'The YouTube link is synchronized. Add visual requirements or generate now.');
    }
    if (/竖版|竖屏|9:16|vertical/i.test(command)) {
      setRatio('9:16');
      setCurrentStep(0);
      return l('封面比例已切换为 9:16。现有结果仍保留，重新生成后会创建新版本。', 'Thumbnail ratio changed to 9:16. Existing results remain; regenerating will create a new version.');
    }
    if (/方形|1:1|square/i.test(command)) {
      setRatio('1:1');
      setCurrentStep(0);
      return l('封面比例已切换为 1:1。现有结果仍保留，重新生成后会创建新版本。', 'Thumbnail ratio changed to 1:1. Existing results remain; regenerating will create a new version.');
    }
    if (/横版|横屏|16:9|horizontal/i.test(command)) {
      setRatio('16:9');
      setCurrentStep(0);
      return l('封面比例已切换为 16:9。现有结果仍保留，重新生成后会创建新版本。', 'Thumbnail ratio changed to 16:9. Existing results remain; regenerating will create a new version.');
    }
    if (/生成封面|开始生成|生成方案|重新生成|generate|create thumbnail/i.test(command)) return generate() ? l('4 个封面方案已经生成，可以在结果页查看。', 'Four thumbnail options are ready in the results.') : l('请先提供主题提示词或 YouTube 链接。', 'Provide a topic prompt or YouTube link first.');
    if (command.length > 8) {
      setPrompt(command);
      setCurrentStep(0);
      return l('视觉要求已同步到提示词。现有结果不会被覆盖，生成后会保存为新版本。', 'Your visual requirements are synchronized. Existing results remain, and generating will save a new version.');
    }
    return l('你可以描述封面主题、选择比例，也可以发送 YouTube 链接让我从视频内容生成封面。', 'Describe the thumbnail topic and ratio, or send a YouTube link so I can use the video content.');
  }

  return (
    <CreatorToolShell
      title={l('封面生成', 'Thumbnail Generator')}
      subtitle={l('使用提示词、参考图或视频链接生成多比例封面', 'Generate thumbnails from prompts, reference images, or video links')}
      context={selectedResult ? l(`V${resultVersion}，4 个方案，${selectedResult.ratio}`, `V${resultVersion}, 4 options, ${selectedResult.ratio}`) : l(`等待生成，${ratio}`, `Waiting to generate, ${ratio}`)}
      initialMessage={l('告诉我封面主题和比例，也可以直接发送 YouTube 链接。我会结合视频内容与参考图生成多个方案。', 'Tell me the thumbnail topic and ratio, or send a YouTube link. I will combine the video content with any reference image to create several options.')}
      suggestions={selectedResult ? [l('改为竖版封面', 'Switch to vertical'), l('重新生成封面', 'Regenerate thumbnails')] : [l('生成封面方案', 'Generate thumbnail options'), l('改为 16:9 横版', 'Use 16:9 horizontal')]}
      placeholder={props.promptHint ?? l('描述封面，或粘贴 YouTube 链接', 'Describe a thumbnail or paste a YouTube link')}
      onBack={props.onBack}
      onCommand={handleCommand}
    >
      <div className="creator-tool-stack">
        <nav className="video-translation-steps creator-tool-steps creator-tool-steps-two" aria-label={l('封面生成流程', 'Thumbnail workflow')}>
          <ol>{[l('设置封面', 'Set thumbnail'), l('查看方案', 'Review options')].map((step, index) => { const active = index === currentStep; const completed = index < currentStep; return <li key={step} data-active={active} data-completed={completed}><button type="button" disabled={index > furthestStep} aria-current={active ? 'step' : undefined} onClick={() => setCurrentStep(index as CoverStep)}><span>{completed ? <Check size={13} strokeWidth={2.2} /> : index + 1}</span><strong>{step}</strong></button></li>; })}</ol>
        </nav>

        {currentStep === 0 ? (
          <section className="creator-tool-panel" aria-labelledby="cover-settings-title">
            <div className="creator-tool-panel-heading"><div><h2 id="cover-settings-title">{l('封面设置', 'Thumbnail settings')}</h2><p>{l('提示词和视频链接至少填写一项，参考图可选', 'Enter a prompt or video link. A reference image is optional.')}</p></div></div>
            <div className="creator-tool-segmented cover-ratio-tabs" role="radiogroup" aria-label={l('封面比例', 'Thumbnail ratio')}>{(['16:9', '1:1', '9:16'] as const).map(value => <button type="button" role="radio" aria-checked={ratio === value} aria-selected={ratio === value} key={value} onClick={() => setRatio(value)}><span data-ratio={value} aria-hidden="true" />{value}</button>)}</div>
            <label className="creator-tool-field"><span>{l('封面提示词', 'Thumbnail prompt')}</span><textarea rows={5} value={prompt} onChange={event => setPrompt(event.target.value)} placeholder={l('描述主题、标题、主体、风格和色彩', 'Describe the topic, title, subject, style, and colors')} /></label>
            <label className="creator-tool-field cover-youtube-field"><span>YouTube {l('链接', 'link')} <small>{l('选填', 'Optional')}</small></span><div><Link2 size={16} strokeWidth={1.8} /><input type="url" value={youtubeUrl} onChange={event => setYoutubeUrl(event.target.value)} placeholder={l('从视频内容提取主题和关键画面', 'Extract the topic and key frames from the video')} /></div></label>
            <label className="creator-tool-upload cover-reference-upload"><input type="file" accept="image/*" aria-label={l('上传封面参考图', 'Upload a thumbnail reference image')} onChange={event => setReference(event.target.files?.[0] ?? null)} />{reference ? <><img src={referencePreview || coverImages[0]} alt={l('封面参考图', 'Thumbnail reference')} /><strong>{reference.name}</strong><span>{l('点击更换参考图', 'Click to replace the reference')}</span></> : <><UploadCloud size={23} strokeWidth={1.5} /><strong>{l('添加参考图', 'Add reference image')}</strong><span>{l('选填，用于参考主体、构图或风格', 'Optional, for the subject, composition, or style')}</span></>}</label>
            {selectedResult && hasPendingChanges ? <div className="cover-version-preserved"><strong>{l(`正在基于 V${resultVersion} 调整`, `Adjusting from V${resultVersion}`)}</strong><span>{l('原来的 4 个封面方案仍保留在查看方案中', 'The original four options remain available under Review options')}</span></div> : null}
            <div className="creator-tool-actions"><button className="creator-tool-primary" type="button" disabled={!canGenerate} onClick={() => generate()}><Sparkles size={16} />{selectedResult && hasPendingChanges ? l(`生成 V${nextVersion}`, `Generate V${nextVersion}`) : l('生成 4 个封面', 'Generate 4 thumbnails')}</button></div>
          </section>
        ) : null}

        {currentStep === 1 && selectedResult ? (
          <section className="video-result-workspace cover-result-workspace" aria-label={l('封面生成项目产出', 'Thumbnail project outputs')}>
            <div className="video-result-toolbar">
              <div className="video-result-tabs" role="tablist" aria-label={l('封面结果类型', 'Thumbnail result types')}>
                <button type="button" role="tab" aria-selected={resultTab === 'options'} onClick={() => setResultTab('options')}><Images size={15} strokeWidth={1.8} />{l('封面方案', 'Options')}</button>
                <button type="button" role="tab" aria-selected={resultTab === 'references'} onClick={() => setResultTab('references')}><ImagePlus size={15} strokeWidth={1.8} />{l('参考素材', 'References')}</button>
                <button type="button" role="tab" aria-selected={resultTab === 'settings'} onClick={() => setResultTab('settings')}><Settings2 size={15} strokeWidth={1.8} />{l('任务设置', 'Task settings')}</button>
              </div>
              <CreatorResultVersionMenu version={resultVersion} versions={resultVersions.map(({ value, description }) => ({ value, description }))} onVersionChange={selectVersion} />
            </div>
            {hasPendingChanges ? <div className="stickman-version-draft" role="status"><div><strong>{l(`正在基于 V${resultVersion} 调整`, `Adjusting from V${resultVersion}`)}</strong><span>{l('当前版本的封面方案仍可查看', 'The current version remains available')}</span></div><button type="button" onClick={() => setCurrentStep(0)}>{l('继续设置', 'Continue settings')}</button></div> : null}

            {resultTab === 'options' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('封面方案', 'Thumbnail options')}</h2><p>{l(`V${resultVersion}，选择最接近目标的方案下载或继续调整`, `V${resultVersion}. Download the closest option or continue refining.`)}</p></div><button type="button" onClick={() => setCurrentStep(0)}><Settings2 size={15} />{l('调整并生成新版本', 'Adjust and create version')}</button></header>
                <div className="cover-result-grid" data-ratio={selectedResult.ratio}>{coverImages.map((image, index) => <article key={image}><div><img src={image} alt={`${l('封面方案', 'Thumbnail option')} ${index + 1}`} /><span>{l('AI 创作效率', 'Create faster with AI')}<br /><small>{l('从想法到成片', 'From idea to final video')}</small></span></div><footer><strong>{l('方案', 'Option')} {index + 1} · V{resultVersion}</strong><button type="button" onClick={() => setNotice(l(`V${resultVersion} 封面方案 ${index + 1} 已加入下载队列`, `V${resultVersion} thumbnail option ${index + 1} was added to the download queue`))} aria-label={`${l('下载封面方案', 'Download thumbnail option')} ${index + 1}`}><Download size={15} /></button></footer></article>)}</div>
              </div>
            ) : null}

            {resultTab === 'references' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('参考素材', 'Reference material')}</h2><p>{l('生成当前版本时使用的视频和图片参考', 'Video and image references used for this version')}</p></div><button type="button" onClick={() => setCurrentStep(0)}><ImagePlus size={15} />{l('更换参考素材', 'Change references')}</button></header>
                <div className="cover-reference-results">
                  {selectedResult.youtubeUrl ? <div className="video-result-file-row"><span><Link2 size={18} /></span><div><strong>YouTube {l('视频参考', 'video reference')}</strong><small>{selectedResult.youtubeUrl}</small></div></div> : null}
                  {selectedResult.reference ? <div className="video-result-file-row"><span><ImagePlus size={18} /></span><div><strong>{selectedResult.reference.name}</strong><small>{l('图片参考', 'Image reference')}</small></div></div> : null}
                  {!selectedResult.youtubeUrl && !selectedResult.reference ? <div className="video-result-empty"><ImagePlus size={26} strokeWidth={1.5} /><strong>{l('当前版本没有添加参考素材', 'No reference material in this version')}</strong><p>{l('封面仅根据提示词生成', 'The thumbnails were generated from the prompt only')}</p></div> : null}
                </div>
              </div>
            ) : null}

            {resultTab === 'settings' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('当前版本设置', 'Current version settings')}</h2><p>{l('调整后生成新版本，当前方案不会被覆盖', 'Generating after changes creates a new version without replacing this one')}</p></div><button type="button" onClick={() => setCurrentStep(0)}><Settings2 size={15} />{l('调整设置', 'Adjust settings')}</button></header>
                <dl className="video-result-settings"><div><dt>{l('封面比例', 'Thumbnail ratio')}</dt><dd>{selectedResult.ratio}</dd></div><div><dt>{l('生成数量', 'Options')}</dt><dd>4</dd></div><div><dt>YouTube {l('链接', 'link')}</dt><dd>{selectedResult.youtubeUrl || l('未添加', 'Not added')}</dd></div><div><dt>{l('参考图', 'Reference image')}</dt><dd>{selectedResult.reference?.name ?? l('未添加', 'Not added')}</dd></div><div className="cover-result-prompt-setting"><dt>{l('封面提示词', 'Thumbnail prompt')}</dt><dd>{selectedResult.prompt || l('根据视频内容生成', 'Generated from video content')}</dd></div></dl>
              </div>
            ) : null}
          </section>
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function createCoverSignature(input: { ratio: CoverRatio; prompt: string; youtubeUrl: string; reference: File | null }) {
  return JSON.stringify({ ratio: input.ratio, prompt: input.prompt.trim(), youtubeUrl: input.youtubeUrl.trim(), reference: input.reference ? { name: input.reference.name, size: input.reference.size, type: input.reference.type, lastModified: input.reference.lastModified } : null });
}
