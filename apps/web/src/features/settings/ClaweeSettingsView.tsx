import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import type {
  CodexMcpListResponse,
  CodexProfileListResponse,
  CodexStatusResponse
} from '@clawee/protocol';
import type { ColorMode } from '../../styles/color-mode.js';
import type { ProjectPermission } from '../projects/project-model.js';
import { McpSettingsView, type McpCapabilities, type McpSettingsService } from './McpSettingsView.js';
import { ProfileSettingsView, type ProfileSettingsService } from './ProfileSettingsView.js';
import { CleanupSettingsView, type CleanupSettingsService } from './CleanupSettingsView.js';
import { DiagnosticsSettingsView } from './DiagnosticsSettingsView.js';
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

export type ClaweeSettingsViewProps = {
  runtimeStatus: RuntimeStatus;
  defaultPermission?: DefaultPermissionPreference;
  defaultPermissionError?: string;
  onDefaultPermissionChange?(permission: DefaultPermissionPreference): void;
  colorMode?: ColorMode;
  onColorModeChange?(mode: ColorMode): void;
  desktopCloseBehavior?: 'hide' | 'quit';
  onDesktopCloseBehaviorChange?(behavior: 'hide' | 'quit'): void;
  mcpService?: McpSettingsService | null;
  mcpData?: CodexMcpListResponse;
  mcpCapabilities?: McpCapabilities;
  onMcpDataChange?(data: CodexMcpListResponse): void;
  profileService?: ProfileSettingsService | null;
  profileData?: CodexProfileListResponse;
  onProfileDataChange?(data: CodexProfileListResponse): void;
  cleanupService?: CleanupSettingsService | null;
  memoryService?: MemorySettingsService | null;
  memoryProjects?: MemoryScopeOption[];
  memoryThreads?: MemoryScopeOption[];
  codexStatus?: CodexStatusResponse;
  onBack(): void;
};

type SettingsTab = 'general' | 'plugins' | 'memory' | 'mcp' | 'profiles' | 'cleanup' | 'diagnostics' | 'about';

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '常规' },
  { id: 'plugins', label: '插件' },
  { id: 'memory', label: '记忆' },
  { id: 'mcp', label: 'MCP 服务' },
  { id: 'profiles', label: 'Profiles' },
  { id: 'cleanup', label: '清理' },
  { id: 'diagnostics', label: '诊断' },
  { id: 'about', label: '关于 Clawee' }
];

const defaultPermissionOptions: Array<{
  value: DefaultPermissionPreference;
  label: string;
}> = [
  { value: 'follow-project', label: '跟随项目设置' },
  { value: 'workspace-write', label: '请求批准' },
  { value: 'danger-full-access', label: '完全访问权限' }
];

export function ClaweeSettingsView(props: ClaweeSettingsViewProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="settings-page">
      <aside className="settings-sidebar" aria-label="设置导航">
        <button className="settings-back" type="button" onClick={props.onBack}>
          返回应用
        </button>
        <label className="settings-search">
          <span>搜索设置</span>
          <input type="search" placeholder="搜索暂不可用" aria-describedby="settings-search-disabled" disabled />
          <span id="settings-search-disabled">搜索暂不可用</span>
        </label>
        <nav className="settings-nav" aria-label="设置分类">
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
            desktopCloseBehavior={props.desktopCloseBehavior}
            onDesktopCloseBehaviorChange={props.onDesktopCloseBehaviorChange}
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
        {activeTab === 'mcp' ? (
          <McpSettingsView
            connected={props.runtimeStatus.connected}
            service={props.mcpService ?? null}
            data={props.mcpData}
            capabilities={props.mcpCapabilities}
            onDataChange={props.onMcpDataChange}
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
  desktopCloseBehavior?: 'hide' | 'quit';
  onDesktopCloseBehaviorChange?(behavior: 'hide' | 'quit'): void;
}) {
  return (
    <section className="settings-section" aria-labelledby="settings-general-title">
      <header>
        <h1 id="settings-general-title">常规</h1>
        <p>调整 Clawee 的默认偏好和桌面显示方式。</p>
      </header>
      <div className="settings-card">
        <SettingsColorModeRow
          value={props.colorMode}
          onChange={(mode) => props.onColorModeChange?.(mode)}
        />
        <SettingsSelectRow
          label="默认权限"
          value={props.defaultPermission}
          options={defaultPermissionOptions}
          onChange={(permission) => {
            if (
              permission === 'danger-full-access'
              && props.defaultPermission !== 'danger-full-access'
              && !window.confirm(
                '完全访问权限允许 Clawee 访问本机文件并执行本地操作。确定要设为默认权限吗？'
              )
            ) {
              return;
            }
            props.onDefaultPermissionChange?.(permission);
          }}
        />
        <SettingsRow label="默认文件打开方式" value="系统默认应用" />
        <SettingsRow label="语言" value="中文" />
        {props.desktopCloseBehavior === undefined ? (
          <SettingsRow label="菜单栏显示" value="浏览器模式" />
        ) : (
          <label className="settings-row settings-control-row" htmlFor="settings-desktop-close-behavior">
            <span>关闭窗口时</span>
            <select
              id="settings-desktop-close-behavior"
              className="settings-select"
              value={props.desktopCloseBehavior}
              onChange={event => props.onDesktopCloseBehaviorChange?.(
                event.target.value as 'hide' | 'quit'
              )}
            >
              <option value="hide">隐藏到菜单栏</option>
              <option value="quit">退出 Clawee</option>
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

  return (
    <div className="settings-row settings-control-row">
      <span id={labelId}>颜色模式</span>
      <div className="settings-color-mode" role="group" aria-labelledby={labelId}>
        <button
          type="button"
          aria-pressed={props.value === 'light'}
          onClick={() => props.onChange('light')}
        >
          <Sun size={14} aria-hidden="true" />
          浅色
        </button>
        <button
          type="button"
          aria-pressed={props.value === 'dark'}
          onClick={() => props.onChange('dark')}
        >
          <Moon size={14} aria-hidden="true" />
          深色
        </button>
      </div>
    </div>
  );
}

function PluginSettings(props: { runtimeStatus: RuntimeStatus }) {
  const checkedAt = props.runtimeStatus.lastCheckedAt ?? '尚未检测';
  const status = props.runtimeStatus.connected ? '本地能力已就绪' : '等待本地能力连接';

  return (
    <section className="settings-section" aria-labelledby="settings-plugins-title">
      <header>
        <h1 id="settings-plugins-title">插件</h1>
        <p>管理 Clawee 可使用的本机扩展能力。</p>
      </header>
      <div className="settings-card">
        <SettingsRow label="Skills 状态" value={status} />
        <SettingsRow label="MCP 服务状态" value={props.runtimeStatus.connected ? '本地服务可用' : '本地服务未连接'} />
        <SettingsRow label="最近检测时间" value={checkedAt} />
      </div>
    </section>
  );
}

function AboutSettings(props: { runtimeStatus: RuntimeStatus }) {
  const runtimeStatusText = props.runtimeStatus.connected ? '正常' : '未连接';

  return (
    <section className="settings-section" aria-labelledby="settings-about-title">
      <header>
        <h1 id="settings-about-title">关于 Clawee</h1>
        <p>查看版本、数据目录和本地运行信息。</p>
      </header>
      <div className="settings-card">
        <SettingsRow label="Clawee 版本" value="0.1.0" />
        <SettingsRow label="Runtime 版本" value={props.runtimeStatus.runtimeVersion ?? '未知'} />
        <SettingsRow label="数据目录" value={props.runtimeStatus.codexHome ?? '未设置'} />
        <SettingsRow label="检查更新" value="手动检查稍后支持" />
      </div>
      <section className="settings-card settings-advanced" aria-label="高级信息">
        <h2>高级信息</h2>
        <SettingsRow label="Codex CLI 版本" value={props.runtimeStatus.codexVersion ?? '未知'} />
        <SettingsRow label="Codex CLI 路径" value={props.runtimeStatus.codexPath ?? '未设置'} />
        <SettingsRow label="CODEX_HOME" value={props.runtimeStatus.codexHome ?? '未设置'} />
        <SettingsRow label="本地运行内核状态" value={runtimeStatusText} />
        <SettingsRow label="最近一次检测时间" value={props.runtimeStatus.lastCheckedAt ?? '尚未检测'} />
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

function SettingsSelectRow(props: {
  label: string;
  value: DefaultPermissionPreference;
  options: Array<{ value: DefaultPermissionPreference; label: string }>;
  onChange(value: DefaultPermissionPreference): void;
}) {
  const labelId = `settings-select-${props.label}`;

  return (
    <label className="settings-row settings-control-row" htmlFor={labelId}>
      <span>{props.label}</span>
      <select
        id={labelId}
        className="settings-select"
        value={props.value}
        onChange={event => props.onChange(event.target.value as DefaultPermissionPreference)}
      >
        {props.options.map(option => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}
