import type { SkillMarketViewProps } from './SkillMarketView.js';
import { SkillMarketView } from './SkillMarketView.js';
import {
  EnterpriseSkillHubView,
  type EnterpriseSkillHubViewProps
} from './EnterpriseSkillHubView-2026-07-30.js';
import './skill-market.css';

export type PluginSource = 'public' | 'enterprise';

export type PluginsPageProps = SkillMarketViewProps & {
  source?: PluginSource;
  onSourceChange(source: PluginSource): void;
  enterprise: EnterpriseSkillHubViewProps;
};

export default function PluginsPage(props: PluginsPageProps) {
  const source = props.source ?? 'enterprise';
  return (
    <section className="plugins-page" aria-label="插件">
      <header className="plugins-source-header">
        <div className="plugins-source-tabs" role="tablist" aria-label="Skill 来源">
          <button
            aria-controls="plugins-source-enterprise"
            aria-selected={source === 'enterprise'}
            id="plugins-source-enterprise-tab"
            onClick={() => props.onSourceChange('enterprise')}
            role="tab"
            tabIndex={source === 'enterprise' ? 0 : -1}
            type="button"
          >
            企业Skills
          </button>
          <button
            aria-controls="plugins-source-public"
            aria-selected={source === 'public'}
            id="plugins-source-public-tab"
            onClick={() => props.onSourceChange('public')}
            role="tab"
            tabIndex={source === 'public' ? 0 : -1}
            type="button"
          >
            Skill市场
          </button>
        </div>
      </header>
      <div
        aria-labelledby={`plugins-source-${source}-tab`}
        className="plugins-source-content"
        id={`plugins-source-${source}`}
        role="tabpanel"
      >
        {source === 'public' ? (
          <SkillMarketView
            connected={props.connected}
            currentProjectId={props.currentProjectId}
            installRecords={props.installRecords}
            loadError={props.loadError}
            loading={props.loading}
            operation={props.operation}
            projects={props.projects}
            skills={props.skills}
            useError={props.useError}
            onInstall={props.onInstall}
            onUpdate={props.onUpdate}
            onUse={props.onUse}
          />
        ) : (
          <EnterpriseSkillHubView {...props.enterprise} />
        )}
      </div>
    </section>
  );
}
