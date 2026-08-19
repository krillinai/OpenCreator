import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SettingsView } from './SettingsView.js';

describe('SettingsView', () => {
  it('re-exports the OpenCreator settings view for compatibility', () => {
    render(<SettingsView runtimeStatus={{ connected: false }} onBack={() => undefined} />);

    expect(screen.getByRole('button', { name: '返回应用' })).toBeInTheDocument();
    expect(screen.getByText('默认权限')).toBeInTheDocument();
  });
});
