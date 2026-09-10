import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerCreatorRoutes } from '../../src/api/routes.creator.js';
import { createCreatorAgentRepository } from '../../src/creator/agent/repository.js';
import { createCreatorCommandDispatcher } from '../../src/creator/command-dispatcher.js';
import { createCreatorEventHub } from '../../src/creator/events.js';
import { createCreatorRepository } from '../../src/creator/repository.js';
import { createCreatorService } from '../../src/creator/service.js';
import {
  createStickmanVisualAssetRegistry,
  StickmanVisualAssetError
} from '../../src/creator/stickman/visual-assets.js';
import { createDefaultCreatorTemplateRegistry } from '../../src/creator/templates/registry.js';
import { openRuntimeDatabase } from '../../src/storage/database.js';

const catalogPath = fileURLToPath(new URL(
  '../../../../resources/stickman/visual-assets/catalog.json',
  import.meta.url
));
const assetRoot = fileURLToPath(new URL(
  '../../../../apps/web/public/dashboard',
  import.meta.url
));

let tempRoot = '';

afterEach(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = '';
});

describe('stickman visual asset catalog', () => {
  it('lists the shared catalog and serves character previews through Creator routes', async () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'stickman-visual-assets-'));
    const db = openRuntimeDatabase(join(tempRoot, 'runtime.sqlite'));
    const repository = createCreatorRepository(db);
    const service = createCreatorService({
      repository,
      templates: createDefaultCreatorTemplateRegistry()
    });
    const dispatcher = createCreatorCommandDispatcher({
      service,
      repository,
      receipts: createCreatorAgentRepository(db)
    });
    const visualAssets = createStickmanVisualAssetRegistry({ root: assetRoot, catalogPath });
    const app = Fastify();
    await registerCreatorRoutes(app, service, createCreatorEventHub(), {
      dispatcher,
      stickmanVisualAssets: visualAssets
    });

    const catalog = await app.inject({
      method: 'GET',
      url: '/creator/visual-assets?templateId=stickman-video'
    });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().assets).toHaveLength(14);
    expect(catalog.json().assets.filter((asset: { kind: string }) => asset.kind === 'character'))
      .toHaveLength(10);
    expect(catalog.json().assets).toContainEqual(expect.objectContaining({
      id: 'stickman.style.paper-pencil',
      kind: 'style',
      recommended: true,
      styleAttributes: expect.objectContaining({
        swatch: expect.objectContaining({ texture: 'paper' })
      })
    }));

    const preview = await app.inject({
      method: 'GET',
      url: '/creator/visual-assets/stickman.character.student/revisions/1/preview'
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.headers['content-type']).toContain('image/png');
    expect(preview.rawPayload.length).toBeGreaterThan(1_000);

    await app.close();
    db.close();
  });

  it('rejects duplicate revisions and reference paths outside the Runtime root', () => {
    tempRoot = mkdtempSync(join(tmpdir(), 'stickman-visual-assets-'));
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      characters: Array<Record<string, unknown>>;
      styles: Array<Record<string, unknown>>;
    };
    catalog.characters.push(structuredClone(catalog.characters[0]!));
    const duplicatePath = join(tempRoot, 'duplicate.json');
    writeFileSync(duplicatePath, JSON.stringify(catalog));
    expect(() => createStickmanVisualAssetRegistry({
      root: tempRoot,
      catalogPath: duplicatePath
    })).toThrowError(StickmanVisualAssetError);

    catalog.characters.pop();
    catalog.characters[0] = {
      ...catalog.characters[0],
      referenceFiles: [{ role: 'identity-primary', path: '../outside.png' }]
    };
    const escapedPath = join(tempRoot, 'escaped.json');
    writeFileSync(escapedPath, JSON.stringify(catalog));
    const registry = createStickmanVisualAssetRegistry({ root: tempRoot, catalogPath: escapedPath });
    expect(() => registry.referenceFiles(registry.character({
      assetId: 'stickman.character.default',
      revision: 1
    }))).toThrowError(/escapes its root/);
  });
});
