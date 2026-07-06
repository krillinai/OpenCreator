import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Timeline } from './Timeline.js';
import type { TimelineItem } from './timeline-model.js';

describe('Timeline', () => {
  it('renders key fields for every timeline event variant', () => {
    const items: TimelineItem[] = [
      {
        kind: 'user_message',
        id: 'user_1',
        text: 'please inspect the run',
        source: 'runtime'
      },
      {
        kind: 'assistant_message',
        id: 'assistant_1',
        text: 'I am checking the logs',
        source: 'runtime'
      },
      {
        kind: 'tool_step',
        id: 'tool_1',
        name: 'exec_command',
        content: '{"type":"tool_use","toolCallId":"call_1","name":"exec_command","input":{"command":"pnpm test"}}',
        source: 'runtime'
      },
      {
        kind: 'tool_step',
        id: 'tool_2',
        name: 'call_1',
        content: '{"type":"tool_result","toolCallId":"call_1","output":"test output","exitCode":0,"isError":false}',
        source: 'runtime'
      },
      {
        kind: 'change_card',
        id: 'change_1',
        title: 'Edited timeline model',
        path: 'apps/web/src/components/timeline/timeline-model.ts',
        delta: '+12 -3',
        source: 'mock'
      },
      {
        kind: 'diagnostic',
        id: 'diagnostic_1',
        severity: 'warning',
        message: 'stream resumed',
        content:
          '{"type":"diagnostic","code":"warn_1","severity":"warning","message":"stream resumed","details":{"source":"sse"}}',
        source: 'runtime'
      },
      {
        kind: 'diagnostic',
        id: 'error_1',
        severity: 'error',
        message: 'runtime failed',
        content: '{"type":"error","code":"runtime_error","message":"runtime failed","details":{"exitCode":1}}',
        source: 'runtime'
      },
      {
        kind: 'run_status',
        id: 'status_1',
        label: 'running',
        content: '{"type":"status","label":"running","threadId":"thread_1","codexThreadId":"codex_thread_1"}',
        source: 'runtime'
      },
      {
        kind: 'done',
        id: 'done_1',
        status: 'succeeded',
        terminationReason: 'completed',
        content: '{"type":"done","status":"succeeded","terminationReason":"completed"}',
        source: 'runtime'
      }
    ];

    render(<Timeline items={items} />);

    expect(screen.getByText('please inspect the run')).toBeInTheDocument();
    expect(screen.getByText('I am checking the logs')).toBeInTheDocument();
    expect(screen.getByText('exec_command')).toBeInTheDocument();
    expect(
      screen.getByText('{"type":"tool_use","toolCallId":"call_1","name":"exec_command","input":{"command":"pnpm test"}}')
    ).toBeInTheDocument();
    expect(screen.getByText('call_1')).toBeInTheDocument();
    expect(
      screen.getByText('{"type":"tool_result","toolCallId":"call_1","output":"test output","exitCode":0,"isError":false}')
    ).toBeInTheDocument();
    expect(screen.getByText('Edited timeline model')).toBeInTheDocument();
    expect(screen.getByText('apps/web/src/components/timeline/timeline-model.ts +12 -3')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('stream resumed')).toBeInTheDocument();
    expect(
      screen.getByText(
        '{"type":"diagnostic","code":"warn_1","severity":"warning","message":"stream resumed","details":{"source":"sse"}}'
      )
    ).toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('runtime failed')).toBeInTheDocument();
    expect(
      screen.getByText('{"type":"error","code":"runtime_error","message":"runtime failed","details":{"exitCode":1}}')
    ).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(
      screen.getByText('{"type":"status","label":"running","threadId":"thread_1","codexThreadId":"codex_thread_1"}')
    ).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('{"type":"done","status":"succeeded","terminationReason":"completed"}')).toBeInTheDocument();
  });
});
