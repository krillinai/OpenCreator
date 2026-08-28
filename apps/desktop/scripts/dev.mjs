import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { connect } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const electron = require('electron');
const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');
const rootDir = resolve(desktopDir, '../..');
let webProcess;

try {
  await run('pnpm', ['--filter', '@opencreator/daemon', 'build'], rootDir);
  await run('pnpm', ['--filter', '@opencreator/desktop', 'build'], rootDir);
  if (!(await isPortOpen(19861))) {
    webProcess = spawn('pnpm', ['--filter', '@opencreator/web', 'dev'], {
      cwd: rootDir,
      env: process.env,
      stdio: 'inherit'
    });
    await waitForPort(19861, 30_000);
  }
  const code = await run(electron, ['.'], desktopDir, {
    ...process.env,
    OPENCREATOR_DESKTOP_DEV: '1'
  });
  process.exitCode = code;
} finally {
  webProcess?.kill('SIGTERM');
}

function run(command, args, cwd, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => resolvePromise(code ?? 1));
  }).then(code => {
    if (code !== 0) throw new Error(`${command} exited with code ${code}`);
    return code;
  });
}

function isPortOpen(port) {
  return new Promise(resolvePromise => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.setTimeout(250);
    socket.once('connect', () => {
      socket.destroy();
      resolvePromise(true);
    });
    const close = () => {
      socket.destroy();
      resolvePromise(false);
    };
    socket.once('timeout', close);
    socket.once('error', close);
  });
}

async function waitForPort(port, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(port)) return;
    await new Promise(resolvePromise => setTimeout(resolvePromise, 200));
  }
  throw new Error(`Timed out waiting for 127.0.0.1:${port}`);
}
