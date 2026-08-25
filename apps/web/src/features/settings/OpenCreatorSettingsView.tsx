import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import type {
  CodexProfileListResponse,
  CodexStatusResponse
} from '@opencreator/protocol';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import type { ColorMode } from '../../styles/color-mode.js';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import type { AppLanguagePreference } from '../../i18n/language.js';
import {
  defaultCustomAccentColor,
  normalizeHexColor,
  type AccentColor
} from '../../styles/accent-color.js';
import type { ProjectPermission } from '../projects/project-model.js';
import { ProfileSettingsView, type ProfileSettingsService } from './ProfileSettingsView.js';
import { CleanupSettingsView, type CleanupSettingsService } from './CleanupSettingsView.js';
import { DiagnosticsSettingsView } from './DiagnosticsSettingsView.js';
import { CreatorServicesSettingsView } from './CreatorServicesSettingsView.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';
import {
  CodexRuntimeSettingsView,
  type CodexRuntimeSettingsService
} from './CodexRuntimeSettingsView.js';
import type { HostBridgeResult } from '../../host/bridge.js';
import {
  MemorySettingsView,
  type MemoryScopeOption,
  type MemorySettingsService
} from './MemorySettingsView.js';
import './settings-management.css';

export type RuntimeStatus = {
  connected: boolean;
  runtimeVersion?: string;
  codexVersion?: string;
  codexPath?: string;
  codexHome?: string;
  lastCheckedAt?: string;
};

export type DefaultPermissionPreference = 'follow-project' | ProjectPermission;

export type OpenCreatorSettingsViewProps = {
  runtimeStatus: RuntimeStatus;
  defaultPermission?: DefaultPermissionPreference;
  defaultPermissionError?: string;
  onDefaultPermissionChange?(permission: DefaultPermissionPreference): void;
  colorMode?: ColorMode;
  onColorModeChange?(mode: ColorMode): void;
  accentColor?: AccentColor;
  onAccentColorChange?(color: AccentColor): void;
  customAccentColor?: string;
  onCustomAccentColorChange?(color: string): void;
  desktopCloseBehavior?: 'hide' | 'quit';
  onDesktopCloseBehaviorChange?(behavior: 'hide' | 'quit'): void;
  profileService?: ProfileSettingsService | null;
  profileData?: CodexProfileListResponse;
  onProfileDataChange?(data: CodexProfileListResponse): void;
  cleanupService?: CleanupSettingsService | null;
  creatorServicesService?: CreatorServicesSettingsService | null;
  codexRuntimeService?: CodexRuntimeSettingsService | null;
  onOpenExternal?(url: string): Promise<void>;
  onSelectExternalCodex?(): Promise<HostBridgeResult>;
  memoryService?: MemorySettingsService | null;
  memoryProjects?: MemoryScopeOption[];
  memoryThreads?: MemoryScopeOption[];
  codexStatus?: CodexStatusResponse;
  initialTab?: 'general' | 'ai-services' | 'codex-agent';
  onBack(): void;
};

type SettingsTab = 'general' | 'ai-services' | 'codex-agent' | 'plugins' | 'memory' | 'profiles' | 'cleanup' | 'diagnostics' | 'about';

export function OpenCreatorSettingsView(props: OpenCreatorSettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>(() => props.initialTab ?? 'general');
  const { t } = useAppLanguage();
  const tabs: Array<{ id: SettingsTab; label: string }> = [
    { id: 'general', label: t('settings.tab.general') },
    { id: 'ai-services', label: t('settings.tab.aiServices') },
    { id: 'codex-agent', label: t('settings.tab.codexAgent') },
    { id: 'plugins', label: t('settings.tab.plugins') },
    { id: 'memory', label: t('settings.tab.memory') },
    { id: 'profiles', label: t('settings.tab.profiles') },
    { id: 'cleanup', label: t('settings.tab.cleanup') },
    { id: 'diagnostics', label: t('settings.tab.diagnostics') },
    { id: 'about', label: t('settings.tab.about') }
  ];

  return (
    <div className="settings-page">
      <aside className="settings-sidebar" aria-label={t('settings.navigation')}>
        <button className="settings-back" type="button" onClick={props.onBack}>
          {t('settings.back')}
        </button>
        <label className="settings-search">
          <span>{t('settings.search')}</span>
          <input
            type="search"
            placeholder={t('settings.searchUnavailable')}
            aria-describedby="settings-search-disabled"
            disabled
          />
          <span id="settings-search-disabled">{t('settings.searchUnavailable')}</span>
        </label>
        <nav className="settings-nav" aria-label={t('settings.categories')}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              aria-current={activeTab === tab.id ? 'page' : undefined}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </aside>
      <main className="settings-content">
        {activeTab === 'general' ? (
          <GeneralSettings
            defaultPermission={props.defaultPermission ?? 'follow-project'}
            defaultPermissionError={props.defaultPermissionError}
            onDefaultPermissionChange={props.onDefaultPermissionChange}
            colorMode={props.colorMode ?? 'dark'}
            onColorModeChange={props.onColorModeChange}
            accentColor={props.accentColor ?? 'neutral'}
            onAccentColorChange={props.onAccentColorChange}
            customAccentColor={props.customAccentColor ?? defaultCustomAccentColor}
            onCustomAccentColorChange={props.onCustomAccentColorChange}
            desktopCloseBehavior={props.desktopCloseBehavior}
            onDesktopCloseBehaviorChange={props.onDesktopCloseBehaviorChange}
          />
        ) : null}
        {activeTab === 'ai-services' ? (
          <CreatorServicesSettingsView
            connected={props.runtimeStatus.connected}
            service={props.creatorServicesService ?? null}
          />
        ) : null}
        {activeTab === 'codex-agent' ? (
          <CodexRuntimeSettingsView
            connected={props.runtimeStatus.connected}
            service={props.codexRuntimeService ?? null}
            onOpenExternal={props.onOpenExternal}
            onSelectExternalCodex={props.onSelectExternalCodex}
          />
        ) : null}
        {activeTab === 'plugins' ? <PluginSettings runtimeStatus={props.runtimeStatus} /> : null}
        {activeTab === 'memory' ? (
          <MemorySettingsView
            connected={props.runtimeStatus.connected}
            service={props.memoryService ?? null}
            projects={props.memoryProjects ?? []}
            threads={props.memoryThreads ?? []}
          />
        ) : null}
        {activeTab === 'profiles' ? (
          <ProfileSettingsView
            connected={props.runtimeStatus.connected}
            service={props.profileService ?? null}
            data={props.profileData}
            onDataChange={props.onProfileDataChange}
          />
        ) : null}
        {activeTab === 'cleanup' ? (
          <CleanupSettingsView
            connected={props.runtimeStatus.connected}
            service={props.cleanupService ?? null}
          />
        ) : null}
        {activeTab === 'diagnostics' ? (
          <DiagnosticsSettingsView
            connected={props.runtimeStatus.connected}
            runtimeVersion={props.runtimeStatus.runtimeVersion}
            codexStatus={props.codexStatus}
          />
        ) : null}
        {activeTab === 'about' ? <AboutSettings runtimeStatus={props.runtimeStatus} /> : null}
      </main>
    </div>
  );
}

function GeneralSettings(props: {
  defaultPermission: DefaultPermissionPreference;
  defaultPermissionError?: string;
  onDefaultPermissionChange?(permission: DefaultPermissionPreference): void;
  colorMode: ColorMode;
  onColorModeChange?(mode: ColorMode): void;
  accentColor: AccentColor;
  onAccentColorChange?(color: AccentColor): void;
  customAccentColor: string;
  onCustomAccentColorChange?(color: string): void;
  desktopCloseBehavior?: 'hide' | 'quit';
  onDesktopCloseBehaviorChange?(behavior: 'hide' | 'quit'): void;
}) {
  const { language, preference, setPreference, t } = useAppLanguage();
  const confirm = useConfirmDialog();
  const defaultPermissionOptions: Array<{
    value: DefaultPermissionPreference;
    label: string;
  }> = [
    { value: 'follow-project', label: t('settings.permission.followProject') },
    { value: 'workspace-write', label: t('settings.permission.approval') },
    { value: 'danger-full-access', label: t('settings.permission.fullAccess') }
  ];
  const languageName = language === 'zh-CN'
    ? t('settings.language.zh')
    : t('settings.language.en');
  const languageOptions: Array<{ value: AppLanguagePreference; label: string }> = [
    {
      value: 'system',
      label: t('settings.language.system', { language: languageName })
    },
    { value: 'zh-CN', label: t('settings.language.zh') },
    { value: 'en-US', label: t('settings.language.en') }
  ];

  return (
    <section className="settings-section" aria-labelledby="settings-general-title">
      <header>
        <h1 id="settings-general-title">{t('settings.tab.general')}</h1>
        <p>{t('settings.general.description')}</p>
      </header>
      <div className="settings-card">
        <SettingsColorModeRow
          value={props.colorMode}
          onChange={(mode) => props.onColorModeChange?.(mode)}
        />
        <SettingsAccentColorRow
          value={props.accentColor}
          customColor={props.customAccentColor}
          onChange={(color) => props.onAccentColorChange?.(color)}
          onCustomColorChange={(color) => props.onCustomAccentColorChange?.(color)}
        />
        <SettingsSelectRow
          id="settings-default-permission"
          label={t('settings.permission')}
          value={props.defaultPermission}
          options={defaultPermissionOptions}
          onChange={async permission => {
            if (
              permission === 'danger-full-access'
              && props.defaultPermission !== 'danger-full-access'
              && !await confirm({
                title: t('composer.fullAccess.title'),
                description: t('composer.fullAccess.description'),
                confirmLabel: t('composer.fullAccess.confirm')
              })
            ) {
              return;
            }
            props.onDefaultPermissionChange?.(permission);
          }}
        />
        <SettingsRow label={t('settings.defaultFileApp')} value={t('settings.systemDefaultApp')} />
        <SettingsSelectRow
          id="settings-display-language"
          label={t('settings.language')}
          value={preference}
          options={languageOptions}
          onChange={setPreference}
        />
        {props.desktopCloseBehavior === undefined ? (
          <SettingsRow label={t('settings.menuBar')} value={t('settings.browserMode')} />
        ) : (
          <label className="settings-row settings-control-row" htmlFor="settings-desktop-close-behavior">
            <span>{t('settings.closeWindow')}</span>
            <select
              id="settings-desktop-close-behavior"
              className="settings-select"
              value={props.desktopCloseBehavior}
              onChange={event => props.onDesktopCloseBehaviorChange?.(
                event.target.value as 'hide' | 'quit'
              )}
            >
              <option value="hide">{t('settings.hideToMenuBar')}</option>
              <option value="quit">{t('settings.quit')}</option>
            </select>
          </label>
        )}
      </div>
      {props.defaultPermissionError ? (
        <p className="settings-error" role="alert">{props.defaultPermissionError}</p>
      ) : null}
    </section>
  );
}

function SettingsColorModeRow(props: { value: ColorMode; onChange(mode: ColorMode): void }) {
  const labelId = 'settings-color-mode-label';
  const { t } = useAppLanguage();

  return (
    <div className="settings-row settings-control-row">
      <span id={labelId}>{t('settings.colorMode')}</span>
      <div className="settings-color-mode" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          aria-pressed={props.value === 'light'}
          onClick={() => props.onChange('light')}
        >
          <Sun size={14} aria-hidden="true" />
          {t('settings.light')}
        </button>
        <button
          type="button"
          aria-pressed={props.value === 'dark'}
          onClick={() => props.onChange('dark')}
        >
          <Moon size={14} aria-hidden="true" />
          {t('settings.dark')}
        </button>
      </div>
    </div>
  );
}

function SettingsAccentColorRow(props: {
  value: AccentColor;
  customColor: string;
  onChange(color: AccentColor): void;
  onCustomColorChange(color: string): void;
}) {
  const { t } = useAppLanguage();
  const labelId = 'settings-accent-color-label';
  const inputId = 'settings-custom-accent-color';
  const normalizedCustomColor = normalizeHexColor(props.customColor) ?? defaultCustomAccentColor;
  const [draft, setDraft] = useState(normalizedCustomColor);
  const [error, setError] = useState<string>();
  const inputFocusedRef = useRef(false);
  const accentColorOptions: Array<{
    value: AccentColor;
    label: string;
    swatch: string;
  }> = [
    { value: 'neutral', label: t('settings.accent.neutral'), swatch: '#85858b' },
    { value: 'blue', label: t('settings.accent.blue'), swatch: '#3b82f6' },
    { value: 'cyan', label: t('settings.accent.cyan'), swatch: '#06b6d4' },
    { value: 'purple', label: t('settings.accent.purple'), swatch: '#8b5cf6' },
    { value: 'orange', label: t('settings.accent.orange'), swatch: '#f97316' },
    { value: 'red', label: t('settings.accent.red'), swatch: '#ef4444' }
  ];

  useEffect(() => {
    if (!inputFocusedRef.current) setDraft(normalizedCustomColor);
  }, [normalizedCustomColor]);

  function commitDraft() {
    const normalized = normalizeHexColor(draft);
    if (normalized === undefined) {
      setError(t('settings.accent.invalid'));
      return;
    }
    setDraft(normalized);
    setError(undefined);
    props.onCustomColorChange(normalized);
  }

  return (
    <div className="settings-row settings-control-row settings-accent-row">
      <span id={labelId}>{t('settings.accent')}</span>
      <div className="settings-accent-controls">
        <div className="settings-accent-color">
          <div className="settings-accent-options" role="radiogroup" aria-labelledby={labelId}>
            {accentColorOptions.map(option => {
              const selected = props.value === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={option.label}
                  title={option.label}
                  style={{ '--settings-accent-swatch': option.swatch } as CSSProperties}
                  onClick={() => props.onChange(option.value)}
                >
                  <span className="settings-accent-swatch" aria-hidden="true">
                    {selected ? <Check size={11} strokeWidth={2.5} /> : null}
                  </span>
                </button>
              );
            })}
            <div className="settings-custom-accent-option">
              <span className="settings-accent-separator" aria-hidden="true">｜</span>
              <button
                className="settings-custom-accent-choice"
                type="button"
                role="radio"
                aria-checked={props.value === 'custom'}
                aria-label={t('settings.accent.custom')}
                title={t('settings.accent.custom')}
                style={{ '--settings-accent-swatch': normalizedCustomColor } as CSSProperties}
                onClick={() => props.onChange('custom')}
              >
                <span className="settings-accent-swatch" aria-hidden="true">
                  {props.value === 'custom' ? <Check size={11} strokeWidth={2.5} /> : null}
                </span>
                <span className="settings-custom-accent-text">{t('settings.accent.custom')}</span>
              </button>
            </div>
          </div>
          <div className="settings-custom-accent">
            <label className="settings-custom-accent-input-label" htmlFor={inputId}>
              {t('settings.accent.customValue')}
            </label>
            <input
              id={inputId}
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={draft}
              aria-invalid={error === undefined ? undefined : 'true'}
              aria-describedby={error === undefined ? undefined : `${inputId}-error`}
              onFocus={() => {
                inputFocusedRef.current = true;
              }}
              onChange={event => {
                const nextDraft = event.target.value;
                setDraft(nextDraft);
                const normalized = normalizeHexColor(nextDraft);
                if (normalized === undefined) return;
                setError(undefined);
                props.onCustomColorChange(normalized);
              }}
              onBlur={() => {
                inputFocusedRef.current = false;
                commitDraft();
              }}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitDraft();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  setDraft(normalizedCustomColor);
                  setError(undefined);
                }
              }}
            />
            {error === undefined ? null : (
              <p id={`${inputId}-error`} className="settings-custom-accent-error" role="alert">
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function PluginSettings(props: { runtimeStatus: RuntimeStatus }) {
  const { t } = useAppLanguage();
  const checkedAt = props.runtimeStatus.lastCheckedAt ?? t('settings.notChecked');
  const status = props.runtimeStatus.connected
    ? t('settings.plugins.ready')
    : t('settings.plugins.waiting');

  return (
    <section className="settings-section" aria-labelledby="settings-plugins-title">
      <header>
        <h1 id="settings-plugins-title">{t('settings.tab.plugins')}</h1>
        <p>{t('settings.plugins.description')}</p>
      </header>
      <div className="settings-card">
        <SettingsRow label={t('settings.plugins.skillsStatus')} value={status} />
        <SettingsRow
          label={t('settings.plugins.mcpStatus')}
          value={props.runtimeStatus.connected
            ? t('settings.plugins.available')
            : t('settings.plugins.unavailable')}
        />
        <SettingsRow label={t('settings.lastChecked')} value={checkedAt} />
      </div>
    </section>
  );
}

function AboutSettings(props: { runtimeStatus: RuntimeStatus }) {
  const { t } = useAppLanguage();
  const runtimeStatusText = props.runtimeStatus.connected
    ? t('settings.status.normal')
    : t('settings.status.disconnected');

  return (
    <section className="settings-section" aria-labelledby="settings-about-title">
      <header>
        <h1 id="settings-about-title">{t('settings.tab.about')}</h1>
        <p>{t('settings.about.description')}</p>
      </header>
      <div className="settings-card">
        <SettingsRow label={t('settings.about.version')} value="0.1.0" />
        <SettingsRow
          label={t('settings.about.runtimeVersion')}
          value={props.runtimeStatus.runtimeVersion ?? t('settings.unknown')}
        />
        <SettingsRow
          label={t('settings.about.dataDirectory')}
          value={props.runtimeStatus.codexHome ?? t('settings.notSet')}
        />
        <SettingsRow label={t('settings.about.checkUpdates')} value={t('settings.about.updateLater')} />
      </div>
      <section className="settings-card settings-advanced" aria-label={t('settings.about.advanced')}>
        <h2>{t('settings.about.advanced')}</h2>
        <SettingsRow
          label={t('settings.about.codexVersion')}
          value={props.runtimeStatus.codexVersion ?? t('settings.unknown')}
        />
        <SettingsRow
          label={t('settings.about.codexPath')}
          value={props.runtimeStatus.codexPath ?? t('settings.notSet')}
        />
        <SettingsRow label="CODEX_HOME" value={props.runtimeStatus.codexHome ?? t('settings.notSet')} />
        <SettingsRow label={t('settings.about.runtimeStatus')} value={runtimeStatusText} />
        <SettingsRow
          label={t('settings.lastCheckDetail')}
          value={props.runtimeStatus.lastCheckedAt ?? t('settings.notChecked')}
        />
      </section>
    </section>
  );
}

function SettingsRow(props: { label: string; value: string }) {
  return (
    <div className="settings-row">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function SettingsSelectRow<Value extends string>(props: {
  id: string;
  label: string;
  value: Value;
  options: Array<{ value: Value; label: string }>;
  onChange(value: Value): void;
}) {
  return (
    <label className="settings-row settings-control-row" htmlFor={props.id}>
      <span>{props.label}</span>
      <select
        id={props.id}
        className="settings-select"
        value={props.value}
        onChange={event => props.onChange(event.target.value as Value)}
      >
        {props.options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
