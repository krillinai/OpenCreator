import { spawnSync } from 'node:child_process';

export const DEFAULT_OPENCREATOR_APPLE_TEAM_ID = 'NVRH5R5DJ5';

export function configureMacDirectorySigning(input) {
  const builderEnv = { ...input.env };

  if (input.platform !== 'darwin') {
    if (input.signed) {
      throw new Error('Developer ID directory signing is only supported on macOS');
    }
    return {
      args: [],
      builderEnv,
      mode: 'not-applicable',
      teamId: undefined
    };
  }

  if (!input.signed) {
    builderEnv.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    return {
      args: [
        '--config.mac.identity=null',
        '--config.mac.notarize=false'
      ],
      builderEnv,
      mode: 'adhoc',
      teamId: undefined,
      identity: undefined
    };
  }

  const teamId = input.teamId?.trim()
    || DEFAULT_OPENCREATOR_APPLE_TEAM_ID;
  const identity = findDeveloperIdIdentity(teamId, input.findIdentities);
  builderEnv.CSC_NAME = identity.replace(
    /^Developer ID Application:\s*/,
    ''
  );

  return {
    args: ['--config.mac.notarize=false'],
    builderEnv,
    mode: 'developer-id',
    teamId,
    identity
  };
}

export function findDeveloperIdIdentity(teamId, findIdentities = defaultFindIdentities) {
  const output = findIdentities();
  const identity = output
    .split(/\r?\n/)
    .map(line => /"([^"]*Developer ID Application:[^"]+)"/.exec(line)?.[1])
    .find(candidate => candidate?.includes(`(${teamId})`));
  if (identity === undefined) {
    throw new Error(
      `Missing Developer ID Application identity for Team ${teamId}`
    );
  }
  return identity;
}

function defaultFindIdentities() {
  const result = spawnSync('security', [
    'find-identity',
    '-v',
    '-p',
    'codesigning'
  ], {
    encoding: 'utf8',
    timeout: 30_000
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Unable to inspect macOS signing identities: `
      + `${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}
