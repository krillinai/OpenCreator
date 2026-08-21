import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  ConnectionsPage,
  type ConnectionsPageProps
} from '../connections/ConnectionsPage.js';
import type { SkillMarketViewProps } from './SkillMarketView.js';
import { SkillMarketView } from './SkillMarketView.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './skill-market.css';

export type PluginCenterTab = 'skills' | 'connections';

export type PluginsPageProps = SkillMarketViewProps & {
  activeTab?: PluginCenterTab;
  connections: ConnectionsPageProps;
  onTabChange?(tab: PluginCenterTab): void;
};

export default function PluginsPage(props: PluginsPageProps) {
  const l = useLocalizedCopy();
  const activeTab = props.activeTab ?? 'skills';

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextTab: PluginCenterTab = activeTab === 'skills' ? 'connections' : 'skills';
    props.onTabChange?.(nextTab);
    const tabList = event.currentTarget.closest('[role="tablist"]');
    const nextButton = tabList?.querySelector<HTMLButtonElement>(`#plugin-center-tab-${nextTab}`);
    window.requestAnimationFrame(() => nextButton?.focus());
  }

  return (
    <section className="plugins-page" aria-label={l('插件中心', 'Plugins')}>
      <header className="plugin-center-header">
        <div className="plugin-center-tabs" role="tablist" aria-label={l('插件中心分类', 'Plugin categories')}>
          <button
            id="plugin-center-tab-skills"
            type="button"
            role="tab"
            aria-controls="plugin-center-panel-skills"
            aria-selected={activeTab === 'skills'}
            tabIndex={activeTab === 'skills' ? 0 : -1}
            onClick={() => props.onTabChange?.('skills')}
            onKeyDown={handleTabKeyDown}
          >
            {l('技能', 'Skills')}
          </button>
          <button
            id="plugin-center-tab-connections"
            type="button"
            role="tab"
            aria-controls="plugin-center-panel-connections"
            aria-selected={activeTab === 'connections'}
            tabIndex={activeTab === 'connections' ? 0 : -1}
            onClick={() => props.onTabChange?.('connections')}
            onKeyDown={handleTabKeyDown}
          >
            {l('连接器', 'Connectors')}
          </button>
        </div>
      </header>
      <div
        className="plugin-center-panel"
        id={`plugin-center-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`plugin-center-tab-${activeTab}`}
      >
        {activeTab === 'skills' ? (
          <SkillMarketView {...props} />
        ) : (
          <ConnectionsPage {...props.connections} />
        )}
      </div>
    </section>
  );
}
