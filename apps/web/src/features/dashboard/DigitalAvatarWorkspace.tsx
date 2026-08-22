import { useEffect, useMemo, useState } from 'react';
import {
  Captions,
  Check,
  FileText,
  ImagePlus,
  Mic2,
  MonitorPlay,
  Palette,
  UploadCloud,
  UserRound,
  Volume2
} from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import CreatorToolShell from './CreatorToolShell.js';

type AvatarStep = 0 | 1 | 2 | 3;
type AvatarSource = 'preset' | 'upload';
type AvatarRatio = '16:9' | '9:16' | '1:1';
type AvatarPosition = 'left' | 'center' | 'right';
type AvatarBackground = 'studio' | 'light' | 'dark';
type AvatarVoice = 'nova' | 'alloy' | 'echo' | 'shimmer';
type AvatarTone = 'natural' | 'professional' | 'warm' | 'energetic';

const sampleScriptZh = '大家好，今天我想用一分钟介绍一个更高效的内容创作方法。先明确目标，再整理素材，最后让每一步都围绕最终表达服务。';
const sampleScriptEn = 'Hello. In the next minute, I will show you a more efficient way to create content. Start with the goal, organize the material, and keep every step focused on the final message.';
const presetAvatarImage = '/dashboard/templates/digital-presenter.jpg';

const voices: Array<{ value: AvatarVoice; zh: string; en: string }> = [
  { value: 'nova', zh: '星语', en: 'Nova' },
  { value: 'alloy', zh: '合金', en: 'Alloy' },
  { value: 'echo', zh: '回声', en: 'Echo' },
  { value: 'shimmer', zh: '微光', en: 'Shimmer' }
];

const tones: Array<{ value: AvatarTone; zh: string; en: string }> = [
  { value: 'natural', zh: '自然', en: 'Natural' },
  { value: 'professional', zh: '专业', en: 'Professional' },
  { value: 'warm', zh: '温暖', en: 'Warm' },
  { value: 'energetic', zh: '活力', en: 'Energetic' }
];

export default function DigitalAvatarWorkspace(props: { onBack(): void; promptHint?: string }) {
  const l = useLocalizedCopy();
  const [currentStep, setCurrentStep] = useState<AvatarStep>(0);
  const [furthestStep, setFurthestStep] = useState<AvatarStep>(0);
  const [avatarSource, setAvatarSource] = useState<AvatarSource>('preset');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarUrl, setAvatarUrl] = useState('');
  const [script, setScript] = useState(() => l(sampleScriptZh, sampleScriptEn));
  const [voice, setVoice] = useState<AvatarVoice>('nova');
  const [tone, setTone] = useState<AvatarTone>('natural');
  const [speed, setSpeed] = useState(1);
  const [ratio, setRatio] = useState<AvatarRatio>('16:9');
  const [position, setPosition] = useState<AvatarPosition>('center');
  const [background, setBackground] = useState<AvatarBackground>('studio');
  const [subtitles, setSubtitles] = useState(true);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const avatarImage = avatarSource === 'upload' && avatarUrl ? avatarUrl : presetAvatarImage;
  const characterCount = useMemo(() => [...script.trim()].length, [script]);
  const selectedVoice = voices.find(item => item.value === voice) ?? voices[0]!;
  const selectedTone = tones.find(item => item.value === tone) ?? tones[0]!;

  useEffect(() => {
    if (!avatarFile || typeof URL.createObjectURL !== 'function') {
      setAvatarUrl('');
      return undefined;
    }
    const objectUrl = URL.createObjectURL(avatarFile);
    setAvatarUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [avatarFile]);

  function openStep(step: AvatarStep) {
    setCurrentStep(step);
    setFurthestStep(previous => Math.max(previous, step) as AvatarStep);
    setError('');
  }

  function continueFlow() {
    if (currentStep === 1 && characterCount === 0) {
      setError(l('请先填写口播文案', 'Enter the presenter script'));
      return;
    }
    openStep(Math.min(3, currentStep + 1) as AvatarStep);
  }

  function uploadAvatar(file: File | null) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      setError(l('请上传 10MB 以内的 JPG、PNG 或 WebP 图片', 'Upload a JPG, PNG, or WebP image up to 10 MB'));
      return;
    }
    setAvatarFile(file);
    setAvatarSource('upload');
    setSaved(false);
    setError('');
    setNotice(l('人物照片已加入画面预览', 'The presenter photo is ready in the preview'));
  }

  function savePlan() {
    setSaved(true);
    setNotice(l('制作方案已确认，接入人物驱动服务后即可提交生成', 'The production plan is confirmed and ready for an avatar rendering service'));
  }

  function handleCommand(command: string) {
    const normalized = command.trim();
    if (/竖屏|9:16|vertical/i.test(normalized)) {
      setRatio('9:16');
      setSaved(false);
      openStep(2);
      return l('画面比例已改为 9:16。', 'The frame is now 9:16.');
    }
    const toneMatch = tones.find(item => normalized.includes(item.zh) || normalized.toLowerCase().includes(item.en.toLowerCase()));
    if (toneMatch) {
      setTone(toneMatch.value);
      setSaved(false);
      openStep(1);
      return l(`表达风格已改为${toneMatch.zh}。`, `Delivery changed to ${toneMatch.en}.`);
    }
    if (/示例|sample/i.test(normalized)) {
      setScript(l(sampleScriptZh, sampleScriptEn));
      setSaved(false);
      openStep(1);
      return l('示例口播文案已填入。', 'The sample presenter script is ready.');
    }
    if (normalized.length > 12) {
      setScript(normalized);
      setSaved(false);
      openStep(1);
      return l('文案已同步，可以继续调整声音。', 'The script is synchronized. Continue with the voice settings.');
    }
    return l('可以发送口播文案，或调整声音、比例和画面位置。', 'Send a presenter script, or adjust the voice, ratio, and placement.');
  }

  const preview = (
    <AvatarPreview
      image={avatarImage}
      ratio={ratio}
      position={position}
      background={background}
      subtitles={subtitles}
      subtitle={script.trim()}
      label={l('数字人口播画面预览', 'Digital avatar frame preview')}
    />
  );

  return (
    <CreatorToolShell
      title={l('数字人口播', 'Digital Avatar')}
      subtitle={l('人物、声音和画面制作', 'Presenter, voice, and scene production')}
      context={saved
        ? l('制作方案已确认', 'Production plan confirmed')
        : currentStep === 0
          ? l('正在选择人物', 'Choosing a presenter')
          : currentStep === 1
            ? l(`${characterCount} 字口播文案`, `${characterCount} character script`)
            : currentStep === 2
              ? `${ratio} · ${l(positionLabel(position).zh, positionLabel(position).en)}`
              : l('正在确认制作方案', 'Reviewing the production plan')}
      initialMessage={l('选择出镜人物，然后准备口播文案和声音。', 'Choose a presenter, then prepare the script and voice.')}
      suggestions={[l('填入示例文案', 'Use sample script'), l('改成专业表达', 'Use a professional tone'), l('改成竖屏', 'Use a vertical frame')]}
      placeholder={props.promptHint ?? l('输入口播文案或调整要求', 'Enter a presenter script or request')}
      onBack={props.onBack}
      onCommand={handleCommand}
      contentClassName="digital-avatar-workspace-content"
    >
      <div className="creator-tool-stack digital-avatar-stack">
        <nav className="video-translation-steps creator-tool-steps digital-avatar-steps" aria-label={l('数字人口播流程', 'Digital avatar workflow')}>
          <ol>
            {[l('选择人物', 'Presenter'), l('文案与声音', 'Script and voice'), l('画面设置', 'Scene'), l('确认方案', 'Review')].map((label, index) => {
              const active = currentStep === index;
              const completed = index < currentStep;
              return (
                <li key={label} data-active={active} data-completed={completed}>
                  <button type="button" disabled={index > furthestStep} aria-current={active ? 'step' : undefined} onClick={() => openStep(index as AvatarStep)}>
                    <span>{completed ? <Check size={13} strokeWidth={2.2} aria-hidden="true" /> : index + 1}</span>
                    <strong>{label}</strong>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="digital-avatar-step-scroll">
          {currentStep === 0 ? (
            <section className="creator-tool-panel" aria-labelledby="digital-avatar-presenter-title">
              <div className="creator-tool-panel-heading">
                <div><h2 id="digital-avatar-presenter-title">{l('选择出镜人物', 'Choose a presenter')}</h2><p>{l('使用示例人物，或上传正面清晰照片', 'Use the sample presenter or upload a clear front-facing photo')}</p></div>
              </div>
              <div className="digital-avatar-picker">
                <div className="digital-avatar-source-list" role="group" aria-label={l('人物来源', 'Presenter source')}>
                  <button type="button" aria-pressed={avatarSource === 'preset'} onClick={() => { setAvatarSource('preset'); setSaved(false); setError(''); }}>
                    <img src={presetAvatarImage} alt="" />
                    <span><strong>{l('示例人物', 'Sample presenter')}</strong><small>{l('正面中景', 'Front medium shot')}</small></span>
                    {avatarSource === 'preset' ? <Check size={15} strokeWidth={2.1} aria-hidden="true" /> : null}
                  </button>
                  <label className="digital-avatar-upload">
                    {avatarSource === 'upload' && avatarUrl ? <img src={avatarUrl} alt="" /> : <span><UploadCloud size={20} strokeWidth={1.7} aria-hidden="true" /></span>}
                    <span><strong>{avatarFile?.name ?? l('上传人物照片', 'Upload presenter photo')}</strong><small>{l('JPG、PNG、WebP，最大 10MB', 'JPG, PNG, or WebP up to 10 MB')}</small></span>
                    <input type="file" accept="image/jpeg,image/png,image/webp" aria-label={l('上传人物照片', 'Upload presenter photo')} onChange={event => uploadAvatar(event.target.files?.[0] ?? null)} />
                  </label>
                </div>
                <div className="digital-avatar-presenter-preview">{preview}</div>
              </div>
              <p className="digital-avatar-guidance"><UserRound size={15} strokeWidth={1.8} aria-hidden="true" />{l('建议人物面向镜头、表情自然，面部无遮挡，光线均匀。', 'Use a front-facing photo with a natural expression, even lighting, and no facial obstruction.')}</p>
            </section>
          ) : null}

          {currentStep === 1 ? (
            <section className="creator-tool-panel" aria-labelledby="digital-avatar-script-title">
              <div className="creator-tool-panel-heading">
                <div><h2 id="digital-avatar-script-title">{l('文案与声音', 'Script and voice')}</h2><p>{l('准备口播内容，再设置声音表达', 'Prepare the presenter script and voice delivery')}</p></div>
                <small>{characterCount} / 5000</small>
              </div>
              <div className="digital-avatar-script-layout">
                <label className="creator-tool-field digital-avatar-script-field">
                  <span>{l('口播文案', 'Presenter script')}</span>
                  <textarea rows={10} maxLength={5000} value={script} aria-label={l('口播文案', 'Presenter script')} onChange={event => { setScript(event.target.value); setSaved(false); setError(''); }} />
                </label>
                <div className="digital-avatar-voice-controls">
                  <div className="digital-avatar-control-group">
                    <span><Mic2 size={15} strokeWidth={1.8} aria-hidden="true" />{l('音色', 'Voice')}</span>
                    <div className="creator-tool-segmented" role="radiogroup" aria-label={l('音色', 'Voice')}>
                      {voices.map(item => <button type="button" role="radio" aria-checked={voice === item.value} aria-selected={voice === item.value} key={item.value} onClick={() => { setVoice(item.value); setSaved(false); }}>{l(item.zh, item.en)}</button>)}
                    </div>
                  </div>
                  <div className="digital-avatar-control-group">
                    <span><Volume2 size={15} strokeWidth={1.8} aria-hidden="true" />{l('表达', 'Delivery')}</span>
                    <div className="creator-tool-segmented" role="radiogroup" aria-label={l('表达', 'Delivery')}>
                      {tones.map(item => <button type="button" role="radio" aria-checked={tone === item.value} aria-selected={tone === item.value} key={item.value} onClick={() => { setTone(item.value); setSaved(false); }}>{l(item.zh, item.en)}</button>)}
                    </div>
                  </div>
                  <label className="digital-avatar-speed">
                    <span><span>{l('语速', 'Speaking rate')}</span><output>{speed.toFixed(2)}x</output></span>
                    <input type="range" min="0.8" max="1.2" step="0.05" value={speed} onChange={event => { setSpeed(Number(event.target.value)); setSaved(false); }} />
                  </label>
                </div>
              </div>
            </section>
          ) : null}

          {currentStep === 2 ? (
            <section className="creator-tool-panel" aria-labelledby="digital-avatar-scene-title">
              <div className="creator-tool-panel-heading">
                <div><h2 id="digital-avatar-scene-title">{l('画面设置', 'Scene settings')}</h2><p>{l('调整比例、人物位置、背景和字幕', 'Adjust the ratio, presenter placement, background, and subtitles')}</p></div>
              </div>
              <div className="digital-avatar-scene-layout">
                <div className="digital-avatar-scene-controls">
                  <div className="digital-avatar-control-group">
                    <span><MonitorPlay size={15} strokeWidth={1.8} aria-hidden="true" />{l('画面比例', 'Frame ratio')}</span>
                    <div className="creator-tool-segmented" role="radiogroup" aria-label={l('画面比例', 'Frame ratio')}>
                      {(['16:9', '9:16', '1:1'] as const).map(value => <button type="button" role="radio" aria-checked={ratio === value} aria-selected={ratio === value} key={value} onClick={() => { setRatio(value); setSaved(false); }}>{value}</button>)}
                    </div>
                  </div>
                  <div className="digital-avatar-control-group">
                    <span><UserRound size={15} strokeWidth={1.8} aria-hidden="true" />{l('人物位置', 'Presenter placement')}</span>
                    <div className="creator-tool-segmented" role="radiogroup" aria-label={l('人物位置', 'Presenter placement')}>
                      {(['left', 'center', 'right'] as const).map(value => { const label = positionLabel(value); return <button type="button" role="radio" aria-checked={position === value} aria-selected={position === value} key={value} onClick={() => { setPosition(value); setSaved(false); }}>{l(label.zh, label.en)}</button>; })}
                    </div>
                  </div>
                  <div className="digital-avatar-control-group">
                    <span><Palette size={15} strokeWidth={1.8} aria-hidden="true" />{l('背景', 'Background')}</span>
                    <div className="digital-avatar-backgrounds" role="radiogroup" aria-label={l('背景', 'Background')}>
                      {(['studio', 'light', 'dark'] as const).map(value => { const label = backgroundLabel(value); return <button type="button" role="radio" aria-checked={background === value} aria-label={l(label.zh, label.en)} key={value} data-background={value} onClick={() => { setBackground(value); setSaved(false); }}><span aria-hidden="true" /></button>; })}
                    </div>
                  </div>
                  <label className="digital-avatar-subtitle-toggle">
                    <span><Captions size={15} strokeWidth={1.8} aria-hidden="true" /><span><strong>{l('显示字幕', 'Show subtitles')}</strong><small>{l('使用口播文案生成字幕', 'Use the presenter script as subtitles')}</small></span></span>
                    <input type="checkbox" role="switch" checked={subtitles} onChange={event => { setSubtitles(event.target.checked); setSaved(false); }} aria-label={l('显示字幕', 'Show subtitles')} />
                  </label>
                </div>
                <div className="digital-avatar-scene-preview">{preview}</div>
              </div>
            </section>
          ) : null}

          {currentStep === 3 ? (
            <div className="creator-task-final-grid digital-avatar-final-grid">
              <section className="creator-tool-panel digital-avatar-review" aria-labelledby="digital-avatar-review-title">
                <div className="creator-tool-panel-heading">
                  <div><h2 id="digital-avatar-review-title">{l('确认制作方案', 'Review production plan')}</h2><p>{l('检查人物、文案、声音和画面', 'Review the presenter, script, voice, and scene')}</p></div>
                </div>
                {preview}
                <div className="digital-avatar-save-row">
                  <span>{saved ? <><Check size={15} strokeWidth={2} aria-hidden="true" />{l('方案已确认', 'Plan confirmed')}</> : l('确认后可继续接入人物驱动与口型同步', 'Confirm this plan for avatar rendering and lip sync integration')}</span>
                  <button className="creator-tool-primary" type="button" onClick={savePlan} disabled={saved}><Check size={15} strokeWidth={1.8} aria-hidden="true" />{saved ? l('已确认', 'Confirmed') : l('确认制作方案', 'Confirm plan')}</button>
                </div>
              </section>
              <CreatorTaskSummary
                sourceIcon={FileText}
                sourceLabel={l('口播文案', 'Presenter script')}
                sourceValue={script.trim()}
                items={[
                  { label: l('人物', 'Presenter'), value: avatarSource === 'upload' ? avatarFile?.name ?? l('上传人物', 'Uploaded presenter') : l('示例人物', 'Sample presenter') },
                  { label: l('声音', 'Voice'), value: `${l(selectedVoice.zh, selectedVoice.en)} · ${l(selectedTone.zh, selectedTone.en)}` },
                  { label: l('语速', 'Speed'), value: `${speed.toFixed(2)}x` },
                  { label: l('画面', 'Frame'), value: `${ratio} · ${l(positionLabel(position).zh, positionLabel(position).en)}` },
                  { label: l('字幕', 'Subtitles'), value: subtitles ? l('显示', 'On') : l('关闭', 'Off') }
                ]}
                note={l('当前只确认制作方案，不会生成或上传视频。', 'This prototype confirms the production plan without generating or uploading a video.')}
                noteIcon={ImagePlus}
              />
            </div>
          ) : null}

          {error ? <p className="creator-tool-error digital-avatar-error" role="alert">{error}</p> : null}
          {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
        </div>

        <footer className="video-translation-wizard-actions digital-avatar-actions">
          <button className="video-translation-secondary-action" type="button" onClick={() => currentStep === 0 ? props.onBack() : openStep((currentStep - 1) as AvatarStep)}>
            {currentStep === 0 ? l('返回', 'Back') : l('上一步', 'Back')}
          </button>
          {currentStep < 3 ? <button className="video-translation-primary-action" type="button" onClick={continueFlow}>{l('继续', 'Continue')}</button> : null}
        </footer>
      </div>
    </CreatorToolShell>
  );
}

function AvatarPreview(props: {
  image: string;
  ratio: AvatarRatio;
  position: AvatarPosition;
  background: AvatarBackground;
  subtitles: boolean;
  subtitle: string;
  label: string;
}) {
  return (
    <div className="digital-avatar-frame" data-ratio={props.ratio} data-position={props.position} data-background={props.background} role="img" aria-label={props.label}>
      <img src={props.image} alt="" />
      <span className="digital-avatar-frame-tint" aria-hidden="true" />
      {props.subtitles && props.subtitle ? <p>{shortSubtitle(props.subtitle)}</p> : null}
    </div>
  );
}

function shortSubtitle(value: string) {
  const characters = [...value];
  return characters.length > 34 ? `${characters.slice(0, 34).join('')}...` : value;
}

function positionLabel(value: AvatarPosition) {
  if (value === 'left') return { zh: '居左', en: 'Left' };
  if (value === 'right') return { zh: '居右', en: 'Right' };
  return { zh: '居中', en: 'Center' };
}

function backgroundLabel(value: AvatarBackground) {
  if (value === 'light') return { zh: '明亮', en: 'Light' };
  if (value === 'dark') return { zh: '深色', en: 'Dark' };
  return { zh: '影棚', en: 'Studio' };
}
