import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  Bot,
  Check,
  MessageSquareText,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';

export type VideoTranslationAgentAction =
  | { type: 'explain_source' }
  | {
      type: 'apply_task_request';
      request: {
        videoUrl?: string;
        targetLanguage?: { value: 'en' | 'ja' | 'ko'; label: string };
        bilingual?: boolean;
        dubbing?: boolean;
        output?: 'horizontal' | 'vertical' | 'subtitles';
        execute?: boolean;
      };
    }
  | { type: 'advance_task' }
  | { type: 'run_translation' }
  | { type: 'set_target_language'; value: 'en' | 'ja' | 'ko'; label: string }
  | { type: 'set_bilingual'; value: boolean }
  | { type: 'set_dubbing'; value: boolean }
  | { type: 'set_output'; value: 'horizontal' | 'vertical' }
  | { type: 'subtitle_only' }
  | { type: 'open_subtitle_editor' }
  | { type: 'edit_subtitle'; index: number; text: string }
  | { type: 'open_result_settings' }
  | { type: 'regenerate_result' }
  | { type: 'confirm_regeneration' }
  | { type: 'cancel_regeneration' };

type AgentMessage = {
  id: number;
  role: 'agent' | 'user';
  text: string;
};

const quickActions: Record<number, Array<{ label: string; action: VideoTranslationAgentAction }>> = {
  0: [
    { label: '链接支持哪些平台', action: { type: 'explain_source' } },
    { label: '继续设置', action: { type: 'advance_task' } }
  ],
  1: [
    { label: '翻译成英文', action: { type: 'set_target_language', value: 'en', label: 'English' } },
    { label: '翻译成日语', action: { type: 'set_target_language', value: 'ja', label: '日本語' } },
    { label: '关闭双语字幕', action: { type: 'set_bilingual', value: false } },
    { label: '进入配音与输出', action: { type: 'advance_task' } }
  ],
  2: [
    { label: '开启配音', action: { type: 'set_dubbing', value: true } },
    { label: '输出竖屏视频', action: { type: 'set_output', value: 'vertical' } },
    { label: '仅生成字幕', action: { type: 'subtitle_only' } },
    { label: '按当前设置开始', action: { type: 'run_translation' } }
  ],
  3: [
    { label: '修改字幕', action: { type: 'open_subtitle_editor' } },
    { label: '调整任务设置', action: { type: 'open_result_settings' } },
    { label: '生成新版本', action: { type: 'regenerate_result' } }
  ]
};

export default function VideoTranslationAgentPanel(props: {
  step: number;
  stepLabel: string;
  contextSummary: string;
  canRegenerate: boolean;
  regenerationPending: boolean;
  nextVersion: number;
  lastChange?: string;
  onApply(action: VideoTranslationAgentAction): string;
  onUndo(): void;
}) {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const [messages, setMessages] = useState<AgentMessage[]>(() => [initialMessage(l)]);
  const [input, setInput] = useState('');
  useEffect(() => {
    setMessages([initialMessage(l)]);
    setInput('');
  }, [language, l]);
  const actions = props.regenerationPending
    ? [
        { label: `${l('确认并执行', 'Confirm and generate')} V${props.nextVersion}`, action: { type: 'confirm_regeneration' } as const },
        { label: l('暂不生成', 'Not now'), action: { type: 'cancel_regeneration' } as const }
      ]
    : (quickActions[props.step] ?? [])
        .filter(item => item.action.type !== 'regenerate_result' || props.canRegenerate)
        .map(item => ({ ...item, label: localizeQuickAction(item.label, l) }));
  const nextMessageId = messages.length === 0 ? 1 : messages[messages.length - 1]!.id + 1;
  const placeholder = props.step === 3
    ? l('例如：把第 2 条字幕改为……', 'For example: change subtitle 2 to...')
    : props.step === 2
      ? l('例如：开启配音并输出竖屏', 'For example: enable dubbing and use vertical output')
      : props.step === 1
        ? l('例如：翻译成日语', 'For example: translate into Japanese')
        : l('添加视频后，告诉我翻译要求', 'Add a video, then tell me your translation requirements');

  const interpretedAction = useMemo((): VideoTranslationAgentAction | undefined => {
    const prompt = input.trim();
    const text = prompt.toLocaleLowerCase();
    if (!text) return undefined;
    if (props.regenerationPending) {
      if (text.includes('确认') || text === '生成' || text === '继续' || text.includes('confirm') || text === 'generate' || text === 'continue') {
        return { type: 'confirm_regeneration' };
      }
      if (text.includes('取消') || text.includes('算了') || text.includes('cancel') || text.includes('not now')) {
        return { type: 'cancel_regeneration' };
      }
    }
    if (props.step === 3) {
      const subtitleEdit = prompt.match(
        /^(?:请)?(?:(?:把|将)\s*)?第\s*(\d+)\s*(?:条|句)?字幕\s*(?:改成|改为|修改为|换成)\s*[“"'：:]?(.+?)[”"']?$/
      );
      const englishSubtitleEdit = prompt.match(/^(?:please\s+)?(?:change|edit|set)\s+(?:subtitle\s*)?#?\s*(\d+)\s+(?:to|as)\s+(.+)$/i);
      const matchedSubtitleEdit = subtitleEdit ?? englishSubtitleEdit;
      if (matchedSubtitleEdit) {
        return {
          type: 'edit_subtitle',
          index: Number(matchedSubtitleEdit[1]),
          text: matchedSubtitleEdit[2]!.trim()
        };
      }
      if (text.includes('重新生成') || text.includes('新版本') || text.includes('regenerate') || text.includes('new version')) {
        return { type: 'regenerate_result' };
      }
      if (text === '字幕' || text.includes('修改字幕') || text.includes('编辑字幕') || text === 'subtitles' || text.includes('edit subtitles')) {
        return { type: 'open_subtitle_editor' };
      }
    }
    const videoUrl = prompt.match(/https?:\/\/[^\s,，。;；]+/i)?.[0];
    const targetLanguage = text.includes('日语') || text.includes('日文') || text.includes('japanese')
      ? { value: 'ja' as const, label: '日本語' }
      : text.includes('韩语') || text.includes('韩文') || text.includes('korean')
        ? { value: 'ko' as const, label: '한국어' }
        : text.includes('英语') || text.includes('英文') || text.includes('english')
          ? { value: 'en' as const, label: 'English' }
          : undefined;
    const bilingual = text.includes('不要双语') || text.includes('关闭双语') || text.includes('no bilingual') || text.includes('disable bilingual')
      ? false
      : text.includes('双语') || text.includes('bilingual')
        ? true
        : undefined;
    const dubbing = text.includes('不要配音') || text.includes('关闭配音') || text.includes('no dubbing') || text.includes('disable dubbing')
      ? false
      : text.includes('配音') || text.includes('dubbing') || text.includes('dub')
        ? true
        : undefined;
    const output = text.includes('仅生成字幕') || text.includes('只要字幕') || text.includes('subtitles only')
      ? 'subtitles' as const
      : text.includes('竖屏') || text.includes('9:16') || text.includes('vertical')
        ? 'vertical' as const
        : text.includes('横屏') || text.includes('16:9') || text.includes('horizontal')
          ? 'horizontal' as const
          : undefined;
    const execute = text.includes('开始翻译')
      || text.includes('直接翻译')
      || text.includes('立即翻译')
      || text.includes('开始执行')
      || text.includes('帮我翻译')
      || text.includes('start translating')
      || text.includes('translate now')
      || text.includes('start');
    const requestChangeCount = [targetLanguage, bilingual, dubbing, output]
      .filter(value => value !== undefined).length;
    if (videoUrl || execute || requestChangeCount > 1) {
      return {
        type: 'apply_task_request',
        request: { videoUrl, targetLanguage, bilingual, dubbing, output, execute }
      };
    }
    if (text === '继续' || text.includes('下一步') || text === 'continue' || text.includes('next step')) return { type: 'advance_task' };
    if (text.includes('不要配音') || text.includes('关闭配音') || text.includes('no dubbing') || text.includes('disable dubbing')) return { type: 'set_dubbing', value: false };
    if (text.includes('配音') || text.includes('dubbing') || text.includes('dub')) return { type: 'set_dubbing', value: true };
    if ((text.includes('仅') && text.includes('字幕')) || text.includes('subtitles only')) return { type: 'subtitle_only' };
    if (text.includes('竖屏') || text.includes('9:16') || text.includes('vertical')) return { type: 'set_output', value: 'vertical' };
    if (text.includes('横屏') || text.includes('16:9') || text.includes('horizontal')) return { type: 'set_output', value: 'horizontal' };
    if (text.includes('不要双语') || text.includes('关闭双语') || text.includes('no bilingual') || text.includes('disable bilingual')) return { type: 'set_bilingual', value: false };
    if (text.includes('双语') || text.includes('bilingual')) return { type: 'set_bilingual', value: true };
    if (text.includes('日语') || text.includes('日文') || text.includes('japanese')) {
      return { type: 'set_target_language', value: 'ja', label: '日本語' };
    }
    if (text.includes('韩语') || text.includes('韩文') || text.includes('korean')) {
      return { type: 'set_target_language', value: 'ko', label: '한국어' };
    }
    if (text.includes('英语') || text.includes('英文') || text.includes('english')) {
      return { type: 'set_target_language', value: 'en', label: 'English' };
    }
    if (props.step === 3 && (text.includes('设置') || text.includes('语言') || text.includes('音色') || text.includes('settings') || text.includes('language') || text.includes('voice'))) {
      return { type: 'open_result_settings' };
    }
    if (text.includes('平台') || text.includes('链接') || text.includes('platform') || text.includes('link')) return { type: 'explain_source' };
    return undefined;
  }, [input, props.regenerationPending, props.step]);

  function runAction(action: VideoTranslationAgentAction, userText?: string) {
    const result = props.onApply(action);
    const nextMessages: AgentMessage[] = [];
    if (userText) nextMessages.push({ id: nextMessageId, role: 'user', text: userText });
    nextMessages.push({
      id: nextMessageId + (userText ? 1 : 0),
      role: 'agent',
      text: result
    });
    setMessages(current => [...current, ...nextMessages]);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = input.trim();
    if (!prompt) return;
    setInput('');
    if (interpretedAction) {
      runAction(interpretedAction, prompt);
      return;
    }
    setMessages(current => [
      ...current,
      { id: nextMessageId, role: 'user', text: prompt },
      {
        id: nextMessageId + 1,
        role: 'agent',
        text: l('我还不能直接执行这条要求。当前可以调整目标语言、双语字幕、配音和输出画幅，也可以在生成后按序号修改字幕。', 'I cannot execute that request yet. I can change the target language, bilingual subtitles, dubbing, and output format, or edit a numbered subtitle after generation.')
      }
    ]);
  }

  return (
    <aside className="video-translation-agent" aria-label="OpenCreator">
      <header className="video-translation-agent-header">
        <span aria-hidden="true"><Bot size={17} strokeWidth={1.8} /></span>
        <div>
          <h2>OpenCreator</h2>
          <p>{l('正在协助：', 'Helping with: ')}{props.stepLabel}</p>
        </div>
      </header>

      <div className="video-translation-agent-context">
        <Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />
        <span>
          <small>{l('当前任务', 'Current task')}</small>
          <strong>{props.contextSummary}</strong>
        </span>
      </div>

      <div className="video-translation-agent-messages" aria-live="polite">
        {messages.map(message => (
          <div className="video-translation-agent-message" data-role={message.role} key={message.id}>
            {message.role === 'agent' ? (
              <span aria-hidden="true"><MessageSquareText size={14} strokeWidth={1.8} /></span>
            ) : null}
            <p>{message.text}</p>
          </div>
        ))}
      </div>

      {props.lastChange ? (
        <div className="video-translation-agent-change" role="status">
          <Check size={14} strokeWidth={2} aria-hidden="true" />
          <span>{props.lastChange}</span>
          <button type="button" onClick={props.onUndo} aria-label={l('撤销 Agent 修改', 'Undo Agent change')}>
            <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className="video-translation-agent-suggestions" aria-label={l('Agent 建议', 'Agent suggestions')}>
        {actions.map(item => (
          <button type="button" key={item.label} onClick={() => runAction(item.action)}>
            {item.label}
          </button>
        ))}
      </div>

      <form className="video-translation-agent-composer" onSubmit={submit}>
        <textarea
          rows={2}
          value={input}
          onChange={event => setInput(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          aria-label={l('告诉 Agent 你的要求', 'Tell the Agent your requirements')}
          placeholder={placeholder}
        />
        <button type="submit" disabled={!input.trim()} aria-label={l('发送给 Agent', 'Send to Agent')}>
          <ArrowUp size={16} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </form>
    </aside>
  );
}

function initialMessage(l: LocalizeCopy): AgentMessage {
  return {
    id: 1,
    role: 'agent',
    text: l(
      '把视频添加到左侧后，直接告诉我目标语言、是否需要配音和输出画幅，我会同步替你设置。',
      'Add a video on the left, then tell me the target language, whether you need dubbing, and the output format. I will keep the settings in sync.'
    )
  };
}

function localizeQuickAction(label: string, l: LocalizeCopy): string {
  const translations: Record<string, string> = {
    '链接支持哪些平台': 'Which platforms are supported?',
    '继续设置': 'Continue setup',
    '翻译成英文': 'Translate into English',
    '翻译成日语': 'Translate into Japanese',
    '关闭双语字幕': 'Disable bilingual subtitles',
    '进入配音与输出': 'Continue to dubbing and output',
    '开启配音': 'Enable dubbing',
    '输出竖屏视频': 'Use vertical video output',
    '仅生成字幕': 'Generate subtitles only',
    '按当前设置开始': 'Start with current settings',
    '修改字幕': 'Edit subtitles',
    '调整任务设置': 'Adjust task settings',
    '生成新版本': 'Generate a new version'
  };
  return l(label, translations[label] ?? label);
}
