import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SharedDrivePage } from './SharedDrivePage.js';

describe('SharedDrivePage', () => {
  it('filters static shared files by search', async () => {
    const user = userEvent.setup();
    render(<SharedDrivePage />);
    expect(screen.getByText('KrillinAI 品牌视觉规范 2026.pdf')).toBeInTheDocument();
    expect(screen.queryByText('可口可乐品牌视觉规范 2026.pdf')).not.toBeInTheDocument();
    expect(screen.getByText('重点客户跟进清单.xlsx')).toBeInTheDocument();
    expect(screen.getAllByText('团队成员').length).toBeGreaterThan(0);
    expect(screen.queryByText('新员工快速入门手册.pdf')).not.toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: '企业网盘' }));
    expect(screen.getAllByText('全体员工').length).toBeGreaterThan(0);
    await user.type(screen.getByRole('searchbox', { name: '搜索共享网盘' }), '入门手册');
    expect(screen.getByText('新员工快速入门手册.pdf')).toBeInTheDocument();
    expect(screen.queryByText('重点客户跟进清单.xlsx')).not.toBeInTheDocument();
  });
});
