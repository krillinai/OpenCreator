import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deepLinkToRoute } from '../src/main/deep-link-manager.js';

describe('Desktop deep links', () => {
  it('maps supported links to existing hash routes', () => {
    expect(deepLinkToRoute('opencreator://new')).toBe('#/');
    expect(deepLinkToRoute('opencreator://tasks')).toBe('#/tasks');
    expect(deepLinkToRoute(
      'opencreator://thread/thread%2F%E4%B8%AD%E6%96%87?runId=run%2F1&approvalId=approval%201'
    )).toBe(
      '#/thread/thread%2F%E4%B8%AD%E6%96%87?runId=run%2F1&approvalId=approval+1'
    );
  });

  it('rejects unknown routes and protocols', () => {
    expect(deepLinkToRoute('https://example.com')).toBeUndefined();
    expect(deepLinkToRoute('opencreator://unknown')).toBeUndefined();
  });

  it('forces Chinese application localization before Electron becomes ready', () => {
    const mainSource = readFileSync('src/main/main.ts', 'utf8');
    const builderConfig = readFileSync('electron-builder.yml', 'utf8');

    expect(mainSource).toMatch(
      /app\.setName\('OpenCreator'\);\s*app\.commandLine\.appendSwitch\('lang', 'zh-CN'\);/
    );
    expect(builderConfig).toContain('CFBundleDevelopmentRegion: zh_CN');
    expect(builderConfig).toContain('CFBundleLocalizations:');
    expect(builderConfig).toContain('- zh-Hans');
  });
});
