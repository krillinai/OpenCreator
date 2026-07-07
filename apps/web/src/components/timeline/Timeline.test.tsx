import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from './Timeline.js';
import type { TimelineItem } from './timeline-model.js';

describe('Timeline', () => {
  it('renders key fields for every timeline event variant', () => {
    const items: TimelineItem[] = [
      {
        kind: 'user_message',
        id: 'user_1',
        text: 'please inspect the run',
        content: '{"type":"user_message","text":"please inspect the run"}',
        source: 'runtime'
      },
      {
        kind: 'assistant_message',
        id: 'assistant_1',
        text: 'I am checking the logs',
        content: '{"type":"assistant_message","text":"I am checking the logs"}',
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
    expect(screen.getByText('Clawee')).toBeInTheDocument();
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
    expect(screen.queryByText('Mock Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('{"type":"user_message","text":"please inspect the run"}')).not.toBeInTheDocument();
    expect(screen.queryByText('{"type":"assistant_message","text":"I am checking the logs"}')).not.toBeInTheDocument();
    expect(screen.getByText('exec_command')).toBeInTheDocument();
    expect(
      screen.queryByText('{"type":"tool_use","toolCallId":"call_1","name":"exec_command","input":{"command":"pnpm test"}}')
    ).not.toBeInTheDocument();
    expect(screen.getByText('call_1')).toBeInTheDocument();
    expect(
      screen.queryByText('{"type":"tool_result","toolCallId":"call_1","output":"test output","exitCode":0,"isError":false}')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Edited timeline model')).toBeInTheDocument();
    expect(screen.getByText('apps/web/src/components/timeline/timeline-model.ts')).toBeInTheDocument();
    expect(screen.getByText('+12 -3')).toBeInTheDocument();
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
      screen.queryByText('{"type":"status","label":"running","threadId":"thread_1","codexThreadId":"codex_thread_1"}')
    ).not.toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.queryByText('{"type":"done","status":"succeeded","terminationReason":"completed"}')).not.toBeInTheDocument();
  });

  it('opens a change card for review', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const items: TimelineItem[] = [
      {
        kind: 'change_card',
        id: 'change_1',
        title: 'Edited timeline model',
        path: 'apps/web/src/components/timeline/timeline-model.ts',
        delta: '+12 -3',
        source: 'mock'
      }
    ];

    render(<Timeline items={items} onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole('button', { name: '审查' }));

    expect(onOpenChange).toHaveBeenCalledWith('change_1');
  });

  it('uses the Clawee run detail copy', () => {
    const items: TimelineItem[] = [
      {
        kind: 'assistant_message',
        id: 'assistant_1',
        runId: 'run_1',
        text: 'I am checking the logs',
        source: 'runtime'
      }
    ];

    render(<Timeline items={items} onOpenRunDetail={vi.fn()} />);

    expect(screen.getByRole('button', { name: '查看运行详情' })).toBeInTheDocument();
    expect(screen.queryByText('查看 Run 详情')).not.toBeInTheDocument();
  });

  it('renders the Clawee empty state', () => {
    render(<Timeline items={[]} />);

    expect(screen.getByText('暂无任务记录')).toBeInTheDocument();
    expect(screen.getByText('发送任务后，Clawee 会在这里展示处理过程和结果。')).toBeInTheDocument();
  });
});
