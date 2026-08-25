import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_TAG = 'rust-v0.149.0';
const SOURCE_COMMIT = '758ef40f50c1a458425c7cfbf1eb12cbc07af0b0';
const SCHEMA_ROOT = 'codex-rs/app-server-protocol/schema';
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIR, '../../..');
const DEFAULT_SOURCE_REPO = join(REPOSITORY_ROOT, 'codex');
const DEFAULT_OUTPUT = resolve(SCRIPT_DIR, '../src/codex/generated/v0_149_0');

const TYPE_ENTRYPOINTS = [
  'InitializeParams',
  'InitializeResponse',
  'v2/ThreadStartParams',
  'v2/ThreadStartResponse',
  'v2/ThreadResumeParams',
  'v2/ThreadResumeResponse',
  'v2/TurnStartParams',
  'v2/TurnStartResponse',
  'v2/TurnInterruptParams',
  'v2/TurnInterruptResponse',
  'v2/ModelListParams',
  'v2/ModelListResponse',
  'v2/SkillsListParams',
  'v2/SkillsListResponse',
  'v2/GetAccountParams',
  'v2/GetAccountResponse',
  'v2/LoginAccountParams',
  'v2/LoginAccountResponse',
  'v2/CancelLoginAccountParams',
  'v2/CancelLoginAccountResponse',
  'v2/LogoutAccountResponse',
  'v2/ThreadStartedNotification',
  'v2/TurnStartedNotification',
  'v2/TurnCompletedNotification',
  'v2/ItemStartedNotification',
  'v2/ItemCompletedNotification',
  'v2/AgentMessageDeltaNotification',
  'v2/ReasoningSummaryTextDeltaNotification',
  'v2/ReasoningTextDeltaNotification',
  'v2/CommandExecutionOutputDeltaNotification',
  'v2/FileChangeOutputDeltaNotification',
  'v2/CommandExecutionRequestApprovalParams',
  'v2/CommandExecutionRequestApprovalResponse',
  'v2/FileChangeRequestApprovalParams',
  'v2/FileChangeRequestApprovalResponse',
  'v2/PermissionsRequestApprovalParams',
  'v2/PermissionsRequestApprovalResponse',
  'v2/DynamicToolCallParams',
  'v2/DynamicToolCallResponse',
  'v2/AccountLoginCompletedNotification',
  'v2/AccountUpdatedNotification',
  'v2/ConfigWarningNotification',
  'v2/ErrorNotification'
];

const JSON_ENTRYPOINTS = TYPE_ENTRYPOINTS.filter(name => (
  name === 'InitializeParams'
    || name === 'InitializeResponse'
    || name.startsWith('v2/')
));
const ROOT_JSON_NAMES = new Set([
  'CommandExecutionRequestApprovalParams',
  'CommandExecutionRequestApprovalResponse',
  'FileChangeRequestApprovalParams',
  'FileChangeRequestApprovalResponse',
  'PermissionsRequestApprovalParams',
  'PermissionsRequestApprovalResponse',
  'DynamicToolCallParams',
  'DynamicToolCallResponse'
]);

function parseArgs(argv) {
  const result = {
    sourceRepo: DEFAULT_SOURCE_REPO,
    output: DEFAULT_OUTPUT,
    tag: SOURCE_TAG,
    expectedCommit: SOURCE_COMMIT
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = argv[index + 1];
    if (value === '--source-repo' && next !== undefined) result.sourceRepo = resolve(next);
    else if (value === '--output' && next !== undefined) result.output = resolve(next);
    else if (value === '--tag' && next !== undefined) result.tag = next;
    else if (value === '--expected-commit' && next !== undefined) result.expectedCommit = next;
    else continue;
    index += 1;
  }
  return result;
}

function git(sourceRepo, args) {
  return execFileSync('git', ['-C', sourceRepo, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).replace(/\r\n/g, '\n');
}

function gitShow(sourceRepo, tag, path) {
  return git(sourceRepo, ['show', `${tag}:${path}`]);
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function ensureSafeOutput(output) {
  const normalized = resolve(output);
  const expectedRoot = resolve(SCRIPT_DIR, '../src/codex/generated');
  const explicitTemp = normalized.includes(`${sep}.tmp${sep}`);
  if (normalized !== expectedRoot && !normalized.startsWith(`${expectedRoot}${sep}`) && !explicitTemp) {
    throw new Error(`Refusing to generate outside the protocol output roots: ${normalized}`);
  }
}

function sourcePath(kind, name) {
  if (kind === 'json' && !name.startsWith('v2/')) {
    return `${SCHEMA_ROOT}/json/v1/${name}.json`;
  }
  if (kind === 'json' && ROOT_JSON_NAMES.has(name.replace(/^v2\//, ''))) {
    return `${SCHEMA_ROOT}/json/${name.replace(/^v2\//, '')}.json`;
  }
  return `${SCHEMA_ROOT}/${kind}/${name}.${kind === 'json' ? 'json' : 'ts'}`;
}

function normalizeGeneratedType(content) {
  return content
    .replace(/\r\n/g, '\n')
    .replace(/(from\s+["'][^"']+)(["'];)/g, '$1.js$2');
}

function importedTypePaths(content, currentName) {
  const currentDirectory = posix.dirname(currentName);
  const paths = [];
  for (const match of content.matchAll(/from\s+["']([^"']+)["']/g)) {
    const specifier = match[1];
    if (!specifier?.startsWith('.')) continue;
    paths.push(posix.normalize(posix.join(currentDirectory, specifier)));
  }
  return paths;
}

async function generate(options) {
  ensureSafeOutput(options.output);
  const actualCommit = git(options.sourceRepo, ['rev-parse', `${options.tag}^{commit}`]).trim();
  if (actualCommit !== options.expectedCommit) {
    throw new Error(`Codex protocol source mismatch: expected ${options.expectedCommit}, got ${actualCommit}`);
  }

  const staging = `${options.output}.staging-${process.pid}`;
  await rm(staging, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });

  const files = new Map();
  const queue = [...TYPE_ENTRYPOINTS];
  const seen = new Set();
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const raw = gitShow(options.sourceRepo, options.tag, sourcePath('typescript', name));
    const content = normalizeGeneratedType(raw);
    const outputName = `typescript/${name}.ts`;
    files.set(outputName, content);
    for (const dependency of importedTypePaths(raw, name)) {
      if (!seen.has(dependency)) queue.push(dependency);
    }
  }

  for (const name of JSON_ENTRYPOINTS) {
    const raw = gitShow(options.sourceRepo, options.tag, sourcePath('json', name));
    const parsed = JSON.parse(raw);
    files.set(`json/${name}.json`, `${JSON.stringify(parsed, null, 2)}\n`);
  }

  const index = [
    '// Generated from Codex rust-v0.149.0. Do not edit by hand.',
    ...TYPE_ENTRYPOINTS.map(name => {
      const symbol = name.split('/').at(-1);
      return `export type { ${symbol} } from './typescript/${name}.js';`;
    }),
    ''
  ].join('\n');
  files.set('index.ts', index);

  const sortedFiles = [...files.entries()].sort(([left], [right]) => left.localeCompare(right));
  const fileHashes = Object.fromEntries(sortedFiles.map(([name, content]) => [name, sha256(content)]));
  const aggregateSha256 = sha256(sortedFiles.map(([name, content]) => `${name}\0${content}`).join('\0'));
  const manifest = {
    schemaVersion: 1,
    sourceTag: options.tag,
    sourceCommit: actualCommit,
    aggregateSha256,
    entrypoints: TYPE_ENTRYPOINTS,
    files: fileHashes
  };
  files.set('protocol-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  files.set('metadata.ts', [
    '// Generated from Codex rust-v0.149.0. Do not edit by hand.',
    `export const codexAppServerProtocolSourceTag = '${options.tag}' as const;`,
    `export const codexAppServerProtocolSourceCommit = '${actualCommit}' as const;`,
    `export const codexAppServerProtocolSha256 = '${aggregateSha256}' as const;`,
    ''
  ].join('\n'));

  for (const [name, content] of files) {
    const target = join(staging, name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }

  await rm(options.output, { recursive: true, force: true });
  await mkdir(dirname(options.output), { recursive: true });
  await rename(staging, options.output);
  return manifest;
}

const invokedDirectly = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  generate(parseArgs(process.argv.slice(2)))
    .then(manifest => {
      process.stdout.write(`Generated Codex app-server protocol ${manifest.sourceTag} (${manifest.aggregateSha256})\n`);
    })
    .catch(error => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    });
}

export { generate, parseArgs, SOURCE_COMMIT, SOURCE_TAG, TYPE_ENTRYPOINTS };
