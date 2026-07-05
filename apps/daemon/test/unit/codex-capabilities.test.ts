import { describe, expect, it } from 'vitest';
import {
  isResumeExecutionSupported,
  parseCodexCapabilityMatrix,
  parseCodexExecHelp
} from '../../src/codex/capabilities.js';

const EXEC_HELP_01425 = `
Usage: codex exec [OPTIONS] [PROMPT]
  --json
  -p, --profile <PROFILE>
  -C, --cd <DIR>
  --sandbox <MODE>
  --image <PATH>
  --skip-git-repo-check
`;

const RESUME_HELP_01425 = `
Usage: codex exec resume [OPTIONS] [SESSION_ID] [PROMPT]
      --last
      --all
  -c, --config <key=value>
  -m, --model <MODEL>
      --skip-git-repo-check
      --ephemeral
      --ignore-user-config
      --ignore-rules
      --output-schema <FILE>
      --json
`;

const MCP_HELP_01425 = `
Usage: codex mcp [OPTIONS] <COMMAND>
Commands:
  list
  get <NAME>
  add [OPTIONS] <NAME> <COMMAND>...
  remove <NAME>
  login <NAME>
  logout <NAME>
`;

const MCP_ADD_HELP_01425 = `
Usage: codex mcp add [OPTIONS] <NAME> <COMMAND>...
  --env <KEY=VALUE>
  --url <URL>
  --bearer-token-env-var <ENV_VAR>
  --oauth-client-id <CLIENT_ID>
  --oauth-resource <RESOURCE>
`;

describe('codex capability parsing', () => {
  it('detects supported exec flags', () => {
    const parsed = parseCodexExecHelp(EXEC_HELP_01425);
    expect(parsed.supportsJson).toBe(true);
    expect(parsed.supportsProfiles).toBe(true);
    expect(parsed.supportsCd).toBe(true);
    expect(parsed.supportsSandbox).toBe(true);
    expect(parsed.supportsImages).toBe(true);
    expect(parsed.supportsSkipGitRepoCheck).toBe(true);
  });

  it('detects resume support and unsupported resume cwd profile sandbox overrides', () => {
    const matrix = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.142.5',
      execHelp: EXEC_HELP_01425,
      resumeHelp: RESUME_HELP_01425,
      mcpHelp: MCP_HELP_01425,
      mcpAddHelp: MCP_ADD_HELP_01425
    });

    expect(matrix.resumeJson).toBe(true);
    expect(matrix.resumeByThreadId).toBe(true);
    expect(matrix.resumeLast).toBe(true);
    expect(matrix.resumeModelOverride).toBe(true);
    expect(matrix.resumeConfigOverride).toBe(true);
    expect(matrix.resumeCwdOverride).toBe(false);
    expect(matrix.resumeProfileOverride).toBe(false);
    expect(matrix.resumeSandboxOverride).toBe(false);
    expect(isResumeExecutionSupported(matrix)).toBe(true);
  });

  it('detects mcp management support from help output', () => {
    const matrix = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.142.5',
      execHelp: EXEC_HELP_01425,
      resumeHelp: RESUME_HELP_01425,
      mcpHelp: MCP_HELP_01425,
      mcpAddHelp: MCP_ADD_HELP_01425
    });

    expect(matrix).toMatchObject({
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
      mcpRuntimeDiscoveryVerified: false,
      mcpRuntimeBehaviorVerified: false
    });
  });

  it('does not detect mcp commands from descriptive help text alone', () => {
    const matrix = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.142.5',
      execHelp: EXEC_HELP_01425,
      resumeHelp: RESUME_HELP_01425,
      mcpHelp: `
Usage: codex mcp [OPTIONS] <COMMAND>
Manage MCP servers. You can list, get, add, remove, login, and logout servers.
Commands:
  list
  add [OPTIONS] <NAME> <COMMAND>...
`,
      mcpAddHelp: MCP_ADD_HELP_01425
    });

    expect(matrix).toMatchObject({
      mcpList: true,
      mcpGet: false,
      mcpAdd: true,
      mcpRemove: false,
      mcpLogin: false,
      mcpLogout: false
    });
  });

  it('defaults skill capability flags to false when capability help is unknown', () => {
    const matrix = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.142.5',
      execHelp: '',
      resumeHelp: '',
      mcpHelp: '',
      mcpAddHelp: '',
      checkedAt: '2026-07-05T00:00:00.000Z'
    });

    expect(matrix).toMatchObject({
      mcpList: false,
      mcpGet: false,
      mcpAdd: false,
      mcpRemove: false,
      mcpLogin: false,
      mcpLogout: false,
      mcpAddEnv: false,
      mcpAddUrl: false,
      mcpAddBearerTokenEnvVar: false,
      mcpAddOAuth: false,
      mcpRuntimeDiscoveryVerified: false,
      mcpRuntimeBehaviorVerified: false,
      skillsScan: false,
      skillsInstall: false,
      skillsDelete: false,
      skillsGlobalWrite: false,
      skillsRuntimeDiscoveryVerified: false,
      skillsRuntimeBehaviorVerified: false
    });
  });
});
