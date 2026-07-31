import { describe, expect, it } from 'vitest';
import type {
  EnterpriseLoginRequest,
  EnterpriseRegisterRequest,
  EnterpriseSessionResponse,
  EnterpriseSkillDetailResponse,
  EnterpriseSkillListResponse,
  EnterpriseSkillMutationResponse,
  RuntimeErrorCode
} from '../src/index.js';

describe('enterprise runtime contract', () => {
  it('exports enterprise session and skill contracts without credential fields', () => {
    const login: EnterpriseLoginRequest = {
      email: 'user@example.com',
      password: 'password-123'
    };
    const register: EnterpriseRegisterRequest = {
      email: login.email,
      name: 'User',
      password: login.password
    };
    const session: EnterpriseSessionResponse = {
      status: 'signed_in',
      account: {
        email: login.email,
        name: register.name ?? ''
      },
      expiresAt: '2026-07-30T12:00:00.000Z',
      transportSecurity: 'secure_https'
    };
    const detail: EnterpriseSkillDetailResponse = {
      skillId: 'skill-1',
      name: 'enterprise-skill',
      description: 'Enterprise skill',
      version: '1.0.0',
      status: 'not_installed',
      integrity: 'not_applicable',
      actions: ['install'],
      changelog: 'Initial release'
    };
    const list: EnterpriseSkillListResponse = {
      skills: [detail],
      refreshedAt: '2026-07-30T12:00:00.000Z'
    };
    const mutation: EnterpriseSkillMutationResponse = {
      skill: {
        ...detail,
        status: 'installed',
        integrity: 'verified',
        actions: ['use']
      },
      localSkill: {
        id: detail.name,
        name: detail.name,
        status: 'valid',
        diagnostics: [],
        codexHome: '/tmp/codex-home',
        codexHomeMode: 'isolated',
        skillsPath: '/tmp/codex-home/skills',
        skillPath: `/tmp/codex-home/skills/${detail.name}`,
        skillFilePath: `/tmp/codex-home/skills/${detail.name}/SKILL.md`
      },
      operation: {
        id: 'operation-1',
        operation: 'install',
        skillId: detail.name,
        codexHome: '/tmp/codex-home',
        skillsPath: '/tmp/codex-home/skills',
        targetPath: `/tmp/codex-home/skills/${detail.name}`,
        status: 'succeeded',
        createdAt: '2026-07-30T12:00:00.000Z'
      }
    };
    const codes: RuntimeErrorCode[] = [
      'ENTERPRISE_UNAUTHORIZED',
      'ENTERPRISE_SECURE_STORAGE_UNAVAILABLE',
      'ENTERPRISE_SKILL_PACKAGE_INVALID',
      'ENTERPRISE_SKILL_INSTALL_FAILED'
    ];

    const serialized = JSON.stringify({ session, list, mutation, codes });
    for (const forbidden of [
      'accessToken',
      'token',
      'password',
      'authorization',
      'cookie',
      'packageSha256',
      'versionId'
    ]) {
      expect(serialized.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
