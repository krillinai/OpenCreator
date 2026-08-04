import type {
  EnterpriseSessionResponse,
  EnterpriseSkillDetailResponse,
  EnterpriseSkillResponse
} from '@clawee/protocol';
import { render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  EnterpriseSkillHubView,
  type EnterpriseSkillHubViewProps
} from './EnterpriseSkillHubView-2026-07-30.js';

const signedInSession: EnterpriseSessionResponse = {
  status: 'signed_in',
  account: { email: 'member@example.com', name: 'Member' },
  transportSecurity: 'secure_https'
};

describe('EnterpriseSkillHubView', () => {
  it('renders all enterprise statuses with the exact allowed actions', () => {
    renderHub({
      skills: [
        createSkill('not-installed', 'not_installed', 'not_applicable', ['install']),
        createSkill('invalid', 'invalid', 'unknown', []),
        createSkill('unknown-source', 'installed_unknown_source', 'unknown', ['use']),
        createSkill('name-conflict', 'name_conflict', 'unknown', []),
        createSkill('installed', 'installed', 'verified', ['use']),
        createSkill('update-ready', 'update_available', 'verified', ['update', 'use']),
        createSkill('unpublished', 'unpublished', 'verified', ['use']),
        createSkill('local-changed', 'update_available', 'local_changed', ['use'])
      ]
    });

    expectRow('not-installed', ['安装']);
    expectRow('invalid', []);
    expectRow('unknown-source', ['使用']);
    expectRow('name-conflict', []);
    expectRow('installed', ['使用']);
    expectRow('update-ready', ['使用']);
    expectRow('unpublished', ['使用']);
    expectRow('local-changed', ['使用']);
    const installed = screen.getByTestId('enterprise-skill-installed');
    const useButton = within(installed).getByRole('button', { name: '使用' });
    expect(useButton).toHaveTextContent('使用');
    expect(useButton.querySelector('svg')).not.toBeInTheDocument();
  });

  it('loads detail on demand and restores trigger focus', async () => {
    const user = userEvent.setup();
    const skill = createSkill('enterprise-writer', 'installed', 'verified', ['use']);
    const detail: EnterpriseSkillDetailResponse = {
      ...skill,
      description: '企业写作工作流',
      changelog: '新增审校步骤'
    };
    const onLoadDetail = vi.fn(async () => detail);
    renderHub({ skills: [skill], onLoadDetail });

    const trigger = screen.getByRole('button', { name: '查看 enterprise-writer 详情' });
    trigger.focus();
    await user.click(trigger);

    expect(onLoadDetail).toHaveBeenCalledWith('enterprise-writer');
    const dialog = await screen.findByRole('dialog', { name: 'enterprise-writer 详情' });
    expect(within(dialog).getByText('企业写作工作流')).toBeInTheDocument();
    expect(within(dialog).getByText('新增审校步骤')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: '关闭详情' }));

    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('shows mock enterprise skills without a redundant login gate', () => {
    const view = renderHub({
      session: {
        status: 'signed_out',
        transportSecurity: 'secure_https'
      }
    });

    expect(screen.queryByRole('button', { name: '登录企业账户' })).not.toBeInTheDocument();
    expect(screen.getByText('品牌合规审查')).toBeInTheDocument();
    expect(screen.getByLabelText('林晓')).toHaveClass('skill-market-avatar');
    expect(screen.getByText('林晓')).toBeInTheDocument();
    expect(screen.getByText('使用 1,284 次')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: '搜索企业 Skill' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加技能' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '刷新企业 Skill' })).not.toBeInTheDocument();

    view.rerender(createHub({
      session: {
        status: 'checking',
        transportSecurity: 'secure_https'
      }
    }));
    expect(screen.getByText('正在验证企业会话')).toBeInTheDocument();

    view.rerender(createHub({
      session: {
        status: 'service_unavailable',
        reason: 'service_unavailable',
        transportSecurity: 'secure_https'
      }
    }));
    expect(screen.getByText('企业Skills暂时不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新企业状态' })).toBeInTheDocument();
  });

  it('shows an employee avatar without a redundant uploader line', () => {
    renderHub({
      skills: [createSkill('employee-upload', 'installed', 'verified', ['use'])]
    });

    const row = screen.getByTestId('enterprise-skill-employee-upload');
    expect(within(row).getByLabelText('企业成员')).toHaveClass(
      'skill-market-avatar',
      'skill-market-avatar--small'
    );
    expect(within(row).getByText('企业成员')).toHaveClass('skill-market-card__author');
  });
});

function expectRow(skillId: string, actions: string[]) {
  const row = screen.getByTestId(`enterprise-skill-${skillId}`);
  expect(
    within(row).queryAllByRole('button')
      .filter(button => button.classList.contains('enterprise-skill-action'))
      .map(button => button.getAttribute('aria-label') ?? button.textContent)
  ).toEqual(actions);
}

function renderHub(overrides: Partial<EnterpriseSkillHubViewProps> = {}) {
  return render(createHub(overrides));
}

function createHub(overrides: Partial<EnterpriseSkillHubViewProps> = {}) {
  return (
    <EnterpriseSkillHubView
      connected
      session={signedInSession}
      skills={[]}
      loading={false}
      projects={[{ id: 'project-1', name: 'Project One', cwd: '/workspace/project-1' }]}
      currentProjectId="project-1"
      onOpenAccount={vi.fn()}
      onRefresh={vi.fn()}
      onLoadDetail={async skillId => createDetail(skillId)}
      onInstall={vi.fn()}
      onUpdate={vi.fn()}
      onUse={vi.fn()}
      {...overrides}
    />
  );
}

function createSkill(
  skillId: string,
  status: EnterpriseSkillResponse['status'],
  integrity: EnterpriseSkillResponse['integrity'],
  actions: EnterpriseSkillResponse['actions']
): EnterpriseSkillResponse {
  return {
    skillId,
    name: skillId,
    description: `${skillId} description`,
    version: '2.0.0',
    installedVersion: status === 'not_installed' ? undefined : '1.0.0',
    updatedAt: '2026-07-30T08:00:00.000Z',
    status,
    integrity,
    actions
  };
}

function createDetail(skillId: string): EnterpriseSkillDetailResponse {
  return {
    ...createSkill(skillId, 'installed', 'verified', ['use']),
    changelog: 'Initial release'
  };
}
