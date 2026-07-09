import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scanCodexSessions } from '../../src/codex/sessions/scanner.js';
import { readCodexSessionHistory } from '../../src/codex/sessions/history.js';

let tempDir = '';

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex sessions scanner', () => {
  it('lists Codex JSONL sessions as resumable thread summaries', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-codex-sessions-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '07');
    mkdirSync(sessionDir, { recursive: true });
    const sessionPath = join(sessionDir, 'rollout-2026-07-07T10-00-00-codex-session-1.jsonl');
    writeFileSync(
      sessionPath,
      [
        JSON.stringify({
          timestamp: '2026-07-07T02:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'codex-session-1',
            session_id: 'codex-session-1',
            timestamp: '2026-07-07T02:00:00.000Z',
            cwd: tempDir,
            cli_version: '0.142.5'
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:01.000Z',
          type: 'response_item',
          payload: {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: '# AGENTS.md instructions\n\n<INSTRUCTIONS>ignore</INSTRUCTIONS>' }]
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:02.000Z',
          type: 'event_msg',
          payload: { type: 'user_message', message: '整理今天的客户跟进记录' }
        }),
        JSON.stringify({
          timestamp: '2026-07-07T02:00:03.000Z',
          type: 'event_msg',
          payload: { type: 'agent_message', message: '已整理。' }
        })
      ].join('\n')
    );

    const sessions = scanCodexSessions({ codexHome, limit: 20 });

    expect(sessions).toEqual([
      expect.objectContaining({
        codexThreadId: 'codex-session-1',
        title: '整理今天的客户跟进记录',
        cwd: tempDir,
        createdAt: '2026-07-07T02:00:00.000Z',
        updatedAt: '2026-07-07T02:00:03.000Z',
        path: sessionPath
      })
    ]);
  });

  it('filters subagent Codex sessions before applying the list limit', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-codex-sessions-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '09');
    mkdirSync(sessionDir, { recursive: true });

    const subagentPath = writeSession(sessionDir, 'subagent-newer', {
      id: 'subagent-newer',
      cwd: join(tempDir, 'playground'),
      timestamp: '2026-07-09T02:00:00.000Z',
      meta: {
        parent_thread_id: 'parent-thread',
        thread_source: 'subagent',
        source: {
          subagent: {
            thread_spawn: {
              parent_thread_id: 'parent-thread',
              depth: 1,
              agent_role: 'default'
            }
          }
        }
      },
      userMessage: '你是 Task 1 的任务审查子代理'
    });
    const userPath = writeSession(sessionDir, 'user-older', {
      id: 'user-older',
      cwd: join(tempDir, 'playground'),
      timestamp: '2026-07-09T01:00:00.000Z',
      userMessage: '整理 Playground 的客户跟进记录'
    });
    utimesSync(userPath, new Date('2026-07-09T01:00:00.000Z'), new Date('2026-07-09T01:00:00.000Z'));
    utimesSync(subagentPath, new Date('2026-07-09T02:00:00.000Z'), new Date('2026-07-09T02:00:00.000Z'));

    const sessions = scanCodexSessions({ codexHome, limit: 1 });

    expect(sessions).toEqual([
      expect.objectContaining({
        codexThreadId: 'user-older',
        title: '整理 Playground 的客户跟进记录'
      })
    ]);
  });

  it('reads patch apply file changes from Codex session history', () => {
    tempDir = mkdtempSync(join(tmpdir(), 'clawee-codex-history-'));
    const codexHome = join(tempDir, 'codex-home');
    const sessionDir = join(codexHome, 'sessions', '2026', '07', '08');
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'rollout-2026-07-08T10-00-00-codex-session-2.jsonl'),
      [
        JSON.stringify({
          timestamp: '2026-07-08T02:00:00.000Z',
          type: 'session_meta',
          payload: {
            id: 'codex-session-2',
            session_id: 'codex-session-2',
            timestamp: '2026-07-08T02:00:00.000Z',
            cwd: tempDir
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-08T02:00:01.000Z',
          type: 'event_msg',
          payload: {
            type: 'user_message',
            message: '创建文件',
            turn_id: 'turn_1'
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-08T02:00:02.000Z',
          type: 'event_msg',
          payload: {
            type: 'patch_apply_end',
            turn_id: 'turn_1',
            success: true,
            status: 'completed',
            changes: {
              [join(tempDir, '放假.md')]: { type: 'add' },
              [join(tempDir, 'notes.md')]: { type: 'update' },
              [join(tempDir, 'old.md')]: { type: 'delete' }
            }
          }
        }),
        JSON.stringify({
          timestamp: '2026-07-08T02:00:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'agent_message',
            message: '已创建文件。',
            turn_id: 'turn_1'
          }
        })
      ].join('\n')
    );

    const items = readCodexSessionHistory({ codexHome, codexThreadId: 'codex-session-2' });

    expect(items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'file_change',
          turnId: 'turn_1',
          status: 'completed',
          changes: [
            { path: join(tempDir, '放假.md'), kind: 'add' },
            { path: join(tempDir, 'notes.md'), kind: 'modify' },
            { path: join(tempDir, 'old.md'), kind: 'delete' }
          ]
        })
      ])
    );
  });
});

function writeSession(
  sessionDir: string,
  id: string,
  input: {
    id: string;
    cwd: string;
    timestamp: string;
    userMessage: string;
    meta?: Record<string, unknown>;
  }
): string {
  const path = join(sessionDir, `rollout-${id}.jsonl`);
  writeFileSync(
    path,
    [
      JSON.stringify({
        timestamp: input.timestamp,
        type: 'session_meta',
        payload: {
          id: input.id,
          session_id: input.id,
          timestamp: input.timestamp,
          cwd: input.cwd,
          ...input.meta
        }
      }),
      JSON.stringify({
        timestamp: input.timestamp,
        type: 'event_msg',
        payload: { type: 'user_message', message: input.userMessage }
      })
    ].join('\n')
  );
  return path;
}
