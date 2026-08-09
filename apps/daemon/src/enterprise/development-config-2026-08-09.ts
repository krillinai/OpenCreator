import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import {
  readEnterpriseClientConfig,
  serializeEnterpriseClientConfig,
  type EnterpriseClientConfig
} from './client-config-2026-08-06.js';

export function prepareEnterpriseDevelopmentConfig(input: {
  templatePath: string;
  userPath: string;
}): { path: string } {
  const template = readEnterpriseClientConfig(input.templatePath);
  const userPath = resolve(input.userPath);
  const existing = existsSync(userPath)
    ? readEnterpriseClientConfig(userPath)
    : undefined;
  const next: EnterpriseClientConfig = {
    gateway: template.gateway,
    ...(existing?.agentId === undefined
      ? {}
      : { agentId: existing.agentId })
  };

  if (existing !== undefined && sameConfig(existing, next)) {
    chmodSync(userPath, 0o600);
    return { path: userPath };
  }

  writeAtomic(userPath, serializeEnterpriseClientConfig(next));
  return { path: userPath };
}

function sameConfig(
  left: EnterpriseClientConfig,
  right: EnterpriseClientConfig
): boolean {
  return left.gateway === right.gateway && left.agentId === right.agentId;
}

function writeAtomic(path: string, contents: string): void {
  const parent = dirname(path);
  mkdirSync(parent, { recursive: true });
  const temporary = join(
    parent,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    writeFileSync(temporary, contents, {
      encoding: 'utf8',
      flag: 'wx',
      mode: 0o600
    });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}
