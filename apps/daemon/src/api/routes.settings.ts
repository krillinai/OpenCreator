import type {
  OpenCreatorStorageSettingsResponse,
  UpdateOpenCreatorStorageSettingsRequest,
  OpenCreatorUiSettingsResponse,
  UpdateOpenCreatorUiSettingsRequest
} from '@opencreator/protocol';
import type { FastifyInstance } from 'fastify';
import { accessSync, constants, mkdirSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { z, ZodError } from 'zod';
import type { OpenCreatorSettingsStore } from '../settings/store.js';
import { apiError } from './errors.js';

const updateSchema = z.object({
  language: z.enum(['system', 'zh-CN', 'en-US', 'sv-SE']).optional(),
  colorMode: z.enum(['light', 'dark']).optional(),
  accentColor: z.enum([
    'neutral',
    'blue',
    'cyan',
    'purple',
    'orange',
    'red',
    'custom'
  ]).optional(),
  customAccentColor: z.string().regex(/^#[\da-f]{6}$/i).optional(),
  defaultPermission: z.enum([
    'follow-project',
    'follow-global',
    'workspace-write',
    'danger-full-access'
  ]).optional()
}).strict();

const storageUpdateSchema = z.object({
  defaultProjectRoot: z.string().trim().min(1).refine(isAbsolute).optional(),
  outputRoot: z.string().trim().min(1).refine(isAbsolute).optional()
}).strict();

type StorageRouteOptions = {
  validateStoragePath?: (path: string) => boolean;
};

export async function registerSettingsRoutes(
  server: FastifyInstance,
  store: OpenCreatorSettingsStore,
  options: StorageRouteOptions = {}
): Promise<void> {
  const validateStoragePath = options.validateStoragePath ?? ensureWritableDirectory;
  server.get('/settings/ui', async (): Promise<OpenCreatorUiSettingsResponse> => (
    store.readUi()
  ));

  server.patch<{ Body: unknown }>(
    '/settings/ui',
    async (request, reply) => {
      try {
        return store.updateUi(
          updateSchema.parse(request.body) as UpdateOpenCreatorUiSettingsRequest
        );
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send(apiError(
            'VALIDATION_FAILED',
            'OpenCreator UI settings are invalid'
          ));
        }
        throw error;
      }
    }
  );

  server.get('/settings/storage', async (): Promise<OpenCreatorStorageSettingsResponse> => (
    store.readStorage()
  ));

  server.patch<{ Body: unknown }>(
    '/settings/storage',
    async (request, reply) => {
      try {
        const update = storageUpdateSchema.parse(
          request.body
        ) as UpdateOpenCreatorStorageSettingsRequest;
        for (const path of Object.values(update)) {
          if (!validateStoragePath(path)) {
            throw new StorageDirectoryError('Storage directory is not writable');
          }
        }
        return store.updateStorage(update);
      } catch (error) {
        if (error instanceof ZodError || error instanceof StorageDirectoryError) {
          return reply.code(400).send(apiError(
            'VALIDATION_FAILED',
            'OpenCreator storage settings are invalid'
          ));
        }
        throw error;
      }
    }
  );
}

class StorageDirectoryError extends Error {}

function ensureWritableDirectory(path: string): boolean {
  try {
    mkdirSync(path, { recursive: true });
    if (!statSync(path).isDirectory()) throw new Error('not a directory');
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}
