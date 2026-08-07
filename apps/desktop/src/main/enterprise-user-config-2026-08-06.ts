import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';

export const ENTERPRISE_CONFIG_FILENAME = 'config.toml';

export type PreparedEnterpriseUserConfig = {
  path: string;
};

export function prepareEnterpriseUserConfig(input: {
  bundledPath: string;
  userPath: string;
}): PreparedEnterpriseUserConfig {
  if (!existsSync(input.userPath)) {
    writeUserConfig(
      input.userPath,
      readFileSync(input.bundledPath, 'utf8')
    );
  }
  return { path: input.userPath };
}

function writeUserConfig(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, contents, { mode: 0o600 });
  renameSync(temporaryPath, path);
}
