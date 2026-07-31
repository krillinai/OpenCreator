import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createEnterpriseHttpClient,
  EnterpriseHttpError
} from '../../src/enterprise/http-client-2026-07-30.js';

const ORIGIN = 'https://enterprise.example';
const createdDirectories: string[] = [];

afterEach(() => {
  for (const directory of createdDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('enterprise HTTP client', () => {
  it('register omits client_id and discards set-cookie before automatic login can run', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'user@example.com',
        name: 'User',
        password: 'password-123'
      });
      return new Response(JSON.stringify({
        data: {
          account: {
            user_id: 'usr_1',
            email: 'user@example.com',
            name: 'User',
            status: 'active'
          }
        }
      }), {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'enterprise_session=must-not-escape'
        },
        status: 200
      });
    });
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.register({
      email: 'user@example.com',
      name: 'User',
      password: 'password-123'
    })).resolves.toBeUndefined();

    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(`${ORIGIN}/api/v1/auth/register`);
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json'
      }
    });
  });

  it('logs in with the fixed client id and parses only the public account summary', async () => {
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        email: 'user@example.com',
        password: 'password-123',
        client_id: 'clawee-agent'
      });
      return jsonResponse({
        data: {
          account: {
            user_id: 'usr_secret',
            email: 'user@example.com',
            name: 'User',
            status: 'active'
          },
          access_token: 'enterprise-access-token',
          token_type: 'Bearer',
          expires_at: '2026-07-31T10:00:00Z'
        }
      });
    });
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    await expect(client.login({
      email: 'user@example.com',
      password: 'password-123'
    })).resolves.toEqual({
      account: {
        email: 'user@example.com',
        name: 'User'
      },
      accessToken: 'enterprise-access-token',
      tokenType: 'Bearer',
      expiresAt: '2026-07-31T10:00:00Z'
    });
  });

  it('streams a bounded package and deletes it on sha256 mismatch', async () => {
    const directory = createTempDirectory();
    const content = Buffer.from('bounded enterprise package');
    const expectedSha256 = createHash('sha256').update(content).digest('hex');
    const fetch = vi.fn()
      .mockResolvedValueOnce(binaryResponse([
        content.subarray(0, 8),
        content.subarray(8)
      ]))
      .mockResolvedValueOnce(binaryResponse([content]));
    const client = createEnterpriseHttpClient({
      fetch,
      maxPackageBytes: 1024,
      origin: ORIGIN
    });
    const validPath = join(directory, 'valid.zip');
    const invalidPath = join(directory, 'invalid.zip');

    await expect(client.downloadSkillPackage({
      accessToken: 'enterprise-access-token',
      destinationPath: validPath,
      expectedSha256,
      skillId: 'skill_1',
      versionId: 'version_1'
    })).resolves.toEqual({
      bytes: content.length,
      sha256: expectedSha256
    });
    expect(readFileSync(validPath)).toEqual(content);

    await expect(client.downloadSkillPackage({
      accessToken: 'enterprise-access-token',
      destinationPath: invalidPath,
      expectedSha256: '0'.repeat(64),
      skillId: 'skill_1',
      versionId: 'version_1'
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_SKILL_PACKAGE_HASH_MISMATCH'
    });
    expect(existsSync(invalidPath)).toBe(false);
  });

  it('rejects declared and streamed package sizes over the configured limit', async () => {
    const directory = createTempDirectory();
    const destinationPath = join(directory, 'oversized.zip');
    const fetch = vi.fn(async () => binaryResponse(
      [Buffer.from('12345'), Buffer.from('67890')],
      { 'content-length': '10' }
    ));
    const client = createEnterpriseHttpClient({
      fetch,
      maxPackageBytes: 8,
      origin: ORIGIN
    });

    await expect(client.downloadSkillPackage({
      accessToken: 'enterprise-access-token',
      destinationPath,
      expectedSha256: '0'.repeat(64),
      skillId: 'skill_1',
      versionId: 'version_1'
    })).rejects.toMatchObject({
      code: 'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE'
    });
    expect(existsSync(destinationPath)).toBe(false);
  });

  it('keeps upstream bodies and credentials out of public errors', async () => {
    const token = 'enterprise-access-token';
    const fetch = vi.fn(async () => jsonResponse({
      error: {
        code: 'internal_error',
        message: `failed with ${token}`,
        request_id: 'req_123'
      }
    }, 503));
    const client = createEnterpriseHttpClient({ fetch, origin: ORIGIN });

    let error: unknown;
    try {
      await client.getMe(token);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(EnterpriseHttpError);
    expect(error).toMatchObject({
      code: 'ENTERPRISE_SERVICE_UNAVAILABLE',
      requestId: 'req_123',
      stage: 'response',
      statusCode: 503
    });
    expect(String(error)).not.toContain(token);
  });
});

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'clawee-enterprise-http-'));
  createdDirectories.push(directory);
  return directory;
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status
  });
}

function binaryResponse(
  chunks: Uint8Array[],
  headers: Record<string, string> = {}
): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
  return new Response(stream, {
    headers: {
      'content-type': 'application/zip',
      ...headers
    },
    status: 200
  });
}
