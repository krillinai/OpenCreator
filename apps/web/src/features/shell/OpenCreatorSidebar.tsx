import type { LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  AudioLines,
  Captions,
  ChevronRight,
  CircleAlert,
  Clapperboard,
  Clock3,
  Download,
  FilePenLine,
  Folder,
  FolderCog,
  FolderKanban,
  FolderMinus,
  FolderPlus,
  FolderOpen,
  Image as ImageIcon,
  ImagePlus,
  Languages,
  LoaderCircle,
  Mic2,
  MoreHorizontal,
  Pencil,
  PanelLeftClose,
  PanelLeftOpen,
  PanelsTopLeft,
  PauseCircle,
  Pin,
  PinOff,
  Settings2,
  ShieldAlert,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  TriangleAlert,
  Video,
  type LucideIcon
} from 'lucide-react';
import type { ActiveView } from '../../app/app-state.js';
import type { CreatorWorkspace } from '../dashboard/creator-workspace.js';
import type { DashboardGenerationMode } from '../dashboard/DashboardGenerationComposer.js';
import type { GatewayAccountState } from '@opencreator/protocol';
import { AccountAvatar } from '../account/AccountAvatar.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import OpenCreatorMark from '../../components/brand/OpenCreatorMark.js';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import type { ColorMode } from '../../styles/color-mode.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import type {
  OpenCreatorConversation,
  OpenCreatorProject
} from '../projects/project-model.js';
import type {
  SidebarTaskStatus,
  SidebarTaskSummary
} from './sidebar-task-model.js';

const SIDEBAR_ACTION_MENU_WIDTH = 154;
const SIDEBAR_ACTION_MENU_MAX_HEIGHT = 104;
const SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN = 8;
const SIDEBAR_ACTION_MENU_GAP = 4;

export function OpenCreatorSidebar(props: {
  loadAccountAvatar?(accountId: string, revision: string): Promise<Blob>;
  projects: OpenCreatorProject[];
  conversations: OpenCreatorConversation[];
  tasks: SidebarTaskSummary[];
  runningConversationIds?: ReadonlySet<string>;
  currentProjectId?: string;
  selectedConversationId?: string;
  activeView: ActiveView;
  activeWorkspace?: CreatorWorkspace;
  activeGenerationMode?: DashboardGenerationMode;
  gatewayAccountState?: GatewayAccountState;
  homeActive?: boolean;
  projectNavigationMode?: 'library' | 'tree';
  collapsed?: boolean;
  autoCollapsed?: boolean;
  colorMode?: ColorMode;
  onNewConversation(projectId?: string): void;
  onOpenHome(): void;
  onSelectProject(projectId: string): void;
  onSelectConversation(conversationId: string): void;
  onSelectTask(threadId: string): void;
  onOpenView(view: ActiveView): void;
  onOpenWorkspace?(workspace: CreatorWorkspace, mode?: DashboardGenerationMode): void;
  onOpenSettings(): void;
  onToggleCollapsed(): void;
  onAddProject?(): void;
  onManageProjects?(): void;
  onEditProject?(projectId: string): void;
  onReplaceProjectDirectory?(projectId: string): void;
  onArchiveProject?(projectId: string): void;
  onArchiveConversation?(conversationId: string): void | Promise<void>;
  onRenameConversation?(conversationId: string, title: string): void | Promise<void>;
  onPinConversation?(conversationId: string, pinned: boolean): void | Promise<void>;
  onDeleteConversation?(conversationId: string): void | Promise<void>;
  onDeleteTaskDraft?(threadId: string): void | Promise<void>;
  onArchiveTask?(task: SidebarTaskSummary): void | Promise<void>;
  onRenameTask?(task: SidebarTaskSummary, title: string): void | Promise<void>;
  onDeleteTask?(task: SidebarTaskSummary): void | Promise<void>;
}) {
  const { t } = useAppLanguage();
  const l = useLocalizedCopy();
  const accountEmail = props.gatewayAccountState?.authState === 'signed_in' ? props.gatewayAccountState.account?.email : undefined;
  const [expandedProjectId, setExpandedProjectId] = useState<string | undefined>(props.currentProjectId);
  const [projectMenuId, setProjectMenuId] = useState<string>();
  const [archivingConversationId, setArchivingConversationId] = useState<string>();
  const [conversationPendingArchive, setConversationPendingArchive] = useState<{
    id: string;
    title: string;
  }>();
  const [conversationMenuId, setConversationMenuId] = useState<string>();
  const [conversationMenuPosition, setConversationMenuPosition] = useState<{ top: number; left: number }>();
  const [conversationRename, setConversationRename] = useState<{
    id: string;
    originalTitle: string;
    title: string;
  }>();
  const [conversationPendingDeletion, setConversationPendingDeletion] = useState<{
    id: string;
    title: string;
  }>();
  const [conversationActionBusyId, setConversationActionBusyId] = useState<string>();
  const [deletingDraftThreadId, setDeletingDraftThreadId] = useState<string>();
  const [draftPendingDeletion, setDraftPendingDeletion] = useState<{ threadId: string }>();
  const [taskMenuId, setTaskMenuId] = useState<string>();
  const [taskMenuPosition, setTaskMenuPosition] = useState<{ top: number; left: number }>();
  const [taskRename, setTaskRename] = useState<{ id: string; originalTitle: string; title: string }>();
  const [taskPendingDeletion, setTaskPendingDeletion] = useState<SidebarTaskSummary>();
  const [taskActionBusyId, setTaskActionBusyId] = useState<string>();
  const [projectPendingRemoval, setProjectPendingRemoval] = useState<{
    id: string;
    name: string;
  }>();
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const conversationMenuRef = useRef<HTMLDivElement>(null);
  const conversationMenuPortalRef = useRef<HTMLDivElement>(null);
  const taskMenuRef = useRef<HTMLDivElement>(null);
  const taskMenuPortalRef = useRef<HTMLDivElement>(null);
  const renameCanceledRef = useRef(false);
  const collapsed = props.collapsed === true;
  const autoCollapsed = props.autoCollapsed === true;
  const globalActions: Array<{
    label: string;
    icon: LucideIcon;
    current: boolean;
    onClick(): void;
  }> = [
    {
      label: t('nav.dashboard'),
      icon: PanelsTopLeft,
      current: props.activeView === 'dashboard' && props.activeWorkspace === undefined,
      onClick: () => props.onOpenView('dashboard')
    },
    {
      label: t('nav.projects'),
      icon: FolderKanban,
      current: props.activeView === 'projects',
      onClick: () => props.onOpenView('projects')
    },
    {
      label: t('nav.settings'),
      icon: SlidersHorizontal,
      current: props.activeView === 'settings',
      onClick: props.onOpenSettings
    }
  ];
  if (props.projectNavigationMode === 'tree') {
    globalActions.push({
      label: t('nav.schedules'),
      icon: Clock3,
      current: props.activeView === 'schedules',
      onClick: () => props.onOpenView('schedules')
    });
  }
  const [creationMenu, setCreationMenu] = useState<{
    id: string;
    left: number;
    top: number;
  }>();
  const creationMenuRef = useRef<HTMLDivElement>(null);
  const creationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const creationCloseTimerRef = useRef<number | undefined>(undefined);
  const restoreCreationFocusRef = useRef(false);
  const creationGroups: Array<{
    id: string;
    label: string;
    icon: LucideIcon;
    sections?: Array<{ id: string; label: string }>;
    children: Array<{
      workspace: CreatorWorkspace;
      label: string;
      icon: LucideIcon;
      section?: string;
      mode?: DashboardGenerationMode;
    }>;
  }> = [
    {
      id: 'video',
      label: l('视频', 'Video'),
      icon: Video,
      sections: [
        { id: 'translate', label: 'Translate' },
        { id: 'generate', label: 'Generate' },
        { id: 'process', label: 'Process' }
      ],
      children: [
        { workspace: 'video-translation', label: l('视频翻译', 'Video Translation'), icon: Languages, section: 'translate' },
        { workspace: 'video-translation', label: l('字幕翻译', 'Subtitle Translation'), icon: Captions, section: 'translate' },
        { workspace: 'video-translation', label: l('视频配音', 'Voiceover'), icon: Mic2, section: 'translate' },
        { workspace: 'video-generation', label: l('文生视频', 'Text to Video'), icon: Video, section: 'generate' },
        { workspace: 'video-generation', label: l('图生视频', 'Image to Video'), icon: ImageIcon, section: 'generate' },
        { workspace: 'stickman-video', label: l('火柴人动画', 'Stickman Animation'), icon: Video, section: 'generate' },
        { workspace: 'video-download', label: l('视频下载', 'Video Downloader'), icon: Download, section: 'process', mode: 'download' },
        { workspace: 'transcription', label: l('视频转录', 'Video Transcription'), icon: Captions, section: 'process', mode: 'transcription' },
        { workspace: 'auto-clips', label: l('视频切片', 'Video Clips'), icon: Clapperboard, section: 'process', mode: 'clips' }
      ]
    },
    {
      id: 'image',
      label: l('图像', 'Image'),
      icon: ImageIcon,
      children: [
        { workspace: 'image-generation', label: l('文生图', 'Text to Image'), icon: ImageIcon },
        { workspace: 'image-generation', label: l('图生图', 'Image to Image'), icon: ImagePlus },
        { workspace: 'cover-generator', label: l('封面生成', 'Cover Generator'), icon: ImagePlus, mode: 'cover' }
      ]
    },
    {
      id: 'text',
      label: l('文本', 'Text'),
      icon: FilePenLine,
      children: [
        { workspace: 'short-video-script', label: l('短视频脚本生成', 'Short Video Script'), icon: FilePenLine, mode: 'script' }
      ]
    },
    {
      id: 'audio',
      label: l('音频', 'Audio'),
      icon: AudioLines,
      children: [
        { workspace: 'smart-dubbing', label: l('文本转语音', 'Text to Speech'), icon: Mic2 },
        { workspace: 'transcription', label: l('音频转录', 'Audio Transcription'), icon: Captions, mode: 'audio-transcription' }
      ]
    }
  ];
  const activeCreationGroup = creationGroups.find(group => group.id === creationMenu?.id);
  const creationChildActive = (child: (typeof creationGroups)[number]['children'][number]) => {
    const activeMode = ['video-translation', 'transcription', 'image-generation', 'cover-generator', 'video-generation', 'video-download', 'auto-clips', 'smart-dubbing', 'short-video-script'].includes(child.workspace)
      ? props.activeGenerationMode
      : undefined;
    return props.activeWorkspace === child.workspace
      && (activeMode ?? defaultCreationMode(child.workspace)) === (child.mode ?? defaultCreationMode(child.workspace));
  };
  const activeCreationChild = creationGroups.flatMap(group => group.children).find(creationChildActive);
  const renderCreationChild = (child: (typeof creationGroups)[number]['children'][number]) => {
    const ChildIcon = child.icon;
    return (
      <button
        type="button"
        role="menuitem"
        className="sidebar-creation-child"
        key={`${child.section ?? 'default'}:${child.label}`}
        aria-current={activeCreationChild === child ? 'page' : undefined}
        onClick={() => {
          closeCreationMenu();
          props.onOpenWorkspace?.(child.workspace, child.mode);
        }}
      >
        <span className="sidebar-creation-child-icon" aria-hidden="true">
          <ChildIcon size={16} strokeWidth={1.8} />
        </span>
        <span className="sidebar-creation-child-label">{child.label}</span>
      </button>
    );
  };
  const cancelCreationMenuClose = () => {
    if (creationCloseTimerRef.current !== undefined) {
      window.clearTimeout(creationCloseTimerRef.current);
      creationCloseTimerRef.current = undefined;
    }
  };
  const scheduleCreationMenuClose = () => {
    cancelCreationMenuClose();
    creationCloseTimerRef.current = window.setTimeout(() => {
      setCreationMenu(undefined);
      creationCloseTimerRef.current = undefined;
    }, 120);
  };
  const openCreationMenu = (id: string, trigger: HTMLButtonElement, childCount: number) => {
    cancelCreationMenuClose();
    creationTriggerRef.current = trigger;
    const rect = trigger.getBoundingClientRect();
    const width = Math.min(id === 'video' ? 696 : 220, window.innerWidth - 16);
    const height = id === 'video' ? 218 : childCount * 42 + 11;
    setCreationMenu({
      id,
      left: Math.max(8, Math.min(window.innerWidth - width - 8, rect.right + 8)),
      top: Math.max(8, Math.min(window.innerHeight - height - 8, rect.top - 6))
    });
  };
  const closeCreationMenu = (restoreFocus = false) => {
    cancelCreationMenuClose();
    setCreationMenu(undefined);
    if (restoreFocus) {
      restoreCreationFocusRef.current = true;
      creationTriggerRef.current?.focus();
    }
  };
  const conversationsByProject = new Map<string, OpenCreatorConversation[]>();
  const selectedTaskThread = props.tasks.some(
    task => task.threadId === props.selectedConversationId
  );

  for (const conversation of props.conversations) {
    const projectConversations = conversationsByProject.get(conversation.projectId) ?? [];
    projectConversations.push(conversation);
    conversationsByProject.set(conversation.projectId, projectConversations);
  }

  useEffect(() => {
    setExpandedProjectId(props.currentProjectId);
  }, [props.currentProjectId]);

  useEffect(() => () => {
    if (creationCloseTimerRef.current !== undefined) {
      window.clearTimeout(creationCloseTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (creationMenu === undefined) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !creationMenuRef.current?.contains(target)
        && !creationTriggerRef.current?.contains(target)
      ) closeCreationMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCreationMenu(true);
      }
    };
    const closeOnViewportChange = () => closeCreationMenu();
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [creationMenu]);

  useEffect(() => {
    if (projectMenuId === undefined) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!projectMenuRef.current?.contains(event.target as Node)) {
        setProjectMenuId(undefined);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setProjectMenuId(undefined);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [projectMenuId]);

  useEffect(() => {
    if (conversationMenuId === undefined) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !conversationMenuRef.current?.contains(target)
        && !conversationMenuPortalRef.current?.contains(target)
      ) {
        setConversationMenuId(undefined);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConversationMenuId(undefined);
    };
    const closeOnViewportChange = () => setConversationMenuId(undefined);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [conversationMenuId]);

  useEffect(() => {
    if (taskMenuId === undefined) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !taskMenuRef.current?.contains(target)
        && !taskMenuPortalRef.current?.contains(target)
      ) setTaskMenuId(undefined);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTaskMenuId(undefined);
    };
    const closeOnViewportChange = () => setTaskMenuId(undefined);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', closeOnViewportChange);
    window.addEventListener('scroll', closeOnViewportChange, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', closeOnViewportChange);
      window.removeEventListener('scroll', closeOnViewportChange, true);
    };
  }, [taskMenuId]);

  return (
    <nav className="opencreator-sidebar" aria-label="OpenCreator" data-collapsed={collapsed ? 'true' : 'false'}>
      <div className="sidebar-brand">
        {collapsed ? (
          <button
            className="sidebar-brand-button sidebar-expand-button"
            type="button"
            aria-disabled={autoCollapsed || undefined}
            aria-label={autoCollapsed ? t('nav.autoCollapsed') : t('nav.expand')}
            title={autoCollapsed ? t('nav.autoCollapsedHint') : t('nav.expand')}
            onClick={autoCollapsed ? undefined : props.onToggleCollapsed}
          >
            <OpenCreatorMark
              className="sidebar-logo-image"
              size={28}
              aria-hidden="true"
            />
            <PanelLeftOpen className="sidebar-expand-icon" size={19} strokeWidth={1.85} aria-hidden="true" />
          </button>
        ) : (
          <>
            <div className="sidebar-logo-lockup">
              <span className="sidebar-logo-word">OpenCreator</span>
            </div>
            <div className="sidebar-brand-actions">
              <button
                className="sidebar-collapse-button"
                type="button"
                aria-label={t('nav.collapse')}
                title={t('nav.collapse')}
                onClick={props.onToggleCollapsed}
              >
                <PanelLeftClose size={18} strokeWidth={1.85} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
      </div>

      <div className="sidebar-primary">
        {globalActions.slice(0, 1).map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              className="sidebar-row"
              key={action.label}
              title={collapsed ? action.label : undefined}
              aria-current={action.current ? 'page' : undefined}
              onClick={action.onClick}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className="sidebar-row-label">{action.label}</span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-creation-nav" aria-label={l('创作导航', 'Creation navigation')}>
        {creationGroups.map(group => {
          const expanded = creationMenu?.id === group.id;
          const GroupIcon = group.icon;
          const groupActive = group.children.some(creationChildActive);
          return (
            <section className="sidebar-creation-group" key={group.id}>
              <button
                type="button"
                className="sidebar-row sidebar-creation-parent"
                aria-haspopup="menu"
                aria-expanded={expanded}
                aria-controls={expanded ? `sidebar-creation-menu-${group.id}` : undefined}
                aria-current={groupActive ? 'page' : undefined}
                title={collapsed ? group.label : undefined}
                onMouseEnter={event => openCreationMenu(group.id, event.currentTarget, group.children.length)}
                onMouseLeave={scheduleCreationMenuClose}
                onFocus={event => {
                  if (restoreCreationFocusRef.current) {
                    restoreCreationFocusRef.current = false;
                    return;
                  }
                  openCreationMenu(group.id, event.currentTarget, group.children.length);
                }}
                onBlur={event => {
                  if (!creationMenuRef.current?.contains(event.relatedTarget as Node | null)) {
                    scheduleCreationMenuClose();
                  }
                }}
                onClick={event => openCreationMenu(group.id, event.currentTarget, group.children.length)}
              >
                <span className="sidebar-nav-icon" aria-hidden="true"><GroupIcon size={18} strokeWidth={1.8} /></span>
                <span className="sidebar-row-label">{group.label}</span>
                {!collapsed ? <ChevronRight className="sidebar-creation-chevron" size={14} aria-hidden="true" /> : null}
              </button>
            </section>
          );
        })}
      </div>

      {activeCreationGroup !== undefined && creationMenu !== undefined ? createPortal((
        <div
          id={`sidebar-creation-menu-${activeCreationGroup.id}`}
          className={`sidebar-creation-menu${activeCreationGroup.sections ? ' sidebar-creation-menu--sections' : ''}`}
          role="menu"
          aria-label={activeCreationGroup.label}
          ref={creationMenuRef}
          style={{ left: creationMenu.left, top: creationMenu.top }}
          onMouseEnter={cancelCreationMenuClose}
          onMouseLeave={scheduleCreationMenuClose}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              scheduleCreationMenuClose();
            }
          }}
        >
          {activeCreationGroup.sections ? (
            <div className="sidebar-creation-sections">
              {activeCreationGroup.sections.map(section => (
                <section className="sidebar-creation-section" key={section.id}>
                  <h3>{section.label}</h3>
                  {activeCreationGroup.children.filter(child => child.section === section.id).map(renderCreationChild)}
                </section>
              ))}
            </div>
          ) : activeCreationGroup.children.map(renderCreationChild)}
        </div>
      ), document.body) : null}

      <div className="sidebar-primary">
        {globalActions.slice(1).map((action) => {
          const Icon = action.icon;
          return (
            <button
              type="button"
              className="sidebar-row"
              key={action.label}
              title={collapsed ? action.label : undefined}
              aria-current={action.current ? 'page' : undefined}
              onClick={action.onClick}
            >
              <span className="sidebar-nav-icon" aria-hidden="true">
                <Icon size={18} strokeWidth={1.8} />
              </span>
              <span className="sidebar-row-label">{action.label}</span>
            </button>
          );
        })}
      </div>

      {collapsed || props.projectNavigationMode !== 'tree' ? null : (
        <section className="sidebar-section" aria-labelledby="opencreator-projects-heading">
          <div className="sidebar-section-heading">
            <h2 id="opencreator-projects-heading">{l("项目", "Projects")}</h2>
            {props.onAddProject || props.onManageProjects ? (
              <div className="sidebar-section-actions">
                {props.onAddProject ? (
                  <button
                    type="button"
                    className="sidebar-section-action"
                    aria-label={l("创建项目", "Create project")}
                    title={l("创建项目", "Create project")}
                    onClick={props.onAddProject}
                  >
                    <FolderPlus size={16} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}
                {props.onManageProjects ? (
                  <button
                    type="button"
                    className="sidebar-section-action"
                    aria-label={l("管理项目", "Manage projects")}
                    title={l("管理项目", "Manage projects")}
                    onClick={props.onManageProjects}
                  >
                    <Settings2 size={16} strokeWidth={1.9} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="sidebar-project-tree" aria-label={l("项目和对话", "projects and conversations")}>
            {props.projects.map((project) => {
              const isCurrentProject =
                !selectedTaskThread && project.id === props.currentProjectId;
              const isExpanded = project.id === expandedProjectId;
              const projectConversations = conversationsByProject.get(project.id) ?? [];
              const ProjectIcon = isCurrentProject ? FolderOpen : Folder;

              return (
                <div className="sidebar-project-node" key={project.id}>
                  <div className="sidebar-project-row-shell">
                    <button
                      type="button"
                      className="sidebar-row project-row"
                      data-current-project={isCurrentProject ? 'true' : undefined}
                      aria-expanded={isExpanded}
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedProjectId(undefined);
                          return;
                        }
                        setExpandedProjectId(project.id);
                        if (projectConversations.length === 0) {
                          props.onSelectProject(project.id);
                        }
                      }}
                    >
                      <ProjectIcon className="project-icon" size={18} strokeWidth={1.85} aria-hidden="true" />
                      <span>{project.name}</span>
                    </button>
                    <div
                      className="sidebar-project-actions"
                      ref={projectMenuId === project.id ? projectMenuRef : undefined}
                    >
                      <button
                        type="button"
                        className="sidebar-project-new-conversation"
                        aria-label={l(`在 ${project.name} 中新建会话`, `New conversation in ${project.name}`)}
                        title={l("新建会话", "New conversation")}
                        onClick={() => props.onNewConversation(project.id)}
                      >
                        <SquarePen size={16} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                      {props.onArchiveProject ? (
                        <div className="sidebar-project-menu-shell">
                          <button
                            type="button"
                            className="sidebar-project-menu-trigger"
                            aria-label={l(`项目操作 ${project.name}`, `Project actions for ${project.name}`)}
                            title={l("项目操作", "Project operations")}
                            aria-haspopup="menu"
                            aria-expanded={projectMenuId === project.id}
                            onClick={() => setProjectMenuId(
                              current => current === project.id ? undefined : project.id
                            )}
                          >
                            <MoreHorizontal size={16} strokeWidth={2} aria-hidden="true" />
                          </button>
                          {projectMenuId === project.id ? (
                            <div
                              className="sidebar-project-menu"
                              role="menu"
                              aria-label={l(`${project.name} 项目操作`, `Project actions for ${project.name}`)}
                            >
                              <button
                                type="button"
                                role="menuitem"
                                onClick={() => {
                                  setProjectMenuId(undefined);
                                  props.onEditProject?.(project.id);
                                }}
                              >
                                <Settings2 size={15} strokeWidth={1.9} aria-hidden="true" />
                                <span>{l("编辑项目", "Edit project")}</span>
                              </button>
                              {props.onReplaceProjectDirectory ? (
                                <button
                                  type="button"
                                  role="menuitem"
                                  onClick={() => {
                                    setProjectMenuId(undefined);
                                    props.onReplaceProjectDirectory?.(project.id);
                                  }}
                                >
                                  <FolderCog size={15} strokeWidth={1.9} aria-hidden="true" />
                                  <span>{l("更换目录", "Change directory")}</span>
                                </button>
                              ) : null}
                              <button
                                type="button"
                                role="menuitem"
                                aria-label={l(`移除项目 ${project.name}`, `Remove project ${project.name}`)}
                                title={l("仅从项目列表移除，不会删除本机文件", "Remove from the project list. Local files will be preserved.")}
                                onClick={() => {
                                  setProjectMenuId(undefined);
                                  setProjectPendingRemoval({ id: project.id, name: project.name });
                                }}
                              >
                                <FolderMinus size={15} strokeWidth={1.9} aria-hidden="true" />
                                <span>{l("移除项目", "Remove project")}</span>
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  {isExpanded && projectConversations.length > 0 ? (
                    <div className="sidebar-conversation-tree" aria-label={l(`${project.name} 对话`, `Conversations in ${project.name}`)}>
                      {projectConversations.map((conversation) => {
                        const isRunning = props.runningConversationIds?.has(conversation.id) === true;
                        return (
                          <div
                            key={conversation.id}
                            className="sidebar-conversation-row-shell"
                            data-has-action="true"
                            role="group"
                            aria-label={conversation.title}
                          >
                            {conversationRename?.id === conversation.id ? (
                              <input
                                className="sidebar-conversation-rename-input"
                                aria-label={l(`重命名 ${conversationRename.originalTitle}`, `Rename ${conversationRename.originalTitle}`)}
                                autoFocus
                                value={conversationRename.title}
                                onChange={event => setConversationRename(current => (
                                  current === undefined ? current : { ...current, title: event.target.value }
                                ))}
                                onKeyDown={event => {
                                  if (event.key === 'Enter') {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                  } else if (event.key === 'Escape') {
                                    event.preventDefault();
                                    renameCanceledRef.current = true;
                                    setConversationRename(undefined);
                                  }
                                }}
                                onBlur={() => {
                                  if (renameCanceledRef.current) {
                                    renameCanceledRef.current = false;
                                    return;
                                  }
                                  const nextTitle = conversationRename.title.trim();
                                  if (nextTitle.length === 0 || nextTitle === conversationRename.originalTitle) {
                                    setConversationRename(undefined);
                                    return;
                                  }
                                  setConversationActionBusyId(conversation.id);
                                  void Promise.resolve(
                                    props.onRenameConversation?.(conversation.id, nextTitle)
                                  ).finally(() => {
                                    setConversationActionBusyId(undefined);
                                    setConversationRename(undefined);
                                  });
                                }}
                              />
                            ) : <button
                              type="button"
                              className="conversation-row nested-conversation-row"
                              aria-current={
                                props.activeView === 'conversation'
                                && conversation.id === props.selectedConversationId
                                  ? 'page'
                                  : undefined
                              }
                              onClick={() => props.onSelectConversation(conversation.id)}
                            >
                              <strong>
                                <span className="conversation-title-default">{conversation.title}</span>
                                <span className="conversation-title-hover" aria-hidden="true">
                                  {abbreviateConversationTitle(conversation.title)}
                                </span>
                              </strong>
                              <span className="conversation-row-meta">
                                {isRunning ? (
                                  <LoaderCircle
                                    className="conversation-run-spinner"
                                    size={13}
                                    strokeWidth={2}
                                    aria-label={l("正在运行", "Running")}
                                  />
                                ) : null}
                                <span className="conversation-updated-label">{conversation.updatedLabel}</span>
                              </span>
                            </button>}
                            <div
                              className="sidebar-conversation-actions"
                              ref={conversationMenuId === conversation.id ? conversationMenuRef : undefined}
                            >
                              <div className="sidebar-conversation-menu-shell">
                                <button
                                  type="button"
                                  className="sidebar-conversation-action"
                                  aria-label={l("更多", "More")}
                                  title={l("更多", "More")}
                                  aria-haspopup="menu"
                                  aria-expanded={conversationMenuId === conversation.id}
                                  onClick={event => {
                                    const rect = event.currentTarget.getBoundingClientRect();
                                    setConversationMenuPosition(positionSidebarActionMenu(rect));
                                    setConversationMenuId(current => (
                                      current === conversation.id ? undefined : conversation.id
                                    ));
                                  }}
                                >
                                  <MoreHorizontal size={16} strokeWidth={1.9} aria-hidden="true" />
                                </button>
                                {conversationMenuId === conversation.id && conversationMenuPosition !== undefined
                                  ? createPortal((
                                    <div
                                      className="sidebar-conversation-menu sidebar-conversation-menu--portal"
                                      role="menu"
                                      aria-label={l(`${conversation.title} 操作`, `Actions for ${conversation.title}`)}
                                      ref={conversationMenuPortalRef}
                                      style={conversationMenuPosition}
                                    >
                                      <button
                                        type="button"
                                        role="menuitem"
                                        onClick={() => {
                                          setConversationMenuId(undefined);
                                          setConversationRename({
                                            id: conversation.id,
                                            originalTitle: conversation.title,
                                            title: conversation.title
                                          });
                                        }}
                                      >
                                        <Pencil size={15} strokeWidth={1.9} aria-hidden="true" />
                                        <span>{l("重命名", "Rename")}</span>
                                      </button>
                                      <button
                                        type="button"
                                        role="menuitem"
                                        className="is-destructive"
                                        disabled={isRunning}
                                        onClick={() => {
                                          setConversationMenuId(undefined);
                                          setConversationPendingDeletion({
                                            id: conversation.id,
                                            title: conversation.title
                                          });
                                        }}
                                      >
                                        <Trash2 size={15} strokeWidth={1.9} aria-hidden="true" />
                                        <span>{l("删除任务", "Delete task")}</span>
                                      </button>
                                    </div>
                                  ), document.body)
                                  : null}
                              </div>
                              {props.onArchiveConversation ? (
                              <button
                                type="button"
                                className="sidebar-conversation-action sidebar-conversation-archive"
                                aria-label={l("归档", "Archive")}
                                title={isRunning ? l("任务运行结束后可归档", "Available when the task finishes") : l("归档会话", "Archive conversation")}
                                disabled={
                                  isRunning
                                  || archivingConversationId === conversation.id
                                  || conversationActionBusyId === conversation.id
                                }
                                onClick={() => {
                                  setConversationPendingArchive({
                                    id: conversation.id,
                                    title: conversation.title
                                  });
                                }}
                              >
                                {archivingConversationId === conversation.id ? (
                                  <LoaderCircle
                                    className="conversation-run-spinner"
                                    size={16}
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Archive size={16} strokeWidth={1.9} aria-hidden="true" />
                                )}
                              </button>
                              ) : null}
                              {props.onPinConversation ? (
                                <button
                                  type="button"
                                  className="sidebar-conversation-action"
                                  aria-label={conversation.pinnedAt == null ? l("置顶", "Pin") : l("取消置顶", "Unpin")}
                                  title={conversation.pinnedAt == null ? l("置顶会话", "Pin conversation") : l("取消置顶", "Unpin")}
                                  disabled={conversationActionBusyId === conversation.id}
                                  onClick={() => {
                                    setConversationActionBusyId(conversation.id);
                                    void Promise.resolve(props.onPinConversation?.(
                                      conversation.id,
                                      conversation.pinnedAt == null
                                    )).finally(() => setConversationActionBusyId(undefined));
                                  }}
                                >
                                  {conversation.pinnedAt == null
                                    ? <Pin size={16} strokeWidth={1.9} aria-hidden="true" />
                                    : <PinOff size={16} strokeWidth={1.9} aria-hidden="true" />}
                                </button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {collapsed || props.projectNavigationMode !== 'tree' ? null : (
        <section
          className="sidebar-section sidebar-task-section"
          aria-labelledby="opencreator-tasks-heading"
        >
          <h2 id="opencreator-tasks-heading">{l("任务", "Tasks")}</h2>
          {props.tasks.length === 0 ? (
            <p className="sidebar-empty">{l("暂无任务", "No tasks yet")}</p>
          ) : (
            <div className="sidebar-task-list" aria-label={l("任务会话", "Task conversations")}>
              {props.tasks.map(task => {
                const visual = taskStatusVisual(l, task.status);
                const StatusIcon = visual.icon;
                const disabled = task.status === 'repair_required' || task.threadId === undefined;
                const detail = task.status === 'idle'
                  ? task.nextRunLabel ?? visual.label
                  : visual.label;
                const isRunning = task.status === 'running' || task.status === 'queued';
                const isRenaming = taskRename?.id === task.id;
                return (
                  <div
                    className="sidebar-task-row-shell"
                    data-status={task.status}
                    key={task.id}
                  >
                    {isRenaming ? (
                      <input
                        className="sidebar-task-rename-input"
                        aria-label={l(`重命名任务 ${task.name}`, `Rename task ${task.name}`)}
                        autoFocus
                        value={taskRename.title}
                        onChange={event => setTaskRename(current => current === undefined
                          ? current
                          : { ...current, title: event.target.value })}
                        onKeyDown={event => {
                          if (event.key === 'Escape') {
                            renameCanceledRef.current = true;
                            setTaskRename(undefined);
                          } else if (event.key === 'Enter') {
                            event.currentTarget.blur();
                          }
                        }}
                        onBlur={() => {
                          if (renameCanceledRef.current) {
                            renameCanceledRef.current = false;
                            return;
                          }
                          const title = taskRename.title.trim();
                          if (title.length === 0 || title === taskRename.originalTitle) {
                            setTaskRename(undefined);
                            return;
                          }
                          setTaskActionBusyId(task.id);
                          void Promise.resolve(props.onRenameTask?.(task, title)).finally(() => {
                            setTaskActionBusyId(undefined);
                            setTaskRename(undefined);
                          });
                        }}
                      />
                    ) : <button
                      type="button"
                      className="sidebar-task-row"
                      data-status={task.status}
                      aria-current={
                        props.activeView === 'conversation'
                        && task.threadId === props.selectedConversationId
                          ? 'page'
                          : undefined
                      }
                      disabled={disabled}
                      onClick={() => {
                        if (task.threadId !== undefined) props.onSelectTask(task.threadId);
                      }}
                    >
                      <StatusIcon
                        className={task.status === 'running' ? 'sidebar-task-spinner' : 'sidebar-task-icon'}
                        size={16}
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                      <span className="sidebar-task-copy">
                        <strong>{task.name}</strong>
                        <span>{detail}</span>
                      </span>
                      {task.unread ? (
                        <span className="sidebar-task-unread" aria-label={l("未读更新", "unread updates")} />
                      ) : null}
                    </button>}
                    {isRenaming ? null : (
                      <div className="sidebar-task-actions" ref={taskMenuId === task.id ? taskMenuRef : undefined}>
                        <div className="sidebar-task-menu-shell">
                          <button
                            type="button"
                            className="sidebar-task-action"
                            aria-label={l(`更多 ${task.name}`, `More ${task.name}`)}
                            aria-haspopup="menu"
                            aria-expanded={taskMenuId === task.id}
                            onClick={event => {
                              const rect = event.currentTarget.getBoundingClientRect();
                              setTaskMenuPosition(positionSidebarActionMenu(rect));
                              setTaskMenuId(current => current === task.id ? undefined : task.id);
                            }}
                          >
                            <MoreHorizontal size={14} aria-hidden="true" />
                          </button>
                          {taskMenuId === task.id && taskMenuPosition !== undefined ? createPortal((
                            <div
                              className="sidebar-task-menu sidebar-task-menu--portal"
                              role="menu"
                              aria-label={l(`${task.name} 操作`, `Actions for ${task.name}`)}
                              ref={taskMenuPortalRef}
                              style={taskMenuPosition}
                            >
                              <button type="button" role="menuitem" onClick={() => {
                                setTaskMenuId(undefined);
                                setTaskRename({ id: task.id, originalTitle: task.name, title: task.name });
                              }}>
                                <Pencil size={15} aria-hidden="true" /><span>{l("重命名", "Rename")}</span>
                              </button>
                              <button type="button" role="menuitem" className="is-destructive" disabled={isRunning} onClick={() => {
                                setTaskMenuId(undefined);
                                setTaskPendingDeletion(task);
                              }}>
                                <Trash2 size={15} aria-hidden="true" /><span>{l("删除任务", "Delete task")}</span>
                              </button>
                            </div>
                          ), document.body) : null}
                        </div>
                      <button
                        type="button"
                        className="sidebar-task-action sidebar-task-archive"
                        aria-label={l(`归档 ${task.name}`, `Archive ${task.name}`)}
                        title={isRunning ? l("任务运行结束后可归档", "Available when the task finishes") : l("归档任务", "Archive task")}
                        disabled={isRunning || taskActionBusyId === task.id}
                        onClick={() => {
                          setTaskActionBusyId(task.id);
                          void Promise.resolve(props.onArchiveTask?.(task)).finally(() => setTaskActionBusyId(undefined));
                        }}
                      >
                        {taskActionBusyId === task.id ? (
                          <LoaderCircle className="sidebar-task-spinner" size={15} aria-hidden="true" />
                        ) : (
                          <Archive size={14} aria-hidden="true" />
                        )}
                      </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="sidebar-bottom">
        <button type="button" className="sidebar-account" aria-label={l('个人中心', 'Account')} title={l('个人中心', 'Account')} aria-current={props.activeView === 'account' || props.activeView === 'subscription' ? 'page' : undefined} onClick={() => props.onOpenView('account')}>
          <AccountAvatar email={accountEmail} accountId={props.gatewayAccountState?.account?.id} avatarUrl={props.gatewayAccountState?.account?.avatarUrl} loadAvatar={props.loadAccountAvatar}/>
          {!collapsed ? <span className="sidebar-account__copy"><strong>{l('个人中心', 'Account')}</strong><small>{accountEmail ?? (props.gatewayAccountState?.authState === 'expired' ? l('登录已过期', 'Session expired') : l('未登录', 'Signed out'))}</small></span> : null}
        </button>
      </div>

      <ConfirmDialog
        open={conversationPendingDeletion !== undefined}
        title={l("删除任务", "Delete task")}
        description={conversationPendingDeletion === undefined
          ? l("永久删除后无法恢复，但不会删除项目文件。", "Deletion is permanent. Project files will be preserved.")
          : l(`确认永久删除“${conversationPendingDeletion.title}”？会话及历史记录将无法恢复，但不会删除项目文件。`, `Permanently delete \"${conversationPendingDeletion.title}\"? Its conversation and history cannot be restored. Project files will be preserved.`)}
        confirmLabel={l("永久删除", "Delete permanently")}
        destructive
        busy={conversationActionBusyId !== undefined}
        onCancel={() => setConversationPendingDeletion(undefined)}
        onConfirm={() => {
          if (conversationPendingDeletion === undefined || conversationActionBusyId !== undefined) return;
          const { id } = conversationPendingDeletion;
          setConversationActionBusyId(id);
          void Promise.resolve(props.onDeleteConversation?.(id)).finally(() => {
            setConversationActionBusyId(undefined);
            setConversationPendingDeletion(undefined);
          });
        }}
      />
      <ConfirmDialog
        open={conversationPendingArchive !== undefined}
        title={l("归档对话", "Archive conversation")}
        description={conversationPendingArchive === undefined
          ? l("归档后会从项目列表隐藏，但不会删除项目文件或 Codex 历史。", "Archiving hides the conversation from the project list. Project files and Codex history will be preserved.")
          : l(`确认归档“${conversationPendingArchive.title}”？归档后会从项目列表隐藏，但不会删除项目文件或 Codex 历史。`, `Archive \"${conversationPendingArchive.title}\"? It will be hidden from the project list. Project files and Codex history will be preserved.`)}
        confirmLabel={l("归档", "Archive")}
        busy={archivingConversationId !== undefined}
        onCancel={() => setConversationPendingArchive(undefined)}
        onConfirm={() => {
          if (conversationPendingArchive === undefined || archivingConversationId !== undefined) return;
          const { id } = conversationPendingArchive;
          setArchivingConversationId(id);
          void Promise.resolve(props.onArchiveConversation?.(id)).finally(() => {
            setArchivingConversationId(undefined);
            setConversationPendingArchive(undefined);
          });
        }}
      />
      <ConfirmDialog
        open={projectPendingRemoval !== undefined}
        title={l("移除项目", "Remove project")}
        description={projectPendingRemoval === undefined
          ? l("项目目录和文件不会被删除。", "Project directories and files will not be deleted.")
          : l(`确认从 OpenCreator 中移除“${projectPendingRemoval.name}”？项目目录和文件不会被删除。`, `Are you sure you want to remove \"${projectPendingRemoval.name}\" from OpenCreator? Project directories and files will not be deleted.`)}
        confirmLabel={l("移除项目", "Remove project")}
        destructive
        onCancel={() => setProjectPendingRemoval(undefined)}
        onConfirm={() => {
          if (projectPendingRemoval === undefined) return;
          props.onArchiveProject?.(projectPendingRemoval.id);
          setProjectPendingRemoval(undefined);
        }}
      />
      <ConfirmDialog
        open={taskPendingDeletion !== undefined}
        title={l("删除任务", "Delete task")}
        description={taskPendingDeletion === undefined
          ? l("删除后无法恢复。", "It cannot be restored after deletion.")
          : l(`确认删除“${taskPendingDeletion.name}”？删除后无法恢复。`, `Are you sure you want to delete \"${taskPendingDeletion.name}\"? It cannot be restored after deletion.`)}
        confirmLabel={l("删除任务", "Delete task")}
        destructive
        busy={taskActionBusyId !== undefined}
        onCancel={() => setTaskPendingDeletion(undefined)}
        onConfirm={() => {
          if (taskPendingDeletion === undefined || taskActionBusyId !== undefined) return;
          const task = taskPendingDeletion;
          setTaskActionBusyId(task.id);
          void Promise.resolve(props.onDeleteTask?.(task)).finally(() => {
            setTaskActionBusyId(undefined);
            setTaskPendingDeletion(undefined);
          });
        }}
      />
      <ConfirmDialog
        open={draftPendingDeletion !== undefined}
        title={l("删除任务草稿", "Delete task draft")}
        description={l("此操作不会删除项目文件。", "This operation does not delete the project files.")}
        confirmLabel={l("删除草稿", "Delete draft")}
        destructive
        busy={deletingDraftThreadId !== undefined}
        onCancel={() => setDraftPendingDeletion(undefined)}
        onConfirm={() => {
          if (draftPendingDeletion === undefined || deletingDraftThreadId !== undefined) return;
          const { threadId } = draftPendingDeletion;
          setDeletingDraftThreadId(threadId);
          void Promise.resolve(props.onDeleteTaskDraft?.(threadId)).finally(() => {
            setDeletingDraftThreadId(undefined);
            setDraftPendingDeletion(undefined);
          });
        }}
      />
    </nav>
  );
}

function positionSidebarActionMenu(trigger: DOMRect): { top: number; left: number } {
  return {
    top: Math.max(
      SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
      Math.min(
        window.innerHeight - SIDEBAR_ACTION_MENU_MAX_HEIGHT - SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
        trigger.bottom + SIDEBAR_ACTION_MENU_GAP
      )
    ),
    left: Math.max(
      SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
      Math.min(
        window.innerWidth - SIDEBAR_ACTION_MENU_WIDTH - SIDEBAR_ACTION_MENU_VIEWPORT_MARGIN,
        trigger.right - SIDEBAR_ACTION_MENU_WIDTH
      )
    )
  };
}

function defaultCreationMode(workspace: CreatorWorkspace): DashboardGenerationMode {
  switch (workspace) {
    case 'image-generation': return 'image';
    case 'cover-generator': return 'cover';
    case 'video-generation': return 'video';
    case 'video-download': return 'download';
    case 'auto-clips': return 'clips';
    case 'smart-dubbing': return 'speech';
    case 'short-video-script': return 'script';
    case 'transcription': return 'transcription';
    default: return 'translation';
  }
}

function taskStatusVisual(l: LocalizeCopy, status: SidebarTaskStatus): {
  icon: LucideIcon;
  label: string;
} {
  switch (status) {
    case 'draft':
      return { icon: SquarePen, label: l("草稿", "draft") };
    case 'running':
      return { icon: LoaderCircle, label: l("运行中", "Running") };
    case 'queued':
      return { icon: Clock3, label: l("排队中", "Queuing") };
    case 'waiting_approval':
      return { icon: ShieldAlert, label: l("待审批", "Pending approval") };
    case 'failed':
      return { icon: CircleAlert, label: l("失败", "fail") };
    case 'paused':
      return { icon: PauseCircle, label: l("已暂停", "Paused") };
    case 'repair_required':
      return { icon: TriangleAlert, label: l("需修复", "Needs repair") };
    case 'idle':
      return { icon: Clock3, label: l("等待首次运行", "Waiting for first run") };
  }
}

function abbreviateConversationTitle(title: string): string {
  const characters = Array.from(title);
  return characters.length > 7 ? `${characters.slice(0, 7).join('')}...` : title;
}
