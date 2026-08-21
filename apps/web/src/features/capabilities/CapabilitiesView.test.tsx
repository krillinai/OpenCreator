import type { CodexMcpListResponse, CodexSkillListResponse } from '@opencreator/protocol';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { CodexProfileListResponse } from '../../services/capability-service.js';
import { CapabilitiesView } from './CapabilitiesView.js';

describe('CapabilitiesView', () => {
  it('shows a runtime connection prompt when disconnected', () => {
    render(<CapabilitiesView connected={false} />);

    expect(screen.getByText('本机 Runtime 就绪后查看技能、MCP 和 Profiles')).toBeInTheDocument();
  });

  it('shows capability section headings and counts when connected', () => {
    const skills: CodexSkillListResponse = {
      codexHome: '/tmp/codex',
      codexHomeMode: 'isolated',
      skillsPath: '/tmp/codex/skills',
      skillsWritable: true,
      requiresWriteConfirmation: false,
      skills: [
        {
          id: 'skill-a',
          status: 'valid',
          diagnostics: [],
          codexHome: '/tmp/codex',
          codexHomeMode: 'isolated',
          skillsPath: '/tmp/codex/skills',
          skillPath: '/tmp/codex/skills/skill-a',
          skillFilePath: '/tmp/codex/skills/skill-a/SKILL.md'
        },
        {
          id: 'skill-b',
          status: 'valid',
          diagnostics: [],
          codexHome: '/tmp/codex',
          codexHomeMode: 'isolated',
          skillsPath: '/tmp/codex/skills',
          skillPath: '/tmp/codex/skills/skill-b',
          skillFilePath: '/tmp/codex/skills/skill-b/SKILL.md'
        }
      ],
      diagnostics: []
    };
    const mcp: CodexMcpListResponse = {
      codexHome: '/tmp/codex',
      codexHomeMode: 'isolated',
      requiresWriteConfirmation: false,
      servers: [
        {
          name: 'filesystem',
          enabled: true,
          transport: 'stdio',
          status: 'configured',
          command: 'node',
          envKeys: [],
          hasSecrets: false,
          codexHome: '/tmp/codex',
          codexHomeMode: 'isolated',
          diagnostics: []
        }
      ],
      diagnostics: []
    };
    const profiles: CodexProfileListResponse = {
      codexHome: '/tmp/codex',
      codexHomeMode: 'isolated',
      writable: true,
      baseConfigValid: true,
      profiles: [
        {
          name: 'default',
          status: 'valid',
          config: {},
          diagnostics: [],
          source: '/tmp/codex/config.toml',
          codexHomeMode: 'isolated'
        },
        {
          name: 'planning',
          status: 'valid',
          config: {},
          diagnostics: [],
          source: '/tmp/codex/config.toml',
          codexHomeMode: 'isolated'
        },
        {
          name: 'review',
          status: 'valid',
          config: {},
          diagnostics: [],
          source: '/tmp/codex/config.toml',
          codexHomeMode: 'isolated'
        }
      ],
      diagnostics: []
    };

    render(<CapabilitiesView connected skills={skills} mcp={mcp} profiles={profiles} />);

    expect(screen.getByRole('heading', { name: '技能' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'MCP' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.getByText('2 个技能')).toBeInTheDocument();
    expect(screen.getByText('1 个 servers')).toBeInTheDocument();
    expect(screen.getByText('3 个 profiles')).toBeInTheDocument();
  });

  it('shows zero counts when connected capability data is missing', () => {
    render(<CapabilitiesView connected />);

    expect(screen.getByText('0 个技能')).toBeInTheDocument();
    expect(screen.getByText('0 个 servers')).toBeInTheDocument();
    expect(screen.getByText('0 个 profiles')).toBeInTheDocument();
  });
});
