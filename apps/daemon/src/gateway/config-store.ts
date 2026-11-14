import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v3';
import { deletePrivateJsonFile, readPrivateJsonFile, writePrivateJsonFile } from '../config/private-json-file.js';
import { bootstrapCredentialsSchema, type GatewayBootstrap, type GatewayTokens } from './client.js';
const modelAccessErrorSchema = z.enum(['auth_required', 'account_disabled', 'payment_review_required']);
export type GatewayCredentials = Partial<GatewayBootstrap> & GatewayTokens & { accessExpiresAt: string; modelAccessError?: z.infer<typeof modelAccessErrorSchema> };
export function createGatewayConfigStore(dataDir: string) {
  const secretPath = join(dataDir, 'config', 'gateway-credentials.json');
  const publicPath = join(dataDir, 'config', 'gateway.json');
  const devicePath = join(dataDir, 'config', 'gateway-device.json');
  let deviceID: Promise<string> | undefined;
  let credentialMutation = Promise.resolve();
  function mutateCredentials(work: () => Promise<void>) {
    const result = credentialMutation.then(work);
    credentialMutation = result.catch(() => undefined);
    return result;
  }
  const credentials = bootstrapCredentialsSchema.partial().extend({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number(), accessExpiresAt: z.string(), modelAccessError: modelAccessErrorSchema.optional() });
  const configuration = z.object({ source: z.enum(['manual', 'gateway']), bindingVersion: z.string().nullable(), explicitlySelected: z.boolean().optional(), selectedModels: z.record(z.string()).optional(), modelPreferencesVersion: z.literal(1).optional(), manualModels: z.record(z.string()).optional(), taskModelsByAccount: z.record(z.record(z.record(z.string()))).optional(), region: z.enum(['auto', 'domestic', 'overseas']).optional() });
  return {
    readDeviceID(): Promise<string> {
      return deviceID ??= (async () => {
        const value = await readPrivateJsonFile(devicePath);
        if (value !== undefined) return z.object({ id: z.string().uuid() }).parse(value).id;
        const id = randomUUID(); await writePrivateJsonFile(devicePath, { id }); return id;
      })();
    },
    async readCredentials(): Promise<GatewayCredentials | undefined> { const value = await readPrivateJsonFile(secretPath); return value === undefined ? undefined : credentials.parse(value); },
    writeCredentials(value: GatewayCredentials) { return mutateCredentials(() => writePrivateJsonFile(secretPath, value)); },
    deleteCredentials() { return mutateCredentials(() => deletePrivateJsonFile(secretPath)); },
    async readConfiguration() { const value = await readPrivateJsonFile(publicPath); return value === undefined ? { source: 'manual' as const, bindingVersion: null } : configuration.parse(value); },
    writeConfiguration(value: z.infer<typeof configuration>) { return writePrivateJsonFile(publicPath, value); }
  };
}
