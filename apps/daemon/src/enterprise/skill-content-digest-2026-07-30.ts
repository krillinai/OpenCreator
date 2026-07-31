import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';

type ContentFile = {
  absolutePath: string;
  relativePath: string;
  pathBytes: Buffer;
};

export async function computeEnterpriseSkillContentDigest(
  root: string
): Promise<string> {
  const rootStat = await safeLstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw invalidContent('skill root must be a real directory');
  }

  const files: ContentFile[] = [];
  await collectFiles(root, [], files);
  files.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes));

  const hash = createHash('sha256');
  for (const file of files) {
    const before = await safeLstat(file.absolutePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw invalidContent(`skill entry is not a regular file: ${file.relativePath}`);
    }

    const pathLength = Buffer.allocUnsafe(4);
    pathLength.writeUInt32BE(file.pathBytes.byteLength);
    const fileLength = Buffer.allocUnsafe(8);
    fileLength.writeBigUInt64BE(BigInt(before.size));
    hash.update(pathLength);
    hash.update(file.pathBytes);
    hash.update(fileLength);

    let actualBytes = 0;
    try {
      for await (const chunk of createReadStream(file.absolutePath)) {
        const bytes = chunk as Buffer;
        actualBytes += bytes.byteLength;
        hash.update(bytes);
      }
    } catch {
      throw invalidContent(`skill file could not be read: ${file.relativePath}`);
    }

    const after = await safeLstat(file.absolutePath);
    if (
      after.isSymbolicLink() ||
      !after.isFile() ||
      actualBytes !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) {
      throw invalidContent(`skill file changed while hashing: ${file.relativePath}`);
    }
  }
  return hash.digest('hex');
}

async function collectFiles(
  directory: string,
  relativeParts: string[],
  files: ContentFile[]
): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    throw invalidContent('skill directory could not be read');
  }

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name);
    const childParts = [...relativeParts, entry.name];
    const relativePath = childParts.join('/');
    const stat = await safeLstat(absolutePath);
    if (stat.isSymbolicLink()) {
      throw invalidContent(`symlink is not allowed: ${relativePath}`);
    }
    if (stat.isDirectory()) {
      await collectFiles(absolutePath, childParts, files);
      continue;
    }
    if (!stat.isFile()) {
      throw invalidContent(`non-regular entry is not allowed: ${relativePath}`);
    }
    files.push({
      absolutePath,
      relativePath,
      pathBytes: Buffer.from(relativePath, 'utf8')
    });
  }
}

async function safeLstat(path: string) {
  try {
    return await lstat(path);
  } catch {
    throw invalidContent('skill content changed during traversal');
  }
}

function invalidContent(message: string): Error {
  return new Error(`ENTERPRISE_SKILL_PACKAGE_INVALID: ${message}`);
}
