import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent
} from 'react';
import {
  ArrowUp,
  Cable,
  Check,
  ChevronDown,
  Circle,
  Folder,
  ListPlus,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Target,
  Zap
} from 'lucide-react';
import type {
  AttachmentResponse,
  ReasoningEffort,
  RunSubmissionMode
} from '@clawee/protocol';
import type { ClaweeProject, ProjectPermission } from '../projects/project-model.js';
import {
  AttachmentTray,
  type AttachmentTrayItem
} from './AttachmentTray.js';

export type ComposerRunConfig = {
  permission: ProjectPermission;
  profile: string;
  model: string | null;
  reasoning: ReasoningEffort | null;
};

export type ComposerDraftRequest = {
  id: number;
  text: string;
};

export type ComposerSlashCommand = {
  id: string;
  category: 'skill' | 'mcp' | 'goal';
  label: string;
  description: string;
  insertText: string;
};

export type ComposerAttachment = {
  attachment: AttachmentResponse;
  previewUrl: string;
};

type ComposerAttachmentDraft = AttachmentTrayItem & {
  file: File;
  attachment?: AttachmentResponse;
};

type ComposerModelOption = {
  id: 'default' | 'high' | 'xhigh';
  label: string;
  model: string | null;
  reasoning: ReasoningEffort | null;
};

type SlashTrigger = {
  start: number;
  end: number;
  query: string;
  activeIndex: number;
};

const permissionOptions: Array<{
  value: ProjectPermission;
  label: string;
  description: string;
}> = [
  {
    value: 'follow-global',
    label: '只读访问',
    description: '只能读取上下文，不写入本机文件'
  },
  {
    value: 'workspace-write',
    label: '工作区读写',
    description: '可修改当前工作区文件'
  },
  {
    value: 'danger-full-access',
    label: '完全访问',
    description: '可访问本机文件并执行本地操作'
  }
];

const modelOptions: ComposerModelOption[] = [
  { id: 'default', label: '默认模型', model: null, reasoning: null },
  { id: 'high', label: '默认模型 高', model: null, reasoning: 'high' },
  { id: 'xhigh', label: '默认模型 超高', model: null, reasoning: 'xhigh' }
];

const TEXTAREA_MIN_HEIGHT = 28;
const TEXTAREA_MAX_VISIBLE_LINES = 3;
const TEXTAREA_LINE_HEIGHT = 24;
const TEXTAREA_VERTICAL_PADDING = 4;
const TEXTAREA_MAX_HEIGHT = Math.ceil(TEXTAREA_LINE_HEIGHT * TEXTAREA_MAX_VISIBLE_LINES + TEXTAREA_VERTICAL_PADDING);

export function Composer(props: {
  disabled?: boolean;
  disabledReason?: string;
  running?: boolean;
  canceling?: boolean;
  projectId: string;
  projectName: string;
  projects: ClaweeProject[];
  permission: ProjectPermission;
  profile: string;
  model: string | null;
  reasoning: ReasoningEffort | null;
  slashCommands?: ComposerSlashCommand[];
  slashCommandsLoading?: boolean;
  slashCommandsError?: string;
  draftRequest?: ComposerDraftRequest;
  imageInputSupported?: boolean;
  imageInputUnsupportedReason?: string;
  onSelectProject(projectId: string): void;
  onPermissionChange?(permission: ProjectPermission): void;
  onDraftApplied?(id: number): void;
  onCancel?(): void;
  onUploadAttachment?(file: File): Promise<AttachmentResponse>;
  onDeleteAttachment?(attachment: AttachmentResponse): Promise<void>;
  onSubmit(
    prompt: string,
    config: ComposerRunConfig,
    attachments: ComposerAttachment[],
    submissionMode?: RunSubmissionMode
  ): boolean | void | Promise<boolean | void>;
}) {
  const [prompt, setPrompt] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [selectedPermission, setSelectedPermission] = useState<ProjectPermission>(props.permission);
  const [selectedModel, setSelectedModel] = useState(() => modelOptionForConfig(props.model, props.reasoning));
  const [openMenu, setOpenMenu] = useState<
    'project' | 'add' | 'permission' | 'model' | 'submit' | null
  >(null);
  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null);
  const [submissionMode, setSubmissionMode] = useState<RunSubmissionMode>('enqueue');
  const [attachmentDrafts, setAttachmentDrafts] = useState<ComposerAttachmentDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const projectSearchRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentDraftsRef = useRef<ComposerAttachmentDraft[]>([]);
  const transferredPreviewUrlsRef = useRef(new Set<string>());
  const nextAttachmentIdRef = useRef(0);
  const scheduledDraftIdRef = useRef<number>();
  const appliedDraftIdRef = useRef<number>();
  const trimmedPrompt = prompt.trim();

  attachmentDraftsRef.current = attachmentDrafts;

  useEffect(() => () => {
    for (const item of attachmentDraftsRef.current) {
      if (!transferredPreviewUrlsRef.current.has(item.previewUrl)) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
  }, []);

  useEffect(() => {
    setSelectedPermission(props.permission);
  }, [props.permission, props.projectName]);

  useEffect(() => {
    setSelectedModel(modelOptionForConfig(props.model, props.reasoning));
  }, [props.model, props.reasoning, props.projectName]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;

    textarea.style.height = 'auto';
    const contentHeight = Math.max(textarea.scrollHeight, TEXTAREA_MIN_HEIGHT);
    const nextHeight = Math.min(contentHeight, TEXTAREA_MAX_HEIGHT);
    const isOverflowing = contentHeight > TEXTAREA_MAX_HEIGHT;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = isOverflowing ? 'auto' : 'hidden';
    textarea.scrollTop = isOverflowing ? textarea.scrollHeight : 0;
  }, [prompt]);

  useEffect(() => {
    const draftRequest = props.draftRequest;
    if (draftRequest === undefined) return;
    if (appliedDraftIdRef.current === draftRequest.id) return;
    if (scheduledDraftIdRef.current === draftRequest.id) return;

    scheduledDraftIdRef.current = draftRequest.id;
    setPrompt(draftRequest.text);
    setSlashTrigger(null);
    setOpenMenu(null);

    const frameId = window.requestAnimationFrame(() => {
      scheduledDraftIdRef.current = undefined;
      const textarea = textareaRef.current;
      if (textarea === null) return;
      const caret = draftRequest.text.length;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      appliedDraftIdRef.current = draftRequest.id;
      props.onDraftApplied?.(draftRequest.id);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (scheduledDraftIdRef.current === draftRequest.id) {
        scheduledDraftIdRef.current = undefined;
      }
    };
  }, [props.draftRequest, props.onDraftApplied]);

  const selectedPermissionOption = permissionOptions.find(option => option.value === selectedPermission) ?? permissionOptions[0]!;
  const normalizedProjectQuery = projectQuery.trim().toLocaleLowerCase();
  const filteredProjects = props.projects.filter(project =>
    normalizedProjectQuery.length === 0
    || project.name.toLocaleLowerCase().includes(normalizedProjectQuery)
    || project.cwd.toLocaleLowerCase().includes(normalizedProjectQuery)
  );
  const slashCommands = props.slashCommands ?? [];
  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashCommands, slashTrigger?.query ?? ''),
    [slashCommands, slashTrigger?.query]
  );
  const groupedSlashCommands = useMemo(
    () => groupSlashCommands(filteredSlashCommands),
    [filteredSlashCommands]
  );
  const slashMenuOpen = slashTrigger !== null;
  const attachmentsSettled =
    attachmentDrafts.length === 0
    || attachmentDrafts.every(item => item.status === 'ready');
  const canSubmit =
    !props.disabled
    && !submitting
    && trimmedPrompt.length > 0
    && attachmentsSettled;
  const submitPrompt = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    const attachments = attachmentDrafts.flatMap(item =>
      item.status === 'ready' && item.attachment !== undefined
        ? [{ attachment: item.attachment, previewUrl: item.previewUrl }]
        : []
    );
    for (const item of attachments) transferredPreviewUrlsRef.current.add(item.previewUrl);
    let accepted: boolean | void;
    try {
      const config = {
        permission: selectedPermission,
        profile: props.profile,
        model: selectedModel.model,
        reasoning: selectedModel.reasoning
      };
      accepted = props.running
        ? await props.onSubmit(trimmedPrompt, config, attachments, submissionMode)
        : await props.onSubmit(trimmedPrompt, config, attachments);
      if (accepted === false) {
        for (const item of attachments) transferredPreviewUrlsRef.current.delete(item.previewUrl);
      }
    } catch (error) {
      for (const item of attachments) transferredPreviewUrlsRef.current.delete(item.previewUrl);
      throw error;
    } finally {
      setSubmitting(false);
    }
    if (accepted === false) return;
    setPrompt('');
    setSlashTrigger(null);
    attachmentDraftsRef.current = [];
    setAttachmentDrafts([]);
  };

  useEffect(() => {
    if (slashTrigger === null) return;
    if (filteredSlashCommands.length === 0) return;
    if (slashTrigger.activeIndex < filteredSlashCommands.length) return;
    setSlashTrigger({ ...slashTrigger, activeIndex: 0 });
  }, [filteredSlashCommands.length, slashTrigger]);

  const updatePrompt = (value: string, caret: number) => {
    setPrompt(value);
    const nextTrigger = props.disabled ? null : findSlashTrigger(value, caret);
    setSlashTrigger(nextTrigger);
    if (nextTrigger !== null) setOpenMenu(null);
  };

  const closeProjectMenu = () => {
    setOpenMenu(null);
    setProjectQuery('');
  };

  const selectProject = (projectId: string) => {
    closeProjectMenu();
    if (projectId !== props.projectId) props.onSelectProject(projectId);
  };

  const toggleProjectMenu = () => {
    setSlashTrigger(null);
    if (openMenu === 'project') {
      closeProjectMenu();
      return;
    }
    setProjectQuery('');
    setOpenMenu('project');
    window.requestAnimationFrame(() => projectSearchRef.current?.focus());
  };

  const applySlashCommand = (command: ComposerSlashCommand) => {
    if (slashTrigger === null) return;

    const nextPrompt = `${prompt.slice(0, slashTrigger.start)}${command.insertText}${prompt.slice(slashTrigger.end)}`;
    const nextCaret = slashTrigger.start + command.insertText.length;
    setPrompt(nextPrompt);
    setSlashTrigger(null);
    setOpenMenu(null);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashTrigger !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashTrigger(null);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashTrigger({
          ...slashTrigger,
          activeIndex: nextSlashCommandIndex(slashTrigger.activeIndex, filteredSlashCommands.length, 1)
        });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashTrigger({
          ...slashTrigger,
          activeIndex: nextSlashCommandIndex(slashTrigger.activeIndex, filteredSlashCommands.length, -1)
        });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const command = filteredSlashCommands[slashTrigger.activeIndex];
        if (command !== undefined) {
          event.preventDefault();
          applySlashCommand(command);
          return;
        }
      }
    }

    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submitPrompt();
  };

  async function uploadAttachment(localId: string) {
    const item = attachmentDraftsRef.current.find(candidate => candidate.localId === localId);
    if (item === undefined || props.onUploadAttachment === undefined) return;
    setAttachmentDrafts(current => current.map(candidate =>
      candidate.localId === localId
        ? { ...candidate, status: 'uploading', error: undefined }
        : candidate
    ));
    try {
      const attachment = await props.onUploadAttachment(item.file);
      setAttachmentDrafts(current => current.map(candidate =>
        candidate.localId === localId
          ? { ...candidate, status: 'ready', attachment, error: undefined }
          : candidate
      ));
    } catch (error) {
      setAttachmentDrafts(current => current.map(candidate =>
        candidate.localId === localId
          ? {
              ...candidate,
              status: 'error',
              error: error instanceof Error ? error.message : '上传失败'
            }
          : candidate
      ));
    }
  }

  function addFiles(files: Iterable<File>) {
    if (props.imageInputSupported !== true || props.onUploadAttachment === undefined) return;
    const available = Math.max(0, 8 - attachmentDraftsRef.current.length);
    const images = Array.from(files)
      .filter(file => file.type.startsWith('image/'))
      .slice(0, available);
    for (const file of images) {
      nextAttachmentIdRef.current += 1;
      const localId = `attachment-${nextAttachmentIdRef.current}`;
      const draft: ComposerAttachmentDraft = {
        localId,
        file,
        fileName: file.name,
        mime: file.type,
        previewUrl: URL.createObjectURL(file),
        status: 'uploading'
      };
      setAttachmentDrafts(current => [...current, draft]);
      attachmentDraftsRef.current = [...attachmentDraftsRef.current, draft];
      void uploadAttachment(localId);
    }
  }

  async function removeAttachment(localId: string) {
    const item = attachmentDraftsRef.current.find(candidate => candidate.localId === localId);
    if (item === undefined) return;
    setAttachmentDrafts(current => current.filter(candidate => candidate.localId !== localId));
    attachmentDraftsRef.current = attachmentDraftsRef.current.filter(
      candidate => candidate.localId !== localId
    );
    URL.revokeObjectURL(item.previewUrl);
    if (item.attachment !== undefined) await props.onDeleteAttachment?.(item.attachment);
  }

  function handlePaste(event: ReactClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  }

  function handleDrop(event: ReactDragEvent<HTMLFormElement>) {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    addFiles(files);
  }

  return (
    <form
      className="clawee-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submitPrompt();
      }}
      onDragOver={(event) => {
        if (props.imageInputSupported === true) event.preventDefault();
      }}
      onDrop={handleDrop}
    >
      <div className="composer-project-context">
        <div className="composer-control-wrap composer-project-control">
          <button
            className="composer-project-button"
            type="button"
            aria-label={`选择项目 ${props.projectName}`}
            aria-expanded={openMenu === 'project'}
            onClick={toggleProjectMenu}
          >
            <Folder aria-hidden="true" size={15} />
            <span>{props.projectName}</span>
            <ChevronDown aria-hidden="true" size={14} />
          </button>
          {openMenu === 'project' ? (
            <div
              className="composer-popover composer-project-popover"
              role="dialog"
              aria-label="选择项目"
            >
              <label className="composer-project-search">
                <Search aria-hidden="true" size={15} />
                <input
                  ref={projectSearchRef}
                  type="search"
                  aria-label="搜索项目"
                  placeholder="搜索项目"
                  value={projectQuery}
                  onChange={event => setProjectQuery(event.currentTarget.value)}
                  onKeyDown={event => {
                    if (event.key === 'Escape') closeProjectMenu();
                  }}
                />
              </label>
              <div className="composer-project-list" role="listbox" aria-label="项目列表">
                {filteredProjects.length === 0 ? (
                  <p className="composer-project-empty">没有匹配的项目</p>
                ) : (
                  filteredProjects.map(project => (
                    <button
                      key={project.id}
                      className="composer-project-option"
                      type="button"
                      role="option"
                      aria-label={project.name}
                      aria-selected={project.id === props.projectId}
                      title={project.cwd}
                      onClick={() => selectProject(project.id)}
                    >
                      <Folder aria-hidden="true" size={16} />
                      <span>{project.name}</span>
                      {project.id === props.projectId ? (
                        <Check className="composer-project-check" aria-hidden="true" size={15} />
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <AttachmentTray
        items={attachmentDrafts}
        onRemove={(localId) => void removeAttachment(localId)}
        onRetry={(localId) => void uploadAttachment(localId)}
      />
      <div className="composer-input-wrap">
        <textarea
          ref={textareaRef}
          aria-label="输入任务"
          aria-autocomplete="list"
          aria-controls={slashMenuOpen ? 'composer-slash-menu' : undefined}
          aria-expanded={slashMenuOpen}
          rows={1}
          value={prompt}
          disabled={props.disabled}
          onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart)}
          onClick={(event) => updatePrompt(prompt, event.currentTarget.selectionStart)}
          onKeyDown={handlePromptKeyDown}
          onPaste={handlePaste}
          placeholder={props.disabled ? props.disabledReason ?? '当前对话不可用' : '随心输入'}
        />
        {slashMenuOpen ? (
          <div
            id="composer-slash-menu"
            className="composer-popover composer-slash-menu"
            role="listbox"
            aria-label="能力菜单"
          >
            {props.slashCommandsLoading ? <div className="composer-slash-status" role="status">正在加载本机能力</div> : null}
            {props.slashCommandsError ? <div className="composer-slash-status composer-slash-status-error">{props.slashCommandsError}</div> : null}
            {!props.slashCommandsLoading && filteredSlashCommands.length === 0 ? (
              <div className="composer-slash-status">没有匹配的能力</div>
            ) : null}
            {groupedSlashCommands.map(group => (
              <div key={group.category} className="composer-slash-group" role="presentation">
                <div className="composer-slash-group-label">{slashCategoryLabel(group.category)}</div>
                {group.commands.map(command => {
                  const commandIndex = filteredSlashCommands.findIndex(item => item.id === command.id);
                  return (
                    <button
                      key={command.id}
                      className={`composer-menu-item composer-slash-item${slashTrigger.activeIndex === commandIndex ? ' is-active' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={slashTrigger.activeIndex === commandIndex}
                      onMouseEnter={() => setSlashTrigger({ ...slashTrigger, activeIndex: commandIndex })}
                      onClick={() => applySlashCommand(command)}
                    >
                      <span className="composer-menu-icon" aria-hidden="true">{slashCategoryIcon(command.category)}</span>
                      <span>
                        <strong>{command.label}</strong>
                        <small>{command.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="composer-toolbar">
        <div className="composer-left-actions">
          <div className="composer-control-wrap">
            <button
              className="composer-icon-button"
              type="button"
              aria-label="添加上下文"
              aria-expanded={openMenu === 'add'}
              onClick={() => {
                setSlashTrigger(null);
                setOpenMenu(openMenu === 'add' ? null : 'add');
              }}
            >
              <Plus aria-hidden="true" size={17} />
            </button>
            {openMenu === 'add' ? (
              <div className="composer-popover composer-popover-compact" role="menu" aria-label="添加上下文">
                <button
                  className="composer-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={props.imageInputSupported !== true}
                  onClick={() => {
                    setOpenMenu(null);
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip aria-hidden="true" size={15} />
                  <span>添加图片</span>
                </button>
                {props.imageInputSupported !== true && props.imageInputUnsupportedReason ? (
                  <p className="composer-menu-notice">{props.imageInputUnsupportedReason}</p>
                ) : null}
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              className="composer-file-input"
              type="file"
              aria-label="选择图片"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              disabled={props.imageInputSupported !== true}
              onChange={(event) => {
                addFiles(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
              }}
            />
          </div>

          <div className="composer-control-wrap">
            <button
              className={`composer-select composer-select-${selectedPermission}`}
              type="button"
              aria-label={`选择访问权限 ${selectedPermissionOption.label}`}
              aria-expanded={openMenu === 'permission'}
              onClick={() => {
                setSlashTrigger(null);
                setOpenMenu(openMenu === 'permission' ? null : 'permission');
              }}
            >
              <ShieldCheck aria-hidden="true" size={15} />
              <span>{selectedPermissionOption.label}</span>
            </button>
            {openMenu === 'permission' ? (
              <div className="composer-popover composer-permission-menu" role="menu" aria-label="访问权限">
                {permissionOptions.map(option => (
                  <button
                    key={option.value}
                    className="composer-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedPermission === option.value}
                    onClick={() => {
                      setSelectedPermission(option.value);
                      props.onPermissionChange?.(option.value);
                      setOpenMenu(null);
                    }}
                  >
                    <span className="composer-menu-icon" aria-hidden="true">
                      {selectedPermission === option.value ? <Check size={15} /> : null}
                    </span>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

        </div>

        <div className="composer-right-actions">
          <div className="composer-control-wrap">
            <button
              className="composer-model-button"
              type="button"
              aria-label={`选择模型 ${selectedModel.label}`}
              aria-expanded={openMenu === 'model'}
              onClick={() => {
                setSlashTrigger(null);
                setOpenMenu(openMenu === 'model' ? null : 'model');
              }}
            >
              <Circle aria-hidden="true" size={9} />
              <span>{selectedModel.label}</span>
            </button>
            {openMenu === 'model' ? (
              <div className="composer-popover composer-model-menu" role="menu" aria-label="模型">
                {modelOptions.map(option => (
                  <button
                    key={option.id}
                    className="composer-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedModel.id === option.id}
                    onClick={() => {
                      setSelectedModel(option);
                      setOpenMenu(null);
                    }}
                  >
                    <span className="composer-menu-icon" aria-hidden="true">
                      {selectedModel.id === option.id ? <Check size={15} /> : null}
                    </span>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{modelOptionDescription(option)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {props.running ? (
            <button
              className="composer-stop"
              type="button"
              aria-label={props.canceling ? '正在停止任务' : '停止任务'}
              disabled={props.canceling || props.onCancel === undefined}
              onClick={props.onCancel}
            >
              <Square aria-hidden="true" size={13} fill="currentColor" />
            </button>
          ) : null}
          <div className="composer-submit-wrap">
            <button
              className="composer-send"
              type="submit"
              aria-label={
                props.running
                  ? submissionMode === 'interrupt_and_enqueue'
                    ? '立即打断并继续'
                    : '排队发送'
                  : '发送'
              }
              disabled={!canSubmit}
            >
              {props.running && submissionMode === 'enqueue' ? (
                <ListPlus aria-hidden="true" size={16} />
              ) : props.running ? (
                <Zap aria-hidden="true" size={16} />
              ) : (
                <ArrowUp aria-hidden="true" size={17} />
              )}
            </button>
            {props.running ? (
              <>
                <button
                  className="composer-submit-menu-button"
                  type="button"
                  aria-label="选择发送方式"
                  aria-expanded={openMenu === 'submit'}
                  onClick={() => setOpenMenu(openMenu === 'submit' ? null : 'submit')}
                >
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
                {openMenu === 'submit' ? (
                  <div className="composer-popover composer-submit-menu" role="menu" aria-label="发送方式">
                    <button
                      className="composer-menu-item"
                      type="button"
                      role="menuitemradio"
                      aria-checked={submissionMode === 'enqueue'}
                      onClick={() => {
                        setSubmissionMode('enqueue');
                        setOpenMenu(null);
                      }}
                    >
                      <span className="composer-menu-icon" aria-hidden="true">
                        <ListPlus size={15} />
                      </span>
                      <span>
                        <strong>排队发送</strong>
                        <small>当前任务继续，新任务按顺序等待</small>
                      </span>
                    </button>
                    <button
                      className="composer-menu-item"
                      type="button"
                      role="menuitemradio"
                      aria-checked={submissionMode === 'interrupt_and_enqueue'}
                      onClick={() => {
                        setSubmissionMode('interrupt_and_enqueue');
                        setOpenMenu(null);
                      }}
                    >
                      <span className="composer-menu-icon" aria-hidden="true">
                        <Zap size={15} />
                      </span>
                      <span>
                        <strong>立即打断并继续</strong>
                        <small>停止当前任务，优先执行这条消息</small>
                      </span>
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      </div>
    </form>
  );
}

function modelOptionForConfig(model: string | null, reasoning: ReasoningEffort | null): ComposerModelOption {
  if (model === null && reasoning === 'xhigh') return modelOptions[2]!;
  if (model === null && reasoning === 'high') return modelOptions[1]!;
  return modelOptions[0]!;
}

function modelOptionDescription(option: ComposerModelOption): string {
  if (option.id === 'xhigh') return '更充分的推理过程';
  if (option.id === 'high') return '较强推理能力';
  return '使用本机默认配置';
}

function findSlashTrigger(value: string, caret: number): SlashTrigger | null {
  const beforeCaret = value.slice(0, caret);
  const tokenStart = Math.max(beforeCaret.lastIndexOf(' '), beforeCaret.lastIndexOf('\n'), beforeCaret.lastIndexOf('\t')) + 1;
  const token = beforeCaret.slice(tokenStart);
  if (!token.startsWith('/')) return null;
  if (token.slice(1).includes('/')) return null;

  return {
    start: tokenStart,
    end: caret,
    query: token.slice(1),
    activeIndex: 0
  };
}

function filterSlashCommands(commands: ComposerSlashCommand[], query: string): ComposerSlashCommand[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return commands;

  return commands.filter(command => {
    const haystack = `${command.label} ${command.description} ${command.category}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function groupSlashCommands(commands: ComposerSlashCommand[]): Array<{
  category: ComposerSlashCommand['category'];
  commands: ComposerSlashCommand[];
}> {
  return (['skill', 'mcp', 'goal'] as const)
    .map(category => ({ category, commands: commands.filter(command => command.category === category) }))
    .filter(group => group.commands.length > 0);
}

function nextSlashCommandIndex(current: number, length: number, delta: 1 | -1): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

function slashCategoryLabel(category: ComposerSlashCommand['category']): string {
  if (category === 'skill') return 'Skills';
  if (category === 'mcp') return 'MCP';
  return 'Goal';
}

function slashCategoryIcon(category: ComposerSlashCommand['category']) {
  if (category === 'skill') return <Sparkles size={15} />;
  if (category === 'mcp') return <Cable size={15} />;
  return <Target size={15} />;
}
