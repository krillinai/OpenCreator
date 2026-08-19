import type { RunDiagnosticsResponse } from '@opencreator/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createDiagnosticsService(client: RuntimeClient) {
  return {
    getRunDiagnostics(runId: string): Promise<RunDiagnosticsResponse> {
      return client.get(`/runs/${encodeURIComponent(runId)}/diagnostics`);
    }
  };
}
