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
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  Chrome,
  Cloud,
  Database,
  Figma,
  Folder,
  FolderPlus,
  Github,
  Hammer,
  Link2,
  ListPlus,
  Paperclip,
  Plus,
  Search,
  ShieldCheck,
  Slack,
  Sparkles,
  Square,
  Trash2,
  X,
  Zap
} from 'lucide-react';
import type {
  AttachmentResponse,
  CodexModelResponse,
  ReasoningEffort,
  RunSubmissionMode
} from '@clawee/protocol';
import type { ClaweeProject, ProjectPermission } from '../projects/project-model.js';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import { useAppLanguage, type Translate } from '../../i18n/LanguageProvider.js';
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

export type ComposerConnector = {
  id: string;
  label: string;
  description: string;
  status: 'available' | 'installed' | 'enabled' | 'configured' | 'unavailable';
  insertText?: string;
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

type SlashTrigger = {
  start: number;
  end: number;
  query: string;
  activeIndex: number;
};

const TEXTAREA_MIN_VISIBLE_LINES = 2;
const TEXTAREA_MAX_VISIBLE_LINES = 12;
const TEXTAREA_LINE_HEIGHT = 22;
const TEXTAREA_VERTICAL_PADDING = 4;
const TEXTAREA_MIN_HEIGHT = Math.ceil(
  TEXTAREA_LINE_HEIGHT * TEXTAREA_MIN_VISIBLE_LINES + TEXTAREA_VERTICAL_PADDING
);
const TEXTAREA_MAX_HEIGHT = Math.ceil(TEXTAREA_LINE_HEIGHT * TEXTAREA_MAX_VISIBLE_LINES + TEXTAREA_VERTICAL_PADDING);
const COMPOSER_POPOVER_GAP = 8;
const COMPOSER_POPOVER_VIEWPORT_MARGIN = 12;
const CLIPPING_OVERFLOW_VALUES = new Set(['auto', 'clip', 'hidden', 'scroll']);

export function Composer(props: {
  disabled?: boolean;
  disabledReason?: string;
  promptHint?: string;
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
  models?: readonly CodexModelResponse[];
  modelsLoading?: boolean;
  modelsError?: string;
  modelsNotice?: string;
  slashCommands?: ComposerSlashCommand[];
  slashCommandsLoading?: boolean;
  slashCommandsError?: string;
  onLoadConnectors?(): Promise<ComposerConnector[]>;
  onToggleConnector?(connectorId: string, enabled: boolean): Promise<ComposerConnector[]>;
  preloadConnectors?: boolean;
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
  onModelConfigChange?(config: Pick<ComposerRunConfig, 'model' | 'reasoning'>): void;
  onDraftApplied?(id: number): void;
  onFocusRequestApplied?(id: number): void;
  onCancel?(): void;
  onCancelQueuedRun?(runId: string): void;
  onSteerQueuedRun?(runId: string): void;
  onUploadAttachment?(file: File): Promise<AttachmentResponse>;
  onDeleteAttachment?(attachment: AttachmentResponse): Promise<void>;
  onManageSkills?(): void;
  onManageConnectors?(): void;
  onSubmit(
    prompt: string,
    config: ComposerRunConfig,
    attachments: ComposerAttachment[],
    submissionMode?: RunSubmissionMode
  ): boolean | void | Promise<boolean | void>;
}) {
  const { t } = useAppLanguage();
  const permissionOptions: Array<{
    value: ProjectPermission;
    label: string;
    description: string;
  }> = [
    {
      value: 'workspace-write',
      label: t('composer.permission.approval'),
      description: t('composer.permission.approvalDescription')
    },
    {
      value: 'danger-full-access',
      label: t('composer.permission.fullAccess'),
      description: t('composer.permission.fullAccessDescription')
    }
  ];
  const [prompt, setPrompt] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [projectNameDialogOpen, setProjectNameDialogOpen] = useState(false);
  const [selectedPermission, setSelectedPermission] = useState<ProjectPermission>(
    normalizePermission(props.permission)
  );
  const [selectedModel, setSelectedModel] = useState<string | null>(props.model);
  const [selectedReasoning, setSelectedReasoning] = useState<ReasoningEffort | null>(
    props.reasoning
  );
  const [openMenu, setOpenMenu] = useState<
    'project' | 'add' | 'permission' | 'connectors' | 'model' | null
  >(null);
  const [addSubmenu, setAddSubmenu] = useState<'skill' | 'mcp' | null>(null);
  const [addCommandQuery, setAddCommandQuery] = useState('');
  const [connectorCatalog, setConnectorCatalog] = useState<ComposerConnector[]>();
  const [connectorCatalogLoading, setConnectorCatalogLoading] = useState(false);
  const [connectorCatalogError, setConnectorCatalogError] = useState<string>();
  const [connectorUpdatingId, setConnectorUpdatingId] = useState<string>();
  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null);
  const [attachmentDrafts, setAttachmentDrafts] = useState<ComposerAttachmentDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [permissionUpdating, setPermissionUpdating] = useState(false);
  const [pendingPermission, setPendingPermission] = useState<ProjectPermission>();
  const composerRef = useRef<HTMLFormElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const slashMenuRootRef = useRef<HTMLDivElement | null>(null);
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const projectSearchRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentDraftsRef = useRef<ComposerAttachmentDraft[]>([]);
  const transferredPreviewUrlsRef = useRef(new Set<string>());
  const nextAttachmentIdRef = useRef(0);
  const scheduledDraftIdRef = useRef<number>();
  const appliedDraftIdRef = useRef<number>();
  const promptRevisionRef = useRef(0);
  const connectorCatalogRequestRef = useRef<Promise<void>>();
  const connectorCatalogGenerationRef = useRef(0);
  const connectorLoaderRef = useRef(props.onLoadConnectors);
  const composerMountedRef = useRef(true);
  const trimmedPrompt = prompt.trim();
  const activeFloatingMenu = openMenu ?? (slashTrigger === null ? null : 'slash');
  const availableModels = props.models ?? [];
  const slashCommands = props.slashCommands ?? [];
  const resolvedSelectedModel = resolveSelectedModel(availableModels, selectedModel);
  const selectedModelLabel = modelSelectionLabel(
    resolvedSelectedModel,
    selectedModel,
    props.modelsLoading === true,
    t
  );
  const selectedModelSupportsImages =
    resolvedSelectedModel?.inputModalities.includes('image');
  const canAttachImages =
    props.imageInputSupported === true && selectedModelSupportsImages !== false;
  const imageInputNotice = selectedModelSupportsImages === false
    ? t('composer.imageUnsupported', { model: selectedModelLabel })
    : props.imageInputUnsupportedReason;
  const attachmentsSupportedByModel =
    attachmentDrafts.length === 0 || selectedModelSupportsImages !== false;
  const selectedReasoningOptions =
    resolvedSelectedModel?.supportedReasoningEfforts ?? [];
  const addCommands = slashCommands.filter(command => (
    command.category === 'skill'
    && (
      addCommandQuery.trim().length === 0
      || `${command.label} ${command.description}`
        .toLocaleLowerCase()
        .includes(addCommandQuery.trim().toLocaleLowerCase())
    )
  ));
  const localConnectors = slashCommands
    .filter(command => command.category === 'mcp')
    .map(command => ({
      id: command.id,
      label: command.label,
      description: command.description,
      status: 'configured' as const,
      insertText: command.insertText
    }));
  const visibleConnectors = mergeComposerConnectors(
    connectorCatalog ?? [],
    localConnectors
  ).filter(connector => (
    addCommandQuery.trim().length === 0
    || `${connector.label} ${connector.description}`
      .toLocaleLowerCase()
      .includes(addCommandQuery.trim().toLocaleLowerCase())
  ));
  const enabledConnectors = mergeComposerConnectors(
    connectorCatalog ?? [],
    localConnectors
  ).filter(connector => (
    connector.status === 'enabled' || connector.status === 'configured'
  ));
  const quickConnectors = mergeComposerConnectors(
    connectorCatalog ?? [],
    localConnectors
  ).filter(connector => (
    connector.status === 'enabled'
    || connector.status === 'configured'
    || connector.status === 'installed'
  ));

  attachmentDraftsRef.current = attachmentDrafts;

  useEffect(() => {
    composerMountedRef.current = true;
    return () => {
      composerMountedRef.current = false;
    };
  }, []);

  useEffect(() => () => {
    for (const item of attachmentDraftsRef.current) {
      if (!transferredPreviewUrlsRef.current.has(item.previewUrl)) {
        URL.revokeObjectURL(item.previewUrl);
      }
    }
  }, []);

  useEffect(() => {
    if (connectorLoaderRef.current === props.onLoadConnectors) return;
    connectorLoaderRef.current = props.onLoadConnectors;
    connectorCatalogGenerationRef.current += 1;
    connectorCatalogRequestRef.current = undefined;
    setConnectorCatalog(undefined);
    setConnectorCatalogLoading(false);
    setConnectorCatalogError(undefined);
  }, [props.onLoadConnectors]);

  const loadConnectorCatalog = () => {
    if (
      props.onLoadConnectors === undefined
      || connectorCatalog !== undefined
      || connectorCatalogRequestRef.current !== undefined
    ) {
      return;
    }
    const generation = connectorCatalogGenerationRef.current;
    setConnectorCatalogLoading(true);
    setConnectorCatalogError(undefined);
    const request = props.onLoadConnectors()
      .then(connectors => {
        if (
          composerMountedRef.current
          && connectorCatalogGenerationRef.current === generation
        ) {
          setConnectorCatalog(connectors);
        }
      })
      .catch(error => {
        if (
          composerMountedRef.current
          && connectorCatalogGenerationRef.current === generation
        ) {
          setConnectorCatalogError(
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : t('composer.connectors.loadFailed')
          );
        }
      })
      .finally(() => {
        if (
          composerMountedRef.current
          && connectorCatalogGenerationRef.current === generation
        ) {
          connectorCatalogRequestRef.current = undefined;
          setConnectorCatalogLoading(false);
        }
      });
    connectorCatalogRequestRef.current = request;
  };

  const openAddSubmenu = (submenu: 'skill' | 'mcp') => {
    setAddSubmenu(submenu);
    setAddCommandQuery('');
    if (submenu === 'mcp') loadConnectorCatalog();
  };

  const toggleConnector = async (connector: ComposerConnector) => {
    if (props.onToggleConnector === undefined || connectorUpdatingId !== undefined) return;
    setConnectorUpdatingId(connector.id);
    setConnectorCatalogError(undefined);
    try {
      setConnectorCatalog(await props.onToggleConnector(
        connector.id,
        connector.status !== 'enabled'
      ));
    } catch (error) {
      setConnectorCatalogError(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : t('composer.connectors.updateFailed')
      );
    } finally {
      setConnectorUpdatingId(undefined);
    }
  };

  useEffect(() => {
    if (props.preloadConnectors === true) loadConnectorCatalog();
  }, [props.onLoadConnectors, props.preloadConnectors]);

  useEffect(() => {
    setSelectedPermission(normalizePermission(props.permission));
  }, [props.permission, props.projectName]);

  useEffect(() => {
    setSelectedModel(props.model);
    setSelectedReasoning(props.reasoning);
  }, [props.model, props.reasoning, props.projectName]);

  useEffect(() => {
    if (activeFloatingMenu === null) return;

    const closeFloatingMenu = () => {
      setOpenMenu(null);
      setAddSubmenu(null);
      setAddCommandQuery('');
      setSlashTrigger(null);
      setProjectQuery('');
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
      if (activeFloatingMenu === 'add' && addSubmenu !== null) {
        setAddSubmenu(null);
        setAddCommandQuery('');
        return;
      }
      closeFloatingMenu();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activeFloatingMenu, addSubmenu]);

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
    promptRevisionRef.current += 1;
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
  const selectedSkillCommand = findLeadingSkillCommand(prompt, slashCommands);
  const selectedSkillPrefix = selectedSkillCommand?.insertText ?? '';
  const visiblePrompt = selectedSkillCommand === undefined
    ? prompt
    : prompt.slice(selectedSkillPrefix.length);
  const hasComposerContent = visiblePrompt.length > 0
    || selectedSkillCommand !== undefined
    || attachmentDrafts.length > 0;
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
    && attachmentsSettled
    && attachmentsSupportedByModel;
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
        model: selectedModel,
        reasoning: selectedReasoning
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
    promptRevisionRef.current += 1;
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

  useLayoutEffect(() => {
    if (!slashMenuOpen) return;

    const menu = slashMenuRef.current;
    const root = slashMenuRootRef.current;
    if (menu === null || root === null) return;

    const clippingAncestors = findClippingAncestors(root);
    const updateAvailableHeight = () => {
      const boundaryTop = clippingAncestors.reduce(
        (top, ancestor) => Math.max(top, ancestor.getBoundingClientRect().top),
        window.visualViewport?.offsetTop ?? 0
      );
      const availableHeight = Math.max(
        0,
        Math.floor(
          root.getBoundingClientRect().top
          - boundaryTop
          - COMPOSER_POPOVER_GAP
          - COMPOSER_POPOVER_VIEWPORT_MARGIN
        )
      );
      menu.style.setProperty(
        '--composer-slash-menu-available-height',
        `${availableHeight}px`
      );
    };

    updateAvailableHeight();
    window.addEventListener('resize', updateAvailableHeight);
    const visualViewport = window.visualViewport;
    visualViewport?.addEventListener('resize', updateAvailableHeight);
    visualViewport?.addEventListener('scroll', updateAvailableHeight);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updateAvailableHeight);
    resizeObserver?.observe(root);
    for (const ancestor of clippingAncestors) resizeObserver?.observe(ancestor);

    return () => {
      window.removeEventListener('resize', updateAvailableHeight);
      visualViewport?.removeEventListener('resize', updateAvailableHeight);
      visualViewport?.removeEventListener('scroll', updateAvailableHeight);
      resizeObserver?.disconnect();
      menu.style.removeProperty('--composer-slash-menu-available-height');
    };
  }, [slashMenuOpen]);

  const updatePrompt = (value: string, caret: number) => {
    promptRevisionRef.current += 1;
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
    promptRevisionRef.current += 1;
    const caretRevision = promptRevisionRef.current;
    setPrompt(nextPrompt);
    setSlashTrigger(null);
    setOpenMenu(null);

    window.requestAnimationFrame(() => {
      if (promptRevisionRef.current !== caretRevision) return;
      const leadingCommand = findLeadingSkillCommand(nextPrompt, slashCommands);
      const visibleCaret = Math.max(
        0,
        nextCaret - (leadingCommand?.insertText.length ?? 0)
      );
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(visibleCaret, visibleCaret);
    });
  };

  const applyAddCommand = (command: ComposerSlashCommand) => {
    applyAddText(command.insertText);
  };

  const applyAddText = (insertText: string) => {
    const selectionStart = textareaRef.current?.selectionStart ?? prompt.length;
    const selectionEnd = textareaRef.current?.selectionEnd ?? selectionStart;
    const selectedSkillPrefix = findLeadingSkillCommand(prompt, slashCommands)?.insertText ?? '';
    const promptSelectionStart = selectedSkillPrefix.length + selectionStart;
    const promptSelectionEnd = selectedSkillPrefix.length + selectionEnd;
    const nextPrompt = `${prompt.slice(0, promptSelectionStart)}${insertText}${prompt.slice(promptSelectionEnd)}`;
    const nextCaret = promptSelectionStart + insertText.length;
    promptRevisionRef.current += 1;
    const caretRevision = promptRevisionRef.current;
    setPrompt(nextPrompt);
    setOpenMenu(null);
    setAddSubmenu(null);
    setAddCommandQuery('');

    window.requestAnimationFrame(() => {
      if (promptRevisionRef.current !== caretRevision) return;
      const leadingCommand = findLeadingSkillCommand(nextPrompt, slashCommands);
      const visibleCaret = Math.max(0, nextCaret - (leadingCommand?.insertText.length ?? 0));
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
      promptRevisionRef.current += 1;
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
              error: error instanceof Error ? error.message : t('composer.uploadFailed')
            }
          : candidate
      ));
    }
  }

  function addFiles(files: Iterable<File>) {
    if (!canAttachImages || props.onUploadAttachment === undefined) return;
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

  async function applyPermission(permission: ProjectPermission) {
    setPermissionUpdating(true);
    try {
      const accepted = await props.onPermissionChange?.(permission);
      if (accepted !== false) {
        setSelectedPermission(permission);
        setOpenMenu(null);
      }
    } finally {
      setPermissionUpdating(false);
      setPendingPermission(undefined);
    }
  }

  function renderConnectorDirectory() {
    return (
      <>
        <label className="composer-add-search">
          <Search aria-hidden="true" size={15} />
          <input
            aria-label={t('composer.connectors.search')}
            type="search"
            placeholder={t('composer.connectors.search')}
            value={addCommandQuery}
            onChange={event => setAddCommandQuery(event.currentTarget.value)}
          />
        </label>
        <div className="composer-add-command-list" aria-label={t('composer.connectors.catalog')}>
          {connectorCatalogLoading && connectorCatalog === undefined ? (
            <p className="composer-model-status" role="status">
              {t('composer.connectors.loadingCatalog')}
            </p>
          ) : null}
          {connectorCatalogError === undefined ? null : (
            <p className="composer-model-status composer-model-status-error" role="alert">
              {connectorCatalogError}
            </p>
          )}
          {!connectorCatalogLoading && visibleConnectors.length === 0 ? (
            <p className="composer-model-status">
              {addCommandQuery.trim().length > 0
                ? t('composer.connectors.noMatch')
                : t('composer.connectors.emptyCatalog')}
            </p>
          ) : visibleConnectors.map(connector => {
            const canUse = (
              connector.status === 'enabled'
              || connector.status === 'configured'
            ) && connector.insertText !== undefined;
            const canManage = props.onManageConnectors !== undefined;
            return (
              <button
                key={connector.id}
                className="composer-menu-item composer-connector-item"
                type="button"
                role="menuitem"
                disabled={!canUse && !canManage}
                onClick={() => {
                  if (canUse) {
                    applyAddText(connector.insertText!);
                    return;
                  }
                  setOpenMenu(null);
                  setAddSubmenu(null);
                  props.onManageConnectors?.();
                }}
              >
                <span className="composer-menu-icon" aria-hidden="true">
                  <Link2 size={15} />
                </span>
                <span>
                  <span className="composer-connector-title">
                    <strong>{connector.label}</strong>
                    <em data-status={connector.status}>
                      {connectorStatusLabel(connector.status, t)}
                    </em>
                  </span>
                  <small>{connector.description}</small>
                </span>
              </button>
            );
          })}
        </div>
        {props.onManageConnectors === undefined ? null : (
          <button
            className="composer-menu-item composer-add-footer"
            type="button"
            role="menuitem"
            onClick={() => {
              setOpenMenu(null);
              setAddSubmenu(null);
              props.onManageConnectors?.();
            }}
          >
            <Link2 aria-hidden="true" size={15} />
            <span>{t('composer.connectors.manage')}</span>
          </button>
        )}
      </>
    );
  }

  function renderConnectorQuickMenu() {
    return (
      <>
        <div
          className="composer-connector-quick-list"
          role="group"
          aria-label={t('composer.connectors.quickToggles')}
        >
          {connectorCatalogLoading && connectorCatalog === undefined ? (
            <p className="composer-model-status" role="status">
              {t('composer.connectors.loading')}
            </p>
          ) : null}
          {connectorCatalogError === undefined ? null : (
            <p className="composer-model-status composer-model-status-error" role="alert">
              {connectorCatalogError}
            </p>
          )}
          {!connectorCatalogLoading && quickConnectors.length === 0 ? (
            <p className="composer-model-status">{t('composer.connectors.noneInstalled')}</p>
          ) : quickConnectors.map(connector => {
            const checked = connector.status === 'enabled' || connector.status === 'configured';
            const canToggle = connector.id.startsWith('enterprise:')
              && props.onToggleConnector !== undefined;
            return (
              <div className="composer-connector-quick-item" key={connector.id}>
                <span className="composer-connector-quick-icon" aria-hidden="true">
                  {connectorIcon(connector)}
                </span>
                <span className="composer-connector-quick-name">{connector.label}</span>
                <button
                  className="composer-connector-switch"
                  type="button"
                  role="switch"
                  aria-label={`${connector.label} MCP`}
                  aria-checked={checked}
                  aria-description={canToggle ? undefined : t('composer.connectors.manageInMcp')}
                  disabled={!canToggle || connectorUpdatingId !== undefined}
                  onClick={() => void toggleConnector(connector)}
                />
              </div>
            );
          })}
        </div>
        {props.onManageConnectors === undefined ? null : (
          <button
            className="composer-connector-more"
            type="button"
            onClick={() => {
              setOpenMenu(null);
              props.onManageConnectors?.();
            }}
          >
            <ArrowUpRight aria-hidden="true" size={15} />
            <span>{t('composer.connectors.more')}</span>
          </button>
        )}
      </>
    );
  }

  return (
    <div className="composer-stack">
      {(props.queuedItems?.length ?? 0) > 0 ? (
        <div className="composer-queue" aria-label={t('composer.queue.label')}>
          {props.queuedItems?.map(item => (
            <div className="composer-queue-item" key={item.runId}>
              <span className="composer-queue-leading" aria-hidden="true">
                <ListPlus size={13} />
              </span>
              <span className="composer-queue-copy" title={item.text}>
                {item.text}
              </span>
              {item.queuePosition === undefined ? null : (
                <span className="composer-queue-position">
                  {t('composer.queue.position', { position: item.queuePosition })}
                </span>
              )}
              {props.onSteerQueuedRun ? (
                <button
                  type="button"
                  className="composer-queue-steer"
                  aria-label={t('composer.queue.steerLabel', { text: item.text })}
                  title={t('composer.queue.steerTitle')}
                  onClick={() => props.onSteerQueuedRun?.(item.runId)}
                >
                  <Zap aria-hidden="true" size={13} />
                  {t('composer.queue.steer')}
                </button>
              ) : null}
              {props.onCancelQueuedRun ? (
                <button
                  type="button"
                  className="composer-queue-remove"
                  aria-label={t('composer.queue.removeLabel', { text: item.text })}
                  title={t('composer.queue.remove')}
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
        className={`clawee-composer${props.showProjectSelector === false ? ' without-project-selector' : ''}`}
        onSubmit={(event) => {
          event.preventDefault();
          void submitPrompt();
        }}
        onDragOver={(event) => {
          if (canAttachImages) event.preventDefault();
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
              aria-label={t('composer.project.selectNamed', { name: props.projectName })}
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
                aria-label={t('composer.project.select')}
              >
                <label className="composer-project-search">
                  <Search aria-hidden="true" size={15} />
                  <input
                    ref={projectSearchRef}
                    type="search"
                    aria-label={t('composer.project.search')}
                    placeholder={t('composer.project.search')}
                    value={projectQuery}
                    onChange={event => setProjectQuery(event.currentTarget.value)}
                  />
                </label>
                <div
                  className="composer-project-list"
                  role="listbox"
                  aria-label={t('composer.project.list')}
                >
                  {filteredProjects.length === 0 ? (
                    <p className="composer-project-empty">{t('composer.project.noMatch')}</p>
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
                    {props.onCreateBlankProject !== undefined ? (
                      <button
                        className="composer-project-create-trigger"
                        type="button"
                        onClick={openProjectNameDialog}
                      >
                        <Plus aria-hidden="true" size={17} />
                        <span>{t('composer.project.create')}</span>
                      </button>
                    ) : null}
                    {props.onAddProjectDirectory !== undefined ? (
                      <button
                        className="composer-project-create-trigger"
                        type="button"
                        onClick={() => runProjectAction(props.onAddProjectDirectory)}
                      >
                        <FolderPlus aria-hidden="true" size={17} />
                        <span>{t('composer.project.useFolder')}</span>
                      </button>
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
        ref={slashMenuRootRef}
        className={`composer-input-wrap${selectedSkillCommand === undefined ? '' : ' has-skill-chip'}`}
        data-composer-menu-root="slash"
      >
        {selectedSkillCommand ? (
          <span
            className="composer-skill-chip"
            aria-label={t('composer.skill.selected', { name: selectedSkillCommand.label })}
          >
            <Sparkles aria-hidden="true" size={15} />
            <strong>{selectedSkillCommand.label}</strong>
          </span>
        ) : null}
        <textarea
          ref={textareaRef}
          aria-label={t('composer.input.label')}
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
              ? props.disabledReason ?? t('composer.input.unavailable')
              : hasComposerContent ? '' : props.promptHint ?? t('composer.input.placeholder')
          }
        />
        {slashMenuOpen ? (
          <div
            ref={slashMenuRef}
            id="composer-slash-menu"
            className="composer-popover composer-slash-menu"
            role="listbox"
            aria-label={t('composer.capabilities.menu')}
          >
            {props.slashCommandsLoading ? (
              <div className="composer-slash-status" role="status">
                {t('composer.capabilities.loading')}
              </div>
            ) : null}
            {props.slashCommandsError ? <div className="composer-slash-status composer-slash-status-error">{props.slashCommandsError}</div> : null}
            {!props.slashCommandsLoading && filteredSlashCommands.length === 0 ? (
              <div className="composer-slash-status">{t('composer.capabilities.noMatch')}</div>
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
              aria-label={t('composer.add.context')}
              aria-expanded={openMenu === 'add'}
              title={t('composer.add.title')}
              onClick={() => {
                setSlashTrigger(null);
                const nextOpen = openMenu === 'add' ? null : 'add';
                setOpenMenu(nextOpen);
                setAddSubmenu(null);
                setAddCommandQuery('');
              }}
            >
              <Plus aria-hidden="true" size={17} />
            </button>
            {openMenu === 'add' ? (
              <div
                className="composer-popover composer-popover-compact composer-add-menu"
                role="menu"
                aria-label={t('composer.add.context')}
              >
                <button
                  className="composer-menu-item"
                  type="button"
                  role="menuitem"
                  disabled={!canAttachImages}
                  onClick={() => {
                    setOpenMenu(null);
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip aria-hidden="true" size={15} />
                  <span>{t('composer.add.file')}</span>
                </button>
                {!canAttachImages && imageInputNotice !== undefined ? (
                  <p className="composer-menu-notice">{imageInputNotice}</p>
                ) : null}
                <button
                  className={`composer-menu-item composer-add-menu-trigger${addSubmenu === 'skill' ? ' is-active' : ''}`}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={addSubmenu === 'skill'}
                  onMouseEnter={() => openAddSubmenu('skill')}
                  onClick={() => openAddSubmenu('skill')}
                >
                  <Hammer aria-hidden="true" size={15} />
                  <span>{t('composer.add.skills')}</span>
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
                <button
                  className={`composer-menu-item composer-add-menu-trigger${addSubmenu === 'mcp' ? ' is-active' : ''}`}
                  type="button"
                  role="menuitem"
                  aria-haspopup="menu"
                  aria-expanded={addSubmenu === 'mcp'}
                  onMouseEnter={() => openAddSubmenu('mcp')}
                  onClick={() => openAddSubmenu('mcp')}
                >
                  <Link2 aria-hidden="true" size={15} />
                  <span>{t('composer.add.connectors')}</span>
                  <ChevronRight aria-hidden="true" size={14} />
                </button>
                {addSubmenu === null ? null : (
                  <div
                    className="composer-popover composer-add-submenu"
                    role="menu"
                    aria-label={addSubmenu === 'skill'
                      ? t('composer.add.skills')
                      : t('composer.add.connectors')}
                  >
                    {addSubmenu === 'skill' ? (
                      <>
                        <label className="composer-add-search">
                          <Search aria-hidden="true" size={15} />
                          <input
                            aria-label={t('composer.add.searchSkills')}
                            type="search"
                            placeholder={t('composer.add.searchSkills')}
                            value={addCommandQuery}
                            onChange={event => setAddCommandQuery(event.currentTarget.value)}
                          />
                        </label>
                        <div className="composer-add-command-list">
                          {addCommands.length === 0 ? (
                            <p className="composer-model-status">{t('composer.add.noSkills')}</p>
                          ) : addCommands.map(command => (
                            <button
                              key={command.id}
                              className="composer-menu-item"
                              type="button"
                              role="menuitem"
                              onClick={() => applyAddCommand(command)}
                            >
                              <span className="composer-menu-icon" aria-hidden="true">
                                <Zap size={15} />
                              </span>
                              <span>
                                <strong>{command.label}</strong>
                                <small>{command.description}</small>
                              </span>
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      renderConnectorDirectory()
                    )}
                    {addSubmenu !== 'skill' || props.onManageSkills === undefined ? null : (
                      <button
                        className="composer-menu-item composer-add-footer"
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setOpenMenu(null);
                          setAddSubmenu(null);
                          props.onManageSkills?.();
                        }}
                      >
                        <Hammer aria-hidden="true" size={15} />
                        <span>{t('composer.add.manageSkills')}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              className="composer-file-input"
              type="file"
              aria-label={t('composer.add.selectImage')}
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              disabled={!canAttachImages}
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
              aria-label={t('composer.permission.select', {
                permission: selectedPermissionOption.label
              })}
              aria-expanded={openMenu === 'permission'}
              disabled={props.permissionChangeDisabled === true || permissionUpdating}
              title={
                props.permissionChangeDisabled === true
                  ? t('composer.permission.changeAfterRun')
                  : t('composer.permission.change')
              }
              onClick={() => {
                setSlashTrigger(null);
                setOpenMenu(openMenu === 'permission' ? null : 'permission');
              }}
            >
              <ShieldCheck aria-hidden="true" size={15} />
              <span>{selectedPermissionOption.label}</span>
              <ChevronDown aria-hidden="true" size={13} />
            </button>
            {openMenu === 'permission' ? (
              <div
                className="composer-popover composer-permission-menu"
                role="menu"
                aria-label={t('composer.permission.label')}
              >
                {permissionOptions.map(option => (
                  <button
                    key={option.value}
                    className="composer-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedPermission === option.value}
                    disabled={permissionUpdating}
                    onClick={() => {
                      if (
                        option.value === 'danger-full-access'
                        && selectedPermission !== 'danger-full-access'
                      ) {
                        setOpenMenu(null);
                        setPendingPermission(option.value);
                        return;
                      }
                      if (option.value === selectedPermission) {
                        setOpenMenu(null);
                        return;
                      }
                      void applyPermission(option.value);
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

          {enabledConnectors.length === 0 && openMenu !== 'connectors' ? null : (
            <div
              className="composer-enabled-connectors-wrap"
              data-composer-menu-root="connectors"
            >
              <div
                className="composer-enabled-connectors"
                role="list"
                aria-label={t('composer.connectors.enabled')}
              >
                {enabledConnectors.map(connector => (
                  <span key={connector.id} role="listitem">
                    <button
                      className="composer-enabled-connector"
                      type="button"
                      aria-label={t('composer.connectors.openList', { name: connector.label })}
                      aria-expanded={openMenu === 'connectors'}
                      title={t('composer.connectors.view', { name: connector.label })}
                      onClick={() => {
                        setSlashTrigger(null);
                        setAddSubmenu(null);
                        setAddCommandQuery('');
                        loadConnectorCatalog();
                        setOpenMenu(openMenu === 'connectors' ? null : 'connectors');
                      }}
                    >
                      {connectorIcon(connector)}
                    </button>
                  </span>
                ))}
              </div>
              {openMenu === 'connectors' ? (
                <div
                  className="composer-popover composer-connector-card"
                  role="dialog"
                  aria-label={t('composer.connectors.label')}
                >
                  {renderConnectorQuickMenu()}
                </div>
              ) : null}
            </div>
          )}

        </div>

        <div className="composer-right-actions">
          <div className="composer-control-wrap" data-composer-menu-root="model">
            <button
              className="composer-model-button"
              type="button"
              aria-label={t('composer.model.select', { model: selectedModelLabel })}
              aria-expanded={openMenu === 'model'}
              onClick={() => {
                setSlashTrigger(null);
                setOpenMenu(openMenu === 'model' ? null : 'model');
              }}
            >
              <span>{selectedModelLabel}</span>
              <ChevronDown aria-hidden="true" size={13} />
            </button>
            {openMenu === 'model' ? (
              <div
                className="composer-popover composer-model-menu"
                role="menu"
                aria-label={t('composer.model.label')}
              >
                <div className="composer-model-section" role="presentation">
                  <div className="composer-model-section-label">{t('composer.model.label')}</div>
                  {props.modelsLoading === true && availableModels.length === 0 ? (
                    <div className="composer-model-status" role="status">
                      {t('composer.model.loading')}
                    </div>
                  ) : null}
                  {props.modelsError !== undefined && availableModels.length === 0 ? (
                    <div className="composer-model-status composer-model-status-error">
                      {props.modelsError}
                    </div>
                  ) : null}
                  {props.modelsNotice !== undefined && availableModels.length > 0 ? (
                    <div className="composer-model-status" role="status">
                      {props.modelsNotice}
                    </div>
                  ) : null}
                  {availableModels.length === 0
                    && props.modelsLoading !== true
                    && props.modelsError === undefined ? (
                    <div className="composer-model-status">{t('composer.model.none')}</div>
                  ) : null}
                  {selectedModel !== null && resolvedSelectedModel === undefined ? (
                    <button
                      className="composer-menu-item"
                      type="button"
                      role="menuitemradio"
                      aria-checked="true"
                      disabled
                    >
                      <span className="composer-menu-icon" aria-hidden="true">
                        <Check size={15} />
                      </span>
                      <span>
                        <strong>{t('composer.model.unavailable', { model: selectedModel })}</strong>
                        <small>{t('composer.model.notInCatalog')}</small>
                      </span>
                    </button>
                  ) : null}
                  {availableModels.map(option => {
                    const imageBlocked =
                      attachmentDrafts.length > 0
                      && !option.inputModalities.includes('image');
                    return (
                      <button
                        key={option.id}
                        className="composer-menu-item"
                        type="button"
                        role="menuitemradio"
                        aria-checked={resolvedSelectedModel?.model === option.model}
                        disabled={imageBlocked}
                        onClick={() => {
                          const nextReasoning = isReasoningAvailable(
                            option,
                            selectedReasoning
                          )
                            ? selectedReasoning
                            : null;
                          setSelectedModel(option.model);
                          setSelectedReasoning(nextReasoning);
                          props.onModelConfigChange?.({
                            model: option.model,
                            reasoning: nextReasoning
                          });
                        }}
                      >
                        <span className="composer-menu-icon" aria-hidden="true">
                          {resolvedSelectedModel?.model === option.model ? <Check size={15} /> : null}
                        </span>
                        <span>
                          <strong>{option.displayName}</strong>
                          <small>{modelOptionDescription(option, imageBlocked, t)}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
                <div className="composer-model-section" role="presentation">
                  <div className="composer-model-section-label">
                    {t('composer.reasoning.label')}
                  </div>
                  <button
                    className="composer-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedReasoning === null || selectedReasoning === 'default'}
                    onClick={() => {
                      setSelectedReasoning(null);
                      props.onModelConfigChange?.({
                        model: selectedModel,
                        reasoning: null
                      });
                      setOpenMenu(null);
                    }}
                  >
                    <span className="composer-menu-icon" aria-hidden="true">
                      {selectedReasoning === null || selectedReasoning === 'default'
                        ? <Check size={15} />
                        : null}
                    </span>
                    <span>
                      <strong>{t('composer.reasoning.default')}</strong>
                      <small>{t('composer.reasoning.followCodex')}</small>
                    </span>
                  </button>
                  {selectedReasoningOptions.map(option => (
                    <button
                      key={option.reasoningEffort}
                      className="composer-menu-item"
                      type="button"
                      role="menuitemradio"
                      aria-checked={selectedReasoning === option.reasoningEffort}
                      onClick={() => {
                        setSelectedReasoning(option.reasoningEffort);
                        props.onModelConfigChange?.({
                          model: selectedModel,
                          reasoning: option.reasoningEffort
                        });
                        setOpenMenu(null);
                      }}
                    >
                      <span className="composer-menu-icon" aria-hidden="true">
                        {selectedReasoning === option.reasoningEffort
                          ? <Check size={15} />
                          : null}
                      </span>
                      <span>
                        <strong>{reasoningEffortLabel(option.reasoningEffort, t)}</strong>
                        <small>{reasoningEffortDescription(option.reasoningEffort, t)}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="composer-submit-wrap">
            <button
              className={showStopAction ? 'composer-stop' : 'composer-send'}
              type={showStopAction ? 'button' : 'submit'}
              aria-label={
                showStopAction
                  ? props.canceling ? t('composer.action.stopping') : t('composer.action.stop')
                  : props.running ? t('composer.action.queueSend') : t('composer.action.send')
              }
              title={
                showStopAction
                  ? props.canceling ? t('composer.action.stopping') : t('composer.action.stop')
                  : props.running ? t('composer.action.addToQueue') : t('composer.action.send')
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
      <ConfirmDialog
        open={pendingPermission === 'danger-full-access'}
        title={t('composer.fullAccess.title')}
        description={t('composer.fullAccess.description')}
        confirmLabel={t('composer.fullAccess.confirm')}
        busy={permissionUpdating}
        onCancel={() => setPendingPermission(undefined)}
        onConfirm={() => {
          if (pendingPermission !== undefined && !permissionUpdating) {
            void applyPermission(pendingPermission);
          }
        }}
      />
    </div>
  );
}

function normalizePermission(permission: ProjectPermission): ProjectPermission {
  return permission === 'danger-full-access' ? permission : 'workspace-write';
}

function mergeComposerConnectors(
  catalog: ComposerConnector[],
  local: ComposerConnector[]
): ComposerConnector[] {
  const merged = new Map<string, ComposerConnector>();
  for (const connector of [...catalog, ...local]) merged.set(connector.id, connector);
  return [...merged.values()].sort((left, right) => {
    const statusOrder = connectorStatusOrder(left.status) - connectorStatusOrder(right.status);
    return statusOrder === 0
      ? left.label.localeCompare(right.label)
      : statusOrder;
  });
}

function connectorStatusOrder(status: ComposerConnector['status']): number {
  if (status === 'enabled' || status === 'configured') return 0;
  if (status === 'installed') return 1;
  if (status === 'available') return 2;
  return 3;
}

function connectorStatusLabel(
  status: ComposerConnector['status'],
  t: Translate
): string {
  if (status === 'enabled') return t('composer.connectors.status.enabled');
  if (status === 'configured') return t('composer.connectors.status.configured');
  if (status === 'installed') return t('composer.connectors.status.installed');
  if (status === 'available') return t('composer.connectors.status.available');
  return t('composer.connectors.status.unavailable');
}

function connectorIcon(connector: ComposerConnector) {
  const identity = `${connector.id} ${connector.label}`.toLocaleLowerCase();
  const iconProps = { 'aria-hidden': true, size: 14 } as const;
  if (identity.includes('github')) return <Github {...iconProps} />;
  if (identity.includes('slack')) return <Slack {...iconProps} />;
  if (identity.includes('figma')) return <Figma {...iconProps} />;
  if (identity.includes('chrome') || identity.includes('browser')) {
    return <Chrome {...iconProps} />;
  }
  if (identity.includes('knowledge') || identity.includes('知识')) {
    return <Database {...iconProps} />;
  }
  if (identity.includes('cloud')) return <Cloud {...iconProps} />;
  return <Link2 {...iconProps} />;
}

function resolveSelectedModel(
  models: readonly CodexModelResponse[],
  selectedModel: string | null
): CodexModelResponse | undefined {
  if (selectedModel !== null) {
    return models.find(option => option.model === selectedModel);
  }
  return models.find(option => option.isDefault) ?? models[0];
}

function modelSelectionLabel(
  resolvedModel: CodexModelResponse | undefined,
  selectedModel: string | null,
  loading: boolean,
  t: Translate
): string {
  if (resolvedModel !== undefined) return resolvedModel.displayName;
  if (selectedModel !== null) return t('composer.model.unavailable', { model: selectedModel });
  return loading ? t('composer.model.loading') : t('composer.model.default');
}

function modelOptionDescription(
  option: CodexModelResponse,
  imageBlocked: boolean,
  t: Translate
): string {
  if (imageBlocked) return t('composer.model.imageBlocked');
  const details = [
    option.isDefault ? t('composer.model.currentDefault') : undefined,
    option.inputModalities.includes('image')
      ? t('composer.model.supportsImages')
      : t('composer.model.textOnly')
  ].filter((detail): detail is string => detail !== undefined);
  return details.join(' · ');
}

function isReasoningAvailable(
  model: CodexModelResponse,
  reasoning: ReasoningEffort | null
): boolean {
  return reasoning === null
    || reasoning === 'default'
    || model.supportedReasoningEfforts.some(
      option => option.reasoningEffort === reasoning
    );
}

function reasoningEffortLabel(reasoning: ReasoningEffort, t: Translate): string {
  if (reasoning === 'low') return t('composer.reasoning.low');
  if (reasoning === 'medium') return t('composer.reasoning.medium');
  if (reasoning === 'high') return t('composer.reasoning.high');
  if (reasoning === 'xhigh') return t('composer.reasoning.xhigh');
  return t('composer.reasoning.default');
}

function reasoningEffortDescription(reasoning: ReasoningEffort, t: Translate): string {
  if (reasoning === 'low') return t('composer.reasoning.lowDescription');
  if (reasoning === 'medium') return t('composer.reasoning.mediumDescription');
  if (reasoning === 'high') return t('composer.reasoning.highDescription');
  if (reasoning === 'xhigh') return t('composer.reasoning.xhighDescription');
  return t('composer.reasoning.followCodex');
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
      || label.startsWith(normalizedQuery);
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

function findClippingAncestors(element: HTMLElement): HTMLElement[] {
  const ancestors: HTMLElement[] = [];
  let ancestor = element.parentElement;
  while (ancestor !== null) {
    const style = window.getComputedStyle(ancestor);
    if (
      CLIPPING_OVERFLOW_VALUES.has(style.overflow)
      || CLIPPING_OVERFLOW_VALUES.has(style.overflowX)
      || CLIPPING_OVERFLOW_VALUES.has(style.overflowY)
    ) {
      ancestors.push(ancestor);
    }
    ancestor = ancestor.parentElement;
  }
  return ancestors;
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
