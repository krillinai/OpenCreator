import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(import.meta.dirname, '../../..');
const desktopRoot = resolve(repoRoot, 'apps/desktop');
const webPublicRoot = resolve(repoRoot, 'apps/web/public');
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
    expect(existsSync(resolve(desktopRoot, 'resources/tray.png'))).toBe(true);
    expect(existsSync(resolve(desktopRoot, 'resources/icon.png'))).toBe(true);
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
