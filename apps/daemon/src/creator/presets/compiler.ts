import { createHash } from 'node:crypto';
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  lstat,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import { imageSize } from 'image-size';
import { ZodError } from 'zod';
import { creatorPresetModuleDefinitions, getCreatorPresetModuleDefinition } from './module-schemas.js';
import { creatorPresetSourceManifestSchema, validatePresetPublicFields } from './schema.js';
import type {
  CompiledCreatorPreset,
  CreatorPresetBuildManifest,
  CreatorPresetCatalog,
  CreatorPresetCompilerOptions,
  CreatorPresetModuleDefinition,
  CreatorPresetSourceManifest
} from './types.js';

const COVER_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MIME_BY_EXTENSION = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
] as const);
const MAX_COVER_SIZE = 2 * 1024 * 1024;

export async function validateCreatorPresets(
  options: CreatorPresetCompilerOptions
): Promise<CreatorPresetCatalog> {
  const sourceRoot = path.resolve(options.sourceRoot);
  const modules = options.modules ?? creatorPresetModuleDefinitions;
  await assertDirectory(sourceRoot);
  const entries = await findTemplateManifests(sourceRoot);
  const presets: CompiledCreatorPreset[] = [];
  const identities = new Set<string>();

  for (const entry of entries) {
    const manifest = await readSourceManifest(entry.file, entry.relativeFile);
    const definition = getCreatorPresetModuleDefinition(manifest.module, modules);
    validateDirectoryIdentity(entry.parts, manifest, entry.relativeFile);
    validateRuntimeBinding(definition, manifest, entry.relativeFile);
    validatePresetPublicFields(manifest.defaults, `${entry.relativeFile}.defaults`);
    for (const [locale, defaults] of Object.entries(manifest.defaultsByLocale ?? {})) {
      if (defaults !== undefined) {
        validatePresetPublicFields(defaults, `${entry.relativeFile}.defaultsByLocale.${locale}`);
      }
    }
    parseModuleDefaults(definition, manifest, entry.relativeFile);
    definition.validateRequirement(manifest.requirements);
    const identity = `${manifest.module}/${manifest.id}/${manifest.version}`;
    if (identities.has(identity)) {
      throw new Error(`${entry.relativeFile}: duplicate preset identity ${identity}`);
    }
    identities.add(identity);
    const cover = await validateCover(sourceRoot, entry.directory, manifest.cover, entry.relativeFile);
    const normalizedManifest = normalizeSourceManifest(manifest);
    const contentHash = sha256(canonicalJson({
      ...normalizedManifest,
      cover: {
        path: toPosix(manifest.cover),
        sha256: cover.sha256
      }
    }));
    presets.push({
      ...normalizedManifest,
      cover: {
        source: toPosix(path.relative(sourceRoot, cover.file)),
        asset: `assets/${cover.sha256}${cover.extension}`,
        sha256: cover.sha256,
        mime: cover.mime,
        width: cover.width,
        height: cover.height,
        size: cover.size
      },
      contentHash
    });
  }

  presets.sort(comparePresets);
  return {
    schemaVersion: 1,
    presets
  };
}

export async function compileCreatorPresets(
  options: CreatorPresetCompilerOptions
): Promise<CreatorPresetBuildManifest> {
  if (options.outputRoot === undefined) {
    throw new Error('outputRoot is required when compiling creator presets');
  }
  const outputRoot = path.resolve(options.outputRoot);
  const catalog = await validateCreatorPresets(options);
  const parent = path.dirname(outputRoot);
  const temporary = path.join(
    parent,
    `.${path.basename(outputRoot)}.tmp-${process.pid}-${Date.now()}`
  );
  const backup = path.join(
    parent,
    `.${path.basename(outputRoot)}.backup-${process.pid}-${Date.now()}`
  );
  await rm(temporary, { recursive: true, force: true });
  await mkdir(path.join(temporary, 'assets'), { recursive: true });

  try {
    for (const preset of catalog.presets) {
      const source = path.join(path.resolve(options.sourceRoot), preset.cover.source);
      const destination = path.join(temporary, preset.cover.asset);
      try {
        await stat(destination);
      } catch {
        await copyFile(source, destination);
      }
    }
    const catalogBytes = Buffer.from(`${canonicalJson(catalog)}\n`);
    await writeFile(path.join(temporary, 'catalog.json'), catalogBytes);
    const assetFiles = await listOutputFiles(temporary, ['catalog.json']);
    const catalogHash = sha256(catalogBytes);
    const assetEntries = assetFiles.filter(file => file.path.startsWith('assets/'));
    const assetSetHash = sha256(canonicalJson(assetEntries));
    const manifestWithoutSelf: CreatorPresetBuildManifest = {
      schemaVersion: 1,
      catalogHash,
      assetSetHash,
      files: assetFiles
    };
    await writeFile(
      path.join(temporary, 'manifest.json'),
      `${canonicalJson(manifestWithoutSelf)}\n`
    );
    await syncTree(temporary);
    await mkdir(parent, { recursive: true });

    let hadPrevious = false;
    try {
      await rename(outputRoot, backup);
      hadPrevious = true;
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    try {
      await rename(temporary, outputRoot);
      await rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (hadPrevious) await rename(backup, outputRoot);
      throw error;
    }
    return manifestWithoutSelf;
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

async function findTemplateManifests(sourceRoot: string): Promise<Array<{
  file: string;
  directory: string;
  relativeFile: string;
  parts: [string, string, string];
}>> {
  const results: Array<{
    file: string;
    directory: string;
    relativeFile: string;
    parts: [string, string, string];
  }> = [];
  const modules = await sortedDirectoryEntries(sourceRoot);
  for (const moduleEntry of modules) {
    await rejectSymlink(moduleEntry, path.join(sourceRoot, moduleEntry.name));
    if (!moduleEntry.isDirectory()) {
      throw new Error(`${moduleEntry.name}: template root entries must be directories`);
    }
    const moduleDirectory = path.join(sourceRoot, moduleEntry.name);
    for (const idEntry of await sortedDirectoryEntries(moduleDirectory)) {
      const idPath = path.join(moduleDirectory, idEntry.name);
      await rejectSymlink(idEntry, idPath);
      if (!idEntry.isDirectory()) throw new Error(`${toPosix(path.relative(sourceRoot, idPath))}: expected directory`);
      for (const versionEntry of await sortedDirectoryEntries(idPath)) {
        const versionPath = path.join(idPath, versionEntry.name);
        await rejectSymlink(versionEntry, versionPath);
        if (!versionEntry.isDirectory()) throw new Error(`${toPosix(path.relative(sourceRoot, versionPath))}: expected directory`);
        const files = await sortedDirectoryEntries(versionPath);
        const manifestEntry = files.find(file => file.name === 'template.json');
        if (manifestEntry === undefined || !manifestEntry.isFile()) {
          throw new Error(`${toPosix(path.relative(sourceRoot, versionPath))}/template.json: missing manifest`);
        }
        for (const file of files) {
          await rejectSymlink(file, path.join(versionPath, file.name));
          if (file.isDirectory()) {
            throw new Error(`${toPosix(path.relative(sourceRoot, path.join(versionPath, file.name)))}: nested directories are not allowed`);
          }
          if (!file.isFile()) {
            throw new Error(`${toPosix(path.relative(sourceRoot, path.join(versionPath, file.name)))}: only regular files are allowed`);
          }
          const extension = path.extname(file.name).toLowerCase();
          if (file.name !== 'template.json' && !COVER_EXTENSIONS.has(extension)) {
            throw new Error(`${toPosix(path.relative(sourceRoot, path.join(versionPath, file.name)))}: unsupported template resource`);
          }
        }
        results.push({
          file: path.join(versionPath, 'template.json'),
          directory: versionPath,
          relativeFile: toPosix(path.relative(sourceRoot, path.join(versionPath, 'template.json'))),
          parts: [moduleEntry.name, idEntry.name, versionEntry.name]
        });
      }
    }
  }
  return results;
}

async function readSourceManifest(file: string, relativeFile: string): Promise<CreatorPresetSourceManifest> {
  let value: unknown;
  try {
    value = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`${relativeFile}: invalid JSON: ${errorMessage(error)}`);
  }
  try {
    return creatorPresetSourceManifestSchema.parse(value) as CreatorPresetSourceManifest;
  } catch (error) {
    if (error instanceof ZodError) {
      const detail = error.issues
        .map(issue => `${relativeFile}.${issue.path.join('.') || '<root>'}: ${issue.message}`)
        .join('\n');
      throw new Error(detail);
    }
    throw error;
  }
}

function validateDirectoryIdentity(
  parts: [string, string, string],
  manifest: CreatorPresetSourceManifest,
  relativeFile: string
): void {
  if (
    parts[0] !== manifest.module
    || parts[1] !== manifest.id
    || !/^[1-9]\d*$/.test(parts[2])
    || Number(parts[2]) !== manifest.version
  ) {
    throw new Error(`${relativeFile}: directory identity does not match module/id/version`);
  }
}

function validateRuntimeBinding(
  definition: CreatorPresetModuleDefinition,
  manifest: CreatorPresetSourceManifest,
  relativeFile: string
): void {
  if (
    manifest.runtimeTemplate.id !== definition.runtimeTemplate.id
    || manifest.runtimeTemplate.version !== definition.runtimeTemplate.version
  ) {
    throw new Error(
      `${relativeFile}.runtimeTemplate: expected ${definition.runtimeTemplate.id}@${definition.runtimeTemplate.version}`
    );
  }
}

function parseModuleDefaults(
  definition: CreatorPresetModuleDefinition,
  manifest: CreatorPresetSourceManifest,
  relativeFile: string
): void {
  const defaults = definition.defaultsSchema.safeParse(manifest.defaults);
  if (!defaults.success) {
    throw new Error(formatZodIssues(relativeFile, 'defaults', defaults.error));
  }
  for (const [locale, value] of Object.entries(manifest.defaultsByLocale ?? {})) {
    const localized = definition.localeDefaultsSchema.safeParse(value);
    if (!localized.success) {
      throw new Error(formatZodIssues(relativeFile, `defaultsByLocale.${locale}`, localized.error));
    }
  }
}

async function validateCover(
  sourceRoot: string,
  directory: string,
  coverPath: string,
  relativeFile: string
): Promise<{
  file: string;
  extension: '.png' | '.jpg' | '.jpeg' | '.webp';
  mime: 'image/png' | 'image/jpeg' | 'image/webp';
  sha256: string;
  width: number;
  height: number;
  size: number;
}> {
  if (path.isAbsolute(coverPath) || coverPath.includes('\\')) {
    throw new Error(`${relativeFile}.cover: cover must be a POSIX relative path`);
  }
  const segments = coverPath.split('/');
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`${relativeFile}.cover: traversal is not allowed`);
  }
  const extension = path.extname(coverPath).toLowerCase() as '.png' | '.jpg' | '.jpeg' | '.webp';
  if (!COVER_EXTENSIONS.has(extension)) {
    throw new Error(`${relativeFile}.cover: unsupported image extension`);
  }
  const file = path.resolve(directory, coverPath);
  const relative = path.relative(sourceRoot, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${relativeFile}.cover: cover escapes the template root`);
  }
  const fileInfo = await lstat(file).catch(() => undefined);
  if (fileInfo === undefined || !fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new Error(`${relativeFile}.cover: cover must be a regular file`);
  }
  const sourceReal = await realpath(sourceRoot);
  const fileReal = await realpath(file);
  if (!isInside(sourceReal, fileReal)) {
    throw new Error(`${relativeFile}.cover: resolved cover escapes the template root`);
  }
  if (fileInfo.size > MAX_COVER_SIZE) {
    throw new Error(`${relativeFile}.cover: cover exceeds 2 MiB`);
  }
  const bytes = await readFile(file);
  const dimensions = imageSize(bytes);
  if (dimensions.width === undefined || dimensions.height === undefined) {
    throw new Error(`${relativeFile}.cover: image dimensions are unavailable`);
  }
  if (dimensions.width < 640 || dimensions.height < 360) {
    throw new Error(`${relativeFile}.cover: cover must be at least 640x360`);
  }
  if (dimensions.width * 9 !== dimensions.height * 16) {
    throw new Error(`${relativeFile}.cover: cover must have a 16:9 aspect ratio`);
  }
  const detectedExtension = detectedImageExtension(bytes);
  if (detectedExtension === undefined || !extensionsMatch(extension, detectedExtension)) {
    throw new Error(`${relativeFile}.cover: image contents do not match extension`);
  }
  return {
    file,
    extension,
    mime: MIME_BY_EXTENSION.get(extension)!,
    sha256: sha256(bytes),
    width: dimensions.width,
    height: dimensions.height,
    size: fileInfo.size
  };
}

function normalizeSourceManifest(manifest: CreatorPresetSourceManifest): CreatorPresetSourceManifest {
  return {
    ...manifest,
    cover: toPosix(manifest.cover),
    tags: [...new Set(manifest.tags)].sort((left, right) => left.localeCompare(right))
  };
}

function comparePresets(left: CompiledCreatorPreset, right: CompiledCreatorPreset): number {
  return left.module.localeCompare(right.module)
    || left.id.localeCompare(right.id)
    || left.version - right.version;
}

async function sortedDirectoryEntries(directory: string) {
  return (await readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function rejectSymlink(entry: { isSymbolicLink(): boolean }, file: string): Promise<void> {
  if (entry.isSymbolicLink()) {
    throw new Error(`${toPosix(file)}: symbolic links are not allowed`);
  }
}

async function assertDirectory(directory: string): Promise<void> {
  const info = await lstat(directory).catch(() => undefined);
  if (info === undefined || !info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${directory}: preset source root must be a real directory`);
  }
}

async function listOutputFiles(
  root: string,
  initial: string[] = []
): Promise<CreatorPresetBuildManifest['files']> {
  const paths = [...initial];
  const walk = async (directory: string): Promise<void> => {
    for (const entry of await sortedDirectoryEntries(directory)) {
      const absolute = path.join(directory, entry.name);
      const relative = toPosix(path.relative(root, absolute));
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && !paths.includes(relative)) paths.push(relative);
    }
  };
  await walk(root);
  paths.sort();
  return Promise.all(paths.map(async relative => {
    const bytes = await readFile(path.join(root, relative));
    return {
      path: relative,
      sha256: sha256(bytes),
      size: bytes.length
    };
  }));
}

async function syncTree(root: string): Promise<void> {
  const files = await listOutputFiles(root);
  for (const file of files) {
    const handle = await open(path.join(root, file.path), 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  const directory = await open(root, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  );
}

function detectedImageExtension(bytes: Buffer): '.png' | '.jpg' | '.webp' | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return '.png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return '.webp';
  return undefined;
}

function extensionsMatch(expected: string, actual: string): boolean {
  return expected === actual || ((expected === '.jpg' || expected === '.jpeg') && actual === '.jpg');
}

function formatZodIssues(relativeFile: string, prefix: string, error: ZodError): string {
  return error.issues
    .map(issue => `${relativeFile}.${prefix}.${issue.path.join('.') || '<root>'}: ${issue.message}`)
    .join('\n');
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}
