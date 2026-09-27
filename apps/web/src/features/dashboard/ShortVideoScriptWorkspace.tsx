import type { CreatorArtifact, CreatorJson } from '@opencreator/protocol';
import {
  Copy,
  Download,
  FilePenLine,
  LoaderCircle,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import NativeSelect from '../../components/forms/NativeSelect.js';
import CreatorToolShell from './CreatorToolShell.js';
import {
  captureCreatorClientFailure,
  readCreatorArtifactText,
  useOptionalCreatorSession
} from './creator-session-store.js';

type ScriptPlatform = 'douyin' | 'xiaohongshu' | 'wechat-channels' | 'bilibili' | 'generic';
type ScriptTone = 'natural' | 'professional' | 'energetic' | 'storytelling';

const platforms: Array<{ value: ScriptPlatform; zh: string; en: string }> = [
  { value: 'douyin', zh: '抖音', en: 'Douyin' },
  { value: 'xiaohongshu', zh: '小红书', en: 'Xiaohongshu' },
  { value: 'wechat-channels', zh: '视频号', en: 'WeChat Channels' },
  { value: 'bilibili', zh: 'Bilibili', en: 'Bilibili' },
  { value: 'generic', zh: '通用短视频', en: 'General short video' }
];

const tones: Array<{ value: ScriptTone; zh: string; en: string }> = [
  { value: 'natural', zh: '自然口语', en: 'Natural' },
  { value: 'professional', zh: '专业清晰', en: 'Professional' },
  { value: 'energetic', zh: '活泼有感染力', en: 'Energetic' },
  { value: 'storytelling', zh: '有故事感', en: 'Storytelling' }
];

export default function ShortVideoScriptWorkspace(props: {
  onBack(): void;
  promptHint?: string;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [topic, setTopic] = useState(() => readString(session?.state.topic));
  const [audience, setAudience] = useState(() => readString(session?.state.audience));
  const [platform, setPlatform] = useState<ScriptPlatform>(
    () => readPlatform(session?.state.platform)
  );
  const [targetDuration, setTargetDuration] = useState(
    () => String(readTargetDuration(session?.state.targetDurationSeconds))
  );
  const [tone, setTone] = useState<ScriptTone>(() => readTone(session?.state.tone));
  const [extraRequirements, setExtraRequirements] = useState(
    () => readString(session?.state.extraRequirements)
  );
  const [resultText, setResultText] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [taskControlPending, setTaskControlPending] = useState<'canceling' | 'resuming'>();
  const result = useMemo(
    () => readLatestResult(session?.job.artifacts ?? []),
    [session?.job.artifacts]
  );
  const latestStage = session?.job.stages.filter(stage => stage.stageId === 'generate').at(-1);
  const generating = latestStage?.status === 'queued' || latestStage?.status === 'running';
  const runtimeError = latestStage?.status === 'failed'
    ? generationError(latestStage.errorCode, latestStage.errorMessage, l)
    : session?.error === null || session?.error === undefined
      ? ''
      : generationError(session.error.code, session.error.message, l);
  const visibleError = error || runtimeError;

  useEffect(() => {
    setTopic(readString(session?.state.topic));
    setAudience(readString(session?.state.audience));
    setPlatform(readPlatform(session?.state.platform));
    setTargetDuration(String(readTargetDuration(session?.state.targetDurationSeconds)));
    setTone(readTone(session?.state.tone));
    setExtraRequirements(readString(session?.state.extraRequirements));
  }, [
    session?.state.topic,
    session?.state.audience,
    session?.state.platform,
    session?.state.targetDurationSeconds,
    session?.state.tone,
    session?.state.extraRequirements
  ]);

  useEffect(() => {
    setResultText('');
    setError('');
    if (session === null || result === undefined) return;
    let active = true;
    void readCreatorArtifactText(
      session,
      result.artifact.id,
      'short-video-script.load-result',
      l('脚本内容加载失败，可以稍后重试或重新生成。', 'The script failed to load. Retry later or generate it again.')
    )
      .then(text => {
        if (active) setResultText(text);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, [l, result?.artifact.id, session?.captureCreatorFailure, session?.openArtifact]);

  function updateTopic(value: string) {
    setTopic(value);
    session?.updateDraft({ topic: value });
    setError('');
  }

  function updateAudience(value: string) {
    setAudience(value);
    session?.updateDraft({ audience: value });
    setError('');
  }

  function updatePlatform(value: ScriptPlatform) {
    setPlatform(value);
    session?.updateDraft({ platform: value });
    setError('');
  }

  function updateTargetDuration(value: string) {
    setTargetDuration(value);
    const seconds = Number(value);
    if (Number.isInteger(seconds) && seconds >= 15 && seconds <= 600) {
      session?.updateDraft({ targetDurationSeconds: seconds });
    }
    setError('');
  }

  function updateTone(value: ScriptTone) {
    setTone(value);
    session?.updateDraft({ tone: value });
    setError('');
  }

  function updateExtraRequirements(value: string) {
    setExtraRequirements(value);
    session?.updateDraft({ extraRequirements: value });
    setError('');
  }

  async function generate() {
    if (generating) return;
    if (session === null) {
      setError(l(
        '短视频脚本生成服务暂不可用，请检查 Runtime 连接',
        'Script generation is unavailable. Check the Runtime connection.'
      ));
      return;
    }
    if (!topic.trim()) {
      setError(l('请先填写创作主题或素材', 'Enter a topic or source material'));
      return;
    }
    const targetDurationSeconds = Number(targetDuration);
    if (
      !Number.isInteger(targetDurationSeconds)
      || targetDurationSeconds < 15
      || targetDurationSeconds > 600
    ) {
      setError(l('目标时长应为 15 到 600 秒的整数', 'Duration must be an integer from 15 to 600 seconds'));
      return;
    }
    setError('');
    setNotice('');
    session.updateDraft({
      topic: topic.trim(),
      audience: audience.trim(),
      platform,
      targetDurationSeconds,
      tone,
      extraRequirements: extraRequirements.trim()
    }, { semantic: true });
    try {
      await session.flush();
      await session.applyAction({
        actor: 'user',
        action: 'run-stage',
        input: { stageId: 'generate' }
      });
      setNotice(l(
        '生成任务已提交，完成后会自动显示脚本',
        'Generation started. The script will appear automatically.'
      ));
    } catch {}
  }

  async function copyResult() {
    if (!resultText) return;
    try {
      await navigator.clipboard.writeText(resultText);
      setNotice(l('脚本已复制到剪贴板', 'Script copied to the clipboard'));
    } catch (cause) {
      session?.captureCreatorFailure(
        'short-video-script.copy-result',
        cause,
        l('复制失败，请手动选择脚本内容。', 'Copy failed. Select the script manually.'),
        'client'
      );
    }
  }

  function downloadResult() {
    if (!result || !resultText || session === null) return;
    void captureCreatorClientFailure(
      session,
      'short-video-script.download-result',
      l('脚本下载失败，请稍后重试。', 'The script download failed. Try again later.'),
      () => {
        const url = URL.createObjectURL(new Blob([resultText], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = result.fileName;
        link.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
      }
    ).then(() => setNotice(l('脚本文件已开始下载', 'The script download has started')))
      .catch(() => undefined);
  }

  async function cancelTask() {
    if (session === null || taskControlPending !== undefined) return;
    setTaskControlPending('canceling');
    try {
      await session.cancelJob();
    } catch {} finally {
      setTaskControlPending(undefined);
    }
  }

  async function resumeTask() {
    if (session === null || taskControlPending !== undefined) return;
    setTaskControlPending('resuming');
    try {
      await session.resumeJob();
    } catch {} finally {
      setTaskControlPending(undefined);
    }
  }

  const selectedPlatform = platforms.find(item => item.value === platform) ?? platforms[0]!;
  const selectedTone = tones.find(item => item.value === tone) ?? tones[0]!;
  return (
    <CreatorToolShell
      title={l('短视频脚本生成器', 'Short Video Script Generator')}
      subtitle={l('从主题和素材生成可直接拍摄的分段脚本', 'Turn a topic or source material into a shoot-ready script')}
      context={result
        ? result.title
        : generating
          ? l('正在生成脚本', 'Generating script')
          : `${l(selectedPlatform.zh, selectedPlatform.en)} · ${targetDuration || '60'} ${l('秒', 'sec')}`}
      stepLabel={generating ? l('正在生成脚本', 'Generating script') : l('短视频脚本', 'Short video script')}
      currentIssue={visibleError || undefined}
      suggestions={result
        ? [l('强化开场钩子', 'Strengthen the opening hook'), l('让口播更自然', 'Make the narration more natural')]
        : [l('突出前三秒钩子', 'Focus on the first three seconds'), l('使用自然口语', 'Use natural spoken language')]}
      placeholder={props.promptHint ?? l(
        '描述要调整的主题、受众、平台、时长或语气',
        'Describe changes to the topic, audience, platform, duration, or tone'
      )}
      onBack={props.onBack}
      onCancelTask={() => void cancelTask()}
      onResumeTask={() => void resumeTask()}
      taskControlPending={taskControlPending}
      pageClassName="short-video-script-workspace-page"
    >
      <div className="creator-tool-stack short-video-script-stack">
        <section className="creator-tool-panel" aria-labelledby="short-video-script-settings-title">
          <div className="creator-tool-panel-heading">
            <div>
              <h2 id="short-video-script-settings-title">{l('脚本设置', 'Script settings')}</h2>
              <p>{l('提供主题、事实或参考素材，生成内容会以这些信息为准', 'Provide the topic, facts, or reference material for the script')}</p>
            </div>
          </div>
          <div className="short-video-script-fields">
            <label className="creator-tool-field">
              <span>{l('主题或素材', 'Topic or source material')}</span>
              <textarea
                rows={8}
                maxLength={5000}
                value={topic}
                onChange={event => updateTopic(event.target.value)}
                placeholder={l('输入要表达的主题、事实、观点或产品信息', 'Enter the topic, facts, ideas, or product details')}
                aria-label={l('短视频脚本主题或素材', 'Script topic or source material')}
              />
            </label>
            <label className="creator-tool-field">
              <span>{l('目标受众', 'Audience')} <small>{l('选填', 'Optional')}</small></span>
              <input
                maxLength={500}
                value={audience}
                onChange={event => updateAudience(event.target.value)}
                placeholder={l('例如：准备参与开源项目的程序员', 'For example: developers new to open source')}
              />
            </label>
            <div className="short-video-script-options">
              <label className="creator-tool-field">
                <span>{l('发布平台或场景', 'Platform or use case')}</span>
                <NativeSelect
                  value={platform}
                  onChange={event => updatePlatform(readPlatform(event.target.value))}
                >
                  {platforms.map(item => (
                    <option key={item.value} value={item.value}>{l(item.zh, item.en)}</option>
                  ))}
                </NativeSelect>
              </label>
              <label className="creator-tool-field">
                <span>{l('目标时长（秒）', 'Target duration (seconds)')}</span>
                <input
                  type="number"
                  min={15}
                  max={600}
                  step={5}
                  value={targetDuration}
                  onChange={event => updateTargetDuration(event.target.value)}
                />
              </label>
              <label className="creator-tool-field">
                <span>{l('表达语气', 'Tone')}</span>
                <NativeSelect
                  value={tone}
                  onChange={event => updateTone(readTone(event.target.value))}
                >
                  {tones.map(item => (
                    <option key={item.value} value={item.value}>{l(item.zh, item.en)}</option>
                  ))}
                </NativeSelect>
              </label>
            </div>
            <label className="creator-tool-field">
              <span>{l('补充要求', 'Additional requirements')} <small>{l('选填', 'Optional')}</small></span>
              <textarea
                rows={3}
                maxLength={2000}
                value={extraRequirements}
                onChange={event => updateExtraRequirements(event.target.value)}
                placeholder={l('例如：开场直接给结论，不使用夸张表达', 'For example: lead with the conclusion and avoid exaggeration')}
              />
            </label>
          </div>
          <div className="creator-tool-actions">
            <button type="button" onClick={() => void generate()} disabled={generating}>
              {generating
                ? <LoaderCircle className="short-video-script-spinner" size={16} strokeWidth={1.8} aria-hidden="true" />
                : result
                  ? <RotateCcw size={16} strokeWidth={1.8} aria-hidden="true" />
                  : <Sparkles size={16} strokeWidth={1.8} aria-hidden="true" />}
              {generating
                ? l('正在生成', 'Generating')
                : result
                  ? l('重新生成', 'Regenerate')
                  : l('生成脚本', 'Generate script')}
            </button>
          </div>
        </section>

        <section className="creator-tool-panel short-video-script-result-panel" aria-labelledby="short-video-script-result-title">
          <div className="creator-tool-panel-heading">
            <div>
              <h2 id="short-video-script-result-title">{l('脚本结果', 'Script result')}</h2>
              <p>{result
                ? l('可以直接修改、复制或下载 Markdown 文件', 'Edit, copy, or download the Markdown script')
                : l('完成脚本设置后开始生成', 'Complete the settings to generate a script')}</p>
            </div>
            {result ? <small><FilePenLine size={14} strokeWidth={1.8} aria-hidden="true" />{result.fileName}</small> : null}
          </div>
          {resultText ? (
            <>
              <label className="creator-tool-field">
                <span>{l('完整脚本', 'Complete script')}</span>
                <textarea
                  rows={16}
                  value={resultText}
                  onChange={event => {
                    setResultText(event.target.value);
                    setNotice('');
                  }}
                  aria-label={l('生成的短视频脚本', 'Generated short video script')}
                />
              </label>
              <div className="creator-tool-actions short-video-script-result-actions">
                <button className="creator-tool-secondary" type="button" onClick={() => void copyResult()}>
                  <Copy size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('复制脚本', 'Copy script')}
                </button>
                <button className="creator-tool-primary" type="button" onClick={downloadResult}>
                  <Download size={15} strokeWidth={1.8} aria-hidden="true" />
                  {l('下载 Markdown', 'Download Markdown')}
                </button>
              </div>
            </>
          ) : (
            <div className="short-video-script-empty" aria-live="polite">
              {generating
                ? <LoaderCircle className="short-video-script-spinner" size={22} strokeWidth={1.7} aria-hidden="true" />
                : <FilePenLine size={22} strokeWidth={1.7} aria-hidden="true" />}
              <span>{generating ? l('正在生成脚本', 'Generating script') : l('还没有生成脚本', 'No script generated yet')}</span>
            </div>
          )}
        </section>

        {error ? (
          <div className="short-video-script-error" role="alert">
            <span>{error}</span>
          </div>
        ) : null}
        {notice ? <p className="creator-tool-notice" role="status">{notice}</p> : null}
      </div>
    </CreatorToolShell>
  );
}

function readLatestResult(artifacts: CreatorArtifact[]): {
  artifact: CreatorArtifact;
  fileName: string;
  title: string;
} | undefined {
  const artifact = [...artifacts].reverse().find(candidate => (
    candidate.kind === 'short_video_script'
    && candidate.path !== null
    && candidate.status === 'completed'
  ));
  if (artifact === undefined) return undefined;
  return {
    artifact,
    fileName: readString(artifact.metadata.fileName) || 'OpenCreator-short-video-script.md',
    title: readString(artifact.metadata.title) || '短视频脚本'
  };
}

function readPlatform(value: CreatorJson | undefined): ScriptPlatform {
  return value === 'xiaohongshu'
    || value === 'wechat-channels'
    || value === 'bilibili'
    || value === 'generic'
    ? value
    : 'douyin';
}

function readTone(value: CreatorJson | undefined): ScriptTone {
  return value === 'professional' || value === 'energetic' || value === 'storytelling'
    ? value
    : 'natural';
}

function readTargetDuration(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 15 && value <= 600
    ? value
    : 60;
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}

function generationError(
  code: string | null,
  _message: string | null,
  l: (zh: string, en: string) => string
): string {
  if (code === 'creator_llm_config_missing') {
    return l(
      '请先在设置的 AI 服务中配置文本模型',
      'Configure a text model in AI Services first'
    );
  }
  if (code === 'creator_stage_input_missing') {
    return l('请检查主题和脚本设置', 'Check the topic and script settings');
  }
  return l('脚本生成失败，请在 Agent 区域查看诊断后重试', 'Script generation failed. Review the diagnosis in the Agent panel and retry.');
}
