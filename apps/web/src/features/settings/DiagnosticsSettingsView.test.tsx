import type { CodexStatusResponse } from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DiagnosticsSettingsView } from './DiagnosticsSettingsView.js';

const codexStatus: CodexStatusResponse = {
  codexBin: '/opt/homebrew/bin/codex',
  codexVersion: 'codex-cli 2.4.0',
  codexHome: '/Users/test/.codex',
  codexHomeMode: 'global',
  codexHomeSource: 'default',
  codexHomeWritable: true,
  capabilities: {
    mcpAdd: true,
    profiles: true
  },
  availabilityProbe: {
    status: 'succeeded',
    checkedAt: '2026-07-17T00:00:00.000Z',
    durationMs: 900
  },
  diagnostics: ['MCP github 登录已过期']
};

describe('DiagnosticsSettingsView', () => {
  it('shows runtime, path, capability, and warning details', () => {
    render(
      <DiagnosticsSettingsView
        connected
        runtimeVersion="0.1.0"
        codexStatus={codexStatus}
      />
    );

    expect(screen.getAllByText('0.1.0')).toHaveLength(2);
    expect(screen.getByText('codex-cli 2.4.0')).toBeInTheDocument();
    expect(screen.getByText('/opt/homebrew/bin/codex')).toBeInTheDocument();
    expect(screen.getByText('/Users/test/.codex')).toBeInTheDocument();
    expect(screen.getByText('MCP github 登录已过期')).toBeInTheDocument();
    expect(screen.getByText(/"mcpAdd": true/)).toBeInTheDocument();
    expect(screen.getByText('可写')).toBeInTheDocument();
    expect(screen.getByText('可正常调用')).toBeInTheDocument();
  });

  it('shows explicit empty and disconnected states', () => {
    const { rerender } = render(
      <DiagnosticsSettingsView
        connected
        runtimeVersion="0.1.0"
        codexStatus={{ ...codexStatus, diagnostics: [] }}
      />
    );

    expect(screen.getByText('当前没有诊断告警')).toBeInTheDocument();

    rerender(
      <DiagnosticsSettingsView
        connected={false}
        runtimeVersion="0.1.0"
      />
    );

    expect(screen.getByText('本地服务未连接，诊断状态可能已过期。')).toBeInTheDocument();
    expect(screen.getAllByText('等待连接')).toHaveLength(2);
  });
});
