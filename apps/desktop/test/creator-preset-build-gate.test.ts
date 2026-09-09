import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const rootDir = resolve(process.cwd(), '../..');

function read(relativePath: string): string {
  return readFileSync(resolve(rootDir, relativePath), 'utf8');
}

describe('Creator Preset build gate', () => {
  it('runs the preset CI gate before every catalog consumer build', () => {
    const rootPackage = JSON.parse(read('package.json')) as {
      scripts?: Record<string, string>;
    };
    const workflow = read('.github/workflows/ci.yml');
    const gate = 'pnpm templates:ci';

    expect(rootPackage.scripts?.['templates:ci'])
      .toBe('pnpm templates:validate && pnpm templates:compile');
    expect(workflow).toContain(gate);
    const gateIndex = workflow.indexOf(gate);
    for (const consumer of [
      'pnpm krillinai:test',
      'pnpm test',
      'pnpm typecheck',
      'pnpm build'
    ]) {
      expect(gateIndex, `${gate} must run before ${consumer}`)
        .toBeLessThan(workflow.indexOf(consumer));
    }
  });

  it('compiles once after clean and packages one catalog for daemon and web', () => {
    const prepareDaemon = read('apps/desktop/scripts/prepare-daemon.mjs');
    const viteConfig = read('apps/web/vite.config.ts');
    const builderConfig = read('apps/desktop/electron-builder.yml');
    const compileCalls = prepareDaemon.match(/templates:compile/g) ?? [];

    expect(prepareDaemon).toContain(
      "resolve(rootDir, '.runtime/generated/creator-presets')"
    );
    expect(compileCalls).toHaveLength(1);
    expect(prepareDaemon.indexOf('cleanBuildOutputs();'))
      .toBeLessThan(prepareDaemon.indexOf('templates:compile'));
    expect(prepareDaemon).toMatch(
      /resolve\(\s*targetDir,\s*'runtime',\s*'creator-presets'\s*\)/
    );
    expect(viteConfig).toContain("join(webDir, '../../.runtime/generated/creator-presets')");
    expect(viteConfig).toContain("join(webDir, 'dist', 'creator-presets')");
    expect(viteConfig).toContain("join(webDir, 'dist', 'fonts', 'opencreator')");
    expect(builderConfig).toContain('from: .pack/daemon/runtime');
    expect(builderConfig).toContain('from: ../web/dist');
    expect(builderConfig.match(/creator-presets/g) ?? []).toHaveLength(0);
  });

  it('records and verifies packaged preset and subtitle font resources', () => {
    const packageRelease = read('apps/desktop/scripts/package-release.mjs');
    const prepareCreatorRuntime = read(
      'apps/desktop/scripts/prepare-creator-runtime.mjs'
    );
    const verifier = read('apps/desktop/scripts/verify-package.mjs');
    const fontManifest = JSON.parse(read(
      'assets/creator-subtitle-fonts/manifest.json'
    )) as {
      fonts: Array<{
        desktopFile: string;
        desktopSha256: string;
        webFile: string;
        webSha256: string;
      }>;
    };

    for (const field of [
      'creatorPresetCatalogHash',
      'creatorPresetAssetSetHash',
      'creatorPresetResourceCount',
      'creatorSubtitleFontSetHash',
      'creatorSubtitleFontResourceCount',
      'creatorSubtitleWebFontSetHash',
      'creatorSubtitleWebFontResourceCount'
    ]) {
      expect(packageRelease).toContain(field);
      expect(verifier).toContain(field);
    }
    expect(verifier).toContain('assertCreatorPresetContents();');
    expect(verifier).toContain('Creator preset Web asset is missing');
    expect(verifier).toContain('Creator preset Web assets contain a stale file');
    expect(verifier).toContain('Creator preset catalog hash mismatch');
    expect(verifier).toContain('Creator preset asset set hash mismatch');
    expect(prepareCreatorRuntime).toContain('entry.desktopFile');
    expect(prepareCreatorRuntime).toContain('entry.webFile');
    expect(prepareCreatorRuntime).toContain('assertSubtitleFontMetadata');
    expect(fontManifest.fonts).toHaveLength(9);
    for (const font of fontManifest.fonts) {
      expect(font.desktopFile).toMatch(/^desktop\/.+\.ttf$/);
      expect(font.desktopSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(font.webFile).toMatch(/^web\/.+\.woff2$/);
      expect(font.webSha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
