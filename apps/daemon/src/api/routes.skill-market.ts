import type { FastifyInstance, FastifyReply } from 'fastify';
import type { RuntimeErrorCode } from '@clawee/protocol';
import type { SkillMarketManager } from '../codex/skills/market-manager.js';
import { apiError } from './errors.js';

export async function registerSkillMarketRoutes(
  server: FastifyInstance,
  input: { skillMarketManager: SkillMarketManager }
): Promise<void> {
  server.get('/codex/skill-market/install-records', async () => {
    return { records: input.skillMarketManager.listInstallRecords() };
  });

  server.post<{ Params: { id: string } }>('/codex/skill-market/:id/install', async (request, reply) => {
    try {
      const result = await input.skillMarketManager.installSkill(request.params.id);
      return reply.code(201).send(result);
    } catch (error) {
      return sendSkillMarketError(error, reply);
    }
  });

  server.post<{ Params: { id: string } }>('/codex/skill-market/:id/update', async (request, reply) => {
    try {
      const result = await input.skillMarketManager.updateSkill(request.params.id);
      return reply.code(200).send(result);
    } catch (error) {
      return sendSkillMarketError(error, reply);
    }
  });
}

function sendSkillMarketError(error: unknown, reply: FastifyReply) {
  const code = getCodexErrorCode(error);
  if (code === 'CODEX_SKILL_MARKET_ENTRY_NOT_FOUND') {
    return reply.code(404).send(apiError(code, 'Skill market entry not found'));
  }
  if (code === 'CODEX_SKILL_MARKET_NOT_INSTALLABLE') {
    return reply.code(422).send(apiError(code, 'Skill market entry is not installable'));
  }
  if (code === 'CODEX_SKILL_NOT_FOUND') {
    return reply.code(404).send(apiError(code, 'Skill not found'));
  }
  if (code === 'CODEX_SKILL_EXISTS') {
    return reply.code(409).send(apiError(code, 'Skill already exists'));
  }
  if (code === 'CODEX_SKILL_INVALID') {
    return reply.code(422).send(apiError(code, getErrorMessage(error, 'Skill is invalid')));
  }
  if (code === 'CODEX_SKILL_MARKET_DOWNLOAD_FAILED') {
    return reply.code(502).send(apiError(code, 'Failed to download market skill archive'));
  }

  return reply
    .code(500)
    .send(apiError(toRuntimeErrorCode(code) ?? 'CODEX_SKILL_WRITE_FAILED', 'Failed to write Codex skill'));
}

function getCodexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.split(':', 1)[0];
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function toRuntimeErrorCode(code: string | undefined): RuntimeErrorCode | undefined {
  if (code === 'CODEX_SKILL_WRITE_FAILED') return code;
  if (code === 'CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED') return code;
  return undefined;
}
