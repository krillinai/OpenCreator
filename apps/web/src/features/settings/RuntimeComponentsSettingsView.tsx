import {
  AlertCircle,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCw
} from 'lucide-react';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { IssueList } from '../issues/IssuePresenter.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useEffect, useRef, useState } from 'react';

type LiveCheckState = 'pending' | 'checking' | 'ready' | 'failed';

export function RuntimeComponentsSettingsView(props: {
  connected: boolean;
  controller: RuntimeDependenciesController;
}) {
  const { language, t } = useAppLanguage();
  const status = props.controller.ytDlpStatus;
  const busy = props.controller.phase !== 'idle';
  const issues = props.controller.issues ?? [];
  const [checkNotice, setCheckNotice] = useState<string>();
  const [liveCheckState, setLiveCheckState] = useState<LiveCheckState>('pending');
  const liveCheckStarted = useRef(false);
  const hasIssue = issues.length > 0;

  useEffect(() => {
    if (
      !props.connected
      || status === undefined
      || props.controller.phase !== 'idle'
      || liveCheckStarted.current
    ) return;

    liveCheckStarted.current = true;
    setLiveCheckState('checking');
    void Promise.resolve(props.controller.checkYtDlpUpdate(true))
      .then(() => setLiveCheckState('ready'))
      .catch(() => setLiveCheckState('failed'));
  }, [
    props.connected,
    props.controller,
    props.controller.phase,
    status
  ]);

  if (!props.connected) {
    return (
      <section className="settings-section settings-management" aria-labelledby="runtime-components-title">
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
      <section className="settings-section settings-management" aria-labelledby="runtime-components-title">
        <SettingsHeader />
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
      </section>
    );
  }

  const checking = liveCheckState === 'pending' || liveCheckState === 'checking';
  const fresh = liveCheckState === 'ready';
  const statusLabel = checking
    ? t('settings.runtimeComponents.checking')
    : liveCheckState === 'failed'
      ? t('settings.runtimeComponents.checkFailed')
      : status.updateAvailable
        ? t('settings.runtimeComponents.updateAvailable')
        : t('settings.runtimeComponents.current');
  const statusKind = checking || liveCheckState === 'failed'
    ? 'checking'
    : status.updateAvailable ? 'update' : 'current';

  return (
    <section className="settings-section settings-management" aria-labelledby="runtime-components-title">
      <SettingsHeader />
      <article className="runtime-component-item">
        <div className="runtime-component-heading">
          <div>
            <div className="runtime-component-title">
              <h2>yt-dlp nightly</h2>
              <span data-status={statusKind}>
                {statusLabel}
              </span>
            </div>
            <p>{t('settings.runtimeComponents.ytDlpDescription')}</p>
            <p>{t('settings.runtimeComponents.autoCheck')}</p>
            {!hasIssue ? <p>{t('settings.runtimeComponents.fallback')}</p> : null}
          </div>
          <CheckCircle2
            size={19}
            aria-hidden="true"
            data-status={statusKind}
          />
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
              : status.latestVersion ?? t('settings.runtimeComponents.notChecked')}</dd>
          </div>
          <div>
            <dt>{t('settings.runtimeComponents.lastChecked')}</dt>
            <dd>{formatDate(status.lastCheckedAt, language, t('settings.runtimeComponents.notChecked'))}</dd>
          </div>
          <div>
            <dt>{t('settings.runtimeComponents.installedAt')}</dt>
            <dd>{formatDate(status.installedAt, language, t('settings.runtimeComponents.notChecked'))}</dd>
          </div>
        </dl>

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

        <footer className="runtime-component-footer">
          <div className="runtime-component-actions">
            <button
              className="settings-secondary-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setCheckNotice(undefined);
                void props.controller.checkYtDlpUpdate(true)
                  .then(result => setCheckNotice(result.updateAvailable
                    ? t('settings.runtimeComponents.updateAvailable')
                    : t('settings.runtimeComponents.latestNotice')))
                  .catch(() => undefined);
              }}
            >
              {props.controller.phase === 'checking'
                ? <LoaderCircle className="settings-spin" size={15} aria-hidden="true" />
                : <RefreshCw size={15} aria-hidden="true" />}
              {t('settings.runtimeComponents.check')}
            </button>
            {fresh && status.updateAvailable && status.latestVersion !== null ? (
              <button
                className="settings-primary-button"
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
  language: 'zh-CN' | 'en-US' | 'sv-SE',
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
