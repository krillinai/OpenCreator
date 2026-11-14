import type { GatewayAccountState } from '@opencreator/protocol';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { GatewayAccountSettingsService } from '../../services/gateway-account-service.js';
import { GatewayAccountSettingsView } from '../settings/GatewayAccountSettingsView.js';
import './DashboardGenerationAccess.css';

const GenerationAccessContext = createContext<(localService?: boolean) => boolean>(() => true);

export function useGenerationAccess() {
  return useContext(GenerationAccessContext);
}

export default function DashboardGenerationAccess(props: {
  gatewayState?: GatewayAccountState | null;
  gatewayAccountService?: GatewayAccountSettingsService | null;
  onGatewayStateChange?(state: GatewayAccountState): void;
  openExternal?(url: string): Promise<void> | void;
  children: ReactNode;
}) {
  const l = useLocalizedCopy();
  const [loginOpen, setLoginOpen] = useState(false);
  const [closeError, setCloseError] = useState('');
  const closing = useRef(false);
  const allowed = props.gatewayState === undefined || (
    props.gatewayState !== null && props.gatewayState.authState === 'signed_in' && props.gatewayState.source === 'gateway'
  );
  const requireAccess = useCallback((localService = false) => {
    if (allowed || (localService && props.gatewayState?.authState === 'signed_out' && props.gatewayState.source === 'manual')) return true;
    setCloseError('');
    setLoginOpen(true);
    return false;
  }, [allowed, props.gatewayState?.authState, props.gatewayState?.source]);

  const closeLogin = useCallback(() => {
    if (closing.current) return;
    if (props.gatewayState?.authState !== 'authorizing' || !props.gatewayAccountService) {
      setLoginOpen(false);
      return;
    }
    closing.current = true;
    setCloseError('');
    void props.gatewayAccountService.cancel().then(next => {
      props.onGatewayStateChange?.(next);
      setLoginOpen(false);
    }).catch(() => {
      setCloseError(l('取消登录失败，请重试。', 'Could not cancel sign-in. Try again.'));
    }).finally(() => { closing.current = false; });
  }, [props.gatewayState?.authState, props.gatewayAccountService, props.onGatewayStateChange, l]);

  useEffect(() => {
    if (allowed) setLoginOpen(false);
  }, [allowed]);
  useEffect(() => {
    if (!loginOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeLogin();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [loginOpen, closeLogin]);

  return (
    <GenerationAccessContext.Provider value={requireAccess}>
      {props.children}
      {loginOpen ? createPortal(
        <div className="dashboard-generation-access-backdrop" onMouseDown={event => {
          if (event.target === event.currentTarget) closeLogin();
        }}>
          <section className="dashboard-generation-access-dialog" role="dialog" aria-modal="true" aria-label={l('登录后继续创作', 'Sign in to continue creating')}>
            <button type="button" className="dashboard-generation-access-close" aria-label={l('关闭登录窗口', 'Close sign-in dialog')} title={l('关闭', 'Close')} onClick={closeLogin}>
              <X size={18} />
            </button>
            <header>
              <h2>{l('登录后继续创作', 'Sign in to continue creating')}</h2>
              <p>{props.gatewayState?.source === 'manual'
                ? l('当前使用本地模型服务。登录并连接 OpenCreator 官方模型后即可继续创作。', 'You are using local model services. Sign in and connect to OpenCreator official models to continue creating.')
                : l('登录 OpenCreator 后，即可使用官方模型开始创作。', 'Sign in to OpenCreator to start creating with official models.')}</p>
            </header>
            <GatewayAccountSettingsView
              variant="login"
              service={props.gatewayAccountService ?? null}
              accountState={props.gatewayState ?? undefined}
              openExternal={props.openExternal}
              onStateChange={props.onGatewayStateChange}
            />
            {closeError ? <p role="alert">{closeError}</p> : null}
          </section>
        </div>,
        document.body
      ) : null}
    </GenerationAccessContext.Provider>
  );
}
