import type { RuntimeErrorCode } from '@opencreator/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { EnterpriseSessionManager } from '../enterprise/session-manager-2026-07-30.js';
import { EnterpriseSessionError } from '../enterprise/session-manager-2026-07-30.js';
import { EnterpriseHttpError } from '../enterprise/http-client-2026-07-30.js';
import type { EnterpriseSkillManager } from '../enterprise/skill-manager-2026-07-30.js';
import { EnterpriseSkillManagerError } from '../enterprise/skill-manager-2026-07-30.js';
import type { EnterpriseMcpManager } from '../enterprise/mcp-manager-2026-08-07.js';
import { EnterpriseMcpManagerError } from '../enterprise/mcp-manager-2026-08-07.js';
import { apiError } from './errors.js';

const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(8)
}).strict();

const registerSchema = loginSchema.extend({
  name: z.string().trim().min(1).optional()
}).strict();

const mcpPreferenceSchema = z.object({
  installed: z.boolean().optional(),
  enabled: z.boolean().optional(),
  confirmWriteToCodexHome: z.literal(true).optional()
}).strict().refine(
  value => value.installed !== undefined || value.enabled !== undefined,
  'at least one MCP preference field is required'
);

const qrLoginStartSchema = z.object({
  provider: z.enum(['feishu', 'dingtalk', 'wecom'])
}).strict();

const qrLoginRequestIdSchema = z.string().trim().min(1).max(256);

export async function registerEnterpriseRoutes(
  server: FastifyInstance,
  input: {
    sessionManager: EnterpriseSessionManager;
    skillManager: EnterpriseSkillManager;
    mcpManager: EnterpriseMcpManager;
  }
): Promise<void> {
  server.get('/enterprise/session', async () => {
    return input.sessionManager.getSnapshot();
  });

  server.post('/enterprise/session/refresh', async (_request, reply) => {
    try {
      const session = await input.sessionManager.refresh();
      if (session.status === 'signed_out') {
        await input.mcpManager.handleSessionSignedOut();
      }
      return session;
    } catch (error) {
      return sendEnterpriseError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/enterprise/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(
        apiError('VALIDATION_FAILED', 'email and password are invalid')
      );
    }
    try {
      const session = await input.sessionManager.login(parsed.data);
      input.mcpManager.handleSessionAuthenticated();
      return session;
    } catch (error) {
      return sendEnterpriseError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/enterprise/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(
        apiError('VALIDATION_FAILED', 'registration fields are invalid')
      );
    }
    try {
      const session = await input.sessionManager.register(parsed.data);
      input.mcpManager.handleSessionAuthenticated();
      return session;
    } catch (error) {
      return sendEnterpriseError(reply, error);
    }
  });

  server.post<{ Body: unknown }>('/enterprise/qr-login', async (request, reply) => {
    const parsed = qrLoginStartSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(
        apiError('VALIDATION_FAILED', 'QR login provider is invalid')
      );
    }
    if (input.sessionManager.startQrLogin === undefined) {
      return reply.code(503).send(
        apiError('ENTERPRISE_SERVICE_UNAVAILABLE', 'QR login is unavailable')
      );
    }
    try {
      return await input.sessionManager.startQrLogin(parsed.data);
    } catch (error) {
      return sendEnterpriseError(reply, error);
    }
  });

  server.get<{ Params: { requestId: string } }>(
    '/enterprise/qr-login/:requestId',
    async (request, reply) => {
      const parsed = qrLoginRequestIdSchema.safeParse(request.params.requestId);
      if (!parsed.success) {
        return reply.code(400).send(
          apiError('VALIDATION_FAILED', 'QR login request is invalid')
        );
      }
      if (input.sessionManager.pollQrLogin === undefined) {
        return reply.code(503).send(
          apiError('ENTERPRISE_SERVICE_UNAVAILABLE', 'QR login is unavailable')
        );
      }
      try {
        return await input.sessionManager.pollQrLogin(parsed.data);
      } catch (error) {
        return sendEnterpriseError(reply, error);
      }
    }
  );

  server.post('/enterprise/logout', async (_request, reply) => {
    try {
      const session = await input.sessionManager.logout();
      await input.mcpManager.handleSessionSignedOut();
      return session;
    } catch (error) {
      return sendEnterpriseError(reply, error);
    }
  });

  server.get('/enterprise/mcp', async (_request, reply) => {
    try {
      return await input.mcpManager.listConnections();
    } catch (error) {
      return sendEnterpriseError(reply, error);
    }
  });

  server.post('/enterprise/mcp/refresh', async (_request, reply) => {
    try {
      return await input.mcpManager.refreshConnections();
    } catch (error) {
      return sendEnterpriseError(reply, error);
    }
  });

  server.patch<{ Params: { upstreamId: string }; Body: unknown }>(
    '/enterprise/mcp/upstreams/:upstreamId/preference',
    async (request, reply) => {
      const parsed = mcpPreferenceSchema.safeParse(request.body);
      if (
        request.params.upstreamId.trim().length === 0
        || !parsed.success
      ) {
        return reply.code(400).send(
          apiError('VALIDATION_FAILED', 'MCP preference is invalid')
        );
      }
      try {
        return await input.mcpManager.updatePreference(
          request.params.upstreamId,
          parsed.data
        );
      } catch (error) {
        return sendEnterpriseError(reply, error);
      }
    }
  );

  server.get('/enterprise/skills', async (_request, reply) => {
    try {
      return await input.skillManager.listSkills();
    } catch (error) {
      return sendEnterpriseError(reply, error);
    }
  });

  server.get<{ Params: { skillId: string } }>(
    '/enterprise/skills/:skillId',
    async (request, reply) => {
      if (request.params.skillId.trim().length === 0) {
        return reply
          .code(400)
          .send(apiError('VALIDATION_FAILED', 'skillId is required'));
      }
      try {
        return await input.skillManager.getSkillDetail(request.params.skillId);
      } catch (error) {
        return sendEnterpriseError(reply, error);
      }
    }
  );

  server.post<{ Params: { skillId: string } }>(
    '/enterprise/skills/:skillId/install',
    async (request, reply) => {
      try {
        const result = await input.skillManager.installSkill(
          request.params.skillId
        );
        return reply.code(201).send(result);
      } catch (error) {
        return sendEnterpriseError(reply, error);
      }
    }
  );

  server.post<{ Params: { skillId: string } }>(
    '/enterprise/skills/:skillId/update',
    async (request, reply) => {
      try {
        return await input.skillManager.updateSkill(request.params.skillId);
      } catch (error) {
        return sendEnterpriseError(reply, error);
      }
    }
  );
}

function sendEnterpriseError(reply: FastifyReply, error: unknown) {
  if (error instanceof EnterpriseSessionError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, enterpriseErrorMessage(error.code), error.details));
  }
  if (error instanceof EnterpriseHttpError) {
    return reply
      .code(error.statusCode ?? 500)
      .send(apiError(error.code, enterpriseErrorMessage(error.code)));
  }
  if (error instanceof EnterpriseSkillManagerError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, enterpriseErrorMessage(error.code)));
  }
  if (error instanceof EnterpriseMcpManagerError) {
    return reply
      .code(error.statusCode)
      .send(apiError(error.code, enterpriseErrorMessage(error.code)));
  }
  throw error;
}

function enterpriseErrorMessage(code: RuntimeErrorCode): string {
  switch (code) {
    case 'ENTERPRISE_INVALID_REQUEST':
      return 'Enterprise request is invalid';
    case 'ENTERPRISE_UNAUTHORIZED':
      return 'Enterprise credentials are invalid';
    case 'ENTERPRISE_REGISTERED_LOGIN_REQUIRED':
      return 'Registration succeeded; sign in is still required';
    case 'ENTERPRISE_SESSION_EXPIRED':
      return 'Enterprise session expired';
    case 'ENTERPRISE_ACCOUNT_INACTIVE':
      return 'Enterprise account is inactive';
    case 'ENTERPRISE_FRONTEND_FORBIDDEN':
      return 'Enterprise frontend access is unavailable';
    case 'ENTERPRISE_AGENT_FORBIDDEN':
      return 'Enterprise agent access is unavailable';
    case 'ENTERPRISE_AGENT_ID_CONFLICT':
      return 'Enterprise agent identity belongs to another account';
    case 'ENTERPRISE_CONFIG_FILE_UNAVAILABLE':
      return 'Enterprise configuration file is unavailable';
    case 'ENTERPRISE_SERVICE_UNAVAILABLE':
      return 'Enterprise service is unavailable';
    case 'ENTERPRISE_FORBIDDEN':
      return 'Enterprise Skill Hub access is forbidden';
    case 'ENTERPRISE_MCP_TOKEN_NOT_FOUND':
      return 'Enterprise MCP token is unavailable';
    case 'ENTERPRISE_MCP_UPSTREAM_NOT_FOUND':
      return 'Enterprise MCP upstream was not found';
    case 'ENTERPRISE_MCP_RUNTIME_UNAVAILABLE':
      return 'Enterprise MCP runtime configuration is unavailable';
    case 'ENTERPRISE_SKILL_NOT_FOUND':
      return 'Enterprise skill was not found';
    case 'ENTERPRISE_SKILL_VERSION_CHANGED':
      return 'Enterprise skill version changed';
    case 'ENTERPRISE_SKILL_PACKAGE_TOO_LARGE':
      return 'Enterprise skill package is too large';
    case 'ENTERPRISE_RATE_LIMITED':
      return 'Enterprise service rate limit was reached';
    case 'ENTERPRISE_SKILL_PACKAGE_INVALID':
      return 'Enterprise skill package is invalid';
    case 'ENTERPRISE_SKILL_PACKAGE_HASH_MISMATCH':
      return 'Enterprise skill package integrity check failed';
    case 'ENTERPRISE_SKILL_SOURCE_CONFLICT':
      return 'A different local skill source owns this name';
    case 'ENTERPRISE_SKILL_LOCAL_CHANGED':
      return 'The local enterprise skill was modified';
    case 'ENTERPRISE_SKILL_INSTALL_FAILED':
      return 'Enterprise skill installation failed';
    default:
      return 'Enterprise operation failed';
  }
}
