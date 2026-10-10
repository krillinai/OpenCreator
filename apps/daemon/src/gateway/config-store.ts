import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deletePrivateJsonFile, readPrivateJsonFile, writePrivateJsonFile } from '../config/private-json-file.js';
import { bootstrapSchema, type GatewayBootstrap, type GatewayTokens } from './client.js';
export type GatewayCredentials = Partial<GatewayBootstrap> & GatewayTokens & { accessExpiresAt: string };
export function createGatewayConfigStore(dataDir: string) {
  const secretPath = join(dataDir, 'config', 'gateway-credentials.json');
  const publicPath = join(dataDir, 'config', 'gateway.json');
  const devicePath = join(dataDir, 'config', 'gateway-device.json');
  let deviceID: Promise<string> | undefined;
  const credentials = bootstrapSchema.partial().extend({ accessToken: z.string(), refreshToken: z.string(), expiresIn: z.number(), accessExpiresAt: z.string() });
  const configuration = z.object({ source: z.enum(['manual', 'gateway']), bindingVersion: z.string().nullable(), explicitlySelected: z.boolean().optional(), selectedModels: z.record(z.string()).optional() });
  return {
    readDeviceID(): Promise<string> {
      return deviceID ??= (async () => {
        const value = await readPrivateJsonFile(devicePath);
        if (value !== undefined) return z.object({ id: z.string().uuid() }).parse(value).id;
        const id = randomUUID(); await writePrivateJsonFile(devicePath, { id }); return id;
      })();
    },
    async readCredentials(): Promise<GatewayCredentials | undefined> { const value = await readPrivateJsonFile(secretPath); return value === undefined ? undefined : credentials.parse(value); },
    writeCredentials(value: GatewayCredentials) { return writePrivateJsonFile(secretPath, value); },
    deleteCredentials() { return deletePrivateJsonFile(secretPath); },
    async readConfiguration() { const value = await readPrivateJsonFile(publicPath); return value === undefined ? { source: 'manual' as const, bindingVersion: null } : configuration.parse(value); },
    writeConfiguration(value: z.infer<typeof configuration>) { return writePrivateJsonFile(publicPath, value); }
  };
}
