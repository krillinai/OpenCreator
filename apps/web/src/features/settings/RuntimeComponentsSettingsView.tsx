import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  LoaderCircle,
  RefreshCw
} from 'lucide-react';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { IssueList } from '../issues/IssuePresenter.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import type { AppLanguage } from '../../i18n/language.js';
import { useState } from 'react';
import { RuntimeManagedComponents } from './RuntimeManagedComponents.js';
import './runtime-components-settings.css';

type LiveCheckState = 'idle' | 'checking' | 'ready' | 'failed';

export function RuntimeComponentsSettingsView(props: {
  connected: boolean;
  controller: RuntimeDependenciesController;
  componentId?: string;
  onReturn?(): void;
}) {
  const { language, t } = useAppLanguage();
  const localize = useLocalizedCopy();
  const status = props.controller.ytDlpStatus;
  const busy = props.controller.phase !== 'idle';
  const issues = props.controller.issues ?? [];
  const [checkNotice, setCheckNotice] = useState<string>();
  const [liveCheckState, setLiveCheckState] = useState<LiveCheckState>('idle');
  const hasIssue = issues.length > 0;

  if (!props.connected) {
    return (
      <section className="settings-section settings-management runtime-components-settings" aria-labelledby="runtime-components-title">
        <SettingsHeader />
        <div className="settings-state">
          <AlertCircle size={17} aria-hidden="true" />
          <span>{t('settings.runtimeComponents.disconnected')}</span>
        </div>
      </section>
    );
  }

  if (status === undefined) {
    return (
      <section className="settings-section settings-management runtime-components-settings" aria-labelledby="runtime-components-title">
        <SettingsHeader />
        <RuntimeManagedComponents controller={props.controller} componentId={props.componentId} onReturn={props.onReturn} />
        <article className="runtime-component-item runtime-component-row">
          <div className="runtime-component-heading">
            <div>
              <div className="runtime-component-title">
                <h2 className="runtime-component-name"><img className="runtime-component-logo" src="/components/yt-dlp.png" width="26" height="26" alt="" />yt-dlp nightly</h2>
                <span data-status={hasIssue ? 'failed' : 'checking'}>{hasIssue
                  ? localize('状态读取失败', 'Status unavailable', 'Status är inte tillgänglig')
                  : t('settings.runtimeComponents.loading')}</span>
              </div>
              <p>{t('settings.runtimeComponents.ytDlpDescription')}</p>
            </div>
          </div>
          <footer className="runtime-component-footer">
            <button className="settings-secondary-button" type="button" disabled={busy}
              onClick={() => void props.controller.checkYtDlpUpdate(true).catch(() => undefined)}>
              <RefreshCw size={15} aria-hidden="true" />
              {localize('重新检查', 'Check again', 'Kontrollera igen')}
            </button>
          </footer>
        {!hasIssue ? (
          <div className="settings-state">
            <LoaderCircle className="settings-spin" size={17} aria-hidden="true" />
            <span>{t('settings.runtimeComponents.loading')}</span>
          </div>
        ) : (
          <IssueList
            issues={issues}
            actions={{ retryOperations: {
              'runtime.load-yt-dlp': async () => { await props.controller.checkYtDlpUpdate(true); },
              'runtime.check-yt-dlp': async () => { await props.controller.checkYtDlpUpdate(true); },
              'runtime.update-yt-dlp': async () => { await props.controller.updateYtDlp(); }
            } }}
            onDismiss={props.controller.dismissIssue}
          />
        )}
        </article>
      </section>
    );
  }

  const checking = liveCheckState === 'checking';
  const fresh = liveCheckState === 'ready';
  const statusLabel = checking
    ? t('settings.runtimeComponents.checking')
    : liveCheckState === 'failed'
      ? localize('失败', 'Failed', 'Misslyckades')
      : status.updateAvailable
        ? t('settings.runtimeComponents.updateAvailable')
        : localize('已就绪', 'Ready', 'Redo');
  const statusKind = liveCheckState === 'failed' ? 'failed' : checking
    ? 'checking'
    : status.updateAvailable ? 'update' : 'current';

  return (
    <section className="settings-section settings-management runtime-components-settings" aria-labelledby="runtime-components-title">
      <SettingsHeader />
      <RuntimeManagedComponents controller={props.controller} componentId={props.componentId} onReturn={props.onReturn} />
      <article className="runtime-component-item runtime-component-row">
        <div className="runtime-component-heading">
          <div>
            <div className="runtime-component-title">
              <h2 className="runtime-component-name"><img className="runtime-component-logo" src="/components/yt-dlp.png" width="26" height="26" alt="" />yt-dlp nightly</h2>
              <span data-status={statusKind}>
                {statusLabel}
              </span>
            </div>
            <p>{t('settings.runtimeComponents.ytDlpDescription')}</p>
          </div>
          {checking ? <LoaderCircle className="settings-spin" size={19} aria-hidden="true" />
            : liveCheckState === 'failed' ? <AlertCircle size={19} aria-hidden="true" data-status={statusKind} />
            : status.updateAvailable ? <Download size={19} aria-hidden="true" data-status={statusKind} />
            : <CheckCircle2 size={19} aria-hidden="true" data-status={statusKind} />}
        </div>

        <dl className="runtime-component-details">
          <div>
            <dt>{t('settings.runtimeComponents.currentVersion')}</dt>
            <dd>{status.currentVersion}</dd>
          </div>
          <div>
            <dt>{fresh
              ? t('settings.runtimeComponents.latestVersion')
              : t('settings.runtimeComponents.lastKnownVersion')}</dt>
            <dd>{checking
              ? t('settings.runtimeComponents.checking')
              : status.latestVersion ?? t('settings.runtimeComponents.notChecked')}
              {fresh && !status.updateAvailable && status.latestVersion === status.currentVersion ? <small className="runtime-component-version-note" data-status="current">{t('settings.runtimeComponents.current')}</small> : null}
              {liveCheckState === 'failed' ? <small className="runtime-component-version-note" data-status="failed">{t('settings.runtimeComponents.checkFailed')}</small> : null}
            </dd>
          </div>
        </dl>

        <footer className="runtime-component-footer">
          <div className="runtime-component-actions">
            <button
              className="settings-secondary-button"
              type="button"
              disabled={busy || checking}
              onClick={() => {
                setCheckNotice(undefined);
                setLiveCheckState('checking');
                void props.controller.checkYtDlpUpdate(true)
                  .then(result => {
                    setLiveCheckState('ready');
                    setCheckNotice(result.updateAvailable
                      ? t('settings.runtimeComponents.updateAvailable')
                      : t('settings.runtimeComponents.latestNotice'));
                  })
                  .catch(() => setLiveCheckState('failed'));
              }}
            >
              {checking || props.controller.phase === 'checking'
                ? <LoaderCircle className="settings-spin" size={15} aria-hidden="true" />
                : <RefreshCw size={15} aria-hidden="true" />}
              {t('settings.runtimeComponents.check')}
            </button>
            {status.updateAvailable && status.latestVersion !== null ? (
              <button
                className="settings-primary-button"
                data-status="update"
                type="button"
                disabled={busy}
                onClick={() => void props.controller.updateYtDlp().catch(() => undefined)}
              >
                {props.controller.phase === 'updating'
                  ? <LoaderCircle className="settings-spin" size={15} aria-hidden="true" />
                  : <Download size={15} aria-hidden="true" />}
                {props.controller.phase === 'updating'
                  ? t('settings.runtimeComponents.updating')
                  : t('settings.runtimeComponents.updateTo', {
                      version: status.latestVersion
                    })}
              </button>
            ) : null}
          </div>
        </footer>

        <details className="local-component-details">
          <summary><ChevronDown size={15} aria-hidden="true" />{localize('组件详情', 'Component details', 'Komponentinformation')}</summary>
          {!hasIssue ? <div className="runtime-component-notes"><p>{t('settings.runtimeComponents.fallback')}</p></div> : null}
          <dl className="runtime-component-details">
            <div>
              <dt>{t('settings.runtimeComponents.lastChecked')}</dt>
              <dd>{formatDate(status.lastCheckedAt, language, t('settings.runtimeComponents.notChecked'))}</dd>
            </div>
            <div>
              <dt>{t('settings.runtimeComponents.installedAt')}</dt>
              <dd>{formatDate(status.installedAt, language, t('settings.runtimeComponents.notChecked'))}</dd>
            </div>
          </dl>
        </details>

        <IssueList
          issues={issues}
          actions={{ retryOperations: {
            'runtime.load-yt-dlp': async () => { await props.controller.checkYtDlpUpdate(true); },
            'runtime.check-yt-dlp': async () => { await props.controller.checkYtDlpUpdate(true); },
            'runtime.update-yt-dlp': async () => { await props.controller.updateYtDlp(); }
          } }}
          onDismiss={props.controller.dismissIssue}
        />
        {checkNotice === undefined ? null : (
          <p className="settings-notice" role="status">{checkNotice}</p>
        )}
      </article>
    </section>
  );
}

function SettingsHeader() {
  const { t } = useAppLanguage();
  return (
    <header>
      <h1 id="runtime-components-title">{t('settings.tab.runtimeComponents')}</h1>
      <p>{t('settings.runtimeComponents.description')}</p>
    </header>
  );
}

function formatDate(
  value: string | null,
  language: AppLanguage,
  fallback: string
): string {
  if (value === null) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date);
}
