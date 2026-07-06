import type { PublicRunStatus } from '@clawee/protocol';

export type RightPanelMode = 'editor' | 'run_detail';

export type AppState = {
  selectedThreadId?: string;
  selectedRunId?: string;
  selectedFilePath: string;
  rightPanelMode: RightPanelMode;
  activeRunByThreadId: Record<string, string>;
  currentSseRunId?: string;
};

export type AppAction =
  | { type: 'select_thread'; threadId: string }
  | { type: 'select_file'; path: string }
  | { type: 'select_run_detail'; runId: string }
  | { type: 'run_started'; threadId: string; runId: string; status: PublicRunStatus }
  | { type: 'run_done'; threadId: string; runId: string };

export const initialAppState: AppState = {
  selectedFilePath: 'docs/design/enterprise-agent-workbench.md',
  rightPanelMode: 'editor',
  activeRunByThreadId: {}
};

export function reduceAppState(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'select_thread':
      return { ...state, selectedThreadId: action.threadId };
    case 'select_file':
      return { ...state, selectedFilePath: action.path, rightPanelMode: 'editor' };
    case 'select_run_detail':
      return { ...state, selectedRunId: action.runId, rightPanelMode: 'run_detail' };
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
