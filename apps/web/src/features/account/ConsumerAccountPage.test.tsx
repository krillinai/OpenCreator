import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConsumerAccountPage } from './ConsumerAccountPage.js';
import { MOCK_CONSUMER_USER } from './consumer-user.js';

describe('ConsumerAccountPage', () => {
  it('offers login without blocking the guest workspace', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(<ConsumerAccountPage onLogin={onLogin} />);

    expect(screen.getByRole('heading', { name: '登录 OpenCreator' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '登录' }));
    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('renders the consumer profile after login', () => {
    render(<ConsumerAccountPage user={MOCK_CONSUMER_USER} />);

    expect(screen.getByRole('heading', { name: '林夏' })).toBeInTheDocument();
    expect(screen.getByText('linxia@opencreator.local')).toBeInTheDocument();
    expect(screen.getByText('已登录')).toBeInTheDocument();
  });
});
