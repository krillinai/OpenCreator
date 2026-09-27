import { execFileSync, spawnSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { packagedExecutable } from './package-artifact.js';
import {
  closePackagedApp,
  launchPackagedApp,
  relaunchPackagedApp,
  type PackagedApp
} from './packaged-app.js';
const e2eDir = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(e2eDir, '..');
const fakeCodexScript = join(e2eDir, 'fixtures', 'fake-codex.mjs');
const fakeCodexLauncherSource = join(e2eDir, 'fixtures', 'fake-codex-launcher.go');
const fakeYtDlpScript = join(e2eDir, 'fixtures', 'fake-yt-dlp.mjs');
const fakeYtDlpLauncherSource = join(
  e2eDir,
  'fixtures',
  'fake-yt-dlp-launcher.go'
);
const OVERSIZED_WAVE_PCM_BYTES = 10 * 1024 * 1024 + 4096;
const OVERSIZED_WAVE_FILE_BYTES = OVERSIZED_WAVE_PCM_BYTES + 44;
test.describe.configure({ mode: 'serial' });

test('打包 App 的 YouTube 视频嵌入请求带有有效 HTTP 来源标识', async () => {
  const fixture = await launchCreatorDesktop({ width: 1180, height: 850 });
  try {
    await waitForWorkspace(fixture.app.page);
    const cdp = await fixture.app.page.context().newCDPSession(fixture.app.page);
    await cdp.send('Network.enable');
    const embedRequests = new Set<string>();
    let referer = '';
    cdp.on('Network.requestWillBeSent', event => {
      if (event.request.url.startsWith('https://www.youtube-nocookie.com/embed/')) {
        embedRequests.add(event.requestId);
      }
    });
    cdp.on('Network.requestWillBeSentExtraInfo', event => {
      if (embedRequests.has(event.requestId)) {
        referer = String(event.headers.Referer ?? event.headers.referer ?? '');
      }
    });
    await fixture.app.page.evaluate(() => {
      const frame = document.createElement('iframe');
      frame.title = 'YouTube embed verification';
      frame.src = 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE';
      document.body.append(frame);
    });
    await expect.poll(() => referer).toBe('https://github.com/krillinai/OpenCreator/');
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('工作台与滚动中的项目页保持相同内容边界', async () => {
  const fixture = await launchCreatorDesktop({ width: 1273, height: 985 });
  try {
    await waitForWorkspace(fixture.app.page);
    await fixture.app.page.getByRole('button', { name: '工作台', exact: true }).click();
    await expect(fixture.app.page.locator('.creator-tools-page')).toBeVisible();
    const workbench = await fixture.app.page.locator('.creator-tools-page').evaluate(scroller => ({
      right: Math.round(scroller.querySelector('.creator-tools-page-inner')!.getBoundingClientRect().right),
      gutter: scroller.offsetWidth - scroller.clientWidth
    }));
    await fixture.app.page.getByRole('button', { name: '我的项目', exact: true }).click();
    await expect(fixture.app.page.locator('.projects-page-inner')).toBeVisible();
    const projects = await fixture.app.page.locator('.projects-page').evaluate(scroller => {
      const filler = document.createElement('div');
      filler.style.height = '1600px';
      scroller.querySelector('.projects-page-inner')!.append(filler);
      return {
        right: Math.round(scroller.querySelector('.projects-page-inner')!.getBoundingClientRect().right),
        scrollable: scroller.scrollHeight > scroller.clientHeight,
        gutter: scroller.offsetWidth - scroller.clientWidth
      };
    });
    expect(projects.scrollable).toBe(true);
    expect(projects.gutter).toBe(workbench.gutter);
    expect(projects.right).toBe(workbench.right);
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的每个设置 Tab 与主页面保持相同右侧留白', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop({ width: 1181, height: 985 });
  try {
    await waitForWorkspace(fixture.app.page);
    await fixture.app.page.getByRole('button', { name: '设置', exact: true }).click();
    const nav = fixture.app.page.locator('.settings-nav > button');
    await expect(nav).toHaveCount(9);
    const boundsByTab = [];
    for (let index = 0; index < 9; index += 1) {
      await nav.nth(index).click();
      const section = fixture.app.page.locator('.settings-content > .settings-section');
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
      expect(bounds.left, `Tab ${index + 1}`).toBe(24);
      expect(
        Math.abs(bounds.right - bounds.gutter - 24),
        `Tab ${index + 1}`
      ).toBeLessThanOrEqual(1);
      boundsByTab.push(bounds);
      if (index < 2) {
        await fixture.app.page.screenshot({
          path: testInfo.outputPath(`settings-layout-${index + 1}.png`),
          animations: 'disabled'
        });
      }
    }
    expect(boundsByTab.every(bounds => JSON.stringify(bounds) === JSON.stringify(boundsByTab[0]))).toBe(true);
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的浅色窗口按钮区域与设置侧栏连续且保留标题栏拖拽', async ({}, testInfo) => {
  test.skip(process.platform !== 'darwin', '仅 macOS 使用集成原生标题栏');
  const fixture = await launchCreatorDesktop({ width: 980, height: 800 });
  try {
    await waitForWorkspace(fixture.app.page);
    await fixture.app.page.getByRole('button', { name: '工作台', exact: true }).click();
    await expect(fixture.app.page.locator('.creator-tools-page')).toBeVisible();
    expect(await fixture.app.page.evaluate(() => (
      typeof window.opencreatorDesktop?.setWindowColorMode
    ))).toBe('function');
    await expect(fixture.app.page.getByRole('group', { name: '窗口控制' }).getByRole('button')).toHaveCount(3);
    for (const action of ['close', 'minimize', 'zoom']) {
      const background = await fixture.app.page.locator(`.desktop-window-control-${action}`).evaluate(element =>
        getComputedStyle(element).backgroundColor
      );
      expect(background).not.toBe('rgba(0, 0, 0, 0)');
    }
    await expect.poll(() => fixture.app.page.evaluate(() => {
      const brand = document.querySelector('.sidebar-logo-lockup')!.getBoundingClientRect();
      const title = document.querySelector('.creator-tools-page-header h1')!.getBoundingClientRect();
      return Math.round((brand.top + brand.bottom - title.top - title.bottom) / 2);
    })).toBeGreaterThanOrEqual(-3);
    expect(await fixture.app.page.evaluate(() => {
      const brand = document.querySelector('.sidebar-logo-lockup')!.getBoundingClientRect();
      const title = document.querySelector('.creator-tools-page-header h1')!.getBoundingClientRect();
      return Math.round((brand.top + brand.bottom - title.top - title.bottom) / 2);
    })).toBeLessThanOrEqual(3);
    await fixture.app.page.getByRole('button', { name: '缩放窗口' }).click();
    await expect.poll(() => fixture.app.page.evaluate(() => window.innerWidth)).toBeGreaterThan(980);
    await fixture.app.page.getByRole('button', { name: '缩放窗口' }).click();
    await expect.poll(() => fixture.app.page.evaluate(() => window.innerWidth)).toBe(980);
    await fixture.app.page.getByRole('button', { name: '我的项目', exact: true }).click();
    await expect(fixture.app.page.getByRole('heading', { name: '我的项目' })).toBeVisible();
    await expect.poll(() => fixture.app.page.evaluate(() => {
      const brand = document.querySelector('.sidebar-logo-lockup')!.getBoundingClientRect();
      const title = document.querySelector('.projects-page-header h1')!.getBoundingClientRect();
      return Math.abs(Math.round((brand.top + brand.bottom - title.top - title.bottom) / 2));
    })).toBeLessThanOrEqual(3);
    await fixture.app.page.screenshot({
      path: testInfo.outputPath('projects-titlebar.png'),
      animations: 'disabled'
    });
    await fixture.app.page.getByRole('button', { name: '设置', exact: true }).click();
    await expect(fixture.app.page.getByRole('button', { name: '返回应用' })).toBeVisible();

    for (const [theme, label] of [['light', '浅色'], ['dark', '深色']] as const) {
      await fixture.app.page.getByRole('button', { name: label, exact: true }).click();
      await expect(fixture.app.page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await fixture.app.page.evaluate(() => {
        const pane = document.querySelector('.opencreator-main-pane')!;
        const settings = document.querySelector('.settings-page')!;
        const sidebar = document.querySelector('.settings-sidebar')!;
        const back = document.querySelector('.settings-back')!;
        const drag = document.querySelector('.desktop-titlebar-drag-region')!;
        return {
          panePaddingTop: getComputedStyle(pane).paddingTop,
          sidebarTop: Math.round(sidebar.getBoundingClientRect().top - settings.getBoundingClientRect().top),
          sidebarPaddingTop: getComputedStyle(sidebar).paddingTop,
          backTop: Math.round(back.getBoundingClientRect().top - settings.getBoundingClientRect().top),
          dragHeight: Math.round(drag.getBoundingClientRect().height)
        };
      })).toEqual({
        panePaddingTop: '0px',
        sidebarTop: 0,
        sidebarPaddingTop: '51px',
        backTop: 51,
        dragHeight: 38
      });
      await fixture.app.page.screenshot({
        path: testInfo.outputPath(`settings-titlebar-${theme}.png`),
        animations: 'disabled'
      });
    }
    await fixture.app.page.getByRole('button', { name: '返回应用' }).click();
    await expect(fixture.app.page.getByRole('button', { name: '工作台' })).toBeVisible();
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的黑白基准色固定且灰色不随强调色变化', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop({ width: 1280, height: 800 });
  try {
    await waitForWorkspace(fixture.app.page);
    for (const theme of ['dark', 'light'] as const) {
      const colors = [];
      for (const accent of ['red', 'blue', 'custom'] as const) {
        const values = await fixture.app.page.evaluate(({ theme, accent }) => {
          const root = document.documentElement;
          root.dataset.theme = theme;
          root.dataset.accent = accent;
          root.style.setProperty('--custom-accent-value', '#3b82f6');
          const surface = document.createElement('div');
          surface.style.backgroundColor = 'var(--surface-2)';
          document.body.append(surface);
          const result = {
            page: getComputedStyle(document.body).backgroundColor,
            text: getComputedStyle(document.body).color,
            sidebar: getComputedStyle(document.querySelector('.opencreator-sidebar-pane')!).backgroundColor,
            surface: getComputedStyle(surface).backgroundColor
          };
          surface.remove();
          return result;
        }, { theme, accent });
        expect(values.page).toBe(theme === 'dark' ? 'rgb(10, 10, 10)' : 'rgb(229, 229, 229)');
        expect(values.text).toBe(theme === 'dark' ? 'rgb(229, 229, 229)' : 'rgb(10, 10, 10)');
        colors.push(values);
        if (accent === 'red') {
          await fixture.app.page.screenshot({
            path: testInfo.outputPath(`accent-red-${theme}.png`),
            animations: 'disabled'
          });
        }
      }
      expect(colors[0]!.sidebar).toBe(colors[1]!.sidebar);
      expect(colors[0]!.surface).toBe(colors[1]!.surface);
      expect(colors[1]!.surface).toBe(colors[2]!.surface);
    }
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 导航和文章模板图标只保留外层容器', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop({ width: 1440, height: 900 });
  try {
    await waitForWorkspace(fixture.app.page);
    const sidebar = fixture.app.page.locator('.opencreator-sidebar');
    for (const collapsed of [false, true]) {
      if (collapsed) await sidebar.locator('.sidebar-collapse-button').click();
      await expect(sidebar).toHaveAttribute('data-collapsed', String(collapsed));
      for (const label of ['工作台', '我的项目', '设置']) {
        const button = sidebar.getByRole('button', { name: label, exact: true });
        await button.click();
        await expect(button).toHaveAttribute('aria-current', 'page');
        await button.hover();
        expect(await button.locator('.sidebar-nav-icon').evaluate(icon => {
          const style = getComputedStyle(icon);
          return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
        })).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
      }
      await fixture.app.page.screenshot({ path: testInfo.outputPath(`single-nav-container-${collapsed}.png`) });
    }
    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.app.page, 'GET', '/projects');
    const created = await runtimeRequest<{ job: { id: string } }>(fixture.app.page, 'POST', '/creator/jobs', {
      projectId: projects.body.projects[0]!.id,
      templateId: 'wechat-article',
      state: { currentStep: 1, furthestStep: 1 }
    });
    expect(created.status).toBe(201);
    await fixture.app.page.evaluate(jobId => {
      window.location.hash = `#/workbench?tool=wechat-article&jobId=${jobId}`;
    }, created.body.job.id);
    await expect(fixture.app.page.locator('.wechat-template-inline-list > button').first()).toBeVisible();
    await fixture.app.page.getByRole('button', { name: '查看全部模板', exact: true }).click();
    await expect(fixture.app.page.getByRole('dialog', { name: '文章模板库' })).toBeVisible();
    await fixture.app.page.locator('.wechat-template-grid > button').first().click();
    const icons = fixture.app.page.locator('.wechat-template-grid > button > span');
    expect(await icons.count()).toBeGreaterThan(0);
    for (const style of await icons.evaluateAll(icons => icons.map(icon => {
      const style = getComputedStyle(icon);
      return { background: style.backgroundColor, border: style.borderTopWidth, shadow: style.boxShadow };
    }))) {
      expect(style).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px', shadow: 'none' });
    }
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 的 Creator 设置页保留组件间距和下拉箭头内边距', async ({}, testInfo) => {
  const fixture = await launchCreatorDesktop({ width: 980, height: 1014 });
  try {
    await waitForWorkspace(fixture.app.page);
    await expect.poll(async () => (
      await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.app.page, 'GET', '/projects')
    ).body.projects.length).toBeGreaterThan(0);
    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.app.page, 'GET', '/projects');
    const created = await runtimeRequest<{ job: { id: string } }>(fixture.app.page, 'POST', '/creator/jobs', {
      projectId: projects.body.projects[0]!.id,
      templateId: 'stickman-video',
      state: { sourceType: 'url' }
    });
    expect(created.status).toBe(201);
    await fixture.app.page.evaluate(jobId => {
      window.location.hash = `#/workbench?tool=stickman-video&jobId=${jobId}`;
    }, created.body.job.id);
    await expect(fixture.app.page.locator('.stickman-style-summary')).toBeVisible();
    await expect.poll(() => fixture.app.page.locator('.stickman-story-panel').evaluate(panel => {
      const source = panel.querySelector(':scope > .creator-tool-field')!.getBoundingClientRect();
      const characters = panel.querySelector('.stickman-character-picker')!.getBoundingClientRect();
      const style = panel.querySelector('#stickman-visual-style')!.getBoundingClientRect();
      const duration = panel.querySelector('.stickman-duration-control select')!.getBoundingClientRect();
      return {
        sourceCharacterGap: Math.round(characters.top - source.bottom),
        selectTopDelta: Math.round(duration.top - style.top),
        arrowInsets: Array.from(panel.querySelectorAll('.native-select select')).map(select => (
          Math.round(select.getBoundingClientRect().right - select.parentElement!.querySelector('svg')!.getBoundingClientRect().right)
        )),
        textInsets: Array.from(panel.querySelectorAll('.native-select select')).map(select => getComputedStyle(select).paddingInlineEnd)
      };
    })).toEqual({ sourceCharacterGap: 16, selectTopDelta: 0, arrowInsets: [12, 12], textInsets: ['40px', '40px'] });
    await fixture.app.page.getByRole('combobox', { name: '目标时长' }).scrollIntoViewIfNeeded();
    await fixture.app.page.screenshot({ path: testInfo.outputPath('creator-settings-spacing-980.png') });
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('打包 App 在最小窗口宽度下保持 Creator 对话输入区贴底', async ({}, testInfo) => {
  test.setTimeout(90_000);
  for (const height of [1014, 680]) {
    const fixture = await launchCreatorDesktop({ width: 980, height });
    try {
      await waitForWorkspace(fixture.app.page);
      await expect.poll(async () => (
        await runtimeRequest<{ projects: Array<{ id: string }> }>(
          fixture.app.page, 'GET', '/projects'
        )
      ).body.projects.length).toBeGreaterThan(0);
      const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(
        fixture.app.page, 'GET', '/projects'
      );
      expect(projects.status).toBe(200);
      expect(projects.body.projects.length).toBeGreaterThan(0);
      const created = await runtimeRequest<{ job: { id: string } }>(
        fixture.app.page, 'POST', '/creator/jobs', {
          projectId: projects.body.projects[0]!.id,
          templateId: 'stickman-video',
          state: { sourceType: 'text' }
        }
      );
      expect(created.status).toBe(201);
      await fixture.app.page.evaluate(jobId => {
        window.location.hash = `#/workbench?tool=stickman-video&jobId=${jobId}`;
      }, created.body.job.id);
      await expect(fixture.app.page.getByRole('heading', { name: '火柴人动画' })).toBeVisible();
      await expect(fixture.app.page.getByRole('textbox', { name: '告诉 Agent 你的要求' })).toBeVisible();
      const preflightLayout = await fixture.app.page.evaluate(() => {
        const panel = document.querySelector('.creator-collaboration-panel')!;
        const list = panel.querySelector('.creator-collaboration-messages')!;
        const preflight = document.createElement('section');
        preflight.className = 'creator-collaboration-preflight';
        preflight.textContent = '启动前体检已通过，可以启动阶段。';
        panel.insertBefore(preflight, list);
        const gap = Math.round(list.getBoundingClientRect().top - preflight.getBoundingClientRect().bottom);
        const entryOffset = Math.round(list.firstElementChild!.getBoundingClientRect().top - list.getBoundingClientRect().top);
        preflight.remove();
        const message = document.createElement('article');
        message.className = 'creator-collaboration-message';
        message.dataset.role = 'user';
        const bubble = document.createElement('div');
        bubble.className = 'creator-collaboration-bubble';
        bubble.textContent = '测试消息';
        message.append(bubble);
        list.append(message);
        const outerBackground = getComputedStyle(message).backgroundColor;
        const outerPadding = getComputedStyle(message).padding;
        const bubbleBorder = getComputedStyle(bubble).borderStyle;
        message.remove();
        return { gap, entryOffset, outerBackground, outerPadding, bubbleBorder };
      });
      expect(preflightLayout.gap).toBeLessThanOrEqual(1);
      expect(preflightLayout.entryOffset).toBeLessThanOrEqual(24);
      expect(preflightLayout.outerBackground).toBe('rgba(0, 0, 0, 0)');
      expect(preflightLayout.outerPadding).toBe('0px');
      expect(preflightLayout.bubbleBorder).toBe('solid');
      await fixture.app.page.locator('.stickman-step-scroll').evaluate(element => {
        element.scrollTop = element.scrollHeight;
      });
      await expect.poll(() => fixture.app.page.evaluate(() => {
        const workspace = document.querySelector('.creator-workspace-layout')!.getBoundingClientRect();
        const main = document.querySelector('.creator-workspace-main')!.getBoundingClientRect();
        const panel = document.querySelector('.creator-collaboration-panel')!.getBoundingClientRect();
        const composer = document.querySelector('.creator-collaboration-panel .tool-agent-composer')!;
        return {
          width: window.innerWidth,
          panelRightOfMain: panel.left >= main.right - 1,
          panelVisible: panel.right <= window.innerWidth + 1,
          panelBottomDelta: Math.round(Math.abs(panel.bottom - window.innerHeight)),
          panelHeightDelta: Math.round(panel.height - workspace.height),
          composerBottomDelta: Math.round(Math.abs(
            composer.getBoundingClientRect().bottom
            + parseFloat(getComputedStyle(composer).marginBottom) - panel.bottom
          ))
        };
      })).toEqual({ width: 980, panelRightOfMain: true, panelVisible: true, panelBottomDelta: 0, panelHeightDelta: 0, composerBottomDelta: 0 });
      await fixture.app.page.screenshot({
        path: testInfo.outputPath(`creator-min-width-980-${height}.png`)
      });
    } finally {
      await closePackagedApp(fixture.app).catch(() => undefined);
      rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }
});

test('打包 App 在窄窗口下各 Creator 内页保持对话栏在右侧', async ({}, testInfo) => {
  test.setTimeout(120_000);
  const fixture = await launchCreatorDesktop({ width: 980, height: 680 });
  try {
    await waitForWorkspace(fixture.app.page);
    await expect.poll(async () => (
      await runtimeRequest<{ projects: Array<{ id: string }> }>(fixture.app.page, 'GET', '/projects')
    ).body.projects.length).toBeGreaterThan(0);
    const projects = await runtimeRequest<{ projects: Array<{ id: string }> }>(
      fixture.app.page, 'GET', '/projects'
    );

    for (const [tool, templateId] of [
      ['video-translation', 'video-translation'],
      ['image-generation', 'image-generation'],
      ['cover-generator', 'cover'],
      ['video-generation', 'video-generation'],
      ['short-video-script', 'short-video-script']
    ] as const) {
      const created = await runtimeRequest<{ job: { id: string } }>(
        fixture.app.page, 'POST', '/creator/jobs', {
          projectId: projects.body.projects[0]!.id,
          templateId,
          state: {}
        }
      );
      expect(created.status).toBe(201);
      await fixture.app.page.evaluate(({ tool, jobId }) => {
        window.location.hash = `#/workbench?tool=${tool}&jobId=${jobId}`;
      }, { tool, jobId: created.body.job.id });
      await expect(fixture.app.page.locator('.creator-collaboration-panel')).toBeVisible();
      await expect.poll(() => fixture.app.page.evaluate(() => {
        const main = document.querySelector('.creator-workspace-main, .video-translation-wizard-main')!.getBoundingClientRect();
        const panel = document.querySelector('.creator-collaboration-panel')!.getBoundingClientRect();
        return {
          beside: panel.left >= main.right - 1,
          visible: panel.right <= window.innerWidth + 1,
          fullHeight: Math.abs(panel.bottom - window.innerHeight) <= 1
        };
      })).toEqual({ beside: true, visible: true, fullHeight: true });
      await fixture.app.page.screenshot({ path: testInfo.outputPath(`creator-right-panel-${tool}.png`) });
    }
  } finally {
    await closePackagedApp(fixture.app).catch(() => undefined);
    rmSync(fixture.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test('@package-smoke 实际 Desktop 包创建并重启恢复 Creator Job，且使用内嵌 Runtime', async () => {
  test.setTimeout(240_000);
  const fixture = await launchCreatorDesktop();
  let currentApp: PackagedApp = fixture.app;

  try {
    await waitForWorkspace(currentApp.page);
    expect(currentApp.page.url()).toContain('opencreator-app://app/');
    await expect.poll(async () => (
      await currentApp.page.evaluate(() => window.opencreatorDesktop?.readBootstrapState())
    )?.codexHome).toBe(join(
      fixture.root,
      '.opencreator',
      'runtime',
      'external-codex'
    ));

    const runtimeRoot = packagedRuntimeRoot();
    const runtimeManifest = JSON.parse(
      readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8')
    ) as {
      platform: string;
      arch: string;
      ytDlp: {
        mode: 'python';
        version: string;
        pythonVersion: string;
        executable: string;
        script: string;
        certificateBundle: string;
      };
      resources: Array<{ path: string; kind: string }>;
    };
    expect(runtimeManifest).toMatchObject({
      platform: process.platform,
      arch: process.arch
    });
    expect(runtimeManifest.resources.map(resource => resource.path)).toEqual(
      expect.arrayContaining([
        executableResource('bin/krillinai-cli'),
        executableResource('bin/ffmpeg'),
        executableResource('bin/ffprobe'),
        runtimeManifest.ytDlp.executable,
        runtimeManifest.ytDlp.script,
        runtimeManifest.ytDlp.certificateBundle
      ])
    );
    expect(runtimeManifest.ytDlp).toMatchObject({
      mode: 'python',
      version: '2026.08.29.232711',
      pythonVersion: '3.13.15'
    });
    expect(runtimeManifest.resources.some(resource => (
      resource.path.endsWith('.pyc')
      || resource.path.includes('/__pycache__/')
    ))).toBe(false);
    const ytDlpStartup = packagedYtDlpVersion(runtimeRoot, runtimeManifest.ytDlp);
    expect(ytDlpStartup.version).toBe(runtimeManifest.ytDlp.version);
    expect(ytDlpStartup.elapsedMs).toBeLessThan(10_000);
    expect(containsPythonBytecodeCache(
      join(runtimeRoot, 'yt-dlp-runtime', 'python')
    )).toBe(false);
    expect(runtimeManifest.resources.some(resource => resource.kind === 'model')).toBe(false);
    expect(runtimeManifest.resources.some(resource => /whisper/i.test(resource.path))).toBe(false);
    expect(hasWhisperKitDependency(fixture.root)).toBe(false);
    expect(packagedCreatorAgentRuntimeFiles()).toEqual([
      'SKILL.md',
      'manifest.json'
    ]);
    const stickmanRuntimeRoot = packagedStickmanRuntimeRoot();
    const stickmanRuntimeManifest = JSON.parse(
      readFileSync(join(stickmanRuntimeRoot, 'manifest.json'), 'utf8')
    ) as {
      platform: string;
      arch: string;
      remotionVersion: string;
      chromiumVersion: string;
      browserExecutable: string;
      resources: Array<{ path: string; kind: string; platform: string; arch: string }>;
    };
    expect(stickmanRuntimeManifest).toMatchObject({
      platform: process.platform,
      arch: process.arch,
      remotionVersion: '4.0.473',
      browserExecutable: executableResource('browser/chrome-headless-shell')
    });
    expect(stickmanRuntimeManifest.chromiumVersion).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
    expect(stickmanRuntimeManifest.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: stickmanRuntimeManifest.browserExecutable,
        kind: 'browser',
        platform: process.platform,
        arch: process.arch
      }),
      expect.objectContaining({
        path: 'fonts/NotoSansSC-Bold.woff2',
        kind: 'font',
        platform: process.platform,
        arch: process.arch
      }),
      expect.objectContaining({
        path: 'visual-assets/catalog.json',
        kind: 'visual-asset',
        platform: process.platform,
        arch: process.arch
      })
    ]));

    const projectDir = join(fixture.root, 'creator-workspace');
    mkdirSync(projectDir, { recursive: true });
    const createdProject = await runtimeRequest<{
      project: { id: string };
    }>(currentApp.page, 'POST', '/projects', {
      cwd: projectDir,
      name: 'Creator 打包态验证',
      sandbox: 'workspace-write'
    });
    expect(createdProject.status).toBe(201);

    const templates = await runtimeRequest<{
      templates: Array<{ id: string }>;
    }>(currentApp.page, 'GET', '/creator/templates');
    expect(templates.status).toBe(200);
    expect(templates.body.templates.map(template => template.id)).toEqual(
      expect.arrayContaining([
        'video-translation',
        'video-download',
        'cover',
        'image-generation',
        'auto-clip',
        'stickman-video'
      ])
    );
    const presets = await runtimeRequest<{
      presets: Array<{ previewVideoUrl?: string }>;
    }>(currentApp.page, 'GET', '/creator/presets?locale=zh-CN');
    const previewVideoUrl = presets.body.presets.find(
      preset => preset.previewVideoUrl !== undefined
    )?.previewVideoUrl;
    expect(previewVideoUrl).toMatch(/^\/creator-presets\/[a-f0-9]{64}\.mp4$/);
    const packagedVideo = await currentApp.page.evaluate(async videoUrl => {
      const rangeResponse = await fetch(videoUrl, {
        headers: { Range: 'bytes=0-31' }
      });
      const range = {
        status: rangeResponse.status,
        contentType: rangeResponse.headers.get('content-type'),
        acceptRanges: rangeResponse.headers.get('accept-ranges'),
        contentRange: rangeResponse.headers.get('content-range'),
        bytes: (await rangeResponse.arrayBuffer()).byteLength
      };
      const video = document.createElement('video');
      video.muted = true;
      video.preload = 'auto';
      video.src = videoUrl;
      document.body.append(video);
      try {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(
            () => reject(new Error('Timed out loading packaged preset video')),
            15_000
          );
          video.addEventListener('canplay', () => {
            window.clearTimeout(timeout);
            resolve();
          }, { once: true });
          video.addEventListener('error', () => {
            window.clearTimeout(timeout);
            reject(new Error(`Packaged preset video failed with code ${video.error?.code ?? 0}`));
          }, { once: true });
          video.load();
        });
        await video.play();
        await new Promise(resolve => window.setTimeout(resolve, 250));
        return {
          range,
          duration: video.duration,
          currentTime: video.currentTime,
          paused: video.paused
        };
      } finally {
        video.pause();
        video.remove();
      }
    }, previewVideoUrl!);
    expect(packagedVideo.range).toMatchObject({
      status: 206,
      contentType: 'video/mp4',
      acceptRanges: 'bytes',
      bytes: 32
    });
    expect(packagedVideo.range.contentRange).toMatch(/^bytes 0-31\/\d+$/);
    expect(packagedVideo.duration).toBeGreaterThan(0);
    expect(packagedVideo.currentTime).toBeGreaterThan(0);
    expect(packagedVideo.paused).toBe(false);
    const creatorCapabilities = await runtimeRequest<{
      platform: string;
      arch: string;
      transcription: {
        providers: Array<{
          provider: string;
          kind: 'cloud' | 'local';
          available: boolean;
          models: string[];
        }>;
      };
    }>(currentApp.page, 'GET', '/creator-services/capabilities');
    expect(creatorCapabilities.status).toBe(200);
    expect(creatorCapabilities.body).toMatchObject({
      platform: process.platform,
      arch: process.arch
    });
    const expectedLocalProviders = process.platform === 'darwin' && process.arch === 'arm64'
      ? ['whisperkit']
      : process.platform === 'win32' && process.arch === 'x64'
        ? ['whisper.cpp']
        : [];
    expect(creatorCapabilities.body.transcription.providers
      .filter(provider => provider.kind === 'local' && provider.available)
      .map(provider => provider.provider)).toEqual(expectedLocalProviders);
    const availableLocalProvider = creatorCapabilities.body.transcription.providers.find(
      provider => provider.kind === 'local' && provider.available
    );
    const ytDlpStatus = await runtimeRequest<{
      ytDlp: {
        channel: string;
        source: string;
        currentVersion: string;
        bundledVersion: string;
        latestVersion: string | null;
        updateAvailable: boolean;
      };
    }>(currentApp.page, 'GET', '/creator/yt-dlp/status');
    expect(ytDlpStatus.status).toBe(200);
    expect(ytDlpStatus.body.ytDlp).toMatchObject({
      channel: 'nightly',
      source: 'bundled',
      currentVersion: '2026.08.29.232711',
      bundledVersion: '2026.08.29.232711'
    });
    expect(typeof ytDlpStatus.body.ytDlp.updateAvailable).toBe('boolean');
    if (ytDlpStatus.body.ytDlp.updateAvailable) {
      expect(ytDlpStatus.body.ytDlp.latestVersion).not.toBeNull();
      expect(ytDlpStatus.body.ytDlp.latestVersion)
        .not.toBe(ytDlpStatus.body.ytDlp.currentVersion);
    }

    const aliyunVoices = await runtimeRequest<{
      provider: string;
      model: string;
      voices: Array<{ id: string; name: string }>;
    }>(
      currentApp.page,
      'GET',
      '/creator-services/tts/voices?provider=aliyun&model=qwen3-tts-flash'
    );
    expect(aliyunVoices.status).toBe(200);
    expect(aliyunVoices.body).toMatchObject({
      provider: 'aliyun',
      model: 'qwen3-tts-flash'
    });
    expect(aliyunVoices.body.voices.map(voice => voice.id)).toEqual(
      expect.arrayContaining(['Cherry', 'Kiki'])
    );

    await currentApp.page.getByRole('button', { name: '设置' }).click();
    await currentApp.page.getByRole('button', { name: 'AI 服务' }).click();
    await expect(currentApp.page.getByRole('heading', { name: 'AI 服务' })).toBeVisible();
    await expect(currentApp.page.getByRole('button', { name: 'Codex Agent' })).toHaveCount(0);
    await expect(currentApp.page.getByRole('tab', { name: '模型服务' }))
      .toHaveAttribute('aria-selected', 'true');
    await expect(currentApp.page.getByRole('group', { name: '模型服务' })).toBeVisible();
    await currentApp.page.getByRole('tab', { name: '语音识别' }).click();
    const localWhisper = currentApp.page.getByRole('button', { name: '本地 Whisper' });
    if (availableLocalProvider === undefined) {
      await expect(localWhisper).toBeDisabled();
    } else {
      await expect(localWhisper).toBeEnabled();
      await localWhisper.click();
      const providerLabel = availableLocalProvider.provider === 'whisperkit'
        ? 'WhisperKit'
        : 'Whisper.cpp';
      await expect(currentApp.page.getByRole('combobox', { name: '语音识别服务' }))
        .toHaveText(providerLabel);
      const expectedModel = availableLocalProvider.models[0];
      if (availableLocalProvider.provider === 'whisperkit') {
        await expect(currentApp.page.getByText(expectedModel, { exact: true })).toBeVisible();
      } else {
        await expect(currentApp.page.getByRole('combobox', { name: '本地模型' }))
          .toHaveText(expectedModel);
      }
    }
    await currentApp.page.getByRole('tab', { name: '配音服务' }).click();
    const providerSelect = currentApp.page.getByRole('combobox', { name: '服务商' });
    await expect(providerSelect).toHaveText('OpenAI TTS');
    await expect(currentApp.page.getByRole('combobox', { name: '默认音色' }))
      .toHaveValue('marin');
    await providerSelect.click();
    await currentApp.page.getByRole('option', { name: '阿里云百炼' }).click();
    await expect(currentApp.page.getByLabel('Base URL'))
      .toHaveValue('https://dashscope.aliyuncs.com/api/v1');
    await expect(currentApp.page.getByLabel('模型')).toHaveValue('qwen3-tts-flash');
    await expect.poll(async () => (
      currentApp.page.getByRole('combobox', { name: '默认音色' })
        .locator('option')
        .allTextContents()
    )).toEqual(expect.arrayContaining([
      expect.stringContaining('Cherry'),
      expect.stringContaining('Kiki')
    ]));

    await currentApp.page.getByRole('button', { name: '工作台' }).click();
    await expect(currentApp.page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await currentApp.page.getByRole('button', { name: /^图像生成/ }).click();
    await expect(currentApp.page.getByRole('heading', { name: '图像生成' })).toBeVisible();
    await expect(currentApp.page.getByRole('textbox', { name: '提示词' })).toBeVisible();

    await currentApp.page.locator('.creator-workspace-header').getByRole('button', { name: '返回' }).click();
    await expect(currentApp.page.getByRole('heading', { name: '工作台' })).toBeVisible();
    await currentApp.page.getByRole('button', { name: /^视频切片/ }).click();
    const clipWorkspace = currentApp.page.getByRole('region', { name: '视频切片 操作区' });
    await expect(clipWorkspace.getByRole('textbox', { name: '视频链接' })).toBeVisible();
    await clipWorkspace.getByRole('textbox', { name: '视频链接' })
      .fill('https://example.com/watch/packaged-auto-clip');
    await clipWorkspace.getByRole('button', { name: '下一步：切片设置' }).click();
    await clipWorkspace.getByRole('combobox', { name: '内容重点' }).selectOption('knowledge');
    await clipWorkspace.getByRole('combobox', { name: '目标时长' }).selectOption('30-60');
    await clipWorkspace.getByRole('spinbutton', { name: '切片数量' }).fill('8');
    await clipWorkspace.getByRole('combobox', { name: '输出画幅' }).selectOption('9:16');
    await expect(clipWorkspace.getByRole('combobox', { name: '内容重点' }))
      .toHaveValue('knowledge');
    await expect(clipWorkspace.getByRole('combobox', { name: '目标时长' }))
      .toHaveValue('30-60');
    await expect(clipWorkspace.getByRole('spinbutton', { name: '切片数量' }))
      .toHaveValue('8');
    await expect(clipWorkspace.getByRole('combobox', { name: '输出画幅' }))
      .toHaveValue('9:16');
    await expect.poll(() => new URL(currentApp.page.url()).hash.match(/jobId=([^&]+)/)?.[1]).toBeTruthy();
    const clipJobId = new URL(currentApp.page.url()).hash.match(/jobId=([^&]+)/)?.[1];
    expect(clipJobId).toBeTruthy();
    await expect.poll(async () => (
      await runtimeRequest<{
        job: { state: Record<string, unknown> };
      }>(
        currentApp.page,
        'GET',
        `/creator/jobs/${decodeURIComponent(clipJobId!)}`
      )
    ).body.job.state).toMatchObject({
      sourceUrl: 'https://example.com/watch/packaged-auto-clip',
      focus: 'knowledge',
      duration: '30-60',
      clipCount: 8,
      aspectRatio: '9:16'
    });

    const currentProjectId = await currentApp.page.evaluate(() => {
      const stored = localStorage.getItem('opencreator.navigation.v3');
      if (stored === null) return undefined;
      const parsed = JSON.parse(stored) as { currentProjectId?: unknown };
      return typeof parsed.currentProjectId === 'string' ? parsed.currentProjectId : undefined;
    });
    expect(currentProjectId).toBeTruthy();
    const createdJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: currentProjectId,
      templateId: 'video-translation',
      creationKey: 'packaged-video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=creator-package-smoke',
        targetLanguage: 'en'
      }
    });
    expect(createdJob.status).toBe(201);
    expect(createdJob.body.job).toMatchObject({
      revision: 0,
      state: { targetLanguage: 'en' }
    });
    const agentTurn = await runtimeRequest<{
      turn: {
        role: string;
        status: string;
        content: string;
      };
    }>(currentApp.page, 'POST', `/creator/jobs/${createdJob.body.job.id}/agent-turns`, {
      message: '合成横屏视频',
      sandbox: 'danger-full-access'
    });
    expect(agentTurn.status, JSON.stringify(agentTurn.body)).toBe(200);
    expect(agentTurn.body.turn).toMatchObject({
      role: 'assistant',
      status: 'completed',
      content: 'desktop e2e run completed'
    });
    const reportedIssue = await runtimeRequest<{
      clientIssueId: string;
      issue: {
        id: string;
        diagnosticId: string;
        fallbackMessage: string;
        status: string;
      };
    }>(currentApp.page, 'POST', `/creator/jobs/${createdJob.body.job.id}/issues/report`, {
      clientIssueId: 'packaged-creator-issue',
      code: 'creator_packaged_e2e_failure',
      source: 'client',
      operation: 'creator.packaged-e2e',
      fallbackMessage: '操作未完成，请在 Agent 区域查看诊断。'
    });
    expect(reportedIssue.status).toBe(201);
    expect(reportedIssue.body.issue).toMatchObject({
      status: 'open',
      fallbackMessage: '操作未完成，请在 Agent 区域查看诊断。'
    });
    await currentApp.page.evaluate(jobId => {
      window.location.hash = `#/workbench?tool=video-translation&jobId=${encodeURIComponent(jobId)}`;
    }, createdJob.body.job.id);
    const issueCard = currentApp.page.locator(
      `.creator-collaboration-issue[data-issue-id="${reportedIssue.body.issue.id}"]`
    );
    await expect(issueCard).toContainText('操作未完成，请在 Agent 区域查看诊断。');
    await expect(issueCard).toContainText('错误码：creator_packaged_e2e_failure');
    await issueCard.getByRole('button', { name: '询问这个问题' }).click();
    const issueComposer = currentApp.page.getByRole('textbox', { name: '告诉 Agent 你的要求' });
    await issueComposer.fill('请说明这个问题的已确认事实、可能原因和下一步修复方法。');
    const focusedAgentResponse = currentApp.page.waitForResponse(response => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname.endsWith(
        `/creator/jobs/${createdJob.body.job.id}/agent-turns`
      )
    ), { timeout: 45_000 });
    await currentApp.page.getByRole('button', { name: '发送给 Agent' }).click();
    const focusedAgentRequest = (await focusedAgentResponse).request().postDataJSON() as {
      focusedIssueId?: string;
      message?: string;
    };
    expect(focusedAgentRequest).toMatchObject({
      focusedIssueId: reportedIssue.body.issue.id,
      message: '请说明这个问题的已确认事实、可能原因和下一步修复方法。'
    });

    const localSourceJob = await runtimeRequest<{
      job: { id: string; revision: number };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'video-translation',
      creationKey: 'packaged-local-video-translation',
      state: {
        sourceType: 'file',
        sourceUrl: '',
        targetLanguage: 'en'
      }
    });
    expect(localSourceJob.status).toBe(201);
    const uploadedSource = await uploadOversizedWaveSource(currentApp.page, {
      jobId: localSourceJob.body.job.id,
      expectedRevision: localSourceJob.body.job.revision,
      pcmBytes: OVERSIZED_WAVE_PCM_BYTES
    });
    expect(uploadedSource.status).toBe(201);
    expect(uploadedSource.body).toMatchObject({
      job: { revision: 1 },
      artifact: {
        kind: 'source_video',
        status: 'completed',
        metadata: {
          fileName: 'oversized-runtime-proxy.wav',
          mimeType: 'audio/wav',
          size: OVERSIZED_WAVE_FILE_BYTES,
          hasAudio: true
        }
      },
      deduplicated: false
    });

    const jobBeforeUpdate = await runtimeRequest<{
      job: { revision: number };
    }>(currentApp.page, 'GET', `/creator/jobs/${createdJob.body.job.id}`);
    expect(jobBeforeUpdate.status).toBe(200);
    const updatedJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', `/creator/jobs/${createdJob.body.job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: jobBeforeUpdate.body.job.revision,
      input: { patch: { targetLanguage: 'ja', dubbing: true } }
    });
    expect(updatedJob.status).toBe(200);
    expect(updatedJob.body.job).toMatchObject({
      revision: jobBeforeUpdate.body.job.revision + 1,
      state: { targetLanguage: 'ja', dubbing: true }
    });
    const imageJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'image-generation',
      creationKey: 'packaged-image-generation',
      state: {
        prompt: 'Packaged image generation smoke',
        provider: 'gemini',
        size: '1024x1536',
        quality: 'high',
        candidateCount: 4
      }
    });
    expect(imageJob.status).toBe(201);
    expect(imageJob.body.job).toMatchObject({
      revision: 0,
      state: {
        prompt: 'Packaged image generation smoke',
        provider: 'gemini',
        size: '1024x1536',
        quality: 'high',
        candidateCount: 4
      }
    });
    const coverJob = await runtimeRequest<{
      job: {
        id: string;
        revision: number;
        templateVersion: number;
        state: Record<string, unknown>;
      };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'cover',
      creationKey: 'packaged-cover-generation',
      state: {
        prompt: 'Packaged cover generation smoke',
        ratio: '9:16',
        quality: 'high',
        candidateCount: 2
      }
    });
    expect(coverJob.status).toBe(201);
    expect(coverJob.body.job).toMatchObject({
      revision: 0,
      templateVersion: 2,
      state: {
        prompt: 'Packaged cover generation smoke',
        ratio: '9:16',
        quality: 'high',
        candidateCount: 2
      }
    });
    const stickmanJob = await runtimeRequest<{
      job: {
        id: string;
        revision: number;
        templateVersion: number;
        state: Record<string, unknown>;
      };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'stickman-video',
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=creator-stickman-package-smoke',
        characterAsset: { assetId: 'stickman.character.default', revision: 1 },
        styleAsset: { assetId: 'stickman.style.minimal-ink', revision: 1 },
        ratio: '16:9',
        targetDurationSeconds: 30,
        targetLanguage: 'zh-CN',
        ttsProvider: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
        voiceCode: 'marin',
        voiceName: 'Marin'
      }
    });
    expect(stickmanJob.status).toBe(201);
    expect(stickmanJob.body.job).toMatchObject({
      revision: 0,
      templateVersion: 2,
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=creator-stickman-package-smoke',
        characterAsset: { assetId: 'stickman.character.default', revision: 1 }
      }
    });
    const updatedStickmanJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'POST', `/creator/jobs/${stickmanJob.body.job.id}/actions`, {
      action: 'update-settings',
      expectedRevision: stickmanJob.body.job.revision,
      input: {
        patch: {
          characterAsset: { assetId: 'stickman.character.tech-guy', revision: 1 },
          styleAsset: { assetId: 'stickman.style.whiteboard-marker', revision: 1 },
          targetDurationSeconds: 125,
          voiceCode: 'nova',
          voiceName: 'Nova'
        }
      }
    });
    expect(updatedStickmanJob.status).toBe(200);
    expect(updatedStickmanJob.body.job).toMatchObject({
      revision: 1,
      state: {
        characterAsset: { assetId: 'stickman.character.tech-guy', revision: 1 },
        styleAsset: { assetId: 'stickman.style.whiteboard-marker', revision: 1 },
        targetDurationSeconds: 125,
        ttsProvider: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
        voiceCode: 'nova',
        voiceName: 'Nova'
      }
    });
    expect(updatedStickmanJob.body.job.state).not.toHaveProperty('characterPrompt');
    expect(updatedStickmanJob.body.job.state).not.toHaveProperty('voice');

    const relaunchInput = {
      executablePath: currentApp.executablePath,
      launchArgs: currentApp.launchArgs,
      env: {
        ...currentApp.env,
        OPENCREATOR_YT_DLP_PATH: fixture.ytDlpBin
      }
    };
    await closePackagedApp(currentApp);
    currentApp = await relaunchPackagedApp(relaunchInput, 45_000);
    await waitForWorkspace(currentApp.page);

    const restoredJob = await runtimeRequest<{
      job: {
        id: string;
        revision: number;
        state: Record<string, unknown>;
        issues: Array<{ id: string; diagnosticId: string; status: string }>;
      };
    }>(currentApp.page, 'GET', `/creator/jobs/${createdJob.body.job.id}`);
    expect(restoredJob.status).toBe(200);
    expect(restoredJob.body.job).toMatchObject({
      id: createdJob.body.job.id,
      revision: updatedJob.body.job.revision,
      state: { targetLanguage: 'ja', dubbing: true }
    });
    expect(restoredJob.body.job.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: reportedIssue.body.issue.id,
        diagnosticId: reportedIssue.body.issue.diagnosticId,
        status: 'open'
      })
    ]));
    await currentApp.page.evaluate(jobId => {
      window.location.hash = `#/workbench?tool=video-translation&jobId=${encodeURIComponent(jobId)}`;
    }, createdJob.body.job.id);
    const restoredIssueCard = currentApp.page.locator(
      `.creator-collaboration-issue[data-issue-id="${reportedIssue.body.issue.id}"]`
    );
    await expect(restoredIssueCard).toContainText('操作未完成，请在 Agent 区域查看诊断。');
    await expect(restoredIssueCard).toContainText('错误码：creator_packaged_e2e_failure');
    const restoredImageJob = await runtimeRequest<{
      job: { id: string; revision: number; state: Record<string, unknown> };
    }>(currentApp.page, 'GET', `/creator/jobs/${imageJob.body.job.id}`);
    expect(restoredImageJob.status).toBe(200);
    expect(restoredImageJob.body.job).toMatchObject({
      id: imageJob.body.job.id,
      state: {
        prompt: 'Packaged image generation smoke',
        provider: 'gemini',
        size: '1024x1536',
        quality: 'high',
        candidateCount: 4
      }
    });
    const restoredCoverJob = await runtimeRequest<{
      job: { id: string; templateVersion: number; state: Record<string, unknown> };
    }>(currentApp.page, 'GET', `/creator/jobs/${coverJob.body.job.id}`);
    expect(restoredCoverJob.status).toBe(200);
    expect(restoredCoverJob.body.job).toMatchObject({
      id: coverJob.body.job.id,
      templateVersion: 2,
      state: {
        prompt: 'Packaged cover generation smoke',
        ratio: '9:16',
        quality: 'high',
        candidateCount: 2
      }
    });
    const downloadJob = await runtimeRequest<{
      job: { id: string; revision: number };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: createdProject.body.project.id,
      templateId: 'video-download',
      creationKey: 'packaged-video-download',
      state: {
        sourceUrl: 'https://www.youtube.com/watch?v=C4gJinSiuG4'
      }
    });
    expect(downloadJob.status).toBe(201);
    const probeStarted = await runtimeRequest<{
      job: { revision: number };
    }>(
      currentApp.page,
      'POST',
      `/creator/jobs/${downloadJob.body.job.id}/actions`,
      {
        action: 'run-stage',
        expectedRevision: downloadJob.body.job.revision,
        input: {
          stageId: 'probe'
        }
      }
    );
    expect(probeStarted.status).toBe(200);
    await expect.poll(async () => {
      const response = await runtimeRequest<{
        job: {
          stages: Array<{
            stageId: string;
            status: string;
            errorCode: string | null;
            errorMessage: string | null;
          }>;
        };
      }>(
        currentApp.page,
        'GET',
        `/creator/jobs/${downloadJob.body.job.id}`
      );
      const probe = response.body.job.stages.find(
        stage => stage.stageId === 'probe'
      );
      if (probe?.status === 'failed') {
        throw new Error(
          `Packaged video probe failed: ${probe.errorCode} ${probe.errorMessage}`
        );
      }
      return probe?.status;
    }, { timeout: 60_000 }).toBe('succeeded');
    const probedDownloadJob = await runtimeRequest<{
      job: {
        artifacts: Array<{
          kind: string;
          status: string;
          metadata: Record<string, unknown>;
        }>;
      };
    }>(
      currentApp.page,
      'GET',
      `/creator/jobs/${downloadJob.body.job.id}`
    );
    expect(probedDownloadJob.body.job.artifacts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'download_probe',
          status: 'completed',
          metadata: expect.objectContaining({
            id: 'C4gJinSiuG4'
          })
        })
      ])
    );
    expect(containsPythonBytecodeCache(
      join(runtimeRoot, 'yt-dlp-runtime', 'python')
    )).toBe(false);
    const restoredStickmanJob = await runtimeRequest<{
      job: { id: string; revision: number; templateVersion: number; state: Record<string, unknown> };
    }>(currentApp.page, 'GET', `/creator/jobs/${stickmanJob.body.job.id}`);
    expect(restoredStickmanJob.status).toBe(200);
    expect(restoredStickmanJob.body.job).toMatchObject({
      id: stickmanJob.body.job.id,
      templateVersion: 2,
      state: {
        sourceType: 'url',
        sourceUrl: 'https://www.youtube.com/watch?v=creator-stickman-package-smoke',
        characterAsset: { assetId: 'stickman.character.tech-guy', revision: 1 },
        styleAsset: { assetId: 'stickman.style.whiteboard-marker', revision: 1 },
        targetDurationSeconds: 125,
        ttsProvider: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
        voiceCode: 'nova',
        voiceName: 'Nova'
      }
    });
    expect(restoredStickmanJob.body.job.state).not.toHaveProperty('characterPrompt');
    expect(restoredStickmanJob.body.job.state).not.toHaveProperty('voice');
    expect(restoredStickmanJob.body.job.revision)
      .toBeGreaterThanOrEqual(updatedStickmanJob.body.job.revision);
    await currentApp.page.getByRole('button', { name: '返回', exact: true }).click();
    await currentApp.page.getByRole('button', { name: '我的项目', exact: true }).click();
    await currentApp.page.getByRole('button', {
      name: '打开项目 youtube.com · creator-stickman-package-smoke'
    }).click();
    await expect(currentApp.page.getByRole('heading', { name: '火柴人动画' })).toBeVisible();
    await expect(currentApp.page.getByRole('radio', { name: '科技男' })).toBeChecked();
    await expect(currentApp.page.getByRole('textbox', { name: '角色描述' })).toHaveCount(0);
    await expect(currentApp.page.getByRole('combobox', { name: '视觉风格' }))
      .toHaveValue('stickman.style.whiteboard-marker@1');
    await expect(currentApp.page.getByRole('combobox', { name: '目标时长' }))
      .toHaveValue('custom');
    await expect(currentApp.page.getByRole('spinbutton', { name: '自定义时长（秒）' }))
      .toHaveValue('125');
    await expect(currentApp.page.getByRole('combobox', { name: '配音音色' }))
      .toHaveCount(0);
    await expect(currentApp.page.getByText('尚未配置配音服务', { exact: true }))
      .toBeVisible();
    await expect(currentApp.page.getByRole('link', { name: '前往配音服务配置' }))
      .toHaveAttribute('href', '#/settings?tab=ai-services&section=tts');
    await expect(currentApp.page.getByLabel('任务摘要')).toHaveCount(0);
    await expect(currentApp.page.locator('.creator-collaboration-panel')).toHaveCount(1);
    expect(hasWhisperKitDependency(fixture.root)).toBe(false);
  } finally {
    await closePackagedApp(currentApp).catch(() => undefined);
    if (process.env.OPENCREATOR_E2E_KEEP_TEMP !== '1') {
      rmSync(fixture.root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      });
    }
  }
});

test('Creator Preset 在实际 Desktop 包中创建并重启恢复', async () => {
  test.setTimeout(180_000);
  const fixture = await launchCreatorDesktop();
  let currentApp: PackagedApp = fixture.app;

  try {
    await waitForWorkspace(currentApp.page);
    expect(currentApp.page.url()).toContain('opencreator-app://app/');
    const catalog = await runtimeRequest<{
      catalogHash: string;
      presets: Array<{
        module: string;
        id: string;
        version: number;
        title: string;
        coverUrl: string;
      }>;
    }>(currentApp.page, 'GET', '/creator/presets?locale=zh-CN');
    expect(catalog.status).toBe(200);
    expect(catalog.body.catalogHash).toMatch(/^[a-f0-9]{64}$/);
    const preset = catalog.body.presets.find(item => (
      item.module === 'image-generation'
      && item.id === 'exploded-food-infographic'
      && item.version === 1
    ));
    expect(preset).toMatchObject({
      title: '食物爆炸拆解信息图',
      coverUrl: expect.stringMatching(/^\/creator-presets\/[a-f0-9]{64}\.jpg$/)
    });
    expect(catalog.body.presets.some(item => (
      item.module === 'video-translation' || item.module === 'video-download'
    ))).toBe(false);

    const staticResources = await currentApp.page.evaluate(async coverUrl => {
      const [cover, font] = await Promise.all([
        fetch(coverUrl),
        fetch('/fonts/opencreator/OpenCreatorRounded-Bold.woff2')
      ]);
      return {
        cover: {
          status: cover.status,
          contentType: cover.headers.get('content-type'),
          bytes: (await cover.arrayBuffer()).byteLength
        },
        font: {
          status: font.status,
          contentType: font.headers.get('content-type'),
          bytes: (await font.arrayBuffer()).byteLength
        }
      };
    }, preset!.coverUrl);
    expect(staticResources.cover).toMatchObject({
      status: 200,
      contentType: 'image/jpeg'
    });
    expect(staticResources.cover.bytes).toBeGreaterThan(20_000);
    expect(staticResources.font.status).toBe(200);
    expect(staticResources.font.contentType).toContain('font/woff2');
    expect(staticResources.font.bytes).toBeGreaterThan(10_000);

    const projectDir = join(fixture.root, 'creator-preset-workspace');
    mkdirSync(projectDir, { recursive: true });
    const project = await runtimeRequest<{
      project: { id: string };
    }>(currentApp.page, 'POST', '/projects', {
      cwd: projectDir,
      name: 'Creator Preset 打包态验证',
      sandbox: 'workspace-write'
    });
    expect(project.status).toBe(201);
    const created = await runtimeRequest<{
      job: {
        id: string;
        templateId: string;
        templateVersion: number;
        state: Record<string, unknown>;
        presetOrigin: Record<string, unknown> | null;
        stages: unknown[];
      };
    }>(currentApp.page, 'POST', '/creator/jobs', {
      projectId: project.body.project.id,
      preset: {
        module: 'image-generation',
        id: 'exploded-food-infographic',
        version: 1
      },
      locale: 'zh-CN',
      creationKey: 'packaged-creator-preset'
    });
    expect(created.status).toBe(201);
    expect(created.body.job).toMatchObject({
      templateId: 'image-generation',
      templateVersion: 2,
      state: {
        prompt: expect.stringContaining('创建超写实的塔可'),
        size: '1024x1024'
      },
      presetOrigin: {
        module: 'image-generation',
        id: 'exploded-food-infographic',
        version: 1,
        locale: 'zh-CN',
        title: '食物爆炸拆解信息图'
      },
      stages: []
    });

    const relaunchInput = {
      executablePath: currentApp.executablePath,
      launchArgs: currentApp.launchArgs,
      env: currentApp.env
    };
    await closePackagedApp(currentApp);
    currentApp = await relaunchPackagedApp(relaunchInput, 45_000);
    await waitForWorkspace(currentApp.page);
    const restored = await runtimeRequest<{
      job: {
        id: string;
        state: Record<string, unknown>;
        presetOrigin: Record<string, unknown> | null;
      };
    }>(
      currentApp.page,
      'GET',
      `/creator/jobs/${encodeURIComponent(created.body.job.id)}`
    );
    expect(restored.status).toBe(200);
    expect(restored.body.job).toMatchObject({
      id: created.body.job.id,
      state: {
        prompt: expect.stringContaining('创建超写实的塔可'),
        size: '1024x1024'
      },
      presetOrigin: created.body.job.presetOrigin
    });
  } finally {
    await closePackagedApp(currentApp).catch(() => undefined);
    if (process.env.OPENCREATOR_E2E_KEEP_TEMP !== '1') {
      rmSync(fixture.root, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100
      });
    }
  }
});

test('Creator Preset verifier 拒绝损坏和陈旧的打包资源', () => {
  test.setTimeout(300_000);
  const sourceRoot = packagedPackageRoot();
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'opencreator-preset-verifier-'));
  const packageRoot = join(fixtureRoot, basename(sourceRoot));

  try {
    const baseline = runPackagedVerifier(sourceRoot);
    expect(
      baseline.status,
      `Packaged verifier failed:\n${baseline.stdout}\n${baseline.stderr}`
    ).toBe(0);

    clonePackageRoot(sourceRoot, packageRoot);
    const resources = packagedResourcesRoot(packageRoot);
    const presetRoot = join(resources, 'daemon', 'runtime', 'creator-presets');
    const manifestPath = join(presetRoot, 'manifest.json');
    const catalogPath = join(presetRoot, 'catalog.json');
    const manifestBytes = readFileSync(manifestPath);
    const catalogBytes = readFileSync(catalogPath);
    const presetManifest = JSON.parse(manifestBytes.toString('utf8')) as {
      files: Array<{ path: string }>;
    };
    const coverName = basename(
      presetManifest.files.find(file => file.path.startsWith('assets/'))!.path
    );
    const coverPath = join(resources, 'web', 'creator-presets', coverName);
    const coverBytes = readFileSync(coverPath);
    const stalePath = join(resources, 'web', 'creator-presets', 'stale.webp');

    rmSync(catalogPath);
    expectVerifierFailure(
      runPackagedVerifier(packageRoot),
      'catalog.json'
    );
    writeFileSync(catalogPath, catalogBytes);

    const substitutedManifest = JSON.parse(manifestBytes.toString('utf8'));
    substitutedManifest.assetSetHash = '0'.repeat(64);
    writeFileSync(manifestPath, `${JSON.stringify(substitutedManifest)}\n`);
    expectVerifierFailure(
      runPackagedVerifier(packageRoot),
      'Creator preset asset set hash mismatch'
    );
    writeFileSync(manifestPath, manifestBytes);

    rmSync(coverPath);
    expectVerifierFailure(
      runPackagedVerifier(packageRoot),
      'Creator preset Web asset is missing'
    );
    writeFileSync(coverPath, coverBytes);

    writeFileSync(stalePath, coverBytes);
    expectVerifierFailure(
      runPackagedVerifier(packageRoot),
      'Creator preset Web assets contain a stale file'
    );
  } finally {
    rmSync(fixtureRoot, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100
    });
  }
});

function hasWhisperKitDependency(root: string): boolean {
  const dependencyRoot = join(
    root,
    'user-data',
    'daemon',
    'creator-runtime',
    'dependencies',
    'krillinai'
  );
  return existsSync(join(dependencyRoot, 'bin', 'whisperkit-cli'))
    || existsSync(join(
      dependencyRoot,
      'models',
      'whisperkit',
      'openai_whisper-large-v2'
    ));
}

async function launchCreatorDesktop(windowBounds?: { width: number; height: number }): Promise<{
  app: PackagedApp;
  root: string;
  ytDlpBin: string;
}> {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-packaged-e2e-'));
  const binDir = join(root, 'bin');
  const stateDir = join(root, 'fake-codex-state');
  const codexHome = join(root, 'codex-home');
  const userData = join(root, 'user-data');
  const codexBin = writeCodexShim(binDir);
  const ytDlpBin = writeYtDlpShim(binDir);
  writeOpenCreatorConfig(join(root, '.opencreator'), codexBin, windowBounds);

  const app = await launchPackagedApp({
    executablePath: packagedExecutable(desktopDir),
    args: [
      `--user-data-dir=${userData}`,
      '--disable-gpu'
    ],
    env: {
      ...withoutDesktopTestEnvironment(process.env),
      PATH: `${binDir}${delimiter}${process.env.PATH ?? ''}`,
      SHELL: process.platform === 'win32' ? process.env.ComSpec : '/bin/false',
      HOME: root,
      USERPROFILE: root,
      OPENCREATOR_DEFAULT_PROJECT_ROOT: join(root, 'Documents'),
      OPENCREATOR_HOME: join(root, '.opencreator'),
      CODEX_HOME: codexHome,
      OPENCREATOR_CODEX_APPLICATION_ROOTS: join(root, 'Applications'),
      OPENCREATOR_E2E_FAKE_CODEX_STATE_DIR: stateDir,
      OPENCREATOR_E2E_FAKE_CODEX_MODE: 'success',
      OPENCREATOR_E2E_NODE_BINARY: process.execPath,
      OPENCREATOR_E2E_FAKE_CODEX_SCRIPT: fakeCodexScript,
      OPENCREATOR_E2E_FAKE_YT_DLP_SCRIPT: fakeYtDlpScript
    },
    timeoutMs: 45_000
  });
  return { app, root, ytDlpBin };
}

async function waitForWorkspace(page: Page): Promise<void> {
  await expect.poll(async () => {
    const state = await page.evaluate(() => window.opencreatorDesktop?.readBootstrapState())
      .catch(() => undefined);
    if (state?.phase === 'failed' || state?.phase === 'workspace_failed') {
      throw new Error(
        `Desktop 启动失败：${state.phase} ${state.error?.code ?? ''} `
        + `${state.error?.message ?? ''}`
      );
    }
    return new URL(page.url()).hostname;
  }, { timeout: 45_000 }).toBe('app');
  await expect.poll(async () => (
    await page.evaluate(() => window.opencreatorDesktop?.readBootstrapState())
  )?.phase).toBe('ready');
  const confirmed = await page.evaluate(() => window.localStorage.getItem('opencreator.agent-setup-confirmed.v1') !== null);
  if (!confirmed) {
    const setup = page.getByRole('heading', { name: '开始使用 Agent' });
    await setup.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => undefined);
    if (await setup.isVisible()) {
      await page.getByRole('button', { name: '使用本机 Codex，继续' }).click();
      await expect(setup).toBeHidden();
    }
  }
  await expect(page.locator('.opencreator-shell')).toBeVisible();
}

async function runtimeRequest<T>(
  page: Page,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ status: number; body: T }> {
  return await page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(`/.opencreator/runtime${path}`, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return { status: response.status, body: await response.json() as T };
  }, { method, path, body });
}

async function uploadOversizedWaveSource(
  page: Page,
  input: {
    jobId: string;
    expectedRevision: number;
    pcmBytes: number;
  }
): Promise<{
  status: number;
  body: {
    job: { revision: number };
    artifact: {
      kind: string;
      status: string;
      metadata: Record<string, unknown>;
    };
    deduplicated: boolean;
  };
}> {
  return await page.evaluate(async ({ jobId, expectedRevision, pcmBytes }) => {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const writeAscii = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) {
        view.setUint8(offset + index, value.charCodeAt(index));
      }
    };
    writeAscii(0, 'RIFF');
    view.setUint32(4, pcmBytes + 36, true);
    writeAscii(8, 'WAVE');
    writeAscii(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, 48_000, true);
    view.setUint32(28, 96_000, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeAscii(36, 'data');
    view.setUint32(40, pcmBytes, true);

    const query = new URLSearchParams({
      expectedRevision: String(expectedRevision),
      fileName: 'oversized-runtime-proxy.wav',
      mime: 'audio/wav',
      lastModified: '0'
    });
    const response = await fetch(
      `/.opencreator/runtime/creator/jobs/${encodeURIComponent(jobId)}/source-video?${query}`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/vnd.opencreator.creator-source'
        },
        body: new Blob([header, new Uint8Array(pcmBytes)])
      }
    );
    return {
      status: response.status,
      body: await response.json()
    };
  }, input);
}

function packagedRuntimeRoot(): string {
  const packageRoot = dirname(packagedExecutable(desktopDir));
  return process.platform === 'darwin'
    ? resolve(packageRoot, '..', 'Resources', 'creator-runtime', 'krillinai')
    : join(packageRoot, 'resources', 'creator-runtime', 'krillinai');
}

function packagedStickmanRuntimeRoot(): string {
  const packageRoot = dirname(packagedExecutable(desktopDir));
  return process.platform === 'darwin'
    ? resolve(packageRoot, '..', 'Resources', 'stickman-runtime')
    : join(packageRoot, 'resources', 'stickman-runtime');
}

function packagedPackageRoot(): string {
  const executable = packagedExecutable(desktopDir);
  return process.platform === 'darwin'
    ? resolve(dirname(executable), '../..')
    : dirname(executable);
}

function packagedResourcesRoot(packageRoot: string): string {
  return process.platform === 'darwin'
    ? join(packageRoot, 'Contents', 'Resources')
    : join(packageRoot, 'resources');
}

function clonePackageRoot(source: string, destination: string): void {
  if (process.platform === 'darwin') {
    const result = spawnSync('cp', ['-cR', source, destination], {
      encoding: 'utf8',
      timeout: 5 * 60_000
    });
    if (result.status === 0) return;
  } else if (process.platform === 'linux') {
    const result = spawnSync('cp', ['-a', '--reflink=auto', source, destination], {
      encoding: 'utf8',
      timeout: 5 * 60_000
    });
    if (result.status === 0) return;
  }
  cpSync(source, destination, { recursive: true });
}

function runPackagedVerifier(packageRoot: string): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, [
    join(desktopDir, 'scripts', 'verify-package.mjs')
  ], {
    cwd: resolve(desktopDir, '../..'),
    env: {
      ...process.env,
      OPENCREATOR_DESKTOP_PACKAGE_ROOT: packageRoot
    },
    encoding: 'utf8',
    timeout: 5 * 60_000,
    maxBuffer: 20 * 1024 * 1024
  });
}

function expectVerifierFailure(
  result: ReturnType<typeof spawnSync>,
  message: string
): void {
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain(message);
}

function executableResource(path: string): string {
  return process.platform === 'win32' ? `${path}.exe` : path;
}

function packagedYtDlpVersion(
  runtimeRoot: string,
  descriptor: {
    mode: 'python';
    executable: string;
    script: string;
    certificateBundle: string;
  }
): {
  version: string;
  elapsedMs: number;
} {
  const executable = join(runtimeRoot, descriptor.executable);
  const script = join(runtimeRoot, descriptor.script);
  const certificateBundle = join(runtimeRoot, descriptor.certificateBundle);
  const startedAt = performance.now();
  const result = spawnSync(executable, ['-I', '-B', script, '--version'], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      SSL_CERT_FILE: certificateBundle
    },
    encoding: 'utf8',
    timeout: 15_000,
    windowsHide: true
  });
  const elapsedMs = performance.now() - startedAt;
  if (result.status !== 0) {
    throw new Error(
      `Packaged yt-dlp failed: ${result.error?.message ?? result.stderr.trim()}`
    );
  }
  return {
    version: result.stdout.trim(),
    elapsedMs
  };
}

function containsPythonBytecodeCache(root: string): boolean {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) return true;
    if (
      entry.isDirectory()
      && containsPythonBytecodeCache(join(root, entry.name))
    ) {
      return true;
    }
  }
  return false;
}

function packagedCreatorAgentRuntimeFiles(): string[] {
  const packageRoot = dirname(packagedExecutable(desktopDir));
  const runtimeRoot = process.platform === 'darwin'
    ? resolve(
        packageRoot,
        '..',
        'Resources',
        'daemon',
        'runtime',
        'opencreator-runtime'
      )
    : join(
        packageRoot,
        'resources',
        'daemon',
        'runtime',
        'opencreator-runtime'
      );
  return ['SKILL.md', 'manifest.json'].filter(name => existsSync(join(runtimeRoot, name)));
}

function writeCodexShim(binDir: string): string {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = process.platform === 'win32'
    ? join(binDir, 'codex.exe')
    : join(binDir, 'codex');
  if (process.platform === 'win32') {
    const cacheDir = join(desktopDir, '.cache', 'e2e');
    const cachedLauncher = join(cacheDir, 'fake-codex-launcher.exe');
    mkdirSync(cacheDir, { recursive: true });
    if (
      !existsSync(cachedLauncher)
      || statSync(cachedLauncher).mtimeMs < statSync(fakeCodexLauncherSource).mtimeMs
    ) {
      execFileSync('go', ['build', '-trimpath', '-o', cachedLauncher, fakeCodexLauncherSource], {
        cwd: desktopDir,
        stdio: 'inherit'
      });
    }
    copyFileSync(cachedLauncher, scriptPath);
    return scriptPath;
  }
  writeFileSync(
    scriptPath,
    `#!/bin/sh\nexec "${process.execPath}" "${fakeCodexScript}" "$@"\n`
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeYtDlpShim(binDir: string): string {
  mkdirSync(binDir, { recursive: true });
  const scriptPath = process.platform === 'win32'
    ? join(binDir, 'yt-dlp.exe')
    : join(binDir, 'yt-dlp');
  if (process.platform === 'win32') {
    const cacheDir = join(desktopDir, '.cache', 'e2e');
    const cachedLauncher = join(cacheDir, 'fake-yt-dlp-launcher.exe');
    mkdirSync(cacheDir, { recursive: true });
    if (
      !existsSync(cachedLauncher)
      || statSync(cachedLauncher).mtimeMs < statSync(fakeYtDlpLauncherSource).mtimeMs
    ) {
      execFileSync('go', ['build', '-trimpath', '-o', cachedLauncher, fakeYtDlpLauncherSource], {
        cwd: desktopDir,
        stdio: 'inherit'
      });
    }
    copyFileSync(cachedLauncher, scriptPath);
    return scriptPath;
  }
  writeFileSync(
    scriptPath,
    `#!/bin/sh\nexec "${process.execPath}" "${fakeYtDlpScript}" "$@"\n`
  );
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function writeOpenCreatorConfig(
  productHome: string,
  codexBin: string,
  windowBounds?: { width: number; height: number }
): void {
  mkdirSync(productHome, { recursive: true });
  writeFileSync(
    join(productHome, 'config.toml'),
    [
      'version = 1',
      '',
      '[desktop]',
      'close_behavior = "quit"',
      'notifications_enabled = false',
      '',
      ...(windowBounds === undefined ? [] : [
        '[desktop.window]',
        `width = ${windowBounds.width}`,
        `height = ${windowBounds.height}`,
        ''
      ]),
      '[runtime]',
      'codex_mode = "external"',
      `external_codex_bin = ${JSON.stringify(codexBin)}`,
      ''
    ].join('\n')
  );
}

function withoutDesktopTestEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const next = { ...env };
  for (const name of [
    'ELECTRON_RUN_AS_NODE',
    'OPENCREATOR_UPDATE_URL',
    'OPENCREATOR_CREATOR_RUNTIME_ROOT'
  ]) {
    delete next[name];
  }
  return next;
}

if (!existsSync(fakeCodexScript)) {
  throw new Error(`Fake Codex fixture 不存在：${fakeCodexScript}`);
}
