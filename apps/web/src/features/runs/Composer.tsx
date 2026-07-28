import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Folder,
  FolderPlus,
  ListPlus,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap
} from 'lucide-react';
import type {
  AttachmentResponse,
  ReasoningEffort,
  RunSubmissionMode
} from '@clawee/protocol';
import type { ClaweeProject, ProjectPermission } from '../projects/project-model.js';
import { CreateProjectDialog } from '../projects/CreateProjectDialog.js';
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

export type ComposerQueuedItem = {
  runId: string;
  text: string;
  queuePosition?: number;
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
    value: 'workspace-write',
    label: '请求批准',
    description: '需要操作文件或执行高风险命令时询问你'
  },
  {
    value: 'danger-full-access',
    label: '完全访问权限',
    description: '允许访问本机文件并执行本地操作'
  }
];

const modelOptions: ComposerModelOption[] = [
  { id: 'default', label: '默认模型', model: null, reasoning: null },
  { id: 'high', label: '默认模型 高', model: null, reasoning: 'high' },
  { id: 'xhigh', label: '默认模型 超高', model: null, reasoning: 'xhigh' }
];

const TEXTAREA_MIN_VISIBLE_LINES = 2;
const TEXTAREA_MAX_VISIBLE_LINES = 12;
const TEXTAREA_LINE_HEIGHT = 22;
const TEXTAREA_VERTICAL_PADDING = 4;
const TEXTAREA_MIN_HEIGHT = Math.ceil(
  TEXTAREA_LINE_HEIGHT * TEXTAREA_MIN_VISIBLE_LINES + TEXTAREA_VERTICAL_PADDING
);
const TEXTAREA_MAX_HEIGHT = Math.ceil(TEXTAREA_LINE_HEIGHT * TEXTAREA_MAX_VISIBLE_LINES + TEXTAREA_VERTICAL_PADDING);

export function Composer(props: {
  disabled?: boolean;
  disabledReason?: string;
  running?: boolean;
  canceling?: boolean;
  permissionChangeDisabled?: boolean;
  projectId: string;
  projectName: string;
  projects: ClaweeProject[];
  showProjectSelector?: boolean;
  permission: ProjectPermission;
  profile: string;
  model: string | null;
  reasoning: ReasoningEffort | null;
  slashCommands?: ComposerSlashCommand[];
  slashCommandsLoading?: boolean;
  slashCommandsError?: string;
  queuedItems?: ComposerQueuedItem[];
  draftRequest?: ComposerDraftRequest;
  focusRequestId?: number;
  imageInputSupported?: boolean;
  imageInputUnsupportedReason?: string;
  onSelectProject(projectId: string): void;
  onCreateBlankProject?(name: string): boolean | void | Promise<boolean | void>;
  onAddProjectDirectory?(): void | Promise<void>;
  onPermissionChange?(
    permission: ProjectPermission
  ): boolean | void | Promise<boolean | void>;
  onDraftApplied?(id: number): void;
  onFocusRequestApplied?(id: number): void;
  onCancel?(): void;
  onCancelQueuedRun?(runId: string): void;
  onSteerQueuedRun?(runId: string): void;
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
  const [projectCreateMenuOpen, setProjectCreateMenuOpen] = useState(false);
  const [projectNameDialogOpen, setProjectNameDialogOpen] = useState(false);
  const [selectedPermission, setSelectedPermission] = useState<ProjectPermission>(
    normalizePermission(props.permission)
  );
  const [selectedModel, setSelectedModel] = useState(() => modelOptionForConfig(props.model, props.reasoning));
  const [openMenu, setOpenMenu] = useState<
    'project' | 'add' | 'permission' | 'model' | null
  >(null);
  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null);
  const [attachmentDrafts, setAttachmentDrafts] = useState<ComposerAttachmentDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [permissionUpdating, setPermissionUpdating] = useState(false);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const projectSearchRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentDraftsRef = useRef<ComposerAttachmentDraft[]>([]);
  const transferredPreviewUrlsRef = useRef(new Set<string>());
  const nextAttachmentIdRef = useRef(0);
  const scheduledDraftIdRef = useRef<number>();
  const appliedDraftIdRef = useRef<number>();
  const trimmedPrompt = prompt.trim();
  const activeFloatingMenu = openMenu ?? (slashTrigger === null ? null : 'slash');

  attachmentDraftsRef.current = attachmentDrafts;

  useEffect(() => () => {
    for (const item of attachmentDraftsRef.current) {
      if (!transferredPreviewUrlsRef.current.has(item.previewUrl)) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
  }, []);

  useEffect(() => {
    setSelectedPermission(normalizePermission(props.permission));
  }, [props.permission, props.projectName]);

  useEffect(() => {
    setSelectedModel(modelOptionForConfig(props.model, props.reasoning));
  }, [props.model, props.reasoning, props.projectName]);

  useEffect(() => {
    if (activeFloatingMenu === null) return;

    const closeFloatingMenu = () => {
      setOpenMenu(null);
      setSlashTrigger(null);
      setProjectQuery('');
      setProjectCreateMenuOpen(false);
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      const activeRoot = composerRef.current?.querySelector(
        `[data-composer-menu-root="${activeFloatingMenu}"]`
      );
      if (target !== null && activeRoot?.contains(target as Node)) return;
      closeFloatingMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeFloatingMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeFloatingMenu]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;

    textarea.style.height = 'auto';
    const contentHeight = Math.max(textarea.scrollHeight, TEXTAREA_MIN_HEIGHT);
    const nextHeight = Math.min(contentHeight, TEXTAREA_MAX_HEIGHT);
    const isOverflowing = contentHeight > TEXTAREA_MAX_HEIGHT;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = isOverflowing ? 'auto' : 'hidden';
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

  useEffect(() => {
    const focusRequestId = props.focusRequestId;
    if (focusRequestId === undefined) return;

    const frameId = window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea === null || textarea.disabled) return;
      textarea.focus({ preventScroll: true });
      props.onFocusRequestApplied?.(focusRequestId);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [props.focusRequestId, props.onFocusRequestApplied]);

  const selectedPermissionOption = permissionOptions.find(option => option.value === selectedPermission) ?? permissionOptions[0]!;
  const normalizedProjectQuery = projectQuery.trim().toLocaleLowerCase();
  const filteredProjects = props.projects.filter(project =>
    normalizedProjectQuery.length === 0
    || project.name.toLocaleLowerCase().includes(normalizedProjectQuery)
    || project.cwd.toLocaleLowerCase().includes(normalizedProjectQuery)
  );
  const slashCommands = props.slashCommands ?? [];
  const selectedSkillCommand = findLeadingSkillCommand(prompt, slashCommands);
  const selectedSkillPrefix = selectedSkillCommand?.insertText ?? '';
  const visiblePrompt = selectedSkillCommand === undefined
    ? prompt
    : prompt.slice(selectedSkillPrefix.length);
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
  const showStopAction = props.running === true && !canSubmit;
  const submitPrompt = async () => {
    if (!canSubmit) return;
    textareaRef.current?.focus({ preventScroll: true });
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
        ? await props.onSubmit(trimmedPrompt, config, attachments, 'enqueue')
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
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (textarea !== null && !textarea.disabled) {
        textarea.focus({ preventScroll: true });
      }
    });
  };

  useEffect(() => {
    if (slashTrigger === null) return;
    if (filteredSlashCommands.length === 0) return;
    if (slashTrigger.activeIndex < filteredSlashCommands.length) return;
    setSlashTrigger({ ...slashTrigger, activeIndex: 0 });
  }, [filteredSlashCommands.length, slashTrigger]);

  useLayoutEffect(() => {
    if (slashTrigger === null || filteredSlashCommands.length === 0) return;

    const activeOption = slashMenuRef.current?.querySelector<HTMLElement>(
      `[data-slash-command-index="${slashTrigger.activeIndex}"]`
    );
    if (typeof activeOption?.scrollIntoView === 'function') {
      activeOption.scrollIntoView({ block: 'nearest' });
    }
  }, [filteredSlashCommands.length, slashTrigger?.activeIndex]);

  const updatePrompt = (value: string, caret: number) => {
    setPrompt(value);
    const nextTrigger = props.disabled ? null : findSlashTrigger(value, caret);
    setSlashTrigger(nextTrigger);
    if (nextTrigger !== null) setOpenMenu(null);
  };

  const updateVisiblePrompt = (value: string, caret: number) => {
    updatePrompt(
      `${selectedSkillPrefix}${value}`,
      selectedSkillPrefix.length + caret
    );
  };

  const closeProjectMenu = () => {
    setOpenMenu(null);
    setProjectQuery('');
    setProjectCreateMenuOpen(false);
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
    setProjectCreateMenuOpen(false);
    setOpenMenu('project');
    window.requestAnimationFrame(() => projectSearchRef.current?.focus());
  };

  const runProjectAction = (
    action: (() => void | Promise<void>) | undefined
  ) => {
    if (action === undefined) return;
    closeProjectMenu();
    void action();
  };

  const openProjectNameDialog = () => {
    closeProjectMenu();
    setProjectNameDialogOpen(true);
  };

  const applySlashCommand = (command: ComposerSlashCommand) => {
    if (slashTrigger === null) return;

    const nextPrompt = `${prompt.slice(0, slashTrigger.start)}${command.insertText}${prompt.slice(slashTrigger.end)}`;
    const nextCaret = slashTrigger.start + command.insertText.length;
    setPrompt(nextPrompt);
    setSlashTrigger(null);
    setOpenMenu(null);

    window.requestAnimationFrame(() => {
      const leadingCommand = findLeadingSkillCommand(nextPrompt, slashCommands);
      const visibleCaret = Math.max(
        0,
        nextCaret - (leadingCommand?.insertText.length ?? 0)
      );
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(visibleCaret, visibleCaret);
    });
  };

  const handlePromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
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

    if (
      selectedSkillCommand !== undefined
      && event.key === 'Backspace'
      && event.currentTarget.selectionStart === 0
      && event.currentTarget.selectionEnd === 0
    ) {
      event.preventDefault();
      setPrompt(visiblePrompt);
      return;
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
    <div className="composer-stack">
      {(props.queuedItems?.length ?? 0) > 0 ? (
        <div className="composer-queue" aria-label="排队消息">
          {props.queuedItems?.map(item => (
            <div className="composer-queue-item" key={item.runId}>
              <span className="composer-queue-leading" aria-hidden="true">
                <ListPlus size={13} />
              </span>
              <span className="composer-queue-copy" title={item.text}>
                {item.text}
              </span>
              {item.queuePosition === undefined ? null : (
                <span className="composer-queue-position">第 {item.queuePosition} 位</span>
              )}
              {props.onSteerQueuedRun ? (
                <button
                  type="button"
                  className="composer-queue-steer"
                  aria-label={`优先执行等待任务 ${item.text}`}
                  title="停止当前任务并优先执行这条等待任务"
                  onClick={() => props.onSteerQueuedRun?.(item.runId)}
                >
                  <Zap aria-hidden="true" size={13} />
                  优先执行
                </button>
              ) : null}
              {props.onCancelQueuedRun ? (
                <button
                  type="button"
                  className="composer-queue-remove"
                  aria-label={`移除等待任务 ${item.text}`}
                  title="移除等待任务"
                  onClick={() => props.onCancelQueuedRun?.(item.runId)}
                >
                  <Trash2 aria-hidden="true" size={13} />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
      <form
        ref={composerRef}
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
      {props.showProjectSelector !== false ? (
        <div className="composer-project-context">
          <div
            className="composer-control-wrap composer-project-control"
            data-composer-menu-root="project"
          >
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
                {props.onCreateBlankProject !== undefined
                || props.onAddProjectDirectory !== undefined ? (
                  <div className="composer-project-create">
                    <button
                      className="composer-project-create-trigger"
                      type="button"
                      aria-haspopup="menu"
                      aria-expanded={projectCreateMenuOpen}
                      onClick={() => setProjectCreateMenuOpen(open => !open)}
                    >
                      <Plus aria-hidden="true" size={17} />
                      <span>新建项目</span>
                      <ChevronRight aria-hidden="true" size={15} />
                    </button>
                    {projectCreateMenuOpen ? (
                      <div
                        className="composer-project-create-menu"
                        role="menu"
                        aria-label="新建项目"
                      >
                        {props.onCreateBlankProject !== undefined ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={openProjectNameDialog}
                          >
                            <Plus aria-hidden="true" size={17} />
                            <span>新建空白项目</span>
                          </button>
                        ) : null}
                        {props.onAddProjectDirectory !== undefined ? (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => runProjectAction(props.onAddProjectDirectory)}
                          >
                            <FolderPlus aria-hidden="true" size={17} />
                            <span>使用现有文件夹</span>
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
      <CreateProjectDialog
        open={projectNameDialogOpen}
        onClose={() => setProjectNameDialogOpen(false)}
        onCreate={name => props.onCreateBlankProject?.(name)}
      />
      <AttachmentTray
        items={attachmentDrafts}
        onRemove={(localId) => void removeAttachment(localId)}
        onRetry={(localId) => void uploadAttachment(localId)}
      />
      <div
        className={`composer-input-wrap${selectedSkillCommand === undefined ? '' : ' has-skill-chip'}`}
        data-composer-menu-root="slash"
      >
        {selectedSkillCommand ? (
          <span className="composer-skill-chip" aria-label={`已选择 Skill ${selectedSkillCommand.label}`}>
            <Sparkles aria-hidden="true" size={15} />
            <strong>{selectedSkillCommand.label}</strong>
          </span>
        ) : null}
        <textarea
          ref={textareaRef}
          aria-label="输入任务"
          aria-autocomplete="list"
          aria-controls={slashMenuOpen ? 'composer-slash-menu' : undefined}
          aria-activedescendant={slashMenuOpen && filteredSlashCommands.length > 0
            ? `composer-slash-option-${slashTrigger.activeIndex}`
            : undefined}
          aria-expanded={slashMenuOpen}
          rows={2}
          value={visiblePrompt}
          disabled={props.disabled}
          onChange={(event) => updateVisiblePrompt(event.target.value, event.target.selectionStart)}
          onClick={(event) => updatePrompt(
            prompt,
            selectedSkillPrefix.length + event.currentTarget.selectionStart
          )}
          onKeyDown={handlePromptKeyDown}
          onPaste={handlePaste}
          placeholder={
            props.disabled
              ? props.disabledReason ?? '当前对话不可用'
              : '需要帮你做点什么？输入 / 调用插件'
          }
        />
        {slashMenuOpen ? (
          <div
            ref={slashMenuRef}
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
                      id={`composer-slash-option-${commandIndex}`}
                      className={`composer-menu-item composer-slash-item${slashTrigger.activeIndex === commandIndex ? ' is-active' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={slashTrigger.activeIndex === commandIndex}
                      data-slash-command-index={commandIndex}
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
          <div className="composer-control-wrap" data-composer-menu-root="add">
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

          <div className="composer-control-wrap" data-composer-menu-root="permission">
            <button
              className={`composer-select composer-select-${selectedPermission}`}
              type="button"
              aria-label={`选择访问权限 ${selectedPermissionOption.label}`}
              aria-expanded={openMenu === 'permission'}
              disabled={props.permissionChangeDisabled === true || permissionUpdating}
              title={
                props.permissionChangeDisabled === true
                  ? '当前任务结束后可修改访问权限'
                  : undefined
              }
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
                    disabled={permissionUpdating}
                    onClick={async () => {
                      if (
                        option.value === 'danger-full-access'
                        && selectedPermission !== 'danger-full-access'
                        && !window.confirm(
                          '完全访问权限允许 Clawee 访问本机文件并执行本地操作。确定要开启吗？'
                        )
                      ) {
                        return;
                      }
                      if (option.value === selectedPermission) {
                        setOpenMenu(null);
                        return;
                      }
                      setPermissionUpdating(true);
                      try {
                        const accepted = await props.onPermissionChange?.(option.value);
                        if (accepted !== false) {
                          setSelectedPermission(option.value);
                          setOpenMenu(null);
                        }
                      } finally {
                        setPermissionUpdating(false);
                      }
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
          <div className="composer-control-wrap" data-composer-menu-root="model">
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

          <div className="composer-submit-wrap">
            <button
              className={showStopAction ? 'composer-stop' : 'composer-send'}
              type={showStopAction ? 'button' : 'submit'}
              aria-label={
                showStopAction
                  ? props.canceling ? '正在停止任务' : '停止任务'
                  : props.running ? '排队发送' : '发送'
              }
              title={
                showStopAction
                  ? props.canceling ? '正在停止任务' : '停止任务'
                  : props.running ? '加入等待队列' : '发送'
              }
              disabled={
                showStopAction
                  ? props.canceling || props.onCancel === undefined
                  : !canSubmit
              }
              onClick={showStopAction ? props.onCancel : undefined}
            >
              {showStopAction ? (
                <Square aria-hidden="true" size={13} fill="currentColor" />
              ) : (
                <ArrowUp aria-hidden="true" size={17} />
              )}
            </button>
          </div>
        </div>
      </div>
      </form>
    </div>
  );
}

function normalizePermission(permission: ProjectPermission): ProjectPermission {
  return permission === 'danger-full-access' ? permission : 'workspace-write';
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
  const skills = commands.filter(command => command.category === 'skill');
  if (normalizedQuery.length === 0) return skills;

  return skills.filter(command => {
    const id = command.id.replace(/^skill:/, '').toLowerCase();
    const label = command.label.toLowerCase();
    return id.startsWith(normalizedQuery)
      || label.startsWith(normalizedQuery)
      || id.includes(normalizedQuery)
      || label.includes(normalizedQuery);
  });
}

function groupSlashCommands(commands: ComposerSlashCommand[]): Array<{
  category: ComposerSlashCommand['category'];
  commands: ComposerSlashCommand[];
}> {
  return (['skill'] as const)
    .map(category => ({ category, commands: commands.filter(command => command.category === category) }))
    .filter(group => group.commands.length > 0);
}

function nextSlashCommandIndex(current: number, length: number, delta: 1 | -1): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

function findLeadingSkillCommand(
  prompt: string,
  commands: readonly ComposerSlashCommand[]
): ComposerSlashCommand | undefined {
  return commands.find(command => (
    command.category === 'skill'
    && command.insertText.length > 0
    && prompt.startsWith(command.insertText)
  ));
}

function slashCategoryLabel(category: ComposerSlashCommand['category']): string {
  if (category === 'skill') return 'Skills';
  return category;
}

function slashCategoryIcon(category: ComposerSlashCommand['category']) {
  if (category === 'skill') return <Sparkles size={15} />;
  return null;
}
