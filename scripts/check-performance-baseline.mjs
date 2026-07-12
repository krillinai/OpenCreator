import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const assetsDir = resolve('apps/web/dist/assets');
const files = readdirSync(assetsDir).map(name => ({
  name,
  path: join(assetsDir, name),
  bytes: statSync(join(assetsDir, name)).size
}));

const targets = [
  {
    label: 'Web 主入口 JavaScript',
    pattern: /^index-[^.]+\.js$/,
    maxBytes: 600_000,
    maxGzipBytes: 180_000
  },
  {
    label: 'FilesPage JavaScript',
    pattern: /^FilesPage-[^.]+\.js$/,
    maxBytes: 600_000,
    maxGzipBytes: 220_000
  },
  {
    label: 'SettingsPage JavaScript',
    pattern: /^SettingsPage-[^.]+\.js$/,
    maxBytes: 60_000,
    maxGzipBytes: 18_000
  },
  {
    label: 'Web 主样式',
    pattern: /^index-[^.]+\.css$/,
    maxBytes: 80_000,
    maxGzipBytes: 16_000
  }
];

let failed = false;
const measurements = targets.map(target => {
  const asset = files.find(file => target.pattern.test(file.name));
  if (asset === undefined) {
    failed = true;
    return { label: target.label, error: '未找到构建产物' };
  }
  const gzipBytes = gzipSync(readFileSync(asset.path)).byteLength;
  const withinBudget = asset.bytes <= target.maxBytes && gzipBytes <= target.maxGzipBytes;
  if (!withinBudget) failed = true;
  return {
    label: target.label,
    file: basename(asset.path),
    bytes: asset.bytes,
    gzipBytes,
    maxBytes: target.maxBytes,
    maxGzipBytes: target.maxGzipBytes,
    withinBudget
  };
});

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  assetsDir,
  measurements
}, null, 2));

if (failed) process.exitCode = 1;
