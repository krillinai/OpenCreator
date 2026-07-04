import { describe, expect, it } from 'vitest';
import { parseCodexExecHelp } from '../../src/codex/capabilities.js';

describe('codex capability parsing', () => {
  it('detects supported exec flags', () => {
    const parsed = parseCodexExecHelp(`
Usage: codex exec [OPTIONS] [PROMPT]
  --json
  -p, --profile <PROFILE>
  -C, --cd <DIR>
  --sandbox <MODE>
  --image <PATH>
  --skip-git-repo-check
`);
    expect(parsed.supportsJson).toBe(true);
    expect(parsed.supportsProfiles).toBe(true);
    expect(parsed.supportsCd).toBe(true);
    expect(parsed.supportsSandbox).toBe(true);
    expect(parsed.supportsImages).toBe(true);
    expect(parsed.supportsSkipGitRepoCheck).toBe(true);
  });
});
