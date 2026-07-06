import type { RunDiagnosticsResponse } from '@clawee/protocol';
import type { RuntimeClient } from '../runtime/client.js';

export function createDiagnosticsService(client: RuntimeClient) {
  return {
    getRunDiagnostics(runId: string): Promise<RunDiagnosticsResponse> {
      return client.get(`/runs/${encodeURIComponent(runId)}/diagnostics`);
    }
  };
}
