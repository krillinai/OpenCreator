import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export function packagedExecutable(desktopDir: string): string {
  const packageRoot = resolvePackageRoot(desktopDir);
  if (process.platform === 'darwin') {
    return join(packageRoot, 'Contents', 'MacOS', 'OpenCreator');
  }
  return join(
    packageRoot,
    process.platform === 'win32' ? 'OpenCreator.exe' : 'opencreator'
  );
}

function resolvePackageRoot(desktopDir: string): string {
  const explicit = process.env.OPENCREATOR_DESKTOP_PACKAGE_ROOT;
  if (explicit !== undefined && explicit.trim().length > 0) {
    return resolve(explicit);
  }
  const manifestPath = resolve(
    process.env.OPENCREATOR_DESKTOP_BUILD_MANIFEST
      ?? join(desktopDir, 'release', 'opencreator-desktop-build-manifest.json')
  );
  if (!existsSync(manifestPath)) {
    throw new Error(
      `Desktop 构建清单不存在：${manifestPath}。`
      + '请先执行 package，或设置 OPENCREATOR_DESKTOP_PACKAGE_ROOT。'
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    platform?: string;
    arch?: string;
    packageRoot?: string;
  };
  if (typeof manifest.packageRoot !== 'string') {
    throw new Error(`Desktop 构建清单缺少 packageRoot：${manifestPath}`);
  }
  if (manifest.platform !== process.platform || manifest.arch !== process.arch) {
    throw new Error(
      `Desktop 构建产物不是当前原生平台：`
      + `${String(manifest.platform)}/${String(manifest.arch)}，`
      + `当前为 ${process.platform}/${process.arch}`
    );
  }
  return resolve(manifest.packageRoot);
}
