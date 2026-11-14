import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const origins = {
  test: 'https://test.open-creator.ai',
  production: 'https://open-creator.ai'
};
const mode = process.argv[2];
const origin = origins[mode];
if (!origin) {
  console.error('Usage: start-web-mode.mjs <test|production>');
  process.exitCode = 2;
} else {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const pnpm = process.env.npm_execpath;
  const child = spawn(pnpm ? process.execPath : 'pnpm', [
    ...(pnpm ? [pnpm] : []), '--filter', '@opencreator/web', 'dev'
  ], {
    cwd: root,
    env: {
      ...process.env,
      OPENCREATOR_GATEWAY_ORIGIN: origin,
      OPENCREATOR_HOME: join(homedir(), '.opencreator', mode === 'test' ? 'development-test' : 'development')
    },
    stdio: 'inherit',
    detached: process.platform !== 'win32'
  });
  console.log(`OpenCreator ${mode} gateway: ${origin}`);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (child.pid && process.platform !== 'win32') process.kill(-child.pid, signal);
      else child.kill(signal);
    });
  }
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('close', (code, signal) => {
    process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  });
}
