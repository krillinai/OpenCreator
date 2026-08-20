import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  FileVideo,
  ImagePlus,
  Info,
  PanelsTopLeft,
  PersonStanding,
  Play,
  Settings2,
  Sparkles,
  UploadCloud
} from 'lucide-react';
import CreatorToolShell from './CreatorToolShell.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
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
const generatedCharacterImages = {
  image: '/dashboard/characters/default.png'
} as const;
const storyZh = '一个火柴人在城市天台追逐被风吹走的创意手稿，最后成功抓住。';
const storyEn = 'A stick figure chases a creative manuscript blown across a city rooftop and catches it at the last moment.';
const characterPresets = [
  {
    id: 'default',
    nameZh: '默认角色',
    nameEn: 'Default',
    image: '/dashboard/characters/default.png'
  },
  {
    id: 'tech-guy',
    nameZh: '科技男',
    nameEn: 'Tech Guy',
    image: '/dashboard/characters/tech-guy.png'
  },
  {
    id: 'long-hair',
    nameZh: '长发角色',
    nameEn: 'Long Hair',
    image: '/dashboard/characters/long-hair.png'
  },
  {
    id: 'short-hair',
    nameZh: '短发角色',
    nameEn: 'Short Hair',
    image: '/dashboard/characters/short-hair.png'
  },
  {
    id: 'hiphop',
    nameZh: '嘻哈',
    nameEn: 'HipHop',
    image: '/dashboard/characters/hiphop.png'
  },
  {
    id: 'student',
    nameZh: '学生角色',
    nameEn: 'Student',
    image: '/dashboard/characters/student.png'
  },
  {
    id: 'elder',
    nameZh: '长者角色',
    nameEn: 'Elder',
    image: '/dashboard/characters/elder.png'
  },
  {
    id: 'manager',
    nameZh: '经理',
    nameEn: 'Manager',
    image: '/dashboard/characters/manager.png'
  },
  {
    id: 'chef',
    nameZh: '厨师',
    nameEn: 'Chef',
    image: '/dashboard/characters/chef.png'
  },
  {
    id: 'fitness',
    nameZh: '健身',
    nameEn: 'Fitness',
    image: '/dashboard/characters/fitness.png'
  }
] as const;

type CharacterPresetId = typeof characterPresets[number]['id'];
type StickmanStep = 0 | 1 | 2;
type CharacterSource = 'preset' | 'generate' | 'upload';
type StickmanResultTab = 'video' | 'storyboard' | 'character' | 'settings';

type StickmanResultVersion = {
  value: number;
  description: string;
  signature: string;
  characterSource: CharacterSource;
  selectedPresetId: CharacterPresetId | null;
  characterPrompt: string;
  characterFile: File | null;
  characterGenerated: boolean;
  story: string;
  ratio: '16:9' | '9:16' | '1:1';
  style: string;
};

export default function StickmanVideoWorkspace(props: { onBack(): void; promptHint?: string }) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const [characterMode, setCharacterMode] = useState<CharacterSource>('preset');
  const [characterSource, setCharacterSource] = useState<CharacterSource>('preset');
  const [selectedPresetId, setSelectedPresetId] = useState<CharacterPresetId | null>('default');
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
  const [currentStep, setCurrentStep] = useState<StickmanStep>(0);
  const [furthestStep, setFurthestStep] = useState<StickmanStep>(0);
  const [resultVersions, setResultVersions] = useState<StickmanResultVersion[]>([]);
  const [resultVersion, setResultVersion] = useState(0);
  const [resultTab, setResultTab] = useState<StickmanResultTab>('video');
  const selectedPreset = characterPresets.find(preset => preset.id === selectedPresetId);
  const characterReady = characterSource === 'preset'
    ? selectedPreset !== undefined
    : characterSource === 'generate'
      ? characterGenerated
      : characterFile !== null;
  const steps = [l('选择角色', 'Choose character'), l('故事与分镜', 'Story and storyboard'), l('生成视频', 'Generate video')];
  const currentSignature = createVersionSignature({
    characterSource,
    selectedPresetId,
    characterPrompt,
    characterFile,
    characterGenerated,
    story,
    ratio,
    style
  });
  const selectedResult = resultVersions.find(version => version.value === resultVersion);
  const nextVersion = resultVersions.reduce((highest, version) => Math.max(highest, version.value), 0) + 1;
  const hasSavedResults = resultVersions.length > 0;
  const hasPendingChanges = selectedResult !== undefined && selectedResult.signature !== currentSignature;
  const resultPreset = selectedResult?.selectedPresetId
    ? characterPresets.find(preset => preset.id === selectedResult.selectedPresetId)
    : undefined;
  const resultCharacterName = selectedResult?.characterSource === 'preset' && resultPreset
    ? l(resultPreset.nameZh, resultPreset.nameEn)
    : selectedResult?.characterSource === 'upload'
      ? selectedResult.characterFile?.name ?? l('上传角色', 'Uploaded character')
      : l('AI 生成角色', 'AI-generated character');
  const resultCharacterSource = selectedResult?.characterSource === 'preset'
    ? l('默认角色', 'Default character')
    : selectedResult?.characterSource === 'upload'
      ? l('上传图片', 'Uploaded image')
      : l('提示词生成', 'Prompt generated');
  const resultCharacterImage = resultPreset?.image
    ?? (selectedResult?.characterSource === 'upload' && selectedResult.characterFile === characterFile && characterPreview
      ? characterPreview
      : generatedCharacterImages.image);
  const taskCharacterName = characterSource === 'preset' && selectedPreset
    ? l(selectedPreset.nameZh, selectedPreset.nameEn)
    : characterSource === 'upload'
      ? characterFile?.name ?? l('上传角色', 'Uploaded character')
      : l('AI 生成角色', 'AI-generated character');

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
    setCharacterMode('generate');
    setCharacterSource('generate');
    setSelectedPresetId(null);
    setCharacterFile(null);
    setCharacterGenerated(true);
    setStoryboardReady(false);
    setVideoReady(false);
    setCurrentStep(0);
    setFurthestStep(hasSavedResults ? 2 : 0);
    setNotice(l('角色形象已生成，可以继续生成分镜', 'Character image generated. Continue to the storyboard.'));
    return true;
  }

  function selectPreset(id: CharacterPresetId) {
    setCharacterMode('preset');
    setCharacterSource('preset');
    setSelectedPresetId(id);
    setCharacterGenerated(false);
    setCharacterFile(null);
    setStoryboardReady(false);
    setVideoReady(false);
    setCurrentStep(0);
    setFurthestStep(hasSavedResults ? 2 : 0);
    const preset = characterPresets.find(item => item.id === id)!;
    setNotice(l(`已选择${preset.nameZh}，可以继续生成分镜`, `${preset.nameEn} selected. Continue to the storyboard.`));
  }

  function updateCharacterPrompt(value: string) {
    setCharacterPrompt(value);
    if (characterSource !== 'generate') return;
    setCharacterGenerated(false);
    setStoryboardReady(false);
    setVideoReady(false);
    setCurrentStep(0);
    setFurthestStep(hasSavedResults ? 2 : 0);
  }

  function uploadCharacter(file: File | null) {
    if (!file) return;
    setCharacterFile(file);
    setCharacterMode('upload');
    setCharacterSource('upload');
    setSelectedPresetId(null);
    setCharacterGenerated(false);
    setStoryboardReady(false);
    setVideoReady(false);
    setCurrentStep(0);
    setFurthestStep(hasSavedResults ? 2 : 0);
    setNotice(l('角色图片已上传，可以继续生成分镜', 'Character image uploaded. Continue to the storyboard.'));
  }

  function generateStoryboard() {
    if (!characterReady) {
      setCurrentStep(0);
      setFurthestStep(0);
      setNotice(l('请先上传或生成角色形象', 'Upload or generate a character first'));
      return false;
    }
    if (!story.trim()) {
      setNotice(l('请先填写故事创意', 'Enter a story idea first'));
      return false;
    }
    setCurrentStep(1);
    setFurthestStep(current => Math.max(current, 1) as StickmanStep);
    setStoryboardReady(true);
    setVideoReady(false);
    setNotice(l('已生成 4 个关键分镜，请确认后生成视频', 'Generated 4 key storyboard shots. Review them before creating the video.'));
    return true;
  }

  function generateVideo() {
    if (!storyboardReady) {
      setCurrentStep(characterReady ? 1 : 0);
      setFurthestStep(hasSavedResults ? 2 : characterReady ? 1 : 0);
      setNotice(l('请先生成并确认分镜图', 'Generate and review the storyboard first'));
      return false;
    }
    if (selectedResult?.signature === currentSignature) {
      setCurrentStep(2);
      setFurthestStep(2);
      setVideoReady(true);
      setNotice(l(`当前设置没有变化，继续查看 V${resultVersion}`, `Nothing changed. Continuing with V${resultVersion}.`));
      return true;
    }
    const version = nextVersion;
    setResultVersions(current => [
      ...current,
      {
        value: version,
        description: version === 1
          ? l('初次生成', 'Initial generation')
          : l(`基于 V${resultVersion} 调整`, `Adjusted from V${resultVersion}`),
        signature: currentSignature,
        characterSource,
        selectedPresetId,
        characterPrompt,
        characterFile,
        characterGenerated,
        story,
        ratio,
        style
      }
    ]);
    setResultVersion(version);
    setResultTab('video');
    setCurrentStep(2);
    setFurthestStep(2);
    setVideoReady(true);
    setNotice(version === 1
      ? l('V1 已生成完成', 'V1 is ready.')
      : l(`V${version} 已生成完成，之前的版本仍可查看`, `V${version} is ready. Previous versions remain available.`));
    return true;
  }

  function selectResultVersion(version: number) {
    const result = resultVersions.find(item => item.value === version);
    if (!result) return;

    setResultVersion(result.value);
    setResultTab('video');
    setCharacterSource(result.characterSource);
    setCharacterMode(result.characterSource);
    setSelectedPresetId(result.selectedPresetId);
    setCharacterPrompt(result.characterPrompt);
    setCharacterFile(result.characterFile);
    setCharacterGenerated(result.characterGenerated);
    setStory(result.story);
    setRatio(result.ratio);
    setStyle(result.style);
    setStoryboardReady(true);
    setVideoReady(true);
    setCurrentStep(2);
    setFurthestStep(2);
    setNotice('');
  }

  function continueToStory() {
    if (!characterReady) {
      setNotice(l('请先选择、上传或生成一个角色', 'Choose, upload, or generate a character first'));
      return;
    }
    setCurrentStep(1);
    setFurthestStep(current => Math.max(current, 1) as StickmanStep);
    setNotice('');
  }

  function continueToVideo() {
    if (!storyboardReady) {
      setNotice(l('请先生成并确认分镜图', 'Generate and review the storyboard first'));
      return;
    }
    setCurrentStep(2);
    setFurthestStep(2);
    setNotice('');
  }

  function handleCommand(command: string) {
    const requestedPreset = characterPresets.find(preset => {
      const keywords: Record<CharacterPresetId, RegExp> = {
        default: /默认|基础|简单|default|basic|simple/i,
        'tech-guy': /科技男|技术宅|科技|格纹|眼镜|tech guy|tech enthusiast|tech|checks|glasses/i,
        'long-hair': /长发|long hair/i,
        'short-hair': /短发|short hair/i,
        hiphop: /嘻哈|说唱|歌手|街头|帽衫|球鞋|hiphop|hip hop|rapper|street|hoodie|sneakers/i,
        student: /学生|校园|水手服|student|school|campus/i,
        elder: /长者|老人|胡须|elder|older|beard/i,
        manager: /经理|管理者|西装|manager|executive|suit/i,
        chef: /厨师|美食|餐厅|chef|cook|food/i,
        fitness: /健身|教练|肌肉|fitness|fitness coach|coach|trainer|muscle/i
      };
      return keywords[preset.id].test(command);
    });
    if (requestedPreset) {
      selectPreset(requestedPreset.id);
      return l(`已切换为${requestedPreset.nameZh}，左侧角色选择已同步。`, `Switched to ${requestedPreset.nameEn}. The character selection is synced on the left.`);
    }
    if (/生成角色|角色形象|generate character|character image/i.test(command)) {
      return generateCharacter() ? l('角色形象已经生成，左侧可以查看。下一步可以生成故事分镜。', 'The character is ready on the left. Next, generate the storyboard.') : l('请先补充角色外观描述。', 'Add a character appearance description first.');
    }
    if (/生成分镜|分镜图|generate storyboard|storyboard/i.test(command)) {
      return generateStoryboard() ? l('4 个关键分镜已生成，请在左侧检查镜头和节奏。', 'Four key shots are ready. Review the scenes and pacing on the left.') : l('需要先准备角色形象和故事创意。', 'Prepare a character and story idea first.');
    }
    if (/生成视频|开始生成|generate video|create video/i.test(command)) {
      const unchanged = selectedResult?.signature === currentSignature;
      return generateVideo()
        ? unchanged
          ? l(`设置没有变化，继续查看 V${resultVersion}，未创建新版本。`, `Nothing changed. Continuing with V${resultVersion}; no new version was created.`)
          : l(`V${nextVersion} 已生成，可以在左侧预览和下载。`, `V${nextVersion} is ready to preview and download on the left.`)
        : l('需要先生成角色形象和分镜图。', 'Generate the character and storyboard first.');
    }
    if (/竖屏|9:16|vertical/i.test(command)) {
      setRatio('9:16');
      setCurrentStep(1);
      setFurthestStep(current => Math.max(current, 1) as StickmanStep);
      setVideoReady(false);
      return l('已切换为 9:16 竖屏视频。', 'Switched to 9:16 vertical video.');
    }
    if (/横屏|16:9|horizontal/i.test(command)) {
      setRatio('16:9');
      setCurrentStep(1);
      setFurthestStep(current => Math.max(current, 1) as StickmanStep);
      setVideoReady(false);
      return l('已切换为 16:9 横屏视频。', 'Switched to 16:9 horizontal video.');
    }
    if (command.length > 12) {
      setStory(command);
      setStoryboardReady(false);
      setVideoReady(false);
      setCurrentStep(1);
      setFurthestStep(hasSavedResults ? 2 : 1);
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
      initialMessage={l('已经为你选好一个默认角色。你可以直接生成分镜，也可以换一个默认角色、上传参考图或生成自己的角色。', 'A default character is ready. Generate the storyboard now, or choose another character, upload a reference, or generate your own.')}
      suggestions={videoReady
        ? [l('让 Agent 重新生成视频', 'Ask Agent to regenerate video')]
        : storyboardReady
          ? [l('让 Agent 生成视频', 'Ask Agent to generate video')]
          : characterReady
            ? [l('让 Agent 生成分镜', 'Ask Agent to generate storyboard')]
            : [l('让 Agent 生成角色', 'Ask Agent to generate character')]}
      placeholder={props.promptHint ?? l('描述角色、故事或生成要求', 'Describe the character, story, or generation requirements')}
      contentClassName="stickman-workspace-content"
      onBack={props.onBack}
      onCommand={handleCommand}
    >
      <div className="creator-tool-stack stickman-tool-stack">
        <nav className="video-translation-steps creator-tool-steps" aria-label={l('火柴人生成流程', 'Stick figure generation steps')}>
          <ol>
            {steps.map((step, index) => {
              const completed = index < currentStep;
              const active = index === currentStep;
              return (
                <li key={step} data-active={active} data-completed={completed}>
                  <button
                    type="button"
                    disabled={index > furthestStep}
                    aria-current={active ? 'step' : undefined}
                    onClick={() => index !== currentStep && setCurrentStep(index as StickmanStep)}
                  >
                    <span>{completed ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : index + 1}</span>
                    <strong>{step}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="stickman-step-scroll">

        {currentStep === 0 ? (
          <section className="creator-tool-panel" aria-labelledby="stickman-character-title">
          <div className="creator-tool-panel-heading">
            <div><span>{l('角色形象', 'Character')}</span><h2 id="stickman-character-title">{l('准备主角', 'Prepare the main character')}</h2><p>{l('选择默认角色，也可以生成或上传自己的角色', 'Choose a default character, or generate or upload your own')}</p></div>
            {characterReady ? <small><Check size={14} strokeWidth={2} />{selectedPreset ? l(`已选择${selectedPreset.nameZh}`, `${selectedPreset.nameEn} selected`) : l('已完成', 'Complete')}</small> : null}
          </div>
          <div className="creator-tool-segmented" role="tablist" aria-label={l('角色来源', 'Character source')}>
            <button type="button" role="tab" aria-selected={characterMode === 'preset'} onClick={() => setCharacterMode('preset')}>
              <PersonStanding size={15} strokeWidth={1.8} />{l('默认角色', 'Characters')}
            </button>
            <button type="button" role="tab" aria-selected={characterMode === 'generate'} onClick={() => setCharacterMode('generate')}>
              <Sparkles size={15} strokeWidth={1.8} />{l('生成角色', 'Generate')}
            </button>
            <button type="button" role="tab" aria-selected={characterMode === 'upload'} onClick={() => setCharacterMode('upload')}>
              <UploadCloud size={15} strokeWidth={1.8} />{l('上传角色', 'Upload')}
            </button>
          </div>
          {characterMode === 'preset' ? (
            <div className="stickman-character-picker">
              <div className="stickman-character-presets" role="radiogroup" aria-label={l('默认角色', 'Default characters')}>
                {characterPresets.map(preset => {
                  const selected = preset.id === selectedPresetId;
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      key={preset.id}
                      onClick={() => selectPreset(preset.id)}
                    >
                      <span className="stickman-character-preset-visual" aria-hidden="true">
                        <CharacterArtwork image={preset.image} alt="" />
                      </span>
                      <strong>{l(preset.nameZh, preset.nameEn)}</strong>
                      {selected ? <Check className="stickman-character-preset-check" size={15} strokeWidth={2.2} aria-hidden="true" /> : null}
                    </button>
                  );
                })}
              </div>
              {selectedPreset ? (
                <aside className="stickman-character-selected" aria-label={l('已选角色全身预览', 'Full view of selected character')}>
                  <div>
                    <CharacterArtwork
                      image={selectedPreset.image}
                      alt={l(selectedPreset.nameZh, selectedPreset.nameEn)}
                    />
                  </div>
                </aside>
              ) : null}
            </div>
          ) : characterMode === 'generate' ? (
            <div className="stickman-character-grid">
              <label className="creator-tool-field">
                <span>{l('角色描述', 'Character description')}</span>
                <textarea value={characterPrompt} onChange={event => updateCharacterPrompt(event.target.value)} rows={4} />
              </label>
              {characterGenerated ? (
                <div className="stickman-character-preview"><CharacterArtwork {...generatedCharacterImages} alt={l('生成的火柴人角色形象', 'Generated stick figure character')} /></div>
              ) : (
                <div className="stickman-character-empty"><ImagePlus size={24} strokeWidth={1.5} /><span>{l('角色设定图将在这里生成', 'The character sheet will appear here')}</span></div>
              )}
            </div>
          ) : (
            <div className="stickman-character-upload">
              <label className="creator-tool-upload">
                <input type="file" accept="image/*" aria-label={l('上传火柴人角色形象', 'Upload a stick figure character')} onChange={event => uploadCharacter(event.target.files?.[0] ?? null)} />
                {characterFile ? (
                  <><CharacterArtwork image={characterPreview || generatedCharacterImages.image} alt={l('上传的角色形象', 'Uploaded character')} /><strong>{characterFile.name}</strong><span>{l('点击重新选择', 'Click to choose another')}</span></>
                ) : (
                  <><UploadCloud size={25} strokeWidth={1.5} /><strong>{l('上传角色设定图', 'Upload character sheet')}</strong><span>{l('支持 PNG、JPG、WebP', 'Supports PNG, JPG, and WebP')}</span></>
                )}
              </label>
              <aside className="stickman-upload-guidance" aria-label={l('角色图片上传建议', 'Character image upload guidance')}>
                <Info size={16} strokeWidth={1.8} aria-hidden="true" />
                <div>
                  <strong>{l('上传建议', 'Upload guidance')}</strong>
                  <p>{l('人物全身完整可见，背景干净简洁，保持单人清晰且无遮挡。', 'Keep the full body visible, use a clean background, and provide one clear, unobstructed character.')}</p>
                </div>
              </aside>
            </div>
          )}
          </section>
        ) : null}

        {currentStep === 1 ? (
          <section className="creator-tool-panel" aria-labelledby="stickman-story-title">
          <div className="creator-tool-panel-heading"><div><span>{l('故事与画面', 'Story and visuals')}</span><h2 id="stickman-story-title">{l('生成分镜', 'Generate storyboard')}</h2><p>{l('角色会在所有镜头中保持一致', 'The character remains consistent across every shot')}</p></div></div>
          <label className="creator-tool-field stickman-story-field"><span>{l('故事创意', 'Story idea')}</span><textarea value={story} onChange={event => { setStory(event.target.value); setStoryboardReady(false); setVideoReady(false); setFurthestStep(hasSavedResults ? 2 : 1); }} rows={5} /></label>
          <div className="creator-tool-form-row">
            <label className="creator-tool-field"><span>{l('画面风格', 'Visual style')}</span><select value={style} onChange={event => { setStyle(event.target.value); setStoryboardReady(false); setVideoReady(false); setFurthestStep(hasSavedResults ? 2 : 1); }}><option value="手绘线稿">{l('手绘线稿', 'Hand-drawn line art')}</option><option value="漫画网点">{l('漫画网点', 'Manga halftone')}</option><option value="极简黑白">{l('极简黑白', 'Minimal black and white')}</option></select></label>
            <label className="creator-tool-field"><span>{l('视频比例', 'Video ratio')}</span><select value={ratio} onChange={event => { setRatio(event.target.value as typeof ratio); setStoryboardReady(false); setVideoReady(false); setFurthestStep(hasSavedResults ? 2 : 1); }}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
          </div>
          {storyboardReady ? (
            <div className="stickman-storyboard" aria-label={l('火柴人故事分镜', 'Stick figure storyboard')}>
              {storyboardShots.map((shot, index) => (
                <article key={shot.title}>
                  <div><img src="/dashboard/templates/ai-video-insane.jpg" alt="" /><span>{index + 1}</span></div>
                  <strong>{localizeShot(shot.title, l)}</strong><p>{localizeShot(shot.detail, l)}</p><small>{shot.duration}</small>
                </article>
              ))}
            </div>
          ) : null}
          </section>
        ) : null}

        {currentStep === 2 ? (
          hasSavedResults && selectedResult ? (
            <section className="video-result-workspace stickman-result-workspace" aria-label={l('火柴人项目产出', 'Stick figure project outputs')}>
              <div className="video-result-toolbar">
                <div className="video-result-tabs" role="tablist" aria-label={l('产出物类型', 'Output types')}>
                  {([
                    { value: 'video', label: l('成片', 'Final video'), icon: FileVideo },
                    { value: 'storyboard', label: l('分镜', 'Storyboard'), icon: PanelsTopLeft },
                    { value: 'character', label: l('角色', 'Character'), icon: PersonStanding },
                    { value: 'settings', label: l('任务设置', 'Task settings'), icon: Settings2 }
                  ] as const).map(tab => {
                    const Icon = tab.icon;
                    return (
                      <button type="button" role="tab" aria-selected={resultTab === tab.value} key={tab.value} onClick={() => setResultTab(tab.value)}>
                        <Icon size={15} strokeWidth={1.8} aria-hidden="true" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
                <CreatorResultVersionMenu
                  version={resultVersion}
                  versions={resultVersions.map(({ value, description }) => ({ value, description }))}
                  onVersionChange={selectResultVersion}
                />
              </div>

              {hasPendingChanges ? (
                <div className="stickman-version-draft" role="status">
                  <div>
                    <strong>{l(`正在基于 V${resultVersion} 调整`, `Adjusting from V${resultVersion}`)}</strong>
                    <span>{l('原版本的角色、分镜和成片仍可查看', 'The original character, storyboard, and video remain available')}</span>
                  </div>
                  <button type="button" onClick={storyboardReady ? generateVideo : () => setCurrentStep(1)}>
                    {storyboardReady ? l(`生成 V${nextVersion}`, `Generate V${nextVersion}`) : l('完善故事与分镜', 'Complete story and storyboard')}
                  </button>
                </div>
              ) : null}
              <CreatorTaskSummary
                compact
                sourceIcon={PersonStanding}
                sourceLabel={l('角色', 'Character')}
                sourceValue={resultCharacterName}
                items={[
                  { label: l('分镜', 'Storyboard'), value: l('4 个镜头', '4 shots') },
                  { label: l('画面风格', 'Visual style'), value: localizeShot(selectedResult.style, l) },
                  { label: l('视频比例', 'Video ratio'), value: selectedResult.ratio },
                  { label: l('当前版本', 'Version'), value: `V${selectedResult.value}` }
                ]}
              />

              {resultTab === 'video' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div><h2>{l('视频成片', 'Final video')}</h2><p>{l(`V${resultVersion} 已完成`, `V${resultVersion} completed`)}</p></div>
                    <button type="button" onClick={() => setNotice(l(`V${resultVersion} 已加入下载队列`, `V${resultVersion} added to the download queue`))}><Download size={15} strokeWidth={1.8} aria-hidden="true" />{l('下载视频', 'Download video')}</button>
                  </header>
                  <div className="stickman-video-result">
                    <div><img src="/dashboard/templates/ai-video-insane.jpg" alt={l('火柴人视频预览', 'Stick figure video preview')} /><span><Play size={22} fill="currentColor" /></span></div>
                    <section><h2>{l('火柴人动画', 'stick-figure-animation')}-V{resultVersion}.mp4</h2><p>{selectedResult.ratio} · 15 {l('秒', 'sec')} · {localizeShot(selectedResult.style, l)}</p></section>
                  </div>
                </div>
              ) : null}

              {resultTab === 'storyboard' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div><h2>{l('故事分镜', 'Storyboard')}</h2><p>{l('当前版本共 4 个关键镜头', 'Four key shots in this version')}</p></div>
                    <button type="button" onClick={() => setCurrentStep(1)}><PanelsTopLeft size={15} strokeWidth={1.8} aria-hidden="true" />{l('调整分镜', 'Adjust storyboard')}</button>
                  </header>
                  <div className="stickman-storyboard" aria-label={l(`V${resultVersion} 火柴人故事分镜`, `V${resultVersion} stick figure storyboard`)}>
                    {storyboardShots.map((shot, index) => (
                      <article key={shot.title}>
                        <div><img src="/dashboard/templates/ai-video-insane.jpg" alt="" /><span>{index + 1}</span></div>
                        <strong>{localizeShot(shot.title, l)}</strong><p>{localizeShot(shot.detail, l)}</p><small>{shot.duration}</small>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}

              {resultTab === 'character' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div><h2>{l('角色设定', 'Character')}</h2><p>{resultCharacterSource}</p></div>
                    <button type="button" onClick={() => setCurrentStep(0)}><PersonStanding size={15} strokeWidth={1.8} aria-hidden="true" />{l('更换角色', 'Change character')}</button>
                  </header>
                  <div className="stickman-result-character">
                    <div><CharacterArtwork image={resultCharacterImage} alt={resultCharacterName} /></div>
                    <section>
                      <h3>{resultCharacterName}</h3>
                      <p>{selectedResult.characterSource === 'generate' ? selectedResult.characterPrompt : resultCharacterSource}</p>
                    </section>
                  </div>
                </div>
              ) : null}

              {resultTab === 'settings' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div><h2>{l('当前版本设置', 'Current version settings')}</h2><p>{l('调整后会生成新版本，当前结果不会被覆盖', 'Changes create a new version without overwriting the current output')}</p></div>
                    <div className="video-result-pane-actions">
                      <button type="button" onClick={() => setCurrentStep(0)}><PersonStanding size={15} strokeWidth={1.8} aria-hidden="true" />{l('调整角色', 'Adjust character')}</button>
                      <button type="button" onClick={() => setCurrentStep(1)}><Settings2 size={15} strokeWidth={1.8} aria-hidden="true" />{l('调整故事与画面', 'Adjust story and visuals')}</button>
                    </div>
                  </header>
                  <dl className="video-result-settings">
                    <div><dt>{l('角色', 'Character')}</dt><dd>{resultCharacterName}</dd></div>
                    <div><dt>{l('画面风格', 'Visual style')}</dt><dd>{localizeShot(selectedResult.style, l)}</dd></div>
                    <div><dt>{l('视频比例', 'Video ratio')}</dt><dd>{selectedResult.ratio}</dd></div>
                    <div><dt>{l('视频时长', 'Duration')}</dt><dd>15 {l('秒', 'sec')}</dd></div>
                    <div className="stickman-result-story-setting"><dt>{l('故事创意', 'Story idea')}</dt><dd title={selectedResult.story}>{selectedResult.story}</dd></div>
                  </dl>
                </div>
              ) : null}
            </section>
          ) : (
            <div className="creator-task-final-grid">
              <section className="creator-tool-panel" aria-label={l('火柴人视频输出', 'Stick figure video output')}>
                <div className="stickman-result-toolbar">
                  <div><h2>{l('视频成片', 'Final video')}</h2><p>{l('确认分镜后生成第一版成片', 'Generate the first video after confirming the storyboard')}</p></div>
                </div>
                <div className="creator-tool-actions"><button className="creator-tool-primary" type="button" onClick={generateVideo}><Play size={16} />{l('根据分镜生成视频', 'Generate video from storyboard')}</button></div>
              </section>
              <CreatorTaskSummary
                sourceIcon={PersonStanding}
                sourceLabel={l('角色', 'Character')}
                sourceValue={taskCharacterName}
                items={[
                  { label: l('分镜', 'Storyboard'), value: l('4 个镜头', '4 shots') },
                  { label: l('画面风格', 'Visual style'), value: localizeShot(style, l) },
                  { label: l('视频比例', 'Video ratio'), value: ratio },
                  { label: l('视频时长', 'Duration'), value: l('15 秒', '15 sec') }
                ]}
                note={l('角色、故事与画面设置将用于生成成片', 'The character, story, and visual settings will be used for the final video')}
                noteIcon={PanelsTopLeft}
              />
            </div>
          )
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        </div>

        {currentStep < 2 ? (
          <footer className="video-translation-wizard-actions stickman-wizard-actions">
            {currentStep === 1 ? (
              <button className="video-translation-secondary-action" type="button" onClick={() => setCurrentStep(0)}>
                <ArrowLeft size={16} strokeWidth={1.8} aria-hidden="true" />
                {l('上一步', 'Back')}
              </button>
            ) : <span />}
            <div className="video-translation-action-group">
              {currentStep === 0 && characterMode === 'generate' ? (
                <button className="video-translation-secondary-action" type="button" onClick={generateCharacter}>
                  <Sparkles size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('生成角色形象', 'Generate character')}
                </button>
              ) : null}
              {currentStep === 0 ? (
                <button className="video-translation-primary-action" type="button" disabled={!characterReady} onClick={continueToStory}>
                  {l('下一步：故事与分镜', 'Next: Story and storyboard')}
                  <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : (
                <button className="video-translation-primary-action" type="button" disabled={!characterReady || !story.trim()} onClick={storyboardReady ? continueToVideo : generateStoryboard}>
                  {storyboardReady ? l('下一步：生成视频', 'Next: Generate video') : l('生成分镜图', 'Generate storyboard')}
                  {storyboardReady ? <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" /> : null}
                </button>
              )}
            </div>
          </footer>
        ) : null}
      </div>
    </CreatorToolShell>
  );
}

function CharacterArtwork(props: {
  image: string;
  alt: string;
}) {
  return (
    <img
      className="stickman-character-artwork"
      src={props.image}
      alt={props.alt}
    />
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

function createVersionSignature(input: {
  characterSource: CharacterSource;
  selectedPresetId: CharacterPresetId | null;
  characterPrompt: string;
  characterFile: File | null;
  characterGenerated: boolean;
  story: string;
  ratio: '16:9' | '9:16' | '1:1';
  style: string;
}) {
  const file = input.characterSource === 'upload' && input.characterFile
    ? {
        name: input.characterFile.name,
        size: input.characterFile.size,
        type: input.characterFile.type,
        lastModified: input.characterFile.lastModified
      }
    : null;

  return JSON.stringify({
    characterSource: input.characterSource,
    selectedPresetId: input.characterSource === 'preset' ? input.selectedPresetId : null,
    characterPrompt: input.characterSource === 'generate' ? input.characterPrompt.trim() : '',
    characterGenerated: input.characterSource === 'generate' ? input.characterGenerated : false,
    file,
    story: input.story.trim(),
    ratio: input.ratio,
    style: input.style
  });
}
