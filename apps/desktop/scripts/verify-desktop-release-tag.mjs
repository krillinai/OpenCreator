import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(scriptDir, '..');

export function verifyDesktopReleaseTag(tag, packageVersion) {
  if (!tag) return { skipped: true, packageVersion };
  const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag);
  if (match === null) {
    throw new Error(
      `Desktop release tag must use v<version>, received: ${tag}`
    );
  }
  if (match[1] !== packageVersion) {
    throw new Error(
      `Desktop release tag ${tag} does not match apps/desktop/package.json `
      + `version ${packageVersion}`
    );
  }
  return { skipped: false, packageVersion, tag };
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const packageJson = JSON.parse(
      readFileSync(resolve(desktopDir, 'package.json'), 'utf8')
    );
    const tag = process.argv[2]
      ?? process.env.OPENCREATOR_DESKTOP_RELEASE_TAG
      ?? '';
    const result = verifyDesktopReleaseTag(tag.trim(), packageJson.version);
    process.stdout.write(`${JSON.stringify({ ok: true, ...result })}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
