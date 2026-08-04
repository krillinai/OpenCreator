import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConnectionsPage } from './ConnectionsPage.js';

describe('ConnectionsPage', () => {
  it('shows system connections and supports permission requests', async () => {
    const user = userEvent.setup();
    render(<ConnectionsPage />);

    expect(screen.getByRole('heading', { name: '系统连接' })).toBeInTheDocument();
    for (const name of ['飞书', '小红书', '抖音', '巨量引擎', '企查查', '蝉妈妈']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(screen.queryByText('Salesforce')).not.toBeInTheDocument();
    expect(screen.queryByText('SAP S/4HANA')).not.toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: '申请权限' });
    await user.click(buttons[0]!);
    expect(screen.getByRole('button', { name: '申请已提交' })).toBeDisabled();
  });
});
