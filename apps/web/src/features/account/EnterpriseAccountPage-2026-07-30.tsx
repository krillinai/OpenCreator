import type {
  EnterpriseLoginRequest,
  EnterpriseQrLoginStartRequest,
  EnterpriseQrLoginStartResponse,
  EnterpriseQrLoginStatusResponse,
  EnterpriseQrProvider,
  EnterpriseRegisterRequest,
  EnterpriseSessionResponse
} from '@clawee/protocol';
import {
  CheckCircle2,
  LoaderCircle,
  LogOut,
  Mail,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  WifiOff
} from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.js';
import { ApiClientError } from '../../runtime/errors.js';

type AuthMode = 'email' | 'qr';
type AccountMode = 'login' | 'register';
type AccountOperation = AccountMode | 'refresh' | 'logout';

type QrLoginView = EnterpriseQrLoginStartResponse & {
  status: EnterpriseQrLoginStatusResponse['status'];
};

const qrProviders: Array<{
  id: EnterpriseQrProvider;
  label: string;
  logoSrc: string;
}> = [
  { id: 'feishu', label: '飞书', logoSrc: '/auth/feishu.svg' },
  { id: 'dingtalk', label: '钉钉', logoSrc: '/auth/dingtalk.svg' },
  { id: 'wecom', label: '企业微信', logoSrc: '/auth/wecom.svg' }
];

const enterpriseEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type EnterpriseAccountPageProps = {
  connected: boolean;
  required?: boolean;
  session: EnterpriseSessionResponse;
  checkingTimedOut?: boolean;
  onLogin(input: EnterpriseLoginRequest): Promise<EnterpriseSessionResponse>;
  onRegister(input: EnterpriseRegisterRequest): Promise<EnterpriseSessionResponse>;
  onStartQrLogin?(
    input: EnterpriseQrLoginStartRequest
  ): Promise<EnterpriseQrLoginStartResponse>;
  onPollQrLogin?(
    requestId: string
  ): Promise<EnterpriseQrLoginStatusResponse>;
  onLogout(): Promise<EnterpriseSessionResponse>;
  onRefresh(): Promise<EnterpriseSessionResponse>;
};

export function EnterpriseAccountPage(props: EnterpriseAccountPageProps) {
  const [mode, setMode] = useState<AuthMode>('email');
  const [accountMode, setAccountMode] = useState<AccountMode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [agreementDialogOpen, setAgreementDialogOpen] = useState(false);
  const [operation, setOperation] = useState<AccountOperation>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [qrProvider, setQrProvider] = useState<EnterpriseQrProvider>('feishu');
  const [qrReloadKey, setQrReloadKey] = useState(0);
  const [qrLogin, setQrLogin] = useState<QrLoginView>();
  const [qrLoading, setQrLoading] = useState(false);
  const [qrPolling, setQrPolling] = useState(false);
  const [qrRemainingSeconds, setQrRemainingSeconds] = useState(0);
  const accountFormRef = useRef<HTMLFormElement | null>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const confirmationRef = useRef<HTMLInputElement | null>(null);
  const startQrLoginRef = useRef(props.onStartQrLogin);
  const pollQrLoginRef = useRef(props.onPollQrLogin);
  const normalizedEmail = email.trim();
  const accountFieldsValid = enterpriseEmailPattern.test(normalizedEmail)
    && password.length >= 8
    && (
      accountMode === 'login'
      || (
        passwordConfirmation.length >= 8
        && passwordConfirmation === password
      )
    );

  startQrLoginRef.current = props.onStartQrLogin;
  pollQrLoginRef.current = props.onPollQrLogin;

  function clearSecretValues() {
    if (passwordRef.current !== null) passwordRef.current.value = '';
    if (confirmationRef.current !== null) confirmationRef.current.value = '';
    setPassword('');
    setPasswordConfirmation('');
  }

  useLayoutEffect(() => {
    return () => {
      if (passwordRef.current !== null) passwordRef.current.value = '';
      if (confirmationRef.current !== null) confirmationRef.current.value = '';
    };
  }, [accountMode, props.session.status]);

  useEffect(() => {
    if (props.session.status === 'signed_in') clearSecretValues();
  }, [props.session.status]);

  useEffect(() => {
    if (
      mode !== 'qr'
      || !acceptedTerms
      || !props.connected
      || props.session.status === 'signed_in'
    ) {
      setQrLogin(undefined);
      setQrLoading(false);
      return;
    }

    const startQrLogin = startQrLoginRef.current;
    if (startQrLogin === undefined) {
      setQrLogin(undefined);
      setError('当前 Runtime 暂不支持扫码登录。');
      return;
    }

    let canceled = false;
    setError(undefined);
    setNotice(undefined);
    setQrLogin(undefined);
    setQrLoading(true);
    void startQrLogin({ provider: qrProvider })
      .then(response => {
        if (canceled) return;
        setQrLogin({ ...response, status: 'pending' });
      })
      .catch(reason => {
        if (!canceled) setError(formatAccountError(reason));
      })
      .finally(() => {
        if (!canceled) setQrLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [
    acceptedTerms,
    mode,
    props.connected,
    props.session.status,
    qrProvider,
    qrReloadKey
  ]);

  useEffect(() => {
    if (qrLogin === undefined) {
      setQrRemainingSeconds(0);
      return;
    }
    const updateRemaining = () => {
      const remaining = Math.max(
        0,
        Math.ceil((Date.parse(qrLogin.expiresAt) - Date.now()) / 1000)
      );
      setQrRemainingSeconds(remaining);
      if (remaining === 0) {
        setQrLogin(current => current === undefined
          ? current
          : { ...current, status: 'expired' });
      }
    };
    updateRemaining();
    const timer = window.setInterval(updateRemaining, 1000);
    return () => window.clearInterval(timer);
  }, [qrLogin?.requestId, qrLogin?.expiresAt]);

  useEffect(() => {
    if (
      qrLogin === undefined
      || (qrLogin.status !== 'pending' && qrLogin.status !== 'scanned')
    ) {
      return;
    }
    const pollQrLogin = pollQrLoginRef.current;
    if (pollQrLogin === undefined) return;

    let canceled = false;
    const timer = window.setTimeout(() => {
      setQrPolling(true);
      void pollQrLogin(qrLogin.requestId)
        .then(response => {
          if (canceled) return;
          if (response.status === 'signed_in') {
            setNotice('登录成功，正在进入 Clawee。');
            return;
          }
          setQrLogin(current => current === undefined
            ? current
            : {
                ...current,
                status: response.status,
                pollAfterMs: response.pollAfterMs ?? current.pollAfterMs
              });
        })
        .catch(reason => {
          if (!canceled) setError(formatAccountError(reason));
        })
        .finally(() => {
          if (!canceled) setQrPolling(false);
        });
    }, qrLogin.pollAfterMs);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [qrLogin]);

  function switchMode(nextMode: AuthMode) {
    if (nextMode === mode) return;
    clearSecretValues();
    setMode(nextMode);
    setError(undefined);
    setNotice(undefined);
    setQrLogin(undefined);
  }

  function switchAccountMode(nextMode: AccountMode) {
    if (nextMode === accountMode) return;
    clearSecretValues();
    setAccountMode(nextMode);
    setError(undefined);
    setNotice(undefined);
  }

  async function runAccountOperation() {
    if (operation !== undefined || !props.connected) return;
    if (!accountFieldsValid) {
      setError('请输入有效邮箱和至少 8 位密码。');
      return;
    }
    if (accountMode === 'register' && password !== passwordConfirmation) {
      setError('两次输入的密码不一致。');
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setOperation(accountMode);
    try {
      const response = accountMode === 'login'
        ? await props.onLogin({ email: normalizedEmail, password })
        : await props.onRegister({
            email: normalizedEmail,
            ...(name.trim().length === 0 ? {} : { name: name.trim() }),
            password
          });
      clearSecretValues();
      if (response.status === 'signed_in') {
        setNotice('登录成功，正在进入 Clawee。');
      }
    } catch (reason) {
      clearSecretValues();
      if (
        reason instanceof ApiClientError
        && reason.code === 'ENTERPRISE_REGISTERED_LOGIN_REQUIRED'
      ) {
        const registeredEmail = reason.details?.email;
        if (typeof registeredEmail === 'string' && registeredEmail.length > 0) {
          setEmail(registeredEmail);
        }
        setAccountMode('login');
        setNotice('账户已创建，请使用该邮箱登录。');
        window.setTimeout(() => passwordRef.current?.focus(), 0);
      } else {
        setError(formatAccountError(reason));
        if (
          reason instanceof ApiClientError
          && (reason.code === 'ENTERPRISE_UNAUTHORIZED' || reason.status === 401)
        ) {
          window.setTimeout(() => passwordRef.current?.focus(), 0);
        }
      }
    } finally {
      setOperation(undefined);
    }
  }

  function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation !== undefined || !props.connected) return;
    if (!acceptedTerms) {
      setError(undefined);
      setAgreementDialogOpen(true);
      return;
    }
    if (!event.currentTarget.reportValidity()) return;
    void runAccountOperation();
  }

  function acceptAgreementAndContinue() {
    setAcceptedTerms(true);
    setAgreementDialogOpen(false);
    if (accountFormRef.current === null || !accountFormRef.current.reportValidity()) {
      return;
    }
    void runAccountOperation();
  }

  async function runSessionOperation(kind: 'refresh' | 'logout') {
    if (operation !== undefined || !props.connected) return;
    setError(undefined);
    setNotice(undefined);
    setOperation(kind);
    try {
      await (kind === 'refresh' ? props.onRefresh() : props.onLogout());
    } catch (reason) {
      setError(formatAccountError(reason));
    } finally {
      setOperation(undefined);
    }
  }

  return (
    <section className="enterprise-account-page" aria-label="企业账户">
      {props.session.status === 'checking' ? (
        <SessionPanel
          icon={<LoaderCircle className="enterprise-account-spinner" size={24} />}
          title="正在验证企业会话"
          description="Clawee 正在从安全凭据存储恢复登录状态。"
          action={props.checkingTimedOut ? (
            <button
              className="enterprise-account-secondary-action"
              type="button"
              disabled={operation !== undefined || !props.connected}
              onClick={() => void runSessionOperation('refresh')}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <span>重新检测</span>
            </button>
          ) : undefined}
        />
      ) : props.session.status === 'service_unavailable' ? (
        <SessionPanel
          icon={<WifiOff size={24} />}
          title="企业服务暂时不可用"
          description={props.required
            ? '服务恢复后请重新检测，完成登录后才能继续使用 Clawee。'
            : '服务恢复后可重新检测，不影响本地工作。'}
          action={(
            <button
              className="enterprise-account-secondary-action"
              type="button"
              disabled={operation !== undefined || !props.connected}
              onClick={() => void runSessionOperation('refresh')}
            >
              {operation === 'refresh' ? (
                <LoaderCircle className="enterprise-account-spinner" size={16} />
              ) : (
                <RefreshCw size={16} aria-hidden="true" />
              )}
              <span>重试连接</span>
            </button>
          )}
        />
      ) : props.session.status === 'signed_in' && props.session.account !== undefined ? (
        <div className="enterprise-account-panel enterprise-account-profile">
          <div className="enterprise-account-profile-icon" aria-hidden="true">
            <ShieldCheck size={24} />
          </div>
          <div className="enterprise-account-profile-copy">
            <span>已连接企业账户</span>
            <h2>{props.session.account.name}</h2>
            <p>{props.session.account.email}</p>
            {props.session.expiresAt !== undefined ? (
              <small>会话有效期至 {formatExpiry(props.session.expiresAt)}</small>
            ) : null}
            {props.session.collector !== undefined ? (
              <small className={`enterprise-collector-state is-${props.session.collector.status}`}>
                {formatCollectorState(props.session.collector.status)}
              </small>
            ) : null}
          </div>
          <div className="enterprise-account-actions">
            {props.session.collector?.status === 'failed' ? (
              <button
                className="enterprise-account-secondary-action"
                type="button"
                disabled={operation !== undefined || !props.connected}
                onClick={() => void runSessionOperation('refresh')}
              >
                <RefreshCw size={16} aria-hidden="true" />
                <span>重试安装</span>
              </button>
            ) : null}
            <button
              className="enterprise-account-secondary-action"
              type="button"
              disabled={operation !== undefined || !props.connected}
              onClick={() => void runSessionOperation('logout')}
            >
              {operation === 'logout' ? (
                <LoaderCircle className="enterprise-account-spinner" size={16} />
              ) : (
                <LogOut size={16} aria-hidden="true" />
              )}
              <span>退出登录</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="enterprise-auth-card">
          <header className="enterprise-auth-header">
            <img
              className="enterprise-auth-logo enterprise-auth-logo-dark"
              src="/logo-v2-white-logo.svg"
              alt=""
              aria-hidden="true"
            />
            <img
              className="enterprise-auth-logo enterprise-auth-logo-light"
              src="/logo-v2-black-logo.svg"
              alt=""
              aria-hidden="true"
            />
            <div>
              <h1>欢迎使用 Clawee</h1>
              <p>登录后即可进入企业智能工作台</p>
            </div>
          </header>

          {!props.connected ? (
            <div className="enterprise-account-status" role="status">
              <WifiOff size={18} aria-hidden="true" />
              <div>
                <strong>正在等待本地 Runtime</strong>
                <span>连接恢复后即可继续登录。</span>
              </div>
            </div>
          ) : null}

          {error !== undefined ? (
            <p className="enterprise-account-error" role="alert">{error}</p>
          ) : null}
          {notice !== undefined ? (
            <p className="enterprise-account-notice" role="status">{notice}</p>
          ) : null}

          <div className="enterprise-auth-mode" role="tablist" aria-label="登录方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'email'}
              onClick={() => switchMode('email')}
            >
              <Mail size={16} aria-hidden="true" />
              <span>邮箱登录</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'qr'}
              onClick={() => switchMode('qr')}
            >
              <ScanLine size={16} aria-hidden="true" />
              <span>扫码登录</span>
            </button>
          </div>

          <div className="enterprise-auth-content">
            {mode === 'email' ? (
              <div className="enterprise-email-auth">
                <div className="enterprise-email-mode" role="group" aria-label="账户操作">
                  <button
                    type="button"
                    aria-pressed={accountMode === 'login'}
                    disabled={operation !== undefined}
                    onClick={() => switchAccountMode('login')}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    aria-pressed={accountMode === 'register'}
                    disabled={operation !== undefined}
                    onClick={() => switchAccountMode('register')}
                  >
                    注册
                  </button>
                </div>
                <form
                  ref={accountFormRef}
                  className="enterprise-email-form"
                  noValidate
                  onSubmit={submitAccount}
                >
                  {accountMode === 'register' ? (
                    <label className="enterprise-email-field">
                      <span className="app-visually-hidden">名称</span>
                      <input
                        aria-label="名称"
                        type="text"
                        autoComplete="name"
                        placeholder="名称（选填）"
                        disabled={operation !== undefined}
                        value={name}
                        onChange={event => setName(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <label className="enterprise-email-field">
                    <span className="app-visually-hidden">邮箱</span>
                    <input
                      aria-label="邮箱"
                      type="email"
                      autoComplete="email"
                      placeholder="请输入邮箱"
                      required
                      disabled={operation !== undefined}
                      value={email}
                      onChange={event => setEmail(event.target.value)}
                    />
                  </label>
                  <label className="enterprise-email-field">
                    <span className="app-visually-hidden">密码</span>
                    <input
                      ref={element => {
                        if (element !== null) passwordRef.current = element;
                      }}
                      aria-label="密码"
                      type="password"
                      autoComplete={accountMode === 'login' ? 'current-password' : 'new-password'}
                      minLength={8}
                      placeholder="请输入密码（至少 8 位）"
                      required
                      disabled={operation !== undefined}
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                    />
                  </label>
                  {accountMode === 'register' ? (
                    <label className="enterprise-email-field">
                      <span className="app-visually-hidden">确认密码</span>
                      <input
                        ref={element => {
                          if (element !== null) confirmationRef.current = element;
                        }}
                        aria-label="确认密码"
                        type="password"
                        autoComplete="new-password"
                        minLength={8}
                        placeholder="请再次输入密码"
                        required
                        disabled={operation !== undefined}
                        value={passwordConfirmation}
                        onChange={event => setPasswordConfirmation(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <button
                    className="enterprise-account-primary-action enterprise-email-submit"
                    type="submit"
                    disabled={
                      operation !== undefined
                      || !props.connected
                      || !accountFieldsValid
                    }
                  >
                    {operation === accountMode ? (
                      <LoaderCircle className="enterprise-account-spinner" size={17} />
                    ) : null}
                    <span>{accountMode === 'login' ? '登录' : '注册'}</span>
                  </button>
                </form>
              </div>
            ) : (
              <div className="enterprise-qr-login">
                <div className="enterprise-qr-providers" role="group" aria-label="扫码平台">
                  {qrProviders.map(provider => (
                    <button
                      key={provider.id}
                      type="button"
                      data-provider={provider.id}
                      aria-pressed={qrProvider === provider.id}
                      onClick={() => {
                        setQrProvider(provider.id);
                        setError(undefined);
                        setNotice(undefined);
                      }}
                    >
                      <img
                        className="enterprise-provider-mark"
                        src={provider.logoSrc}
                        alt=""
                        aria-hidden="true"
                      />
                      <span>{provider.label}</span>
                    </button>
                  ))}
                </div>
                <p className="enterprise-qr-instruction">
                  使用{providerLabel(qrProvider)}扫描二维码并确认登录
                </p>
                <div className="enterprise-qr-stage" aria-live="polite">
                  {!acceptedTerms ? (
                    <div className="enterprise-qr-placeholder">
                      <ScanLine size={42} aria-hidden="true" />
                      <span>同意协议后生成二维码</span>
                    </div>
                  ) : qrLoading ? (
                    <div className="enterprise-qr-placeholder">
                      <LoaderCircle className="enterprise-account-spinner" size={36} />
                      <span>正在生成二维码</span>
                    </div>
                  ) : qrLogin === undefined ? (
                    <button
                      className="enterprise-qr-retry"
                      type="button"
                      onClick={() => setQrReloadKey(current => current + 1)}
                    >
                      <RefreshCw size={22} aria-hidden="true" />
                      <span>重新生成二维码</span>
                    </button>
                  ) : (
                    <>
                      <img src={qrLogin.qrCodeUrl} alt={`${providerLabel(qrProvider)}登录二维码`} />
                      {qrLogin.status === 'scanned' ? (
                        <div className="enterprise-qr-overlay is-scanned">
                          <CheckCircle2 size={28} aria-hidden="true" />
                          <strong>已扫码</strong>
                          <span>请在手机上确认登录</span>
                        </div>
                      ) : qrLogin.status === 'expired' || qrLogin.status === 'denied' ? (
                        <button
                          className="enterprise-qr-overlay"
                          type="button"
                          onClick={() => setQrReloadKey(current => current + 1)}
                        >
                          <RefreshCw size={24} aria-hidden="true" />
                          <strong>{qrLogin.status === 'expired' ? '二维码已失效' : '登录已取消'}</strong>
                          <span>点击刷新</span>
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
                {qrLogin !== undefined && qrLogin.status === 'pending' ? (
                  <p className="enterprise-qr-expiry">
                    {qrPolling ? '正在确认扫码状态' : `二维码 ${qrRemainingSeconds}s 后失效`}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          <label className="enterprise-auth-agreement">
            <input
              type="checkbox"
              checked={acceptedTerms}
              onChange={event => {
                setAcceptedTerms(event.target.checked);
                if (event.target.checked) setAgreementDialogOpen(false);
                setError(undefined);
              }}
            />
            <span>我已阅读并同意《服务协议》和《隐私政策》</span>
          </label>
          <ConfirmDialog
            open={agreementDialogOpen}
            title="服务协议及隐私政策"
            description="我已阅读并同意《服务协议》和《隐私政策》"
            confirmLabel="同意并继续"
            className="enterprise-agreement-dialog"
            onCancel={() => setAgreementDialogOpen(false)}
            onConfirm={acceptAgreementAndContinue}
          />
        </div>
      )}
    </section>
  );
}

function SessionPanel(props: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="enterprise-account-panel enterprise-account-session-panel">
      <span aria-hidden="true">{props.icon}</span>
      <div>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </div>
      {props.action}
    </div>
  );
}

function providerLabel(provider: EnterpriseQrProvider): string {
  return qrProviders.find(item => item.id === provider)?.label ?? '应用';
}

function formatAccountError(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '企业账户操作失败，请稍后重试。';
  if (error.status === 404) return '企业登录服务暂未启用，请稍后重试。';
  switch (error.code) {
    case 'ENTERPRISE_UNAUTHORIZED':
      return '邮箱或密码不正确，请重新输入。';
    case 'ENTERPRISE_ACCOUNT_INACTIVE':
      return '该企业账户当前不可用。';
    case 'ENTERPRISE_FRONTEND_FORBIDDEN':
      return '该账户没有 Clawee 企业前端访问权限。';
    case 'ENTERPRISE_AGENT_FORBIDDEN':
      return '当前 Clawee Agent 状态不可用。';
    case 'ENTERPRISE_AGENT_ID_CONFLICT':
      return '当前 Clawee Agent 已绑定到其他企业账户。';
    case 'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE':
      return '系统安全凭据存储不可用，无法保存企业会话。';
    case 'ENTERPRISE_RATE_LIMITED':
      return '操作过于频繁，请稍后重试。';
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return '企业登录服务暂时不可用，请稍后重试。';
    case 'VALIDATION_FAILED':
    case 'ENTERPRISE_INVALID_REQUEST':
      return '请检查邮箱、名称和密码后重试。';
    default:
      return error.message || '企业账户操作失败，请稍后重试。';
  }
}

function formatExpiry(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function formatCollectorState(
  status: NonNullable<EnterpriseSessionResponse['collector']>['status']
): string {
  switch (status) {
    case 'installing':
      return '正在安装企业采集器';
    case 'installed':
      return '企业采集器已安装';
    case 'failed':
      return '企业采集器安装失败';
  }
}

export default EnterpriseAccountPage;
