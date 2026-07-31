const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');

const requireFromDaemon = createRequire(
  path.join(process.env.CLAWEE_KEYRING_MODULE_ROOT, 'package.json')
);
const { AsyncEntry } = requireFromDaemon('@napi-rs/keyring');
const id = randomUUID();
const entry = new AsyncEntry(
  'com.clawee.enterprise.e2e-diagnostic',
  `clawee-agent:${id}`
);

void run();

async function run() {
  try {
    await entry.setPassword('probe');
    const value = await entry.getPassword();
    process.stdout.write(`${JSON.stringify({
      ok: true,
      readMatches: value === 'probe'
    })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      name: error?.name,
      message: error?.message,
      code: error?.code
    })}\n`);
    process.exitCode = 1;
  } finally {
    await entry.deletePassword().catch(() => undefined);
  }
}
