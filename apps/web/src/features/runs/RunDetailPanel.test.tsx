import type { RunContextResponse, RunDiagnosticsResponse } from '@opencreator/protocol';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RunDetailPanel } from './RunDetailPanel.js';

describe('RunDetailPanel', () => {
  it('shows an empty state when no run is selected', () => {
    render(<RunDetailPanel />);

    expect(screen.getByText('选择 run 查看详情')).toBeInTheDocument();
  });

  it('shows an empty diagnostics state when the selected run has no diagnostic files', () => {
    const diagnostics: RunDiagnosticsResponse = {
      runId: 'run_1',
      files: [],
      warnings: [],
      codexStatusSnapshot: {
        codexBin: '/usr/local/bin/codex',
        codexVersion: '1.0.0',
        codexHome: '/tmp/codex',
        codexHomeMode: 'isolated',
        codexHomeSource: 'isolated',
        codexHomeWritable: true,
        capabilities: {},
        diagnostics: []
      }
    };

    render(<RunDetailPanel runId="run_1" diagnostics={diagnostics} />);

    expect(screen.getByText('暂无诊断文件')).toBeInTheDocument();
  });

  it('shows attachments associated with the selected run', () => {
    const diagnostics = createDiagnostics();
    render(
      <RunDetailPanel
        runId="run_2"
        diagnostics={diagnostics}
        attachments={[{
          id: 'attachment_1',
          fileName: 'screen.png',
          mime: 'image/png',
          size: 2048,
          sha256: 'a'.repeat(64),
          storageKey: 'at/attachment_1.bin',
          threadId: 'thread_1',
          runId: 'run_2',
          status: 'committed',
          createdAt: '2026-07-12T00:00:00.000Z',
          updatedAt: '2026-07-12T00:00:00.000Z'
        }]}
      />
    );

    expect(screen.getByText('附件')).toBeInTheDocument();
    expect(screen.getByText('screen.png')).toBeInTheDocument();
    expect(screen.getByText('image/png · 2 KB')).toBeInTheDocument();
  });

  it('shows the exact memory and summary snapshots used by the run', () => {
    const context: RunContextResponse = {
      runId: 'run_2',
      items: [
        {
          kind: 'memory',
          sourceId: 'mem_1',
          content: '提交前运行全部测试',
          order: 0,
          scope: 'project',
          scopeKey: '/workspace/project'
        },
        {
          kind: 'summary',
          sourceId: 'summary_1',
          content: '用户：继续开发',
          order: 1,
          summaryVersion: 3
        }
      ]
    };

    render(<RunDetailPanel runId="run_2" diagnostics={createDiagnostics()} context={context} />);

    expect(screen.getByText('本次使用的上下文')).toBeInTheDocument();
    expect(screen.getByText('项目记忆')).toBeInTheDocument();
    expect(screen.getByText('提交前运行全部测试')).toBeInTheDocument();
    expect(screen.getByText('会话摘要 v3')).toBeInTheDocument();
    expect(screen.getByText('用户：继续开发')).toBeInTheDocument();
  });

  it('shows an explicit empty run context state', () => {
    render(
      <RunDetailPanel
        runId="run_2"
        diagnostics={createDiagnostics()}
        context={{ runId: 'run_2', items: [] }}
      />
    );

    expect(screen.getByText('本次运行未使用长期记忆或摘要')).toBeInTheDocument();
  });

  it('requires confirmation before exporting the redacted diagnostics bundle', async () => {
    const diagnostics = createDiagnostics();
    const onExport = vi.fn();

    render(
      <RunDetailPanel
        runId="run_2"
        diagnostics={diagnostics}
        onExport={onExport}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '导出脱敏诊断包' }));
    const confirmation = screen.getByRole('region', { name: '确认导出诊断' });
    expect(within(confirmation).getByText(/不包含原始 Prompt、Token 或 Secret/)).toBeInTheDocument();

    fireEvent.click(within(confirmation).getByRole('button', { name: '取消' }));
    expect(onExport).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '导出脱敏诊断包' }));
    fireEvent.click(screen.getByRole('button', { name: '确认导出' }));

    await waitFor(() => expect(onExport).toHaveBeenCalledWith(diagnostics));
  });

  it('shows diagnostic files, warnings, and codex status details', () => {
    const diagnostics: RunDiagnosticsResponse = {
      runId: 'run_2',
      files: [{ name: 'runtime.log', content: 'runtime booted' }],
      warnings: ['codex home is not writable'],
      codexStatusSnapshot: {
        codexBin: '/opt/homebrew/bin/codex',
        codexVersion: '2.3.4',
        codexHome: '/Users/test/.codex',
        codexHomeMode: 'global',
        codexHomeSource: 'default',
        codexHomeWritable: false,
        capabilities: { sandbox: ['read-only'], imageInput: true },
        diagnostics: ['missing optional MCP server']
      }
    };

    render(<RunDetailPanel runId="run_2" diagnostics={diagnostics} />);

    expect(screen.getByText('runtime.log')).toBeInTheDocument();
    expect(screen.getByText('runtime booted')).toBeInTheDocument();
    expect(screen.getByText('codex home is not writable')).toBeInTheDocument();
    expect(screen.getByText('2.3.4')).toBeInTheDocument();
    expect(screen.getByText('/opt/homebrew/bin/codex')).toBeInTheDocument();
    expect(screen.getByText('/Users/test/.codex')).toBeInTheDocument();
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('missing optional MCP server')).toBeInTheDocument();
    expect(screen.getByText(/"imageInput": true/)).toBeInTheDocument();
  });

  it('shows an empty codex diagnostics state when snapshot diagnostics are missing', () => {
    const diagnostics: RunDiagnosticsResponse = {
      runId: 'run_3',
      files: [],
      warnings: [],
      codexStatusSnapshot: {
        codexBin: '/usr/local/bin/codex',
        codexVersion: '1.0.0',
        codexHome: '/tmp/codex',
        codexHomeMode: 'isolated',
        codexHomeSource: 'isolated',
        codexHomeWritable: true,
        capabilities: {}
      } as RunDiagnosticsResponse['codexStatusSnapshot']
    };

    render(<RunDetailPanel runId="run_3" diagnostics={diagnostics} />);

    expect(screen.getByText('暂无 Codex 诊断')).toBeInTheDocument();
  });
});

function createDiagnostics(): RunDiagnosticsResponse {
  return {
    runId: 'run_2',
    files: [{ name: 'runtime.log', content: 'runtime booted' }],
    warnings: ['codex home is not writable'],
    codexStatusSnapshot: {
      codexBin: '/opt/homebrew/bin/codex',
      codexVersion: '2.3.4',
      codexHome: '/Users/test/.codex',
      codexHomeMode: 'global',
      codexHomeSource: 'default',
      codexHomeWritable: false,
      capabilities: { sandbox: ['read-only'], imageInput: true },
      diagnostics: ['missing optional MCP server']
    }
  };
}
