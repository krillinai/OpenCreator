import { randomBytes } from 'node:crypto';

export function createRuntimeToken(): string {
  return randomBytes(32).toString('base64url');
}
