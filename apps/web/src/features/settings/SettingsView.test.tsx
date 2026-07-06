import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsView } from './SettingsView.js';

describe('SettingsView', () => {
  it('requires cleanup preview before delete', () => {
    render(<SettingsView connected cleanupPreviewed={false} />);
    expect(screen.getByRole('button', { name: '确认清理' })).toBeDisabled();
  });

  it('enables cleanup after preview when connected', () => {
    render(<SettingsView connected cleanupPreviewed />);
    expect(screen.getByRole('button', { name: '确认清理' })).toBeEnabled();
  });

  it('keeps cleanup disabled after preview when disconnected', () => {
    render(<SettingsView connected={false} cleanupPreviewed />);
    expect(screen.getByRole('button', { name: '确认清理' })).toBeDisabled();
  });

  it('shows connected runtime status', () => {
    render(<SettingsView connected cleanupPreviewed={false} />);
    expect(screen.getByText('已连接 Runtime')).toBeInTheDocument();
  });

  it('shows disconnected runtime status', () => {
    render(<SettingsView connected={false} cleanupPreviewed={false} />);
    expect(screen.getByText('未连接 Runtime')).toBeInTheDocument();
  });
});
