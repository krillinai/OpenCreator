import Fastify, { type FastifyInstance } from 'fastify';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openCreatorLanguagePreferences, type OpenCreatorUiSettingsResponse } from '@opencreator/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerSettingsRoutes } from '../../src/api/routes.settings.js';
import { createOpenCreatorSettingsStore, type OpenCreatorSettingsStore } from '../../src/settings/store.js';

describe('OpenCreator settings routes', () => {
  let server: FastifyInstance;
  let store: OpenCreatorSettingsStore;
  let validateStoragePath: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    store = {
      claimAgentOnboarding: vi.fn(() => true),
      readUi: vi.fn((): OpenCreatorUiSettingsResponse => ({
        configured: false,
        settings: {
          language: 'system',
          colorMode: 'dark',
          accentColor: 'red',
          customAccentColor: '#3b82f6',
          defaultPermission: 'danger-full-access'
        }
      })),
      updateUi: vi.fn((update): OpenCreatorUiSettingsResponse => ({
        configured: true,
        settings: {
          language: update.language ?? 'system',
          colorMode: update.colorMode ?? 'dark',
          accentColor: update.accentColor ?? 'red',
          customAccentColor: update.customAccentColor ?? '#3b82f6',
          defaultPermission: update.defaultPermission ?? 'danger-full-access'
        }
      })),
      readStorage: vi.fn(() => ({
        configured: false,
        settings: {
          defaultProjectRoot: '/tmp/OpenCreator',
          outputRoot: '/tmp/OpenCreator/Exports'
        }
      })),
      updateStorage: vi.fn(update => ({
        configured: true,
        settings: {
          defaultProjectRoot: update.defaultProjectRoot ?? '/tmp/OpenCreator',
          outputRoot: update.outputRoot ?? '/tmp/OpenCreator/Exports'
        }
      }))
    };
    server = Fastify({ logger: false });
    validateStoragePath = vi.fn((_path: string): boolean => true);
    await registerSettingsRoutes(server, store, { validateStoragePath });
  });

  afterEach(async () => {
    await server.close();
  });

  it('reads and updates UI settings', async () => {
    expect((await server.inject({
      method: 'GET',
      url: '/settings/ui'
    })).json()).toMatchObject({
      configured: false,
      settings: { accentColor: 'red' }
    });

    const updated = await server.inject({
      method: 'PATCH',
      url: '/settings/ui',
      payload: {
        language: 'sv-SE',
        colorMode: 'light',
        accentColor: 'red'
      }
    });

    expect(updated.statusCode).toBe(200);
    expect(store.updateUi).toHaveBeenCalledWith({
      language: 'sv-SE',
      colorMode: 'light',
      accentColor: 'red'
    });
  });

  it('only accepts an explicit onboarding preference', async () => {
    const claim = (payload: object) => server.inject({ method: 'POST', url: '/settings/agent-onboarding', payload });
    expect((await claim({ offer: 'true' })).statusCode).toBe(400);
    expect(store.claimAgentOnboarding).not.toHaveBeenCalled();
    expect((await claim({ offer: true })).json()).toEqual({ show: true });
    expect(store.claimAgentOnboarding).toHaveBeenCalledWith(true);
  });

  it.each([
    { existingProfile: false, offer: true, firstShow: true },
    { existingProfile: false, offer: false, firstShow: false },
    { existingProfile: true, offer: true, firstShow: false }
  ])('persists the decision for the next launch ($existingProfile, $offer)', ({ existingProfile, offer, firstShow }) => {
    const directory = mkdtempSync(join(tmpdir(), 'opencreator-agent-onboarding-'));
    try {
      const storeForLaunch = (existing: boolean) => createOpenCreatorSettingsStore(join(directory, 'config.toml'), {
        defaultProjectRoot: join(directory, 'projects'), outputRoot: join(directory, 'exports')
      }, existing);

      expect(storeForLaunch(existingProfile).claimAgentOnboarding(offer)).toBe(firstShow);
      expect(storeForLaunch(false).claimAgentOnboarding(true)).toBe(false);
      expect(storeForLaunch(false).readUi().configured).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('rejects unknown or malformed settings', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/settings/ui',
      payload: {
        accentColor: 'green',
        unknown: true
      }
    });

    expect(response.statusCode).toBe(400);
    expect(store.updateUi).not.toHaveBeenCalled();
  });

  it('accepts the OpenCreator brand accent', async () => {
    const response = await server.inject({
      method: 'PATCH',
      url: '/settings/ui',
      payload: { accentColor: 'brand' }
    });

    expect(response.statusCode).toBe(200);
    expect(store.updateUi).toHaveBeenCalledWith({ accentColor: 'brand' });
  });

  it.each(openCreatorLanguagePreferences)('accepts language preference %s', async language => {
    const response = await server.inject({ method: 'PATCH', url: '/settings/ui', payload: { language } });
    expect(response.statusCode).toBe(200);
    expect(response.json().settings.language).toBe(language);
  });

  it('rejects unsupported language preferences', async () => {
    const response = await server.inject({ method: 'PATCH', url: '/settings/ui', payload: { language: 'xx-XX' } });
    expect(response.statusCode).toBe(400);
    expect(store.updateUi).not.toHaveBeenCalled();
  });

  it('reads and updates storage settings', async () => {
    const current = await server.inject({ method: 'GET', url: '/settings/storage' });
    expect(current.json().settings.outputRoot).toBe('/tmp/OpenCreator/Exports');

    const updated = await server.inject({
      method: 'PATCH',
      url: '/settings/storage',
      payload: { defaultProjectRoot: '/Volumes/Projects' }
    });
    expect(updated.statusCode).toBe(200);
    expect(store.updateStorage).toHaveBeenCalledWith({
      defaultProjectRoot: '/Volumes/Projects'
    });
    expect(validateStoragePath).toHaveBeenCalledWith('/Volumes/Projects');
  });

  it('rejects relative or unavailable storage directories', async () => {
    const relative = await server.inject({
      method: 'PATCH',
      url: '/settings/storage',
      payload: { outputRoot: 'relative/exports' }
    });
    expect(relative.statusCode).toBe(400);
    expect(store.updateStorage).not.toHaveBeenCalled();

    validateStoragePath.mockReturnValue(false);
    const unavailable = await server.inject({
      method: 'PATCH',
      url: '/settings/storage',
      payload: { outputRoot: '/read-only/exports' }
    });
    expect(unavailable.statusCode).toBe(400);
    expect(store.updateStorage).not.toHaveBeenCalled();
  });
});
