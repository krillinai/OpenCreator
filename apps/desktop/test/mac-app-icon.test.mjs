import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareMacAppIcon, verifyMacAppIcon } from '../scripts/mac-app-icon.mjs';

const temporaryDirectories = [];
afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('macOS app icon without Xcode', () => {
  const source = new URL('../resources/icon.png', import.meta.url).pathname;

  it('uses the same source image in both appearances, with a white background and black mark', async () => {
    const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([1024, 1024]);
    let white = 0;
    let black = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (data[index + 3] < 250) continue;
      if (data[index] > 245 && data[index + 1] > 245 && data[index + 2] > 245) white++;
      if (data[index] < 25 && data[index + 1] < 25 && data[index + 2] < 25) black++;
    }
    expect(white).toBeGreaterThan(300_000);
    expect(black).toBeGreaterThan(80_000);
  });

  it('does not use macOS tools on other platforms', async () => {
    await prepareMacAppIcon({ electronPlatformName: 'win32' });
    await prepareMacAppIcon({ electronPlatformName: 'linux' });
  });

  it.skipIf(process.platform !== 'darwin')('verifies the generated icon pixels against the source PNG', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opencreator-icon-test-'));
    temporaryDirectories.push(root);
    const iconset = join(root, 'original.iconset');
    const bundled = join(root, 'icon.icns');
    mkdirSync(iconset);
    copyFileSync(source, join(iconset, 'icon_512x512@2x.png'));
    execFileSync('iconutil', ['--convert', 'icns', '--output', bundled, iconset]);
    await expect(verifyMacAppIcon(bundled, source)).resolves.toBeUndefined();

    const changed = join(root, 'changed.png');
    await sharp(source).modulate({ brightness: 0.5 }).toFile(changed);
    await expect(verifyMacAppIcon(bundled, changed)).rejects.toThrow(/does not match/);
  });

  it.skipIf(process.platform !== 'darwin')('fails if the macOS icon is absent', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opencreator-icon-test-'));
    temporaryDirectories.push(root);
    await expect(prepareMacAppIcon({
      electronPlatformName: 'darwin',
      appOutDir: root,
      packager: {
        projectDir: new URL('..', import.meta.url).pathname,
        appInfo: { productFilename: 'OpenCreator' }
      }
    })).rejects.toThrow();
  });
});
