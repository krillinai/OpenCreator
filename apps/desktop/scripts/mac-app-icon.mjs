import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

export async function verifyMacAppIcon(iconPath, sourcePath, options = {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'opencreator-icon-'));
  try {
    const iconset = join(temporary, 'OpenCreator.iconset');
    (options.execFileSync ?? execFileSync)('iconutil', [
      '--convert', 'iconset', '--output', iconset, iconPath
    ], { encoding: 'utf8', timeout: 30_000 });
    const source = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const packaged = await sharp(join(iconset, 'icon_512x512@2x.png'))
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (source.info.width !== 1024 || source.info.height !== 1024
      || packaged.info.width !== source.info.width
      || packaged.info.height !== source.info.height
      || !packaged.data.equals(source.data)) {
      throw new Error('Packaged macOS icon does not match resources/icon.png');
    }
    for (const name of ['icon_16x16.png', 'icon_32x32.png']) {
      const { data } = await sharp(join(iconset, name)).ensureAlpha().raw()
        .toBuffer({ resolveWithObject: true });
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3] < 128) continue;
        if (Math.max(data[index], data[index + 1], data[index + 2])
          - Math.min(data[index], data[index + 1], data[index + 2]) > 10) {
          throw new Error(`Packaged macOS icon ${name} has colored pixels`);
        }
      }
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export async function prepareMacAppIcon(context) {
  if (context.electronPlatformName !== 'darwin') return;
  await verifyMacAppIcon(
    join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`,
      'Contents', 'Resources', 'icon.icns'),
    join(context.packager.projectDir, 'resources', 'icon.png')
  );
}
