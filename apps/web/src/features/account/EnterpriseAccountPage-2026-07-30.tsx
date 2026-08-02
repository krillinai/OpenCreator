import type {
  EnterpriseLoginRequest,
  EnterpriseRegisterRequest,
  EnterpriseSessionResponse
} from '@clawee/protocol';
import {
  Building2,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  WifiOff
} from 'lucide-react';
import {
  type FormEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from 'react';
import { ApiClientError } from '../../runtime/errors.js';

type AccountMode = 'login' | 'register';
type AccountOperation = 'login' | 'register' | 'refresh' | 'logout';

export type EnterpriseAccountPageProps = {
  connected: boolean;
  session: EnterpriseSessionResponse;
  checkingTimedOut?: boolean;
  onLogin(input: EnterpriseLoginRequest): Promise<EnterpriseSessionResponse>;
  onRegister(input: EnterpriseRegisterRequest): Promise<EnterpriseSessionResponse>;
  onLogout(): Promise<EnterpriseSessionResponse>;
  onRefresh(): Promise<EnterpriseSessionResponse>;
};

export function EnterpriseAccountPage(props: EnterpriseAccountPageProps) {
  const [mode, setMode] = useState<AccountMode>('login');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [operation, setOperation] = useState<AccountOperation>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const confirmationRef = useRef<HTMLInputElement | null>(null);

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
  }, [mode, props.session.status]);

  useEffect(() => {
    if (props.session.status === 'signed_in') clearSecretValues();
  }, [props.session.status]);

  function switchMode(nextMode: AccountMode) {
    if (nextMode === mode) return;
    clearSecretValues();
    setError(undefined);
    setNotice(undefined);
    setMode(nextMode);
  }

  async function submitAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation !== undefined || !props.connected) return;

    const normalizedEmail = email.trim();
    if (normalizedEmail.length === 0 || password.length < 8) {
      setError('请输入有效邮箱和至少 8 位密码。');
      return;
    }
    if (mode === 'register' && password !== passwordConfirmation) {
      setError('两次输入的密码不一致。');
      return;
    }

    setError(undefined);
    setNotice(undefined);
    setOperation(mode);
    try {
      const response = mode === 'login'
        ? await props.onLogin({
            email: normalizedEmail,
            password
          })
        : await props.onRegister({
            email: normalizedEmail,
            ...(name.trim().length === 0 ? {} : { name: name.trim() }),
            password
          });
      clearSecretValues();
      if (response.status === 'signed_in') {
        setNotice('企业账户已连接。');
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
        setMode('login');
        setNotice('账户已创建，请使用该邮箱登录。');
        window.setTimeout(() => passwordRef.current?.focus(), 0);
      } else {
        setError(formatAccountError(reason));
        if (
          reason instanceof ApiClientError
          && (
            reason.code === 'ENTERPRISE_UNAUTHORIZED'
            || reason.status === 401
          )
        ) {
          window.setTimeout(() => passwordRef.current?.focus(), 0);
        }
      }
    } finally {
      setOperation(undefined);
    }
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
      {!props.connected ? (
        <div className="enterprise-account-status" role="status">
          <WifiOff size={20} aria-hidden="true" />
          <div>
            <strong>正在等待本地 Runtime</strong>
            <span>企业登录暂不可用，本地工作区仍可继续使用。</span>
          </div>
        </div>
      ) : null}

      {error !== undefined ? (
        <p className="enterprise-account-error" role="alert">{error}</p>
      ) : null}
      {notice !== undefined ? (
        <p className="enterprise-account-notice" role="status">{notice}</p>
      ) : null}

      {props.session.status === 'checking' ? (
        <div className="enterprise-account-panel enterprise-account-session-panel">
          <LoaderCircle className="enterprise-account-spinner" size={24} aria-hidden="true" />
          <div>
            <h2>正在验证企业会话</h2>
            <p>Clawee 正在从安全凭据存储恢复登录状态。</p>
          </div>
          {props.checkingTimedOut ? (
            <button
              className="enterprise-account-secondary-action"
              type="button"
              disabled={operation !== undefined || !props.connected}
              onClick={() => void runSessionOperation('refresh')}
            >
              <RefreshCw size={16} aria-hidden="true" />
              <span>重新检测</span>
            </button>
          ) : null}
        </div>
      ) : props.session.status === 'service_unavailable' ? (
        <div className="enterprise-account-panel enterprise-account-session-panel">
          <WifiOff size={24} aria-hidden="true" />
          <div>
            <h2>企业服务暂时不可用</h2>
            {props.session.account !== undefined ? (
              <p>
                最近连接：
                <strong>{props.session.account.name}</strong>
                <span>{props.session.account.email}</span>
              </p>
            ) : (
              <p>服务恢复后可重新检测，不影响本地工作。</p>
            )}
          </div>
          <button
            className="enterprise-account-secondary-action"
            type="button"
            disabled={operation !== undefined || !props.connected}
            onClick={() => void runSessionOperation('refresh')}
          >
            {operation === 'refresh' ? (
              <LoaderCircle className="enterprise-account-spinner" size={16} aria-hidden="true" />
            ) : (
              <RefreshCw size={16} aria-hidden="true" />
            )}
            <span>重试连接</span>
          </button>
        </div>
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
          </div>
          <button
            className="enterprise-account-secondary-action"
            type="button"
            disabled={operation !== undefined || !props.connected}
            onClick={() => void runSessionOperation('logout')}
          >
            {operation === 'logout' ? (
              <LoaderCircle className="enterprise-account-spinner" size={16} aria-hidden="true" />
            ) : (
              <LogOut size={16} aria-hidden="true" />
            )}
            <span>退出登录</span>
          </button>
        </div>
      ) : (
        <div className="enterprise-account-panel enterprise-account-form-panel">
          <div className="enterprise-account-form-heading">
            <div className="enterprise-account-form-icon" aria-hidden="true">
              <Building2 size={20} />
            </div>
            <div>
              <h2>{mode === 'login' ? '登录企业账户' : '创建企业账户'}</h2>
              <p>登录后可浏览、安装和更新企业 Skill。</p>
            </div>
          </div>

          <div className="enterprise-account-segmented" role="group" aria-label="账户操作">
            <button
              type="button"
              aria-pressed={mode === 'login'}
              disabled={operation !== undefined}
              onClick={() => switchMode('login')}
            >
              登录
            </button>
            <button
              type="button"
              aria-pressed={mode === 'register'}
              disabled={operation !== undefined}
              onClick={() => switchMode('register')}
            >
              注册
            </button>
          </div>

          <form className="enterprise-account-form" onSubmit={submitAccount}>
            {mode === 'register' ? (
              <label>
                <span>名称</span>
                <input
                  type="text"
                  autoComplete="name"
                  disabled={operation !== undefined}
                  value={name}
                  onChange={event => setName(event.target.value)}
                />
              </label>
            ) : null}
            <label>
              <span>邮箱</span>
              <input
                type="email"
                autoComplete="email"
                required
                disabled={operation !== undefined}
                value={email}
                onChange={event => setEmail(event.target.value)}
              />
            </label>
            <label>
              <span>密码</span>
              <input
                ref={element => {
                  if (element !== null) passwordRef.current = element;
                }}
                type="password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={8}
                required
                disabled={operation !== undefined}
                value={password}
                onChange={event => setPassword(event.target.value)}
              />
            </label>
            {mode === 'register' ? (
              <label>
                <span>确认密码</span>
                <input
                  ref={element => {
                    if (element !== null) confirmationRef.current = element;
                  }}
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  required
                  disabled={operation !== undefined}
                  value={passwordConfirmation}
                  onChange={event => setPasswordConfirmation(event.target.value)}
                />
              </label>
            ) : null}
            <button
              className="enterprise-account-primary-action"
              type="submit"
              disabled={operation !== undefined || !props.connected}
            >
              {operation === mode ? (
                <LoaderCircle className="enterprise-account-spinner" size={17} aria-hidden="true" />
              ) : null}
              <span>{mode === 'login' ? '登录' : '创建账户并登录'}</span>
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function formatAccountError(error: unknown): string {
  if (!(error instanceof ApiClientError)) return '企业账户操作失败，请稍后重试。';
  switch (error.code) {
    case 'ENTERPRISE_UNAUTHORIZED':
      return '邮箱或密码不正确。';
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
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return '企业服务暂时不可用，请稍后重试。';
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

export default EnterpriseAccountPage;
