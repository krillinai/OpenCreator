import type { PublicRunStatus } from '@clawee/protocol';

export type RightPanelMode = 'closed' | 'file' | 'change' | 'run_detail';
export type ActiveView =
  | 'conversation'
  | 'search'
  | 'schedules'
  | 'tasks'
  | 'activity'
  | 'plugins'
  | 'account'
  | 'settings'
  | 'files';

export type AppState = {
  activeView: ActiveView;
  currentProjectId?: string;
  selectedThreadId?: string;
  selectedRunId?: string;
  selectedChangeId?: string;
  selectedFilePath: string;
  workspaceTargetPath?: string;
  rightPanelMode: RightPanelMode;
  activeRunByThreadId: Record<string, string>;
  currentSseRunId?: string;
};

export type AppAction =
  | { type: 'new_conversation' }
  | { type: 'select_project'; projectId: string }
  | { type: 'set_current_project'; projectId?: string }
  | { type: 'set_active_view'; activeView: ActiveView }
  | { type: 'open_settings' }
  | { type: 'open_files' }
  | { type: 'back_to_app' }
  | { type: 'select_thread'; threadId: string }
  | { type: 'select_file'; path: string }
  | { type: 'select_workspace_file'; path: string }
  | { type: 'select_change'; changeId: string }
  | { type: 'select_run_detail'; runId: string }
  | { type: 'close_file_workspace' }
  | { type: 'close_detail' }
  | { type: 'run_started'; threadId: string; runId: string; status: PublicRunStatus }
  | { type: 'run_done'; threadId: string; runId: string };

export const initialAppState: AppState = {
  activeView: 'conversation',
  selectedFilePath: 'docs/atoms.md',
  rightPanelMode: 'closed',
  activeRunByThreadId: {}
};

export function reduceAppState(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'set_current_project':
      return {
        ...state,
        currentProjectId: action.projectId
      };
    case 'select_project':
      return {
        ...state,
        currentProjectId: action.projectId,
        activeView: 'conversation',
        selectedThreadId: undefined,
        selectedRunId: undefined,
        selectedChangeId: undefined,
        workspaceTargetPath: undefined,
        rightPanelMode: 'closed'
      };
    case 'new_conversation':
      return {
        ...state,
        activeView: 'conversation',
        selectedThreadId: undefined,
        selectedRunId: undefined,
        selectedChangeId: undefined,
        workspaceTargetPath: undefined,
        rightPanelMode: 'closed'
      };
    case 'set_active_view':
      return {
        ...state,
        activeView: action.activeView,
        rightPanelMode: action.activeView === 'conversation' ? state.rightPanelMode : 'closed'
      };
    case 'open_settings':
      return { ...state, activeView: 'settings', rightPanelMode: 'closed' };
    case 'open_files':
      return { ...state, activeView: 'conversation', workspaceTargetPath: undefined, rightPanelMode: 'file' };
    case 'back_to_app':
      return { ...state, activeView: 'conversation' };
    case 'select_thread':
      return { ...state, selectedThreadId: action.threadId, workspaceTargetPath: undefined, activeView: 'conversation' };
    case 'select_file':
      return {
        ...state,
        activeView: 'conversation',
        selectedFilePath: action.path,
        workspaceTargetPath: action.path,
        rightPanelMode: 'file'
      };
    case 'select_workspace_file':
      return {
        ...state,
        activeView: 'conversation',
        selectedFilePath: action.path,
        workspaceTargetPath: action.path,
        rightPanelMode: 'file'
      };
    case 'select_change':
      return { ...state, activeView: 'conversation', selectedChangeId: action.changeId, rightPanelMode: 'change' };
    case 'select_run_detail':
      return { ...state, activeView: 'conversation', selectedRunId: action.runId, rightPanelMode: 'run_detail' };
    case 'close_file_workspace':
      return { ...state, activeView: 'conversation', workspaceTargetPath: undefined, rightPanelMode: 'closed' };
    case 'close_detail':
      return { ...state, rightPanelMode: 'closed' };
    case 'run_started':
      if (action.status === 'succeeded' || action.status === 'failed' || action.status === 'canceled') return state;
      return { ...state, activeRunByThreadId: { ...state.activeRunByThreadId, [action.threadId]: action.runId } };
    case 'run_done': {
      const next = { ...state.activeRunByThreadId };
      if (next[action.threadId] === action.runId) delete next[action.threadId];
      return { ...state, activeRunByThreadId: next };
    }
  }
}
