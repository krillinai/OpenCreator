import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { EnterpriseSessionResponse } from '@clawee/protocol';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import { EnterpriseAccountPage } from './EnterpriseAccountPage-2026-07-30.js';

const signedOutSession: EnterpriseSessionResponse = {
  status: 'signed_out',
  transportSecurity: 'secure_https'
};

describe('EnterpriseAccountPage', () => {
  it('clears passwords on mode change, signed-in success, and unmount', async () => {
    const user = userEvent.setup();
    const view = renderAccount();

    const loginPassword = screen.getByLabelText('密码') as HTMLInputElement;
    await user.type(loginPassword, 'login-secret');
    await user.click(screen.getByRole('button', { name: '注册' }));

    expect(loginPassword.value).toBe('');
    const registerPassword = screen.getByLabelText('密码') as HTMLInputElement;
    expect(registerPassword).toHaveValue('');
    await user.type(registerPassword, 'register-secret');

    view.rerender(createAccount({
      session: {
        status: 'signed_in',
        account: { subjectId: 'acct-member', email: 'member@example.com', name: 'Member' },
        expiresAt: '2026-08-30T12:00:00.000Z',
        transportSecurity: 'secure_https'
      }
    }));

    expect(registerPassword.value).toBe('');
    expect(screen.getByText('Member')).toBeInTheDocument();

    view.rerender(createAccount());
    const unmountPassword = screen.getByLabelText('密码') as HTMLInputElement;
    await user.type(unmountPassword, 'unmount-secret');
    view.unmount();

    expect(unmountPassword.value).toBe('');
  });

  it('switches registered users back to login without retaining password', async () => {
    const user = userEvent.setup();
    const onRegister = vi.fn(async () => {
      throw new ApiClientError({
        status: 409,
        code: 'ENTERPRISE_REGISTERED_LOGIN_REQUIRED',
        message: 'Account created; login required',
        details: { email: 'normalized@example.com' }
      });
    });
    renderAccount({ onRegister });

    await user.click(screen.getByRole('button', { name: '注册' }));
    await user.type(screen.getByLabelText('名称'), 'New Member');
    await user.type(screen.getByLabelText('邮箱'), ' Normalized@Example.com ');
    await user.type(screen.getByLabelText('密码'), 'register-secret');
    await user.type(screen.getByLabelText('确认密码'), 'register-secret');
    await user.click(screen.getByRole('button', { name: '创建账户并登录' }));

    expect(await screen.findByText('账户已创建，请使用该邮箱登录。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '登录', pressed: true })).toBeInTheDocument();
    expect(screen.getByLabelText('邮箱')).toHaveValue('normalized@example.com');
    expect(screen.getByLabelText('密码')).toHaveValue('');
  });

  it('renders a compact account entry without page chrome or transport warnings', () => {
    renderAccount({
      session: {
        status: 'signed_out',
        transportSecurity: 'insecure_http'
      }
    });

    expect(screen.getByRole('heading', { name: '登录企业账户' })).toBeInTheDocument();
    expect(screen.queryByText('Clawee Enterprise')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '企业账户' })).not.toBeInTheDocument();
    expect(screen.queryByText(/本地 Runtime/)).not.toBeInTheDocument();
    expect(screen.queryByText(/未加密的 HTTP/)).not.toBeInTheDocument();
  });

  it('renders checking, offline, and signed-in session states with explicit actions', () => {
    const view = renderAccount({
      session: {
        status: 'checking',
        transportSecurity: 'secure_https'
      },
      checkingTimedOut: true
    });

    expect(screen.getByText('正在验证企业会话')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新检测' })).toBeInTheDocument();

    view.rerender(createAccount({
      session: {
        status: 'service_unavailable',
        account: { subjectId: 'acct-member', email: 'member@example.com', name: 'Member' },
        reason: 'service_unavailable',
        transportSecurity: 'secure_https'
      }
    }));

    expect(screen.getByText('企业服务暂时不可用')).toBeInTheDocument();
    expect(screen.getByText('member@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试连接' })).toBeInTheDocument();

    view.rerender(createAccount({
      session: {
        status: 'signed_in',
        account: { subjectId: 'acct-member', email: 'member@example.com', name: 'Member' },
        expiresAt: '2026-08-30T12:00:00.000Z',
        transportSecurity: 'secure_https'
      }
    }));

    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();
  });
});

function renderAccount(
  overrides: Partial<Parameters<typeof createAccount>[0]> = {}
) {
  return render(createAccount(overrides));
}

function createAccount(
  overrides: {
    session?: EnterpriseSessionResponse;
    checkingTimedOut?: boolean;
    onRegister?: () => Promise<EnterpriseSessionResponse>;
  } = {}
) {
  return (
    <EnterpriseAccountPage
      connected
      session={overrides.session ?? signedOutSession}
      checkingTimedOut={overrides.checkingTimedOut}
      onLogin={async () => signedOutSession}
      onRegister={overrides.onRegister ?? (async () => signedOutSession)}
      onLogout={async () => signedOutSession}
      onRefresh={async () => signedOutSession}
    />
  );
}
