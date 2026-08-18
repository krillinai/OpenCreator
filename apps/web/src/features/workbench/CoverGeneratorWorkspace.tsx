import { useEffect, useState } from 'react';
import { Download, ImagePlus, Link2, Sparkles, UploadCloud } from 'lucide-react';
import CreatorToolShell from './CreatorToolShell.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';

type CoverRatio = '16:9' | '1:1' | '9:16';

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

export default function CoverGeneratorWorkspace(props: { onBack(): void }) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const [ratio, setRatio] = useState<CoverRatio>('16:9');
  const [prompt, setPrompt] = useState(() => l(defaultPromptZh, defaultPromptEn));
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [reference, setReference] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState('');
  const [generated, setGenerated] = useState(false);
  const [notice, setNotice] = useState('');
  const canGenerate = prompt.trim().length > 0 || isValidUrl(youtubeUrl);

  useEffect(() => {
    setPrompt(current => current === defaultPromptZh || current === defaultPromptEn
      ? l(defaultPromptZh, defaultPromptEn)
      : current);
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

  function generate() {
    if (!canGenerate) {
      setNotice(l('请填写封面提示词或 YouTube 视频链接', 'Enter a thumbnail prompt or YouTube link'));
      return false;
    }
    setGenerated(true);
    setNotice(l('已生成 4 个封面方案', 'Generated 4 thumbnail options'));
    return true;
  }

  function handleCommand(command: string) {
    const foundUrl = command.match(/https?:\/\/[^\s,，。;；]+/i)?.[0];
    if (foundUrl) {
      setYoutubeUrl(foundUrl);
      if (/生成|generate/i.test(command)) {
        setGenerated(true);
        setNotice(l('已分析视频内容并生成 4 个封面方案', 'Analyzed the video and generated 4 thumbnail options'));
        return l('已读取视频主题并生成 4 个封面方案。你可以在左侧比较和下载。', 'I analyzed the video topic and generated 4 options. Compare and download them on the left.');
      }
      return l('YouTube 链接已同步，可以继续补充视觉要求或直接生成。', 'The YouTube link is synchronized. Add visual requirements or generate now.');
    }
    if (/竖版|竖屏|9:16|vertical/i.test(command)) {
      setRatio('9:16');
      return l('封面比例已切换为 9:16。', 'Thumbnail ratio changed to 9:16.');
    }
    if (/方形|1:1|square/i.test(command)) {
      setRatio('1:1');
      return l('封面比例已切换为 1:1。', 'Thumbnail ratio changed to 1:1.');
    }
    if (/横版|横屏|16:9|horizontal/i.test(command)) {
      setRatio('16:9');
      return l('封面比例已切换为 16:9。', 'Thumbnail ratio changed to 16:9.');
    }
    if (/生成封面|开始生成|生成方案|generate|create thumbnail/i.test(command)) {
      return generate() ? l('4 个封面方案已经生成，可以在左侧查看。', 'Four thumbnail options are ready on the left.') : l('请先提供主题提示词或 YouTube 链接。', 'Provide a topic prompt or YouTube link first.');
    }
    if (command.length > 8) {
      setPrompt(command);
      setGenerated(false);
      return l('视觉要求已同步到提示词。你可以继续添加参考图或直接生成。', 'Your visual requirements are synchronized with the prompt. Add a reference image or generate now.');
    }
    return l('你可以描述封面主题、选择比例，也可以发送 YouTube 链接让我从视频内容生成封面。', 'Describe the thumbnail topic and ratio, or send a YouTube link so I can use the video content.');
  }

  return (
    <CreatorToolShell
      title={l('封面生成', 'Thumbnail Generator')}
      subtitle={l('使用提示词、参考图或视频链接生成多比例封面', 'Generate thumbnails from prompts, reference images, or video links')}
      context={generated ? l(`4 个方案，${ratio}`, `4 options, ${ratio}`) : l(`等待生成，${ratio}`, `Waiting to generate, ${ratio}`)}
      initialMessage={l('告诉我封面主题和比例，也可以直接发送 YouTube 链接。我会结合视频内容与参考图生成多个方案。', 'Tell me the thumbnail topic and ratio, or send a YouTube link. I will combine the video content with any reference image to create several options.')}
      suggestions={generated ? [l('改为竖版封面', 'Switch to vertical'), l('重新生成封面', 'Regenerate thumbnails')] : [l('生成封面方案', 'Generate thumbnail options'), l('改为 16:9 横版', 'Use 16:9 horizontal')]}
      placeholder={l('描述封面，或粘贴 YouTube 链接', 'Describe a thumbnail or paste a YouTube link')}
      onBack={props.onBack}
      onCommand={handleCommand}
    >
      <div className="creator-tool-stack">
        <section className="creator-tool-panel" aria-labelledby="cover-settings-title">
          <div className="creator-tool-panel-heading"><div><h2 id="cover-settings-title">{l('封面设置', 'Thumbnail settings')}</h2><p>{l('提示词和视频链接至少填写一项，参考图可选', 'Enter a prompt or video link. A reference image is optional.')}</p></div></div>
          <div className="creator-tool-segmented cover-ratio-tabs" role="radiogroup" aria-label={l('封面比例', 'Thumbnail ratio')}>
            {(['16:9', '1:1', '9:16'] as const).map(value => (
              <button type="button" role="radio" aria-checked={ratio === value} aria-selected={ratio === value} key={value} onClick={() => { setRatio(value); setGenerated(false); }}>
                <span data-ratio={value} aria-hidden="true" />{value}
              </button>
            ))}
          </div>
          <label className="creator-tool-field"><span>{l('封面提示词', 'Thumbnail prompt')}</span><textarea rows={5} value={prompt} onChange={event => { setPrompt(event.target.value); setGenerated(false); }} placeholder={l('描述主题、标题、主体、风格和色彩', 'Describe the topic, title, subject, style, and colors')} /></label>
          <label className="creator-tool-field cover-youtube-field">
            <span>YouTube {l('链接', 'link')} <small>{l('选填', 'Optional')}</small></span>
            <div><Link2 size={16} strokeWidth={1.8} /><input type="url" value={youtubeUrl} onChange={event => { setYoutubeUrl(event.target.value); setGenerated(false); }} placeholder={l('从视频内容提取主题和关键画面', 'Extract the topic and key frames from the video')} /></div>
          </label>
          <label className="creator-tool-upload cover-reference-upload">
            <input type="file" accept="image/*" aria-label={l('上传封面参考图', 'Upload a thumbnail reference image')} onChange={event => { setReference(event.target.files?.[0] ?? null); setGenerated(false); }} />
            {reference ? (
              <><img src={referencePreview || coverImages[0]} alt={l('封面参考图', 'Thumbnail reference')} /><strong>{reference.name}</strong><span>{l('点击更换参考图', 'Click to replace the reference')}</span></>
            ) : (
              <><UploadCloud size={23} strokeWidth={1.5} /><strong>{l('添加参考图', 'Add reference image')}</strong><span>{l('选填，用于参考主体、构图或风格', 'Optional, for the subject, composition, or style')}</span></>
            )}
          </label>
          <div className="creator-tool-actions"><button className="creator-tool-primary" type="button" disabled={!canGenerate} onClick={generate}><Sparkles size={16} />{l('生成 4 个封面', 'Generate 4 thumbnails')}</button></div>
        </section>

        {generated ? (
          <section className="creator-tool-panel" aria-label={l('生成的封面方案', 'Generated thumbnail options')}>
            <div className="creator-tool-panel-heading"><div><h2>{l('封面方案', 'Thumbnail options')}</h2><p>{l('选择最接近目标的方案继续下载或调整提示词', 'Choose the closest option to download or refine the prompt')}</p></div></div>
            <div className="cover-result-grid" data-ratio={ratio}>
              {coverImages.map((image, index) => (
                <article key={image}>
                  <div><img src={image} alt={`${l('封面方案', 'Thumbnail option')} ${index + 1}`} /><span>{l('AI 创作效率', 'Create faster with AI')}<br /><small>{l('从想法到成片', 'From idea to final video')}</small></span></div>
                  <footer><strong>{l('方案', 'Option')} {index + 1}</strong><button type="button" onClick={() => setNotice(l(`封面方案 ${index + 1} 已加入下载队列`, `Thumbnail option ${index + 1} was added to the download queue`))} aria-label={`${l('下载封面方案', 'Download thumbnail option')} ${index + 1}`}><Download size={15} /></button></footer>
                </article>
              ))}
            </div>
          </section>
        ) : (
          <section className="cover-empty-state" aria-label={l('等待生成封面', 'Waiting to generate thumbnails')}><ImagePlus size={27} strokeWidth={1.4} /><strong>{l('封面方案会显示在这里', 'Thumbnail options will appear here')}</strong><p>{l('每次生成 4 个不同构图方向', 'Each run creates 4 different compositions')}</p></section>
        )}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}
