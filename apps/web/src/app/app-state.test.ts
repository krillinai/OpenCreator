import { describe, expect, it } from 'vitest';
import { reduceAppState, initialAppState } from './app-state.js';

describe('app state', () => {
  it('switches projects, opens settings, and returns to the conversation view', () => {
    const changedProject = reduceAppState(
      { ...initialAppState, activeView: 'plugins', rightPanelMode: 'file' },
      {
        type: 'select_project',
        projectId: 'bili'
      }
    );

    expect(changedProject.currentProjectId).toBe('bili');
    expect(changedProject.activeView).toBe('conversation');
    expect(changedProject.rightPanelMode).toBe('closed');
    expect(changedProject.selectedThreadId).toBeUndefined();

    const settings = reduceAppState(changedProject, { type: 'open_settings' });
    expect(settings.activeView).toBe('settings');
    expect(settings.rightPanelMode).toBe('closed');

    const app = reduceAppState(settings, { type: 'back_to_app' });
    expect(app.activeView).toBe('conversation');
  });

  it('opens files, changes, run details, and closes the detail panel', () => {
    const file = reduceAppState({ ...initialAppState, activeView: 'settings' }, {
      type: 'select_file',
      path: 'docs/runtime-api-for-ui-v1.md'
    });
    expect(file.activeView).toBe('conversation');
    expect(file.selectedFilePath).toBe('docs/runtime-api-for-ui-v1.md');
    expect(file.rightPanelMode).toBe('file');

    const change = reduceAppState({ ...file, activeView: 'search' }, {
      type: 'select_change',
      changeId: 'change_1'
    });
    expect(change.activeView).toBe('conversation');
    expect(change.selectedChangeId).toBe('change_1');
    expect(change.rightPanelMode).toBe('change');

    const runDetail = reduceAppState({ ...change, activeView: 'settings' }, {
      type: 'select_run_detail',
      runId: 'run_1'
    });
    expect(runDetail.activeView).toBe('conversation');
    expect(runDetail.selectedRunId).toBe('run_1');
    expect(runDetail.rightPanelMode).toBe('run_detail');

    const closed = reduceAppState(runDetail, { type: 'close_detail' });
    expect(closed.rightPanelMode).toBe('closed');
    expect(closed.selectedFilePath).toBe('docs/runtime-api-for-ui-v1.md');
    expect(closed.selectedChangeId).toBe('change_1');
    expect(closed.selectedRunId).toBe('run_1');
  });

  it('closes detail when switching away from the conversation view', () => {
    const state = reduceAppState(
      { ...initialAppState, rightPanelMode: 'run_detail', selectedRunId: 'run_1' },
      {
        type: 'set_active_view',
        activeView: 'search'
      }
    );

    expect(state.activeView).toBe('search');
    expect(state.rightPanelMode).toBe('closed');
  });

  it('opens the file workspace and closes the detail panel', () => {
    const state = reduceAppState(
      { ...initialAppState, activeView: 'conversation', rightPanelMode: 'file' },
      {
        type: 'open_files'
      }
    );

    expect(state.activeView).toBe('files');
    expect(state.rightPanelMode).toBe('closed');
  });

  it('selects a workspace file without opening the right detail panel', () => {
    const state = reduceAppState(
      { ...initialAppState, activeView: 'files', rightPanelMode: 'change' },
      {
        type: 'select_workspace_file',
        path: 'docs/workspace.md'
      }
    );

    expect(state.activeView).toBe('files');
    expect(state.selectedFilePath).toBe('docs/workspace.md');
    expect(state.rightPanelMode).toBe('closed');
  });

  it('closes conversation detail when switching to the file workspace', () => {
    const state = reduceAppState(
      { ...initialAppState, activeView: 'conversation', rightPanelMode: 'run_detail', selectedRunId: 'run_1' },
      {
        type: 'set_active_view',
        activeView: 'files'
      }
    );

    expect(state.activeView).toBe('files');
    expect(state.rightPanelMode).toBe('closed');
    expect(state.selectedRunId).toBe('run_1');
  });

  it('selects a thread and returns to the conversation view', () => {
    const state = reduceAppState(
      { ...initialAppState, activeView: 'search' },
      {
        type: 'select_thread',
        threadId: 'thread_1'
      }
    );

    expect(state.selectedThreadId).toBe('thread_1');
    expect(state.activeView).toBe('conversation');
  });

  it('starts a new conversation and clears selected conversation context', () => {
    const state = reduceAppState(
      {
        ...initialAppState,
        activeView: 'plugins',
        selectedThreadId: 'thread_1',
        selectedRunId: 'run_1',
        selectedChangeId: 'change_1',
        rightPanelMode: 'run_detail'
      },
      {
        type: 'new_conversation'
      }
    );

    expect(state.activeView).toBe('conversation');
    expect(state.selectedThreadId).toBeUndefined();
    expect(state.selectedRunId).toBeUndefined();
    expect(state.selectedChangeId).toBeUndefined();
    expect(state.rightPanelMode).toBe('closed');
  });

  it('tracks active run by thread id and clears it on done', () => {
    const running = reduceAppState(initialAppState, {
      type: 'run_started',
      threadId: 'thread_1',
      runId: 'run_1',
      status: 'running'
    });
    expect(running.activeRunByThreadId.thread_1).toBe('run_1');

    const done = reduceAppState(running, {
      type: 'run_done',
      threadId: 'thread_1',
      runId: 'run_1'
    });
    expect(done.activeRunByThreadId.thread_1).toBeUndefined();
  });

  it('does not track terminal run_started statuses', () => {
    for (const status of ['succeeded', 'failed', 'canceled'] as const) {
      const state = reduceAppState(initialAppState, {
        type: 'run_started',
        threadId: 'thread_1',
        runId: `run_${status}`,
        status
      });

      expect(state.activeRunByThreadId.thread_1).toBeUndefined();
    }
  });

  it('does not clear active run for a different run id', () => {
    const running = reduceAppState(initialAppState, {
      type: 'run_started',
      threadId: 'thread_1',
      runId: 'run_1',
      status: 'running'
    });

    const done = reduceAppState(running, {
      type: 'run_done',
      threadId: 'thread_1',
      runId: 'run_2'
    });

    expect(done.activeRunByThreadId.thread_1).toBe('run_1');
  });
});
