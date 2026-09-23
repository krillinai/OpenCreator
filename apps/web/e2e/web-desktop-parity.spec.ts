import type { CreatorServicesCapabilitiesResponse, CreatorYtDlpStatusResponse } from '@opencreator/protocol';
import { test, expect } from './fixtures/runtime.js';

test('OSS 地域配置在 Browser/Desktop 下保存并重新加载一致', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const results: unknown[] = [];
  try {
    for (const platform of ['browser', 'desktop']) {
      await runtime.api('DELETE', '/creator-services/config');
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      if (platform === 'desktop') await installDesktopBridge(page);
      try {
        await runtime.openApp(page);
        await page.goto(`${runtime.origin}/#/settings?tab=ai-services&section=transcription`);
        await page.getByRole('combobox', { name: '语音识别服务' }).click();
        await page.getByRole('option', { name: '阿里云百炼' }).click();
        await expect(page.getByLabel('OSS 地域')).toHaveValue('cn-shanghai');
        await page.getByLabel('OSS 地域').fill('ap-southeast-1');
        await page.getByLabel('OSS Endpoint（可选）').fill('https://oss-ap-southeast-1.aliyuncs.com');
        const request = page.waitForRequest(req => req.method() === 'PATCH' && req.url().endsWith('/creator-services/config'));
        await page.getByRole('button', { name: '保存配置' }).click();
        const payload = (await request).postDataJSON();
        await expect(page.getByText('配置已安全保存')).toBeVisible();
        await page.reload();
        await expect(page.getByLabel('OSS 地域')).toHaveValue('ap-southeast-1');
        await expect(page.getByLabel('OSS Endpoint（可选）')).toHaveValue('https://oss-ap-southeast-1.aliyuncs.com');
        results.push({
          payload, stored: await runtime.api('GET', '/creator-services/config'),
          text: await page.getByRole('tabpanel').innerText(),
          regionBox: await page.getByLabel('OSS 地域').boundingBox(),
          endpointBox: await page.getByLabel('OSS Endpoint（可选）').boundingBox()
        });
      } finally { await context.close(); }
    }
    expect(results[1]).toEqual(results[0]);
  } finally { await runtime.api('DELETE', '/creator-services/config'); }
});

test('Agent 面板在 Browser/Desktop Bridge 下均不显示产物版本详情', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '内部使用相同内容视口');
  const created = await runtime.api<{ job: { id: string } }>('POST', '/creator/jobs', {
    projectId: runtime.projectId, templateId: 'image-generation', state: { prompt: 'Agent 面板验收', currentStep: 1, furthestStep: 1 }
  });
  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/workbench?tool=image-generation&jobId=${created.job.id}`);
      await expect(page.getByText('当前任务', { exact: true })).toBeVisible();
      await expect(page.getByText('产物版本与来源', { exact: true })).toHaveCount(0);
    } finally { await context.close(); }
  }
});

test('本地字幕导入在 Browser/Desktop Bridge 下保持相同命令和界面', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const results: unknown[] = [];
  for (const platform of ['browser', 'desktop']) {
    const created = await runtime.api<{ job: { id: string } }>('POST', '/creator/jobs', {
      projectId: runtime.projectId, templateId: 'video-translation',
      state: { sourceUrl: 'https://www.youtube.com/watch?v=import', currentStep: 1, furthestStep: 1 }
    });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/workbench?tool=video-translation&jobId=${created.job.id}`);
      const group = page.getByRole('group', { name: '导入已有字幕' });
      await group.getByRole('switch', { name: '导入已有字幕' }).click();
      await group.getByRole('combobox', { name: '字幕类型' }).selectOption('target_subtitle');
      const request = page.waitForRequest(request => request.url().endsWith('/actions') && request.postDataJSON()?.action === 'import-subtitle');
      await group.getByLabel('UTF-8 SRT 文件').setInputFiles({ name: 'local.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:01,000\nHello\n') });
      const action = (await request).postDataJSON();
      await expect(group.getByText(/本地导入 · local.srt/)).toBeVisible();
      await expect(page.getByRole('heading', { name: '设置翻译语言' })).toBeVisible();
      const stored = await runtime.api<{ job: { artifacts: Array<{ kind: string; metadata: unknown }> } }>('GET', `/creator/jobs/${created.job.id}`);
      results.push({ text: await group.innerText(), box: await group.boundingBox(), input: action.input, artifacts: stored.job.artifacts.map(a => ({ kind: a.kind, metadata: a.metadata })) });
    } finally { await context.close(); }
  }
  expect(results[1]).toEqual(results[0]);
});

test('浅深色基准色与中性灰表面不随强调色变化且 Browser/Desktop 一致', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '固定桌面内容视口');
  const results = [];
  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    try {
      await runtime.openApp(page);
      const colors = [];
      for (const theme of ['dark', 'light'] as const) {
        for (const accent of ['red', 'blue', 'custom'] as const) {
          const values = await page.evaluate(({ theme, accent }) => {
            const root = document.documentElement;
            root.dataset.theme = theme;
            root.dataset.accent = accent;
            root.style.setProperty('--custom-accent-value', '#3b82f6');
            const surface = document.createElement('div');
            surface.style.backgroundColor = 'var(--surface-2)';
            document.body.append(surface);
            const result = { theme, accent, page: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color, sidebar: getComputedStyle(document.querySelector('.opencreator-sidebar-pane')!).backgroundColor, surface: getComputedStyle(surface).backgroundColor };
            surface.remove();
            return result;
          }, { theme, accent });
          expect(values.page).toBe(theme === 'dark' ? 'rgb(10, 10, 10)' : 'rgb(229, 229, 229)');
          expect(values.text).toBe(theme === 'dark' ? 'rgb(229, 229, 229)' : 'rgb(10, 10, 10)');
          colors.push(values);
          if (platform === 'browser' && accent === 'red') await testInfo.attach(`theme-${theme}-red.png`, { body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png' });
        }
        expect(colors.at(-3)!.sidebar).toBe(colors.at(-2)!.sidebar);
        expect(colors.at(-3)!.surface).toBe(colors.at(-2)!.surface);
        expect(colors.at(-2)!.surface).toBe(colors.at(-1)!.surface);
      }
      results.push(colors);
    } finally { await context.close(); }
  }
  expect(results[1]).toEqual(results[0]);
});

test('窄视口 Creator 设置区与右侧对话栏在 Browser/Desktop 下并排一致', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '固定桌面内容视口');
  test.setTimeout(120_000);
  for (const [tool, templateId] of [
    ['video-generation', 'video-generation'],
    ['video-translation', 'video-translation']
  ] as const) {
    const created = await runtime.api<{ job: { id: string } }>('POST', '/creator/jobs', {
      projectId: runtime.projectId,
      templateId,
      state: {}
    });
    const layouts = [];
    for (const platform of ['browser', 'desktop'] as const) {
      const context = await browser.newContext({ viewport: { width: 980, height: 680 } });
      const page = await context.newPage();
      if (platform === 'desktop') await installDesktopBridge(page);
      try {
        await runtime.openApp(page);
        await page.goto(`${runtime.origin}/#/workbench?tool=${tool}&jobId=${created.job.id}`);
        await expect(page.locator('.creator-collaboration-panel')).toBeVisible();
        const layout = await page.evaluate(() => {
          const main = document.querySelector('.creator-workspace-main, .video-translation-wizard-main')!.getBoundingClientRect();
          const panel = document.querySelector('.creator-collaboration-panel')!.getBoundingClientRect();
          return {
            mainRight: Math.round(main.right),
            panelLeft: Math.round(panel.left),
            panelRight: Math.round(panel.right),
            panelBottom: Math.round(panel.bottom)
          };
        });
        expect(layout.panelLeft).toBeGreaterThanOrEqual(layout.mainRight - 1);
        expect(layout.panelRight).toBeLessThanOrEqual(980);
        expect(layout.panelBottom).toBe(680);
        layouts.push(layout);
      } finally {
        await context.close();
      }
    }
    expect(layouts[1]).toEqual(layouts[0]);
  }
});

test('设置页各项标题在 Browser/Desktop 下与左侧返回行对齐', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '固定桌面内容视口');
  const offsets = [];
  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page, true);
    try {
      await runtime.openApp(page);
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const headings = [];
      for (const tab of ['常规', 'AI 服务']) {
        await page.locator('.settings-nav').getByRole('button', { name: new RegExp(tab) }).click();
        const title = page.locator('.settings-content h1');
        await expect(title).toBeVisible();
        const offset = await page.evaluate(() => {
          const back = document.querySelector('.settings-back')!.getBoundingClientRect();
          const heading = document.querySelector('.settings-content h1')!.getBoundingClientRect();
          return Math.round((heading.top + heading.bottom - back.top - back.bottom) / 2);
        });
        expect(Math.abs(offset)).toBeLessThanOrEqual(2);
        headings.push(offset);
      }
      offsets.push(headings);
    } finally {
      await context.close();
    }
  }
  expect(offsets[1]).toEqual(offsets[0]);
});

test('所有设置 Tab 在 Browser/Desktop 下使用相同的页面留白', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '固定桌面内容视口');
  test.setTimeout(120_000);
  const platforms = [];
  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({ viewport: { width: 1181, height: 985 } });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page, true);
    try {
      await runtime.openApp(page);
      await page.getByRole('button', { name: '设置', exact: true }).click();
      const nav = page.locator('.settings-nav > button');
      await expect(nav).toHaveCount(9);
      const tabs = [];
      for (let index = 0; index < 9; index += 1) {
        await nav.nth(index).click();
        const section = page.locator('.settings-content > .settings-section');
        await expect(section).toBeVisible();
        const bounds = await section.evaluate(element => {
          const content = element.parentElement!;
          const sectionBox = element.getBoundingClientRect();
          const contentBox = content.getBoundingClientRect();
          return {
            left: Math.round(sectionBox.left - contentBox.left),
            right: Math.round(contentBox.right - sectionBox.right),
            gutter: content.offsetWidth - content.clientWidth,
            width: Math.round(sectionBox.width)
          };
        });
        expect(bounds.left, `${platform}: Tab ${index + 1}`).toBe(24);
        expect(bounds.right - bounds.gutter, `${platform}: Tab ${index + 1}`).toBe(24);
        tabs.push(bounds);
      }
      expect(tabs.every(bounds => JSON.stringify(bounds) === JSON.stringify(tabs[0]))).toBe(true);
      platforms.push(tabs);
    } finally {
      await context.close();
    }
  }
  expect(platforms[1]).toEqual(platforms[0]);
});

test('各主页面标题行在 Browser/Desktop 下与左侧品牌行同轴', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '固定桌面内容视口');
  test.setTimeout(180_000);
  const videoGeneration = await runtime.api<{ job: { id: string } }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    templateId: 'video-generation',
    state: {}
  });
  const videoTranslation = await runtime.api<{ job: { id: string } }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    templateId: 'video-translation',
    state: {}
  });
  const pages: Array<{ route: string; selector: string; height?: number }> = [
    { route: '/workbench', selector: '.creator-tools-page-header', height: 42 },
    { route: '/projects', selector: '.projects-page-header h1', height: 42 },
    { route: '/settings', selector: '.settings-content h1', height: 42 },
    { route: '/settings?tab=ai-services', selector: '.settings-content h1', height: 42 },
    { route: '/tasks', selector: '.task-center__header h1', height: 42 },
    { route: '/schedules', selector: '.schedules-view__header h1', height: 42 },
    { route: '/search', selector: '.search-view__input', height: 42 },
    { route: '/plugins', selector: '.plugin-center-header', height: 68 },
    { route: `/workbench?tool=video-generation&jobId=${videoGeneration.job.id}`, selector: '.creator-workspace-header', height: 68 },
    { route: `/workbench?tool=video-translation&jobId=${videoTranslation.job.id}`, selector: '.video-translation-header' }
  ];
  const results = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page, true);
    try {
      await runtime.openApp(page);
      const measurements = [];
      for (const { route, selector, height } of pages) {
        await page.evaluate(route => { window.location.hash = route; }, route);
        await expect(page.locator(selector).first()).toBeVisible();
        const measured = await page.evaluate(selector => {
          const brand = document.querySelector('.sidebar-brand')?.getBoundingClientRect();
          const main = document.querySelector('.opencreator-main-pane')!;
          const mainBox = main.getBoundingClientRect();
          const referenceCenter = brand && brand.height > 0
            ? (brand.top + brand.bottom) / 2
            : mainBox.top + Number.parseFloat(getComputedStyle(main).paddingTop) + 34;
          const title = document.querySelector(selector)!.getBoundingClientRect();
          return {
            centerOffset: Math.round((title.top + title.bottom) / 2 - referenceCenter),
            height: Math.round(title.height)
          };
        }, selector);
        expect(Math.abs(measured.centerOffset), `${platform}: ${route}`).toBeLessThanOrEqual(1);
        if (height !== undefined) expect(measured.height, `${platform}: ${route}`).toBe(height);
        measurements.push(measured);
        if (route === '/projects') {
          await testInfo.attach(`projects-title-${platform}.png`, {
            body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png'
          });
        }
      }
      await page.evaluate(() => { window.location.hash = '/projects'; });
      await expect(page.locator('.projects-page-header h1')).toBeVisible();
      await page.locator('.sidebar-collapse-button').click();
      await expect(page.locator('.opencreator-sidebar')).toHaveAttribute('data-collapsed', 'true');
      const collapsedOffset = await page.evaluate(() => {
        const brand = document.querySelector('.sidebar-brand')!.getBoundingClientRect();
        const heading = document.querySelector('.projects-page-header h1')!.getBoundingClientRect();
        return Math.round((heading.top + heading.bottom - brand.top - brand.bottom) / 2);
      });
      expect(Math.abs(collapsedOffset), `${platform}: collapsed projects`).toBeLessThanOrEqual(1);
      measurements.push({ centerOffset: collapsedOffset, height: 42 });
      results.push(measurements);
    } finally {
      await context.close();
    }
  }
  expect(results[1]).toEqual(results[0]);
});

test('工作台与我的项目在相同视口下共用内容容器边界', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '比较固定内容视口');
  test.setTimeout(120_000);
  const results = [];
  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 800 } });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page, true);
    try {
      await runtime.openApp(page);
      const widths = [];
      for (const width of [1440, 1200, 760, 390]) {
        await page.setViewportSize({ width, height: 800 });
        const measurements = [];
        for (const [route, selector] of [
          ['/workbench', '.creator-tools-page-inner'],
          ['/projects', '.projects-page-inner']
        ] as const) {
          await page.evaluate(route => { window.location.hash = route; }, route);
          await expect(page.locator(selector)).toBeVisible();
          const bounds = await page.locator(selector).evaluate(content => {
            const box = content.getBoundingClientRect();
            const parent = content.parentElement!.getBoundingClientRect();
            const scroller = content.parentElement!;
            const style = getComputedStyle(content);
            return {
              left: Math.round(box.left - parent.left),
              right: Math.round(parent.right - box.right),
              gutter: scroller.offsetWidth - scroller.clientWidth,
              width: Math.round(box.width),
              paddingTop: style.paddingTop,
              paddingBottom: style.paddingBottom
            };
          });
          expect(Math.abs(bounds.left + bounds.gutter - bounds.right), `${platform}: ${route} at ${width}px`)
            .toBeLessThanOrEqual(1);
          measurements.push(bounds);
        }
        expect(measurements[1], `${platform}: ${width}px`).toEqual(measurements[0]);
        widths.push(measurements[0]);
      }
      results.push(widths);
    } finally {
      await context.close();
    }
  }
  expect(results[1]).toEqual(results[0]);
});

test('项目页滚动而工作台未滚动时内容边界仍一致', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '固定桌面内容视口');
  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({ viewport: { width: 1273, height: 985 } });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page, true);
    try {
      await runtime.openApp(page);
      await page.evaluate(() => { window.location.hash = '/workbench'; });
      await expect(page.locator('.creator-tools-page-inner')).toBeVisible();
      const workbench = await page.locator('.creator-tools-page').evaluate(scroller => ({
        right: Math.round(scroller.querySelector('.creator-tools-page-inner')!.getBoundingClientRect().right),
        scrollable: scroller.scrollHeight > scroller.clientHeight,
        gutter: scroller.offsetWidth - scroller.clientWidth
      }));
      expect(workbench.scrollable, `${platform}: workbench`).toBe(false);

      await page.evaluate(() => { window.location.hash = '/projects'; });
      await expect(page.locator('.projects-page-inner')).toBeVisible();
      const projects = await page.locator('.projects-page').evaluate(scroller => {
        const filler = document.createElement('div');
        filler.style.height = '1600px';
        scroller.querySelector('.projects-page-inner')!.append(filler);
        return {
          right: Math.round(scroller.querySelector('.projects-page-inner')!.getBoundingClientRect().right),
          scrollable: scroller.scrollHeight > scroller.clientHeight,
          gutter: scroller.offsetWidth - scroller.clientWidth
        };
      });
      expect(projects.scrollable, `${platform}: projects`).toBe(true);
      expect(projects.gutter, `${platform}: scrollbar width`).toBe(workbench.gutter);
      expect(projects.right, `${platform}: page right edge`).toBe(workbench.right);
    } finally {
      await context.close();
    }
  }
});

test('我的项目和产出中心分类在 Browser/Desktop 下保持单行', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '固定桌面内容视口');
  const results = [];
  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({ viewport: { width: 980, height: 680 } });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page, true);
    try {
      await runtime.openApp(page);
      await page.getByRole('button', { name: '我的项目', exact: true }).click();
      const measurements = [];
      for (const [view, count] of [['项目', 4], ['产出中心', 6]] as const) {
        const primary = page.getByRole('tablist', { name: '内容维度' });
        await primary.getByRole('tab', { name: view }).click();
        await expect(primary.getByRole('tab', { name: view })).toHaveAttribute('aria-selected', 'true');
        const tabs = page.locator('.projects-category-tabs');
        await expect(tabs.getByRole('tab')).toHaveCount(count);
        const positions = await tabs.getByRole('tab').evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect();
          return { top: Math.round(rect.top), left: Math.round(rect.left) };
        }));
        expect(new Set(positions.map(position => position.top)).size).toBe(1);
        expect(positions.every((position, index) => index === 0 || position.left > positions[index - 1]!.left)).toBe(true);
        const styles = await page.evaluate(() => {
          const row = document.querySelector('.projects-primary-row')!;
          const primary = document.querySelector('.projects-dimension-tabs')!;
          const secondary = document.querySelector('.projects-category-tabs')!;
          const search = row.querySelector('.projects-search')!;
          const activePrimary = primary.querySelector('button[aria-selected="true"]')!;
          const activeSecondary = secondary.querySelector('button[aria-selected="true"]')!;
          const rowBox = row.getBoundingClientRect();
          const primaryBox = primary.getBoundingClientRect();
          const searchBox = search.getBoundingClientRect();
          return {
            primaryFontSize: getComputedStyle(activePrimary).fontSize,
            secondaryFontSize: getComputedStyle(activeSecondary).fontSize,
            primaryRule: getComputedStyle(row).borderBottomWidth,
            primaryIndicator: getComputedStyle(activePrimary, '::after').height,
            secondaryBackground: getComputedStyle(secondary).backgroundColor,
            secondaryBorder: getComputedStyle(secondary).borderTopWidth,
            activeSecondaryBackground: getComputedStyle(activeSecondary).backgroundColor,
            rowGap: Math.round(secondary.getBoundingClientRect().top - rowBox.bottom),
            searchGap: Math.round(searchBox.left - primaryBox.right),
            searchRight: Math.round(searchBox.right - rowBox.right),
            searchCenterOffset: Math.round((searchBox.top + searchBox.bottom - primaryBox.top - primaryBox.bottom) / 2)
          };
        });
        expect(styles.primaryFontSize).toBe('14px');
        expect(styles.secondaryFontSize).toBe('12px');
        expect(styles.primaryRule).toBe('1px');
        expect(styles.primaryIndicator).toBe('2px');
        expect(styles.secondaryBackground).toBe('rgba(0, 0, 0, 0)');
        expect(styles.secondaryBorder).toBe('0px');
        expect(styles.activeSecondaryBackground).not.toBe('rgba(0, 0, 0, 0)');
        expect(styles.rowGap).toBe(12);
        expect(styles.searchGap).toBeGreaterThanOrEqual(16);
        expect(styles.searchRight).toBe(0);
        expect(Math.abs(styles.searchCenterOffset)).toBeLessThanOrEqual(1);
        await expect(page.locator('.projects-primary-row').getByRole('searchbox', {
          name: view === '项目' ? '搜索项目' : '搜索产出'
        })).toBeVisible();
        measurements.push(styles);
        await testInfo.attach(`projects-hierarchy-${platform}-${view}.png`, {
          body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png'
        });
        await tabs.getByRole('tab', { name: view === '项目' ? '视频创作' : '视频', exact: true }).click();
        await expect(tabs.getByRole('tab', { name: view === '项目' ? '视频创作' : '视频', exact: true }))
          .toHaveAttribute('aria-selected', 'true');
      }
      results.push(measurements);
    } finally {
      await context.close();
    }
  }
  expect(results[1]).toEqual(results[0]);
});

test('窄屏产出分类保持单行且末项可选', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-mobile', '窄屏布局');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await runtime.openApp(page);
    await page.evaluate(() => { window.location.hash = '/projects'; });
    await page.getByRole('tablist', { name: '内容维度' }).getByRole('tab', { name: '产出中心' }).click();
    const tabs = page.getByRole('tablist', { name: '产出分类' });
    await expect(tabs.getByRole('tab')).toHaveCount(6);
    const tops = await tabs.getByRole('tab').evaluateAll(elements =>
      elements.map(element => Math.round(element.getBoundingClientRect().top))
    );
    expect(new Set(tops).size).toBe(1);
    await tabs.getByRole('tab', { name: '文档' }).click();
    await expect(tabs.getByRole('tab', { name: '文档' })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    const primaryRow = await page.evaluate(() => {
      const content = document.querySelector('.projects-page-inner')!.getBoundingClientRect();
      const tabs = document.querySelector('.projects-dimension-tabs')!.getBoundingClientRect();
      const search = document.querySelector('.projects-search')!.getBoundingClientRect();
      return {
        tabsRight: tabs.right,
        searchLeft: search.left,
        searchRight: search.right,
        contentRight: content.right,
        centerOffset: (search.top + search.bottom - tabs.top - tabs.bottom) / 2
      };
    });
    expect(primaryRow.searchLeft).toBeGreaterThanOrEqual(primaryRow.tabsRight + 10);
    expect(primaryRow.searchRight).toBeLessThanOrEqual(primaryRow.contentRight + 1);
    expect(Math.abs(primaryRow.centerOffset)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await testInfo.attach('projects-hierarchy-mobile.png', {
      body: await page.screenshot({ animations: 'disabled' }), contentType: 'image/png'
    });
  } finally {
    await context.close();
  }
});

test('导航与文章模板图标在 Browser/Desktop 下只保留外层容器', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '固定桌面内容视口');
  test.setTimeout(120_000);
  for (const theme of ['dark', 'light'] as const) {
    const results = [];
    for (const platform of ['browser', 'desktop'] as const) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        colorScheme: theme,
        reducedMotion: 'reduce',
        deviceScaleFactor: 1
      });
      const page = await context.newPage();
      if (platform === 'desktop') await installDesktopBridge(page);
      try {
        await runtime.openApp(page);
        await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
        const sidebar = page.locator('.opencreator-sidebar');
        const measurements = [];
        for (const collapsed of [false, true]) {
          if (collapsed) await sidebar.locator('.sidebar-collapse-button').click();
          await expect(sidebar).toHaveAttribute('data-collapsed', String(collapsed));
          for (const label of ['工作台', '我的项目', '设置']) {
            const button = sidebar.getByRole('button', { name: label, exact: true });
            await button.click();
            await expect(button).toHaveAttribute('aria-current', 'page');
            for (const hovered of [false, true]) {
              if (hovered) await button.hover();
              else await page.mouse.move(700, 0);
              await button.evaluate(button => Promise.all(
                button.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => undefined))
              ));
              const styles = await button.evaluate(button => {
                const icon = button.querySelector('.sidebar-nav-icon')!;
                const style = getComputedStyle(icon);
                const box = icon.getBoundingClientRect();
                return {
                  iconBackground: style.backgroundColor,
                  iconBorder: style.borderTopWidth,
                  iconShadow: style.boxShadow,
                  iconColor: style.color,
                  rowBackground: getComputedStyle(button).backgroundColor,
                  width: box.width,
                  height: box.height
                };
              });
              expect(styles.iconBackground).toBe('rgba(0, 0, 0, 0)');
              expect(styles.iconBorder).toBe('0px');
              expect(styles.iconShadow).toBe('none');
              expect(styles.rowBackground).not.toBe('rgba(0, 0, 0, 0)');
              measurements.push({ label, collapsed, hovered, ...styles });
            }
          }
          await testInfo.attach(`single-nav-container-${platform}-${theme}-${collapsed}.png`, {
            body: await sidebar.screenshot({ animations: 'disabled' }), contentType: 'image/png'
          });
        }
        const created = await runtime.api<{ job: { id: string } }>('POST', '/creator/jobs', {
          projectId: runtime.projectId,
          templateId: 'wechat-article',
          state: { currentStep: 1, furthestStep: 1 }
        });
        await page.goto(`${runtime.origin}/#/workbench?tool=wechat-article&jobId=${created.job.id}`);
        await expect(page.locator('.wechat-template-inline-list > button').first()).toBeVisible();
        await expectUnframedTemplateIcons(page, '.wechat-template-inline-list > button > span');
        await page.getByRole('button', { name: '查看全部模板', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '文章模板库' })).toBeVisible();
        await page.locator('.wechat-template-grid > button').first().click();
        await expectUnframedTemplateIcons(page, '.wechat-template-grid > button > span');
        results.push(measurements);
      } finally {
        await context.close();
      }
    }
    expect(results[1]).toEqual(results[0]);
  }
});

async function expectUnframedTemplateIcons(page: import('@playwright/test').Page, selector: string): Promise<void> {
  const icons = page.locator(selector);
  expect(await icons.count()).toBeGreaterThan(0);
  const styles = await icons.evaluateAll(icons => icons.map(icon => {
    const style = getComputedStyle(icon);
    return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
  }));
  for (const style of styles) {
    expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
  }
}

test('通用界面设置在 Browser/Desktop Bridge 下读取并写入相同 Runtime 配置', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    theme: string | undefined;
    accent: string | undefined;
    lightSelected: string | null;
    permission: string;
    language: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    await runtime.api('PATCH', '/settings/ui', {
      language: 'zh-CN',
      colorMode: 'light',
      accentColor: 'red',
      customAccentColor: '#3b82f6',
      defaultPermission: 'workspace-write'
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    const requests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.endsWith('/settings/ui')) return;
      requests.push(
        `${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`
      );
    });

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/settings`);

      const settings = page
        .getByRole('region', { name: 'OpenCreator 工作区' })
        .getByRole('main');
      const lightButton = settings.getByRole('button', { name: '浅色' });
      const permission = settings.getByRole('combobox', { name: '默认权限' });
      const language = settings.getByRole('combobox', { name: '显示语言' });
      await expect(lightButton).toHaveAttribute('aria-pressed', 'true');
      await expect(permission).toHaveValue('workspace-write');
      await expect(language).toHaveValue('zh-CN');
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
      await expect(page.locator('html')).toHaveAttribute('data-accent', 'red');
      await settings.getByRole('button', { name: '深色' }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect.poll(async () => (
        await runtime.api<{
          settings: { colorMode: string };
        }>('GET', '/settings/ui')
      ).settings.colorMode).toBe('dark');

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['light-button', lightButton],
        ['permission', permission],
        ['language', language]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      results.push({
        theme: await page.locator('html').getAttribute('data-theme') ?? undefined,
        accent: await page.locator('html').getAttribute('data-accent') ?? undefined,
        lightSelected: await lightButton.getAttribute('aria-pressed'),
        permission: await permission.inputValue(),
        language: await language.inputValue(),
        boxes,
        requests
      });
    } finally {
      await context.close();
    }
  }

  expect({
    ...results[1],
    requests: normalizeParityRequests(results[1]!.requests)
  }).toEqual({
    ...results[0],
    requests: normalizeParityRequests(results[0]!.requests)
  });
  expect(results[0]!.requests).toContain('GET /settings/ui');
  expect(results[0]!.requests).toContain('PATCH /settings/ui');
});

test('视频下载在 Browser/Desktop Bridge 下保持相同界面、请求和持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const created = await runtime.api<{
    job: { id: string; state: Record<string, unknown> };
  }>('POST', '/creator/jobs', {
    projectId: runtime.projectId,
    templateId: 'video-download',
    creationKey: 'parity-video-download',
    state: {
      sourceUrl: 'https://www.youtube.com/watch?v=OpenCreatorParity'
    }
  });
  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
    state: Record<string, unknown>;
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);

    try {
      await runtime.openApp(page);
      const requests: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.includes('/creator/')) return;
        requests.push(
          `${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`
        );
      });
      await page.goto(
        `${runtime.origin}/#/workbench?tool=video-download`
        + `&jobId=${encodeURIComponent(created.job.id)}`
      );

      const workspace = page.getByRole('region', { name: '视频下载 操作区' });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      await expect(workspace.getByRole('textbox', { name: '待下载视频链接' }))
        .toHaveValue('https://www.youtube.com/watch?v=OpenCreatorParity');
      await expect(panel).toContainText('YouTube · 待解析');

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['workspace', workspace],
        ['panel', panel],
        ['source-input', workspace.getByRole('textbox', { name: '待下载视频链接' })]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const persisted = await runtime.api<{
        job: { state: Record<string, unknown> };
      }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`);
      results.push({
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        boxes,
        requests,
        state: persisted.job.state
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect(normalizeParityRequests(results[1]!.requests))
    .toEqual(normalizeParityRequests(results[0]!.requests));
  expect(results[1]!.state).toEqual(results[0]!.state);
});

test('视频生成在 Browser/Desktop Bridge 下保持相同界面、请求和持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
    state: Record<string, unknown>;
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const created = await runtime.api<{
      job: { id: string; state: Record<string, unknown> };
    }>('POST', '/creator/jobs', {
      projectId: runtime.projectId,
      templateId: 'video-generation',
      creationKey: `parity-video-generation-${platform}`,
      state: {
        prompt: '雨夜中的未来城市，镜头平稳向前推进',
        provider: 'seedance',
        model: 'doubao-seedance-2-0-260128',
        size: '1280x720',
        duration: 5,
        currentStep: 1,
        furthestStep: 1
      }
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);

    try {
      await runtime.openApp(page);
      const requests: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.includes('/creator/')) return;
        requests.push(
          `${request.method()} ${url.pathname
            .replace('/.opencreator/runtime', '')
            .replace(created.job.id, '{jobId}')}`
        );
      });
      await page.goto(
        `${runtime.origin}/#/workbench?tool=video-generation`
        + `&jobId=${encodeURIComponent(created.job.id)}`
      );

      const workspace = page.getByRole('region', { name: '视频生成 操作区' });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      const provider = workspace.getByRole('combobox', { name: '视频服务' });
      const model = workspace.getByRole('combobox', { name: '模型版本' });
      const format = workspace.getByRole('combobox', { name: '画幅' });
      const duration = workspace.getByRole('combobox', { name: '视频时长' });
      await expect(provider).toHaveValue('seedance');
      await expect(model).toHaveValue('doubao-seedance-2-0-260128');
      await expect(format).toHaveValue('1280x720');
      await expect(duration).toHaveValue('5');
      await provider.selectOption('veo');
      await expect(model).toHaveValue('veo-3.1-generate-preview');
      await format.selectOption('720x1280');
      await duration.selectOption('8');

      await expect.poll(async () => (
        await runtime.api<{
          job: { state: Record<string, unknown> };
        }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`)
      ).job.state).toMatchObject({
        prompt: '雨夜中的未来城市，镜头平稳向前推进',
        provider: 'veo',
        model: 'veo-3.1-generate-preview',
        size: '720x1280',
        duration: 8,
        currentStep: 1,
        furthestStep: 1
      });
      await expect(panel).toContainText('竖屏 · 8s');

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['workspace', workspace],
        ['panel', panel],
        ['provider', provider],
        ['model', model],
        ['format', format],
        ['duration', duration]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const persisted = await runtime.api<{
        job: { state: Record<string, unknown> };
      }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`);
      results.push({
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        boxes,
        requests,
        state: persisted.job.state
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect(normalizeParityRequests(results[1]!.requests))
    .toEqual(normalizeParityRequests(results[0]!.requests));
  expect(results[1]!.state).toEqual(results[0]!.state);
});

test('小红书帖子在 Browser/Desktop Bridge 下保持相同界面、请求和持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
    state: Record<string, unknown>;
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const created = await runtime.api<{
      job: { id: string };
    }>('POST', '/creator/jobs', {
      projectId: runtime.projectId,
      templateId: 'xiaohongshu-post'
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);

    try {
      await runtime.openApp(page);
      const requests: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.includes('/creator/')) return;
        requests.push(
          `${request.method()} ${url.pathname
            .replace('/.opencreator/runtime', '')
            .replace(created.job.id, '{jobId}')}`
        );
      });
      await page.goto(
        `${runtime.origin}/#/workbench?tool=xiaohongshu-post`
        + `&jobId=${encodeURIComponent(created.job.id)}`
      );

      const workspace = page.getByRole('region', { name: '小红书帖子生成器 操作区' });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      const topic = workspace.getByRole('textbox', { name: '小红书帖子主题或素材' });
      await topic.fill('第一次参与开源项目的真实过程');
      await workspace.getByRole('radio', { name: '教程干货' }).click();
      await workspace.getByRole('radio', { name: '精简' }).click();

      await expect.poll(async () => (
        await runtime.api<{
          job: { state: Record<string, unknown> };
        }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`)
      ).job.state).toMatchObject({
        topic: '第一次参与开源项目的真实过程',
        style: 'tutorial',
        length: 'short'
      });

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['workspace', workspace],
        ['panel', panel],
        ['topic', topic]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const persisted = await runtime.api<{
        job: { state: Record<string, unknown> };
      }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`);
      results.push({
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        boxes,
        requests,
        state: persisted.job.state
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect(normalizeParityRequests(results[1]!.requests))
    .toEqual(normalizeParityRequests(results[0]!.requests));
  expect(results[1]!.state).toEqual(results[0]!.state);
});

test('本地 Whisper 在 Browser/Desktop Bridge 下遵守相同 Runtime 能力并保持持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
    transcription: Record<string, unknown>;
  }> = [];

  const capabilities = await runtime.api<CreatorServicesCapabilitiesResponse>('GET', '/creator-services/capabilities');
  const localProvider = capabilities.transcription.providers.find(provider => provider.kind === 'local' && provider.available);

  for (const platform of ['browser', 'desktop'] as const) {
    await runtime.api('DELETE', '/creator-services/config');
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    const requests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.includes('/creator-services/')) return;
      requests.push(`${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`);
    });

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/settings?tab=ai-services&section=transcription`);
      const settings = page
        .getByRole('region', { name: 'OpenCreator 工作区' })
        .getByRole('main');
      const localMode = settings.getByRole('button', { name: '本地 Whisper' });
      if (localProvider) {
        await expect(localMode).toBeEnabled();
        await localMode.click();
      } else {
        await expect(localMode).toBeDisabled();
      }

      const provider = settings.getByRole('combobox', { name: '语音识别服务' });
      const model = settings.getByRole('combobox', { name: '本地模型' });
      if (localProvider) {
        await expect(provider).toHaveText(localProvider.provider === 'whisper.cpp' ? 'Whisper.cpp' : 'WhisperKit');
        if (localProvider.provider === 'whisper.cpp') {
          await expect(model).toHaveText('tiny');
          await model.click();
          await settings.getByRole('option', { name: 'medium' }).click();
        }
        await settings.getByRole('button', { name: '保存配置' }).click();
        await page.getByRole('button', { name: '保存并启用' }).click();
        await expect(settings.getByText('配置已安全保存')).toBeVisible();
      }

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['settings', settings],
        ['local-mode', localMode],
        ['provider', provider],
        ...(localProvider ? [['model', model] as const] : [])
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const persisted = await runtime.api<{
        config: { transcription: Record<string, unknown> };
      }>('GET', '/creator-services/config');
      results.push({
        text: normalizeParityText(await settings.innerText()),
        boxes,
        requests,
        transcription: persisted.config.transcription
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect([...results[1]!.requests].sort()).toEqual([...results[0]!.requests].sort());
  expect(results[1]!.transcription).toEqual(results[0]!.transcription);
  if (localProvider) {
    expect(results[0]!.transcription.provider).toBe(localProvider.provider);
    if (localProvider.provider === 'whisper.cpp') {
      expect(results[0]!.transcription).toMatchObject({ whisperCpp: { model: 'medium' } });
    }
    expect(results[0]!.requests).toContain('PATCH /creator-services/config');
  } else {
    expect(results[0]!.requests).not.toContain('PATCH /creator-services/config');
  }
});

test('火山引擎语音识别设置在 Browser/Desktop Bridge 下保持相同请求和持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{ text: string; requests: string[]; configuredCredentials: string[] }> = [];
  for (const platform of ['browser', 'desktop'] as const) {
    await runtime.api('DELETE', '/creator-services/config');
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    const requests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.includes('/creator-services/')) return;
      requests.push(`${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`);
    });

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/settings?tab=ai-services&section=transcription`);
      await page.getByRole('combobox', { name: '语音识别服务' }).click();
      await page.getByRole('option', { name: '火山引擎' }).click();
      await page.getByLabel('App ID').fill('parity-volcengine-app');
      await page.getByLabel('Access Token').fill('parity-volcengine-token');
      await page.getByRole('button', { name: '保存配置' }).click();
      await expect(page.getByText('配置已安全保存')).toBeVisible();

      const saved = await runtime.api<{
        config: { transcription: { provider: string; volcengine: { appId: string; accessToken: string } } };
        configuredCredentials: string[];
      }>('GET', '/creator-services/config');
      results.push({
        text: await page.getByRole('tabpanel').innerText(),
        requests,
        configuredCredentials: saved.configuredCredentials
      });
      expect(saved.config.transcription).toMatchObject({
        provider: 'volcengine',
        volcengine: { appId: '', accessToken: '' }
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(normalizeParityRequests(results[1]!.requests))
    .toEqual(normalizeParityRequests(results[0]!.requests));
  expect(results[1]!.configuredCredentials.sort())
    .toEqual(results[0]!.configuredCredentials.sort());
  expect(results[0]!.requests).toContain('PATCH /creator-services/config');
  expect(results[0]!.configuredCredentials).toEqual(expect.arrayContaining([
    'transcription.volcengine.appId',
    'transcription.volcengine.accessToken'
  ]));
});

test('短视频脚本在 Browser/Desktop Bridge 下保持相同界面、请求和持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
    state: Record<string, unknown>;
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const created = await runtime.api<{
      job: { id: string };
    }>('POST', '/creator/jobs', {
      projectId: runtime.projectId,
      templateId: 'short-video-script'
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);

    try {
      await runtime.openApp(page);
      const requests: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.includes('/creator/')) return;
        requests.push(
          `${request.method()} ${url.pathname
            .replace('/.opencreator/runtime', '')
            .replace(created.job.id, '{jobId}')}`
        );
      });
      await page.goto(
        `${runtime.origin}/#/workbench?tool=short-video-script`
        + `&jobId=${encodeURIComponent(created.job.id)}`
      );

      const workspace = page.getByRole('region', { name: '短视频脚本生成器 操作区' });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      const topic = workspace.getByRole('textbox', { name: '短视频脚本主题或素材' });
      const platformSelect = workspace.getByRole('combobox', { name: '发布平台或场景' });
      const duration = workspace.getByRole('spinbutton', { name: '目标时长（秒）' });
      const tone = workspace.getByRole('combobox', { name: '表达语气' });
      await topic.fill('第一次参与开源项目的真实过程');
      await platformSelect.selectOption('bilibili');
      await duration.fill('90');
      await tone.selectOption('professional');

      await expect.poll(async () => (
        await runtime.api<{
          job: { state: Record<string, unknown> };
        }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`)
      ).job.state).toMatchObject({
        topic: '第一次参与开源项目的真实过程',
        platform: 'bilibili',
        targetDurationSeconds: 90,
        tone: 'professional'
      });

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['workspace', workspace],
        ['panel', panel],
        ['topic', topic],
        ['platform', platformSelect],
        ['duration', duration],
        ['tone', tone]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const persisted = await runtime.api<{
        job: { state: Record<string, unknown> };
      }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`);
      results.push({
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        boxes,
        requests,
        state: persisted.job.state
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect([...results[1]!.requests].sort()).toEqual([...results[0]!.requests].sort());
  expect(results[1]!.state).toEqual(results[0]!.state);
});

test('视频切片在 Browser/Desktop Bridge 下保持相同界面、请求和持久状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
    state: Record<string, unknown>;
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const created = await runtime.api<{
      job: { id: string };
    }>('POST', '/creator/jobs', {
      projectId: runtime.projectId,
      templateId: 'auto-clip',
      state: {
        sourceUrl: 'https://example.com/watch/opencreator-parity'
      }
    });
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);

    try {
      await runtime.openApp(page);
      const requests: string[] = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (!url.pathname.includes('/creator/')) return;
        requests.push(
          `${request.method()} ${url.pathname
            .replace('/.opencreator/runtime', '')
            .replace(encodeURIComponent(created.job.id), ':jobId')}`
        );
      });
      await page.goto(
        `${runtime.origin}/#/workbench?tool=auto-clips`
        + `&jobId=${encodeURIComponent(created.job.id)}`
      );

      const workspace = page.getByRole('region', { name: '视频切片 操作区' });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      await expect(workspace.getByRole('button', { name: '下一步：切片设置' }))
        .toBeEnabled();
      await workspace.getByRole('button', { name: '下一步：切片设置' }).click();
      await workspace.getByRole('combobox', { name: '内容重点' }).selectOption('viral');
      await workspace.getByRole('combobox', { name: '目标时长' }).selectOption('30-60');
      await workspace.getByRole('spinbutton', { name: '切片数量' }).fill('6');
      await workspace.getByRole('combobox', { name: '输出画幅' }).selectOption('1:1');
      await expect(workspace.getByLabel('任务摘要')).toContainText('传播潜力优先');
      await expect(workspace.getByLabel('任务摘要')).toContainText('切片数量6');

      await expect.poll(async () => (
        await runtime.api<{
          job: { state: Record<string, unknown> };
        }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`)
      ).job.state).toMatchObject({
        sourceUrl: 'https://example.com/watch/opencreator-parity',
        focus: 'viral',
        duration: '30-60',
        clipCount: 6,
        aspectRatio: '1:1'
      });

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['workspace', workspace],
        ['panel', panel],
        ['focus', workspace.getByRole('combobox', { name: '内容重点' })],
        ['aspect-ratio', workspace.getByRole('combobox', { name: '输出画幅' })]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const saved = await runtime.api<{
        job: { state: Record<string, unknown> };
      }>('GET', `/creator/jobs/${encodeURIComponent(created.job.id)}`);
      results.push({
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        boxes,
        requests,
        state: saved.job.state
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect([...results[1]!.requests].sort()).toEqual([...results[0]!.requests].sort());
  expect(results[1]!.state).toEqual(results[0]!.state);
  expect(results[0]!.requests).toContain('POST /creator/jobs/:jobId/actions');
});

test('第三方组件设置在 Browser/Desktop Bridge 下保持相同状态、尺寸和 Runtime 请求', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    text: string;
    boxes: Record<string, { x: number; y: number; width: number; height: number }>;
    requests: string[];
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    const requests: string[] = [];
    page.on('request', request => {
      const url = new URL(request.url());
      if (!url.pathname.includes('/creator/yt-dlp/')) return;
      requests.push(
        `${request.method()} ${url.pathname.replace('/.opencreator/runtime', '')}`
      );
    });
    await page.route('**/.opencreator/runtime/creator/yt-dlp/status', route => route.fulfill({
      json: {
        ytDlp: {
          channel: 'nightly',
          source: 'bundled',
          currentVersion: '2026.08.29.232711',
          bundledVersion: '2026.08.29.232711',
          latestVersion: null,
          updateAvailable: false,
          checkDue: false,
          lastCheckedAt: null,
          lastCheckAttemptAt: null,
          installedAt: null
        }
      } satisfies CreatorYtDlpStatusResponse
    }));

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/settings?tab=local-components`);

      const settings = page
        .getByRole('region', { name: 'OpenCreator 工作区' })
        .getByRole('main');
      const component = settings.locator('.runtime-component-item');
      await expect(settings.getByRole('heading', { name: '第三方组件' })).toBeVisible();
      await expect(component.getByRole('heading', { name: 'yt-dlp nightly' })).toBeVisible();
      await expect(component).toContainText('用于解析和下载 YouTube、Bilibili 等公开视频资源。');

      const boxes: Record<
        string,
        { x: number; y: number; width: number; height: number }
      > = {};
      for (const [name, locator] of [
        ['settings', settings],
        ['component', component],
        ['check-button', component.getByRole('button', { name: '检查更新' })]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box, `${platform} 缺少 ${name} 尺寸目标`).not.toBeNull();
        boxes[name] = {
          x: Math.round(box!.x),
          y: Math.round(box!.y),
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      results.push({
        text: normalizeParityText(await settings.innerText()),
        boxes,
        requests
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.boxes).toEqual(results[0]!.boxes);
  expect(normalizeParityRequests(results[1]!.requests))
    .toEqual(normalizeParityRequests(results[0]!.requests));
  expect(results[0]!.requests).toContain('GET /creator/yt-dlp/status');
});

test('工作台模块新建 Creator Job，刷新和最近项目精确恢复历史且不启动普通 Codex Run', async ({ page, runtime }) => {
  await page.route(
    /^https:\/\/i\.ytimg\.com\/vi\/OpenCreator(?:Demo|Second)\/maxresdefault\.jpg$/,
    route => route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aL1sAAAAASUVORK5CYII=',
        'base64'
      )
    })
  );
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();

  await page.getByRole('button', { name: /^视频下载/ }).click();
  const input = page.getByRole('textbox', { name: '待下载视频链接' });
  await expect(input).toBeVisible();
  await input.fill('https://www.youtube.com/watch?v=OpenCreatorDemo');
  await expect(page).toHaveURL(/#\/workbench\?tool=video-download&jobId=creator_job_/);
  const firstJobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(firstJobId).toBeTruthy();

  await expect(page.getByRole('complementary', { name: 'OpenCreator' }))
    .toContainText('YouTube');
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ id: string; templateId: string; state: Record<string, unknown> }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.find(job => job.id === decodeURIComponent(firstJobId!))?.state.sourceUrl;
  }).toBe('https://www.youtube.com/watch?v=OpenCreatorDemo');
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ templateId: string }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.filter(job => job.templateId === 'video-download').length;
  }).toBe(1);
  expect(runtime.readInvocationCount()).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '视频下载' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '待下载视频链接' }))
    .toHaveValue('https://www.youtube.com/watch?v=OpenCreatorDemo');

  await page.getByRole('region', { name: '视频下载 操作区' })
    .getByRole('button', { name: '返回', exact: true })
    .click();
  await page.getByRole('button', { name: /^视频下载/ }).click();
  await expect(page.getByRole('textbox', { name: '待下载视频链接' })).toHaveValue('');
  await page.getByRole('textbox', { name: '待下载视频链接' })
    .fill('https://www.youtube.com/watch?v=OpenCreatorSecond');
  await expect(page).toHaveURL(/#\/workbench\?tool=video-download&jobId=creator_job_/);
  const secondJobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(secondJobId).toBeTruthy();
  expect(decodeURIComponent(secondJobId!)).not.toBe(decodeURIComponent(firstJobId!));
  await expect.poll(async () => {
    const listed = await runtime.api<{
      jobs: Array<{ templateId: string }>;
    }>('GET', `/creator/jobs?projectId=${encodeURIComponent(runtime.projectId)}`);
    return listed.jobs.filter(job => job.templateId === 'video-download').length;
  }).toBe(2);

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('button', { name: '打开项目 youtube.com · OpenCreatorDemo' }).click();
  await expect(page).toHaveURL(new RegExp(`jobId=${firstJobId}`));
  await expect(page.getByRole('textbox', { name: '待下载视频链接' }))
    .toHaveValue('https://www.youtube.com/watch?v=OpenCreatorDemo');
});

test('图像生成在桌面和移动视口创建、持久化并从项目中心恢复 Creator Job', async ({
  page,
  runtime
}) => {
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await page.getByRole('button', { name: /^图像生成/ }).click();

  const prompt = '一间明亮的现代创意工作室，清晨自然光，真实摄影';
  await page.getByRole('textbox', { name: '提示词' }).fill(prompt);
  await expect(page).toHaveURL(/#\/workbench\?tool=image-generation&jobId=creator_job_/);
  await page.getByRole('button', { name: '继续', exact: true }).click();
  await expect(page.getByRole('radio', { name: '本机 Codex 生图', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '4 张', exact: true })).toHaveCount(0);
  await page.getByRole('radio', { name: 'GPT Image', exact: true }).click();
  await page.getByRole('radio', { name: /横向/ }).click();
  await page.getByRole('radio', { name: '高清', exact: true }).click();
  await page.getByRole('radio', { name: '4 张', exact: true }).click();

  const jobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(jobId).toBeTruthy();
  await expect.poll(async () => {
    const response = await runtime.api<{
      job: { state: Record<string, unknown> };
    }>('GET', `/creator/jobs/${decodeURIComponent(jobId!)}`);
    return response.job.state;
  }).toMatchObject({
    prompt,
    provider: 'openai',
    size: '1536x1024',
    quality: 'high',
    candidateCount: 4,
    currentStep: 1,
    furthestStep: 1
  });
  expect(runtime.readInvocationCount()).toBe(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: '图像生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /横向/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: '高清', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '4 张', exact: true })).toBeChecked();

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('tab', { name: '图像设计' }).click();
  await page.getByRole('button', { name: `打开项目 ${prompt}` }).click();
  await expect(page).toHaveURL(new RegExp(`jobId=${jobId}`));
  await expect(page.getByRole('heading', { name: '图像生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: /横向/ })).toBeChecked();
  await expect(page.getByRole('radio', { name: '高清', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '4 张', exact: true })).toBeChecked();
});

test('封面生成在桌面和移动视口保持可操作并从项目中心恢复 Creator Job', async ({
  page,
  runtime
}) => {
  await runtime.openApp(page);
  await page.goto(`${runtime.origin}/#/workbench`);
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible();
  await page.getByRole('button', { name: /^封面生成/ }).click();

  const workspace = page.getByRole('region', { name: '封面生成 操作区' });
  const prompt = '人物主体清晰，明亮工作室，高对比构图，不生成文字';
  await workspace.getByRole('textbox', { name: '内容与补充要求' }).fill(prompt);
  await expect(page).toHaveURL(/#\/workbench\?tool=cover-generator&jobId=creator_job_/);
  await workspace.getByRole('button', { name: '继续', exact: true }).click();
  await workspace.getByRole('radio', { name: '9:16', exact: true }).click();
  await workspace.getByRole('radio', { name: '高清', exact: true }).click();

  const jobId = new URL(page.url()).hash.match(/jobId=([^&]+)/)?.[1];
  expect(jobId).toBeTruthy();
  await expect.poll(async () => {
    const response = await runtime.api<{
      job: { templateVersion: number; state: Record<string, unknown> };
    }>('GET', `/creator/jobs/${decodeURIComponent(jobId!)}`);
    return {
      templateVersion: response.job.templateVersion,
      state: response.job.state
    };
  }).toMatchObject({
    templateVersion: 2,
    state: {
      prompt,
      ratio: '9:16',
      quality: 'high',
      currentStep: 1,
      furthestStep: 1
    }
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    await page.evaluate(() => window.innerWidth)
  );

  await page.reload();
  await expect(page.getByRole('heading', { name: '封面生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '9:16', exact: true })).toBeChecked();
  await expect(page.getByRole('radio', { name: '高清', exact: true })).toBeChecked();

  await page.goto(`${runtime.origin}/#/projects`);
  await page.getByRole('tab', { name: '图像设计' }).click();
  await page.getByRole('button', { name: `打开项目 ${prompt}` }).click();
  await expect(page).toHaveURL(new RegExp(`jobId=${jobId}`));
  await expect(page.getByRole('heading', { name: '封面生成' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '9:16', exact: true })).toBeChecked();
});

test('Creator Preset 在 Browser/Desktop Bridge 下创建相同工作台状态', async ({
  browser,
  runtime
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium-desktop',
    '一致性规格内部固定创建 Browser/Desktop Chromium 上下文'
  );

  const results: Array<{
    home: {
      text: string;
      boxes: Record<string, { width: number; height: number }>;
    };
    request: Record<string, unknown>;
    route: string;
    text: string;
    job: {
      templateId: string;
      templateVersion: number;
      status: string;
      state: Record<string, unknown>;
      presetOrigin: Record<string, unknown> | null;
      stages: unknown[];
    };
  }> = [];

  for (const platform of ['browser', 'desktop'] as const) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce'
    });
    const page = await context.newPage();
    if (platform === 'desktop') await installDesktopBridge(page);
    let createRequest: Record<string, unknown> | undefined;
    page.on('request', request => {
      const url = new URL(request.url());
      if (
        request.method() === 'POST'
        && url.pathname.endsWith('/creator/jobs')
      ) {
        createRequest = request.postDataJSON() as Record<string, unknown>;
      }
    });

    try {
      await runtime.openApp(page);
      await page.goto(`${runtime.origin}/#/new`);
      await expect(page.getByRole('heading', { name: '精选模板' })).toBeVisible();
      await expect(page.getByText('需要帮你做点什么')).toHaveCount(0);
      await expect(page.getByRole('textbox', { name: '输入任务' })).toHaveCount(0);
      await expect(page.getByRole('tab', { name: '推荐' }))
        .toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tab', { name: '视频创作' })).toBeVisible();
      await expect(page.getByRole('tab', { name: '图像设计' })).toBeVisible();
      await page.getByRole('tab', { name: '图像设计' }).click();
      const presetButton = page.getByRole('button', {
        name: '查看食物爆炸拆解信息图模板详情'
      });
      await expect(presetButton).toHaveText('食物爆炸拆解信息图');
      await presetButton.scrollIntoViewIfNeeded();
      const cover = presetButton.locator('img');
      await expect.poll(async () => cover.evaluate(image => ({
        complete: image.complete,
        width: image.naturalWidth
      }))).toEqual({ complete: true, width: 1280 });
      const home = page.locator('.creator-dashboard');
      const boxes: Record<string, { width: number; height: number }> = {};
      for (const [name, locator] of [
        ['categories', page.getByRole('tablist', { name: '创作模板分类' })],
        ['first-template', presetButton]
      ] as const) {
        const box = await locator.boundingBox();
        expect(box).not.toBeNull();
        boxes[name] = {
          width: Math.round(box!.width),
          height: Math.round(box!.height)
        };
      }
      const homeSnapshot = {
        text: normalizeParityText(await home.innerText()),
        boxes
      };

      await presetButton.click();
      await page.getByRole('button', { name: '使用此模板', exact: true }).click();
      await expect(page).toHaveURL(/#\/workbench\?tool=image-generation&jobId=/);
      const route = new URL(page.url()).hash.slice(1);
      const jobId = new URL(route, runtime.origin).searchParams.get('jobId');
      expect(jobId).not.toBeNull();
      await expect.poll(() => createRequest).toBeDefined();
      const response = await runtime.api<{
        job: {
          templateId: string;
          templateVersion: number;
          status: string;
          state: Record<string, unknown>;
          presetOrigin: Record<string, unknown> | null;
          stages: unknown[];
        };
      }>('GET', `/creator/jobs/${encodeURIComponent(jobId!)}`);
      const workspace = page.getByRole('region', { name: /图像生成\s*操作区/ });
      const panel = page.getByRole('complementary', { name: 'OpenCreator' });
      await expect(workspace).toBeVisible();
      await expect(panel).toBeVisible();

      results.push({
        home: homeSnapshot,
        request: {
          ...createRequest!,
          creationKey: '{creationKey}'
        },
        route: route.replace(jobId!, '{jobId}'),
        text: normalizeParityText(
          `${await workspace.innerText()}\n${await panel.innerText()}`
        ),
        job: {
          templateId: response.job.templateId,
          templateVersion: response.job.templateVersion,
          status: response.job.status,
          state: response.job.state,
          presetOrigin: response.job.presetOrigin,
          stages: response.job.stages
        }
      });
    } finally {
      await context.close();
    }
  }

  expect(results[1]!.home).toEqual(results[0]!.home);
  expect(results[1]!.request).toEqual(results[0]!.request);
  expect(results[1]!.route).toBe(results[0]!.route);
  expect(results[1]!.text).toBe(results[0]!.text);
  expect(results[1]!.job).toEqual(results[0]!.job);
  expect(results[0]!.job).toMatchObject({
    templateId: 'image-generation',
    templateVersion: 2,
    status: 'draft',
    presetOrigin: {
      module: 'image-generation',
      id: 'exploded-food-infographic',
      version: 1,
      locale: 'zh-CN',
      title: '食物爆炸拆解信息图'
    },
    state: {
      prompt: expect.stringContaining('创建超写实的塔可'),
      size: '1024x1024'
    },
    stages: []
  });
});

async function installDesktopBridge(
  page: import('@playwright/test').Page,
  integratedTitleBar = false
): Promise<void> {
  await page.addInitScript((integratedTitleBar) => {
    const success = { ok: true as const };
    Object.defineProperty(window, 'opencreatorDesktop', {
      configurable: true,
      value: {
        kind: 'desktop',
        ...(integratedTitleBar ? { windowChrome: {
          integratedTitleBar: true,
          titleBarHeight: 38,
          trafficLightInset: 76
        } } : {}),
        readAppVersion: async () => '3.2.2',
        readConnectionConfig: async () => ({ baseUrl: '/.opencreator/runtime' }),
        subscribeConnectionConfig: () => () => undefined,
        restartRuntime: async () => success,
        selectCodexPath: async () => success,
        reloadWorkspace: async () => success,
        workspaceReady: () => undefined,
        readDesktopPreferences: async () => ({
          closeBehavior: 'hide' as const
        }),
        updateDesktopPreferences: async () => ({
          closeBehavior: 'hide' as const
        }),
        selectProjectDirectory: async () => null,
        resolveDroppedFilePath: () => null,
        openExternal: async () => undefined,
        revealPath: async () => success,
        notify: async () => undefined,
        configureBackgroundNotifications: async () => success,
        subscribeNavigation: () => () => undefined
      }
    });
  }, integratedTitleBar);
}

function normalizeParityText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeParityRequests(requests: string[]): string[] {
  return [...requests].sort();
}
