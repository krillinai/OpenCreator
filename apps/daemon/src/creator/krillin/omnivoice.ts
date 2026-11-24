import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const workerFile = fileURLToPath(new URL('../../../runtime/omnivoice/worker.py', import.meta.url));
const modelFiles = fileURLToPath(new URL('../../../runtime/omnivoice/model_files.py', import.meta.url));
type Python = { program: string; prefix: string[] };
type ModelStatus = { state: 'ready' | 'missing' | 'preparing' | 'failed'; path?: string | null; error?: string };
let preparation: Promise<{ python: Python; path: string }> | undefined;
let preparationController: AbortController | undefined;
let preparationError: string | undefined;
type Endpoint = { port: number; token: string };
let instance: Promise<Endpoint> | undefined;
let lifetime: AbortController | undefined;

async function resolvePython(signal: AbortSignal, install: boolean) {
  const override = process.env.OPENCREATOR_OMNIVOICE_PYTHON;
  const interpreters = override ? [[override]] : process.platform === 'win32'
    ? [['py', '-3'], ['python']]
    : [['/opt/homebrew/bin/python3'], ['/usr/local/bin/python3'], ['python3']];
  for (const [program, ...prefix] of interpreters) {
    if (!program) continue;
    try {
      await run(program, [...prefix, '-c', 'import sys; assert sys.version_info >= (3, 10)'], { windowsHide: true, signal });
    } catch { continue; }
    const probe = ['-c', 'import importlib.util as u; assert u.find_spec("omnivoice") and u.find_spec("torch")'];
    try {
      await run(program, [...prefix, ...probe], { windowsHide: true, signal });
      return { program, prefix };
    } catch { /* Install in an app-owned environment. */ }
    const root = join(homedir(), '.cache', 'opencreator', 'omnivoice-0.2.1');
    const python = join(root, process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
    try {
      await run(python, probe, { windowsHide: true, signal });
    } catch {
      if (!install) continue;
      await mkdir(root, { recursive: true, mode: 0o700 });
      await run(program, [...prefix, '-m', 'venv', root], { windowsHide: true, signal });
      await run(python, ['-m', 'pip', 'install', '--disable-pip-version-check', '--quiet', 'omnivoice==0.2.1'],
        { windowsHide: true, signal, timeout: 30 * 60_000 });
    }
    return { program: python, prefix: [] };
  }
  if (install) throw new Error('OmniVoice requires Python 3.10 or later. Set OPENCREATOR_OMNIVOICE_PYTHON to select an interpreter.');
  return undefined;
}

async function checkModelFiles(python: Python, install: boolean, signal: AbortSignal): Promise<ModelStatus> {
  const { stdout } = await run(python.program, [...python.prefix, modelFiles, install ? 'install' : 'status'], {
    signal, windowsHide: true, timeout: install ? 2 * 60 * 60_000 : 30_000,
    env: { ...process.env, PYTHONUTF8: '1', HF_HUB_DISABLE_PROGRESS_BARS: '1' }
  });
  return JSON.parse(stdout);
}

function diagnostic(error: unknown) {
  const stderr = (error as { stderr?: string })?.stderr;
  const message = stderr?.trim().split(/\r?\n/).at(-1) || (error instanceof Error ? error.message : 'OmniVoice preparation failed');
  return message.replace(/https?:\/\/\S+/g, '[URL]').slice(0, 500);
}

function prepareModel() {
  if (preparation) return preparation;
  preparationError = undefined;
  const controller = new AbortController();
  preparationController = controller;
  preparation = (async () => {
    const python = await resolvePython(controller.signal, true);
    if (!python) throw new Error('OmniVoice Python environment unavailable');
    const model = await checkModelFiles(python, true, controller.signal);
    if (model.state !== 'ready' || !model.path) throw new Error('Incomplete OmniVoice model files');
    return { python, path: model.path };
  })().catch(error => {
    preparationError = diagnostic(error);
    throw new Error(preparationError);
  }).finally(() => {
    preparation = undefined;
    preparationController = undefined;
  });
  return preparation;
}

export function downloadOmniVoiceComponent(): ModelStatus {
  void prepareModel().catch(() => { /* Failure is reported by the status route. */ });
  return { state: 'preparing' };
}

export async function omniVoiceComponentStatus(): Promise<ModelStatus> {
  if (preparation) return { state: 'preparing' };
  try {
    const signal = AbortSignal.timeout(30_000);
    const python = await resolvePython(signal, false);
    const status: ModelStatus = python ? await checkModelFiles(python, false, signal) : { state: 'missing' };
    return preparationError && status.state !== 'ready' ? { ...status, state: 'failed', error: preparationError } : status;
  } catch (error) {
    return { state: 'failed', error: diagnostic(error) };
  }
}

async function start(signal: AbortSignal): Promise<Endpoint> {
  const { python: { program, prefix }, path } = await prepareModel();
  signal.throwIfAborted();
  const token = randomBytes(32).toString('hex');
  const child = spawn(program, [...prefix, '-u', workerFile], {
    windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, PYTHONUTF8: '1', OPENCREATOR_OMNIVOICE_TOKEN: token, OPENCREATOR_OMNIVOICE_MODEL: path }
  });
  const stop = () => { child.stdin.end(); child.kill(); };
  process.once('exit', stop);
  signal.addEventListener('abort', stop, { once: true });
  return new Promise((resolve, reject) => {
    let diagnostic = '';
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      diagnostic = (diagnostic + chunk).slice(-1500);
    });
    const lines = createInterface({ input: child.stdout });
    const timer = setTimeout(() => { reject(new Error('OmniVoice model loading timed out. Check connectivity and free disk space.')); stop(); }, 30 * 60_000);
    lines.on('line', line => {
      const match = /^OMNIVOICE_READY (\d+) (mps|cuda:0|cpu)$/.exec(line);
      if (!match) return;
      clearTimeout(timer);
      resolve({ port: Number(match[1]), token });
    });
    child.once('error', reject);
    child.once('close', () => {
      process.off('exit', stop);
      signal.removeEventListener('abort', stop);
      clearTimeout(timer);
      if (lifetime?.signal === signal) instance = undefined;
      const last = diagnostic.trim().split(/\r?\n/).at(-1)?.replace(/https?:\/\/\S+/g, '[URL]');
      reject(new Error('OmniVoice startup failed: ' + (last || 'Check Python dependencies and model files.')));
    });
  });
}

export async function omniVoiceEndpoint(signal?: AbortSignal): Promise<Endpoint> {
  signal?.throwIfAborted();
  if (!instance) {
    const controller = new AbortController();
    lifetime = controller;
    instance = start(controller.signal).catch(error => {
      if (lifetime === controller) instance = undefined;
      throw error;
    });
  }
  if (!signal) return instance;
  const ready = instance;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    void ready.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function closeOmniVoiceWorker() {
  preparationController?.abort();
  lifetime?.abort();
  lifetime = undefined;
  instance = undefined;
}

export async function synthesizeOmniVoice(input: {
  text: string; language: string; reference: string; speed: number; format: 'mp3' | 'wav'; signal?: AbortSignal;
}) {
  const { port, token } = await omniVoiceEndpoint(input.signal);
  const timeout = AbortSignal.timeout(30 * 60_000);
  const response = await fetch(`http://127.0.0.1:${port}/speech`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...input, signal: undefined }),
    signal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  });
  if (!response.ok) throw new Error((await response.text()).slice(0, 500));
  return { content: Buffer.from(await response.arrayBuffer()), format: input.format };
}
