import type { RunDiagnosticsResponse } from '@clawee/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
