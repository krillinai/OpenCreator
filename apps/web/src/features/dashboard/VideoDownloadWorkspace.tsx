import { useMemo, useState } from 'react';
import { Check, CheckCircle2, Download, Link2, Music2, Video } from 'lucide-react';
import CreatorToolShell from './CreatorToolShell.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

type DownloadFormat = 'mp4' | 'mp3';
type DownloadStep = 0 | 1;
type DownloadResultTab = 'info' | 'formats' | 'history';

type DownloadRecord = {
  id: number;
  platform: string;
  format: DownloadFormat;
  quality: string;
};

function isValidUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function platformFor(value: string, l: ReturnType<typeof useLocalizedCopy>) {
  if (/youtu(?:\.be|be\.com)/i.test(value)) return 'YouTube';
  if (/bilibili\.com|b23\.tv/i.test(value)) return 'Bilibili';
  if (/vimeo\.com/i.test(value)) return 'Vimeo';
  return l('网页视频', 'Web video');
}

export default function VideoDownloadWorkspace(props: { onBack(): void; promptHint?: string }) {
  const l = useLocalizedCopy();
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<DownloadFormat>('mp4');
  const [quality, setQuality] = useState('1080p');
  const [analyzed, setAnalyzed] = useState(false);
  const [notice, setNotice] = useState('');
  const [currentStep, setCurrentStep] = useState<DownloadStep>(0);
  const [furthestStep, setFurthestStep] = useState<DownloadStep>(0);
  const [resultTab, setResultTab] = useState<DownloadResultTab>('formats');
  const [downloadRecords, setDownloadRecords] = useState<DownloadRecord[]>([]);
  const validUrl = isValidUrl(url);
  const platform = platformFor(url, l);
  const context = analyzed ? `${platform}, ${format.toUpperCase()} ${quality}` : l('等待解析视频链接', 'Waiting for a video link');
  const variants = useMemo(() => format === 'mp4'
    ? [
        { label: '1080p', detail: 'MP4 · H.264 · 84.6 MB' },
        { label: '720p', detail: 'MP4 · H.264 · 46.2 MB' },
        { label: '480p', detail: 'MP4 · H.264 · 24.8 MB' }
      ]
    : [
        { label: '320kbps', detail: 'MP3 · 8.4 MB' },
        { label: '192kbps', detail: 'MP3 · 5.1 MB' },
        { label: '128kbps', detail: 'MP3 · 3.6 MB' }
      ], [format]);

  function selectFormat(nextFormat: DownloadFormat) {
    setFormat(nextFormat);
    setQuality(nextFormat === 'mp4' ? '1080p' : '320kbps');
  }

  function analyze() {
    if (!validUrl) {
      setAnalyzed(false);
      setNotice(l('请输入有效的视频链接', 'Enter a valid video link'));
      return false;
    }
    setAnalyzed(true);
    setCurrentStep(1);
    setFurthestStep(1);
    setResultTab('formats');
    setNotice(l('链接解析完成，请选择下载规格', 'Link analyzed. Choose a download format.'));
    return true;
  }

  function queueDownload(label: string) {
    setDownloadRecords(current => [...current, { id: current.length + 1, platform, format, quality: label }]);
    setResultTab('history');
    setNotice(l(`${platform} ${format.toUpperCase()} ${label} 已加入下载队列`, `${platform} ${format.toUpperCase()} ${label} was added to the download queue`));
  }

  function handleCommand(command: string) {
    const foundUrl = command.match(/https?:\/\/[^\s,，。;；]+/i)?.[0];
    if (foundUrl) {
      const nextFormat: DownloadFormat = /音频|mp3/i.test(command) ? 'mp3' : 'mp4';
      const requestedQuality = command.match(/(?:1080p|720p|480p|320kbps|192kbps|128kbps)/i)?.[0];
      const nextQuality = requestedQuality ?? (nextFormat === 'mp4' ? '1080p' : '320kbps');
      setUrl(foundUrl);
      setAnalyzed(true);
      setCurrentStep(1);
      setFurthestStep(1);
      setFormat(nextFormat);
      setQuality(nextQuality);
      if (/下载|download/i.test(command)) {
        const foundPlatform = platformFor(foundUrl, l);
        setDownloadRecords(current => [...current, { id: current.length + 1, platform: foundPlatform, format: nextFormat, quality: nextQuality }]);
        setResultTab('history');
        setNotice(l(`${foundPlatform} ${nextFormat.toUpperCase()} ${nextQuality} 已加入下载队列`, `${foundPlatform} ${nextFormat.toUpperCase()} ${nextQuality} was added to the download queue`));
        return l(`已解析 ${foundPlatform} 链接，并创建 ${nextFormat.toUpperCase()} ${nextQuality} 下载任务。`, `I analyzed the ${foundPlatform} link and created a ${nextFormat.toUpperCase()} ${nextQuality} download.`);
      }
      setResultTab('formats');
      setNotice(l('链接解析完成，请选择下载规格', 'Link analyzed. Choose a download format.'));
      return l(`已识别 ${platformFor(foundUrl, l)} 链接并完成解析。你可以在左侧选择视频清晰度或 MP3 音频。`, `I recognized and analyzed the ${platformFor(foundUrl, l)} link. Choose a video quality or MP3 audio on the left.`);
    }
    if (/下载|download/i.test(command)) {
      if (!analyzed) return l('请先发送需要下载的视频链接。', 'Send the video link you want to download first.');
      const nextFormat: DownloadFormat = /音频|mp3/i.test(command) ? 'mp3' : /视频|mp4|\dp/i.test(command) ? 'mp4' : format;
      const requestedQuality = command.match(/(?:1080p|720p|480p|320kbps|192kbps|128kbps)/i)?.[0];
      const nextQuality = requestedQuality ?? (nextFormat === format ? quality : nextFormat === 'mp4' ? '1080p' : '320kbps');
      setFormat(nextFormat);
      setQuality(nextQuality);
      setDownloadRecords(current => [...current, { id: current.length + 1, platform, format: nextFormat, quality: nextQuality }]);
      setResultTab('history');
      setNotice(l(`${platform} ${nextFormat.toUpperCase()} ${nextQuality} 已加入下载队列`, `${platform} ${nextFormat.toUpperCase()} ${nextQuality} was added to the download queue`));
      return l(`已创建 ${nextFormat.toUpperCase()} ${nextQuality} 下载任务。`, `Created a ${nextFormat.toUpperCase()} ${nextQuality} download.`);
    }
    if (/音频|mp3/i.test(command)) {
      selectFormat('mp3');
      return l('已切换为 MP3 音频下载。', 'Switched to MP3 audio.');
    }
    if (/视频|mp4|1080/i.test(command)) {
      selectFormat('mp4');
      return l('已切换为 1080p MP4 视频。', 'Switched to 1080p MP4 video.');
    }
    return l('请发送 YouTube、Bilibili、Vimeo 等公开视频链接，或告诉我需要 MP4 视频还是 MP3 音频。', 'Send a public YouTube, Bilibili, or Vimeo link, and tell me whether you need MP4 video or MP3 audio.');
  }

  return (
    <CreatorToolShell
      title={l('视频下载', 'Video Downloader')}
      subtitle={l('解析公开视频并选择下载规格', 'Analyze public videos and choose a download format')}
      context={context}
      initialMessage={l('发送公开视频链接，我会解析标题、时长和可用清晰度，再由你选择下载规格。', 'Send a public video link. I will analyze its title, duration, and available qualities before you choose a format.')}
      suggestions={analyzed ? [l('下载 1080p 视频', 'Download 1080p video'), l('切换为 MP3 音频', 'Switch to MP3 audio')] : [l('链接支持哪些平台', 'Which platforms are supported?')]}
      placeholder={props.promptHint ?? l('粘贴 YouTube、Bilibili 等视频链接', 'Paste a YouTube, Bilibili, or other video link')}
      onBack={props.onBack}
      onCommand={handleCommand}
    >
      <div className="creator-tool-stack">
        <nav className="video-translation-steps creator-tool-steps creator-tool-steps-two" aria-label={l('视频下载流程', 'Video download steps')}>
          <ol>
            {[l('添加链接', 'Add link'), l('选择并下载', 'Choose and download')].map((step, index) => {
              const active = index === currentStep;
              const completed = index < currentStep;
              return (
                <li key={step} data-active={active} data-completed={completed}>
                  <button type="button" disabled={index > furthestStep} aria-current={active ? 'step' : undefined} onClick={() => setCurrentStep(index as DownloadStep)}>
                    <span>{completed ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : index + 1}</span>
                    <strong>{step}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        {currentStep === 0 ? (
          <section className="creator-tool-panel" aria-labelledby="video-download-source-title">
          <div className="creator-tool-panel-heading">
            <div><h2 id="video-download-source-title">{l('视频链接', 'Video link')}</h2><p>{l('支持 YouTube、Bilibili、Vimeo 等公开视频页面', 'Supports public YouTube, Bilibili, Vimeo, and similar video pages')}</p></div>
          </div>
          <label className="creator-tool-url-input">
            <Link2 size={17} strokeWidth={1.8} aria-hidden="true" />
            <input
              type="url"
              value={url}
              onChange={event => { setUrl(event.target.value); setAnalyzed(false); setCurrentStep(0); setFurthestStep(0); setNotice(''); }}
              placeholder={l('粘贴视频链接', 'Paste a video link')}
              aria-label={l('待下载视频链接', 'Video link to download')}
            />
            <button type="button" onClick={analyze}>{l('解析链接', 'Analyze')}</button>
          </label>
          </section>
        ) : null}

        {currentStep === 1 && analyzed ? (
          <section className="video-result-workspace download-result-workspace" aria-label={l('视频下载结果', 'Video download results')}>
            <div className="video-result-toolbar">
              <div className="video-result-tabs" role="tablist" aria-label={l('下载结果类型', 'Download result types')}>
                <button type="button" role="tab" aria-selected={resultTab === 'info'} onClick={() => setResultTab('info')}><Video size={15} strokeWidth={1.8} aria-hidden="true" />{l('视频信息', 'Video info')}</button>
                <button type="button" role="tab" aria-selected={resultTab === 'formats'} onClick={() => setResultTab('formats')}><Download size={15} strokeWidth={1.8} aria-hidden="true" />{l('下载规格', 'Formats')}</button>
                <button type="button" role="tab" aria-selected={resultTab === 'history'} onClick={() => setResultTab('history')}><CheckCircle2 size={15} strokeWidth={1.8} aria-hidden="true" />{l('下载记录', 'Downloads')}</button>
              </div>
            </div>
            <div className="creator-result-layout">

            {resultTab === 'info' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('视频信息', 'Video information')}</h2><p>{l('已完成链接解析', 'Link analysis complete')}</p></div><button type="button" onClick={() => setCurrentStep(0)}><Link2 size={15} strokeWidth={1.8} aria-hidden="true" />{l('更换链接', 'Change link')}</button></header>
                <div className="video-download-preview">
                  <img src="/dashboard/templates/video-localization.jpg" alt={l('视频封面预览', 'Video thumbnail preview')} />
                  <div><span>{platform}</span><h2>{l('OpenCreator 视频示例', 'OpenCreator video example')}</h2><p>12:48 · 1920 × 1080</p></div>
                </div>
              </div>
            ) : null}

            {resultTab === 'formats' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('下载规格', 'Download formats')}</h2><p>{l('选择视频清晰度或仅下载音频', 'Choose video quality or download audio only')}</p></div></header>
                <div className="creator-tool-segmented" role="tablist" aria-label={l('下载格式', 'Download format')}>
                  <button type="button" role="tab" aria-selected={format === 'mp4'} onClick={() => selectFormat('mp4')}><Video size={15} strokeWidth={1.8} aria-hidden="true" /> MP4 {l('视频', 'video')}</button>
                  <button type="button" role="tab" aria-selected={format === 'mp3'} onClick={() => selectFormat('mp3')}><Music2 size={15} strokeWidth={1.8} aria-hidden="true" /> MP3 {l('音频', 'audio')}</button>
                </div>
                <div className="video-download-options">
                  {variants.map((variant, index) => (
                    <label key={variant.label}>
                      <input type="radio" name="download-quality" checked={quality === variant.label} onChange={() => setQuality(variant.label)} />
                      <span><strong>{variant.label}</strong><small>{variant.detail}</small></span>
                      {index === 0 ? <small>{l('推荐', 'Recommended')}</small> : null}
                      <button type="button" onClick={() => queueDownload(variant.label)} aria-label={`${l('下载', 'Download')} ${variant.label}`}><Download size={16} strokeWidth={1.8} aria-hidden="true" /> {l('下载', 'Download')}</button>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {resultTab === 'history' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('下载记录', 'Downloads')}</h2><p>{l('当前会话创建的下载任务', 'Download tasks created in this session')}</p></div></header>
                {downloadRecords.length ? (
                  <div className="download-record-list">
                    {downloadRecords.map(record => <div className="video-result-file-row" key={record.id}><span aria-hidden="true"><Download size={18} strokeWidth={1.7} /></span><div><strong>{record.platform} {record.format.toUpperCase()} {record.quality}</strong><small>{l('已加入下载队列', 'Added to download queue')}</small></div><CheckCircle2 size={17} strokeWidth={1.8} aria-hidden="true" /></div>)}
                  </div>
                ) : <div className="video-result-empty"><Download size={26} strokeWidth={1.5} aria-hidden="true" /><strong>{l('还没有下载任务', 'No downloads yet')}</strong><button type="button" onClick={() => setResultTab('formats')}>{l('选择下载规格', 'Choose a format')}</button></div>}
              </div>
            ) : null}
              <CreatorTaskSummary
                sourceIcon={Link2}
                sourceLabel={l('视频链接', 'Video link')}
                sourceValue={url}
                items={[
                  { label: l('来源平台', 'Platform'), value: platform },
                  { label: l('下载格式', 'Format'), value: format.toUpperCase() },
                  { label: l('当前规格', 'Quality'), value: quality },
                  { label: l('下载任务', 'Downloads'), value: String(downloadRecords.length) }
                ]}
              />
            </div>
          </section>
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status"><CheckCircle2 size={15} strokeWidth={1.9} />{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}
