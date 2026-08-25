import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CreatorAgentPanel from './CreatorAgentPanel.js';

describe('CreatorAgentPanel', () => {
  it('renders status activity and conversation as separate regions', () => {
    render(
      <CreatorAgentPanel
        title="OpenCreator"
        statusSummary="中文到英文"
        activities={[{
          id: 'activity_1',
          jobId: 'job_1',
          revision: 1,
          actor: 'user',
          action: 'update-settings',
          summary: '目标语言改为英文',
          details: {},
          createdAt: '2026-08-20T00:00:00.000Z'
        }]}
        turns={[{
          id: 'turn_1',
          jobId: 'job_1',
          role: 'assistant',
          content: '已读取最新状态',
          status: 'completed',
          audit: [],
          createdAt: '2026-08-20T00:00:01.000Z'
        }]}
        items={[{
          id: 'item_1',
          jobId: 'job_1',
          sessionId: 'session_1',
          turnId: 'turn_1',
          runtimeItemId: 'runtime_item_1',
          kind: 'tool_result',
          status: 'completed',
          toolName: 'creator_get_context',
          data: {},
          sequence: 1,
          createdAt: '2026-08-20T00:00:01.000Z',
          updatedAt: '2026-08-20T00:00:01.000Z'
        }]}
        approvals={[]}
      />
    );

    expect(screen.getByRole('region', { name: '当前创作状态' })).toHaveTextContent('中文到英文');
    expect(screen.getByRole('region', { name: '创作动态' })).toHaveTextContent('目标语言改为英文');
    expect(screen.getByRole('log', { name: '模型对话' })).toHaveTextContent('已读取最新状态');
    expect(screen.getByRole('log', { name: '模型对话' })).not.toHaveTextContent('目标语言改为英文');
    expect(screen.getByRole('region', { name: '执行详情' })).toHaveTextContent('creator_get_context');
  });

  it('does not allow an expired approval to be submitted again', () => {
    const onApproval = vi.fn();
    render(
      <CreatorAgentPanel
        title="OpenCreator"
        statusSummary="等待处理"
        activities={[]}
        turns={[]}
        items={[]}
        approvals={[{
          id: 'approval_1',
          jobId: 'job_1',
          sessionId: 'session_1',
          turnId: 'turn_1',
          itemId: 'item_1',
          runtimeRequestId: 'request_1',
          processGeneration: 6,
          kind: 'tool_call',
          status: 'expired',
          title: '写入字幕',
          summary: '修改字幕文件',
          details: {},
          requestedAt: '2026-08-21T00:00:00.000Z',
          expiresAt: '2026-08-21T00:01:00.000Z',
          resolvedAt: '2026-08-21T00:02:00.000Z',
          resolutionReason: 'process_generation_expired'
        }]}
        onApproval={onApproval}
      />
    );

    expect(screen.getByText('已过期，请重新执行')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '批准 写入字幕' })).not.toBeInTheDocument();
    expect(onApproval).not.toHaveBeenCalled();
  });
});
