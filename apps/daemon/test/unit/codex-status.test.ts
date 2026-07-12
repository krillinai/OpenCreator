import { describe, expect, it } from 'vitest';
import { buildCodexStatusResponse } from '../../src/codex/status.js';
import type { RuntimeCapabilityMatrix } from '../../src/codex/capabilities.js';

describe('codex status response builder', () => {
  it('builds the stable codex status response shape', () => {
    const capabilities: RuntimeCapabilityMatrix = {
      codexVersion: '1.2.3-test',
      checkedAt: '2026-07-06T00:00:00.000Z',
      execJson: true,
      execStdinPrompt: true,
      execProfile: true,
      execCwd: true,
      execSandbox: true,
      execSkipGitRepoCheck: true,
      resumeJson: true,
      resumeByThreadId: true,
      resumeLast: true,
      resumeModelOverride: true,
      resumeConfigOverride: true,
      resumeCwdOverride: true,
      resumeProfileOverride: true,
      resumeSandboxOverride: true,
      execImages: true,
      resumeImages: true,
      resumeContextContinuityVerified: true,
      mcpList: true,
      mcpGet: true,
      mcpAdd: true,
      mcpRemove: true,
      mcpLogin: true,
      mcpLogout: true,
      mcpAddEnv: true,
      mcpAddUrl: true,
      mcpAddBearerTokenEnvVar: true,
      mcpAddOAuth: true,
      mcpRuntimeDiscoveryVerified: true,
      mcpRuntimeBehaviorVerified: true,
      skillsScan: true,
      skillsInstall: true,
      skillsDelete: true,
      skillsGlobalWrite: true,
      skillsRuntimeDiscoveryVerified: true,
      skillsRuntimeBehaviorVerified: true,
      warnings: []
    };

    const response = buildCodexStatusResponse({
      codexBin: 'codex',
      codexHome: {
        path: '/tmp/codex-home',
        mode: 'isolated',
        source: 'isolated',
        writable: true
      },
      capabilities
    });

    expect(response).toEqual({
      codexBin: 'codex',
      codexVersion: '1.2.3-test',
      codexHome: '/tmp/codex-home',
      codexHomeMode: 'isolated',
      codexHomeSource: 'isolated',
      codexHomeWritable: true,
      capabilities,
      diagnostics: []
    });
  });
});
