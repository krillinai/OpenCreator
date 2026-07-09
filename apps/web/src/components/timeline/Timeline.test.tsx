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
    expect(screen.getByText('pnpm test')).toBeInTheDocument();
    expect(
      screen.queryByText('{"type":"tool_use","toolCallId":"call_1","name":"exec_command","input":{"command":"pnpm test"}}')
    ).not.toBeInTheDocument();
    expect(screen.getByText('工具完成 exec_command')).toBeInTheDocument();
    expect(screen.queryByText('工具完成 call_1')).not.toBeInTheDocument();
    expect(
      screen.queryByText('{"type":"tool_result","toolCallId":"call_1","output":"test output","exitCode":0,"isError":false}')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Edited timeline model')).toBeInTheDocument();
    expect(screen.getByText('apps/web/src/components/timeline/timeline-model.ts')).toBeInTheDocument();
    expect(screen.getByText('+12 -3')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('stream resumed')).toBeInTheDocument();
    expect(screen.getByText(/"code": "warn_1"/)).toBeInTheDocument();
    expect(screen.getByText(/"source": "sse"/)).toBeInTheDocument();
    expect(
      screen.queryByText(
        '{"type":"diagnostic","code":"warn_1","severity":"warning","message":"stream resumed","details":{"source":"sse"}}'
      )
    ).not.toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('runtime failed')).toBeInTheDocument();
    expect(screen.getByText(/"code": "runtime_error"/)).toBeInTheDocument();
    expect(screen.getByText(/"exitCode": 1/)).toBeInTheDocument();
    expect(
      screen.queryByText('{"type":"error","code":"runtime_error","message":"runtime failed","details":{"exitCode":1}}')
    ).not.toBeInTheDocument();
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
    expect(screen.getByText('等待 Clawee 返回过程...')).toBeInTheDocument();
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();
  });

  it('renders local request errors outside the thinking process', () => {
    const items: TimelineItem[] = [
      {
        kind: 'user_message',
        id: 'user_1',
        text: 'hello',
        source: 'runtime'
      },
      {
        kind: 'diagnostic',
        id: 'runtime_error_1',
        severity: 'error',
        message: 'Failed to fetch',
        content: 'Failed to fetch',
        source: 'runtime'
      }
    ];

    const { container } = render(<Timeline items={items} />);

    expect(screen.getByText('hello')).toBeInTheDocument();
    expect(screen.getByText('处理过程')).toBeInTheDocument();
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.queryByText('思考过程')).not.toBeInTheDocument();
    expect(container.querySelector('.timeline-process')).not.toBeInTheDocument();
    expect(container.querySelector('.timeline-diagnostic')).toBeInTheDocument();
  });

  it('renders final assistant markdown without exposing syntax', () => {
    render(
      <Timeline
        items={[
          { kind: 'assistant_message', id: 'a1', text: '今天是 **29°C**。\n\n- 多喝水', source: 'runtime' }
        ]}
      />
    );

    expect(screen.getByText('29°C')).toHaveProperty('tagName', 'STRONG');
    expect(screen.getByText('多喝水')).toBeInTheDocument();
    expect(screen.queryByText('今天是 **29°C**。')).not.toBeInTheDocument();
  });

  it('keeps user messages conservative while still rendering code and safe links', () => {
    render(
      <Timeline
        items={[
          {
            kind: 'user_message',
            id: 'u1',
            text: '# 不要变标题\n1. 不要变列表\n`保留代码` [链接](https://example.com)',
            source: 'runtime'
          }
        ]}
      />
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText('# 不要变标题')).toBeInTheDocument();
    expect(screen.getByText('保留代码')).toHaveProperty('tagName', 'CODE');
    expect(screen.getByRole('link', { name: '链接' })).toHaveAttribute('href', 'https://example.com');
  });

  it('renders markdown inside process assistant messages', () => {
    render(
      <Timeline
        items={[
          { kind: 'run_status', id: 's1', runId: 'run_1', label: 'running', source: 'runtime' },
          { kind: 'assistant_message', id: 'a1', runId: 'run_1', text: '正在检查 **日志**', source: 'runtime' }
        ]}
      />
    );

    expect(screen.getByText('日志')).toHaveProperty('tagName', 'STRONG');
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

  it('keeps a completed status-only run process available for inspection', () => {
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
    expect(container.querySelector('.timeline-process')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    expect(screen.getByText('运行详情')).toBeInTheDocument();
    expect(screen.getByText('本次没有可展示的中间过程。')).toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('finalizing')).not.toBeInTheDocument();
  });

  it('renders failed status-only runs as visible process errors', () => {
    const items: TimelineItem[] = [
      {
        kind: 'run_status',
        id: 'status_running',
        runId: 'run_1',
        label: 'running',
        source: 'runtime'
      },
      {
        kind: 'done',
        id: 'done_failed',
        runId: 'run_1',
        status: 'failed',
        terminationReason: 'timeout',
        content: '{"type":"done","status":"failed","terminationReason":"timeout"}',
        source: 'runtime'
      }
    ];

    const { container } = render(<Timeline items={items} onOpenRunDetail={vi.fn()} />);

    expect(container.querySelector('.timeline-process')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).toHaveAttribute('open');
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    expect(screen.getByText('任务运行时间过长，已自动停止')).toBeInTheDocument();
    expect(screen.getByText('运行详情')).toBeInTheDocument();
  });

  it('renders readable timeout failure labels', () => {
    const reasons = [
      ['timeout', '任务运行时间过长，已自动停止'],
      ['inactivity_timeout', '任务长时间无响应，已自动停止'],
      ['spawn_timeout', 'Codex 启动超时']
    ] as const;

    for (const [terminationReason, label] of reasons) {
      const { unmount } = render(
        <Timeline
          items={[
            {
              kind: 'done',
              id: `done_${terminationReason}`,
              runId: `run_${terminationReason}`,
              status: 'failed',
              terminationReason,
              content: JSON.stringify({ type: 'done', status: 'failed', terminationReason }),
              source: 'runtime'
            }
          ]}
          onOpenRunDetail={vi.fn()}
        />
      );

      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('does not show opaque toolCallId in the main title when tool_use is missing', () => {
    render(
      <Timeline
        items={[
          {
            kind: 'tool_step',
            id: 'tool_result_only',
            runId: 'run_1',
            name: 'call_missing',
            content: '{"type":"tool_result","toolCallId":"call_missing","output":"done","isError":false}',
            source: 'runtime'
          }
        ]}
      />
    );

    expect(screen.getByText('工具完成')).toBeInTheDocument();
    expect(screen.queryByText('工具完成 call_missing')).not.toBeInTheDocument();
  });

  it('renders concrete exec command details without exposing raw tool JSON', () => {
    const content =
      '{"type":"tool_use","toolCallId":"call_1","name":"exec_command","input":{"cmd":"pnpm --filter @clawee/web test -- src/app/App.test.tsx"}}';

    render(
      <Timeline
        items={[
          {
            kind: 'tool_step',
            id: 'tool_use_1',
            runId: 'run_1',
            name: 'exec_command',
            content,
            source: 'runtime'
          }
        ]}
      />
    );

    expect(screen.getByText('使用工具 exec_command')).toBeInTheDocument();
    expect(screen.getByText('pnpm --filter @clawee/web test -- src/app/App.test.tsx')).toBeInTheDocument();
    expect(screen.queryByText(content)).not.toBeInTheDocument();
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
    expect(screen.getByText('pwd')).toBeInTheDocument();
    expect(screen.getByText('工具完成 command_execution')).toBeInTheDocument();
    expect(screen.queryByText('工具完成 call_1')).not.toBeInTheDocument();
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

  it('opens a file change card by path', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
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

    render(<Timeline items={items} onOpenFile={onOpenFile} />);

    const fileButton = screen.getByRole('button', {
      name: '打开文件 apps/web/src/components/timeline/timeline-model.ts'
    });

    expect(fileButton).toHaveAttribute(
      'aria-label',
      '打开文件 apps/web/src/components/timeline/timeline-model.ts'
    );

    await user.click(fileButton);

    expect(onOpenFile).toHaveBeenCalledWith('apps/web/src/components/timeline/timeline-model.ts');
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
