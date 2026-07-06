import type { CodexStatusResponse } from '@clawee/protocol';
import type { RuntimeCapabilityMatrix } from './capabilities.js';
import type { ResolvedCodexHome } from './home.js';

export type BuildCodexStatusResponseInput = {
  codexBin: string;
  codexHome: ResolvedCodexHome;
  capabilities: RuntimeCapabilityMatrix;
};

export function buildCodexStatusResponse(
  input: BuildCodexStatusResponseInput
): CodexStatusResponse {
  return {
    codexBin: input.codexBin,
    codexVersion: input.capabilities.codexVersion,
    codexHome: input.codexHome.path,
    codexHomeMode: input.codexHome.mode,
    codexHomeSource: input.codexHome.source,
    codexHomeWritable: input.codexHome.writable,
    capabilities: input.capabilities,
    diagnostics: []
  };
}
