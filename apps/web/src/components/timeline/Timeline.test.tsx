import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from './Timeline.js';
import type { TimelineItem } from './timeline-model.js';

describe('Timeline', () => {
  it('renders user and final assistant messages while folding completed run process', () => {
    const items: TimelineItem[] = [
      {
        kind: 'user_message',
        id: 'user_1',
        text: 'please inspect the run',
        content: '{"type":"user_message","text":"please inspect the run"}',
        source: 'runtime'
      },
      {
        kind: 'run_status',
        id: 'status_queued',
        runId: 'run_1',
        label: 'queued',
        source: 'runtime'
      },
      {
        kind: 'run_status',
        id: 'status_running',
        runId: 'run_1',
        label: 'running',
        source: 'runtime'
      },
      {
        kind: 'reasoning_summary',
        id: 'reasoning_1',
        runId: 'run_1',
        text: '我会先确认日志里有没有失败信息。\n\n然后根据结果给出结论。',
        source: 'runtime'
      },
      {
        kind: 'assistant_message',
        id: 'assistant_1',
        runId: 'run_1',
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
        runId: 'run_1',
        status: 'succeeded',
        terminationReason: 'completed',
        content: '{"type":"done","status":"succeeded","terminationReason":"completed"}',
        source: 'runtime'
      }
    ];

    const { container } = render(<Timeline items={items} />);

    expect(screen.getByText('please inspect the run')).toBeInTheDocument();
    expect(screen.getByText('I am checking the logs')).toBeInTheDocument();
    expect(screen.getByText('Clawee')).toBeInTheDocument();
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
    expect(screen.queryByText('Mock Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('{"type":"user_message","text":"please inspect the run"}')).not.toBeInTheDocument();
    expect(screen.queryByText('{"type":"assistant_message","text":"I am checking the logs"}')).not.toBeInTheDocument();
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');
    expect(screen.queryByText('运行 running')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('排队中')).not.toBeInTheDocument();
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();
    expect(screen.getByText('我会先确认日志里有没有失败信息。')).toBeInTheDocument();
    expect(screen.getByText('然后根据结果给出结论。')).toBeInTheDocument();
    expect(screen.getByText('使用工具 exec_command')).toBeInTheDocument();
    expect(
      screen.queryByText('{"type":"tool_use","toolCallId":"call_1","name":"exec_command","input":{"command":"pnpm test"}}')
    ).not.toBeInTheDocument();
    expect(screen.getByText('工具完成 call_1')).toBeInTheDocument();
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
    expect(
      screen.queryByText('{"type":"status","label":"running","threadId":"thread_1","codexThreadId":"codex_thread_1"}')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('完成')).not.toBeInTheDocument();
    expect(screen.queryByText('{"type":"done","status":"succeeded","terminationReason":"completed"}')).not.toBeInTheDocument();
  });

  it('renders a thinking indicator for status-only active runs', () => {
    const { container } = render(
      <Timeline
        items={[
          {
            kind: 'run_status',
            id: 'status_running',
            runId: 'run_1',
            label: 'running',
            source: 'runtime'
          }
        ]}
      />
    );

    expect(container.querySelector('.timeline-process')).toBeInTheDocument();
    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();
  });

  it('keeps an active process with visible reasoning expanded until completion', () => {
    const { container } = render(
      <Timeline
        items={[
          {
            kind: 'run_status',
            id: 'status_running',
            runId: 'run_1',
            label: 'running',
            source: 'runtime'
          },
          {
            kind: 'reasoning_summary',
            id: 'reasoning_1',
            runId: 'run_1',
            text: '我会读取上下文再执行任务。',
            source: 'runtime'
          }
        ]}
      />
    );

    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(screen.getByText('我会读取上下文再执行任务。')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).toHaveAttribute('open');
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();
  });

  it('does not render an empty process block when a run has only status and done events', () => {
    const items: TimelineItem[] = [
      {
        kind: 'user_message',
        id: 'user_1',
        text: '只回复 OK',
        content: '{"type":"user_message","text":"只回复 OK"}',
        source: 'runtime'
      },
      {
        kind: 'run_status',
        id: 'status_queued',
        runId: 'run_1',
        label: 'queued',
        source: 'runtime'
      },
      {
        kind: 'run_status',
        id: 'status_running',
        runId: 'run_1',
        label: 'running',
        source: 'runtime'
      },
      {
        kind: 'assistant_message',
        id: 'assistant_1',
        runId: 'run_1',
        text: 'OK',
        content: '{"type":"assistant_message","text":"OK"}',
        source: 'runtime'
      },
      {
        kind: 'run_status',
        id: 'status_finalizing',
        runId: 'run_1',
        label: 'finalizing',
        source: 'runtime'
      },
      {
        kind: 'done',
        id: 'done_1',
        runId: 'run_1',
        status: 'succeeded',
        terminationReason: 'completed',
        content: '{"type":"done","status":"succeeded","terminationReason":"completed"}',
        source: 'runtime'
      }
    ];

    const { container } = render(<Timeline items={items} onOpenRunDetail={vi.fn()} />);

    expect(screen.getByText('只回复 OK')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process')).not.toBeInTheDocument();
    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.queryByText('运行详情')).not.toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('finalizing')).not.toBeInTheDocument();
  });

  it('folds intermediate Codex agent messages into the run process and leaves only the final answer as Clawee reply', () => {
    const items: TimelineItem[] = [
      {
        kind: 'user_message',
        id: 'user_1',
        text: '检查当前目录并总结结果',
        source: 'runtime'
      },
      {
        kind: 'run_status',
        id: 'status_running',
        runId: 'run_1',
        label: 'running',
        source: 'runtime'
      },
      {
        kind: 'assistant_message',
        id: 'assistant_process_1',
        runId: 'run_1',
        text: '我会先确认当前目录，再读取相关文件做判断。',
        source: 'runtime'
      },
      {
        kind: 'tool_step',
        id: 'tool_use_1',
        runId: 'run_1',
        name: 'command_execution',
        content: '{"type":"tool_use","toolCallId":"call_1","name":"command_execution","input":{"command":"pwd"}}',
        source: 'runtime'
      },
      {
        kind: 'tool_step',
        id: 'tool_result_1',
        runId: 'run_1',
        name: 'call_1',
        content: '{"type":"tool_result","toolCallId":"call_1","output":"/repo","exitCode":0,"isError":false}',
        source: 'runtime'
      },
      {
        kind: 'assistant_message',
        id: 'assistant_final',
        runId: 'run_1',
        text: '当前目录是 /repo，检查已完成。',
        source: 'runtime'
      },
      {
        kind: 'done',
        id: 'done_1',
        runId: 'run_1',
        status: 'succeeded',
        terminationReason: 'completed',
        content: '{"type":"done","status":"succeeded","terminationReason":"completed"}',
        source: 'runtime'
      }
    ];

    const { container } = render(<Timeline items={items} />);

    expect(screen.getByText('检查当前目录并总结结果')).toBeInTheDocument();
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    expect(screen.getByText('我会先确认当前目录，再读取相关文件做判断。')).toBeInTheDocument();
    expect(screen.getByText('使用工具 command_execution')).toBeInTheDocument();
    expect(screen.getByText('工具完成 call_1')).toBeInTheDocument();
    expect(screen.getByText('当前目录是 /repo，检查已完成。')).toBeInTheDocument();
    expect(container.querySelectorAll('.timeline-assistant_message')).toHaveLength(1);
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');
  });

  it('renders reasoning summaries as the main process content', () => {
    render(
      <Timeline
        items={[
          {
            kind: 'run_status',
            id: 'status_running',
            runId: 'run_1',
            label: 'running',
            source: 'runtime'
          },
          {
            kind: 'reasoning_summary',
            id: 'reasoning_1',
            runId: 'run_1',
            text: '我先读取用户要求和工作区状态。\n\n然后调用本地工具完成任务。',
            source: 'runtime'
          }
        ]}
      />
    );

    expect(screen.getByText('我先读取用户要求和工作区状态。')).toBeInTheDocument();
    expect(screen.getByText('然后调用本地工具完成任务。')).toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();
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

    const reviewButton = screen.getByRole('button', {
      name: '审查 Edited timeline model apps/web/src/components/timeline/timeline-model.ts'
    });

    expect(reviewButton).toHaveAttribute(
      'aria-label',
      '审查 Edited timeline model apps/web/src/components/timeline/timeline-model.ts'
    );

    await user.click(reviewButton);

    expect(onOpenChange).toHaveBeenCalledWith('change_1');
  });

  it('opens run detail from the process block with a labeled target', async () => {
    const user = userEvent.setup();
    const onOpenRunDetail = vi.fn();
    const items: TimelineItem[] = [
      {
        kind: 'run_status',
        id: 'status_1',
        runId: 'run_1',
        label: 'running',
        source: 'runtime'
      },
      {
        kind: 'reasoning_summary',
        id: 'reasoning_1',
        runId: 'run_1',
        text: '我会先整理可见过程。',
        source: 'runtime'
      }
    ];

    render(<Timeline items={items} onOpenRunDetail={onOpenRunDetail} />);

    const runDetailButton = screen.getByRole('button', { name: '查看运行详情 run_1' });

    expect(runDetailButton).toHaveAttribute('aria-label', '查看运行详情 run_1');
    expect(screen.queryByText('查看 Run 详情')).not.toBeInTheDocument();

    await user.click(runDetailButton);

    expect(onOpenRunDetail).toHaveBeenCalledWith('run_1');
  });

  it('renders the Clawee empty state', () => {
    render(<Timeline items={[]} />);

    expect(screen.getByText('暂无任务记录')).toBeInTheDocument();
    expect(screen.getByText('发送任务后，Clawee 会在这里展示处理过程和结果。')).toBeInTheDocument();
  });
});
