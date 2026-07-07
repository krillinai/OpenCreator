import { useState } from 'react';

export type RuntimeStatus = {
  connected: boolean;
  runtimeVersion?: string;
  codexVersion?: string;
  codexPath?: string;
  codexHome?: string;
  lastCheckedAt?: string;
};

export type ClaweeSettingsViewProps = {
  runtimeStatus: RuntimeStatus;
  onBack(): void;
};

type SettingsTab = 'general' | 'plugins' | 'about';

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: '常规' },
  { id: 'plugins', label: '插件' },
  { id: 'about', label: '关于 Clawee' }
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
        {activeTab === 'general' ? <GeneralSettings /> : null}
        {activeTab === 'plugins' ? <PluginSettings runtimeStatus={props.runtimeStatus} /> : null}
        {activeTab === 'about' ? <AboutSettings runtimeStatus={props.runtimeStatus} /> : null}
      </main>
    </div>
  );
}

function GeneralSettings() {
  return (
    <section className="settings-section" aria-labelledby="settings-general-title">
      <header>
        <h1 id="settings-general-title">常规</h1>
        <p>调整 Clawee 的默认偏好和桌面显示方式。</p>
      </header>
      <div className="settings-card">
        <SettingsRow label="默认权限" value="跟随项目设置" />
        <SettingsRow label="默认文件打开方式" value="系统默认应用" />
        <SettingsRow label="语言" value="中文" />
        <SettingsRow label="菜单栏显示" value="开启" />
      </div>
    </section>
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
