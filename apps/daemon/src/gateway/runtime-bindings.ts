import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createDirectRuntime } from './direct-runtime.js';
import { createOfficialFetch } from './official-fetch.js';

export type GatewayRuntimeBindingsInput = {
  codexHome: string;
  baseUrl: string;
  model: string;
  readCredentials(): Promise<{ accountId: string; modelKey: string; keyVersion: string }>;
  closeRuntime(): Promise<void>;
  parentEnvironment?: NodeJS.ProcessEnv;
  direct?: boolean;
  readProxy?(): Promise<string>;
  beginUse?(): Promise<{ key: string; release(): Promise<void> }>;
};

export type GatewayRuntimePreparation = {
  codexHome: string;
  env: Record<string, string>;
  generation: number;
};

export function createGatewayRuntimeBindings(input: GatewayRuntimeBindingsInput) {
  if (!isAbsolute(input.codexHome)) throw new Error('Official Runtime home must be absolute');
  const baseUrl = new URL(input.baseUrl);
  const localTest = baseUrl.protocol === 'http:'
    && ['127.0.0.1', '[::1]'].includes(baseUrl.hostname);
  if ((baseUrl.protocol !== 'https:' && !localTest) || baseUrl.username || baseUrl.password
    || baseUrl.search || baseUrl.hash) throw new Error('Invalid official gateway URL');
  if (!input.model.trim()) throw new Error('Official Runtime model is required');
  let admitting = true;
  let generation = 1;
  let preparation: Promise<GatewayRuntimePreparation> | undefined;
  let closeWork: Promise<void> | undefined;
  let connection: Awaited<ReturnType<typeof createDirectRuntime>> | undefined;
  const environments = new Set<Record<string, string>>();

  function assertOpen(expectedGeneration = generation) {
    if (!admitting || generation !== expectedGeneration) throw new Error('Official Runtime is signed out');
  }

  async function prepare(): Promise<GatewayRuntimePreparation> {
    assertOpen();
    if (preparation !== undefined) return preparation;
    const preparingGeneration = generation;
    preparation = (async () => {
      const credentials = await input.readCredentials();
      assertOpen(preparingGeneration);
      if (!credentials.accountId || !credentials.modelKey || !credentials.keyVersion) {
        throw new Error('Official Runtime credentials are unavailable');
      }
      if (input.direct) {
        if (input.baseUrl !== 'https://openrouter.ai/api/v1') throw new Error('Invalid official endpoint');
        connection ??= await createDirectRuntime(credentials.modelKey, createOfficialFetch({ readProxy: input.readProxy }), input.beginUse);
        assertOpen(preparingGeneration);
      }
      mkdirSync(input.codexHome, { recursive: true, mode: 0o700 });
      if (lstatSync(input.codexHome).isSymbolicLink()) throw new Error('Official Runtime home cannot be a symlink');
      if (existsSync(join(input.codexHome, 'auth.json'))) {
        throw new Error('Official Runtime home contains a persisted credential');
      }
      if (process.platform !== 'win32') chmodSync(input.codexHome, 0o700);
      const config = [
        `model = ${JSON.stringify(input.model)}`,
        'model_provider = "opencreator_gateway"',
        'cli_auth_credentials_store = "file"',
        '[shell_environment_policy]',
        'inherit = "core"',
        'exclude = ["OC_GATEWAY_MODEL_KEY"]',
        '[model_providers.opencreator_gateway]',
        'name = "OpenCreator Gateway"',
        `base_url = ${JSON.stringify(connection?.baseUrl ?? baseUrl.href.replace(/\/$/, ''))}`,
        'env_key = "OC_GATEWAY_MODEL_KEY"',
        'wire_api = "responses"',
        'requires_openai_auth = false',
        'request_max_retries = 0',
        'stream_max_retries = 0',
        'supports_websockets = false',
        '[features]',
        'shell_snapshot = false',
        'responses_websockets = false',
        'responses_websockets_v2 = false',
        'apps = false',
        'plugins = false',
        'hooks = false',
        ''
      ].join('\n');
      const temporary = join(input.codexHome, `.config-${randomUUID()}.tmp`);
      try {
        writeFileSync(temporary, config, { flag: 'wx', mode: 0o600 });
        renameSync(temporary, join(input.codexHome, 'config.toml'));
      } finally {
        rmSync(temporary, { force: true });
      }
      const env: Record<string, string> = {};
      const parent = input.parentEnvironment ?? process.env;
      for (const name of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']) {
        if (parent[name] !== undefined) env[name] = parent[name];
      }
      env.HOME = input.codexHome;
      env.OC_GATEWAY_MODEL_KEY = connection?.token ?? credentials.modelKey;
      environments.add(env);
      return { codexHome: input.codexHome, env, generation: preparingGeneration };
    })();
    try {
      return await preparation;
    } catch (error) {
      await connection?.close(); connection = undefined;
      preparation = undefined;
      throw error;
    }
  }

  function beginLogout() {
    if (!admitting) return;
    admitting = false;
    generation += 1;
  }

  return {
    prepare,
    beginLogout,
    async close() {
      beginLogout();
      closeWork ??= (async () => {
        await input.closeRuntime();
        await connection?.close(); connection = undefined;
        for (const env of environments) delete env.OC_GATEWAY_MODEL_KEY;
        environments.clear();
        preparation = undefined;
      })();
      await closeWork;
    }
  };
}
