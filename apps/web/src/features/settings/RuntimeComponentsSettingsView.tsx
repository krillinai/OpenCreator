import {
  AlertCircle,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCw
} from 'lucide-react';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useState } from 'react';

export function RuntimeComponentsSettingsView(props: {
  connected: boolean;
  controller: RuntimeDependenciesController;
}) {
  const { language, t } = useAppLanguage();
  const status = props.controller.ytDlpStatus;
  const busy = props.controller.phase !== 'idle';
  const [checkNotice, setCheckNotice] = useState<string>();
  const error = props.controller.error === undefined
    ? undefined
    : formatRuntimeDependencyError(props.controller.error, t);

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
        {error === undefined ? (
          <div className="settings-state">
            <LoaderCircle className="settings-spin" size={17} aria-hidden="true" />
            <span>{t('settings.runtimeComponents.loading')}</span>
          </div>
        ) : (
          <div className="runtime-component-empty">
            <p className="settings-error" role="alert">{error}</p>
            <button
              className="settings-secondary-button"
              type="button"
              disabled={busy}
              onClick={() => void props.controller.checkYtDlpUpdate(true).catch(() => undefined)}
            >
              <RefreshCw size={15} aria-hidden="true" />
              {t('settings.runtimeComponents.retry')}
            </button>
          </div>
        )}
      </section>
    );
  }

  const statusLabel = status.updateAvailable
    ? t('settings.runtimeComponents.updateAvailable')
    : t('settings.runtimeComponents.current');

  return (
    <section className="settings-section settings-management" aria-labelledby="runtime-components-title">
      <SettingsHeader />
      <article className="runtime-component-item">
        <div className="runtime-component-heading">
          <div>
            <div className="runtime-component-title">
              <h2>yt-dlp nightly</h2>
              <span data-status={status.updateAvailable ? 'update' : 'current'}>
                {statusLabel}
              </span>
            </div>
            <p>{t('settings.runtimeComponents.ytDlpDescription')}</p>
            <p>{t('settings.runtimeComponents.autoCheck')}</p>
            {error === undefined ? <p>{t('settings.runtimeComponents.fallback')}</p> : null}
          </div>
          <CheckCircle2
            size={19}
            aria-hidden="true"
            data-status={status.updateAvailable ? 'update' : 'current'}
          />
        </div>

        <dl className="runtime-component-details">
          <div>
            <dt>{t('settings.runtimeComponents.currentVersion')}</dt>
            <dd>{status.currentVersion}</dd>
          </div>
          <div>
            <dt>{t('settings.runtimeComponents.latestVersion')}</dt>
            <dd>{status.latestVersion ?? t('settings.runtimeComponents.notChecked')}</dd>
          </div>
          <div>
            <dt>{t('settings.runtimeComponents.installedAt')}</dt>
            <dd>{formatDate(status.installedAt, language, t('settings.runtimeComponents.notChecked'))}</dd>
          </div>
        </dl>

        {error === undefined ? null : (
          <p className="settings-error" role="alert">{error}</p>
        )}
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
            {status.updateAvailable && status.latestVersion !== null ? (
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

function formatRuntimeDependencyError(
  message: string,
  t: ReturnType<typeof useAppLanguage>['t']
): string {
  if (/creator_yt_dlp_update_download_failed/i.test(message)) {
    return t('settings.runtimeComponents.errorDownload');
  }
  if (/creator_yt_dlp_update_verification_failed/i.test(message)) {
    return t('settings.runtimeComponents.errorVerification');
  }
  if (/creator_yt_dlp_update_storage_failed/i.test(message)) {
    return t('settings.runtimeComponents.errorStorage');
  }
  if (/runtime_dependency_unavailable/i.test(message)) {
    return t('settings.runtimeComponents.disconnected');
  }
  return t('settings.runtimeComponents.errorCheck');
}
