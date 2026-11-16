import type { CreatorArtifact, CreatorJson } from '@opencreator/protocol';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import VideoTranslationResultWorkspace, { type SubtitleCue } from './VideoTranslationResultWorkspace.js';
import {
  createCreatorArtifactObjectUrl,
  readCreatorArtifactText,
  useOptionalCreatorSession
} from './creator-session-store.js';
import { parseTranscriptionSrt } from './transcription-srt.js';

export default function TranscriptionSubtitleEditor(props: {
  result: CreatorArtifact;
  sourceArtifact?: CreatorArtifact;
  sourceName: string;
  sourceLanguage: string;
  onBack(): void;
}) {
  const l = useLocalizedCopy();
  const session = useOptionalCreatorSession();
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const cuesRef = useRef(cues);
  const dirtyRef = useRef(dirty);
  const saveWorkRef = useRef<Promise<boolean>>();
  cuesRef.current = cues;
  dirtyRef.current = dirty;

  const resultVersion = readResultVersion(props.result.metadata.resultVersion);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);
    setSaveError('');
    void readCreatorArtifactText(
      session,
      props.result.id,
      'transcription.load-subtitle-editor',
      l('字幕加载失败，请稍后重试。', 'Could not load the subtitles. Try again later.')
    ).then(value => {
      if (!active) return;
      setCues(parseTranscriptionSrt(value));
      setDirty(false);
    }).catch(cause => {
      if (active) setSaveError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [props.result.id, session?.openArtifact, l]);

  useEffect(() => {
    if (!session || !props.sourceArtifact) {
      setPreviewUrl('');
      setPreviewError('');
      return;
    }
    let active = true;
    let objectUrl = '';
    setPreviewLoading(true);
    setPreviewError('');
    void createCreatorArtifactObjectUrl(
      session,
      props.sourceArtifact.id,
      'transcription.load-source-preview',
      l('原视频加载失败，仍可直接编辑字幕。', 'The source video failed to load. You can still edit the subtitles.')
    ).then(url => {
      objectUrl = url;
      if (active) setPreviewUrl(url);
    }).catch(cause => {
      if (active) setPreviewError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (active) setPreviewLoading(false);
    });
    return () => {
      active = false;
      setPreviewUrl('');
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.sourceArtifact?.id, session?.openArtifact, l]);

  const save = useCallback((): Promise<boolean> => {
    if (!session || !dirtyRef.current) return Promise.resolve(true);
    if (saveWorkRef.current) return saveWorkRef.current;
    setSaving(true);
    setSaveError('');
    const work = (async () => {
      try {
        await session.applyAction({
          actor: 'user',
          action: 'edit-subtitle',
          input: {
            artifactId: props.result.id,
            cues: cuesRef.current,
            baseResultVersion: resultVersion,
            preserveResultVersion: true
          }
        });
        setDirty(false);
        setNotice(l('字幕修改已保存', 'Subtitle changes saved'));
        return true;
      } catch {
        setSaveError(l('字幕保存失败，请重试。', 'Could not save the subtitles. Try again.'));
        return false;
      } finally {
        saveWorkRef.current = undefined;
        setSaving(false);
      }
    })();
    saveWorkRef.current = work;
    return work.catch(() => false);
  }, [props.result.id, resultVersion, session?.applyAction, l]);

  useEffect(() => {
    if (!dirty || saving || saveError || !session) return;
    const timer = window.setTimeout(() => { void save(); }, 900);
    return () => window.clearTimeout(timer);
  }, [cues, dirty, saving, saveError, save, session?.job.id]);

  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, saving]);

  function updateCues(next: SubtitleCue[]) {
    setCues(next);
    setDirty(true);
    setSaveError('');
    setNotice('');
  }

  async function leaveEditor() {
    const pending = saveWorkRef.current;
    if (pending && !await pending) return;
    if (dirtyRef.current && !await save()) return;
    props.onBack();
  }

  function exportText() {
    const content = cues.map(cue => cue.text).join('\n');
    if (!content) return;
    const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${props.sourceName}.txt`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(l('TXT 文本已开始下载', 'The TXT download has started'));
  }

  async function exportSubtitles(artifactId: string) {
    if (!session) return;
    try {
      const response = await session.openArtifact(artifactId);
      if (!response.ok) throw new Error(`Subtitle download failed: ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = readString(props.result.metadata.fileName) || `${props.sourceName}.srt`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(l('SRT 字幕已开始下载', 'The SRT subtitle download has started'));
    } catch {
      setSaveError(l('字幕下载失败，请稍后重试。', 'Could not download the subtitles. Try again later.'));
    }
  }

  return (
    <VideoTranslationResultWorkspace
      activeTab="subtitles"
      version={resultVersion}
      versions={[{ value: resultVersion, description: l('转录结果', 'Transcription result') }]}
      targetLanguage={props.sourceLanguage}
      outputLabel="SRT / TXT"
      subtitleStyleLabel={l('原文转录', 'Source transcription')}
      dubbing={false}
      hasVoiceArtifact={false}
      videoOutputs={[]}
      subtitleOutputs={[{
        artifactId: props.result.id,
        variant: 'horizontal',
        artifactVersion: props.result.version,
        fileName: readString(props.result.metadata.fileName),
        cues,
        readOnly: loading
      }]}
      subtitleExportMenu={{
        label: l('导出', 'Export'),
        items: [
          { id: 'txt', label: l('下载 TXT', 'Download TXT'), onSelect: exportText },
          { id: 'srt', label: l('下载 SRT', 'Download SRT'), onSelect: () => void exportSubtitles(props.result.id) }
        ]
      }}
      subtitleVideoPreviews={props.sourceArtifact ? {
        horizontal: {
          artifactId: props.sourceArtifact.id,
          src: previewUrl || undefined,
          previewLoading,
          previewError: previewError || undefined,
          source: true
        }
      } : {}}
      subtitleDirty={dirty}
      subtitleDirtyByVariant={{ horizontal: dirty }}
      subtitleSavePending={saving}
      subtitleSaveError={saveError || undefined}
      subtitleAutosave
      immersive
      notice={notice || undefined}
      nextVersion={resultVersion + 1}
      affectedArtifacts={[]}
      hasPendingChanges={false}
      regenerationPending={false}
      onImmersiveChange={value => { if (!value) void leaveEditor(); }}
      onSubtitleCuesChange={(_variant, next) => updateCues(next)}
      onSubtitleChange={(_variant, id, text, field = 'text') => updateCues(cues.map(cue => cue.id === id ? { ...cue, [field]: text } : cue))}
      onSaveSubtitles={() => { void save(); }}
      onTabChange={() => undefined}
      onVersionChange={() => undefined}
      onAdjustSettings={props.onBack}
      onExport={(_type, artifactId) => { if (artifactId) void exportSubtitles(artifactId); }}
      onReloadVoice={() => undefined}
      onRequestRegenerate={() => undefined}
      onCancelRegenerate={() => undefined}
      onConfirmRegenerate={() => undefined}
    />
  );
}

function readResultVersion(value: CreatorJson | undefined): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 1;
}

function readString(value: CreatorJson | undefined): string {
  return typeof value === 'string' ? value : '';
}
