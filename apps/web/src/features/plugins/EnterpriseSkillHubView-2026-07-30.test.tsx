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

    expectRow('not-installed', '未安装', ['安装']);
    expectRow('invalid', '本地内容无效', []);
    expectRow('unknown-source', '来源未知', ['使用']);
    expectRow('name-conflict', '名称冲突', []);
    expectRow('installed', '已安装', ['使用']);
    expectRow('update-ready', '可更新', ['更新', '使用']);
    expectRow('unpublished', '已下架', ['使用']);
    expectRow('local-changed', '本地内容已修改', ['使用']);
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

  it('gates signed-out, checking, and unavailable sessions without hiding refresh actions', () => {
    const view = renderHub({
      session: {
        status: 'signed_out',
        transportSecurity: 'secure_https'
      }
    });

    expect(screen.getByRole('button', { name: '登录企业账户' })).toBeInTheDocument();

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
    expect(screen.getByText('企业 Skill Hub 暂时不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新企业状态' })).toBeInTheDocument();
  });
});

function expectRow(skillId: string, statusLabel: string, actions: string[]) {
  const row = screen.getByTestId(`enterprise-skill-${skillId}`);
  expect(within(row).getByText(statusLabel)).toBeInTheDocument();
  const actionGroup = within(row).getByRole('group', {
    name: `${skillId} 操作`
  });
  expect(
    within(actionGroup).queryAllByRole('button').map(button => button.textContent)
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
