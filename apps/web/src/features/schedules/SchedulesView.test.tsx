import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SchedulesView } from './SchedulesView.js';

describe('SchedulesView', () => {
  it('shows workspace-write risk copy', () => {
    render(<SchedulesView connected schedules={[]} />);
    expect(screen.getByText('计划任务默认使用 workspace-write，可能在无人值守时修改工作区。')).toBeInTheDocument();
  });
});
