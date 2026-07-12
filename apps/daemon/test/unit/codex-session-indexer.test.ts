import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CODEX_SESSION_INDEX_VERSION,
  createCodexSessionIndexRepository
} from '../../src/codex/sessions/index-repository.js';
import { createCodexSessionIndexer } from '../../src/codex/sessions/indexer.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

let tempDir = '';
let db: Database.Database | undefined;

afterEach(() => {
  db?.close();
  db = undefined;
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('codex session indexer', () => {
  it('parses unchanged files once and indexes only appended lines', () => {
    const setup = createSetup();
    const sessionPath = writeSession(setup.sessionDir, 'incremental-session', [
      sessionMeta('incremental-session', setup.cwd, '2026-07-12T01:00:00.000Z'),
      userMessage('第一条需求', '2026-07-12T01:00:01.000Z', 'turn_1'),
      agentMessage('第一条回复', '2026-07-12T01:00:02.000Z', 'turn_1')
    ], false);
    const indexer = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository,
      readChunkBytes: 7
    });

    const first = indexer.sync();
    const second = indexer.sync();
    appendFileSync(
      sessionPath,
      `\n${JSON.stringify(agentMessage('追加的中文回复', '2026-07-12T01:00:03.000Z', 'turn_2'))}\n`
    );
    const appended = indexer.sync();

    expect(first).toMatchObject({
      filesParsed: 1,
      filesRebuilt: 1,
      linesParsed: 3
    });
    expect(first.bytesRead).toBeGreaterThan(0);
    expect(second).toMatchObject({
      filesParsed: 0,
      filesRebuilt: 0,
      linesParsed: 0,
      bytesRead: 0
    });
    expect(appended).toMatchObject({
      filesParsed: 1,
      filesRebuilt: 0,
      linesParsed: 1
    });
    expect(setup.repository.listHistory('incremental-session')).toEqual([
      expect.objectContaining({ type: 'user_message', text: '第一条需求' }),
      expect.objectContaining({ type: 'assistant_message', text: '第一条回复' }),
      expect.objectContaining({ type: 'done', turnId: 'turn_1' }),
      expect.objectContaining({ type: 'assistant_message', text: '追加的中文回复' }),
      expect.objectContaining({ type: 'done', turnId: 'turn_2' })
    ]);

    const source = setup.repository.getSource(sessionPath);
    expect(source).toMatchObject({
      parsed_offset: statSync(sessionPath).size,
      parsed_line_count: 4,
      index_version: CODEX_SESSION_INDEX_VERSION,
      last_error: null
    });
  });

  it('rebuilds one source after truncation or file replacement', () => {
    const setup = createSetup();
    const sessionPath = writeSession(setup.sessionDir, 'replaceable-session', [
      sessionMeta('old-session', setup.cwd, '2026-07-12T02:00:00.000Z'),
      userMessage('旧内容', '2026-07-12T02:00:01.000Z')
    ]);
    const indexer = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository
    });

    indexer.sync();
    writeSessionAtPath(sessionPath, [
      sessionMeta('truncated-session', setup.cwd, '2026-07-12T02:10:00.000Z'),
      userMessage('截断后的内容', '2026-07-12T02:10:01.000Z')
    ]);
    const truncated = indexer.sync();

    expect(truncated.filesRebuilt).toBe(1);
    expect(setup.repository.listSessions()).toEqual([
      expect.objectContaining({
        codexThreadId: 'truncated-session',
        title: '截断后的内容'
      })
    ]);
    expect(setup.repository.listHistory('old-session')).toEqual([]);

    const replacementPath = join(setup.sessionDir, 'replacement.jsonl');
    writeSessionAtPath(replacementPath, [
      sessionMeta('replacement-session', setup.cwd, '2026-07-12T02:20:00.000Z'),
      userMessage('替换后的内容', '2026-07-12T02:20:01.000Z')
    ]);
    renameSync(replacementPath, sessionPath);
    const replaced = indexer.sync();

    expect(replaced.filesRebuilt).toBe(1);
    expect(setup.repository.listSessions()).toEqual([
      expect.objectContaining({
        codexThreadId: 'replacement-session',
        title: '替换后的内容'
      })
    ]);
    expect(setup.repository.listHistory('truncated-session')).toEqual([]);
  });

  it('isolates malformed, unknown, and oversized lines from other sessions', () => {
    const setup = createSetup();
    const damagedPath = join(setup.sessionDir, 'rollout-damaged.jsonl');
    writeSessionAtPath(damagedPath, [
      sessionMeta('damaged-session', setup.cwd, '2026-07-12T03:00:00.000Z'),
      '{"timestamp":"broken"',
      {
        timestamp: '2026-07-12T03:00:01.000Z',
        type: 'future_event',
        payload: { value: true }
      },
      {
        timestamp: '2026-07-12T03:00:02.000Z',
        type: 'response_item',
        payload: {
          type: 'function_call_output',
          output: 'x'.repeat(2_048)
        }
      },
      userMessage('损坏文件仍可读取', '2026-07-12T03:00:03.000Z')
    ]);
    writeSession(setup.sessionDir, 'healthy-session', [
      sessionMeta('healthy-session', setup.cwd, '2026-07-12T03:10:00.000Z'),
      userMessage('正常文件', '2026-07-12T03:10:01.000Z')
    ]);
    const warnings: string[] = [];
    const indexer = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository,
      maxLineBytes: 512,
      warn: message => warnings.push(message)
    });

    const result = indexer.sync();

    expect(result.filesParsed).toBe(2);
    expect(setup.repository.listSessions()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ codexThreadId: 'damaged-session', title: '损坏文件仍可读取' }),
        expect.objectContaining({ codexThreadId: 'healthy-session', title: '正常文件' })
      ])
    );
    expect(setup.repository.getSource(damagedPath)?.last_error).toContain('line');
    expect(warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('damaged'),
      expect.stringContaining('oversized')
    ]));
  });

  it('preserves UTF-8 text split across small read chunks', () => {
    const setup = createSetup();
    writeSession(setup.sessionDir, 'utf8-session', [
      sessionMeta('utf8-session', setup.cwd, '2026-07-12T04:00:00.000Z'),
      userMessage('跨分块的中文和 emoji：你好，世界。', '2026-07-12T04:00:01.000Z')
    ]);
    const indexer = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository,
      readChunkBytes: 5
    });

    indexer.sync();

    expect(setup.repository.listHistory('utf8-session')).toEqual([
      expect.objectContaining({
        type: 'user_message',
        text: '跨分块的中文和 emoji：你好，世界。'
      })
    ]);
  });

  it('waits for an incomplete trailing JSON line without recording an error', () => {
    const setup = createSetup();
    const sessionPath = join(setup.sessionDir, 'rollout-incomplete-session.jsonl');
    const messageLine = JSON.stringify(
      userMessage('补全后的消息', '2026-07-12T04:10:01.000Z')
    );
    const incompleteLength = messageLine.length - 2;
    writeFileSync(
      sessionPath,
      `${JSON.stringify(sessionMeta(
        'incomplete-session',
        setup.cwd,
        '2026-07-12T04:10:00.000Z'
      ))}\n${messageLine.slice(0, incompleteLength)}`
    );
    const warnings: string[] = [];
    const indexer = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository,
      warn: message => warnings.push(message)
    });

    const incomplete = indexer.sync();
    appendFileSync(sessionPath, `${messageLine.slice(incompleteLength)}\n`);
    const completed = indexer.sync();

    expect(incomplete.linesParsed).toBe(1);
    expect(setup.repository.getSource(sessionPath)?.last_error).toBeNull();
    expect(warnings).toEqual([]);
    expect(completed.linesParsed).toBe(1);
    expect(setup.repository.listHistory('incomplete-session')).toEqual([
      expect.objectContaining({ type: 'user_message', text: '补全后的消息' })
    ]);
  });

  it('can rebuild the index from the original JSONL after deleting the database', () => {
    const setup = createSetup();
    writeSession(setup.sessionDir, 'rebuild-session', [
      sessionMeta('rebuild-session', setup.cwd, '2026-07-12T05:00:00.000Z'),
      userMessage('从原始 JSONL 重建', '2026-07-12T05:00:01.000Z')
    ]);
    const firstIndexer = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository
    });
    firstIndexer.sync();
    db?.close();
    db = undefined;
    rmSync(setup.dbPath, { force: true });
    rmSync(`${setup.dbPath}-wal`, { force: true });
    rmSync(`${setup.dbPath}-shm`, { force: true });

    db = openRuntimeDatabase(setup.dbPath);
    const rebuiltRepository = createCodexSessionIndexRepository(db);
    const rebuilt = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: rebuiltRepository
    }).sync();

    expect(rebuilt.filesRebuilt).toBe(1);
    expect(rebuiltRepository.listSessions()).toEqual([
      expect.objectContaining({
        codexThreadId: 'rebuild-session',
        title: '从原始 JSONL 重建'
      })
    ]);
  });

  it('paginates history from newest to oldest with stable ordering and rebuild-safe cursors', () => {
    const setup = createSetup();
    writeSession(setup.sessionDir, 'pagination-session', [
      sessionMeta('pagination-session', setup.cwd, '2026-07-12T06:00:00.000Z'),
      userMessage('第一条需求', '2026-07-12T06:00:01.000Z', 'turn_1'),
      agentMessage('第一条回复', '2026-07-12T06:00:01.000Z', 'turn_1'),
      userMessage('第二条需求', '2026-07-12T06:00:01.000Z', 'turn_2'),
      reasoningSummary('同时间戳推理', '2026-07-12T06:00:01.000Z', 'turn_2'),
      agentMessage('第二条回复', '2026-07-12T06:00:01.000Z', 'turn_2')
    ]);
    const indexer = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository
    });
    indexer.sync();

    const fullHistory = setup.repository.listHistory('pagination-session');
    const latest = setup.repository.listHistoryPage('pagination-session', { limit: 2 });

    expect(latest.items).toEqual([
      expect.objectContaining({ type: 'reasoning_summary', text: '同时间戳推理' }),
      expect.objectContaining({ type: 'assistant_message', text: '第二条回复' }),
      expect.objectContaining({ type: 'done', turnId: 'turn_2' })
    ]);
    expect(latest.hasMore).toBe(true);
    expect(latest.nextCursor).toEqual(expect.any(String));
    expect(latest.oldestItemAt).toBe('2026-07-12T06:00:01.000Z');
    expect(latest.nextCursor).not.toContain(setup.sessionDir);

    const middle = setup.repository.listHistoryPage('pagination-session', {
      limit: 2,
      before: latest.nextCursor
    });

    db?.close();
    db = undefined;
    rmSync(setup.dbPath, { force: true });
    rmSync(`${setup.dbPath}-wal`, { force: true });
    rmSync(`${setup.dbPath}-shm`, { force: true });
    db = openRuntimeDatabase(setup.dbPath);
    const rebuiltRepository = createCodexSessionIndexRepository(db);
    createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: rebuiltRepository
    }).sync();

    const oldest = rebuiltRepository.listHistoryPage('pagination-session', {
      limit: 2,
      before: middle.nextCursor
    });
    const combined = [...oldest.items, ...middle.items, ...latest.items];

    expect(oldest.hasMore).toBe(false);
    expect(oldest.nextCursor).toBeUndefined();
    expect(combined).toEqual(fullHistory);
  });

  it('deduplicates adjacent messages across history page boundaries', () => {
    const setup = createSetup();
    writeSession(setup.sessionDir, 'pagination-dedup-session', [
      sessionMeta('pagination-dedup-session', setup.cwd, '2026-07-12T06:10:00.000Z'),
      userMessage('更早的消息', '2026-07-12T06:10:01.000Z', 'turn_1'),
      userMessage('跨页重复消息', '2026-07-12T06:10:02.000Z', 'turn_2'),
      userMessage('跨页重复消息', '2026-07-12T06:10:03.000Z', 'turn_2'),
      userMessage('最新消息', '2026-07-12T06:10:04.000Z', 'turn_3')
    ]);
    const indexer = createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository
    });
    indexer.sync();

    const latest = setup.repository.listHistoryPage('pagination-dedup-session', { limit: 2 });
    const previous = setup.repository.listHistoryPage('pagination-dedup-session', {
      limit: 2,
      before: latest.nextCursor
    });

    expect(latest.items).toEqual([
      expect.objectContaining({ type: 'user_message', text: '最新消息' })
    ]);
    expect([...previous.items, ...latest.items]).toEqual(
      setup.repository.listHistory('pagination-dedup-session')
    );
  });

  it('loads a bounded history window around a target item', () => {
    const setup = createSetup();
    writeSession(setup.sessionDir, 'target-window-session', [
      sessionMeta('target-window-session', setup.cwd, '2026-07-12T06:20:00.000Z'),
      userMessage('第一条', '2026-07-12T06:20:01.000Z'),
      userMessage('第二条', '2026-07-12T06:20:02.000Z'),
      userMessage('目标消息', '2026-07-12T06:20:03.000Z'),
      userMessage('第四条', '2026-07-12T06:20:04.000Z'),
      userMessage('第五条', '2026-07-12T06:20:05.000Z')
    ]);
    createCodexSessionIndexer({
      codexHome: setup.codexHome,
      repository: setup.repository
    }).sync();
    const target = setup.repository
      .listHistory('target-window-session')
      .find(item => item.type === 'user_message' && item.text === '目标消息')!;

    const page = setup.repository.listHistoryPage('target-window-session', {
      limit: 3,
      targetItemId: target.id
    });

    expect(page.items.map(item => 'text' in item ? item.text : item.type)).toEqual([
      '第二条',
      '目标消息',
      '第四条'
    ]);
    expect(page.targetItemId).toBe(target.id);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toEqual(expect.any(String));
  });
});

function createSetup() {
  tempDir = mkdtempSync(join(tmpdir(), 'clawee-codex-index-'));
  const codexHome = join(tempDir, 'codex-home');
  const sessionDir = join(codexHome, 'sessions', '2026', '07', '12');
  const cwd = join(tempDir, 'workspace');
  const dbPath = join(tempDir, 'app.sqlite');
  mkdirSync(sessionDir, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  db = openRuntimeDatabase(dbPath);
  return {
    codexHome,
    sessionDir,
    cwd,
    dbPath,
    repository: createCodexSessionIndexRepository(db)
  };
}

function writeSession(
  sessionDir: string,
  name: string,
  lines: unknown[],
  trailingNewline = true
): string {
  const path = join(sessionDir, `rollout-${name}.jsonl`);
  writeSessionAtPath(path, lines, trailingNewline);
  return path;
}

function writeSessionAtPath(path: string, lines: unknown[], trailingNewline = true): void {
  const content = lines
    .map(line => typeof line === 'string' ? line : JSON.stringify(line))
    .join('\n');
  writeFileSync(
    path,
    trailingNewline ? `${content}\n` : content
  );
}

function sessionMeta(id: string, cwd: string, timestamp: string) {
  return {
    timestamp,
    type: 'session_meta',
    payload: {
      id,
      session_id: id,
      timestamp,
      cwd
    }
  };
}

function userMessage(message: string, timestamp: string, turnId?: string) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'user_message',
      message,
      ...(turnId === undefined ? {} : { turn_id: turnId })
    }
  };
}

function agentMessage(message: string, timestamp: string, turnId?: string) {
  return {
    timestamp,
    type: 'event_msg',
    payload: {
      type: 'agent_message',
      message,
      ...(turnId === undefined ? {} : { turn_id: turnId })
    }
  };
}

function reasoningSummary(message: string, timestamp: string, turnId?: string) {
  return {
    timestamp,
    type: 'response_item',
    payload: {
      type: 'reasoning',
      summary: [{ type: 'summary_text', text: message }],
      ...(turnId === undefined ? {} : { turn_id: turnId })
    }
  };
}
