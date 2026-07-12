import { buildServer } from './api/server.js';
import { collectCodexCapabilityMatrix } from './codex/capabilities.js';
import { createRuntimeToken } from './security/token.js';
import { installGracefulShutdown } from './shutdown.js';
import { createProductionServerInput } from './startup.js';

const token = createRuntimeToken();
const capabilities = collectCodexCapabilityMatrix();
const server = await buildServer(createProductionServerInput({ token, capabilities }));
const address = await server.listen({ host: '127.0.0.1', port: 0 });

installGracefulShutdown({
  close: () => server.close(),
  onError(error) {
    console.error(`Failed to close daemon cleanly: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
});

console.log(JSON.stringify({ address, token }));
