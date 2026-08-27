import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Eye,
  FileVideo,
  ImagePlus,
  Info,
  Music2,
  PanelsTopLeft,
  PersonStanding,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  UploadCloud,
  Volume2,
  X
} from 'lucide-react';
import CreatorToolShell from './CreatorToolShell.js';
import CreatorResultVersionMenu from './CreatorResultVersionMenu.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useOptionalCreatorSession } from './creator-session-store.js';

const storyboardShots = [
  {
    titleZh: '建立场景',
    titleEn: 'Establish the scene',
    subtitleZh: '灵感来了，就别让它从手中溜走。',
    subtitleEn: 'When inspiration arrives, do not let it slip away.',
    visualZh: '角色站在城市天台，远景缓慢推进，风吹动围巾和手中的创意手稿。',
    visualEn: 'The character stands on a city rooftop as the wide shot slowly pushes in, with the wind moving the scarf and manuscript.',
    duration: '0-3s'
  },
  {
    titleZh: '冲突出现',
    titleEn: 'Conflict appears',
    subtitleZh: '风把手稿卷向城市上空。',
    subtitleEn: 'The wind carries the manuscript above the city.',
    visualZh: '一阵强风吹走角色手中的纸张，角色转身快速追赶，画面表现突然发生的动作。',
    visualEn: 'A strong gust carries the paper away, and the character turns to chase it as the action begins suddenly.',
    duration: '3-7s'
  },
  {
    titleZh: '动作高潮',
    titleEn: 'Action climax',
    subtitleZh: '再高的障碍，也拦不住这次追赶。',
    subtitleEn: 'No obstacle can stop this chase.',
    visualZh: '角色越过天台障碍，在空中伸手抓向纸张，使用有速度感的动态构图。',
    visualEn: 'The character clears a rooftop obstacle and reaches for the paper in midair, using a dynamic composition with a sense of speed.',
    duration: '7-12s'
  },
  {
    titleZh: '结尾定格',
    titleEn: 'Final freeze frame',
    subtitleZh: '抓住手稿，也抓住了最重要的想法。',
    subtitleEn: 'The manuscript is safe, along with the idea that matters most.',
    visualZh: '角色平稳落地并举起找回的手稿，镜头定格，结尾轻松而有成就感。',
    visualEn: 'The character lands safely and raises the recovered manuscript as the frame freezes on a relaxed, accomplished ending.',
    duration: '12-15s'
  }
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
type StickmanStep = 0 | 1 | 2 | 3;
type CharacterSource = 'preset' | 'generate' | 'upload';
type StickmanResultTab = 'video' | 'storyboard' | 'character' | 'settings';
type VoiceLanguage = 'auto' | 'zh-CN' | 'en-US';
type VoiceTone = 'natural' | 'energetic' | 'calm';
type StoryboardDialogState = { shotIndex: number; mode: 'view' | 'regenerate' };

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
  storyboardSubtitles: string[];
  storyboardImageVersions: number[];
  storyboardPromptOverrides: Array<string | null>;
  voiceover: boolean;
  voiceLanguage: VoiceLanguage;
  voiceTone: VoiceTone;
  backgroundMusic: File | null;
  backgroundMusicVolume: number;
};

export default function StickmanVideoWorkspace(props: { onBack(): void; promptHint?: string }) {
  const l = useLocalizedCopy();
  const { language } = useAppLanguage();
  const session = useOptionalCreatorSession();
  const draftInitializedRef = useRef(false);
  const [characterMode, setCharacterMode] = useState<CharacterSource>('preset');
  const [characterSource, setCharacterSource] = useState<CharacterSource>('preset');
  const [selectedPresetId, setSelectedPresetId] = useState<CharacterPresetId | null>('default');
  const [characterPrompt, setCharacterPrompt] = useState(() => typeof session?.state.characterPrompt === 'string' ? session.state.characterPrompt : l(characterPromptZh, characterPromptEn));
  const [characterFile, setCharacterFile] = useState<File | null>(null);
  const [characterPreview, setCharacterPreview] = useState('');
  const [characterGenerated, setCharacterGenerated] = useState(false);
  const [story, setStory] = useState(() => typeof session?.state.topic === 'string' ? session.state.topic : l(storyZh, storyEn));
  const [ratio, setRatio] = useState<'16:9' | '9:16' | '1:1'>(() => session?.state.ratio === '9:16' || session?.state.ratio === '1:1' ? session.state.ratio : '16:9');
  const [style, setStyle] = useState(() => typeof session?.state.style === 'string' ? session.state.style : '手绘线稿');
  const [storyboardSubtitles, setStoryboardSubtitles] = useState(() => storyboardShots.map(shot => l(shot.subtitleZh, shot.subtitleEn)));
  const [storyboardImageVersions, setStoryboardImageVersions] = useState(() => storyboardShots.map(() => 0));
  const [storyboardPromptOverrides, setStoryboardPromptOverrides] = useState<Array<string | null>>(() => storyboardShots.map(() => null));
  const [voiceover, setVoiceover] = useState(true);
  const [voiceLanguage, setVoiceLanguage] = useState<VoiceLanguage>('auto');
  const [voiceTone, setVoiceTone] = useState<VoiceTone>('natural');
  const [backgroundMusic, setBackgroundMusic] = useState<File | null>(null);
  const [backgroundMusicVolume, setBackgroundMusicVolume] = useState(25);
  const [storyboardReady, setStoryboardReady] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [notice, setNotice] = useState('');
  const [currentStep, setCurrentStep] = useState<StickmanStep>(0);
  const [furthestStep, setFurthestStep] = useState<StickmanStep>(0);
  const [resultVersions, setResultVersions] = useState<StickmanResultVersion[]>([]);
  const [resultVersion, setResultVersion] = useState(0);
  const [resultTab, setResultTab] = useState<StickmanResultTab>('video');
  const [audioEditing, setAudioEditing] = useState(false);
  const [storyboardDialog, setStoryboardDialog] = useState<StoryboardDialogState | null>(null);
  const selectedPreset = characterPresets.find(preset => preset.id === selectedPresetId);
  const characterReady = characterSource === 'preset'
    ? selectedPreset !== undefined
    : characterSource === 'generate'
      ? characterGenerated
      : characterFile !== null;
  const steps = [l('选择角色', 'Choose character'), l('故事与分镜', 'Story and storyboard'), l('确认分镜', 'Review storyboard'), l('配音与音乐', 'Voice and music')];
  const currentSignature = createVersionSignature({
    characterSource,
    selectedPresetId,
    characterPrompt,
    characterFile,
    characterGenerated,
    story,
    ratio,
    style,
    storyboardSubtitles,
    storyboardImageVersions,
    storyboardPromptOverrides,
    voiceover,
    voiceLanguage,
    voiceTone,
    backgroundMusic,
    backgroundMusicVolume
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
  const taskVoiceover = voiceover
    ? `${voiceLanguageLabel(voiceLanguage, l)} · ${voiceToneLabel(voiceTone, l)}`
    : l('关闭', 'Off');
  const taskBackgroundMusic = backgroundMusic
    ? `${backgroundMusic.name} · ${backgroundMusicVolume}%`
    : l('未添加', 'Not added');
  const resultVoiceover = selectedResult?.voiceover
    ? `${voiceLanguageLabel(selectedResult.voiceLanguage, l)} · ${voiceToneLabel(selectedResult.voiceTone, l)}`
    : l('关闭', 'Off');
  const resultBackgroundMusic = selectedResult?.backgroundMusic
    ? `${selectedResult.backgroundMusic.name} · ${selectedResult.backgroundMusicVolume}%`
    : l('未添加', 'Not added');

  useEffect(() => {
    setCharacterPrompt(current => current === characterPromptZh || current === characterPromptEn
      ? l(characterPromptZh, characterPromptEn)
      : current);
    setStory(current => current === storyZh || current === storyEn
      ? l(storyZh, storyEn)
      : current);
    setStoryboardSubtitles(current => current.map((subtitle, index) => {
      const shot = storyboardShots[index];
      if (!shot || (subtitle !== shot.subtitleZh && subtitle !== shot.subtitleEn)) return subtitle;
      return l(shot.subtitleZh, shot.subtitleEn);
    }));
  }, [l, language]);

  useEffect(() => {
    if (session === null) return;
    session.updateDraft({
      topic: story,
      characterPrompt,
      ratio,
      style,
      targetDurationSeconds: 30
    }, { persist: draftInitializedRef.current });
    draftInitializedRef.current = true;
  }, [characterPrompt, ratio, session?.updateDraft, story, style]);

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
    setFurthestStep(hasSavedResults ? 3 : 0);
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
    setFurthestStep(hasSavedResults ? 3 : 0);
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
    setFurthestStep(hasSavedResults ? 3 : 0);
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
    setFurthestStep(hasSavedResults ? 3 : 0);
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
    if (session !== null) {
      void session.applyAction({ actor: 'user', action: 'run-stage', input: { stageId: 'storyboard' } });
    }
    setCurrentStep(2);
    setFurthestStep(2);
    setStoryboardSubtitles(storyboardShots.map(shot => l(shot.subtitleZh, shot.subtitleEn)));
    setStoryboardImageVersions(storyboardShots.map(() => 0));
    setStoryboardPromptOverrides(storyboardShots.map(() => null));
    setStoryboardReady(true);
    setVideoReady(false);
    setNotice(l(`已生成 ${storyboardShots.length} 个关键分镜，请确认后生成视频`, `Generated ${storyboardShots.length} key storyboard shots. Review them before creating the video.`));
    return true;
  }

  function generateVideo() {
    if (!storyboardReady) {
      setCurrentStep(characterReady ? 1 : 0);
      setFurthestStep(hasSavedResults ? 3 : characterReady ? 1 : 0);
      setNotice(l('请先生成并确认分镜图', 'Generate and review the storyboard first'));
      return false;
    }
    if (session !== null) {
      void session.applyAction({ actor: 'user', action: 'run-stage', input: { stageId: 'render' } });
    }
    if (selectedResult?.signature === currentSignature) {
      setCurrentStep(3);
      setFurthestStep(3);
      setAudioEditing(false);
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
        style,
        storyboardSubtitles,
        storyboardImageVersions,
        storyboardPromptOverrides,
        voiceover,
        voiceLanguage,
        voiceTone,
        backgroundMusic,
        backgroundMusicVolume
      }
    ]);
    setResultVersion(version);
    setResultTab('video');
    setCurrentStep(3);
    setFurthestStep(3);
    setAudioEditing(false);
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
    setStoryboardSubtitles(result.storyboardSubtitles);
    setStoryboardImageVersions(result.storyboardImageVersions);
    setStoryboardPromptOverrides(result.storyboardPromptOverrides);
    setVoiceover(result.voiceover);
    setVoiceLanguage(result.voiceLanguage);
    setVoiceTone(result.voiceTone);
    setBackgroundMusic(result.backgroundMusic);
    setBackgroundMusicVolume(result.backgroundMusicVolume);
    setStoryboardReady(true);
    setVideoReady(true);
    setCurrentStep(3);
    setFurthestStep(3);
    setAudioEditing(false);
    setNotice('');
  }

  function updateStoryboardSubtitle(index: number, value: string) {
    setStoryboardSubtitles(current => current.map((subtitle, itemIndex) => itemIndex === index ? value : subtitle));
    setVideoReady(false);
  }

  function regenerateStoryboardImage(index: number, prompt: string) {
    setStoryboardImageVersions(current => current.map((version, itemIndex) => itemIndex === index ? version + 1 : version));
    setStoryboardPromptOverrides(current => current.map((value, itemIndex) => itemIndex === index ? prompt.trim() : value));
    setVideoReady(false);
    setNotice(l(`分镜 ${index + 1} 的图片已重新生成`, `The image for shot ${index + 1} has been regenerated.`));
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

  function continueToAudio() {
    if (!storyboardReady) {
      setCurrentStep(1);
      setNotice(l('请先生成并确认分镜图', 'Generate and review the storyboard first'));
      return;
    }
    setAudioEditing(true);
    setCurrentStep(3);
    setFurthestStep(3);
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
      return generateStoryboard() ? l(`${storyboardShots.length} 个关键分镜已生成，请在左侧检查镜头和节奏。`, `${storyboardShots.length} key shots are ready. Review the scenes and pacing on the left.`) : l('需要先准备角色形象和故事创意。', 'Prepare a character and story idea first.');
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
      setFurthestStep(hasSavedResults ? 3 : 1);
      return l('已把这段内容作为故事创意同步到左侧。准备好角色后即可生成分镜。', 'This is now the story idea on the left. Once the character is ready, generate the storyboard.');
    }
    return l('你可以描述角色外观和故事，也可以直接让我生成角色、分镜或视频。', 'Describe the character and story, or ask me to generate the character, storyboard, or video.');
  }

  const context = videoReady
    ? l(`视频已完成，${ratio}`, `Video complete, ${ratio}`)
    : storyboardReady
      ? l(`${storyboardShots.length} 个分镜，${ratio}`, `${storyboardShots.length} storyboard shots, ${ratio}`)
      : characterReady
        ? l('角色已准备，等待分镜', 'Character ready, waiting for storyboard')
        : l('等待角色形象', 'Waiting for a character');
  const dialogShot = storyboardDialog ? storyboardShots[storyboardDialog.shotIndex] : undefined;

  return (
    <>
      <CreatorToolShell
      title={l('火柴人动画', 'Stick Figure Animation')}
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
          <section className="creator-tool-panel stickman-story-panel" aria-labelledby="stickman-story-title">
          <div className="creator-tool-panel-heading"><div><span>{l('故事与画面', 'Story and visuals')}</span><h2 id="stickman-story-title">{l('生成分镜', 'Generate storyboard')}</h2><p>{l('角色会在所有镜头中保持一致', 'The character remains consistent across every shot')}</p></div></div>
          <label className="creator-tool-field stickman-story-field"><span>{l('故事创意', 'Story idea')}</span><textarea value={story} onChange={event => { setStory(event.target.value); setStoryboardReady(false); setVideoReady(false); setFurthestStep(hasSavedResults ? 3 : 1); }} rows={5} /></label>
          <div className="creator-tool-form-row">
            <label className="creator-tool-field"><span>{l('画面风格', 'Visual style')}</span><select value={style} onChange={event => { setStyle(event.target.value); setStoryboardReady(false); setVideoReady(false); setFurthestStep(hasSavedResults ? 3 : 1); }}><option value="手绘线稿">{l('手绘线稿', 'Hand-drawn line art')}</option><option value="漫画网点">{l('漫画网点', 'Manga halftone')}</option><option value="极简黑白">{l('极简黑白', 'Minimal black and white')}</option></select></label>
            <label className="creator-tool-field"><span>{l('视频比例', 'Video ratio')}</span><select value={ratio} onChange={event => { setRatio(event.target.value as typeof ratio); setStoryboardReady(false); setVideoReady(false); setFurthestStep(hasSavedResults ? 3 : 1); }}><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
          </div>
          </section>
        ) : null}

        {currentStep === 2 ? (
          <div className="stickman-storyboard-step">
            {hasSavedResults && hasPendingChanges ? (
              <div className="stickman-version-draft" role="status">
                <div>
                  <strong>{l(`正在基于 V${resultVersion} 调整`, `Adjusting from V${resultVersion}`)}</strong>
                  <span>{l('原版本的角色、分镜和成片仍可查看', 'The original character, storyboard, and video remain available')}</span>
                </div>
              </div>
            ) : null}
            <section className="creator-tool-panel stickman-storyboard-review" aria-labelledby="stickman-storyboard-review-title">
              <div className="creator-tool-panel-heading">
                <div><span>{l('故事分镜', 'Storyboard')}</span><h2 id="stickman-storyboard-review-title">{l('确认故事分镜', 'Review storyboard')}</h2><p>{l('逐镜头修改字幕，或重新生成不合适的画面', 'Edit each subtitle or regenerate any image that does not fit')}</p></div>
              </div>
              <StickmanStoryboard
                ariaLabel={l('待确认的火柴人故事分镜', 'Stick figure storyboard to review')}
                subtitles={storyboardSubtitles}
                imageVersions={storyboardImageVersions}
                editable
                l={l}
                onSubtitleChange={updateStoryboardSubtitle}
                onRegenerateRequest={index => setStoryboardDialog({ shotIndex: index, mode: 'regenerate' })}
                onViewPrompt={index => setStoryboardDialog({ shotIndex: index, mode: 'view' })}
              />
            </section>
          </div>
        ) : null}

        {currentStep === 3 ? (
          hasSavedResults && selectedResult && !audioEditing ? (
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
              <div className="creator-result-layout">

              {resultTab === 'video' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div><h2>{l('视频成片', 'Final video')}</h2><p>{l(`V${resultVersion} 已完成`, `V${resultVersion} completed`)}</p></div>
                    <button type="button" onClick={() => setNotice(l(`V${resultVersion} 已加入下载队列`, `V${resultVersion} added to the download queue`))}><Download size={15} strokeWidth={1.8} aria-hidden="true" />{l('下载视频', 'Download video')}</button>
                  </header>
                  <div className="stickman-video-result">
                    <div><img src="/dashboard/templates/ai-video-insane.jpg" alt={l('火柴人动画预览', 'Stick figure animation preview')} /><span><Play size={22} fill="currentColor" /></span></div>
                    <section><h2>{l('火柴人动画', 'stick-figure-animation')}-V{resultVersion}.mp4</h2><p>{selectedResult.ratio} · 15 {l('秒', 'sec')} · {localizeShot(selectedResult.style, l)} · {selectedResult.voiceover ? l('含配音', 'Voiceover') : l('无配音', 'No voiceover')}</p></section>
                  </div>
                </div>
              ) : null}

              {resultTab === 'storyboard' ? (
                <div className="video-result-pane">
                  <header className="video-result-pane-heading">
                    <div><h2>{l('故事分镜', 'Storyboard')}</h2><p>{l(`当前版本共 ${storyboardShots.length} 个关键镜头`, `${storyboardShots.length} key shots in this version`)}</p></div>
                    <button type="button" onClick={() => setCurrentStep(2)}><PanelsTopLeft size={15} strokeWidth={1.8} aria-hidden="true" />{l('调整分镜', 'Adjust storyboard')}</button>
                  </header>
                  <StickmanStoryboard
                    ariaLabel={l(`V${resultVersion} 火柴人故事分镜`, `V${resultVersion} stick figure storyboard`)}
                    subtitles={selectedResult.storyboardSubtitles}
                    imageVersions={selectedResult.storyboardImageVersions}
                    l={l}
                  />
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
                      <button type="button" onClick={() => { setAudioEditing(true); setCurrentStep(3); }}><Volume2 size={15} strokeWidth={1.8} aria-hidden="true" />{l('调整配音与音乐', 'Adjust voice and music')}</button>
                    </div>
                  </header>
                  <dl className="video-result-settings">
                    <div><dt>{l('角色', 'Character')}</dt><dd>{resultCharacterName}</dd></div>
                    <div><dt>{l('画面风格', 'Visual style')}</dt><dd>{localizeShot(selectedResult.style, l)}</dd></div>
                    <div><dt>{l('视频比例', 'Video ratio')}</dt><dd>{selectedResult.ratio}</dd></div>
                    <div><dt>{l('视频时长', 'Duration')}</dt><dd>15 {l('秒', 'sec')}</dd></div>
                    <div><dt>{l('配音', 'Voiceover')}</dt><dd>{resultVoiceover}</dd></div>
                    <div><dt>{l('背景音乐', 'Music')}</dt><dd>{resultBackgroundMusic}</dd></div>
                    <div className="stickman-result-story-setting"><dt>{l('故事创意', 'Story idea')}</dt><dd title={selectedResult.story}>{selectedResult.story}</dd></div>
                  </dl>
                </div>
              ) : null}
                <CreatorTaskSummary
                  sourceIcon={PersonStanding}
                  sourceLabel={l('角色', 'Character')}
                  sourceValue={resultCharacterName}
                  items={[
                    { label: l('分镜', 'Storyboard'), value: l(`${storyboardShots.length} 个镜头`, `${storyboardShots.length} shots`) },
                    { label: l('画面风格', 'Visual style'), value: localizeShot(selectedResult.style, l) },
                    { label: l('视频比例', 'Video ratio'), value: selectedResult.ratio },
                    { label: l('配音', 'Voiceover'), value: resultVoiceover },
                    { label: l('背景音乐', 'Music'), value: resultBackgroundMusic },
                    { label: l('当前版本', 'Version'), value: `V${selectedResult.value}` }
                  ]}
                />
              </div>
            </section>
          ) : (
            <div className="creator-task-final-grid">
              {hasSavedResults && hasPendingChanges ? (
                <div className="stickman-version-draft" role="status">
                  <div>
                    <strong>{l(`正在基于 V${resultVersion} 调整`, `Adjusting from V${resultVersion}`)}</strong>
                    <span>{l('原版本的角色、分镜和成片仍可查看', 'The original character, storyboard, and video remain available')}</span>
                  </div>
                </div>
              ) : null}
              <section className="creator-tool-panel stickman-audio-panel" aria-labelledby="stickman-audio-title">
                <div className="creator-tool-panel-heading">
                  <div><span>{l('音频设置', 'Audio settings')}</span><h2 id="stickman-audio-title">{l('配音与音乐', 'Voice and music')}</h2><p>{l('为成片添加旁白，也可以上传背景音乐', 'Add narration and optionally upload background music')}</p></div>
                </div>
                <div className="stickman-audio-settings">
                  <div className="stickman-audio-layout">
                    <div className="stickman-voice-settings">
                      <StickmanSwitch
                        checked={voiceover}
                        label={l('生成旁白配音', 'Generate narration')}
                        description={l('根据故事内容自动生成旁白', 'Generate narration from the story')}
                        onChange={value => { setVoiceover(value); setVideoReady(false); }}
                      />
                      {voiceover ? (
                        <div className="creator-tool-form-row">
                          <label className="creator-tool-field"><span>{l('配音语言', 'Voice language')}</span><select aria-label={l('配音语言', 'Voice language')} value={voiceLanguage} onChange={event => { setVoiceLanguage(event.target.value as VoiceLanguage); setVideoReady(false); }}><option value="auto">{l('自动匹配', 'Auto match')}</option><option value="zh-CN">{l('中文', 'Chinese')}</option><option value="en-US">English</option></select></label>
                          <label className="creator-tool-field"><span>{l('配音音色', 'Voice tone')}</span><select aria-label={l('配音音色', 'Voice tone')} value={voiceTone} onChange={event => { setVoiceTone(event.target.value as VoiceTone); setVideoReady(false); }}><option value="natural">{l('自然叙事', 'Natural narration')}</option><option value="energetic">{l('活力青年', 'Energetic')}</option><option value="calm">{l('沉稳讲述', 'Calm')}</option></select></label>
                        </div>
                      ) : null}
                    </div>
                    <div className="stickman-music-settings">
                      <div className="stickman-music-heading"><Music2 size={16} strokeWidth={1.8} aria-hidden="true" /><span><strong>{l('背景音乐', 'Background music')}</strong><small>{l('选填', 'Optional')}</small></span></div>
                      <div className="stickman-music-upload-row">
                        <label className="creator-tool-upload stickman-music-upload">
                          <input type="file" accept="audio/*" aria-label={l('上传背景音乐', 'Upload background music')} onChange={event => { setBackgroundMusic(event.target.files?.[0] ?? null); setVideoReady(false); }} />
                          <UploadCloud size={20} strokeWidth={1.6} aria-hidden="true" />
                          <strong>{backgroundMusic?.name ?? l('上传背景音乐', 'Upload background music')}</strong>
                          <span>{backgroundMusic ? l('点击更换音频', 'Click to replace audio') : l('支持 MP3、WAV、M4A', 'Supports MP3, WAV, and M4A')}</span>
                        </label>
                        {backgroundMusic ? <button className="stickman-music-remove" type="button" onClick={() => { setBackgroundMusic(null); setVideoReady(false); }} aria-label={l('移除背景音乐', 'Remove background music')}><X size={16} strokeWidth={1.8} aria-hidden="true" /></button> : null}
                      </div>
                      {backgroundMusic ? (
                        <label className="stickman-music-volume">
                          <span>{l('音乐音量', 'Music volume')} <output>{backgroundMusicVolume}%</output></span>
                          <input type="range" min="0" max="100" step="5" value={backgroundMusicVolume} aria-label={l('背景音乐音量', 'Background music volume')} onChange={event => { setBackgroundMusicVolume(Number(event.target.value)); setVideoReady(false); }} />
                        </label>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
              <CreatorTaskSummary
                sourceIcon={PersonStanding}
                sourceLabel={l('角色', 'Character')}
                sourceValue={taskCharacterName}
                items={[
                  { label: l('分镜', 'Storyboard'), value: l(`${storyboardShots.length} 个镜头`, `${storyboardShots.length} shots`) },
                  { label: l('画面风格', 'Visual style'), value: localizeShot(style, l) },
                  { label: l('视频比例', 'Video ratio'), value: ratio },
                  { label: l('配音', 'Voiceover'), value: taskVoiceover },
                  { label: l('背景音乐', 'Music'), value: taskBackgroundMusic },
                  { label: l('视频时长', 'Duration'), value: l('15 秒', '15 sec') }
                ]}
                note={l('分镜、配音与音乐设置将用于生成成片', 'Storyboard, voice, and music settings will be used for the final video')}
                noteIcon={Volume2}
              />
            </div>
          )
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        </div>

        {currentStep < 3 || audioEditing || !hasSavedResults ? (
          <footer className="video-translation-wizard-actions stickman-wizard-actions">
            {currentStep > 0 ? (
              <button className="video-translation-secondary-action" type="button" onClick={() => setCurrentStep((currentStep - 1) as StickmanStep)}>
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
              ) : currentStep === 1 ? (
                <button className="video-translation-primary-action" type="button" disabled={!characterReady || !story.trim()} onClick={storyboardReady ? continueToVideo : generateStoryboard}>
                  {storyboardReady ? l('下一步：查看分镜', 'Next: Review storyboard') : l('生成分镜图', 'Generate storyboard')}
                  {storyboardReady ? <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" /> : null}
                </button>
              ) : currentStep === 2 ? (
                <button className="video-translation-primary-action" type="button" onClick={continueToAudio}>
                  {l('下一步：配音与音乐', 'Next: Voice and music')}
                  <ArrowRight size={16} strokeWidth={1.8} aria-hidden="true" />
                </button>
              ) : (
                <button className="video-translation-primary-action" type="button" onClick={generateVideo}>
                  <Play size={16} strokeWidth={1.8} aria-hidden="true" />
                  {hasSavedResults ? l(`生成 V${nextVersion}`, `Generate V${nextVersion}`) : l('根据分镜生成视频', 'Generate video from storyboard')}
                </button>
              )}
            </div>
          </footer>
        ) : null}
      </div>
      </CreatorToolShell>
      {storyboardDialog && dialogShot ? (
        <StickmanPromptDialog
          mode={storyboardDialog.mode}
          shot={dialogShot}
          shotIndex={storyboardDialog.shotIndex}
          story={story}
          characterName={taskCharacterName}
          style={localizeShot(style, l)}
          ratio={ratio}
          promptOverride={storyboardPromptOverrides[storyboardDialog.shotIndex]}
          l={l}
          onClose={() => setStoryboardDialog(null)}
          onRegenerate={prompt => {
            regenerateStoryboardImage(storyboardDialog.shotIndex, prompt);
            setStoryboardDialog(null);
          }}
        />
      ) : null}
    </>
  );
}

function StickmanSwitch(props: {
  checked: boolean;
  label: string;
  description: string;
  onChange(checked: boolean): void;
}) {
  return (
    <div className="video-translation-toggle-row">
      <span><strong>{props.label}</strong><small>{props.description}</small></span>
      <button className="video-translation-switch" type="button" role="switch" aria-checked={props.checked} aria-label={props.label} onClick={() => props.onChange(!props.checked)}><span /></button>
    </div>
  );
}

function StickmanStoryboard(props: {
  ariaLabel: string;
  subtitles: string[];
  imageVersions: number[];
  editable?: boolean;
  l: ReturnType<typeof useLocalizedCopy>;
  onSubtitleChange?(index: number, value: string): void;
  onRegenerateRequest?(index: number): void;
  onViewPrompt?(index: number): void;
}) {
  return (
    <div className="stickman-storyboard-editor" aria-label={props.ariaLabel}>
      {storyboardShots.map((shot, index) => {
        const imageVersion = props.imageVersions[index] ?? 0;
        const title = props.l(shot.titleZh, shot.titleEn);
        return (
          <article className="stickman-storyboard-row" key={shot.titleZh}>
            <div className="stickman-storyboard-meta">
              <strong>{title}</strong>
              <small>{shot.duration}</small>
            </div>
            <div className="stickman-storyboard-media">
              <div className="stickman-storyboard-image">
                <img
                  src={`/dashboard/templates/ai-video-insane.jpg?shot=${index + 1}&version=${imageVersion}`}
                  alt={props.l(`分镜 ${index + 1}：${title}`, `Shot ${index + 1}: ${title}`)}
                  data-image-version={imageVersion}
                  style={{ objectPosition: storyboardImagePosition(index, imageVersion) }}
                />
                <span aria-hidden="true">{index + 1}</span>
              </div>
              {props.editable ? (
                <div className="stickman-storyboard-actions">
                  <button
                    className="stickman-storyboard-regenerate"
                    type="button"
                    aria-label={props.l(`重新生成分镜 ${index + 1} 图片`, `Regenerate image for shot ${index + 1}`)}
                    onClick={() => props.onRegenerateRequest?.(index)}
                  >
                    <RefreshCw size={12} strokeWidth={1.8} aria-hidden="true" />
                    {props.l('重新生成', 'Regenerate')}
                  </button>
                  <button
                    className="stickman-storyboard-prompt"
                    type="button"
                    aria-label={props.l(`查看分镜 ${index + 1} 提示词`, `View prompt for shot ${index + 1}`)}
                    onClick={() => props.onViewPrompt?.(index)}
                  >
                    <Eye size={12} strokeWidth={1.8} aria-hidden="true" />
                    {props.l('查看提示词', 'View prompt')}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="stickman-storyboard-copy">
              {props.editable ? (
                <label className="creator-tool-field stickman-storyboard-subtitle">
                  <textarea
                    aria-label={props.l(`分镜 ${index + 1} 字幕`, `Subtitle for shot ${index + 1}`)}
                    rows={2}
                    value={props.subtitles[index] ?? ''}
                    onChange={event => props.onSubtitleChange?.(index, event.target.value)}
                  />
                </label>
              ) : (
                <div className="stickman-storyboard-readonly-subtitle">
                  <p>{props.subtitles[index]}</p>
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

function StickmanPromptDialog(props: {
  mode: 'view' | 'regenerate';
  shot: (typeof storyboardShots)[number];
  shotIndex: number;
  story: string;
  characterName: string;
  style: string;
  ratio: '16:9' | '9:16' | '1:1';
  promptOverride?: string | null;
  l: ReturnType<typeof useLocalizedCopy>;
  onClose(): void;
  onRegenerate(prompt: string): void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(props.onClose);
  const [prompt, setPrompt] = useState(() => props.promptOverride ?? createStoryboardImagePrompt(props));

  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  useEffect(() => {
    const previousFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button, textarea, [tabindex]:not([tabindex="-1"])') ?? [])
        .filter(element => !element.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocused?.focus();
    };
  }, []);

  return createPortal(
    <div
      className="stickman-prompt-backdrop"
      onMouseDown={event => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="stickman-prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="stickman-prompt-dialog-title"
      >
        <header>
          <div>
            <span>{props.l(`分镜 ${props.shotIndex + 1}，${props.shot.titleZh}，${props.shot.duration}`, `Shot ${props.shotIndex + 1}, ${props.shot.titleEn}, ${props.shot.duration}`)}</span>
            <h2 id="stickman-prompt-dialog-title">
              {props.mode === 'regenerate' ? props.l('重新生成图片', 'Regenerate image') : props.l('画面提示词', 'Image prompt')}
            </h2>
          </div>
          <button ref={closeRef} type="button" aria-label={props.l('关闭提示词', 'Close prompt')} onClick={props.onClose}>
            <X size={17} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </header>
        <label className="stickman-prompt-content">
          <span>{props.mode === 'regenerate' ? props.l('可编辑提示词', 'Editable prompt') : props.l('完整提示词', 'Full prompt')}</span>
          <textarea
            readOnly={props.mode === 'view'}
            rows={10}
            aria-label={props.l(`分镜 ${props.shotIndex + 1} 画面提示词`, `Image prompt for shot ${props.shotIndex + 1}`)}
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
          />
        </label>
        <footer>
          {props.mode === 'regenerate' ? (
            <>
              <button className="is-secondary" type="button" onClick={props.onClose}>{props.l('取消', 'Cancel')}</button>
              <button className="is-primary" type="button" disabled={!prompt.trim()} onClick={() => props.onRegenerate(prompt)}>{props.l('确认重新生成', 'Confirm regeneration')}</button>
            </>
          ) : (
            <button className="is-secondary" type="button" onClick={props.onClose}>{props.l('关闭', 'Close')}</button>
          )}
        </footer>
      </section>
    </div>,
    document.body
  );
}

function createStoryboardImagePrompt(input: {
  shot: (typeof storyboardShots)[number];
  story: string;
  characterName: string;
  style: string;
  ratio: '16:9' | '9:16' | '1:1';
  l: ReturnType<typeof useLocalizedCopy>;
}) {
  const visualZh = ensurePromptSentence(input.shot.visualZh, '。');
  const storyZh = ensurePromptSentence(input.story, '。');
  const visualEn = ensurePromptSentence(input.shot.visualEn, '.');
  const storyEn = ensurePromptSentence(input.story, '.');
  return input.l(
    `创建一张${input.style}风格的火柴人故事分镜。镜头主题：${input.shot.titleZh}。画面内容：${visualZh}主角：${input.characterName}。故事背景：${storyZh}画面比例：${input.ratio}。保持角色的外观、线条、服装和配色与其他镜头一致，构图清晰，人物动作完整，不要在画面中渲染字幕、标识或其他文字。`,
    `Create a ${input.style} stick figure storyboard image. Shot: ${input.shot.titleEn}. Visual direction: ${visualEn} Character: ${input.characterName}. Story context: ${storyEn} Aspect ratio: ${input.ratio}. Keep the character's appearance, line work, clothing, and colors consistent with the other shots. Use a clear composition and complete body action. Do not render subtitles, labels, or other text in the image.`
  );
}

function ensurePromptSentence(value: string, punctuation: '。' | '.') {
  const trimmed = value.trim();
  return /[。！？.!?]$/.test(trimmed) ? trimmed : `${trimmed}${punctuation}`;
}

function storyboardImagePosition(index: number, version: number) {
  const positions = ['left center', '34% center', '66% center', 'right center'];
  return positions[(index + version) % positions.length];
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

function voiceLanguageLabel(value: VoiceLanguage, l: ReturnType<typeof useLocalizedCopy>) {
  if (value === 'zh-CN') return l('中文', 'Chinese');
  if (value === 'en-US') return 'English';
  return l('自动匹配', 'Auto match');
}

function voiceToneLabel(value: VoiceTone, l: ReturnType<typeof useLocalizedCopy>) {
  if (value === 'energetic') return l('活力青年', 'Energetic');
  if (value === 'calm') return l('沉稳讲述', 'Calm');
  return l('自然叙事', 'Natural narration');
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
  storyboardSubtitles: string[];
  storyboardImageVersions: number[];
  storyboardPromptOverrides: Array<string | null>;
  voiceover: boolean;
  voiceLanguage: VoiceLanguage;
  voiceTone: VoiceTone;
  backgroundMusic: File | null;
  backgroundMusicVolume: number;
}) {
  const file = input.characterSource === 'upload' && input.characterFile
    ? {
        name: input.characterFile.name,
        size: input.characterFile.size,
        type: input.characterFile.type,
        lastModified: input.characterFile.lastModified
      }
    : null;
  const backgroundMusic = input.backgroundMusic
    ? {
        name: input.backgroundMusic.name,
        size: input.backgroundMusic.size,
        type: input.backgroundMusic.type,
        lastModified: input.backgroundMusic.lastModified
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
    style: input.style,
    storyboardSubtitles: input.storyboardSubtitles,
    storyboardImageVersions: input.storyboardImageVersions,
    storyboardPromptOverrides: input.storyboardPromptOverrides,
    voiceover: input.voiceover,
    voiceLanguage: input.voiceover ? input.voiceLanguage : null,
    voiceTone: input.voiceover ? input.voiceTone : null,
    backgroundMusic,
    backgroundMusicVolume: backgroundMusic ? input.backgroundMusicVolume : null
  });
}
