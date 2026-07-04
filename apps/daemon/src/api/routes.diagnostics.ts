import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import type { FastifyInstance } from 'fastify';

export type DiagnosticFile = {
  name: string;
  content: string;
};

const allowedFiles = ['meta.json', 'events.ndjson', 'stderr.redacted.log', 'diagnostics.json'];
const runIdPattern = /^run_[A-Za-z0-9_-]+$/;

function isPathInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !path.includes(`..${sep}`));
}

export function collectRunDiagnostics(dataDir: string, runId: string): DiagnosticFile[] {
  if (!runIdPattern.test(runId)) return [];

  const runsDir = resolve(dataDir, 'runs');
  const runDir = resolve(runsDir, runId);
  if (!isPathInside(runsDir, runDir)) return [];

  const files: DiagnosticFile[] = [];
  for (const name of allowedFiles) {
    try {
      files.push({ name, content: readFileSync(resolve(runDir, name), 'utf8') });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return files;
}

export async function registerDiagnosticsRoutes(
  server: FastifyInstance,
  dataDir: string,
): Promise<void> {
  server.get('/runs/:id/diagnostics', async request => {
    const { id } = request.params as { id: string };
    return { runId: id, files: collectRunDiagnostics(dataDir, id) };
  });
}
