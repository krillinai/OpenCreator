import { selectOption } from '../../test/select-option.js';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import VideoTranslationResultWorkspace, { type SubtitleResultOutput } from './VideoTranslationResultWorkspace.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { LanguageSwitchControls } from '../../test/LanguageSwitchControls.js';

const baseProps = {
  version: 1,
  versions: [{ value: 1, description: '初次生成' }],
  targetLanguage: '简体中文',
  outputLabel: '字幕文件',
  subtitleStyleLabel: '系统默认 · 中 · #FFFFFF',
  dubbing: false,
  hasVoiceArtifact: false,
  videoOutputs: [],
  subtitleVideoPreviews: {},
  subtitleOutputs: [{
    artifactId: 'subtitle-horizontal-v1',
    variant: 'horizontal' as const,
    artifactVersion: 1,
    fileName: 'horizontal.srt',
    cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '真实字幕' }],
    readOnly: false
  }],
  subtitleDirty: false,
  subtitleDirtyByVariant: {},
  nextVersion: 2,
  affectedArtifacts: [],
  hasPendingChanges: false,
  regenerationPending: false,
  onTabChange: vi.fn(),
  onVersionChange: vi.fn(),
  onSubtitleChange: vi.fn(),
  onSaveSubtitles: vi.fn(),
  onAdjustSettings: vi.fn(),
  onExport: vi.fn(),
  onReloadVoice: vi.fn(),
  onRequestRegenerate: vi.fn(),
  onCancelRegenerate: vi.fn(),
  onConfirmRegenerate: vi.fn()
};

function EditingHarness(props: { preview?: boolean; readOnly?: boolean; saving?: boolean }) {
  const [immersive, setImmersive] = useState(false);
  const [outputs, setOutputs] = useState<SubtitleResultOutput[]>([{
    ...baseProps.subtitleOutputs[0]!, readOnly: props.readOnly ?? false,
    cues: [
      { id: 1, start: '00:00:00,000', end: '00:00:04,000', text: 'Hello world', sourceText: '你好世界' },
      { id: 2, start: '00:00:05,000', end: '00:00:08,000', text: 'Goodbye world', sourceText: '再见世界' }
    ]
  }]);
  return <VideoTranslationResultWorkspace {...baseProps} activeTab="subtitles" subtitleOutputs={outputs}
    subtitleOnly={!props.preview} immersive={immersive} onImmersiveChange={setImmersive} subtitleSavePending={props.saving}
    subtitleVideoPreviews={props.preview ? { horizontal: { artifactId: 'source', src: 'blob:source', source: true } } : {}}
    onSubtitleCuesChange={(variant, cues) => setOutputs(current => current.map(output => output.variant === variant ? { ...output, cues } : output))} />;
}

describe('VideoTranslationResultWorkspace', () => {
  it('switches between the burned video and live subtitles over the dubbed video', () => {
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const props = { ...baseProps, activeTab: 'subtitles' as const, workbench: true, immersive: true,
      dubbing: true, hasVoiceArtifact: true,
      preferCompletedVideoPreview: true,
      onEditorContextChange: vi.fn(),
      editorSettings: { style: <input aria-label="测试字号" />, voice: <span>配音</span>, disabled: false, onOpen: vi.fn() },
      subtitleVideoPreviews: { horizontal: { artifactId: 'dubbed', src: 'blob:dubbed', source: false, needsSubtitleOverlay: true } },
      videoOutputs: [{ artifactId: 'rendered', variant: 'horizontal' as const, artifactVersion: 2, src: 'blob:rendered' }],
      renderSubtitlePreview: () => <span>字幕叠加</span> };
    const { rerender } = render(<VideoTranslationResultWorkspace {...props} />);
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:rendered');
    expect(screen.getByRole('button', { name: '已生成成片' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('字幕叠加')).not.toBeInTheDocument();
    const video = screen.getByLabelText('横屏字幕视频预览') as HTMLVideoElement;
    fireEvent.loadedMetadata(video);
    video.currentTime = 4.5;
    fireEvent.timeUpdate(video);
    expect(video.currentTime).toBe(4.5);
    expect(props.onEditorContextChange).toHaveBeenLastCalledWith(expect.objectContaining({ time: 4.5 }));
    fireEvent.click(screen.getByRole('button', { name: '字幕样式' }));
    expect(screen.getByLabelText('横屏字幕视频预览')).toBe(video);
    expect(video).toHaveAttribute('src', 'blob:dubbed');
    expect(video.currentTime).toBe(4.5);
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(4.5);
    expect(screen.getByRole('button', { name: '当前样式' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('字幕叠加')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '已生成成片' }));
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:rendered');
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(4.5);
    expect(screen.queryByText('字幕叠加')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '当前样式' }));
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:dubbed');
    expect(screen.getByText('字幕叠加')).toBeVisible();
    rerender(<VideoTranslationResultWorkspace {...props} videoPreviewRequest={{ key: 'render-done', version: 1 }} />);
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:rendered');
    pause.mockRestore();
  });

  it('previews the completed video without autoplay and returns to the source when editing settings or subtitles', () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    const props = { ...baseProps, workbench: true, immersive: true, subtitleAutosave: true,
      editorSettings: { style: <input aria-label="测试字号" />, voice: <span>配音</span>, disabled: false, onOpen: vi.fn() },
      subtitleVideoPreviews: { horizontal: { artifactId: 'source', src: 'blob:source', source: true } },
      videoOutputs: [{ artifactId: 'rendered', variant: 'horizontal' as const, artifactVersion: 1, src: 'blob:rendered' }],
      renderSubtitlePreview: () => <span>实时字幕叠加</span> };
    const { rerender } = render(<VideoTranslationResultWorkspace {...props} activeTab="subtitles" />);
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:source');
    rerender(<VideoTranslationResultWorkspace {...props} activeTab="subtitles" videoPreviewRequest={{ key: 'done', version: 1 }} />);
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:rendered');
    expect(screen.getByLabelText('横屏字幕视频预览')).not.toHaveAttribute('autoplay');
    expect(play).not.toHaveBeenCalled();
    expect(screen.queryByText('实时字幕叠加')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '当前样式' }));
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:source');
    expect(screen.getByText('实时字幕叠加')).toBeVisible();
    rerender(<VideoTranslationResultWorkspace {...props} activeTab="subtitles" videoPreviewRequest={{ key: 'view-again', version: 1 }} />);
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:rendered');
    fireEvent.focus(screen.getByRole('textbox', { name: '测试字号' }));
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:source');
    rerender(<VideoTranslationResultWorkspace {...props} activeTab="subtitles" videoPreviewRequest={{ key: 'view-third', version: 1 }} />);
    fireEvent.change(screen.getByRole('textbox', { name: '横屏字幕 1' }), { target: { value: '新字幕' } });
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:source');
    rerender(<VideoTranslationResultWorkspace {...props} activeTab="subtitles" onPrepareSourceVideo={vi.fn()}
      videoOutputs={[{ ...props.videoOutputs[0]!, src: undefined, previewError: '成片加载失败' }]}
      videoPreviewRequest={{ key: 'unavailable-preview', version: 1 }} />);
    expect(screen.getByText('成片加载失败')).toBeVisible();
    expect(screen.queryByRole('button', { name: '重试下载原视频' })).toBeNull();
    play.mockRestore(); pause.mockRestore();
  });

  it('keeps shared task progress visible when settings collapse or the output view changes', () => {
    const props = { ...baseProps, workbench: true, immersive: true,
      taskProgress: <section aria-label="当前任务进度">生成配音 45%</section>,
      editorSettings: { style: <span>样式</span>, voice: <span>配音</span>, disabled: true, onOpen: vi.fn() },
      outputBusyLabel: '正在生成配音', outputDisabled: true };
    const { rerender } = render(<VideoTranslationResultWorkspace {...props} activeTab="subtitles" />);
    const bar = screen.getByRole('region', { name: '当前任务进度' });
    expect(bar.parentElement?.firstElementChild?.tagName).toBe('HEADER');
    expect(screen.getByRole('button', { name: '正在生成配音' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '收起设置' }));
    expect(bar).toBeVisible();
    rerender(<VideoTranslationResultWorkspace {...props} activeTab="video" />);
    expect(screen.getAllByRole('region', { name: '当前任务进度' })).toHaveLength(1);
  });

  it('finds and replaces across cues, navigates matches, and undoes or redoes a batch as one edit', () => {
    render(<EditingHarness />);
    fireEvent.click(screen.getByRole('button', { name: '深度编辑' }));
    fireEvent.keyDown(screen.getByRole('button', { name: '返回项目' }), { key: 'h', ctrlKey: true });
    const find = screen.getByRole('search', { name: '查找与替换' });
    expect(within(find).getByRole('combobox', { name: '搜索范围' })).toHaveValue('all');
    const input = within(find).getByRole('textbox', { name: '查找' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'world' } });
    expect(within(find).getByRole('status')).toHaveTextContent('1 / 2');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(find).getByRole('status')).toHaveTextContent('2 / 2');
    expect(screen.getAllByRole('listitem')[1]).toHaveAttribute('data-focused', 'true');
    fireEvent.click(within(find).getByRole('button', { name: '下一处' }));
    expect(within(find).getByRole('status')).toHaveTextContent('1 / 2');
    fireEvent.change(within(find).getByRole('textbox', { name: '替换为' }), { target: { value: '$&' } });
    fireEvent.click(within(find).getByRole('button', { name: '全部替换' }));
    expect(screen.getByDisplayValue('Hello $&')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Goodbye $&')).toBeInTheDocument();
    expect(screen.getByDisplayValue('你好世界')).toBeInTheDocument();
    expect(within(find).getByRole('status')).toHaveTextContent('无匹配结果');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getByDisplayValue('Hello world')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Goodbye world')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getByDisplayValue('Hello $&')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('search')).toBeNull();
    expect(screen.getByRole('button', { name: '查找与替换' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '返回项目' })).toBeInTheDocument();
  });

  it('replaces the current occurrence in source text and supports empty replacements and case matching', () => {
    render(<EditingHarness />);
    fireEvent.click(screen.getByRole('button', { name: '查找与替换' }));
    const find = screen.getByRole('search');
    selectOption(within(find).getByRole('combobox', { name: '搜索范围' }), 'sourceText');
    fireEvent.change(within(find).getByRole('textbox', { name: '查找' }), { target: { value: '世界' } });
    fireEvent.click(within(find).getByRole('button', { name: '替换' }));
    expect(screen.getByDisplayValue('你好')).toBeInTheDocument();
    expect(screen.getByDisplayValue('再见世界')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Hello world')).toBeInTheDocument();
    selectOption(within(find).getByRole('combobox'), 'text');
    fireEvent.change(within(find).getByRole('textbox', { name: '查找' }), { target: { value: 'HELLO' } });
    expect(within(find).getByRole('status')).toHaveTextContent('1 / 1');
    fireEvent.click(within(find).getByRole('button', { name: '区分大小写' }));
    expect(within(find).getByRole('status')).toHaveTextContent('无匹配结果');
  });

  it.each([{ readOnly: true }, { saving: true }])('allows search but prevents replacement when edits are unavailable: %j', state => {
    render(<EditingHarness {...state} />);
    fireEvent.click(screen.getByRole('button', { name: '查找与替换' }));
    const find = screen.getByRole('search');
    fireEvent.change(within(find).getByRole('textbox', { name: '查找' }), { target: { value: 'world' } });
    expect(within(find).getByRole('status')).toHaveTextContent('1 / 2');
    expect(within(find).getByRole('button', { name: '下一处' })).toBeEnabled();
    expect(within(find).getByRole('button', { name: '替换' })).toBeDisabled();
    expect(within(find).getByRole('button', { name: '全部替换' })).toBeDisabled();
  });

  it('advances past replacement text containing the search term and keeps the batch within the chosen fields', () => {
    function Harness() {
      const [output, setOutput] = useState<SubtitleResultOutput>({ ...baseProps.subtitleOutputs[0]!,
        cues: [{ id: 1, start: '00:00:00,000', end: '00:00:04,000', text: 'hi hi', sourceText: 'hi' }] });
      return <VideoTranslationResultWorkspace {...baseProps} activeTab="subtitles" subtitleOutputs={[output]}
        onSubtitleCuesChange={(_variant, cues) => setOutput({ ...output, cues })} />;
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '查找与替换' }));
    const find = screen.getByRole('search');
    selectOption(within(find).getByRole('combobox'), 'text');
    fireEvent.change(within(find).getByRole('textbox', { name: '查找' }), { target: { value: 'hi' } });
    const replacement = within(find).getByRole('textbox', { name: '替换为' });
    fireEvent.change(replacement, { target: { value: 'hi!' } });
    fireEvent.keyDown(replacement, { key: 'Enter' });
    expect(screen.getByDisplayValue('hi! hi')).toBeInTheDocument();
    expect(within(find).getByRole('status')).toHaveTextContent('2 / 2');
    selectOption(within(find).getByRole('combobox'), 'all');
    fireEvent.change(replacement, { target: { value: 'bye' } });
    fireEvent.click(within(find).getByRole('button', { name: '全部替换' }));
    expect(screen.getByDisplayValue('bye! bye')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '横屏字幕原文 1' })).toHaveValue('bye');
  });

  it.each([false, true])('offers editing in the overview toolbar and reserves generation for the editor when confirming is %s', regenerationPending => {
    const onImmersiveChange = vi.fn(), onRequestRegenerate = vi.fn(), onConfirmRegenerate = vi.fn();
    const props = { ...baseProps, hasPendingChanges: true, regenerationPending,
      onImmersiveChange, onRequestRegenerate, onConfirmRegenerate };
    const { rerender } = render(<VideoTranslationResultWorkspace {...props} activeTab="video" />);
    const expectEditingOnly = () => {
      const edit = screen.getByRole('button', { name: '深度编辑' });
      expect(edit.closest('.video-result-toolbar-actions')).not.toBeNull();
      expect(screen.queryByRole('button', { name: /生成 V2|取消/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: '生成新版本' })).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: '确认生成新版本' })).not.toBeInTheDocument();
    };
    expectEditingOnly();
    rerender(<VideoTranslationResultWorkspace {...props} activeTab="video"
      videoOutputs={[{ artifactId: 'final-video', variant: 'horizontal', artifactVersion: 1, src: 'blob:final' }]} />);
    expectEditingOnly();
    fireEvent.click(screen.getByRole('button', { name: '深度编辑' }));
    expect(onImmersiveChange).toHaveBeenCalledWith(true);
    expect(onRequestRegenerate).not.toHaveBeenCalled();
    expect(onConfirmRegenerate).not.toHaveBeenCalled();

    rerender(<VideoTranslationResultWorkspace {...props} activeTab="subtitles" immersive />);
    expect(screen.getByRole('button', { name: regenerationPending ? '确认生成 V2' : '生成 V2' }).closest('header')).not.toBeNull();
    expect(screen.queryByRole('button', { name: '深度编辑' })).not.toBeInTheDocument();
  });

  it('keeps generation available in the subtitle-only workspace', () => {
    render(<VideoTranslationResultWorkspace {...baseProps} subtitleOnly activeTab="subtitles" hasPendingChanges />);
    expect(screen.getByRole('button', { name: '生成 V2' }).closest('.video-result-toolbar-actions')).not.toBeNull();
  });

  it('opens shared editor settings without replacing the player and keeps explicit regeneration available', () => {
    const onOpen = vi.fn(), onRequest = vi.fn(), onImmersiveChange = vi.fn();
    const settings = { language: <label>Shared language<select aria-label="Shared language"><option>English</option></select></label>,
      style: <label>Shared style<input aria-label="Shared style" /></label>, voice: <p>Shared dubbing settings</p>,
      output: <label>Shared format<select aria-label="Shared format"><option>16:9</option><option>9:16</option></select></label>, disabled: false, onOpen };
    const { rerender } = render(<VideoTranslationResultWorkspace {...baseProps} activeTab="subtitles" immersive
      editorSettings={settings} hasPendingChanges onRequestRegenerate={onRequest} onImmersiveChange={onImmersiveChange}
      subtitleOutputs={[...baseProps.subtitleOutputs, { ...baseProps.subtitleOutputs[0]!, artifactId: 'vertical-subtitle', variant: 'vertical' }]}
      subtitleVideoPreviews={{ horizontal: { artifactId: 'source', src: 'blob:source', source: true } }} />);
    const video = screen.getByLabelText('横屏字幕视频预览');
    expect(screen.getByRole('button', { name: '生成 V2' }).closest('header')).not.toBeNull();
    expect(screen.getByRole('button', { name: '输出格式' }).closest('.video-result-subtitle-video')).toBeNull();
    expect(screen.getByRole('button', { name: '翻译语言' }).querySelector('.lucide-languages')).not.toBeNull();
    const rail = screen.getByRole('group', { name: '项目设置' });
    expect(within(rail).getAllByRole('button').slice(1).map(button => button.getAttribute('aria-label')))
      .toEqual(['翻译语言', '输出格式', '字幕样式', '配音']);
    expect(screen.queryByRole('radiogroup', { name: '字幕画幅' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开侧栏' }));
    expect(screen.getByRole('button', { name: '收起侧栏' })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: '收起侧栏' }));
    expect(screen.getByRole('button', { name: '展开侧栏' })).toHaveAttribute('aria-expanded', 'false');
    const styleTrigger = screen.getByRole('button', { name: '字幕样式' });
    styleTrigger.focus();
    fireEvent.click(styleTrigger);
    expect(onOpen).toHaveBeenCalledOnce();
    const dialog = screen.getByRole('complementary', { name: '字幕样式' });
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(dialog.parentElement).toBe(video.closest('.video-result-workspace'));
    expect(within(dialog).getByRole('button', { name: '生成 V2' }).closest('header')).not.toBeNull();
    expect(video.closest('.video-result-workspace')).not.toHaveAttribute('inert');
    expect(video.closest('.video-result-workspace')).toHaveAttribute('data-settings-open', 'true');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fireEvent.keyDown(within(dialog).getByRole('button', { name: '完成' }), { key: 'Tab' })).toBe(true);
    fireEvent.timeUpdate(video, { target: { currentTime: 0.5 } });
    expect(screen.getByRole('slider', { name: '播放位置' })).toHaveAttribute('aria-valuenow', '0.5');
    expect(screen.getByRole('textbox', { name: 'Shared style' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('tab', { name: '翻译语言' }));
    expect(within(dialog).getByRole('combobox', { name: 'Shared language' })).toBeEnabled();
    expect(within(dialog).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['翻译语言', '输出格式', '字幕样式', '配音']);
    fireEvent.keyDown(within(dialog).getByRole('tab', { name: '翻译语言' }), { key: 'ArrowRight' });
    expect(within(dialog).getByRole('tab', { name: '输出格式' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('tab', { name: '输出格式' }));
    expect(within(dialog).getByRole('combobox', { name: 'Shared format' })).toBeEnabled();
    expect(onOpen).toHaveBeenCalledOnce();
    fireEvent.click(within(dialog).getByRole('tab', { name: '配音' }));
    expect(screen.getByText('Shared dubbing settings')).toBeVisible();
    expect(screen.getByLabelText('横屏字幕视频预览')).toBe(video);
    fireEvent.click(screen.getByRole('button', { name: '生成 V2' }));
    expect(onRequest).toHaveBeenCalledOnce();
    rerender(<VideoTranslationResultWorkspace {...baseProps} activeTab="subtitles" immersive
      editorSettings={{ ...settings, disabled: true }} hasPendingChanges regenerationPending affectedArtifacts={['配音', '成片']} onImmersiveChange={onImmersiveChange}
      subtitleVideoPreviews={{ horizontal: { artifactId: 'source', src: 'blob:source', source: true } }} />);
    expect(screen.getByText('将更新配音、成片，V1 的全部产出会保留')).toBeVisible();
    expect(screen.getByRole('button', { name: '确认生成 V2' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: '确认生成 V2' }).closest('header')).not.toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: '字幕样式' }));
    expect(screen.getByRole('textbox', { name: 'Shared style' })).toBeDisabled();
    fireEvent.keyDown(screen.getByRole('button', { name: '收起设置' }), { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(onImmersiveChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '返回项目' })).toHaveFocus();
    expect(video.closest('.video-result-workspace')).not.toHaveAttribute('data-settings-open');
    expect(video.closest('.video-result-workspace')).not.toHaveAttribute('inert');
  });

  it('preserves the selected settings, input state, scroll position, and timeline layout across version changes', () => {
    const props = { ...baseProps, activeTab: 'subtitles' as const, immersive: true, workbench: true,
      editorSettings: { style: <p>Style settings</p>, voice: <input aria-label="Voice choice" defaultValue="Narrator" />,
        disabled: false, onOpen: vi.fn() } };
    const { rerender } = render(<VideoTranslationResultWorkspace {...props} />);
    fireEvent.click(screen.getByRole('tab', { name: '配音' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Voice choice' }), { target: { value: 'Reader' } });
    const body = screen.getByRole('complementary', { name: '配音' }).querySelector('.subtitle-editor-settings-body')!;
    body.scrollTop = 80;
    fireEvent.keyDown(screen.getByRole('separator', { name: '调整时间轴高度' }), { key: 'ArrowUp' });
    fireEvent.click(screen.getByRole('button', { name: '收起设置' }));
    fireEvent.click(screen.getByRole('button', { name: '收起时间轴' }));

    rerender(<VideoTranslationResultWorkspace {...props} version={2} />);
    expect(screen.queryByRole('complementary', { name: '配音' })).toBeNull();
    expect(screen.getByRole('button', { name: '展开时间轴' })).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getByRole('button', { name: '展开设置' }));
    expect(screen.getByRole('complementary', { name: '配音' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: 'Voice choice' })).toHaveValue('Reader');
    expect(body.scrollTop).toBe(80);
    expect(screen.getByRole('button', { name: '展开时间轴' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '展开时间轴' }));
    expect(screen.getByRole('separator', { name: '调整时间轴高度' })).toHaveAttribute('aria-valuenow', '220');
  });

  it('previews saved bilingual subtitles on the source throughout editing even when a rendered video exists', () => {
    const settings = { style: <p>Style settings</p>, voice: null, disabled: false, onOpen: vi.fn(),
      previewFormat: 'horizontal' as const, previewTitles: <p>Portrait title</p> };
    const renderSubtitlePreview = vi.fn(() => <p>Bilingual subtitle overlay</p>);
    const props = { ...baseProps, activeTab: 'subtitles' as const, immersive: true, editorSettings: settings,
      videoOutputs: [{ artifactId: 'final', variant: 'horizontal' as const, artifactVersion: 1, src: 'blob:final' }],
      subtitleVideoPreviews: { horizontal: { artifactId: 'source', src: 'blob:source', source: true } },
      subtitleOutputs: [{ ...baseProps.subtitleOutputs[0]!, cues: [{ ...baseProps.subtitleOutputs[0]!.cues[0]!, sourceText: 'Original subtitle' }] }],
      renderSubtitlePreview };
    const { rerender } = render(<VideoTranslationResultWorkspace {...props} />);
    const video = screen.getByLabelText('横屏字幕视频预览') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', 'blob:source');
    expect(screen.getByText('Bilingual subtitle overlay')).toBeVisible();
    expect(renderSubtitlePreview).toHaveBeenLastCalledWith(props.subtitleOutputs[0]!.cues, 1920, 1080, expect.objectContaining({ current: video }), 'horizontal');
    expect(screen.queryByText('Portrait title')).toBeNull();
    expect(video.closest('.video-result-player-frame')).toHaveAttribute('data-ratio', '16:9');
    fireEvent.timeUpdate(video, { target: { currentTime: 0.5 } });
    fireEvent.click(screen.getByRole('button', { name: '字幕样式' }));
    expect(video).toHaveAttribute('src', 'blob:source');
    expect(video.currentTime).toBe(0.5);
    rerender(<VideoTranslationResultWorkspace {...props} editorSettings={{ ...settings, previewFormat: 'vertical' }} />);
    expect(screen.getByLabelText('竖屏字幕视频预览')).toBe(video);
    expect(video).toHaveAttribute('src', 'blob:source');
    expect(video.currentTime).toBe(0.5);
    expect(screen.getByText('Bilingual subtitle overlay')).toBeVisible();
    expect(renderSubtitlePreview).toHaveBeenLastCalledWith(props.subtitleOutputs[0]!.cues, 720, 1280, expect.objectContaining({ current: video }), 'vertical');
    expect(video.closest('.video-result-player-frame')).toHaveAttribute('data-ratio', '9:16');
    expect(screen.queryByText('Portrait title')).toBeNull();
    rerender(<VideoTranslationResultWorkspace {...props} editorSettings={{ ...settings, previewFormat: 'horizontal' }} />);
    expect(video.closest('.video-result-player-frame')).toHaveAttribute('data-ratio', '16:9');
    expect(renderSubtitlePreview).toHaveBeenLastCalledWith(props.subtitleOutputs[0]!.cues, 1920, 1080, expect.objectContaining({ current: video }), 'horizontal');
    expect(screen.queryByText('Portrait title')).toBeNull();
    expect(video.currentTime).toBe(0.5);
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(video).toHaveAttribute('src', 'blob:source');
    expect(screen.getByText('Bilingual subtitle overlay')).toBeVisible();
    expect(video.currentTime).toBe(0.5);
  });

  it('synchronizes generated dubbing with the video and restores its original audio on exit', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    try {
      const props = { ...baseProps, activeTab: 'subtitles' as const, immersive: true,
        editorSettings: { style: null, voice: null, disabled: false, onOpen: vi.fn() },
        subtitleVideoPreviews: { horizontal: { artifactId: 'source', src: 'blob:source', source: true } },
        voiceOutput: { artifactId: 'dub', artifactVersion: 1, src: 'blob:dub' } };
      const { container, rerender } = render(<VideoTranslationResultWorkspace {...props} />);
      const video = screen.getByLabelText('横屏字幕视频预览') as HTMLVideoElement;
      const audio = container.querySelector('audio')!;
      video.currentTime = 2;
      fireEvent.click(screen.getByRole('button', { name: '目标语言配音试听' }));
      expect(video.muted).toBe(true);
      fireEvent.play(video);
      expect(play).toHaveBeenCalled();
      expect(audio.currentTime).toBe(2);
      video.currentTime = 6;
      fireEvent.timeUpdate(video);
      expect(audio.currentTime).toBe(6);
      fireEvent.pause(video);
      expect(pause).toHaveBeenCalled();
      rerender(<VideoTranslationResultWorkspace {...props} immersive={false} />);
      expect(video.muted).toBe(false);
      expect(container.querySelector('audio')).toBeNull();
    } finally { play.mockRestore(); pause.mockRestore(); }
  });

  it('keeps dubbing selected when pausing intentionally aborts a pending play request', async () => {
    let rejectPlay!: (error: Error) => void;
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => new Promise((_, reject) => { rejectPlay = reject; }));
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    try {
      const { unmount } = render(<VideoTranslationResultWorkspace {...baseProps} activeTab="subtitles" immersive
        editorSettings={{ style: null, voice: null, disabled: false, onOpen: vi.fn() }}
        subtitleVideoPreviews={{ horizontal: { artifactId: 'source', src: 'blob:source', source: true } }}
        voiceOutput={{ artifactId: 'dub', artifactVersion: 1, src: 'blob:dub' }} />);
      const video = screen.getByLabelText('横屏字幕视频预览');
      const toggle = screen.getByRole('button', { name: '目标语言配音试听' });
      fireEvent.click(toggle);
      fireEvent.play(video);
      fireEvent.pause(video);
      await act(async () => rejectPlay(new DOMException('Playback paused', 'AbortError')));
      expect(toggle).toHaveAttribute('aria-pressed', 'true');
      unmount();
    } finally { play.mockRestore(); pause.mockRestore(); }
  });

  it('enters and exits immersive editing with the same video element, playhead and draft', () => {
    render(<EditingHarness preview />);
    const video = screen.getByLabelText('横屏字幕视频预览') as HTMLVideoElement;
    video.currentTime = 2;
    fireEvent.timeUpdate(video);
    fireEvent.change(screen.getByRole('textbox', { name: '横屏字幕 1' }), { target: { value: 'Edited before entering' } });
    fireEvent.click(screen.getByRole('button', { name: '深度编辑' }));
    expect(screen.getByRole('button', { name: '返回项目' })).toHaveFocus();
    expect(screen.getByLabelText('横屏字幕视频预览')).toBe(video);
    expect(screen.getByRole('slider', { name: '播放位置' })).toHaveAttribute('aria-valuenow', '2');
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' })).toHaveValue('Edited before entering');
    fireEvent.keyDown(screen.getByRole('button', { name: '返回项目' }), { key: 'Escape' });
    expect(screen.queryByRole('region', { name: '字幕时间轴' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('横屏字幕视频预览')).toBe(video);
    expect(video.currentTime).toBe(2);
    expect(screen.getByRole('button', { name: '深度编辑' })).toHaveFocus();
  });

  it('moves the editing selection with playback and keeps a single visual focus when paused', () => {
    const { container } = render(<EditingHarness preview />);
    fireEvent.click(screen.getByRole('button', { name: '深度编辑' }));
    const video = screen.getByLabelText('横屏字幕视频预览') as HTMLVideoElement;
    const rows = screen.getAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:00,000' }));
    fireEvent.play(video);
    fireEvent.timeUpdate(video, { target: { currentTime: 6 } });
    expect(rows[0]).toHaveAttribute('data-selected', 'false');
    expect(rows[1]).toHaveAttribute('data-selected', 'true');
    expect(container.querySelectorAll('.video-subtitle-cue[data-focused="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('.subtitle-timeline-clip[data-focused="true"]')).toHaveLength(1);
    expect(screen.getByRole('spinbutton', { name: '开始时间' })).toHaveValue(5);
    fireEvent.pause(video);
    fireEvent.focus(screen.getByRole('textbox', { name: '横屏字幕 1' }));
    expect(rows[0]).toHaveAttribute('data-focused', 'true');
    expect(rows[1]).toHaveAttribute('data-focused', 'false');
    expect(screen.getByRole('spinbutton', { name: '开始时间' })).toHaveValue(0);
    fireEvent.play(video);
    fireEvent.timeUpdate(video, { target: { currentTime: 4.5 } });
    expect(container.querySelectorAll('.video-subtitle-cue[data-focused="true"]')).toHaveLength(0);
    expect(container.querySelectorAll('.subtitle-timeline-clip[data-focused="true"]')).toHaveLength(0);
  });

  it('edits timing and both languages in subtitle-only mode with structural undo and redo', () => {
    render(<EditingHarness />);
    fireEvent.click(screen.getByRole('button', { name: '深度编辑' }));
    expect(document.querySelector('video')).toBeNull();
    expect(screen.queryByRole('button', { name: '字幕样式' })).toBeNull();
    expect(screen.queryByRole('button', { name: '配音' })).toBeNull();
    expect(screen.getByText('仅字幕时间轴')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:00,000' }));
    const playhead = screen.getByRole('slider', { name: '播放位置' });
    for (let i = 0; i < 20; i++) fireEvent.keyDown(playhead, { key: 'ArrowRight' });
    fireEvent.click(screen.getByRole('button', { name: '拆分' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByRole('textbox', { name: '字幕 1' })).toHaveValue('Hello');
    expect(screen.getByRole('textbox', { name: '字幕 2' })).toHaveValue('world');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: '字幕 1' })).toHaveValue('Hello world');
    fireEvent.click(screen.getByRole('button', { name: '重做' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: '合并' }));
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: '字幕原文 1' })).toHaveValue('你好\n世界');
    const end = screen.getByRole('spinbutton', { name: '结束时间' });
    fireEvent.change(end, { target: { value: '4.375' } });
    fireEvent.blur(end);
    expect(screen.getByRole('spinbutton', { name: '结束时间' })).toHaveValue(4.375);
    fireEvent.click(screen.getByRole('button', { name: '返回项目' }));
    expect(screen.getByRole('button', { name: '跳转到 00:00:00,000' }).querySelector('small')).toHaveAttribute('title', '00:00:00,000 - 00:00:04,375');
  });

  it('rejects invalid timing and locks all structural editing while saving or read-only', () => {
    const view = render(<EditingHarness />);
    fireEvent.click(screen.getByRole('button', { name: '深度编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:00,000' }));
    const end = screen.getByRole('spinbutton', { name: '结束时间' });
    fireEvent.change(end, { target: { value: '0' } }); fireEvent.blur(end);
    expect(screen.getByRole('alert')).toHaveTextContent('结束时间须晚于开始时间至少 0.08 秒。');
    expect(end).toHaveValue(4);
    view.rerender(<EditingHarness saving />);
    expect(screen.getByRole('button', { name: '合并' })).toBeDisabled();
    expect(screen.getByRole('spinbutton', { name: '结束时间' })).toBeDisabled();
    expect(screen.getByRole('textbox', { name: '字幕 1' })).toHaveAttribute('readonly');
    view.unmount();
    render(<EditingHarness readOnly />);
    fireEvent.click(screen.getByRole('button', { name: '深度编辑' }));
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:00,000' }));
    expect(screen.getByRole('button', { name: '合并' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: '保存字幕' })).not.toBeInTheDocument();
  });

  it.each([
    ['queued', 'Translation is queued'],
    ['running', 'Translation in progress'],
    ['needs_input', 'Translation needs your attention'],
    ['failed', 'Translation failed'],
    ['canceled', 'Translation stopped'],
    ['interrupted', 'Translation interrupted']
  ] as const)('shows the %s task state before any outputs exist', (status, title) => {
    render(<LanguageProvider initialPreference="en-US"><VideoTranslationResultWorkspace
      {...baseProps} activeTab="video" subtitleOutputs={[]}
      execution={{ status, stageLabel: 'Subtitle translation' }}
    /></LanguageProvider>);
    expect(screen.getByText(title)).toBeVisible();
    expect(screen.queryByText('This project version has no works')).not.toBeInTheDocument();
    expect(screen.queryByText('No outputs available for this version')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Outputs' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Project V1' }).querySelector('.lucide-circle-check')).toBeNull();
  });

  it('distinguishes subtitles still processing from an empty generated subtitle file', () => {
    const view = render(<LanguageProvider initialPreference="en-US"><VideoTranslationResultWorkspace
      {...baseProps} activeTab="subtitles" subtitleOutputs={[]}
      execution={{ status: 'running', stageLabel: 'Subtitle translation' }}
    /></LanguageProvider>);
    expect(screen.getByText('Subtitles are not ready yet')).toBeVisible();
    view.rerender(<LanguageProvider initialPreference="en-US"><VideoTranslationResultWorkspace
      {...baseProps} activeTab="subtitles" subtitleOutputs={[{ ...baseProps.subtitleOutputs[0]!, cues: [] }]}
    /></LanguageProvider>);
    expect(screen.getByText('The subtitle file contains no cues')).toBeVisible();
    expect(screen.queryByText('Subtitles are not ready yet')).not.toBeInTheDocument();
  });

  it('keeps generated files visible while later stages are running', () => {
    render(<LanguageProvider initialPreference="en-US"><VideoTranslationResultWorkspace
      {...baseProps} activeTab="video" execution={{ status: 'running', stageLabel: 'Dubbing' }}
    /></LanguageProvider>);
    expect(screen.getByText('horizontal.srt')).toBeVisible();
    expect(screen.getByText('Translation in progress · Current stage: Dubbing')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Project V1' })).toBeVisible();
  });

  it('distinguishes pending dubbing from disabled dubbing and does not invite duplicate generation', () => {
    const view = render(<LanguageProvider initialPreference="en-US"><VideoTranslationResultWorkspace
      {...baseProps} activeTab="voice" dubbing execution={{ status: 'running', stageLabel: 'Subtitle translation' }}
    /></LanguageProvider>);
    expect(screen.getByText('Dubbing is not ready yet')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enable dubbing and generate a new version' })).not.toBeInTheDocument();
    view.rerender(<LanguageProvider initialPreference="en-US"><VideoTranslationResultWorkspace
      {...baseProps} activeTab="voice" execution={{ status: 'running', stageLabel: 'Subtitle translation' }}
    /></LanguageProvider>);
    expect(screen.getByText('Dubbing is disabled for this version')).toBeVisible();
    expect(screen.queryByText('Dubbing is not ready yet')).not.toBeInTheDocument();
    view.rerender(<LanguageProvider initialPreference="en-US"><VideoTranslationResultWorkspace
      {...baseProps} activeTab="voice" dubbing
    /></LanguageProvider>);
    expect(screen.getByRole('button', { name: 'Adjust dubbing settings' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Enable dubbing and generate a new version' })).not.toBeInTheDocument();
  });

  it('localizes preview loading failures without modifying subtitles or automatically retrying', () => {
    const raw = '后台原文：原视频读取失败';
    const onPrepareSourceVideo = vi.fn();
    render(<LanguageProvider initialPreference="zh-CN"><LanguageSwitchControls /><VideoTranslationResultWorkspace
      {...baseProps} activeTab="subtitles" onPrepareSourceVideo={onPrepareSourceVideo}
      subtitleVideoPreviews={{ horizontal: { artifactId: 'source', previewError: raw, source: true } }}
    /></LanguageProvider>);
    expect(screen.getByText('视频预览加载失败，请检查诊断信息后重试。')).toBeVisible();
    expect(screen.getByText(raw)).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    expect(screen.getByText('Video preview failed to load. Check the diagnostics and retry.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getByText('Det gick inte att läsa in videoförhandsvisningen. Kontrollera diagnostiken och försök igen.')).toBeVisible();
    expect(screen.getByText('真实字幕')).toBeVisible();
    expect(screen.getByText(raw)).not.toBeVisible();
    expect(onPrepareSourceVideo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Visa ursprunglig diagnostik'));
    expect(screen.getByText(raw)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Försök ladda ned originalvideon igen' }));
    expect(onPrepareSourceVideo).toHaveBeenCalledOnce();
  });
  it.each(['video', 'subtitles'] as const)('offers a user-triggered source download in the %s tab', activeTab => {
    const onPrepareSourceVideo = vi.fn();
    render(<VideoTranslationResultWorkspace {...baseProps} activeTab={activeTab} onPrepareSourceVideo={onPrepareSourceVideo} />);
    expect(screen.getByText('字幕已翻译完成')).toBeInTheDocument();
    expect(onPrepareSourceVideo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '下载原视频并预览' }));
    expect(onPrepareSourceVideo).toHaveBeenCalledOnce();
    expect(screen.getByText(activeTab === 'subtitles' ? '真实字幕' : 'horizontal.srt')).toBeInTheDocument();
  });

  it.each(['video', 'subtitles'] as const)('disables duplicate downloads in the %s tab and keeps subtitle editing available while preparing media', activeTab => {
    render(<VideoTranslationResultWorkspace {...baseProps} activeTab={activeTab} onPrepareSourceVideo={vi.fn()} previewPreparation={{ pending: true }} />);
    expect(screen.getByRole('button', { name: /正在准备/ })).toBeDisabled();
    expect(screen.getByText(/字幕可以继续编辑/)).toBeInTheDocument();
  });

  it.each(['video', 'subtitles'] as const)('offers retry after failure in the %s tab without blocking subtitle access', activeTab => {
    const onPrepareSourceVideo = vi.fn();
    render(<VideoTranslationResultWorkspace {...baseProps} activeTab={activeTab} onPrepareSourceVideo={onPrepareSourceVideo} previewPreparation={{ pending: false, error: '下载失败，字幕仍可编辑' }} />);
    fireEvent.click(screen.getByRole('button', { name: '重试下载原视频' }));
    expect(onPrepareSourceVideo).toHaveBeenCalledOnce();
    expect(screen.getByText('下载失败，字幕仍可编辑')).toBeInTheDocument();
    expect(screen.getByText(activeTab === 'subtitles' ? '真实字幕' : 'horizontal.srt')).toBeInTheDocument();
  });

  it('does not show a fake download entry when no source preparation capability is provided', () => {
    render(<VideoTranslationResultWorkspace {...baseProps} activeTab="subtitles" />);
    expect(screen.queryByRole('button', { name: '下载原视频并预览' })).not.toBeInTheDocument();
  });

  it('does not redownload when a playable source already exists', () => {
    render(<VideoTranslationResultWorkspace {...baseProps} activeTab="subtitles" onPrepareSourceVideo={vi.fn()}
      subtitleVideoPreviews={{ horizontal: { artifactId: 'source', src: 'blob:source', source: true } }} />);
    expect(screen.getByLabelText('横屏字幕视频预览')).toHaveAttribute('src', 'blob:source');
    expect(screen.queryByRole('button', { name: '下载原视频并预览' })).not.toBeInTheDocument();
  });

  it('shows subtitle-only output in an always-visible outputs tab', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="video"
        onExport={onExport}
      />
    );

    expect(screen.getByRole('tab', { name: '作品' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['作品']);
    expect(screen.queryByRole('tab', { name: '字幕' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: '配音' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '作品' })).not.toBeInTheDocument();
    expect(screen.queryByText('项目 V1 · 1 个文件')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '项目 V1' })).toBeInTheDocument();
    expect(screen.getByText('horizontal.srt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载横屏字幕' }));
    expect(onExport).toHaveBeenCalledWith('subtitles', 'subtitle-horizontal-v1');
  });

  it('shows a registered video artifact instead of previewing the source URL', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="video"
        subtitleVideoPreviews={{ horizontal: { artifactId: 'source', src: 'blob:source', source: true } }}
        videoOutputs={[{
          artifactId: 'horizontal-video-v1',
          variant: 'horizontal',
          artifactVersion: 1,
          fileName: 'translated-horizontal.mp4',
          src: 'blob:http://localhost/translated-video'
        }]}
        outputLabel="横屏视频 16:9"
        onExport={onExport}
      />
    );

    expect(screen.getByText('translated-horizontal.mp4')).toBeInTheDocument();
    expect(screen.queryByText('子项 V1 · 项目 V1')).not.toBeInTheDocument();
    expect(screen.getByText('横屏 16:9')).toBeInTheDocument();
    expect(screen.getByLabelText('横屏成片预览')).toHaveAttribute(
      'src',
      'blob:http://localhost/translated-video'
    );
    expect(screen.queryByTitle('YouTube 视频预览')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '同步视频预览' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载横屏成片' }));
    expect(onExport).toHaveBeenCalledWith('video', 'horizontal-video-v1');
  });

  it('previews source media with translated subtitles in outputs without inventing a rendered file', () => {
    const onImmersiveChange = vi.fn();
    const onExport = vi.fn();
    render(<VideoTranslationResultWorkspace {...baseProps} activeTab="video" onImmersiveChange={onImmersiveChange} onExport={onExport}
      subtitleVideoPreviews={{ horizontal: { artifactId: 'source', src: 'blob:source', source: true } }} />);
    const video = screen.getByLabelText('横屏字幕视频预览');
    expect(video).toHaveAttribute('src', 'blob:source');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载横屏成片' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /生成 V/ })).not.toBeInTheDocument();
    fireEvent.timeUpdate(video, { target: { currentTime: 0.5 } });
    expect(screen.getByText('真实字幕')).toBeInTheDocument();
    fireEvent.timeUpdate(video, { target: { currentTime: 2 } });
    expect(screen.queryByText('真实字幕')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载横屏字幕' }));
    expect(onExport).toHaveBeenCalledWith('subtitles', 'subtitle-horizontal-v1');
    fireEvent.click(screen.getByRole('button', { name: '深度编辑' }));
    expect(onImmersiveChange).toHaveBeenCalledWith(true);
  });

  it('shows horizontal and vertical videos together in one project version', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="video"
        version={5}
        videoOutputs={[
          {
            artifactId: 'horizontal-video-v2',
            variant: 'horizontal',
            artifactVersion: 2,
            fileName: 'translated-horizontal.mp4',
            src: 'blob:http://localhost/translated-horizontal-video'
          },
          {
            artifactId: 'vertical-video-v2',
            variant: 'vertical',
            artifactVersion: 2,
            fileName: 'translated-vertical.mp4',
            src: 'blob:http://localhost/translated-vertical-video'
          }
        ]}
        onExport={onExport}
      />
    );

    expect(screen.getByRole('region', { name: '横屏成片' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '竖屏成片' })).toBeInTheDocument();
    expect(screen.getByLabelText('横屏成片预览').parentElement).toHaveAttribute('data-ratio', '16:9');
    expect(screen.getByLabelText('竖屏成片预览').parentElement).toHaveAttribute('data-ratio', '9:16');
    expect(screen.queryByRole('radiogroup', { name: '成片画幅' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下载横屏成片' }));
    fireEvent.click(screen.getByRole('button', { name: '下载竖屏成片' }));
    expect(onExport).toHaveBeenNthCalledWith(1, 'video', 'horizontal-video-v2');
    expect(onExport).toHaveBeenNthCalledWith(2, 'video', 'vertical-video-v2');
  });

  it('switches between horizontal and vertical subtitles with horizontal selected by default', () => {
    const onExport = vi.fn();
    const onSubtitleChange = vi.fn();
    const onSaveSubtitles = vi.fn();
    const { container } = render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        version={5}
        subtitleDirtyByVariant={{ horizontal: true, vertical: true }}
        subtitleVideoPreviews={{
          vertical: {
            artifactId: 'source-video-v1',
            src: 'blob:http://localhost/horizontal-source-video',
            source: true
          }
        }}
        subtitleOutputs={[
          {
            artifactId: 'horizontal-subtitle-v1',
            variant: 'horizontal',
            artifactVersion: 1,
            fileName: 'target_language_srt.srt',
            cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '横屏字幕内容' }],
            readOnly: false
          },
          {
            artifactId: 'vertical-subtitle-v1',
            variant: 'vertical',
            artifactVersion: 1,
            fileName: 'short_origin_mixed_srt.srt',
            cues: [{ id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '竖屏短字幕' }],
            readOnly: false
          }
        ]}
        onExport={onExport}
        onSubtitleChange={onSubtitleChange}
        onSaveSubtitles={onSaveSubtitles}
      />
    );

    expect(screen.getByRole('radio', { name: '横屏' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: '竖屏' })).toHaveAttribute('aria-checked', 'false');
    const horizontal = screen.getByRole('textbox', { name: '横屏字幕 1' });
    expect(horizontal).not.toHaveAttribute('readonly');
    expect(screen.queryByRole('heading', { name: '横屏字幕' })).not.toBeInTheDocument();
    expect(screen.getByRole('list', { name: '横屏字幕内容' }).querySelectorAll('[data-subtitle-cue]'))
      .toHaveLength(1);
    expect(screen.queryByRole('textbox', { name: '竖屏字幕 1' })).not.toBeInTheDocument();
    expect(screen.getByText('00:00–00:01')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '跳转到 00:00:00,000' })).toHaveTextContent('00:00–00:01');
    expect(horizontal).toHaveAttribute('rows', '1');
    fireEvent.change(horizontal, { target: { value: '修改后的横屏字幕' } });
    expect(onSubtitleChange).toHaveBeenCalledWith('horizontal', 1, '修改后的横屏字幕');
    fireEvent.click(screen.getByRole('button', { name: '保存横屏字幕' }));
    expect(onSaveSubtitles).toHaveBeenCalledWith('horizontal');

    fireEvent.click(screen.getByRole('radio', { name: '竖屏' }));
    const vertical = screen.getByRole('textbox', { name: '竖屏字幕 1' });
    expect(vertical).not.toHaveAttribute('readonly');
    expect(vertical).toHaveValue('竖屏短字幕');
    fireEvent.change(vertical, { target: { value: '修改后的竖屏字幕' } });
    expect(onSubtitleChange).toHaveBeenCalledWith('vertical', 1, '修改后的竖屏字幕');
    fireEvent.click(screen.getByRole('button', { name: '保存竖屏字幕' }));
    expect(onSaveSubtitles).toHaveBeenCalledWith('vertical');
    expect(screen.queryByRole('textbox', { name: '横屏字幕 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '竖屏' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('list', { name: '竖屏字幕内容' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '竖屏字幕' })).not.toBeInTheDocument();
    const verticalVideo = screen.getByLabelText('竖屏字幕视频预览');
    expect(verticalVideo).toHaveAttribute('src', 'blob:http://localhost/horizontal-source-video');
    expect(verticalVideo.closest('.video-result-player-frame')).toHaveAttribute('data-ratio', '9:16');
    Object.defineProperties(verticalVideo, {
      videoWidth: { configurable: true, value: 1920 },
      videoHeight: { configurable: true, value: 1080 }
    });
    fireEvent.loadedMetadata(verticalVideo);
    expect(verticalVideo.closest('.video-result-player-frame')).toHaveAttribute('data-ratio', '9:16');
    fireEvent.click(screen.getByRole('radio', { name: '横屏' }));
    expect(screen.getByRole('radio', { name: '横屏' })).toHaveAttribute('aria-checked', 'true');
    expect(container.querySelector('.video-result-player-frame')).toHaveAttribute('data-ratio', '16:9');
    expect(screen.queryByText('target_language_srt.srt')).not.toBeInTheDocument();
    expect(screen.queryByText('short_origin_mixed_srt.srt')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载横屏字幕' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '下载竖屏字幕' })).not.toBeInTheDocument();
  });

  it('keeps the read-only status in the page heading without repeating a list heading', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleOutputs={[{ ...baseProps.subtitleOutputs[0]!, readOnly: true }]}
      />
    );

    expect(screen.getByText('项目 V1 · 1 条字幕 · 已保存 · 只读')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '横屏字幕内容' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '横屏字幕' })).not.toBeInTheDocument();
  });

  it('shows bilingual subtitle lines in the requested order while keeping the translation editable', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleOutputs={[{
          ...baseProps.subtitleOutputs[0]!,
          fileName: 'bilingual_srt.srt',
          translationPosition: 'top',
          cues: [{
            id: 1,
            start: '00:00:00,000',
            end: '00:00:01,000',
            text: '译文在上',
            sourceText: 'Source below'
          }]
        }]}
      />
    );

    const cue = screen.getByRole('textbox', { name: '横屏字幕 1' }).closest('[data-subtitle-cue]')!;
    const translation = screen.getByRole('textbox', { name: '横屏字幕 1' });
    const source = screen.getByLabelText('横屏字幕原文 1');
    expect(translation).toHaveValue('译文在上');
    expect(translation).not.toHaveAttribute('readonly');
    expect(source).toHaveValue('Source below');
    expect(source).not.toHaveAttribute('readonly');
    expect(source).toHaveAttribute('rows', '1');
    expect(translation).toHaveAttribute('rows', '1');
    fireEvent.change(source, { target: { value: 'Corrected source' } });
    expect(baseProps.onSubtitleChange).toHaveBeenCalledWith('horizontal', 1, 'Corrected source', 'sourceText');
    expect(translation.compareDocumentPosition(source) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cue).toContainElement(source);
  });

  it('groups vertical cues within the longer timestamp while preserving editing and playback by cue ID', () => {
    const onSubtitleChange = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleVideoPreviews={{ vertical: {
          artifactId: 'vertical-video-v1',
          src: 'blob:http://localhost/vertical-video',
          source: false
        } }}
        subtitleOutputs={[{
          artifactId: 'vertical-subtitle-v1',
          variant: 'vertical',
          artifactVersion: 1,
          cues: [
            { id: 4, start: '00:00:01,000', end: '00:00:02,000', text: '我很乐意。' },
            { id: 5, start: '00:00:01,000', end: '00:00:02,000', text: "I'm happy to do it." },
            { id: 6, start: '00:00:02,000', end: '00:00:03,000', text: '另一句译文' },
            { id: 7, start: '00:00:02,250', end: '00:00:03,000', text: 'Other source' }
          ],
          readOnly: false
        }]}
        onSubtitleChange={onSubtitleChange}
      />
    );

    const list = screen.getByRole('list', { name: '竖屏字幕内容' });
    expect(list.querySelectorAll('[data-subtitle-cue]')).toHaveLength(2);
    const translation = screen.getByRole('textbox', { name: '竖屏字幕 1' });
    const source = screen.getByRole('textbox', { name: '竖屏字幕 2' });
    expect(translation.closest('[data-subtitle-cue]')).toBe(source.closest('[data-subtitle-cue]'));
    expect(translation.closest('[data-subtitle-cue]')).toHaveTextContent('00:01–00:02');
    expect(screen.getAllByText('00:02–00:03')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: '竖屏字幕 3' }).closest('[data-subtitle-cue]'))
      .toBe(screen.getByRole('textbox', { name: '竖屏字幕 4' }).closest('[data-subtitle-cue]'));

    fireEvent.change(translation, { target: { value: '很高兴。' } });
    fireEvent.change(source, { target: { value: 'Happy to help.' } });
    expect(onSubtitleChange).toHaveBeenNthCalledWith(1, 'vertical', 4, '很高兴。');
    expect(onSubtitleChange).toHaveBeenNthCalledWith(2, 'vertical', 5, 'Happy to help.');

    const video = screen.getByLabelText('竖屏字幕视频预览') as HTMLVideoElement;
    fireEvent.timeUpdate(video, { target: { currentTime: 1.5 } });
    expect(translation.closest('[data-subtitle-cue]')).toHaveAttribute('data-active', 'true');
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:02,000' }));
    expect(video.currentTime).toBe(2);
    expect(screen.getByRole('textbox', { name: '竖屏字幕 4' }).closest('[data-subtitle-cue]'))
      .toHaveAttribute('data-active', 'true');
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:01,000' }));
    expect(video.currentTime).toBe(1);
    expect(list.querySelectorAll('[data-subtitle-cue][data-active="true"]')).toHaveLength(1);
  });

  it('keeps consecutive split source lines under a longer vertical subtitle without swallowing overlapping cues', () => {
    const onSubtitleChange = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleVideoPreviews={{ vertical: {
          artifactId: 'vertical-video-v1',
          src: 'blob:http://localhost/vertical-video',
          source: false
        } }}
        subtitleOutputs={[{
          artifactId: 'vertical-subtitle-v1',
          variant: 'vertical',
          artifactVersion: 1,
          cues: [
            { id: 1, start: '00:00:00,000', end: '00:00:02,000', text: 'Jensen, 谢谢你今天这么做。' },
            { id: 2, start: '00:00:00,000', end: '00:00:01,000', text: 'Jensen, thank you' },
            { id: 3, start: '00:00:01,000', end: '00:00:02,000', text: 'for doing this today.' },
            { id: 4, start: '00:00:01,500', end: '00:00:03,000', text: '跨过边界的字幕' },
            { id: 5, start: '00:00:03,000', end: '00:00:04,000', text: '下一句译文' },
            { id: 6, start: '00:00:03,000', end: '00:00:04,000', text: 'Next source' }
          ],
          readOnly: false
        }]}
        onSubtitleChange={onSubtitleChange}
      />
    );

    const list = screen.getByRole('list', { name: '竖屏字幕内容' });
    expect(list.querySelectorAll('[data-subtitle-cue]')).toHaveLength(3);
    const first = screen.getByRole('textbox', { name: '竖屏字幕 1' }).closest('[data-subtitle-cue]');
    expect(first).toHaveTextContent('00:00–00:02');
    expect(first).toContainElement(screen.getByRole('textbox', { name: '竖屏字幕 2' }));
    expect(first).toContainElement(screen.getByRole('textbox', { name: '竖屏字幕 3' }));
    expect(screen.queryByRole('button', { name: '跳转到 00:00:01,000' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: '竖屏字幕 4' }).closest('[data-subtitle-cue]'))
      .not.toBe(first);
    expect(screen.getByRole('textbox', { name: '竖屏字幕 5' }).closest('[data-subtitle-cue]'))
      .toContainElement(screen.getByRole('textbox', { name: '竖屏字幕 6' }));

    fireEvent.change(screen.getByRole('textbox', { name: '竖屏字幕 3' }), { target: { value: 'for helping today.' } });
    expect(onSubtitleChange).toHaveBeenCalledWith('vertical', 3, 'for helping today.');
    const video = screen.getByLabelText('竖屏字幕视频预览') as HTMLVideoElement;
    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:00,000' }));
    expect(video.currentTime).toBe(0);
    fireEvent.timeUpdate(video, { target: { currentTime: 1.25 } });
    expect(first).toHaveAttribute('data-active', 'true');
    fireEvent.timeUpdate(video, { target: { currentTime: 2.5 } });
    expect(first).toHaveAttribute('data-active', 'false');
    expect(screen.getByRole('textbox', { name: '竖屏字幕 4' }).closest('[data-subtitle-cue]'))
      .toHaveAttribute('data-active', 'true');
  });

  it('does not combine horizontal cues even when they have matching timestamps', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleOutputs={[{
          ...baseProps.subtitleOutputs[0]!,
          cues: [
            { id: 1, start: '00:00:01,000', end: '00:00:02,000', text: '第一条' },
            { id: 2, start: '00:00:01,000', end: '00:00:02,000', text: '第二条' }
          ]
        }]}
      />
    );

    expect(screen.getByRole('list', { name: '横屏字幕内容' }).querySelectorAll('[data-subtitle-cue]'))
      .toHaveLength(2);
  });

  it('keeps video playback and subtitle cues synchronized', () => {
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        subtitleVideoPreviews={{
          horizontal: {
            artifactId: 'source-video-v1',
            src: 'blob:http://localhost/source-video',
            source: true
          }
        }}
        subtitleOutputs={[{
          ...baseProps.subtitleOutputs[0]!,
          cues: [
            { id: 1, start: '00:00:00,000', end: '00:00:01,000', text: '第一条字幕' },
            { id: 2, start: '00:00:01,000', end: '00:00:03,000', text: '第二条字幕' }
          ]
        }]}
      />
    );

    const video = screen.getByLabelText('横屏字幕视频预览') as HTMLVideoElement;
    expect(video).toHaveAttribute('src', 'blob:http://localhost/source-video');
    expect(screen.getByText('当前使用原视频同步预览')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '横屏字幕内容' }).querySelectorAll('[data-subtitle-cue]')).toHaveLength(2);

    fireEvent.timeUpdate(video, { target: { currentTime: 1.5 } });
    expect(screen.getByRole('textbox', { name: '横屏字幕 2' }).closest('[data-subtitle-cue]'))
      .toHaveAttribute('data-active', 'true');
    expect(screen.getByText('第二条字幕', { selector: '.video-result-subtitle-overlay > span' }))
      .toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '跳转到 00:00:00,000' }));
    expect(video.currentTime).toBe(0);
    expect(screen.getByRole('textbox', { name: '横屏字幕 1' }).closest('[data-subtitle-cue]'))
      .toHaveAttribute('data-active', 'true');
  });

  it('previews and downloads a generated dubbing artifact', () => {
    const onExport = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="voice"
        hasVoiceArtifact
        voiceOutput={{
          artifactId: 'dubbed-audio-v2',
          artifactVersion: 2,
          fileName: 'target-dubbing-v2.wav',
          src: 'blob:http://localhost/dubbed-audio'
        }}
        onExport={onExport}
      />
    );

    expect(screen.getByLabelText('目标语言配音试听')).toHaveAttribute(
      'src',
      'blob:http://localhost/dubbed-audio'
    );
    expect(screen.getByLabelText('目标语言配音试听')).toHaveAttribute('preload', 'metadata');
    expect(screen.getByText('target-dubbing-v2.wav')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载配音文件' }));
    expect(onExport).toHaveBeenCalledWith('voice', 'dubbed-audio-v2');
  });

  it('shows voice preview loading failure and supports retrying', () => {
    const onReloadVoice = vi.fn();
    const { rerender } = render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="voice"
        hasVoiceArtifact
        voiceOutput={{
          artifactId: 'dubbed-audio-v2',
          artifactVersion: 2,
          previewLoading: true
        }}
        onReloadVoice={onReloadVoice}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('正在加载配音...');
    rerender(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="voice"
        hasVoiceArtifact
        voiceOutput={{
          artifactId: 'dubbed-audio-v2',
          artifactVersion: 2,
          previewError: '配音文件读取失败'
        }}
        onReloadVoice={onReloadVoice}
      />
    );

    expect(screen.getByRole('status')).toHaveTextContent('配音文件读取失败');
    fireEvent.click(screen.getByRole('button', { name: '重新加载配音' }));
    expect(onReloadVoice).toHaveBeenCalledOnce();
  });

  it('switches result tabs and selects a project version from history', () => {
    const onTabChange = vi.fn();
    const onVersionChange = vi.fn();
    render(
      <VideoTranslationResultWorkspace
        {...baseProps}
        activeTab="subtitles"
        versions={[
          { value: 1, description: '初次生成' },
          { value: 2, description: '更新字幕' }
        ]}
        onTabChange={onTabChange}
        onVersionChange={onVersionChange}
      />
    );

    expect(screen.queryByRole('tab', { name: '任务设置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '作品' }));
    expect(onTabChange).toHaveBeenCalledWith('video');

    fireEvent.click(screen.getByRole('button', { name: /项目 V1/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: /项目 V2/ }));
    expect(onVersionChange).toHaveBeenCalledWith(2);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
