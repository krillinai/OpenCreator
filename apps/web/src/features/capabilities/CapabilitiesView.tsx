import type { CodexMcpListResponse, CodexSkillListResponse } from '@clawee/protocol';
import type { CodexProfileListResponse } from '../../services/capability-service.js';

export type CapabilitiesViewProps = {
  connected: boolean;
  skills?: CodexSkillListResponse;
  mcp?: CodexMcpListResponse;
  profiles?: CodexProfileListResponse;
};

export function CapabilitiesView(props: CapabilitiesViewProps) {
  if (!props.connected) {
    return <div className="panel-scroll">连接 Runtime 后查看 Skills、MCP 和 Profiles</div>;
  }

  return (
    <div className="panel-scroll">
      <h2>能力</h2>
      <div>{props.skills?.skills.length ?? 0} 个 skills</div>
      <div>{props.mcp?.servers.length ?? 0} 个 servers</div>
      <div>{props.profiles?.profiles.length ?? 0} 个 profiles</div>
    </div>
  );
}
