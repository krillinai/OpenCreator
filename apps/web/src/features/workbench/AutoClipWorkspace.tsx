import { useMemo, useState } from 'react';
import { Check, Download, FileVideo, Play, Scissors, Sparkles, UploadCloud } from 'lucide-react';
import CreatorToolShell from './CreatorToolShell.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

type ClipCandidate = {
  id: number;
  title: string;
  time: string;
  duration: string;
  subtitle: string;
  scores: { hook: number; semantic: number; emotion: number; viral: number };
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

export default function AutoClipWorkspace(props: { onBack(): void }) {
  const l = useLocalizedCopy();
  const [videoUrl, setVideoUrl] = useState('');
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [analyzed, setAnalyzed] = useState(false);
  const [activeClip, setActiveClip] = useState(1);
  const [selected, setSelected] = useState<number[]>([1, 2, 3]);
  const [sort, setSort] = useState<'score' | 'time'>('score');
  const [notice, setNotice] = useState('');
  const hasSource = videoFile !== null || isValidUrl(videoUrl);
  const orderedClips = useMemo(() => [...clips].sort(sort === 'score'
    ? (left, right) => totalScore(right) - totalScore(left)
    : (left, right) => left.id - right.id), [sort]);
  const currentClip = clips.find(clip => clip.id === activeClip) ?? clips[0]!;

  function analyze() {
    if (!hasSource) {
      setNotice(l('请先上传视频或填写公开视频链接', 'Upload a video or enter a public video link first'));
      return false;
    }
    setAnalyzed(true);
    setSelected([1, 2, 3]);
    setActiveClip(1);
    setNotice(l('已识别字幕语义并生成 10 个候选片段', 'Analyzed subtitle semantics and generated 10 candidate clips'));
    return true;
  }

  function toggleClip(id: number) {
    setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  function handleCommand(command: string) {
    const foundUrl = command.match(/https?:\/\/[^\s,，。;；]+/i)?.[0];
    if (foundUrl) {
      setVideoUrl(foundUrl);
      setVideoFile(null);
      if (/分析|剪辑|片段|analyze|clip|edit/i.test(command)) {
        setAnalyzed(true);
        setNotice(l('已识别字幕语义并生成 10 个候选片段', 'Analyzed subtitle semantics and generated 10 candidate clips'));
        return l('视频分析完成。我根据字幕语义、观点完整度和传播潜力找到了 10 个片段。', 'Video analysis is complete. I found 10 clips based on subtitle meaning, idea completeness, and sharing potential.');
      }
      return l('视频链接已同步到左侧。告诉我“开始分析”即可提取候选片段。', 'The video link is synchronized on the left. Say "start analysis" to extract candidate clips.');
    }
    if (/分析|识别|自动剪辑|analyze|auto.?clip/i.test(command)) {
      return analyze() ? l('分析完成，左侧已经列出 10 个候选片段及四维评分。', 'Analysis complete. Ten candidate clips and four scoring dimensions are listed on the left.') : l('请先添加要分析的视频。', 'Add a video to analyze first.');
    }
    if (/最高|前三|top\s*3/i.test(command)) {
      setSelected([...clips].sort((a, b) => totalScore(b) - totalScore(a)).slice(0, 3).map(clip => clip.id));
      setSort('score');
      return l('已选中综合评分最高的 3 个片段。', 'Selected the top 3 clips by overall score.');
    }
    if (/导出|下载|export|download/i.test(command)) {
      if (!analyzed || selected.length === 0) return l('请先分析视频并至少选择一个片段。', 'Analyze the video and select at least one clip first.');
      setNotice(l(`${selected.length} 个片段已加入导出队列`, `${selected.length} clips were added to the export queue`));
      return l(`已开始导出 ${selected.length} 个片段。`, `Started exporting ${selected.length} clips.`);
    }
    return l('你可以发送视频链接，让我分析高光片段、选择评分最高的片段或导出已选内容。', 'Send a video link and ask me to find highlights, select the highest-scoring clips, or export your selection.');
  }

  return (
    <CreatorToolShell
      title={l('自动剪辑', 'Auto Clips')}
      subtitle={l('理解字幕语义，从长视频提取可独立传播的片段', 'Understand subtitle semantics and extract standalone clips from long videos')}
      context={analyzed ? l(`10 个候选，已选 ${selected.length} 个`, `10 candidates, ${selected.length} selected`) : l('等待分析长视频', 'Waiting to analyze a long video')}
      initialMessage={l('上传长视频或发送链接，我会识别字幕语义并提取 10 个候选片段，每条都提供四维评分和完整字幕。', 'Upload a long video or send a link. I will analyze subtitle semantics and extract 10 candidates with four scores and full transcripts.')}
      suggestions={analyzed ? [l('选择评分最高的 3 个', 'Select the top 3 clips'), l('导出已选片段', 'Export selected clips')] : [l('开始分析', 'Start analysis')]}
      placeholder={l('发送视频链接或描述剪辑要求', 'Send a video link or describe your editing requirements')}
      onBack={props.onBack}
      onCommand={handleCommand}
    >
      <div className="creator-tool-stack">
        {!analyzed ? (
          <section className="creator-tool-panel auto-clip-source" aria-labelledby="auto-clip-source-title">
            <div className="creator-tool-panel-heading"><div><h2 id="auto-clip-source-title">{l('添加长视频', 'Add a long video')}</h2><p>{l('建议 5 分钟以上、包含清晰人声的访谈、播客或课程', 'Best for interviews, podcasts, or lessons over 5 minutes with clear speech')}</p></div></div>
            <label className="creator-tool-upload">
              <input type="file" accept="video/*" aria-label={l('上传待剪辑视频', 'Upload a video to edit')} onChange={event => { setVideoFile(event.target.files?.[0] ?? null); setVideoUrl(''); }} />
              {videoFile ? <><FileVideo size={25} /><strong>{videoFile.name}</strong><span>{l('点击重新选择', 'Click to choose another')}</span></> : <><UploadCloud size={25} /><strong>{l('上传视频', 'Upload video')}</strong><span>{l('支持 MP4、MOV、WebM', 'Supports MP4, MOV, and WebM')}</span></>}
            </label>
            <div className="creator-tool-or"><span>{l('或', 'or')}</span></div>
            <label className="creator-tool-field"><span>{l('公开视频链接', 'Public video link')}</span><input value={videoUrl} onChange={event => { setVideoUrl(event.target.value); setVideoFile(null); }} placeholder={l('YouTube、Bilibili 等视频链接', 'YouTube, Bilibili, or another video link')} /></label>
            <div className="creator-tool-actions"><button className="creator-tool-primary" type="button" disabled={!hasSource} onClick={analyze}><Sparkles size={16} />{l('识别语义并提取片段', 'Analyze and extract clips')}</button></div>
          </section>
        ) : (
          <>
            <section className="auto-clip-summary" aria-label={l('自动剪辑分析摘要', 'Auto clip analysis summary')}>
              <div><span><Scissors size={17} /></span><section><strong>{l('已找到 10 个候选片段', 'Found 10 candidate clips')}</strong><p>{l('基于字幕语义、观点边界、情绪变化和传播潜力', 'Based on subtitle meaning, idea boundaries, emotional change, and sharing potential')}</p></section></div>
              <label>{l('排序', 'Sort')}<select value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="score">{l('综合评分', 'Overall score')}</option><option value="time">{l('原片顺序', 'Source order')}</option></select></label>
              <button type="button" disabled={selected.length === 0} onClick={() => setNotice(l(`${selected.length} 个片段已加入导出队列`, `${selected.length} clips were added to the export queue`))}><Download size={15} />{l('导出已选', 'Export selected')} ({selected.length})</button>
            </section>
            <div className="auto-clip-workspace">
              <section className="auto-clip-list" aria-label={l('候选片段列表', 'Candidate clip list')}>
                {orderedClips.map(clip => (
                  <article key={clip.id} data-active={activeClip === clip.id}>
                    <label><input type="checkbox" checked={selected.includes(clip.id)} onChange={() => toggleClip(clip.id)} aria-label={`${l('选择片段', 'Select clip')} ${clip.id}`} /><span>{clip.id}</span></label>
                    <button type="button" onClick={() => setActiveClip(clip.id)} aria-label={`${l('查看片段', 'View clip')} ${clip.id} ${localizedClip(clip, l).title}`}>
                      <span className="auto-clip-thumb"><img src="/workbench/templates/video-localization.jpg" alt="" /><Play size={15} fill="currentColor" /></span>
                      <span><strong>{localizedClip(clip, l).title}</strong><small>{clip.time} · {clip.duration}</small></span>
                      <b>{totalScore(clip)}</b>
                    </button>
                  </article>
                ))}
              </section>
              <aside className="auto-clip-detail" aria-label={`${l('片段', 'Clip')} ${currentClip.id} ${l('详情', 'details')}`}>
                <div className="auto-clip-player"><img src="/workbench/templates/video-localization.jpg" alt={l('片段预览', 'Clip preview')} /><span><Play size={22} fill="currentColor" /></span></div>
                <header><div><small>{l('片段', 'Clip')} {currentClip.id}</small><h2>{localizedClip(currentClip, l).title}</h2><p>{currentClip.time} · {currentClip.duration}</p></div><strong>{totalScore(currentClip)}</strong></header>
                <dl className="auto-clip-scores">
                  <div><dt>{l('开头吸引力', 'Hook')}</dt><dd>{currentClip.scores.hook}</dd></div>
                  <div><dt>{l('语义完整度', 'Completeness')}</dt><dd>{currentClip.scores.semantic}</dd></div>
                  <div><dt>{l('情绪强度', 'Emotion')}</dt><dd>{currentClip.scores.emotion}</dd></div>
                  <div><dt>{l('传播潜力', 'Shareability')}</dt><dd>{currentClip.scores.viral}</dd></div>
                </dl>
                <section className="auto-clip-subtitle"><h3>{l('片段字幕', 'Clip transcript')}</h3><p>{localizedClip(currentClip, l).subtitle}</p></section>
                <button type="button" onClick={() => toggleClip(currentClip.id)}>{selected.includes(currentClip.id) ? <><Check size={15} />{l('已选择', 'Selected')}</> : l('选择此片段', 'Select this clip')}</button>
              </aside>
            </div>
          </>
        )}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function localizedClip(clip: ClipCandidate, l: ReturnType<typeof useLocalizedCopy>) {
  const english = englishClips[clip.id];
  return {
    title: l(clip.title, english?.title ?? clip.title),
    subtitle: l(clip.subtitle, english?.subtitle ?? clip.subtitle)
  };
}
