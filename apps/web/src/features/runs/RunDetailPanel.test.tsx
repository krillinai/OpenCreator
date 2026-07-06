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
});
