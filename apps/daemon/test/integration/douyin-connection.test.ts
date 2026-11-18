import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { PlatformConnectionService } from '../../src/platform-connections/service.js';
import { PublicPlatformConnectionError } from '../../src/platform-connections/errors.js';
import { filterPlatformCookies, hasPlatformSession, parsePlatformCookies, serializePlatformCookies } from '../../src/platform-connections/cookies.js';
import { readBrowserPlatformCookies, type BrowserProfile } from '../../src/platform-connections/browser.js';
import { registerPlatformConnectionRoutes } from '../../src/api/routes.platform-connections.js';
import { requireAuth } from '../../src/api/auth.js';

const cookie = { name: 's_v_web_id', value: 'private-verification-session', domain: '.douyin.com',
  path: '/', secure: true, httpOnly: true, expires: 0 };
const profile: BrowserProfile = { id: 'b'.repeat(24), browser: 'chrome', label: 'Chrome Test', directory: '/private/profile', preferred: true };
const otherProfile: BrowserProfile = { ...profile, id: 'c'.repeat(24), directory: '/private/other-profile' };
const runtime = { executable: '/yt-dlp', prefixArgs: ['--plugin-dirs', '/plugins'], version: 'test', env: {} };
const roots: string[] = [];
const services: PlatformConnectionService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.close()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function setup(readBrowserCookies?: typeof readBrowserPlatformCookies, platform: 'youtube' | 'douyin' = 'douyin') {
  const root = await mkdtemp(join(tmpdir(), 'douyin-connection-'));
  roots.push(root);
  const service = new PlatformConnectionService({ root, platform, getRuntime: () => runtime,
    listProfiles: async () => [otherProfile, profile], readBrowserCookies });
  services.push(service);
  await service.initialize();
  return { root, service };
}

it('accepts anonymous Douyin verification cookies and filters other platforms, expired cookies and injected fields', () => {
  const filtered = filterPlatformCookies([cookie, { ...cookie, domain: '.youtube.com' },
    { ...cookie, domain: '.douyin.com.evil.test' }, { ...cookie, expires: 1 },
    { ...cookie, value: 'injected\nvalue' }], 'douyin');
  expect(filtered).toEqual([cookie]);
  expect(hasPlatformSession(filtered, 'douyin')).toBe(true);
  expect(parsePlatformCookies(serializePlatformCookies(filtered, 'douyin'), 'douyin')).toEqual([cookie]);
  expect(filterPlatformCookies(filtered, 'youtube')).toEqual([]);
});

it('reads only the explicitly selected platform through the browser cookie adapter', async () => {
  if (process.platform === 'win32') return;
  const { root } = await setup();
  const executable = join(root, 'python-fixture');
  await writeFile(executable, `#!/bin/sh\n[ "$8" = "douyin.com" ] || exit 1\nprintf '%s' '${JSON.stringify({ cookies: [cookie, { ...cookie, domain: '.youtube.com' }] })}'\n`, { mode: 0o700 });
  expect(await readBrowserPlatformCookies({ profile, platform: 'douyin',
    runtime: { ...runtime, executable, script: '/yt-dlp.zip' }, signal: new AbortController().signal })).toEqual([cookie]);
});

it('connects without requiring a logged-in account and returns no credentials in public state', async () => {
  const read = vi.fn(async () => [cookie, { ...cookie, domain: '.youtube.com' }]);
  const { root, service } = await setup(read);
  expect((await service.connect(profile.id)).status).toBe('connecting');
  await vi.waitFor(async () => expect((await service.getState()).status).toBe('connected'));
  expect(read).toHaveBeenCalledWith(expect.objectContaining({ platform: 'douyin', profile }));
  expect(JSON.stringify(await service.getState())).not.toMatch(/private-verification-session|s_v_web_id|\/private\/profile/);
  expect(JSON.parse(await readFile(join(root, 'credentials.json'), 'utf8')).cookies).toEqual([cookie]);
  if (process.platform !== 'win32') expect((await stat(join(root, 'credentials.json'))).mode & 0o777).toBe(0o600);
});

it.each([
  [new PublicPlatformConnectionError('Allow macOS Keychain access and reconnect.'), 'Allow macOS Keychain access and reconnect.'],
  [new Error('Could not read /private/profile/Cookies with token=private'), 'Could not read the browser session. Try again or select another browser profile.']
])('preserves public connection guidance and filters internal errors: %s', async (error, message) => {
  const { service } = await setup(async () => { throw error; });
  await service.connect(profile.id);
  await vi.waitFor(async () => expect(await service.getState()).toMatchObject({ status: 'error', message }));
});

it('isolates concurrent task files and platform credentials and removes snapshots after failure', async () => {
  const { root, service } = await setup();
  const { service: youtube } = await setup(undefined, 'youtube');
  await service.importCookies(serializePlatformCookies([cookie], 'douyin'));
  await youtube.importCookies(serializePlatformCookies(['SID', 'SAPISID'].map(name => ({ ...cookie, name,
    domain: '.youtube.com', value: 'private-youtube' })), 'youtube'));
  const paths: string[] = [];
  await youtube.withCookies(() => Promise.all(Array.from({ length: 3 }, () => service.withCookies(async () => {
    const path = service.authenticatedRuntime(runtime)!.prefixArgs.at(-1)!;
    paths.push(path);
    const text = await readFile(path, 'utf8');
    expect(text).toContain('private-verification-session');
    expect(text).not.toContain('youtube');
    expect(await readFile(youtube.authenticatedRuntime(runtime)!.prefixArgs.at(-1)!, 'utf8')).not.toContain('douyin');
  }))));
  expect(new Set(paths).size).toBe(3);
  for (const path of paths) await expect(access(path)).rejects.toThrow();
  await expect(service.withCookies(async () => { throw new Error('HTTP Error 403'); })).rejects.toThrow('403');
  expect((await service.getState()).status).toBe('connected');
  expect(await readdir(root)).toEqual(['credentials.json']);
});

it('cancels a browser read, preserves the saved session, and requires explicit reconnect after expiry', async () => {
  const read: typeof readBrowserPlatformCookies = ({ signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  });
  const { service } = await setup(read);
  await service.importCookies(serializePlatformCookies([cookie], 'douyin'));
  await service.connect();
  expect((await service.cancel()).status).toBe('connected');
  await expect(service.withCookies(async () => { throw new Error('The cookies are no longer valid'); })).rejects.toThrow('no longer valid');
  expect((await service.getState()).status).toBe('expired');
  await service.withCookies(async () => expect(service.authenticatedRuntime(runtime)).toBe(runtime));
  await service.disconnect();
  expect((await service.getState()).status).toBe('disconnected');
});

it.each([false, undefined])('refreshes the saved profile on use with legacy reconnect preference %s, until disconnected', async legacyPreference => {
  const read = vi.fn(async () => [cookie]);
  const { root, service } = await setup(read);
  await service.refreshBrowserSession();
  expect(read).not.toHaveBeenCalled();
  await service.connect(profile.id);
  await vi.waitFor(async () => expect((await service.getState()).status).toBe('connected'));
  await expect(service.withCookies(async () => { throw new Error('The cookies are no longer valid'); })).rejects.toThrow('no longer valid');
  expect((await service.getState()).status).toBe('expired');
  expect(read).toHaveBeenCalledTimes(1);
  const credentialFile = join(root, 'credentials.json');
  const credentials = JSON.parse(await readFile(credentialFile, 'utf8'));
  await writeFile(credentialFile, JSON.stringify({ ...credentials, autoReconnect: legacyPreference }));

  read.mockResolvedValue([{ ...cookie, value: 'refreshed-session' }]);
  const restarted = new PlatformConnectionService({ root, platform: 'douyin', getRuntime: () => runtime,
    listProfiles: async () => [otherProfile, profile], readBrowserCookies: read });
  services.push(restarted);
  await restarted.initialize();
  expect(read).toHaveBeenCalledTimes(1);
  await Promise.all(Array.from({ length: 3 }, () => restarted.refreshBrowserSession()));
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ profile, platform: 'douyin' }));
  expect(await restarted.getState()).toMatchObject({ status: 'connected', profileId: profile.id });
  await restarted.withCookies(async () => {
    const path = restarted.authenticatedRuntime(runtime)!.prefixArgs.at(-1)!;
    expect(await readFile(path, 'utf8')).toContain('refreshed-session');
  });

  await restarted.disconnect();
  await restarted.refreshBrowserSession();
  expect(await restarted.getState()).toMatchObject({ status: 'disconnected' });
  expect(read).toHaveBeenCalledTimes(2);
});

it('keeps a rejected snapshot expired, throttles unsuccessful reads, and never refreshes a file import', async () => {
  const read = vi.fn(async () => [cookie]);
  const { service } = await setup(read);
  await service.connect(profile.id);
  await vi.waitFor(async () => expect((await service.getState()).status).toBe('connected'));
  await expect(service.withCookies(async () => { throw new Error('The cookies are no longer valid'); })).rejects.toThrow('no longer valid');
  await service.refreshBrowserSession();
  await service.refreshBrowserSession();
  expect(read).toHaveBeenCalledTimes(2);
  expect((await service.getState()).status).toBe('expired');

  await service.importCookies(serializePlatformCookies([cookie], 'douyin'));
  await expect(service.withCookies(async () => { throw new Error('The cookies are no longer valid'); })).rejects.toThrow('no longer valid');
  await service.refreshBrowserSession();
  expect(await service.getState()).toMatchObject({ status: 'expired', profileId: undefined });
  expect(read).toHaveBeenCalledTimes(2);
});

it('retains the saved connection for disconnect after a manual reconnection fails', async () => {
  const read = vi.fn(async () => [cookie]);
  const { service } = await setup(read);
  await service.connect(profile.id);
  await vi.waitFor(async () => expect((await service.getState()).status).toBe('connected'));
  const { connectedAt } = await service.getState();
  await expect(service.withCookies(async () => { throw new Error('The cookies are no longer valid'); })).rejects.toThrow('no longer valid');
  read.mockRejectedValueOnce(new PublicPlatformConnectionError('Browser is unavailable.'));
  await service.connect(otherProfile.id);
  await vi.waitFor(async () => expect((await service.getState()).status).toBe('error'));
  expect(await service.getState()).toMatchObject({ status: 'error', profileId: profile.id, connectedAt });
  expect(await service.disconnect()).toMatchObject({ status: 'disconnected' });
  await service.refreshBrowserSession();
  expect(read).toHaveBeenCalledTimes(2);
});

it('protects the Douyin API, rejects foreign cookies and invalid profiles, and disconnects only Douyin', async () => {
  const { service } = await setup();
  const { service: youtube } = await setup(undefined, 'youtube');
  const server = Fastify();
  server.addHook('onRequest', requireAuth('runtime-token'));
  await registerPlatformConnectionRoutes(server, youtube, service);
  const headers = { authorization: 'Bearer runtime-token' };
  try {
    expect((await server.inject({ url: '/platform-connections/douyin' })).statusCode).toBe(401);
    expect((await server.inject({ method: 'POST', url: '/platform-connections/douyin/connect', headers, payload: { profileId: '../profile' } })).statusCode).toBe(400);
    const foreign = serializePlatformCookies(['SID', 'SAPISID'].map(name => ({ ...cookie, name, domain: '.youtube.com' })), 'youtube');
    expect((await server.inject({ method: 'POST', url: '/platform-connections/douyin/import', headers, payload: { cookies: foreign } })).statusCode).toBe(400);
    const imported = await server.inject({ method: 'POST', url: '/platform-connections/douyin/import', headers, payload: { cookies: serializePlatformCookies([cookie], 'douyin') } });
    expect(imported.statusCode).toBe(200);
    expect(imported.headers['cache-control']).toBe('no-store');
    expect(imported.json()).toMatchObject({ platform: 'douyin', status: 'connected' });
    expect(imported.body).not.toContain(cookie.value);
    expect((await youtube.getState()).status).toBe('disconnected');
    expect((await server.inject({ method: 'DELETE', url: '/platform-connections/douyin', headers })).json().status).toBe('disconnected');
  } finally { await server.close(); }
});
