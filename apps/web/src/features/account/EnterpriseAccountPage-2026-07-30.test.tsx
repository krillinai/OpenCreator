import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type {
  EnterpriseQrProvider,
  EnterpriseSessionResponse
} from '@clawee/protocol';
import { describe, expect, it, vi } from 'vitest';
import { EnterpriseAccountPage } from './EnterpriseAccountPage-2026-07-30.js';

const signedOutSession: EnterpriseSessionResponse = {
  status: 'signed_out',
  transportSecurity: 'secure_https'
};

describe('EnterpriseAccountPage', () => {
  it('supports the existing email login and registration flows', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn(async () => signedOutSession);
    const onRegister = vi.fn(async () => signedOutSession);
    renderAccount({ onLogin, onRegister });

    expect(screen.getByRole('heading', { name: '欢迎使用 Clawee' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '邮箱登录', selected: true }))
      .toBeInTheDocument();
    expect(screen.queryByText(/SSO/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('手机号')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('验证码')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('邮箱'), 'member@example.com');
    await user.type(screen.getByLabelText('密码'), 'password123');
    await user.click(screen.getByRole('checkbox'));
    await user.click(document.querySelector<HTMLButtonElement>('.enterprise-email-submit')!);
    expect(onLogin).toHaveBeenCalledWith({
      email: 'member@example.com',
      password: 'password123'
    });

    await user.click(screen.getByRole('button', { name: '注册', pressed: false }));
    await user.type(screen.getByLabelText('名称'), 'Enterprise Member');
    await user.type(screen.getByLabelText('密码'), 'register123');
    await user.type(screen.getByLabelText('确认密码'), 'register123');
    await user.click(document.querySelector<HTMLButtonElement>('.enterprise-email-submit')!);
    expect(onRegister).toHaveBeenCalledWith({
      email: 'member@example.com',
      name: 'Enterprise Member',
      password: 'register123'
    });
  });

  it('asks for agreement when login is submitted and continues after confirmation', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn(async () => signedOutSession);
    renderAccount({ onLogin });
    const submit = document.querySelector<HTMLButtonElement>('.enterprise-email-submit')!;

    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('密码'), 'pass123');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('密码'), '4');
    expect(submit).toBeEnabled();

    await user.click(submit);

    const dialog = screen.getByRole('alertdialog', { name: '服务协议及隐私政策' });
    expect(dialog).toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(onLogin).not.toHaveBeenCalled();

    await user.click(submit);
    await user.click(screen.getByRole('button', { name: '同意并继续' }));

    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(onLogin).toHaveBeenCalledTimes(1);
    expect(onLogin).toHaveBeenCalledWith({
      email: 'member@example.com',
      password: 'pass1234'
    });
  });

  it('enables registration only after both passwords are valid and match', async () => {
    const user = userEvent.setup();
    renderAccount();

    await user.click(screen.getByRole('button', { name: '注册', pressed: false }));
    const submit = document.querySelector<HTMLButtonElement>('.enterprise-email-submit')!;
    await user.type(screen.getByLabelText('邮箱'), 'member@example.com');
    await user.type(screen.getByLabelText('密码'), 'register123');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText('确认密码'), 'register12');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('确认密码'), '3');
    expect(submit).toBeEnabled();
  });

  it('offers Feishu, DingTalk, and WeCom QR login without SSO', async () => {
    const user = userEvent.setup();
    const onStartQrLogin = vi.fn(async ({
      provider
    }: {
      provider: EnterpriseQrProvider;
    }) => ({
      requestId: `request-${provider}`,
      provider,
      qrCodeUrl: `https://enterprise.example/${provider}.png`,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      pollAfterMs: 10_000
    }));
    renderAccount({ onStartQrLogin });

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('tab', { name: '扫码登录' }));

    const feishuButton = screen.getByRole('button', { name: '飞书', pressed: true });
    const dingtalkButton = screen.getByRole('button', { name: '钉钉', pressed: false });
    const wecomButton = screen.getByRole('button', { name: '企业微信', pressed: false });
    expect(feishuButton.querySelector('img')).toHaveAttribute('src', '/auth/feishu.svg');
    expect(dingtalkButton.querySelector('img')).toHaveAttribute('src', '/auth/dingtalk.svg');
    expect(wecomButton.querySelector('img')).toHaveAttribute('src', '/auth/wecom.svg');
    expect(await screen.findByAltText('飞书登录二维码')).toHaveAttribute(
      'src',
      'https://enterprise.example/feishu.png'
    );

    await user.click(screen.getByRole('button', { name: '钉钉' }));
    expect(await screen.findByAltText('钉钉登录二维码')).toHaveAttribute(
      'src',
      'https://enterprise.example/dingtalk.png'
    );
    await waitFor(() => {
      expect(onStartQrLogin).toHaveBeenLastCalledWith({ provider: 'dingtalk' });
    });
    expect(screen.queryByText(/SSO/)).not.toBeInTheDocument();
  });

  it('keeps login unavailable until the runtime is connected', async () => {
    renderAccount({ connected: false });

    expect(screen.getByText('正在等待本地 Runtime')).toBeInTheDocument();
    expect(screen.getByText('连接恢复后即可继续登录。')).toBeInTheDocument();
    expect(document.querySelector<HTMLButtonElement>('.enterprise-email-submit')).toBeDisabled();
  });

  it('renders checking, service unavailable, and signed-in session states', () => {
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
        reason: 'service_unavailable',
        transportSecurity: 'secure_https'
      }
    }));
    expect(screen.getByText('企业服务暂时不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试连接' })).toBeInTheDocument();

    view.rerender(createAccount({
      session: {
        status: 'signed_in',
        account: {
          subjectId: 'acct-member',
          email: 'member@example.com',
          name: 'Member'
        },
        collector: { status: 'failed' },
        expiresAt: '2026-08-30T12:00:00.000Z',
        transportSecurity: 'secure_https'
      }
    }));
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.queryByText(/采集器/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重试安装' })).not.toBeInTheDocument();
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
    connected?: boolean;
    session?: EnterpriseSessionResponse;
    checkingTimedOut?: boolean;
    onLogin?: EnterpriseAccountPageProps['onLogin'];
    onRegister?: EnterpriseAccountPageProps['onRegister'];
    onStartQrLogin?: EnterpriseAccountPageProps['onStartQrLogin'];
  } = {}
) {
  return (
    <EnterpriseAccountPage
      connected={overrides.connected ?? true}
      session={overrides.session ?? signedOutSession}
      checkingTimedOut={overrides.checkingTimedOut}
      onLogin={overrides.onLogin ?? (async () => signedOutSession)}
      onRegister={overrides.onRegister ?? (async () => signedOutSession)}
      onStartQrLogin={overrides.onStartQrLogin ?? (async ({ provider }) => ({
        requestId: `request-${provider}`,
        provider,
        qrCodeUrl: `https://enterprise.example/${provider}.png`,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        pollAfterMs: 10_000
      }))}
      onPollQrLogin={async requestId => ({
        requestId,
        provider: 'feishu',
        status: 'pending',
        pollAfterMs: 10_000
      })}
      onLogout={async () => signedOutSession}
      onRefresh={async () => signedOutSession}
    />
  );
}

type EnterpriseAccountPageProps = Parameters<typeof EnterpriseAccountPage>[0];
