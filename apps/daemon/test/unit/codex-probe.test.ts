import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { probeCodex } from '../../src/codex/probe.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Codex Probe', () => {
  it('accepts a non-empty output-last-message response', async () => {
    const fixture = createProbeExecutable(`
const outputIndex = process.argv.indexOf('--output-last-message');
writeFileSync(process.argv[outputIndex + 1], 'hello from codex\\n');
console.log(JSON.stringify({ type: 'turn.completed' }));
`);

    const result = await probeCodex({
      codexBin: fixture.bin,
      codexHome: fixture.codexHome,
      cwd: fixture.probeDir,
      timeoutMs: 5_000
    });

    expect(result).toMatchObject({
      ready: true,
      responseReceived: true,
      markerMatched: false,
      exitCode: 0,
      terminationReason: 'completed',
      timings: {
        processExitMs: result.durationMs
      }
    });
    expect(result.timings.homePreparationMs).toBeGreaterThanOrEqual(0);
    expect(result.timings.firstEventMs).toBeGreaterThanOrEqual(
      result.timings.homePreparationMs
    );
    expect(result.timings.responseReceivedMs).toBe(result.durationMs);
    expect(readFileSync(fixture.promptPath, 'utf8')).toContain('OPENCREATOR_READY_');
  });

  it('falls back to the JSONL agent message', async () => {
    const fixture = createProbeExecutable(`
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: 'json response' }
}));
`);

    const result = await probeCodex({
      codexBin: fixture.bin,
      codexHome: fixture.codexHome,
      cwd: fixture.probeDir,
      timeoutMs: 5_000
    });

    expect(result.ready).toBe(true);
    expect(result.responseReceived).toBe(true);
    expect(result.timings.responseReceivedMs).toBeDefined();
    expect(result.timings.responseReceivedMs).toBeLessThanOrEqual(
      result.timings.processExitMs
    );
  });

  it('fails when the process exits successfully without a response', async () => {
    const fixture = createProbeExecutable(`
console.log(JSON.stringify({ type: 'turn.completed' }));
`);

    const result = await probeCodex({
      codexBin: fixture.bin,
      codexHome: fixture.codexHome,
      cwd: fixture.probeDir,
      timeoutMs: 5_000
    });

    expect(result.ready).toBe(false);
    expect(result.responseReceived).toBe(false);
    expect(result.exitCode).toBe(0);
  });

  it('fails with a stable isolation error when Codex emits a tool event', async () => {
    const fixture = createProbeExecutable(`
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'command_execution', command: 'echo unsafe' }
}));
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: 'response after tool call' }
}));
`);

    const result = await probeCodex({
      codexBin: fixture.bin,
      codexHome: fixture.codexHome,
      cwd: fixture.probeDir,
      timeoutMs: 5_000
    });

    expect(result).toMatchObject({
      ready: false,
      responseReceived: true,
      errorCode: 'CODEX_PROBE_TOOL_USED'
    });
  });

  it('does not classify reasoning and error events as tool use', async () => {
    const fixture = createProbeExecutable(`
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'reasoning', text: 'thinking' }
}));
console.log(JSON.stringify({ type: 'error', message: 'transient detail' }));
console.log(JSON.stringify({
  type: 'item.completed',
  item: { type: 'agent_message', text: 'hello' }
}));
`);

    const result = await probeCodex({
      codexBin: fixture.bin,
      codexHome: fixture.codexHome,
      cwd: fixture.probeDir,
      timeoutMs: 5_000
    });

    expect(result.ready).toBe(true);
    expect(result.errorCode).toBeUndefined();
  });

  it('converges after a short timeout even when SIGTERM is ignored', async () => {
    const fixture = createProbeExecutable(`
process.on('SIGTERM', () => undefined);
setInterval(() => undefined, 1_000);
await new Promise(() => undefined);
`);
    const startedAt = Date.now();

    const result = await probeCodex({
      codexBin: fixture.bin,
      codexHome: fixture.codexHome,
      cwd: fixture.probeDir,
      timeoutMs: 50,
      spawnTimeoutMs: 500,
      forceKillGraceMs: 50,
      finalKillSettleMs: 50
    });

    expect(result.terminationReason).toBe('timeout');
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });

  it('cancels an in-flight probe when the runtime shuts down', async () => {
    const fixture = createProbeExecutable(`
setInterval(() => undefined, 1_000);
await new Promise(() => undefined);
`);
    const controller = new AbortController();
    const work = probeCodex({
      codexBin: fixture.bin,
      codexHome: fixture.codexHome,
      cwd: fixture.probeDir,
      timeoutMs: 5_000,
      forceKillGraceMs: 20,
      finalKillSettleMs: 20,
      signal: controller.signal
    });
    setTimeout(() => controller.abort(), 20);

    const result = await work;

    expect(result.ready).toBe(false);
    expect(result.terminationReason).toBe('canceled');
  });
});

function createProbeExecutable(body: string): {
  bin: string;
  codexHome: string;
  probeDir: string;
  promptPath: string;
} {
  tempDir = mkdtempSync(join(tmpdir(), 'opencreator-probe-test-'));
  const bin = join(tempDir, 'fake-codex.mjs');
  const promptPath = join(tempDir, 'prompt.txt');
  const codexHome = join(tempDir, 'codex-home');
  const probeDir = join(tempDir, 'probe');
  writeFileSync(bin, `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(${JSON.stringify(promptPath)}, prompt);
${body}
`);
  chmodSync(bin, 0o755);
  return { bin, codexHome, probeDir, promptPath };
}
