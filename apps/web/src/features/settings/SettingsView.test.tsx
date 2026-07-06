import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsView } from './SettingsView.js';

describe('SettingsView', () => {
  it('requires cleanup preview before delete', () => {
    render(<SettingsView connected cleanupPreviewed={false} />);
    expect(screen.getByRole('button', { name: '确认清理' })).toBeDisabled();
  });
});
