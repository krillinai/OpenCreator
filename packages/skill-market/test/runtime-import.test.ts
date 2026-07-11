import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceDir = dirname(dirname(packageDir));

describe('skill market runtime exports', () => {
  it('builds from a clean dist and loads through native Node consumers', () => {
    rmSync(join(packageDir, 'dist'), { recursive: true, force: true });

    execFileSync('pnpm', ['--filter', '@clawee/daemon', 'build'], {
      cwd: workspaceDir,
      stdio: 'pipe'
    });

    const output = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        [
          "const market = await import('@clawee/skill-market');",
          "if (market.skillMarketCatalog.length !== 55) throw new Error('catalog import failed');",
          "const { buildServer } = await import('./dist/api/server.js');",
          "const { mkdtempSync, rmSync } = await import('node:fs');",
          "const { tmpdir } = await import('node:os');",
          "const { join } = await import('node:path');",
          "const smokeRoot = mkdtempSync(join(tmpdir(), 'clawee-daemon-runtime-smoke-'));",
          "const server = await buildServer({",
          "  token: 'runtime-smoke-token',",
          "  dataDir: join(smokeRoot, 'data'),",
          "  codexHome: join(smokeRoot, 'codex-home'),",
          "  schedulerAutostart: false",
          "});",
          "await server.ready();",
          "await server.close();",
          "rmSync(smokeRoot, { recursive: true, force: true });",
          "process.stdout.write('runtime-import-ok');"
        ].join('\n')
      ],
      {
        cwd: join(workspaceDir, 'apps/daemon'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );

    expect(output).toBe('runtime-import-ok');
  });
});
