import type {
  CodexProfileDetailResponse,
  CodexProfileListResponse,
  CodexProfileMutationResponse,
  CreateCodexProfileRequest,
  UpdateCodexProfileRequest
} from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiClientError } from '../../runtime/errors.js';
import { ProfileSettingsView, type ProfileSettingsService } from './ProfileSettingsView.js';

describe('ProfileSettingsView', () => {
  it('creates a profile with model, reasoning, and sandbox settings', async () => {
    const user = userEvent.setup();
    const createProfile = vi.fn(async (input: CreateCodexProfileRequest): Promise<CodexProfileMutationResponse> => ({
      profile: profile(input.name, input.config)
    }));
    render(
      <ProfileSettingsView
        connected
        service={createService({ createProfile })}
        data={profileData({ profiles: [] })}
      />
    );

    await user.click(screen.getByRole('button', { name: '新建 Profile' }));
    await user.type(screen.getByLabelText('Profile 名称'), 'review');
    await user.type(screen.getByLabelText('模型'), 'gpt-5.3-codex');
    await user.selectOptions(screen.getByLabelText('推理级别'), 'high');
    await user.selectOptions(screen.getByLabelText('Sandbox'), 'workspace-write');
    await user.click(screen.getByRole('button', { name: '保存 Profile' }));

    expect(createProfile).toHaveBeenCalledWith({
      name: 'review',
      config: {
        model: 'gpt-5.3-codex',
        model_reasoning_effort: 'high',
        sandbox_mode: 'workspace-write'
      }
    });
    expect(await screen.findByRole('heading', { name: 'review' })).toBeInTheDocument();
  });

  it('loads details and updates an existing profile', async () => {
    const user = userEvent.setup();
    const getProfile = vi.fn(async (): Promise<CodexProfileDetailResponse> => ({
      profile: profile('review', {
        model: 'gpt-5.3-codex',
        model_reasoning_effort: 'medium',
        sandbox_mode: 'read-only',
        include_plan_tool: true
      })
    }));
    const updateProfile = vi.fn(async (_name: string, input: UpdateCodexProfileRequest) => ({
      profile: profile('review', input.config)
    }));
    render(
      <ProfileSettingsView
        connected
        service={createService({ getProfile, updateProfile })}
        data={profileData()}
      />
    );

    await user.click(screen.getByRole('button', { name: '编辑 review' }));
    expect(await screen.findByDisplayValue('gpt-5.3-codex')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('推理级别'), 'xhigh');
    await user.click(screen.getByRole('button', { name: '保存 Profile' }));

    expect(getProfile).toHaveBeenCalledWith('review');
    expect(updateProfile).toHaveBeenCalledWith('review', {
      config: {
        model: 'gpt-5.3-codex',
        model_reasoning_effort: 'xhigh',
        sandbox_mode: 'read-only',
        include_plan_tool: true
      }
    });
  });

  it('shows actionable usage details when deletion conflicts', async () => {
    const user = userEvent.setup();
    const deleteProfile = vi.fn(async () => {
      throw new ApiClientError({
        status: 409,
        code: 'CODEX_PROFILE_IN_USE',
        message: 'Profile is still referenced',
        details: {
          threads: [{ id: 'thread-1', title: '审查会话' }],
          schedules: [{ id: 'schedule-1', name: '每日审查' }]
        }
      });
    });
    render(
      <ProfileSettingsView
        connected
        service={createService({ deleteProfile })}
        data={profileData()}
        confirmDelete={() => true}
      />
    );

    await user.click(screen.getByRole('button', { name: '删除 review' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'CODEX_PROFILE_IN_USE：仍被 1 个会话和 1 个计划任务使用'
    );
    expect(screen.getByRole('heading', { name: 'review' })).toBeInTheDocument();
  });

  it('disables writes for read-only or invalid base configuration', () => {
    const { rerender } = render(
      <ProfileSettingsView
        connected
        service={createService()}
        data={profileData({ writable: false })}
      />
    );
    expect(screen.getByRole('button', { name: '新建 Profile' })).toBeDisabled();
    expect(screen.getByText('当前 CODEX_HOME 为只读，无法修改 Profile')).toBeInTheDocument();

    rerender(
      <ProfileSettingsView
        connected
        service={createService()}
        data={profileData({ baseConfigValid: false, diagnostics: ['config.toml 解析失败'] })}
      />
    );
    expect(screen.getByRole('button', { name: '新建 Profile' })).toBeDisabled();
    expect(screen.getByText('基础 config.toml 无效，请先修复配置')).toBeInTheDocument();
  });
});

function createService(overrides: Partial<ProfileSettingsService> = {}): ProfileSettingsService {
  return {
    listProfiles: async () => profileData(),
    getProfile: async () => ({ profile: profile() }),
    createProfile: async () => ({ profile: profile() }),
    updateProfile: async () => ({ profile: profile() }),
    deleteProfile: async () => ({ deleted: true }),
    ...overrides
  };
}

function profileData(overrides: Partial<CodexProfileListResponse> = {}): CodexProfileListResponse {
  return {
    codexHome: '/tmp/codex',
    codexHomeMode: 'isolated',
    writable: true,
    baseConfigValid: true,
    profiles: [profile()],
    diagnostics: [],
    ...overrides
  };
}

function profile(
  name = 'review',
  config: Record<string, string | number | boolean | Array<string | number | boolean>> = {
    model: 'gpt-5.3-codex',
    model_reasoning_effort: 'medium',
    sandbox_mode: 'read-only'
  }
) {
  return {
    name,
    status: 'valid' as const,
    config,
    diagnostics: [],
    source: `${name}.config.toml`,
    codexHomeMode: 'isolated' as const,
    updatedAt: '2026-07-12T00:00:00.000Z'
  };
}
