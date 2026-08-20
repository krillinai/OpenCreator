import { createHmac } from 'node:crypto';

export function createKlingAuthorization(accessKey: string, secretKey: string, now = Date.now()): string {
  const seconds = Math.floor(now / 1000);
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = base64Url(JSON.stringify({ iss: accessKey, exp: seconds + 1800, nbf: seconds - 5 }));
  const signature = createHmac('sha256', secretKey)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `Bearer ${header}.${payload}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}
