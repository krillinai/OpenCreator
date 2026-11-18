import { AsyncLocalStorage } from 'node:async_hooks';
import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConnectionPlatform, PlatformConnectionState } from '@opencreator/protocol';
import { readPrivateJsonFile, writePrivateJsonFile } from '../config/private-json-file.js';
import type { YtDlpRuntime } from '../creator/yt-dlp/runtime.js';
import { listBrowserProfiles, readBrowserPlatformCookies, type BrowserProfile } from './browser.js';
import { LoginBrowserCloseError, openWindowsYouTubeLogin, type BrowserLoginSession } from './browser-login.js';
import { PublicPlatformConnectionError } from './errors.js';
import { filterPlatformCookies, hasPlatformSession, parsePlatformCookies,
  serializePlatformCookies, type PlatformCookie } from './cookies.js';

type Credential = { version: 1; cookies: PlatformCookie[]; connectedAt: string;
  browser?: 'chrome' | 'edge'; profileId?: string; invalidated?: boolean };
type ConnectionAttempt = { controller: AbortController; work: Promise<void>; completeLogin?: () => void };
const AUTO_RECONNECT_TIMEOUT_MS = 5_000;
const AUTO_RECONNECT_COOLDOWN_MS = 60_000;

type ConnectionState<P extends ConnectionPlatform> = PlatformConnectionState & { platform: P };
export type PlatformConnectionOptions = {
  root: string;
  platform?: ConnectionPlatform;
  getRuntime(): YtDlpRuntime | undefined;
  listProfiles?: typeof listBrowserProfiles;
  readBrowserCookies?: typeof readBrowserPlatformCookies;
  openLoginBrowser?: typeof openWindowsYouTubeLogin;
  connectionTimeoutMs?: number;
  osPlatform?: NodeJS.Platform;
};

export class PlatformConnectionService<P extends ConnectionPlatform = ConnectionPlatform> {
  private state: ConnectionState<P>;
  private readonly platform: P;
  private attempt?: ConnectionAttempt;
  private context = new AsyncLocalStorage<{ path: string; credential: Credential }>();
  private mutations: Promise<unknown> = Promise.resolve();
  private lastAutoReconnect?: { connectedAt: string; time: number };
  private readonly credentialFile: string;
  constructor(private input: PlatformConnectionOptions & { platform?: P }) {
    this.platform = (input.platform ?? 'youtube') as P;
    this.state = { platform: this.platform, status: 'disconnected' };
    this.credentialFile = join(input.root, 'credentials.json');
  }

  private get managedLogin(): boolean {
    return this.platform === 'youtube' && (this.input.osPlatform ?? process.platform) === 'win32';
  }

  async initialize(): Promise<void> {
    await mkdir(this.input.root, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') await chmod(this.input.root, 0o700);
    for (const entry of await readdir(this.input.root)) {
      if (/^(?:login-|task-)/.test(entry)) await rm(join(this.input.root, entry), { recursive: true, force: true });
    }
    await this.refreshState();
  }
  async getState(): Promise<ConnectionState<P>> {
    if (!this.attempt && this.state.status !== 'error') await this.refreshState();
    return this.publicState();
  }
  async hasAuthentication(): Promise<boolean> {
    const credential = await this.readCredential();
    return !!credential && !credential.invalidated && hasPlatformSession(filterPlatformCookies(credential.cookies, this.platform), this.platform);
  }
  async refreshBrowserSession(): Promise<void> {
    if (this.managedLogin || this.attempt) return;
    await this.serialize(async () => {
      if (this.attempt) return;
      const credential = await this.readCredential();
      if (!credential?.profileId || !credential.browser) return;
      const savedCookies = filterPlatformCookies(credential.cookies, this.platform);
      if (!credential.invalidated && hasPlatformSession(savedCookies, this.platform)) return;
      if (this.lastAutoReconnect?.connectedAt === credential.connectedAt
        && Date.now() - this.lastAutoReconnect.time < AUTO_RECONNECT_COOLDOWN_MS) return;
      this.lastAutoReconnect = { connectedAt: credential.connectedAt, time: Date.now() };
      const signal = AbortSignal.timeout(AUTO_RECONNECT_TIMEOUT_MS);
      try {
        const profiles = await (this.input.listProfiles ?? listBrowserProfiles)();
        const profile = profiles.find(item => item.id === credential.profileId && item.browser === credential.browser);
        if (!profile) return;
        const cookies = await this.readProfileCookies(profile, signal);
        if (!hasPlatformSession(cookies, this.platform)) return;
        if (credential.invalidated && cookieSnapshot(cookies, this.platform) === cookieSnapshot(savedCookies, this.platform)) return;
        await this.saveProfileCookies(profile, cookies);
      } catch { return; }
    });
  }
  connect(profileId?: string): Promise<ConnectionState<P>> {
    return this.serialize(async () => {
      if (this.attempt) return this.publicState();
      if (this.managedLogin) {
        if (await this.hasAuthentication()) { await this.refreshState(); return this.publicState(); }
        const attempt: ConnectionAttempt = { controller: new AbortController(), work: Promise.resolve() };
        this.attempt = attempt;
        this.state = { platform: this.platform, status: 'connecting', message: 'Opening the YouTube sign-in window' };
        attempt.work = this.finishConnection(attempt);
        return this.publicState();
      }
      const profiles = await (this.input.listProfiles ?? listBrowserProfiles)();
      const profile = profileId ? profiles.find(p => p.id === profileId) : profiles[0];
      if (!profile) {
        this.state = { platform: this.platform, status: 'error', message: this.platform === 'youtube'
          ? 'No browser profile was found. Sign in to YouTube in Chrome or Edge first.'
          : 'No browser profile was found. Open Douyin in Chrome or Edge and complete website verification first.' };
        return this.publicState();
      }
      const attempt = { controller: new AbortController(), work: Promise.resolve() };
      this.attempt = attempt;
      this.state = { platform: this.platform, status: 'connecting', browser: profile.browser, profileId: profile.id };
      attempt.work = this.finishConnection(attempt, profile);
      return this.publicState();
    });
  }
  completeLogin(): Promise<ConnectionState<P>> {
    return this.serialize(async () => {
      if (this.attempt?.completeLogin) {
        this.attempt.completeLogin();
        this.state = { platform: this.platform, status: 'connecting', browser: 'chrome', message: 'Saving the YouTube session' };
      }
      return this.publicState();
    });
  }
  cancel(): Promise<ConnectionState<P>> {
    return this.serialize(async () => { await this.stopConnection(); await this.refreshState(); return this.publicState(); });
  }
  disconnect(): Promise<ConnectionState<P>> {
    return this.serialize(async () => {
      await this.stopConnection();
      await rm(this.credentialFile, { force: true });
      if (this.managedLogin) {
        for (const browser of ['chrome', 'edge']) {
          await rm(join(this.input.root, `browser-${browser}`), { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
        }
      }
      this.state = { platform: this.platform, status: 'disconnected' };
      return this.publicState();
    });
  }
  importCookies(source: string): Promise<ConnectionState<P>> {
    return this.serialize(async () => {
      const cookies = parsePlatformCookies(source, this.platform);
      if (!hasPlatformSession(cookies, this.platform)) throw new PublicPlatformConnectionError(this.platform === 'youtube'
        ? 'The cookie file contains no valid YouTube session.' : 'The cookie file contains no valid Douyin session.');
      await this.stopConnection();
      await writePrivateJsonFile(this.credentialFile, { version: 1, cookies, connectedAt: new Date().toISOString() } satisfies Credential);
      await this.refreshState();
      return this.publicState();
    });
  }
  authenticatedRuntime(runtime: YtDlpRuntime | undefined): YtDlpRuntime | undefined {
    const context = this.context.getStore();
    return runtime && context ? { ...runtime, prefixArgs: [...runtime.prefixArgs, '--cookies', context.path] } : runtime;
  }
  async withCookies<T>(operation: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return operation();
    const credential = await this.readCredential();
    const cookies = filterPlatformCookies(credential?.cookies, this.platform);
    if (!credential || credential.invalidated || !hasPlatformSession(cookies, this.platform)) return operation();
    const directory = await mkdtemp(join(this.input.root, 'task-'));
    if (process.platform !== 'win32') await chmod(directory, 0o700);
    const path = join(directory, 'cookies.txt');
    try {
      await writeFile(path, serializePlatformCookies(cookies, this.platform), { mode: 0o600, flag: 'wx' });
      return await this.context.run({ path, credential }, operation);
    } catch (error) {
      // A media 403 or bot challenge alone is not proof that the account expired.
      if (error instanceof Error && /cookies (?:are )?no longer valid|cookies? (?:have |has )?expired/i.test(error.message)) {
        await this.serialize(async () => {
          const current = await this.readCredential();
          if (current?.connectedAt === credential.connectedAt) {
            await writePrivateJsonFile(this.credentialFile, { ...current, invalidated: true });
            await this.refreshState();
          }
        });
      }
      throw error;
    } finally { await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); }
  }
  async close(): Promise<void> { await this.serialize(() => this.stopConnection()); }
  private async finishConnection(attempt: ConnectionAttempt, profile?: BrowserProfile): Promise<void> {
    const managed = this.managedLogin;
    const timeout = setTimeout(() => attempt.controller.abort(), this.input.connectionTimeoutMs ?? (managed ? 600_000 : 120_000));
    let login: BrowserLoginSession | undefined;
    let browserClosed = false;
    try {
      if (managed) {
        login = await (this.input.openLoginBrowser ?? openWindowsYouTubeLogin)({ root: this.input.root, signal: attempt.controller.signal });
        profile = login.profile;
        let message = 'Sign in to YouTube in the Chrome window';
        let actionRequired: 'complete-login' | 'close-login-browser' = 'complete-login';
        let watchExit = true;
        while (!browserClosed) {
          this.state = { platform: this.platform, status: 'connecting', browser: 'chrome', profileId: profile.id, message, actionRequired };
          await this.waitForLoginCompletion(attempt, login, watchExit);
          watchExit = false;
          attempt.controller.signal.throwIfAborted();
          this.state = { platform: this.platform, status: 'connecting', browser: 'chrome', profileId: profile.id, message: 'Saving the YouTube session' };
          try { await login.close(attempt.controller.signal); browserClosed = true; }
          catch (error) {
            if (!(error instanceof LoginBrowserCloseError)) throw error;
            message = error.message; actionRequired = 'close-login-browser';
          }
        }
      }
      attempt.controller.signal.throwIfAborted();
      if (!profile) throw new PublicPlatformConnectionError('No browser profile was found. Connect again.');
      const cookies = await this.readProfileCookies(profile, attempt.controller.signal);
      if (!hasPlatformSession(cookies, this.platform)) throw new PublicPlatformConnectionError(managed
        ? 'YouTube sign-in is incomplete. Reconnect and finish signing in in the sign-in window.'
        : this.platform === 'youtube'
        ? 'This browser profile is signed out of YouTube or its session expired. Sign in with this profile and reconnect.'
        : 'This browser profile has no valid Douyin session. Open the video, complete website verification, and reconnect.');
      await this.saveProfileCookies(profile, cookies);
    } catch (error) {
      this.state = { platform: this.platform, status: 'error', browser: profile?.browser, profileId: profile?.id,
        message: attempt.controller.signal.aborted ? 'The connection was canceled or timed out. Connect again.' : publicConnectionError(error) };
    } finally {
      clearTimeout(timeout);
      if (login) {
        if (!browserClosed) await login.close(AbortSignal.timeout(12_000)).catch(() => undefined);
        await login.dispose().catch(() => undefined);
      }
      if (this.attempt === attempt) this.attempt = undefined;
    }
  }
  private waitForLoginCompletion(attempt: ConnectionAttempt, login: BrowserLoginSession, watchExit: boolean): Promise<void> {
    const signal = attempt.controller.signal;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal.removeEventListener('abort', abort);
        if (attempt.completeLogin === complete) attempt.completeLogin = undefined;
      };
      const complete = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      attempt.completeLogin = complete;
      signal.addEventListener('abort', abort, { once: true });
      if (watchExit) void login.exited.then(complete);
    });
  }
  private async stopConnection(): Promise<void> {
    const attempt = this.attempt;
    if (!attempt) return;
    attempt.controller.abort();
    await attempt.work;
    if (this.attempt === attempt) this.attempt = undefined;
  }
  private async readCredential(): Promise<Credential | undefined> {
    const raw = await readPrivateJsonFile(this.credentialFile);
    if (!raw || typeof raw !== 'object') return undefined;
    const value = raw as Partial<Credential>;
    if (value.version !== 1 || !Array.isArray(value.cookies) || typeof value.connectedAt !== 'string') return undefined;
    return value as Credential;
  }
  private async readProfileCookies(profile: BrowserProfile, signal: AbortSignal): Promise<PlatformCookie[]> {
    signal.throwIfAborted();
    const cookies = await (this.input.readBrowserCookies ?? readBrowserPlatformCookies)({
      profile, runtime: this.input.getRuntime(), signal,
      ...(this.platform === 'douyin' ? { platform: 'douyin' as const } : {})
    });
    signal.throwIfAborted();
    return filterPlatformCookies(cookies, this.platform);
  }
  private async saveProfileCookies(profile: BrowserProfile, cookies: PlatformCookie[]): Promise<void> {
    const connectedAt = new Date().toISOString();
    await writePrivateJsonFile(this.credentialFile, {
      version: 1, cookies, connectedAt, browser: profile.browser, profileId: profile.id
    } satisfies Credential);
    this.state = { platform: this.platform, status: 'connected', connectedAt, browser: profile.browser, profileId: profile.id };
  }
  private async refreshState(): Promise<void> {
    const credential = await this.readCredential();
    this.state = credential ? {
      platform: this.platform, status: !credential.invalidated && hasPlatformSession(filterPlatformCookies(credential.cookies, this.platform), this.platform) ? 'connected' : 'expired',
      connectedAt: credential.connectedAt, browser: credential.browser, profileId: credential.profileId
    } : { platform: this.platform, status: 'disconnected' };
  }
  private async publicState(): Promise<ConnectionState<P>> {
    if (this.managedLogin) return { ...this.state, connectionMethod: 'browser-login' };
    const profiles = await (this.input.listProfiles ?? listBrowserProfiles)();
    const saved = this.state.status === 'error' ? await this.readCredential() : undefined;
    return { ...this.state,
      ...(saved?.browser && saved.profileId ? { browser: saved.browser, profileId: saved.profileId, connectedAt: saved.connectedAt } : {}),
      profiles: profiles.map(({ id, browser, label }) => ({ id, browser, label })) };
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.mutations.then(operation);
    this.mutations = work.catch(() => undefined);
    return work;
  }
}
function cookieSnapshot(cookies: PlatformCookie[], platform: ConnectionPlatform): string {
  return serializePlatformCookies(cookies, platform).split('\n').sort().join('\n');
}
function publicConnectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  return error instanceof PublicPlatformConnectionError || /^[\u4e00-\u9fff]/.test(message)
    ? message
    : 'Could not read the browser session. Try again or select another browser profile.';
}
