import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { staticResponse } from '../src/main/protocol-handler.js';

let root = '';

afterEach(() => {
  if (root.length > 0) rmSync(root, { recursive: true, force: true });
  root = '';
});

describe('Desktop static response', () => {
  it('uses index.html for an extensionless workspace route', async () => {
    root = mkdtempSync(join(tmpdir(), 'clawee-static-'));
    writeFileSync(join(root, 'index.html'), '<main>workspace</main>');

    const response = await staticResponse(root, '/thread/abc', true);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('workspace');
  });

  it('returns 404 for missing scripts, styles, images, and wasm', async () => {
    root = mkdtempSync(join(tmpdir(), 'clawee-static-'));
    writeFileSync(join(root, 'index.html'), '<main>workspace</main>');

    for (const path of [
      '/assets/missing.js',
      '/assets/missing.css',
      '/assets/missing.png',
      '/assets/missing.wasm'
    ]) {
      expect((await staticResponse(root, path, true)).status, path).toBe(404);
    }
  });

  it('serves an existing asset with its real MIME type', async () => {
    root = mkdtempSync(join(tmpdir(), 'clawee-static-'));
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets', 'app.js'), 'export {}');

    const response = await staticResponse(root, '/assets/app.js', true);
    expect(response.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(await response.text()).toBe('export {}');
  });
});
