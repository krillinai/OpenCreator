import { describe, expect, it } from 'vitest';
import { execPath } from 'node:process';
import {
  applyCapabilityMatrix,
  collectCodexCapabilityMatrix,
  createUnknownCapabilityMatrix,
  isResumeExecutionSupported,
  isReusableCapabilityMatrix,
  normalizeCodexVersionOutput,
  parseCodexCapabilityMatrix,
  parseCodexExecHelp,
  probeCodexVersionAsync
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
  -i, --image <FILE>
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

const APP_SERVER_HELP_0144 = `
Run the app server
Commands:
  generate-json-schema
  generate-ts
`;

describe('codex capability parsing', () => {
  it('extracts the Codex version line when startup warnings are present', () => {
    expect(normalizeCodexVersionOutput([
      'WARNING: CODEX_HOME does not exist',
      'codex-cli 0.149.0'
    ].join('\n'))).toBe('codex-cli 0.149.0');
  });

  it('rejects capability caches created before knowledge isolation was recorded', () => {
    const legacy = {
      ...createUnknownCapabilityMatrix(),
      knowledgeToolIsolation: undefined,
      knowledgeBuiltInTools: undefined
    };

    expect(isReusableCapabilityMatrix(legacy)).toBe(false);
    expect(isReusableCapabilityMatrix(parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.146.0',
      execHelp: '',
      resumeHelp: '',
      mcpHelp: '',
      mcpAddHelp: ''
    }))).toBe(true);
  });

  it('accepts a null sync spawn error from successful process creation', () => {
    expect(() => collectCodexCapabilityMatrix({
      codexBin: execPath,
      timeoutMs: 1_000
    })).not.toThrow();
  });

  it('uses a fast local version probe as the executable startup gate', async () => {
    await expect(probeCodexVersionAsync({
      codexBin: execPath,
      timeoutMs: 1_000
    })).resolves.toMatchObject({
      ready: true,
      version: expect.stringContaining('v')
    });

    await expect(probeCodexVersionAsync({
      codexBin: '/path/that/does/not/exist/codex',
      timeoutMs: 100
    })).resolves.toMatchObject({
      ready: false,
      warning: expect.stringContaining('failed')
    });
  });

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
    expect(matrix.execImages).toBe(true);
    expect(matrix.resumeImages).toBe(true);
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

  it('detects app-server approval protocol support only when schemas are available', () => {
    const supported = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.144.1',
      execHelp: EXEC_HELP_01425,
      resumeHelp: RESUME_HELP_01425,
      mcpHelp: MCP_HELP_01425,
      mcpAddHelp: MCP_ADD_HELP_01425,
      appServerHelp: APP_SERVER_HELP_0144
    });
    const unsupported = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.142.5',
      execHelp: EXEC_HELP_01425,
      resumeHelp: RESUME_HELP_01425,
      mcpHelp: MCP_HELP_01425,
      mcpAddHelp: MCP_ADD_HELP_01425,
      appServerHelp: 'Run the app server'
    });

    expect(supported).toMatchObject({
      appServer: true,
      appServerApprovals: true
    });
    expect(unsupported).toMatchObject({
      appServer: true,
      appServerApprovals: false
    });
  });

  it('reports fail-closed knowledge tool switches only when every switch is supported', () => {
    const featureNames = [
      'shell_tool', 'unified_exec', 'shell_snapshot', 'browser_use',
      'computer_use', 'in_app_browser', 'image_generation', 'multi_agent',
      'plugins', 'apps'
    ];
    const supported = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.200.0',
      execHelp: `${EXEC_HELP_01425}\n  --ignore-user-config`,
      resumeHelp: RESUME_HELP_01425,
      mcpHelp: MCP_HELP_01425,
      mcpAddHelp: MCP_ADD_HELP_01425,
      appServerHelp: `${APP_SERVER_HELP_0144}\n  --disable <FEATURE>`,
      featuresOutput: featureNames.map(name => `${name} stable`).join('\n')
    });
    const missingShellSwitch = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.200.0',
      execHelp: `${EXEC_HELP_01425}\n  --ignore-user-config`,
      resumeHelp: RESUME_HELP_01425,
      mcpHelp: MCP_HELP_01425,
      mcpAddHelp: MCP_ADD_HELP_01425,
      appServerHelp: `${APP_SERVER_HELP_0144}\n  --disable <FEATURE>`,
      featuresOutput: featureNames.filter(name => name !== 'shell_tool')
        .map(name => `${name} stable`).join('\n')
    });

    expect(supported).toMatchObject({
      knowledgeToolIsolation: true,
      knowledgeBuiltInTools: {
        shell: true,
        fileRead: true,
        fileWrite: true,
        applyPatch: true,
        webSearch: true
      }
    });
    expect(missingShellSwitch).toMatchObject({
      knowledgeToolIsolation: false,
      knowledgeBuiltInTools: expect.objectContaining({ shell: false })
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

  it('updates one shared capability object in place', () => {
    const shared = createUnknownCapabilityMatrix('2026-07-01T00:00:00.000Z');
    const updated = parseCodexCapabilityMatrix({
      versionOutput: 'codex-cli 0.144.1',
      execHelp: EXEC_HELP_01425,
      resumeHelp: RESUME_HELP_01425,
      mcpHelp: MCP_HELP_01425,
      mcpAddHelp: MCP_ADD_HELP_01425,
      appServerHelp: APP_SERVER_HELP_0144
    });

    expect(applyCapabilityMatrix(shared, updated)).toBe(shared);
    expect(shared).toMatchObject({
      codexVersion: 'codex-cli 0.144.1',
      appServerApprovals: true,
      mcpAdd: true
    });
  });
});
