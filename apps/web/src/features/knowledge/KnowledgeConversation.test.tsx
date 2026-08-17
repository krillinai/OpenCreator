import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeConversation } from './KnowledgeConversation.js';

vi.mock('../../components/timeline/Timeline.js', () => ({
  Timeline: (props: { items: Array<{ text?: string }> }) => (
    <div>{props.items.map(item => item.text).filter(Boolean).join('\n')}</div>
  )
}));

describe('KnowledgeConversation', () => {
  it('renders the shared conversation timeline', () => {
    render(
      <KnowledgeConversation
        items={[{
          kind: 'assistant_message',
          id: 'assistant-1',
          runId: 'run-1',
          text: '这是知识库中的答案',
          source: 'runtime'
        }]}
        onSend={vi.fn()}
      />
    );

    expect(screen.getByText('这是知识库中的答案')).toBeInTheDocument();
  });

  it('submits prompts through the shared composer', async () => {
    const onSend = vi.fn().mockResolvedValue(undefined);
    render(<KnowledgeConversation items={[]} onSend={onSend} />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: '查询报销制度' } });
    fireEvent.click(screen.getByRole('button', { name: /发送/ }));

    await waitFor(() => expect(onSend.mock.calls[0]?.[0]).toBe('查询报销制度'));
  });

  it('exposes shared skills and connectors from the add menu', () => {
    render(
      <KnowledgeConversation
        items={[]}
        onSend={vi.fn()}
        slashCommands={[
          {
            id: 'skill:brainstorming',
            category: 'skill',
            label: 'brainstorming',
            description: '需求梳理',
            insertText: '$brainstorming '
          }
        ]}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '添加上下文' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '技能' }));
    expect(screen.getByRole('menuitem', { name: /brainstorming/ })).toBeInTheDocument();
  });
});
