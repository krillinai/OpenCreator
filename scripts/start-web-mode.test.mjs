import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcher = join(root, 'scripts', 'start-web-mode.mjs');

test('Web startup modes pass the selected gateway origin to the existing dev command', () => {
  const temp = mkdtempSync(join(tmpdir(), 'opencreator-web-mode-'));
  const fakePnpm = join(temp, 'pnpm.cjs');
  writeFileSync(fakePnpm, 'process.stdout.write(JSON.stringify({ origin: process.env.OPENCREATOR_GATEWAY_ORIGIN, home: process.env.OPENCREATOR_HOME, args: process.argv.slice(2), cwd: process.cwd() }));\n');
  try {
    for (const [mode, origin, home] of [
      ['test', 'https://test.open-creator.ai', join(homedir(), '.opencreator', 'development-test')],
      ['production', 'https://open-creator.ai', join(homedir(), '.opencreator', 'development')]
    ]) {
      const result = spawnSync(process.execPath, [launcher, mode], {
        cwd: root,
        env: { ...process.env, npm_execpath: fakePnpm, OPENCREATOR_GATEWAY_ORIGIN: 'https://wrong.example' },
        encoding: 'utf8'
      });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout.trim().split('\n').at(-1)), {
        origin, home, args: ['--filter', '@opencreator/web', 'dev'], cwd: root
      });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Web startup modes are available from the repository root and apps/web', () => {
  const rootScripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  const webScripts = JSON.parse(readFileSync(join(root, 'apps/web/package.json'), 'utf8')).scripts;
  for (const mode of ['test', 'production']) {
    assert.match(rootScripts[`dev:${mode}`], new RegExp(`start-web-mode\\.mjs ${mode}$`));
    assert.match(webScripts[`dev:${mode}`], new RegExp(`start-web-mode\\.mjs ${mode}$`));
  }
});
