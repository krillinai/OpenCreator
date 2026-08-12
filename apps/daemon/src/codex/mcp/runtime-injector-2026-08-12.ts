import type { RunMcpInjector } from '../../agent-tools/run-injection.js';
import {
  getCodexMcpConfigurationFingerprint
} from './config-store-2026-08-12.js';

export function createCodexMcpRuntimeInjector(input: {
  codexHome: string;
}): RunMcpInjector {
  return {
    async prepare() {
      return {
        mcpServers: [],
        env: {},
        configurationFingerprint:
          await getCodexMcpConfigurationFingerprint(input.codexHome)
      };
    }
  };
}
