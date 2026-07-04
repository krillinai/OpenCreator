import { buildServer } from './api/server.js';
import { createRuntimeToken } from './security/token.js';

const token = createRuntimeToken();
const server = await buildServer({ token });
const address = await server.listen({ host: '127.0.0.1', port: 0 });

console.log(JSON.stringify({ address, token }));
