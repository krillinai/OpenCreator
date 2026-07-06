import type { CodexMcpListResponse, CodexSkillListResponse } from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export type CodexProfileListResponse = {
  codexHome: string;
  codexHomeMode: 'global' | 'isolated';
  writable: boolean;
  baseConfigValid: boolean;
  profiles: Array<{
    name: string;
    status: 'valid' | 'invalid';
    config: Record<string, unknown>;
    diagnostics: string[];
    source: string;
    codexHomeMode: 'global' | 'isolated';
    updatedAt?: string;
  }>;
  diagnostics: string[];
};

export function createCapabilityService(client: RuntimeClient) {
  return {
    listSkills(): Promise<CodexSkillListResponse> {
      return client.get('/codex/skills');
    },
    listMcp(): Promise<CodexMcpListResponse> {
      return client.get('/codex/mcp');
    },
    listProfiles(): Promise<CodexProfileListResponse> {
      return client.get('/codex/profiles');
    }
  };
}
