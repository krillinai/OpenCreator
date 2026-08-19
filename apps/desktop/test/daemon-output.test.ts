import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAEMON_START_TIMEOUT_MS,
  DaemonStartError,
  consumeDaemonOutputChunk,
  parseDaemonOutputLine,
  parseDaemonProcessMessage
} from '../src/main/daemon-manager.js';

describe('Daemon stdout parser', () => {
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

  it('uses a Host timeout that leaves room for the Probe error', () => {
    expect(DEFAULT_DAEMON_START_TIMEOUT_MS).toBe(60_000);
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
