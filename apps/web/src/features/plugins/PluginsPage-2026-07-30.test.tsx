import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PluginsPage, { type PluginsPageProps } from './PluginsPage.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';

describe('PluginsPage', () => {
  it('localizes the plugin center and connector tab in English', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <PluginsPage {...createProps()} />
      </LanguageProvider>
    );

    expect(screen.getByRole('region', { name: 'Plugins' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Connectors' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search Skills' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Installed/ })).toBeInTheDocument();
  });

  it('defaults to Skills and exposes the connector tab', () => {
    render(<PluginsPage {...createProps()} />);

    expect(screen.getByRole('region', { name: '插件中心' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Skill 功能目录' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Skills' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: '连接器' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('目录暂时为空');
    expect(screen.queryByTestId('skill-market-card')).not.toBeInTheDocument();
    expect(screen.queryByText(/企业/)).not.toBeInTheDocument();
  });

  it('requests the connector tab and renders its existing page content', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    const props = createProps({ onTabChange });
    const { rerender } = render(<PluginsPage {...props} />);

    await user.click(screen.getByRole('tab', { name: '连接器' }));
    expect(onTabChange).toHaveBeenCalledWith('connections');

    rerender(<PluginsPage {...props} activeTab="connections" />);
    expect(screen.getByRole('tab', { name: '连接器' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveAccessibleName('连接器');
    expect(screen.getByRole('heading', { name: '正在等待本地 Runtime' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Skill 功能目录' })).not.toBeInTheDocument();
  });
});

function createProps(overrides: Partial<PluginsPageProps> = {}): PluginsPageProps {
  return {
    connected: true,
    skills: {
      codexHome: '/tmp/codex',
      codexHomeMode: 'global',
      skillsPath: '/tmp/codex/skills',
      skillsWritable: true,
      requiresWriteConfirmation: false,
      skills: [],
      diagnostics: []
    },
    installRecords: [],
    loading: false,
    projects: [{ id: 'project-1', name: 'Project One', cwd: '/workspace/project-1' }],
    currentProjectId: 'project-1',
    connections: {
      connected: false,
      service: null,
      mcpService: null
    },
    onInstall: vi.fn(),
    onUpdate: vi.fn(),
    onUse: vi.fn(),
    ...overrides
  };
}
