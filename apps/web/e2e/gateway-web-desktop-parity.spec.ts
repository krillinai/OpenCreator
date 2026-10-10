import { test, expect } from './fixtures/runtime.js';

test('账户入口在同尺寸 Browser/Desktop Bridge 下读取同一个 Daemon 并显示一致', async ({ browser, runtime }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop');
  const states: unknown[] = [];
  for (const platform of ['browser', 'desktop']) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    if (platform === 'desktop') await page.addInitScript(() => {
      Object.defineProperty(window, 'opencreatorDesktop', { value: {
        kind:'desktop', readAppVersion:async()=> '3.2.2', readConnectionConfig:async()=>({baseUrl:'/.opencreator/runtime'}), subscribeConnectionConfig:()=>()=>undefined,
        readDesktopPreferences:async()=>({closeBehavior:'hide'}), updateDesktopPreferences:async()=>({closeBehavior:'hide'}), workspaceReady:()=>undefined,
        subscribeNavigation:()=>()=>undefined, notify:async()=>undefined, configureBackgroundNotifications:async()=>({ok:true}),
        openExternal:async(url:string)=>{ (window as unknown as { __gatewayURL?: string }).__gatewayURL=url; }
      } });
    });
    try {
      await runtime.openApp(page); await page.getByRole('button', { name: '个人中心', exact: true }).click();
      const account = page.getByRole('region', { name:'OpenCreator 账户' });
      await expect(account.getByRole('button', { name:'登录 / 注册' })).toBeVisible();
      await expect(account.getByRole('button', { name:'本地模式' })).toHaveCount(0);
      states.push({text:await account.innerText(),box:await account.boundingBox()});
      await page.screenshot({path:testInfo.outputPath(`gateway-${platform}.png`)});
    } finally { await context.close(); }
  }
  expect(states[1]).toEqual(states[0]);
});
