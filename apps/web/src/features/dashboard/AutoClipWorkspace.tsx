import { useMemo, useState } from 'react';
import { Captions, Check, Download, FileVideo, ListVideo, Play, Scissors, Settings2, SlidersHorizontal, Sparkles, UploadCloud } from 'lucide-react';
import CreatorToolShell from './CreatorToolShell.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

type ClipCandidate = {
  id: number;
  title: string;
  time: string;
  duration: string;
  subtitle: string;
  scores: { hook: number; semantic: number; emotion: number; viral: number };
};
type AutoClipStep = 0 | 1 | 2;
type AutoClipResultTab = 'candidates' | 'details' | 'export' | 'settings';
type AnalysisFocus = 'balanced' | 'viral' | 'knowledge';
type ClipDuration = '15-30' | '30-60' | '60-90';
type AutoClipResultVersion = {
  value: number;
  description: string;
  signature: string;
  videoUrl: string;
  videoFile: File | null;
  focus: AnalysisFocus;
  duration: ClipDuration;
  selectedIds: number[];
};

const clips: ClipCandidate[] = [
  { id: 1, title: '创作者最容易忽略的第一步', time: '00:01:12 - 00:01:47', duration: '35s', subtitle: '很多人一开始就急着使用工具，但真正影响结果的是你有没有先定义清楚受众和目标。', scores: { hook: 94, semantic: 92, emotion: 86, viral: 91 } },
  { id: 2, title: '一个判断内容价值的方法', time: '00:03:08 - 00:03:44', duration: '36s', subtitle: '判断一个选题是否值得做，可以问自己：用户看完以后，会不会立刻改变一个动作？', scores: { hook: 91, semantic: 95, emotion: 82, viral: 90 } },
  { id: 3, title: '为什么短视频开头不能解释背景', time: '00:05:21 - 00:06:02', duration: '41s', subtitle: '开头先讲背景通常会损失观众。先抛出结果，再补充原因，信息会更容易被留下。', scores: { hook: 96, semantic: 89, emotion: 84, viral: 94 } },
  { id: 4, title: '从长内容找到高光片段', time: '00:08:15 - 00:08:58', duration: '43s', subtitle: '高光不一定是声音最大的位置，而是观点发生转折、答案突然变得清楚的那一刻。', scores: { hook: 88, semantic: 94, emotion: 89, viral: 87 } },
  { id: 5, title: '让观点更容易被记住', time: '00:11:04 - 00:11:39', duration: '35s', subtitle: '把抽象观点换成一个具体对比，观众不需要记住你的解释，也会记住那个差异。', scores: { hook: 87, semantic: 93, emotion: 80, viral: 86 } },
  { id: 6, title: '内容节奏的三个层次', time: '00:14:27 - 00:15:12', duration: '45s', subtitle: '节奏不是单纯加快语速，而是问题、答案和证据之间有没有持续推进。', scores: { hook: 85, semantic: 91, emotion: 83, viral: 84 } },
  { id: 7, title: '字幕为什么需要按语义断句', time: '00:18:09 - 00:18:46', duration: '37s', subtitle: '字幕跟着字数切会打断理解。按照语义停顿来切，观众能更快抓住每句话的重点。', scores: { hook: 84, semantic: 96, emotion: 78, viral: 83 } },
  { id: 8, title: '一个反直觉的剪辑建议', time: '00:21:31 - 00:22:03', duration: '32s', subtitle: '不是所有停顿都要删掉。关键观点前的一小段停顿，反而会让观众更注意接下来的内容。', scores: { hook: 92, semantic: 88, emotion: 87, viral: 90 } },
  { id: 9, title: '如何判断片段能够独立传播', time: '00:25:18 - 00:25:59', duration: '41s', subtitle: '把片段单独拿出来，如果观众不需要知道前文也能理解问题和结论，它才适合独立发布。', scores: { hook: 86, semantic: 97, emotion: 79, viral: 88 } },
  { id: 10, title: '最后给创作者的行动建议', time: '00:29:42 - 00:30:20', duration: '38s', subtitle: '先发布一个足够清楚的版本，再根据真实反馈调整，不要在没有观众的时候追求完美。', scores: { hook: 89, semantic: 92, emotion: 91, viral: 89 } }
];

const englishClips: Record<number, { title: string; subtitle: string }> = {
  1: { title: 'The first step creators often miss', subtitle: 'Many people rush to use tools, but defining the audience and goal first has the greatest impact on the result.' },
  2: { title: 'A way to judge content value', subtitle: 'Ask whether viewers will immediately change an action after watching to decide whether a topic is worth making.' },
  3: { title: 'Why short videos should not start with background', subtitle: 'Starting with background loses viewers. Lead with the result, then explain why.' },
  4: { title: 'Finding highlights in long content', subtitle: 'A highlight is not always the loudest moment. It is where the point turns and the answer suddenly becomes clear.' },
  5: { title: 'Make an idea easier to remember', subtitle: 'Turn an abstract point into a concrete comparison so viewers remember the difference without memorizing the explanation.' },
  6: { title: 'Three layers of content pacing', subtitle: 'Pacing is not just speaking faster. It is whether questions, answers, and evidence keep moving forward.' },
  7: { title: 'Why subtitles need semantic line breaks', subtitle: 'Breaking subtitles by character count interrupts understanding. Semantic pauses help viewers grasp each sentence.' },
  8: { title: 'A counterintuitive editing tip', subtitle: 'Not every pause should be removed. A brief pause before a key point can focus attention.' },
  9: { title: 'Can a clip stand on its own?', subtitle: 'A clip is ready to publish independently when viewers can understand the question and conclusion without prior context.' },
  10: { title: 'A final action for creators', subtitle: 'Publish a clear-enough version, then adjust from real feedback instead of chasing perfection before you have an audience.' }
};

function totalScore(clip: ClipCandidate) {
  const values = Object.values(clip.scores);
  return Math.round(values.reduce((sum, score) => sum + score, 0) / values.length);
}

function isValidUrl(value: string) {
  try { return ['http:', 'https:'].includes(new URL(value.trim()).protocol); } catch { return false; }
}

export default function AutoClipWorkspace(props: { onBack(): void; promptHint?: string }) {
  const l = useLocalizedCopy();
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [focus, setFocus] = useState<AnalysisFocus>('balanced');
  const [duration, setDuration] = useState<ClipDuration>('30-60');
  const [activeClip, setActiveClip] = useState(1);
  const [selected, setSelected] = useState<number[]>([1, 2, 3]);
  const [sort, setSort] = useState<'score' | 'time'>('score');
  const [notice, setNotice] = useState('');
  const [currentStep, setCurrentStep] = useState<AutoClipStep>(0);
  const [furthestStep, setFurthestStep] = useState<AutoClipStep>(0);
  const [resultTab, setResultTab] = useState<AutoClipResultTab>('candidates');
  const [resultVersion, setResultVersion] = useState(0);
  const [resultVersions, setResultVersions] = useState<AutoClipResultVersion[]>([]);
  const hasSource = videoFile !== null || isValidUrl(videoUrl);
  const orderedClips = useMemo(() => [...clips].sort(sort === 'score' ? (left, right) => totalScore(right) - totalScore(left) : (left, right) => left.id - right.id), [sort]);
  const currentClip = clips.find(clip => clip.id === activeClip) ?? clips[0]!;
  const selectedResult = resultVersions.find(version => version.value === resultVersion);
  const signature = createAnalysisSignature({ videoUrl, videoFile, focus, duration });
  const hasPendingChanges = selectedResult !== undefined && selectedResult.signature !== signature;
  const nextVersion = resultVersions.reduce((highest, version) => Math.max(highest, version.value), 0) + 1;
  const steps = [l('添加视频', 'Add video'), l('分析设置', 'Analysis settings'), l('选择与导出', 'Select and export')];

  function continueToSettings() {
    if (!hasSource) {
      setNotice(l('请先上传视频或填写公开视频链接', 'Upload a video or enter a public video link first'));
      return;
    }
    setCurrentStep(1);
    setFurthestStep(current => Math.max(current, 1) as AutoClipStep);
    setNotice('');
  }

  function analyze(sourceOverride?: { url: string; file: File | null }) {
    const nextUrl = sourceOverride?.url ?? videoUrl;
    const nextFile = sourceOverride?.file ?? videoFile;
    if (nextFile === null && !isValidUrl(nextUrl)) {
      setCurrentStep(0);
      setNotice(l('请先上传视频或填写公开视频链接', 'Upload a video or enter a public video link first'));
      return false;
    }
    const nextSignature = createAnalysisSignature({ videoUrl: nextUrl, videoFile: nextFile, focus, duration });
    if (selectedResult?.signature === nextSignature) {
      setCurrentStep(2);
      setFurthestStep(2);
      setResultTab('candidates');
      setNotice(l(`设置没有变化，继续查看 V${resultVersion}，未创建新版本。`, `Nothing changed. Continuing with V${resultVersion}; no new version was created.`));
      return true;
    }
    const version = nextVersion;
    const initialSelection = [1, 2, 3];
    const nextResult: AutoClipResultVersion = {
      value: version,
      description: version === 1 ? l('初次分析', 'Initial analysis') : l(`基于 V${resultVersion} 调整`, `Adjusted from V${resultVersion}`),
      signature: nextSignature,
      videoUrl: nextUrl,
      videoFile: nextFile,
      focus,
      duration,
      selectedIds: initialSelection
    };
    setResultVersions(current => [...current, nextResult]);
    setResultVersion(version);
    setSelected(initialSelection);
    setActiveClip(1);
    setSort('score');
    setResultTab('candidates');
    setCurrentStep(2);
    setFurthestStep(2);
    setNotice(version === 1 ? l('已识别字幕语义并生成 10 个候选片段，V1 已完成', 'Analyzed subtitle semantics and generated 10 candidates. V1 is ready.') : l(`V${version} 分析完成，之前的版本仍可查看`, `V${version} analysis is ready. Previous versions remain available.`));
    return true;
  }

  function toggleClip(id: number) {
    setSelected(current => {
      const next = current.includes(id) ? current.filter(item => item !== id) : [...current, id];
      setResultVersions(versions => versions.map(version => version.value === resultVersion ? { ...version, selectedIds: next } : version));
      return next;
    });
  }

  function selectVersion(version: number) {
    const result = resultVersions.find(item => item.value === version);
    if (!result) return;
    setResultVersion(result.value);
    setVideoUrl(result.videoUrl);
    setVideoFile(result.videoFile);
    setFocus(result.focus);
    setDuration(result.duration);
    setSelected(result.selectedIds);
    setActiveClip(result.selectedIds[0] ?? 1);
    setCurrentStep(2);
    setFurthestStep(2);
    setResultTab('candidates');
    setNotice(l(`正在查看 V${result.value}`, `Viewing V${result.value}`));
  }

  function exportSelected() {
    if (selected.length === 0) {
      setNotice(l('请至少选择一个片段', 'Select at least one clip'));
      return false;
    }
    setResultTab('export');
    setNotice(l(`${selected.length} 个片段已加入导出队列`, `${selected.length} clips were added to the export queue`));
    return true;
  }

  function handleCommand(command: string) {
    const foundUrl = command.match(/https?:\/\/[^\s,，。;；]+/i)?.[0];
    if (foundUrl) {
      setVideoUrl(foundUrl);
      setVideoFile(null);
      setCurrentStep(0);
      setFurthestStep(resultVersions.length ? 2 : 0);
      if (/分析|剪辑|片段|analyze|clip|edit/i.test(command)) {
        analyze({ url: foundUrl, file: null });
        return l('视频分析完成。我根据字幕语义、观点完整度和传播潜力找到了 10 个片段。', 'Video analysis is complete. I found 10 clips based on subtitle meaning, idea completeness, and sharing potential.');
      }
      return l('视频链接已同步到第一步。你可以确认分析设置后开始提取。', 'The video link is synchronized to step one. Review the analysis settings, then start extracting clips.');
    }
    if (/分析|识别|自动剪辑|analyze|auto.?clip/i.test(command)) return analyze() ? l('分析完成，候选片段和四维评分已经同步到结果页。', 'Analysis complete. Candidate clips and four scoring dimensions are now in the results.') : l('请先添加要分析的视频。', 'Add a video to analyze first.');
    if (/最高|前三|top\s*3/i.test(command)) {
      const next = [...clips].sort((a, b) => totalScore(b) - totalScore(a)).slice(0, 3).map(clip => clip.id);
      setSelected(next);
      setSort('score');
      setResultTab('candidates');
      setCurrentStep(2);
      setResultVersions(versions => versions.map(version => version.value === resultVersion ? { ...version, selectedIds: next } : version));
      return l('已选中综合评分最高的 3 个片段。', 'Selected the top 3 clips by overall score.');
    }
    if (/导出|下载|export|download/i.test(command)) {
      if (!selectedResult || selected.length === 0) return l('请先分析视频并至少选择一个片段。', 'Analyze the video and select at least one clip first.');
      exportSelected();
      return l(`已开始导出 ${selected.length} 个片段。`, `Started exporting ${selected.length} clips.`);
    }
    return l('你可以发送视频链接，让我分析高光片段、选择评分最高的片段或导出已选内容。', 'Send a video link and ask me to find highlights, select the highest-scoring clips, or export your selection.');
  }

  return (
    <CreatorToolShell
      title={l('自动剪辑', 'Auto Clips')}
      subtitle={l('理解字幕语义，从长视频提取可独立传播的片段', 'Understand subtitle semantics and extract standalone clips from long videos')}
      context={selectedResult ? l(`V${resultVersion}，10 个候选，已选 ${selected.length} 个`, `V${resultVersion}, 10 candidates, ${selected.length} selected`) : l('等待分析长视频', 'Waiting to analyze a long video')}
      initialMessage={l('上传长视频或发送链接，我会先确认分析目标，再提取 10 个候选片段，每条都提供四维评分和完整字幕。', 'Upload a long video or send a link. I will confirm the analysis goal, then extract 10 candidates with four scores and full transcripts.')}
      suggestions={selectedResult ? [l('选择评分最高的 3 个', 'Select the top 3 clips'), l('导出已选片段', 'Export selected clips')] : [l('开始分析', 'Start analysis')]}
      placeholder={props.promptHint ?? l('发送视频链接或描述剪辑要求', 'Send a video link or describe your editing requirements')}
      onBack={props.onBack}
      onCommand={handleCommand}
    >
      <div className="creator-tool-stack">
        <nav className="video-translation-steps creator-tool-steps" aria-label={l('自动剪辑流程', 'Auto clip workflow')}>
          <ol>{steps.map((step, index) => { const active = index === currentStep; const completed = index < currentStep; return <li key={step} data-active={active} data-completed={completed}><button type="button" disabled={index > furthestStep} aria-current={active ? 'step' : undefined} onClick={() => setCurrentStep(index as AutoClipStep)}><span>{completed ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : index + 1}</span><strong>{step}</strong></button></li>; })}</ol>
        </nav>

        {currentStep === 0 ? (
          <section className="creator-tool-panel auto-clip-source" aria-labelledby="auto-clip-source-title">
            <div className="creator-tool-panel-heading"><div><h2 id="auto-clip-source-title">{l('添加长视频', 'Add a long video')}</h2><p>{l('建议使用 5 分钟以上、包含清晰人声的访谈、播客或课程', 'Best for interviews, podcasts, or lessons over 5 minutes with clear speech')}</p></div></div>
            <label className="creator-tool-upload"><input type="file" accept="video/*" aria-label={l('上传待剪辑视频', 'Upload a video to edit')} onChange={event => { setVideoFile(event.target.files?.[0] ?? null); setVideoUrl(''); setNotice(''); }} />{videoFile ? <><FileVideo size={25} /><strong>{videoFile.name}</strong><span>{l('点击重新选择', 'Click to choose another')}</span></> : <><UploadCloud size={25} /><strong>{l('上传视频', 'Upload video')}</strong><span>{l('支持 MP4、MOV、WebM', 'Supports MP4, MOV, and WebM')}</span></>}</label>
            <div className="creator-tool-or"><span>{l('或', 'or')}</span></div>
            <label className="creator-tool-field"><span>{l('公开视频链接', 'Public video link')}</span><input value={videoUrl} onChange={event => { setVideoUrl(event.target.value); setVideoFile(null); setNotice(''); }} placeholder={l('YouTube、Bilibili 等视频链接', 'YouTube, Bilibili, or another video link')} /></label>
            <div className="creator-tool-actions"><button className="creator-tool-primary" type="button" disabled={!hasSource} onClick={continueToSettings}>{l('下一步：分析设置', 'Next: Analysis settings')}</button></div>
          </section>
        ) : null}

        {currentStep === 1 ? (
          <section className="creator-tool-panel" aria-labelledby="auto-clip-settings-title">
            <div className="creator-tool-panel-heading"><div><h2 id="auto-clip-settings-title">{l('设置分析目标', 'Set the analysis goal')}</h2><p>{l('先确定内容偏好与片段时长，再开始识别字幕语义', 'Choose a content focus and clip length before analyzing subtitle meaning')}</p></div></div>
            <div className="creator-tool-form-row">
              <label className="creator-tool-field"><span>{l('内容偏好', 'Content focus')}</span><select aria-label={l('内容偏好', 'Content focus')} value={focus} onChange={event => setFocus(event.target.value as AnalysisFocus)}><option value="balanced">{l('综合表现', 'Balanced')}</option><option value="viral">{l('传播潜力优先', 'Shareability first')}</option><option value="knowledge">{l('知识完整度优先', 'Knowledge completeness')}</option></select></label>
              <label className="creator-tool-field"><span>{l('目标时长', 'Target duration')}</span><select aria-label={l('目标时长', 'Target duration')} value={duration} onChange={event => setDuration(event.target.value as ClipDuration)}><option value="15-30">15-30 {l('秒', 'sec')}</option><option value="30-60">30-60 {l('秒', 'sec')}</option><option value="60-90">60-90 {l('秒', 'sec')}</option></select></label>
            </div>
            <div className="auto-clip-analysis-note"><Sparkles size={18} strokeWidth={1.7} /><div><strong>{l('将生成 10 个候选片段', 'Ten candidate clips will be generated')}</strong><p>{l('每条包含完整字幕、开头吸引力、语义完整度、情绪强度和传播潜力评分', 'Each includes a full transcript plus hook, completeness, emotion, and shareability scores')}</p></div></div>
            <div className="creator-tool-actions"><button className="creator-tool-primary" type="button" onClick={() => analyze()}><Sparkles size={16} />{selectedResult && hasPendingChanges ? l(`重新分析并生成 V${nextVersion}`, `Reanalyze as V${nextVersion}`) : l('识别语义并提取片段', 'Analyze and extract clips')}</button></div>
          </section>
        ) : null}

        {currentStep === 2 && selectedResult ? (
          <section className="video-result-workspace auto-clip-result-workspace" aria-label={l('自动剪辑项目产出', 'Auto clip project outputs')}>
            <div className="video-result-toolbar">
              <div className="video-result-tabs" role="tablist" aria-label={l('自动剪辑结果类型', 'Auto clip result types')}>
                <button type="button" role="tab" aria-selected={resultTab === 'candidates'} onClick={() => setResultTab('candidates')}><ListVideo size={15} strokeWidth={1.8} />{l('候选片段', 'Candidates')}</button>
                <button type="button" role="tab" aria-selected={resultTab === 'details'} onClick={() => setResultTab('details')}><Captions size={15} strokeWidth={1.8} />{l('字幕与评分', 'Transcript and scores')}</button>
                <button type="button" role="tab" aria-selected={resultTab === 'export'} onClick={() => setResultTab('export')}><Download size={15} strokeWidth={1.8} />{l('导出内容', 'Exports')}</button>
                <button type="button" role="tab" aria-selected={resultTab === 'settings'} onClick={() => setResultTab('settings')}><Settings2 size={15} strokeWidth={1.8} />{l('任务设置', 'Task settings')}</button>
              </div>
              <CreatorResultVersionMenu version={resultVersion} versions={resultVersions.map(({ value, description }) => ({ value, description }))} onVersionChange={selectVersion} />
            </div>
            {hasPendingChanges ? <div className="stickman-version-draft" role="status"><div><strong>{l(`正在基于 V${resultVersion} 调整`, `Adjusting from V${resultVersion}`)}</strong><span>{l('原版本的候选片段、字幕与评分仍可查看', 'The original candidates, transcripts, and scores remain available')}</span></div><button type="button" onClick={() => setCurrentStep(1)}>{l('继续设置', 'Continue settings')}</button></div> : null}
            <div className="creator-result-layout">

            {resultTab === 'candidates' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('已找到 10 个候选片段', 'Found 10 candidate clips')}</h2><p>{l(`V${resultVersion}，已选 ${selected.length} 个`, `V${resultVersion}, ${selected.length} selected`)}</p></div><div className="auto-clip-result-actions"><label>{l('排序', 'Sort')}<select value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="score">{l('综合评分', 'Overall score')}</option><option value="time">{l('原片顺序', 'Source order')}</option></select></label><button type="button" disabled={selected.length === 0} onClick={exportSelected}><Download size={15} />{l('导出已选', 'Export selected')} ({selected.length})</button></div></header>
                <section className="auto-clip-list" aria-label={l('候选片段列表', 'Candidate clip list')}>{orderedClips.map(clip => <article key={clip.id} data-active={activeClip === clip.id}><label><input type="checkbox" checked={selected.includes(clip.id)} onChange={() => toggleClip(clip.id)} aria-label={`${l('选择片段', 'Select clip')} ${clip.id}`} /><span>{clip.id}</span></label><button type="button" onClick={() => { setActiveClip(clip.id); setResultTab('details'); }} aria-label={`${l('查看片段', 'View clip')} ${clip.id} ${localizedClip(clip, l).title}`}><span className="auto-clip-thumb"><img src="/dashboard/templates/video-localization.jpg" alt="" /><Play size={15} fill="currentColor" /></span><span><strong>{localizedClip(clip, l).title}</strong><small>{clip.time} · {clip.duration}</small></span><b>{totalScore(clip)}</b></button></article>)}</section>
              </div>
            ) : null}

            {resultTab === 'details' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('字幕与四维评分', 'Transcript and four scores')}</h2><p>{l('检查片段是否能够脱离原视频独立传播', 'Check whether this clip can stand on its own')}</p></div><button type="button" onClick={() => setResultTab('candidates')}>{l('返回候选片段', 'Back to candidates')}</button></header>
                <aside className="auto-clip-detail auto-clip-detail-result" aria-label={`${l('片段', 'Clip')} ${currentClip.id} ${l('详情', 'details')}`}><div className="auto-clip-player"><img src="/dashboard/templates/video-localization.jpg" alt={l('片段预览', 'Clip preview')} /><span><Play size={22} fill="currentColor" /></span></div><header><div><small>{l('片段', 'Clip')} {currentClip.id}</small><h2>{localizedClip(currentClip, l).title}</h2><p>{currentClip.time} · {currentClip.duration}</p></div><strong>{totalScore(currentClip)}</strong></header><dl className="auto-clip-scores"><div><dt>{l('开头吸引力', 'Hook')}</dt><dd>{currentClip.scores.hook}</dd></div><div><dt>{l('语义完整度', 'Completeness')}</dt><dd>{currentClip.scores.semantic}</dd></div><div><dt>{l('情绪强度', 'Emotion')}</dt><dd>{currentClip.scores.emotion}</dd></div><div><dt>{l('传播潜力', 'Shareability')}</dt><dd>{currentClip.scores.viral}</dd></div></dl><section className="auto-clip-subtitle"><h3>{l('片段字幕', 'Clip transcript')}</h3><p>{localizedClip(currentClip, l).subtitle}</p></section><button type="button" onClick={() => toggleClip(currentClip.id)}>{selected.includes(currentClip.id) ? <><Check size={15} />{l('已选择', 'Selected')}</> : l('选择此片段', 'Select this clip')}</button></aside>
              </div>
            ) : null}

            {resultTab === 'export' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('导出内容', 'Export selection')}</h2><p>{l('选择片段不会创建新版本，重新分析才会保留为新版本', 'Selecting clips does not create a version. Reanalysis does.')}</p></div><button type="button" disabled={selected.length === 0} onClick={exportSelected}><Download size={15} />{l('导出全部已选', 'Export selected')}</button></header>
                {selected.length ? <div className="auto-clip-export-list">{selected.map(id => { const clip = clips.find(item => item.id === id)!; return <div className="video-result-file-row" key={id}><span><Scissors size={18} strokeWidth={1.7} /></span><div><strong>{String(id).padStart(2, '0')}-{localizedClip(clip, l).title}.mp4</strong><small>{clip.time} · {clip.duration} · {l('综合评分', 'Score')} {totalScore(clip)}</small></div><button type="button" onClick={() => setNotice(l(`片段 ${id} 已加入导出队列`, `Clip ${id} was added to the export queue`))} aria-label={`${l('导出片段', 'Export clip')} ${id}`}><Download size={16} /></button></div>; })}</div> : <div className="video-result-empty"><Scissors size={26} strokeWidth={1.5} /><strong>{l('还没有选择片段', 'No clips selected')}</strong><button type="button" onClick={() => setResultTab('candidates')}>{l('返回选择片段', 'Choose clips')}</button></div>}
              </div>
            ) : null}

            {resultTab === 'settings' ? (
              <div className="video-result-pane">
                <header className="video-result-pane-heading"><div><h2>{l('当前版本设置', 'Current version settings')}</h2><p>{l('调整视频或分析目标后重新分析，会生成新版本', 'Changing the source or analysis goal and reanalyzing creates a new version')}</p></div><div className="video-result-pane-actions"><button type="button" onClick={() => setCurrentStep(0)}><FileVideo size={15} />{l('更换视频', 'Change video')}</button><button type="button" onClick={() => setCurrentStep(1)}><SlidersHorizontal size={15} />{l('调整分析设置', 'Adjust analysis')}</button></div></header>
                <dl className="video-result-settings"><div><dt>{l('视频来源', 'Video source')}</dt><dd>{selectedResult.videoFile?.name ?? selectedResult.videoUrl}</dd></div><div><dt>{l('候选数量', 'Candidates')}</dt><dd>10</dd></div><div><dt>{l('内容偏好', 'Content focus')}</dt><dd>{focusLabel(selectedResult.focus, l)}</dd></div><div><dt>{l('目标时长', 'Target duration')}</dt><dd>{selectedResult.duration} {l('秒', 'sec')}</dd></div></dl>
              </div>
            ) : null}
              <CreatorTaskSummary
                sourceIcon={FileVideo}
                sourceLabel={l('视频来源', 'Video source')}
                sourceValue={selectedResult.videoFile?.name ?? selectedResult.videoUrl}
                items={[
                  { label: l('内容偏好', 'Content focus'), value: focusLabel(selectedResult.focus, l) },
                  { label: l('目标时长', 'Target duration'), value: `${selectedResult.duration} ${l('秒', 'sec')}` },
                  { label: l('候选片段', 'Candidates'), value: '10' },
                  { label: l('已选择', 'Selected'), value: String(selected.length) }
                ]}
              />
            </div>
          </section>
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function localizedClip(clip: ClipCandidate, l: ReturnType<typeof useLocalizedCopy>) {
  const english = englishClips[clip.id];
  return { title: l(clip.title, english?.title ?? clip.title), subtitle: l(clip.subtitle, english?.subtitle ?? clip.subtitle) };
}

function focusLabel(value: AnalysisFocus, l: ReturnType<typeof useLocalizedCopy>) {
  if (value === 'viral') return l('传播潜力优先', 'Shareability first');
  if (value === 'knowledge') return l('知识完整度优先', 'Knowledge completeness');
  return l('综合表现', 'Balanced');
}

function createAnalysisSignature(input: { videoUrl: string; videoFile: File | null; focus: AnalysisFocus; duration: ClipDuration }) {
  return JSON.stringify({ url: input.videoUrl.trim(), file: input.videoFile ? { name: input.videoFile.name, size: input.videoFile.size, type: input.videoFile.type, lastModified: input.videoFile.lastModified } : null, focus: input.focus, duration: input.duration });
}
