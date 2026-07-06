import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Timeline } from './Timeline.js';
import type { TimelineItem } from './timeline-model.js';

describe('Timeline', () => {
  it('renders key fields for timeline event variants', () => {
    const items: TimelineItem[] = [
      {
        kind: 'tool_step',
        id: 'tool_1',
        name: 'exec_command',
        content: 'pnpm test',
        source: 'runtime'
      },
      {
        kind: 'run_status',
        id: 'status_1',
        label: 'running',
        content: '{"type":"usage","inputTokens":12}',
        source: 'runtime'
      },
      {
        kind: 'done',
        id: 'done_1',
        status: 'succeeded',
        source: 'runtime'
      }
    ];

    render(<Timeline items={items} />);

    expect(screen.getByText('exec_command')).toBeInTheDocument();
    expect(screen.getByText('pnpm test')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
    expect(screen.getByText('{"type":"usage","inputTokens":12}')).toBeInTheDocument();
    expect(screen.getByText('succeeded')).toBeInTheDocument();
  });
});
