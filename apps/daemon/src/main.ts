import { buildServer } from './api/server.js';
import { collectCodexCapabilityMatrix } from './codex/capabilities.js';
import { createRuntimeToken } from './security/token.js';

const token = createRuntimeToken();
const capabilities = collectCodexCapabilityMatrix();
const server = await buildServer({ token, capabilities });
const address = await server.listen({ host: '127.0.0.1', port: 0 });

console.log(JSON.stringify({ address, token }));
