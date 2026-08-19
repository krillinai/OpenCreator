import type { CodexMcpListResponse, CodexSkillListResponse } from '@opencreator/protocol';
import type { CodexProfileListResponse } from '../../services/capability-service.js';

export type CapabilitiesViewProps = {
  connected: boolean;
  skills?: CodexSkillListResponse;
  mcp?: CodexMcpListResponse;
  profiles?: CodexProfileListResponse;
};

export function CapabilitiesView(props: CapabilitiesViewProps) {
  if (!props.connected) {
    return <div className="panel-scroll">本机 Runtime 就绪后查看 Skills、MCP 和 Profiles</div>;
  }

  return (
    <div className="panel-scroll">
      <h2>能力</h2>
      <section>
        <h3>Skills</h3>
        <p>{props.skills?.skills.length ?? 0} 个 skills</p>
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
