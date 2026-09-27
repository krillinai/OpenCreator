import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_DAEMON_START_TIMEOUT_MS,
  DaemonStartError,
  appendDiagnosticTail,
  buildDaemonEnvironment,
  consumeDaemonOutputChunk,
  createDaemonExitError,
  parseDaemonOutputLine,
  parseDaemonParentMessage,
  parseDaemonProcessMessage
} from '../src/main/daemon-manager.js';

describe('Daemon stdout parser', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('parses bootstrap events and the final connection without logging assumptions', () => {
    expect(parseDaemonOutputLine(JSON.stringify({
      type: 'opencreator_daemon_bootstrap',
      phase: 'probe_succeeded',
      at: '2026-07-16T00:00:00.000Z',
      durationMs: 2_100,
      probeTimings: {
        homePreparationMs: 4,
        firstEventMs: 120,
        responseReceivedMs: 1_600,
        processExitMs: 2_100
      }
    }))).toMatchObject({
      kind: 'bootstrap',
      event: {
        phase: 'probe_succeeded',
        probeTimings: {
          homePreparationMs: 4,
          firstEventMs: 120,
          responseReceivedMs: 1_600,
          processExitMs: 2_100
        }
      }
    });
    expect(parseDaemonOutputLine(JSON.stringify({
      address: '127.0.0.1:6000',
      token: 'secret'
    }))).toEqual({
      kind: 'connection',
      connection: {
        address: 'http://127.0.0.1:6000',
        token: 'secret'
      }
    });
  });

  it('ignores non-JSON and unknown JSON lines', () => {
    expect(parseDaemonOutputLine('noise')).toEqual({ kind: 'ignored' });
    expect(parseDaemonOutputLine('{"hello":"world"}')).toEqual({ kind: 'ignored' });
  });

  it('parses tracked Codex child lifecycle messages', () => {
    expect(parseDaemonProcessMessage({
      type: 'codex_child_started',
      pid: 1234
    })).toEqual({
      type: 'codex_child_started',
      pid: 1234
    });
    expect(parseDaemonProcessMessage({
      data: {
        type: 'codex_child_exited',
        pid: 1234
      }
    })).toEqual({
      type: 'codex_child_exited',
      pid: 1234
    });
    expect(parseDaemonProcessMessage({
      type: 'codex_child_started',
      pid: -1
    })).toBeUndefined();
  });

  it('parses bootstrap and ready events delivered over the parent port', () => {
    expect(parseDaemonParentMessage({
      data: {
        type: 'opencreator_daemon_bootstrap_error',
        code: 'DAEMON_IMPORT_FAILED',
        message: 'Cannot find module',
        at: '2026-09-05T00:00:00.000Z'
      }
    })).toMatchObject({
      kind: 'bootstrap',
      event: {
        code: 'DAEMON_IMPORT_FAILED',
        message: 'Cannot find module'
      }
    });
    expect(parseDaemonParentMessage({
      type: 'opencreator_daemon_ready',
      address: '127.0.0.1:6000',
      token: 'secret'
    })).toEqual({
      kind: 'connection',
      connection: {
        address: 'http://127.0.0.1:6000',
        token: 'secret'
      }
    });
  });

  it('uses a Host timeout that leaves room for the Probe error', () => {
    expect(DEFAULT_DAEMON_START_TIMEOUT_MS).toBe(60_000);
  });

  it('passes the product home and exact Codex home to the Daemon', () => {
    vi.stubEnv('CODEX_HOME', '/Users/demo/.codex-custom');
    const environment = buildDaemonEnvironment({
      entryPath: '/app/daemon/main.js',
      cwd: '/Users/demo',
      env: {},
      appHome: '/Users/demo/.opencreator',
      codexBin: '/app/codex',
      codexHome: '/Users/demo/.opencreator/runtime/codex',
      codexVersion: '0.149.0',
      codexCommit: 'bundled-commit',
      dataDir: '/Users/demo/.opencreator/data',
      defaultCwd: '/Users/demo',
      defaultProjectRoot: '/Users/demo/Documents',
      requireProbe: false,
      probeVerified: true
    });

    expect(environment).toMatchObject({
      OPENCREATOR_HOME: '/Users/demo/.opencreator',
      OPENCREATOR_DATA_DIR: '/Users/demo/.opencreator/data',
      CODEX_HOME: '/Users/demo/.opencreator/runtime/codex',
      OPENCREATOR_LOCAL_CODEX_HOME: '/Users/demo/.codex-custom',
      OPENCREATOR_CODEX_VERSION: '0.149.0',
      OPENCREATOR_CODEX_COMMIT: 'bundled-commit',
      OPENCREATOR_MANAGED_PARENT_PID: String(process.pid)
    });
  });

  it('keeps daemon bootstrap errors structured', () => {
    const error = new DaemonStartError(
      'CODEX_PROBE_TOOL_USED',
      'Probe attempted to call a tool',
      { eventType: 'command_execution' }
    );
    expect(error).toMatchObject({
      code: 'CODEX_PROBE_TOOL_USED',
      message: 'Probe attempted to call a tool',
      details: { eventType: 'command_execution' }
    });
  });

  it('keeps the actual stderr reason when the Daemon exits before ready', () => {
    const error = createDaemonExitError(1, {
      stdoutTail: '',
      stderrTail: [
        'node:internal/modules/cjs/loader:1524',
        "Error: Cannot find module 'which'",
        "  code: 'MODULE_NOT_FOUND'"
      ].join('\r\n')
    });

    expect(error.message).toContain("Error: Cannot find module 'which'");
    expect(error.details).toMatchObject({
      exitCode: 1,
      stderrTail: expect.stringContaining('MODULE_NOT_FOUND')
    });
  });

  it('bounds diagnostic output to the configured tail length', () => {
    expect(appendDiagnosticTail('1234', '56789', 6)).toBe('456789');
  });

  it('drops an oversized unterminated frame and resumes at the next line', () => {
    const first = consumeDaemonOutputChunk({
      buffer: '',
      droppingFrame: false
    }, 'x'.repeat(32), 16);
    expect(first).toEqual({
      lines: [],
      state: { buffer: '', droppingFrame: true },
      truncated: true
    });

    const second = consumeDaemonOutputChunk(
      first.state,
      'discarded\n{"address":"127.0.0.1:6000","token":"secret"}\n',
      64
    );
    expect(second.lines).toEqual([
      '{"address":"127.0.0.1:6000","token":"secret"}'
    ]);
    expect(second.state).toEqual({ buffer: '', droppingFrame: false });
  });
});
