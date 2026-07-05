import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SkillManager } from '../codex/skills/manager.js';
import { isValidSkillId } from '../codex/skills/validator.js';
import { apiError } from './errors.js';

export async function registerSkillRoutes(
  server: FastifyInstance,
  input: { skillManager: SkillManager }
): Promise<void> {
  server.get('/codex/skills', async () => input.skillManager.listSkills());

  server.get<{ Querystring: { limit?: string } }>('/codex/skills/operations', async (request) => {
    return { operations: input.skillManager.listOperations(parseLimit(request.query.limit)) };
  });

  server.get<{ Params: { id: string } }>('/codex/skills/:id', async (request, reply) => {
    if (!isValidSkillId(request.params.id)) {
      return reply.code(400).send(apiError('VALIDATION_FAILED', 'id must be a valid skill id'));
    }
    const skill = input.skillManager.getSkill(request.params.id);
    if (skill === undefined) {
      return reply.code(404).send(apiError('CODEX_SKILL_NOT_FOUND', 'Skill not found'));
    }
    return { skill };
  });

  server.post<{ Body: unknown }>('/codex/skills/install', async (request, reply) => {
    const body = parseInstallRequest(request.body);
    if (!body.ok) return reply.code(400).send(apiError('VALIDATION_FAILED', body.message));

    try {
      const result = await input.skillManager.installSkill(body.value);
      return reply.code(201).send(result);
    } catch (error) {
      return sendSkillWriteError(error, reply);
    }
  });

  server.delete<{ Params: { id: string }; Querystring: { confirmWriteToCodexHome?: string } }>(
    '/codex/skills/:id',
    async (request, reply) => {
      if (!isValidSkillId(request.params.id)) {
        return reply.code(400).send(apiError('VALIDATION_FAILED', 'id must be a valid skill id'));
      }

      try {
        return await input.skillManager.deleteSkill(
          request.params.id,
          request.query.confirmWriteToCodexHome === 'true'
        );
      } catch (error) {
        return sendSkillWriteError(error, reply);
      }
    }
  );
}

type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

function parseInstallRequest(body: unknown): ParseResult<{
  sourcePath: string;
  id?: string;
  overwrite?: boolean;
  confirmWriteToCodexHome?: true;
}> {
  if (!isPlainObject(body)) return { ok: false, message: 'body must be an object' };
  if (typeof body.sourcePath !== 'string' || body.sourcePath.trim().length === 0) {
    return { ok: false, message: 'sourcePath must be a non-empty string' };
  }
  if (body.id !== undefined && (typeof body.id !== 'string' || !isValidSkillId(body.id))) {
    return { ok: false, message: 'id must be a valid skill id' };
  }
  if (body.overwrite !== undefined && typeof body.overwrite !== 'boolean') {
    return { ok: false, message: 'overwrite must be a boolean' };
  }
  if (body.confirmWriteToCodexHome !== undefined && body.confirmWriteToCodexHome !== true) {
    return { ok: false, message: 'confirmWriteToCodexHome must be true when provided' };
  }

  return {
    ok: true,
    value: {
      sourcePath: body.sourcePath,
      ...(body.id === undefined ? {} : { id: body.id }),
      ...(body.overwrite === undefined ? {} : { overwrite: body.overwrite }),
      ...(body.confirmWriteToCodexHome === true ? { confirmWriteToCodexHome: true } : {})
    }
  };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(parsed, 200));
}

function sendSkillWriteError(error: unknown, reply: FastifyReply) {
  const code = getCodexErrorCode(error);
  if (code === 'CODEX_SKILL_WRITE_CONFIRMATION_REQUIRED') {
    return reply
      .code(409)
      .send(apiError(code, 'Global CODEX_HOME skills write requires confirmation'));
  }
  if (code === 'CODEX_SKILL_EXISTS') {
    return reply.code(409).send(apiError(code, 'Skill already exists'));
  }
  if (code === 'CODEX_SKILL_NOT_FOUND') {
    return reply.code(404).send(apiError(code, 'Skill not found'));
  }
  if (code === 'CODEX_SKILL_INVALID') {
    return reply.code(422).send(apiError(code, getErrorMessage(error, 'Skill is invalid')));
  }
  return reply.code(500).send(apiError('CODEX_SKILL_WRITE_FAILED', 'Failed to write Codex skill'));
}

function getCodexErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  return error.message.split(':', 1)[0];
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
