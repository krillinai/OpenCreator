import { describe, expect, it } from 'vitest';
import { parseCodexCapabilityMatrix, parseCodexExecHelp } from '../../src/codex/capabilities.js';

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

const MCP_ADD_HELP_01425 = `
Usage: codex mcp add [OPTIONS] <NAME> <COMMAND>...
  --env <KEY=VALUE>
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
  });
});
