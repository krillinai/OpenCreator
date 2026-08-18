import { useEffect, useState } from 'react';
import { Check, Download, ImagePlus, Play, Sparkles, UploadCloud } from 'lucide-react';
import CreatorToolShell from './CreatorToolShell.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';

const storyboardShots = [
  { title: '建立场景', detail: '角色站在城市天台，远景缓慢推进', duration: '0-3s' },
  { title: '冲突出现', detail: '风吹走手中的纸张，角色快速追赶', duration: '3-7s' },
  { title: '动作高潮', detail: '角色越过障碍，在空中抓住纸张', duration: '7-12s' },
  { title: '结尾定格', detail: '角色落地举起纸张，镜头定格', duration: '12-15s' }
];
const characterPromptZh = '黑色线条、白色圆形头部、红色围巾，动作灵活';
const characterPromptEn = 'Black lines, a round white head, a red scarf, and agile movement';
const storyZh = '一个火柴人在城市天台追逐被风吹走的创意手稿，最后成功抓住。';
const storyEn = 'A stick figure chases a creative manuscript blown across a city rooftop and catches it at the last moment.';

export default function StickmanVideoWorkspace(props: { onBack(): void }) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const [characterMode, setCharacterMode] = useState<'generate' | 'upload'>('generate');
  const [characterPrompt, setCharacterPrompt] = useState(() => l(characterPromptZh, characterPromptEn));
  const [characterFile, setCharacterFile] = useState<File | null>(null);
  const [characterPreview, setCharacterPreview] = useState('');
  const [characterGenerated, setCharacterGenerated] = useState(false);
  const [story, setStory] = useState(() => l(storyZh, storyEn));
  const [ratio, setRatio] = useState<'16:9' | '9:16' | '1:1'>('16:9');
  const [style, setStyle] = useState('手绘线稿');
  const [storyboardReady, setStoryboardReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [notice, setNotice] = useState('');
  const characterReady = characterGenerated || characterFile !== null;

  useEffect(() => {
    setCharacterPrompt(current => current === characterPromptZh || current === characterPromptEn
      ? l(characterPromptZh, characterPromptEn)
      : current);
    setStory(current => current === storyZh || current === storyEn
      ? l(storyZh, storyEn)
      : current);
  }, [l, language]);

  useEffect(() => {
    if (!characterFile || typeof URL.createObjectURL !== 'function') {
      setCharacterPreview('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(characterFile);
    setCharacterPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [characterFile]);

  function generateCharacter() {
    if (!characterPrompt.trim()) {
      setNotice(l('请先描述角色形象', 'Describe the character first'));
      return false;
    }
    setCharacterGenerated(true);
    setStoryboardReady(false);
    setVideoReady(false);
    setNotice(l('角色形象已生成，可以继续生成分镜', 'Character image generated. Continue to the storyboard.'));
    return true;
  }

  function generateStoryboard() {
    if (!characterReady) {
      setNotice(l('请先上传或生成角色形象', 'Upload or generate a character first'));
      return false;
    }
    if (!story.trim()) {
      setNotice(l('请先填写故事创意', 'Enter a story idea first'));
      return false;
    }
    setStoryboardReady(true);
    setVideoReady(false);
    setNotice(l('已生成 4 个关键分镜，请确认后生成视频', 'Generated 4 key storyboard shots. Review them before creating the video.'));
    return true;
  }

  function generateVideo() {
    if (!storyboardReady) {
      setNotice(l('请先生成并确认分镜图', 'Generate and review the storyboard first'));
      return false;
    }
    setVideoReady(true);
    setNotice(l('火柴人视频已生成完成', 'Stick figure video generated'));
    return true;
  }

  function handleCommand(command: string) {
    if (/生成角色|角色形象|generate character|character image/i.test(command)) {
      return generateCharacter() ? l('角色形象已经生成，左侧可以查看。下一步可以生成故事分镜。', 'The character is ready on the left. Next, generate the storyboard.') : l('请先补充角色外观描述。', 'Add a character appearance description first.');
    }
    if (/生成分镜|分镜图|generate storyboard|storyboard/i.test(command)) {
      return generateStoryboard() ? l('4 个关键分镜已生成，请在左侧检查镜头和节奏。', 'Four key shots are ready. Review the scenes and pacing on the left.') : l('需要先准备角色形象和故事创意。', 'Prepare a character and story idea first.');
    }
    if (/生成视频|开始生成|generate video|create video/i.test(command)) {
      return generateVideo() ? l('视频已经生成，可以在左侧预览和下载。', 'The video is ready to preview and download on the left.') : l('需要先生成角色形象和分镜图。', 'Generate the character and storyboard first.');
    }
    if (/竖屏|9:16|vertical/i.test(command)) {
      setRatio('9:16');
      return l('已切换为 9:16 竖屏视频。', 'Switched to 9:16 vertical video.');
    }
    if (/横屏|16:9|horizontal/i.test(command)) {
      setRatio('16:9');
      return l('已切换为 16:9 横屏视频。', 'Switched to 16:9 horizontal video.');
    }
    if (command.length > 12) {
      setStory(command);
      setStoryboardReady(false);
      setVideoReady(false);
      return l('已把这段内容作为故事创意同步到左侧。准备好角色后即可生成分镜。', 'This is now the story idea on the left. Once the character is ready, generate the storyboard.');
    }
    return l('你可以描述角色外观和故事，也可以直接让我生成角色、分镜或视频。', 'Describe the character and story, or ask me to generate the character, storyboard, or video.');
  }

  const context = videoReady
    ? l(`视频已完成，${ratio}`, `Video complete, ${ratio}`)
    : storyboardReady
      ? l(`4 个分镜，${ratio}`, `4 storyboard shots, ${ratio}`)
      : characterReady
        ? l('角色已准备，等待分镜', 'Character ready, waiting for storyboard')
        : l('等待角色形象', 'Waiting for a character');

  return (
    <CreatorToolShell
      title={l('火柴人视频生成', 'Stick Figure Video')}
      subtitle={l('先创建角色与分镜，再生成完整动画', 'Create a character and storyboard, then generate the full animation')}
      context={context}
      initialMessage={l('先准备一个角色形象。你可以上传参考角色，也可以描述外观让我生成，然后继续完成分镜和视频。', 'Start with a character. Upload a reference or describe the appearance for me to generate, then continue to the storyboard and video.')}
      suggestions={videoReady
        ? [l('让 Agent 重新生成视频', 'Ask Agent to regenerate video')]
        : storyboardReady
          ? [l('让 Agent 生成视频', 'Ask Agent to generate video')]
          : characterReady
            ? [l('让 Agent 生成分镜', 'Ask Agent to generate storyboard')]
            : [l('让 Agent 生成角色', 'Ask Agent to generate character')]}
      placeholder={l('描述角色、故事或生成要求', 'Describe the character, story, or generation requirements')}
      onBack={props.onBack}
      onCommand={handleCommand}
    >
      <div className="creator-tool-stack">
        <section className="creator-tool-panel" aria-labelledby="stickman-character-title">
          <div className="creator-tool-panel-heading">
            <div><span>{l('角色形象', 'Character')}</span><h2 id="stickman-character-title">{l('准备主角', 'Prepare the main character')}</h2><p>{l('上传已有角色，或先生成一张统一的角色设定图', 'Upload an existing character or generate a consistent character sheet')}</p></div>
            {characterReady ? <small><Check size={14} strokeWidth={2} />{l('已完成', 'Complete')}</small> : null}
          </div>
          <div className="creator-tool-segmented" role="tablist" aria-label={l('角色来源', 'Character source')}>
            <button type="button" role="tab" aria-selected={characterMode === 'generate'} onClick={() => setCharacterMode('generate')}>
              <Sparkles size={15} strokeWidth={1.8} />{l('生成角色', 'Generate')}
            </button>
            <button type="button" role="tab" aria-selected={characterMode === 'upload'} onClick={() => setCharacterMode('upload')}>
              <UploadCloud size={15} strokeWidth={1.8} />{l('上传角色', 'Upload')}
            </button>
          </div>
          {characterMode === 'generate' ? (
            <div className="stickman-character-grid">
              <label className="creator-tool-field">
                <span>{l('角色描述', 'Character description')}</span>
                <textarea value={characterPrompt} onChange={event => { setCharacterPrompt(event.target.value); setCharacterGenerated(false); }} rows={4} />
              </label>
              {characterGenerated ? (
                <div className="stickman-character-preview"><img src="/workbench/templates/ai-video-insane.jpg" alt={l('生成的火柴人角色形象', 'Generated stick figure character')} /></div>
              ) : (
                <div className="stickman-character-empty"><ImagePlus size={24} strokeWidth={1.5} /><span>{l('角色设定图将在这里生成', 'The character sheet will appear here')}</span></div>
              )}
              <button className="creator-tool-primary" type="button" onClick={generateCharacter}>{l('生成角色形象', 'Generate character')}</button>
            </div>
          ) : (
            <label className="creator-tool-upload">
              <input type="file" accept="image/*" aria-label={l('上传火柴人角色形象', 'Upload a stick figure character')} onChange={event => { setCharacterFile(event.target.files?.[0] ?? null); setStoryboardReady(false); setVideoReady(false); }} />
              {characterFile ? (
                <><img src={characterPreview || '/workbench/templates/ai-video-insane.jpg'} alt={l('上传的角色形象', 'Uploaded character')} /><strong>{characterFile.name}</strong><span>{l('点击重新选择', 'Click to choose another')}</span></>
              ) : (
                <><UploadCloud size={25} strokeWidth={1.5} /><strong>{l('上传角色设定图', 'Upload character sheet')}</strong><span>{l('支持 PNG、JPG、WebP', 'Supports PNG, JPG, and WebP')}</span></>
              )}
            </label>
          )}
        </section>

        <section className="creator-tool-panel" aria-labelledby="stickman-story-title">
          <div className="creator-tool-panel-heading"><div><span>{l('故事与画面', 'Story and visuals')}</span><h2 id="stickman-story-title">{l('生成分镜', 'Generate storyboard')}</h2><p>{l('角色会在所有镜头中保持一致', 'The character remains consistent across every shot')}</p></div></div>
          <label className="creator-tool-field"><span>{l('故事创意', 'Story idea')}</span><textarea value={story} onChange={event => { setStory(event.target.value); setStoryboardReady(false); setVideoReady(false); }} rows={4} /></label>
          <div className="creator-tool-form-row">
            <label className="creator-tool-field"><span>{l('画面风格', 'Visual style')}</span><select value={style} onChange={event => setStyle(event.target.value)}><option value="手绘线稿">{l('手绘线稿', 'Hand-drawn line art')}</option><option value="漫画网点">{l('漫画网点', 'Manga halftone')}</option><option value="极简黑白">{l('极简黑白', 'Minimal black and white')}</option></select></label>
            <label className="creator-tool-field"><span>{l('视频比例', 'Video ratio')}</span><select value={ratio} onChange={event => setRatio(event.target.value as typeof ratio)}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
          </div>
          <div className="creator-tool-actions"><button className="creator-tool-primary" type="button" disabled={!characterReady || !story.trim()} onClick={generateStoryboard}>{l('生成分镜图', 'Generate storyboard')}</button></div>
          {storyboardReady ? (
            <div className="stickman-storyboard" aria-label={l('火柴人故事分镜', 'Stick figure storyboard')}>
              {storyboardShots.map((shot, index) => (
                <article key={shot.title}>
                  <div><img src="/workbench/templates/ai-video-insane.jpg" alt="" /><span>{index + 1}</span></div>
                  <strong>{localizeShot(shot.title, l)}</strong><p>{localizeShot(shot.detail, l)}</p><small>{shot.duration}</small>
                </article>
              ))}
            </div>
          ) : null}
        </section>

        {storyboardReady ? (
          <section className="creator-tool-panel" aria-label={l('火柴人视频输出', 'Stick figure video output')}>
            {videoReady ? (
              <div className="stickman-video-result">
                <div><img src="/workbench/templates/ai-video-insane.jpg" alt={l('火柴人视频预览', 'Stick figure video preview')} /><span><Play size={22} fill="currentColor" /></span></div>
                <section><h2>{l('火柴人动画', 'stick-figure-animation')}.mp4</h2><p>{ratio} · 15 {l('秒', 'sec')} · {localizeShot(style, l)}</p><button type="button" onClick={() => setNotice(l('视频已加入下载队列', 'Video added to the download queue'))}><Download size={16} strokeWidth={1.8} />{l('下载视频', 'Download video')}</button></section>
              </div>
            ) : (
              <div className="creator-tool-actions"><button className="creator-tool-primary" type="button" onClick={generateVideo}><Play size={16} />{l('根据分镜生成视频', 'Generate video from storyboard')}</button></div>
            )}
          </section>
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function localizeShot(value: string, l: ReturnType<typeof useLocalizedCopy>): string {
  const translations: Record<string, string> = {
    '建立场景': 'Establish the scene',
    '角色站在城市天台，远景缓慢推进': 'The character stands on a city rooftop as the wide shot slowly pushes in',
    '冲突出现': 'Conflict appears',
    '风吹走手中的纸张，角色快速追赶': 'Wind carries the paper away and the character gives chase',
    '动作高潮': 'Action climax',
    '角色越过障碍，在空中抓住纸张': 'The character clears an obstacle and catches the paper in midair',
    '结尾定格': 'Final freeze frame',
    '角色落地举起纸张，镜头定格': 'The character lands, raises the paper, and the frame freezes',
    '手绘线稿': 'Hand-drawn line art',
    '漫画网点': 'Manga halftone',
    '极简黑白': 'Minimal black and white'
  };
  return l(value, translations[value] ?? value);
}
