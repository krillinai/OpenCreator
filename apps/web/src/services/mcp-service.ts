import type {
  AddCodexMcpRequest,
  CodexMcpAddResponse,
  CodexMcpAuthResponse,
  CodexMcpListResponse,
  CodexMcpRemoveResponse,
  CodexMcpServerDetailResponse
} from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createMcpService(client: RuntimeClient) {
  return {
    listServers(): Promise<CodexMcpListResponse> {
      return client.get('/codex/mcp');
    },
    getServer(name: string): Promise<CodexMcpServerDetailResponse> {
      return client.get(`/codex/mcp/${encodeURIComponent(name)}`);
    },
    addServer(input: AddCodexMcpRequest): Promise<CodexMcpAddResponse> {
      return client.post('/codex/mcp/add', input);
    },
    removeServer(name: string, confirmWriteToCodexHome = false): Promise<CodexMcpRemoveResponse> {
      const confirmation = confirmWriteToCodexHome ? '?confirmWriteToCodexHome=true' : '';
      return client.delete(`/codex/mcp/${encodeURIComponent(name)}${confirmation}`);
    },
    loginServer(name: string, confirmWriteToCodexHome = false): Promise<CodexMcpAuthResponse> {
      const path = `/codex/mcp/${encodeURIComponent(name)}/login`;
      return confirmWriteToCodexHome
        ? client.post(path, { confirmWriteToCodexHome: true })
        : client.post(path);
    },
    logoutServer(name: string, confirmWriteToCodexHome = false): Promise<CodexMcpAuthResponse> {
      const path = `/codex/mcp/${encodeURIComponent(name)}/logout`;
      return confirmWriteToCodexHome
        ? client.post(path, { confirmWriteToCodexHome: true })
        : client.post(path);
    }
  };
}
