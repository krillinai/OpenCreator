import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PluginsPage, { type PluginsPageProps } from './PluginsPage.js';

describe('PluginsPage', () => {
  it('defaults to enterprise skills and keeps the skill market second', async () => {
    const user = userEvent.setup();
    const onSourceChange = vi.fn();
    const view = render(<PluginsPage {...createProps({ onSourceChange })} />);

    expect(screen.getByRole('tab', { name: '企业Skills', selected: true }))
      .toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '企业Skills' }).nextElementSibling)
      .toBe(screen.getByRole('tab', { name: 'Skill市场' }));

    await user.click(screen.getByRole('tab', { name: 'Skill市场' }));
    expect(onSourceChange).toHaveBeenCalledWith('public');

    view.rerender(
      <PluginsPage
        {...createProps({
          source: 'enterprise',
          enterprise: {
            ...createProps().enterprise,
            session: {
              status: 'signed_out',
              transportSecurity: 'secure_https'
            }
          }
        })}
      />
    );

    expect(screen.getByRole('tab', { name: '企业Skills', selected: true }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登录企业账户' })).not.toBeInTheDocument();
    expect(screen.getByText('品牌合规审查')).toBeInTheDocument();
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
    onInstall: vi.fn(),
    onUpdate: vi.fn(),
    onUse: vi.fn(),
    onSourceChange: vi.fn(),
    enterprise: {
      connected: true,
      session: {
        status: 'signed_in',
        account: { email: 'member@example.com', name: 'Member' },
        transportSecurity: 'secure_https'
      },
      skills: [],
      loading: false,
      projects: [{ id: 'project-1', name: 'Project One', cwd: '/workspace/project-1' }],
      currentProjectId: 'project-1',
      onOpenAccount: vi.fn(),
      onRefresh: vi.fn(),
      onLoadDetail: vi.fn(),
      onInstall: vi.fn(),
      onUpdate: vi.fn(),
      onUse: vi.fn()
    },
    ...overrides
  };
}
