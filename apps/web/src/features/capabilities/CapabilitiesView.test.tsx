import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CapabilitiesView } from './CapabilitiesView.js';

describe('CapabilitiesView', () => {
  it('shows a runtime connection prompt when disconnected', () => {
    render(<CapabilitiesView connected={false} />);

    expect(screen.getByText('连接 Runtime 后查看 Skills、MCP 和 Profiles')).toBeInTheDocument();
  });
});
