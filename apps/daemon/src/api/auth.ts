import type { FastifyReply, FastifyRequest } from 'fastify';

export function requireAuth(expectedToken: string) {
  return async function auth(request: FastifyRequest, reply: FastifyReply) {
    const value = request.headers.authorization;
    if (value !== `Bearer ${expectedToken}`) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    }
  };
}
