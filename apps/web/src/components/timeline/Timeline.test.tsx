import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from './Timeline.js';
import type { TimelineItem } from './timeline-model.js';

vi.mock('react-virtuoso', async () => import('../../test/react-virtuoso-mock.js'));

describe('Timeline', () => {
  it('renders and targets a public schedule trigger without exposing execution rules', () => {
    const { container } = render(
      <Timeline
        items={[{
          kind: 'schedule_trigger',
          id: 'schedule-trigger-1',
          runId: 'run_schedule',
          prompt: '生成每日项目摘要',
          triggeredAt: '2026-07-14T14:05:00.000Z',
          source: 'runtime'
        }]}
        targetRunId="run_schedule"
      />
    );

    expect(screen.getByText('定时执行')).toBeInTheDocument();
    expect(screen.getByText('生成每日项目摘要')).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
    expect(screen.queryByText(/立即完成本次任务/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-search-target="true"]')).toHaveTextContent(
      '生成每日项目摘要'
    );
  });

  it('renders a runtime approval and forwards the decision', async () => {
    const user = userEvent.setup();
    const onApproveApproval = vi.fn();
    const onRejectApproval = vi.fn();

    const { container } = render(
      <Timeline
        items={[{
          kind: 'approval',
          id: 'event_approval_1',
          runId: 'run_1',
          approval: {
            id: 'approval_1',
            runId: 'run_1',
            threadId: 'thread_1',
            turnId: 'turn_1',
            itemId: 'item_1',
            requestId: 'rpc_1',
            kind: 'command_execution',
            status: 'pending',
            risk: 'high',
            title: '允许执行命令',
            summary: '删除构建目录',
            details: { command: 'rm -rf build', cwd: '/workspace' },
            requestedAt: '2026-07-12T10:00:00.000Z',
            expiresAt: '2026-07-12T10:10:00.000Z'
          },
          source: 'runtime'
        }]}
        targetApprovalId="approval_1"
        onApproveApproval={onApproveApproval}
        onRejectApproval={onRejectApproval}
      />
    );

    expect(screen.getByText('需要确认')).toBeInTheDocument();
    expect(screen.getByText('rm -rf build')).toBeInTheDocument();
    expect(document.querySelector('.timeline-end-spacer')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '批准' }));

    expect(onApproveApproval).toHaveBeenCalledWith('approval_1');
    expect(container.querySelector('[data-search-target="true"]')).toHaveTextContent(
      '允许执行命令'
    );
  });

  it('keeps a pending approval fully above the composer safety area', async () => {
    render(
      <Timeline
        items={[{
          kind: 'approval',
          id: 'event_approval_visible',
          runId: 'run_visible',
          approval: {
            id: 'approval_visible',
            runId: 'run_visible',
            threadId: 'thread_visible',
            turnId: 'turn_visible',
            itemId: 'item_visible',
            requestId: 'rpc_visible',
            kind: 'command_execution',
            status: 'pending',
            risk: 'high',
            title: '允许执行命令',
            summary: '运行较长命令',
            details: {
              command: 'pnpm test --filter web && pnpm build --filter desktop',
              cwd: '/workspace'
            },
            requestedAt: '2026-07-24T10:00:00.000Z',
            expiresAt: '2026-07-24T10:10:00.000Z'
          },
          source: 'runtime'
        }]}
      />
    );

    const scroller = screen.getByTestId('virtuoso-scroller');
    await waitFor(() => expect(scroller.scrollTop).toBeGreaterThanOrEqual(96));
  });

  it.each(['approved', 'rejected', 'expired', 'canceled'] as const)(
    'hides %s approval cards after they are resolved',
    (status) => {
      render(
        <Timeline
          items={[{
            kind: 'approval',
            id: `event_approval_${status}`,
            runId: 'run_resolved',
            approval: {
              id: `approval_${status}`,
              runId: 'run_resolved',
              threadId: 'thread_resolved',
              turnId: 'turn_resolved',
              itemId: 'item_resolved',
              requestId: 'rpc_resolved',
              kind: 'command_execution',
              status,
              risk: 'high',
              title: '已处理的审批',
              summary: '不应继续显示',
              details: { command: 'pnpm test', cwd: '/workspace' },
              requestedAt: '2026-07-24T10:00:00.000Z',
              expiresAt: '2026-07-24T10:10:00.000Z'
            },
            source: 'runtime'
          }]}
        />
      );

      expect(screen.queryByText('已处理的审批')).not.toBeInTheDocument();
      expect(screen.queryByText('不应继续显示')).not.toBeInTheDocument();
    }
  );

  it('renders image metadata and a local preview with the user message', () => {
    render(
      <Timeline
        items={[
          {
            kind: 'user_message',
            id: 'user_with_image',
            text: '描述图片',
            attachments: [{
              id: 'attachment_1',
              fileName: 'screen.png',
              mime: 'image/png',
              size: 2048,
              sha256: 'a'.repeat(64),
              storageKey: 'at/attachment_1.bin',
              threadId: 'thread_1',
              runId: 'run_1',
              status: 'committed',
              createdAt: '2026-07-12T00:00:00.000Z',
              updatedAt: '2026-07-12T00:00:00.000Z'
            }],
            attachmentPreviewUrls: {
              attachment_1: 'blob:screen.png'
            },
            source: 'runtime'
          }
        ]}
      />
    );

    expect(screen.getByRole('img', { name: 'screen.png' })).toHaveAttribute(
      'src',
      'blob:screen.png'
    );
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    expect(screen.getByText('描述图片')).toBeInTheDocument();
  });

  it('copies and edits a user message from its action row', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText }
    });
    const onEditUserMessage = vi.fn();
    const item: Extract<TimelineItem, { kind: 'user_message' }> = {
      kind: 'user_message',
      id: 'user_actions',
      timestamp: '2026-07-25T12:09:00.000Z',
      text: '重新整理这段需求',
      source: 'runtime'
    };

    render(
      <Timeline
        items={[item]}
        onEditUserMessage={onEditUserMessage}
      />
    );

    const message = screen.getByText('重新整理这段需求').closest('.timeline-user_message');
    const bubble = message?.querySelector<HTMLElement>('.timeline-bubble') ?? null;
    const meta = message?.querySelector<HTMLElement>('.timeline-message-meta') ?? null;
    expect(meta).toBeInTheDocument();
    expect(bubble).not.toContainElement(meta);
    expect(meta?.querySelector('time')).toHaveAttribute('datetime', item.timestamp);

    await user.click(screen.getByRole('button', { name: '复制消息' }));
    expect(writeText).toHaveBeenCalledWith('重新整理这段需求');
    expect(await screen.findByRole('button', { name: '已复制消息' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '编辑消息' }));
    expect(onEditUserMessage).toHaveBeenCalledWith(item);
  });

  it('marks the virtual item that contains a search target', () => {
    const items: TimelineItem[] = [
      {
        kind: 'user_message',
        id: 'message-before',
        text: '前一条',
        source: 'runtime'
      },
      {
        kind: 'assistant_message',
        id: 'target-message',
        text: '目标回复',
        content: '{"type":"assistant_message","text":"目标回复"}',
        source: 'runtime'
      }
    ];

    const { container } = render(
      <Timeline items={items} targetItemId="target-message" />
    );

    expect(
      container.querySelector('[data-search-target="true"]')
    ).toHaveTextContent('目标回复');
  });

  it('marks the process block that matches a run target', () => {
    const items: TimelineItem[] = [
      {
        kind: 'assistant_message',
        id: 'run-message',
        runId: 'run-target',
        text: '目标运行结果',
        source: 'runtime'
      },
      {
        kind: 'done',
        id: 'run-done',
        runId: 'run-target',
        status: 'succeeded',
        content: '{"type":"done","status":"succeeded"}',
        source: 'runtime'
      }
    ];

    const { container } = render(
      <Timeline items={items} targetRunId="run-target" />
    );

    expect(
      container.querySelector('[data-search-target="true"]')
    ).toHaveTextContent('目标运行结果');
  });

  it('defers rendering completed process steps until the process is expanded', async () => {
    const user = userEvent.setup();
    const items: TimelineItem[] = [
      ...Array.from({ length: 50 }, (_, index): TimelineItem => ({
        kind: 'tool_step',
        id: `tool_${index}`,
        runId: 'run_large_history',
        name: 'exec_command',
        content: JSON.stringify({
          type: 'tool_use',
          toolCallId: `call_${index}`,
          name: 'exec_command',
          input: { command: `echo ${index}` }
        }),
        source: 'runtime'
      })),
      {
        kind: 'done',
        id: 'done_large_history',
        runId: 'run_large_history',
        status: 'succeeded',
        content: '{"type":"done","status":"succeeded"}',
        source: 'runtime'
      }
    ];

    const { container } = render(<Timeline items={items} />);

    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(container.querySelectorAll('.process-step')).toHaveLength(0);

    await user.click(screen.getByText('已完成'));

    expect(container.querySelectorAll('.process-step')).toHaveLength(1);
    expect(screen.getByText('正在执行本地命令（50 次）')).toBeInTheDocument();
    expect(screen.queryByText('echo 49')).not.toBeInTheDocument();
  });

  it('renders user and final assistant messages while folding completed run process', async () => {
    const user = userEvent.setup();
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
    expect(container.querySelector('.timeline-user_message .timeline-item-header')).not.toBeInTheDocument();
    expect(container.querySelector('.timeline-assistant_message .timeline-avatar-logo')).toBeInTheDocument();
    expect(container.querySelector('.timeline-assistant_message .timeline-avatar img')).not.toBeInTheDocument();
    expect(screen.queryByText('Codex')).not.toBeInTheDocument();
    expect(screen.queryByText('Mock Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('{"type":"user_message","text":"please inspect the run"}')).not.toBeInTheDocument();
    expect(screen.queryByText('{"type":"assistant_message","text":"I am checking the logs"}')).not.toBeInTheDocument();
    const processDetails = container.querySelector('.timeline-process details');
    const processSummary = processDetails?.querySelector('summary');
    expect(processSummary).toHaveTextContent('已完成');
    expect(processDetails).not.toHaveAttribute('open');
    expect(screen.queryByText('运行 running')).not.toBeInTheDocument();
    expect(screen.queryByText('running')).not.toBeInTheDocument();
    expect(screen.queryByText('queued')).not.toBeInTheDocument();
    expect(screen.queryByText('排队中')).not.toBeInTheDocument();
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();
    expect(screen.queryByText('我会先确认日志里有没有失败信息。')).not.toBeInTheDocument();

    await user.click(processSummary!);

    expect(screen.getByText('我会先确认日志里有没有失败信息。')).toBeInTheDocument();
    expect(screen.getByText('然后根据结果给出结论。')).toBeInTheDocument();
    expect(screen.queryByText('正在运行测试')).not.toBeInTheDocument();
    expect(screen.queryByText('pnpm test')).not.toBeInTheDocument();
    expect(
      screen.queryByText('{"type":"tool_use","toolCallId":"call_1","name":"exec_command","input":{"command":"pnpm test"}}')
    ).not.toBeInTheDocument();
    expect(screen.getByText('已完成：运行测试')).toBeInTheDocument();
    expect(screen.queryByText('工具完成 call_1')).not.toBeInTheDocument();
    expect(
      screen.queryByText('{"type":"tool_result","toolCallId":"call_1","output":"test output","exitCode":0,"isError":false}')
    ).not.toBeInTheDocument();
    expect(screen.getByText('Edited timeline model')).toBeInTheDocument();
    expect(screen.getByText('apps/web/src/components/timeline/timeline-model.ts')).toBeInTheDocument();
    expect(screen.getByText('+12 -3')).toBeInTheDocument();
    expect(screen.getByText('warning')).toBeInTheDocument();
    expect(screen.getByText('stream resumed')).toBeInTheDocument();
    expect(screen.queryByText(/"code": "warn_1"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"source": "sse"/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(
        '{"type":"diagnostic","code":"warn_1","severity":"warning","message":"stream resumed","details":{"source":"sse"}}'
      )
    ).not.toBeInTheDocument();
    expect(screen.getByText('error')).toBeInTheDocument();
    expect(screen.getByText('runtime failed')).toBeInTheDocument();
    expect(screen.queryByText(/"code": "runtime_error"/)).not.toBeInTheDocument();
    expect(screen.queryByText(/"exitCode": 1/)).not.toBeInTheDocument();
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
    expect(screen.getByText('思考中')).toBeInTheDocument();
    expect(screen.queryByText(/等待 Clawee 返回过程/)).not.toBeInTheDocument();
    expect(screen.queryByText(/当前动态/)).not.toBeInTheDocument();
    expect(screen.queryByText('运行详情')).not.toBeInTheDocument();
    expect(container.querySelector('.process-detail')).not.toBeInTheDocument();
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
    expect(screen.getByText('Failed to fetch')).toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
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

  it('opens generated workspace files linked from assistant text', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();

    render(
      <Timeline
        items={[
          {
            kind: 'assistant_message',
            id: 'a1',
            text: '已重新生成并写入 放假.md，也生成了 `docs/report.pdf`。',
            source: 'runtime'
          }
        ]}
        onOpenFile={onOpenFile}
      />
    );

    await user.click(screen.getByRole('link', { name: '放假.md' }));
    await user.click(screen.getByRole('link', { name: 'docs/report.pdf' }));

    expect(onOpenFile).toHaveBeenNthCalledWith(1, '放假.md');
    expect(onOpenFile).toHaveBeenNthCalledWith(2, 'docs/report.pdf');
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

    expect(screen.getByText('思考中')).toBeInTheDocument();
    expect(screen.getByText('我会读取上下文再执行任务。')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).toHaveAttribute('open');
    expect(screen.queryByText('处理中')).not.toBeInTheDocument();
  });

  it('keeps a user-collapsed active process closed after virtual remounts', async () => {
    const user = userEvent.setup();
    const activeItems: TimelineItem[] = [
      {
        kind: 'run_status',
        id: 'status_running',
        runId: 'run_persistent',
        label: 'running',
        source: 'runtime'
      },
      {
        kind: 'reasoning_summary',
        id: 'reasoning_persistent',
        runId: 'run_persistent',
        text: '正在检查项目文件。',
        source: 'runtime'
      }
    ];
    const fillerItems: TimelineItem[] = Array.from({ length: 31 }, (_, index) => ({
      kind: 'user_message',
      id: `filler_${index}`,
      text: `占位消息 ${index}`,
      source: 'runtime'
    }));
    const { container, rerender } = render(<Timeline items={activeItems} />);

    await user.click(screen.getByText('思考中'));
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');

    rerender(<Timeline items={[...activeItems, ...fillerItems]} />);
    expect(container.querySelector('.timeline-process')).not.toBeInTheDocument();

    rerender(<Timeline items={activeItems} />);
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');
  });

  it('keeps a completed status-only run process available for inspection', async () => {
    const user = userEvent.setup();
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

    const { container } = render(<Timeline items={items} />);

    expect(screen.getByText('只回复 OK')).toBeInTheDocument();
    expect(screen.getByText('OK')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).not.toHaveAttribute('open');
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.queryByText('正在思考')).not.toBeInTheDocument();
    await user.click(screen.getByText('已完成'));

    expect(screen.queryByText('运行详情')).not.toBeInTheDocument();
    expect(screen.queryByText('本次没有可展示的中间过程。')).not.toBeInTheDocument();
    expect(container.querySelector('.process-detail')).not.toBeInTheDocument();
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

    const { container } = render(<Timeline items={items} />);

    expect(container.querySelector('.timeline-process')).toBeInTheDocument();
    expect(container.querySelector('.timeline-process details')).toHaveAttribute('open');
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('任务运行时间过长，已自动停止')).toBeInTheDocument();
    expect(screen.queryByText('运行详情')).not.toBeInTheDocument();
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

    expect(screen.getByText('操作已完成')).toBeInTheDocument();
    expect(screen.queryByText('工具完成 call_missing')).not.toBeInTheDocument();
  });

  it('renders a plain Chinese activity without exposing raw commands or tool JSON', () => {
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

    expect(screen.getByText('正在运行测试')).toBeInTheDocument();
    expect(screen.queryByText('pnpm --filter @clawee/web test -- src/app/App.test.tsx')).not.toBeInTheDocument();
    expect(screen.queryByText(content)).not.toBeInTheDocument();
  });

  it('replaces matched tool uses with completed state and groups consecutive equal activities', () => {
    const items: TimelineItem[] = Array.from({ length: 3 }, (_, index) => [
      {
        kind: 'tool_step' as const,
        id: `tool_use_${index}`,
        runId: 'run_1',
        name: 'exec_command',
        content: JSON.stringify({
          type: 'tool_use',
          toolCallId: `call_${index}`,
          name: 'exec_command',
          input: { command: `echo ${index}` }
        }),
        source: 'runtime' as const
      },
      {
        kind: 'tool_step' as const,
        id: `tool_result_${index}`,
        runId: 'run_1',
        name: `call_${index}`,
        content: JSON.stringify({
          type: 'tool_result',
          toolCallId: `call_${index}`,
          output: String(index),
          exitCode: 0,
          isError: false
        }),
        source: 'runtime' as const
      }
    ]).flat();

    const { container } = render(<Timeline items={items} />);

    expect(screen.getByText('已完成：执行本地命令（3 次）')).toBeInTheDocument();
    expect(screen.queryByText('正在执行本地命令')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.process-step-tool_step')).toHaveLength(1);
  });

  it('folds intermediate Codex agent messages into the run process and leaves only the final answer as Clawee reply', async () => {
    const user = userEvent.setup();
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
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.queryByText('我会先确认当前目录，再读取相关文件做判断。')).not.toBeInTheDocument();

    await user.click(screen.getByText('已完成'));

    expect(screen.getByText('我会先确认当前目录，再读取相关文件做判断。')).toBeInTheDocument();
    expect(screen.queryByText('正在查看项目内容')).not.toBeInTheDocument();
    expect(screen.queryByText('pwd')).not.toBeInTheDocument();
    expect(screen.getByText('已完成：查看项目内容')).toBeInTheDocument();
    expect(screen.queryByText('工具完成 call_1')).not.toBeInTheDocument();
    expect(screen.getByText('当前目录是 /repo，检查已完成。')).toBeInTheDocument();
    expect(container.querySelectorAll('.timeline-assistant_message')).toHaveLength(1);
    expect(container.querySelector('.timeline-process details')).toHaveAttribute('open');
  });

  it('shows elapsed time for completed runs with timestamped events', () => {
    render(
      <Timeline
        items={[
          {
            kind: 'run_status',
            id: 'status_timed',
            runId: 'run_timed',
            timestamp: '2026-07-24T10:00:00.000Z',
            label: 'running',
            source: 'runtime'
          },
          {
            kind: 'done',
            id: 'done_timed',
            runId: 'run_timed',
            timestamp: '2026-07-24T10:01:05.000Z',
            status: 'succeeded',
            content: '{"type":"done","status":"succeeded"}',
            source: 'runtime'
          }
        ]}
      />
    );

    expect(screen.getByText('耗时 1分5秒')).toBeInTheDocument();
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

  it('does not expose run detail from the process block', () => {
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

    render(<Timeline items={items} />);

    expect(screen.queryByRole('button', { name: /查看运行详情/ })).not.toBeInTheDocument();
    expect(screen.queryByText('运行详情')).not.toBeInTheDocument();
  });

  it('keeps queued follow-ups out of the conversation timeline', () => {
    render(
      <Timeline
        items={[{
          kind: 'user_message',
          id: 'queued_message',
          text: '排队任务',
          runId: 'run_queued',
          runStatus: 'queued',
          submissionMode: 'interrupt_and_enqueue',
          queuePosition: 2,
          source: 'runtime'
        }]}
      />
    );

    expect(screen.queryByText('排队任务')).not.toBeInTheDocument();
  });

  it('keeps canceled follow-ups that never ran out of the conversation timeline', () => {
    render(
      <Timeline
        items={[{
          kind: 'user_message',
          id: 'canceled_queued_message',
          text: '已移除的等待任务',
          runId: 'run_canceled_queued',
          runStatus: 'canceled',
          submissionMode: 'enqueue',
          wasQueued: true,
          source: 'runtime'
        }]}
      />
    );

    expect(screen.queryByText('已移除的等待任务')).not.toBeInTheDocument();
  });

  it('groups consecutive file changes from the same run', async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    const items: TimelineItem[] = [
      {
        kind: 'change_card',
        id: 'change_1',
        runId: 'run_1',
        title: '修改 App.tsx',
        path: 'apps/web/src/app/App.tsx',
        delta: '1 项变更',
        source: 'runtime'
      },
      {
        kind: 'change_card',
        id: 'change_2',
        runId: 'run_1',
        title: '修改 Timeline.tsx',
        path: 'apps/web/src/components/timeline/Timeline.tsx',
        delta: '1 项变更',
        source: 'runtime'
      },
      {
        kind: 'change_card',
        id: 'change_3',
        runId: 'run_1',
        title: '再次修改 App.tsx',
        path: 'apps/web/src/app/App.tsx',
        delta: '1 项变更',
        source: 'runtime'
      }
    ];

    render(<Timeline items={items} onOpenFile={onOpenFile} />);

    expect(screen.getByText('3 次连续文件变更')).toBeInTheDocument();
    expect(screen.getByText('2 个文件')).toBeInTheDocument();
    expect(screen.queryByText('修改 App.tsx')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', {
      name: '打开文件 apps/web/src/app/App.tsx'
    }));

    expect(onOpenFile).toHaveBeenCalledWith('apps/web/src/app/App.tsx');
  });

  it('shows a new-content action when updates arrive while viewing older history', async () => {
    const user = userEvent.setup();
    const initialItems: TimelineItem[] = [
      {
        kind: 'user_message',
        id: 'history_1',
        text: '较早的内容',
        source: 'runtime'
      }
    ];
    const { rerender } = render(<Timeline items={initialItems} />);
    const scroller = screen.getByTestId('virtuoso-scroller');
    Object.defineProperties(scroller, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1200 }
    });

    fireEvent.scroll(scroller, { target: { scrollTop: 200 } });
    rerender(
      <Timeline
        items={[
          ...initialItems,
          {
            kind: 'assistant_message',
            id: 'latest_1',
            text: '刚刚到达的新内容',
            source: 'runtime'
          }
        ]}
      />
    );

    const newContentButton = await screen.findByRole('button', { name: '有新内容' });
    await user.click(newContentButton);

    expect(screen.queryByRole('button', { name: '有新内容' })).not.toBeInTheDocument();
  });

  it('renders the Clawee empty state', () => {
    render(<Timeline items={[]} />);

    expect(screen.getByText('暂无任务记录')).toBeInTheDocument();
    expect(screen.getByText('发送任务后，Clawee 会在这里展示处理过程和结果。')).toBeInTheDocument();
  });

  it('keeps long histories virtualized and exposes older-page loading', async () => {
    const user = userEvent.setup();
    const onLoadOlder = vi.fn(async () => undefined);
    const items = Array.from({ length: 379 }, (_, index): TimelineItem => ({
      kind: 'user_message',
      id: `history_${index}`,
      text: `历史消息 ${index}`,
      source: 'runtime'
    }));

    const { container } = render(
      <Timeline
        items={items}
        hasMore
        loadingOlder={false}
        onLoadOlder={onLoadOlder}
      />
    );

    expect(container.querySelectorAll('.timeline-item').length).toBeLessThan(80);

    await user.click(screen.getByRole('button', { name: '加载更早记录' }));

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('keeps the visible item anchored when prepending history changes a process block key', () => {
    const initialItems: TimelineItem[] = [
      {
        kind: 'tool_step',
        id: 'current_process_step',
        name: 'exec_command',
        content: '{"type":"tool_use","name":"exec_command","input":{"command":"pwd"}}',
        source: 'runtime'
      },
      {
        kind: 'user_message',
        id: 'current_user_message',
        text: '当前可见消息',
        source: 'runtime'
      }
    ];
    const { rerender } = render(<Timeline items={initialItems} />);
    const currentMessage = screen.getByText('当前可见消息').closest('[data-item-index]');

    expect(currentMessage).toHaveAttribute('data-item-index', '100001');

    rerender(
      <Timeline
        items={[
          {
            kind: 'user_message',
            id: 'older_user_message',
            text: '更早的消息',
            source: 'runtime'
          },
          {
            kind: 'tool_step',
            id: 'older_process_step',
            name: 'exec_command',
            content: '{"type":"tool_use","name":"exec_command","input":{"command":"ls"}}',
            source: 'runtime'
          },
          ...initialItems
        ]}
      />
    );

    expect(screen.getByText('当前可见消息').closest('[data-item-index]'))
      .toHaveAttribute('data-item-index', '100001');
  });
});
