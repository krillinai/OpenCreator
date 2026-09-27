import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const desktopRoot = resolve(repoRoot, 'apps/desktop');
const webPublicRoot = resolve(repoRoot, 'apps/web/public');
const brandMarkPolygon = '308,125 292,126 278,135 270,150';
const legacyAssetHashes = new Set([
  '16921fe7d74d219cb9818d0d479f0e98f51b3cde41709b1118640f71c69a589e',
  '752b523394689bcb2851bbe746588fa6c44dfb9de94041269f265a48cbfc54ab',
  '8b5a5cc71309464cc3760de6098099cf52319d3d7ba270ea23527420941b68b4',
  '8b84ba27fab8f99a196fd2dcfea79bd5a8fc6a8567250f37299965c8bb032702',
  '98a334969f50ea5f1e856c688e75fa600d51a211e5705403fb75de163c249f86',
  'c820b7847269b00612d564092b7f843810943505570cf3f56f3e21fe17d94677',
  'd779d52186d13911e2af84ed6f599b0b3494470ce0b11366067d2bf59632e747',
  'fbd36c4f030966b51dc2efda4359246e7865b8ca2503bce609ab83cb4a0de6a6'
]);

describe('品牌资源', () => {
  it('启动页使用 OpenCreator 文字品牌，菜单栏保留可用图标', () => {
    const bootstrapHtml = readFileSync(resolve(desktopRoot, 'src/bootstrap/index.html'), 'utf8');
    const bootstrapCss = readFileSync(resolve(desktopRoot, 'src/bootstrap/style.css'), 'utf8');
    expect(bootstrapHtml).toContain('<span class="brand-name">OpenCreator</span>');
    expect(bootstrapHtml).not.toContain('<img');
    expect(bootstrapCss).not.toContain('filter: brightness(0) saturate(100%);');

    const trayManager = readFileSync(resolve(desktopRoot, 'src/main/tray-manager.ts'), 'utf8');
    expect(trayManager).toContain("if (process.platform === 'darwin') icon.setTemplateImage(true);");
    expect(trayManager).toContain('height: size');
    const desktopMain = readFileSync(resolve(desktopRoot, 'src/main/main.ts'), 'utf8');
    expect(desktopMain).toContain("process.platform === 'win32'");
    expect(desktopMain).toContain("? 'icon-win.png'");
    expect(desktopMain).toContain('iconPath: join(resourceRoot, trayIconName)');
    expect(existsSync(resolve(desktopRoot, 'resources/tray.png'))).toBe(true);
    expect(existsSync(resolve(desktopRoot, 'resources/icon.png'))).toBe(true);
    expect(existsSync(resolve(desktopRoot, 'resources/icon-win.png'))).toBe(true);

    const icon = readPngMetadata(resolve(desktopRoot, 'resources/icon.png'));
    expect(icon).toEqual({ width: 1024, height: 1024, colorType: 6 });
    const windowsIcon = readPngMetadata(resolve(desktopRoot, 'resources/icon-win.png'));
    expect(windowsIcon).toEqual({ width: 1024, height: 1024, colorType: 6 });
    expect(readPngAlphaBounds(resolve(desktopRoot, 'resources/icon-win.png'))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 1023,
      maxY: 1023,
      darkWidth: 776,
      darkHeight: 833
    });
  });

  it('Desktop 图标、托盘和 Web 使用同一枚双链品牌图形', () => {
    const iconSvg = readFileSync(resolve(desktopRoot, 'resources/icon.svg'), 'utf8');
    const traySvg = readFileSync(resolve(desktopRoot, 'resources/tray.svg'), 'utf8');
    const webMark = readFileSync(
      resolve(repoRoot, 'apps/web/src/components/brand/OpenCreatorMark.tsx'),
      'utf8'
    );
    const sidebar = readFileSync(
      resolve(repoRoot, 'apps/web/src/features/shell/OpenCreatorSidebar.tsx'),
      'utf8'
    );

    expect(iconSvg).toContain(brandMarkPolygon);
    expect(traySvg).toContain(brandMarkPolygon);
    expect(webMark).toContain(brandMarkPolygon);
    expect(webMark).toContain('fill="currentColor"');
    expect(sidebar).toContain('<OpenCreatorMark');
    expect(iconSvg).toContain('<rect width="460" height="460" rx="92" fill="#fff"/>');
    expect(traySvg).not.toContain('<rect');

    const builderConfig = readFileSync(resolve(desktopRoot, 'electron-builder.yml'), 'utf8');
    expect(builderConfig).toMatch(/mac:[\s\S]*?icon: resources\/icon\.png/);
    expect(builderConfig).toMatch(/win:[\s\S]*?icon: resources\/icon-win\.png/);
  });

  it('不再发布旧品牌素材或历史兼容路径', () => {
    const removedAssets = [
      resolve(desktopRoot, 'src/bootstrap/logo.png'),
      ...[
        'favicon.svg',
        'logo.png',
        'logo-all.png',
        'logo-bg.png',
        'logo-black.png',
        'logo-cor.png',
        'logo-v2-black-logo.svg',
        'logo-v2-black.svg',
        'logo-v2-white-logo.svg',
        'logo-v2-white.svg',
        'logo-white.png'
      ].map(name => resolve(webPublicRoot, name)),
      resolve(webPublicRoot, 'skill-market/skills-empty.png'),
      ...[
        'head.png',
        'logo-v2-black-logo.svg',
        'logo-v2-black.png',
        'logo-v2-black.svg',
        'logo-v2-white-logo.png',
        'logo-v2-white-logo.svg',
        'logo-v2-white.png',
        'logo-v2-white.svg',
        'skills-empty.png'
      ].map(name => resolve(repoRoot, 'resources', name))
    ];

    for (const asset of removedAssets) {
      expect(existsSync(asset), asset).toBe(false);
    }
  });

  it('全部发布品牌资源不包含旧版文件内容', () => {
    const publishedAssets = [
      resolve(desktopRoot, 'resources/icon.png'),
      resolve(desktopRoot, 'resources/tray.png')
    ];

    for (const asset of publishedAssets) {
      expect(legacyAssetHashes.has(hash(asset)), asset).toBe(false);
    }
  });
});

function hash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readPngMetadata(path: string): { width: number; height: number; colorType: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('IHDR');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes.readUInt8(25)
  };
}

function readPngAlphaBounds(path: string): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  darkWidth: number;
  darkHeight: number;
} {
  const bytes = readFileSync(path);
  const { width, height, colorType } = readPngMetadata(path);
  expect(bytes.readUInt8(24)).toBe(8);
  expect(colorType).toBe(6);
  expect(bytes.readUInt8(28)).toBe(0);

  const idatChunks: Buffer[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') idatChunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }

  const decoded = inflateSync(Buffer.concat(idatChunks));
  const bytesPerPixel = 4;
  const stride = width * bytesPerPixel;
  let sourceOffset = 0;
  let previous = Buffer.alloc(stride);
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let darkMinX = width;
  let darkMinY = height;
  let darkMaxX = -1;
  let darkMaxY = -1;

  for (let y = 0; y < height; y += 1) {
    const filter = decoded[sourceOffset]!;
    sourceOffset += 1;
    const row = Buffer.allocUnsafe(stride);
    for (let index = 0; index < stride; index += 1) {
      const left = index >= bytesPerPixel ? row[index - bytesPerPixel]! : 0;
      const up = previous[index]!;
      const upperLeft = index >= bytesPerPixel ? previous[index - bytesPerPixel]! : 0;
      const encoded = decoded[sourceOffset + index]!;
      row[index] = (encoded + pngFilterValue(filter, left, up, upperLeft)) & 0xff;
    }
    sourceOffset += stride;

    for (let x = 0; x < width; x += 1) {
      const pixelOffset = x * bytesPerPixel;
      const alpha = row[pixelOffset + 3]!;
      if (alpha === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      if (
        alpha >= 128
        && row[pixelOffset]! + row[pixelOffset + 1]! + row[pixelOffset + 2]! < 240
      ) {
        darkMinX = Math.min(darkMinX, x);
        darkMinY = Math.min(darkMinY, y);
        darkMaxX = Math.max(darkMaxX, x);
        darkMaxY = Math.max(darkMaxY, y);
      }
    }
    previous = row;
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
    darkWidth: darkMaxX - darkMinX + 1,
    darkHeight: darkMaxY - darkMinY + 1
  };
}

function pngFilterValue(filter: number, left: number, up: number, upperLeft: number): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) {
    const estimate = left + up - upperLeft;
    const leftDistance = Math.abs(estimate - left);
    const upDistance = Math.abs(estimate - up);
    const upperLeftDistance = Math.abs(estimate - upperLeft);
    if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) return left;
    return upDistance <= upperLeftDistance ? up : upperLeft;
  }
  throw new Error(`Unsupported PNG filter: ${filter}`);
}
