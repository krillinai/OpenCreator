import {
  mkdtempSync,
  readFileSync,
  rmSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDesktopLogger } from '../src/main/logger.js';
import {
  redactText,
  redactValue
} from '../src/main/redaction.js';

let tempDir = '';

afterEach(() => {
  if (tempDir.length > 0) rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('Desktop logger redaction', () => {
  it('redacts text and nested structured secrets', () => {
    expect(redactText(
      'Authorization: Bearer abc TOKEN=value sk-abcdefgh clwcap_secret'
    )).not.toContain('abc');
    expect(redactValue({
      token: 'direct',
      nested: ['API_KEY=value', { message: 'secret: hidden' }]
    })).toEqual({
      token: '[REDACTED]',
      nested: ['API_KEY=[REDACTED]', { message: 'secret: [REDACTED]' }]
    });
  });

  it('writes asynchronously and flushes redacted entries', async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencreator-logger-'));
    const path = join(tempDir, 'desktop.log');
    const logger = createDesktopLogger(path);

    logger.info('token: plain-secret', {
      authorization: 'Bearer direct-secret',
      nested: { value: 'clwcap_abcdef' }
    });
    await logger.flush();

    const content = readFileSync(path, 'utf8');
    expect(content).not.toContain('plain-secret');
    expect(content).not.toContain('direct-secret');
    expect(content).not.toContain('clwcap_abcdef');
    expect(content).toContain('[REDACTED]');
  });
});
