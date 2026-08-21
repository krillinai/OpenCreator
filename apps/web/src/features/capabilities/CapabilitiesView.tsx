import type { CodexMcpListResponse, CodexSkillListResponse } from '@opencreator/protocol';
import type { CodexProfileListResponse } from '../../services/capability-service.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export type CapabilitiesViewProps = {
  connected: boolean;
  skills?: CodexSkillListResponse;
  mcp?: CodexMcpListResponse;
  profiles?: CodexProfileListResponse;
};

export function CapabilitiesView(props: CapabilitiesViewProps) {
  const l = useLocalizedCopy();
  if (!props.connected) {
    return (
      <div className="panel-scroll">
        {l('本机 Runtime 就绪后查看技能、MCP 和 Profiles', 'Connect the local Runtime to view Skills, MCP, and Profiles')}
      </div>
    );
  }

  return (
    <div className="panel-scroll">
      <h2>能力</h2>
      <section>
        <h3>{l('技能', 'Skills')}</h3>
        <p>{props.skills?.skills.length ?? 0} {l('个技能', 'skills')}</p>
      </section>
      <section>
        <h3>MCP</h3>
        <p>{props.mcp?.servers.length ?? 0} 个 servers</p>
      </section>
      <section>
        <h3>Profiles</h3>
        <p>{props.profiles?.profiles.length ?? 0} 个 profiles</p>
      </section>
    </div>
  );
}
