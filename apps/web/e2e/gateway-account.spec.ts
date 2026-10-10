import { test, expect } from './fixtures/runtime.js';
import type { GatewayAccountState } from '@opencreator/protocol';

test('独立订阅页面支持游客选套餐、登录后继续购买并返回个人中心', async ({ page, runtime }, testInfo) => {
  const guest: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
  let state = guest;
  let paid = false;
  let portalRequests = 0;
  const checkoutRequests: Array<{ planId: string }> = [];
  const plans = [
    { id: 'personal', name: '个人版', amountUnits: '3900', currency: 'cny', creditUnits: '1000000000' },
    { id: 'creator', name: '创作版', amountUnits: '9900', currency: 'cny', creditUnits: '3000000000' }
  ];
  await page.route('**/gateway/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let value: unknown;
    if (path.endsWith('/gateway/account')) value = state;
    else if (path.endsWith('/gateway/plans')) value = { plans, billingAvailable: true };
    else if (path.endsWith('/gateway/auth/start')) {
      state = { ...guest, authState: 'signed_in', account: { id: 'a', email: 'creator@example.test', verified: true } };
      value = { attemptId: 'mock', authorizationUrl: `${runtime.origin}/#/account`, expiresAt: '2026-10-06T00:00:00Z' };
    } else if (path.endsWith('/gateway/auth/logout')) { state = guest; value = state; }
    else if (path.endsWith('/gateway/billing/summary')) value = {
      balance: { availableUnits: paid ? '2860000000' : '0', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' },
      subscription: paid ? { id: 'sub-1', status: 'active', periodStart: '2026-10-05T00:00:00Z', periodEnd: '2026-11-05T00:00:00Z', cancelAtPeriodEnd: false, nextPlanId: null, plan: plans[1] } : null,
      billingAvailable: true
    };
    else if (path.endsWith('/gateway/billing/checkout')) {
      checkoutRequests.push(route.request().postDataJSON());
      value = { url: `${runtime.origin}/#/account` };
    } else if (path.endsWith('/gateway/billing/portal')) { portalRequests++; value = { url: `${runtime.origin}/#/account` }; }
    else { await route.continue(); return; }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  });
  await runtime.openApp(page);
  const navigation = page.getByRole('navigation', { name: 'OpenCreator', exact: true });
  const openNavigation = page.getByRole('button', { name: '打开导航', exact: true });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await navigation.getByRole('button', { name: '个人中心', exact: true }).click();
  if (await openNavigation.isVisible()) await expect(page.getByLabel('OpenCreator 导航', { exact: true })).toHaveCSS('visibility', 'hidden');
  const center = page.getByRole('main', { name: '个人中心', exact: true });
  await expect(center.getByRole('button', { name: '登录 / 注册' })).toBeVisible();
  await expect(center.getByRole('heading', { name: '订阅套餐', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('personal-center.png'), fullPage: true });
  await center.getByRole('button', { name: '查看订阅套餐', exact: true }).click();
  await expect(page).toHaveURL(/#\/subscription$/);
  const subscriptionPage = page.getByRole('main', { name: '订阅', exact: true });
  await expect(subscriptionPage).toBeVisible();
  await expect(subscriptionPage.getByRole('button', { name: '登录并订阅' })).toHaveCount(2);
  await page.goBack();
  await expect(center).toBeVisible();
  await page.goForward();
  await expect(subscriptionPage).toBeVisible();
  await expect(subscriptionPage.getByRole('button', { name: '登录并订阅' })).toHaveCount(2);
  await page.reload();
  await expect(subscriptionPage).toBeVisible();
  const subscription = subscriptionPage.getByRole('region', { name: '订阅与积分' });
  await expect(subscription.getByRole('heading', { name: '可用积分', exact: true })).toHaveCount(0);
  await expect(subscriptionPage.getByText('登录后可查看')).toHaveCount(0);
  await expect(subscriptionPage.getByRole('button', { name: '刷新订阅' })).toHaveCount(0);
  await expect(subscription.getByText(/39.00/)).toBeVisible();
  await expect(subscription.getByRole('button', { name: '登录并订阅', exact: true })).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('subscription-public-plans.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const creatorPlan = subscription.getByRole('article').filter({ has: page.getByRole('heading', { name: '创作版', exact: true }) });
  await creatorPlan.getByRole('button', { name: '登录并订阅' }).click();
  await expect(subscriptionPage.getByRole('heading', { name: 'creator@example.test', exact: true })).toBeVisible();
  await expect(subscription.getByText('未订阅', { exact: true })).toBeVisible();
  await expect.poll(() => checkoutRequests.length).toBe(1);
  expect(checkoutRequests[0].planId).toBe('creator');
  await expect(subscription.getByText('等待支付确认', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('subscription-before-payment.png'), fullPage: true });
  paid = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(subscription.getByText('生效中', { exact: true })).toBeVisible();
  await expect(subscription.locator('.gateway-subscription__credit-value')).toHaveText('2860 积分');
  await expect(subscription.locator('.gateway-subscription__current').getByText('创作版', { exact: true })).toBeVisible();
  await expect(subscription.locator('.gateway-subscription__current').getByText(/99.00.*3000/)).toBeVisible();
  await expect(subscription.getByRole('heading', { name: '订阅套餐', exact: true })).toBeVisible();
  await expect(creatorPlan.getByRole('button', { name: '当前套餐' })).toBeDisabled();
  await expect(subscription.locator('.gateway-subscription__current').getByRole('button', { name: '管理订阅' })).toBeEnabled();
  await expect(subscription.getByRole('button', { name: '订阅', exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('subscription-subscribed.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const otherPlan = subscription.getByRole('article').filter({ has: page.getByRole('heading', { name: '个人版', exact: true }) });
  await otherPlan.getByRole('button', { name: '管理订阅' }).click();
  await expect.poll(() => portalRequests).toBe(1);
  expect(checkoutRequests).toHaveLength(1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(subscription.getByRole('link', { name: '打开订阅管理' })).toBeVisible();
  await subscriptionPage.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/account$/);
  await expect(center.getByText('生效中', { exact: true })).toBeVisible();
  await expect(center.getByRole('heading', { name: '订阅套餐', exact: true })).toHaveCount(0);
  await center.getByRole('button', { name: '查看订阅套餐', exact: true }).click();
  await subscriptionPage.getByRole('button', { name: '退出登录' }).click();
  await expect(subscriptionPage.getByRole('button', { name: '登录 / 注册' })).toBeVisible();
  await expect(subscription.getByRole('heading', { name: '可用积分', exact: true })).toHaveCount(0);
  await expect(subscription.getByRole('button', { name: '登录并订阅' })).toHaveCount(2);
  await subscriptionPage.getByRole('button', { name: '返回', exact: true }).click();
  await center.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/new$/);
  await page.evaluate(() => localStorage.removeItem('opencreator.agent-setup-confirmed.v1'));
  await page.goto(`${runtime.origin}/#/subscription`);
  await expect(subscriptionPage).toBeVisible();
  await expect(subscription.getByRole('button', { name: '登录并订阅' })).toHaveCount(2);
  await expect(page.getByRole('region', { name: '开始使用 Agent' })).toHaveCount(0);
});

test('浏览器完成真实网关设备授权，缺少模型配置时保留登录并准确显示未就绪', async ({ page, runtime }, testInfo) => {
  test.skip(!process.env.GATEWAY_BROWSER_TEST_ORIGIN || !process.env.GATEWAY_DEMO_PASSWORD, 'Requires isolated local Go gateway');
  await page.addInitScript(() => {
    localStorage.setItem('opencreator.preferences.language', 'zh-CN');
    localStorage.setItem('opencreator.preferences.dynamicBackground', 'false');
  });
  await page.goto(`${runtime.origin}/#/new`);
  const setup = page.getByRole('region', { name: '开始使用 Agent' });
  await expect(setup.getByRole('button', { name: '本地模式', exact: true })).toBeVisible();
  await expect(setup.getByRole('button', { name: '登录模式', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('gateway-startup.png'), fullPage: true });
  await setup.getByRole('button', { name: '登录模式', exact: true }).click();
  await expect(setup.getByLabel('API Key')).toHaveCount(0);
  await expect(setup.getByLabel('Base URL')).toHaveCount(0);
  const account = page.getByRole('region', { name: 'OpenCreator 账户' });
  await account.getByRole('button', { name: '登录 OpenCreator' }).click();
  const link = account.getByRole('link', { name: '打开登录页面' });
  await expect(link).toBeVisible();
  const device = await page.context().newPage();
  await device.goto((await link.getAttribute('href'))!);
  await device.getByRole('link', { name: /Sign in/ }).click();
  await device.getByLabel('Email', { exact: true }).fill('gateway-demo@example.test');
  await device.getByLabel('Password', { exact: true }).fill(process.env.GATEWAY_DEMO_PASSWORD!);
  await device.getByRole('button', { name: 'Sign in', exact: true }).last().click();
  await device.getByRole('button', { name: 'Authorize', exact: true }).click();
  await expect(device.getByText('Device authorized.', { exact: true })).toBeVisible();
  await page.bringToFront();
  await expect.poll(async () => (await runtime.api<{ authState: string }>('GET', '/gateway/account')).authState).toBe('signed_in');
  await expect(setup).not.toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'OpenCreator', exact: true });
  const openNavigation = page.getByRole('button', { name: '打开导航', exact: true });
  if (await openNavigation.isVisible()) await openNavigation.click();
  await navigation.getByRole('button', { name: '个人中心', exact: true }).click();
  if (await openNavigation.isVisible()) await expect(page.getByLabel('OpenCreator 导航', { exact: true })).toHaveCSS('visibility', 'hidden');
  await expect(page).toHaveURL(/#\/account$/);
  await expect(navigation.getByRole('button', { name: '个人中心', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(navigation.getByRole('button', { name: '首页', exact: true })).not.toHaveAttribute('aria-current', 'page');
  const center = page.getByRole('main', { name: '个人中心', exact: true });
  await expect(center.getByRole('heading', { name: 'gateway-demo@example.test', exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(account.getByText('已登录', { exact: true })).toBeVisible();
  await expect(account.getByRole('group', { name: '使用模式' })).toHaveCount(0);
  await account.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(account.getByText('已登录', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify({ html: document.body.innerText, storage: { ...localStorage }, session: { ...sessionStorage } }))).not.toMatch(/ocg_[A-Za-z0-9_-]{32}|accessToken|refreshToken|modelKey/);
  await page.screenshot({ path: testInfo.outputPath('gateway-account.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await center.getByRole('button', { name: '查看订阅套餐', exact: true }).click();
  await expect(page).toHaveURL(/#\/subscription$/);
  const subscriptionPage = page.getByRole('main', { name: '订阅', exact: true });
  const subscription = subscriptionPage.getByRole('region', { name: '订阅与积分' });
  await expect(subscription.getByText('暂未开放订阅', { exact: true })).toBeVisible();
  await expect(subscription.getByText('可用积分', { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('gateway-subscription.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await account.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(account.getByRole('button', { name: '登录 / 注册' })).toBeVisible();
  await expect(subscription.getByRole('heading', { name: '可用积分', exact: true })).toHaveCount(0);
  await expect(subscription.getByText('登录后可查看', { exact: true })).toHaveCount(0);
  await expect(navigation.getByText('gateway-demo@example.test', { exact: true })).toHaveCount(0);
  await expect(subscriptionPage.getByRole('button', { name: '登录 / 注册' })).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('personal-center-guest.png'), fullPage: true });
  await subscriptionPage.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/account$/);
  await center.getByRole('button', { name: '返回', exact: true }).click();
  await expect(page).toHaveURL(/#\/new$/);
  if (await openNavigation.isVisible()) await openNavigation.click();
  await navigation.getByRole('button', { name: '设置', exact: true }).click();
  const settings = page.getByRole('navigation', { name: '设置分类' });
  await expect(settings.getByRole('button', { name: '账户', exact: true })).toHaveCount(0);
  await expect(settings.getByRole('button', { name: '订阅与积分', exact: true })).toHaveCount(0);
  await device.close();
});

test('网关账户和管理员页面展示真实零余额并限制未配置支付', async ({ page }, testInfo) => {
  test.skip(!process.env.GATEWAY_BROWSER_TEST_ORIGIN || !process.env.GATEWAY_DEMO_PASSWORD, 'Requires isolated local Go gateway');
  await page.goto(`${process.env.GATEWAY_BROWSER_TEST_ORIGIN}/auth`);
  await page.getByLabel('Email', { exact:true }).fill('gateway-demo@example.test');
  await page.getByLabel('Password', { exact:true }).fill(process.env.GATEWAY_DEMO_PASSWORD!);
  await page.getByRole('button', { name:'Sign in',exact:true }).last().click();
  await expect(page.getByRole('heading',{name:'Account',exact:true})).toBeVisible();
  await expect(page.locator('#available')).toHaveText('0');
  await expect(page.locator('#subscribe button')).toBeDisabled();
  await page.screenshot({path:testInfo.outputPath('go-account.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.goto(`${process.env.GATEWAY_BROWSER_TEST_ORIGIN}/admin`);
  await expect(page.getByRole('heading',{name:'Administration',exact:true})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('go-admin.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
