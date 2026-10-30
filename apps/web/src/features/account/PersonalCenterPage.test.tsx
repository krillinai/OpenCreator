import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { GatewayAccountState } from '@opencreator/protocol';
import { LanguageProvider, useAppLanguage } from '../../i18n/LanguageProvider.js';
import { createLocalizedCopy } from '../../i18n/localized-copy.js';
import type { GatewayAccountSettingsService, GatewayBillingSummary } from '../../services/gateway-account-service.js';
import PersonalCenterPage from './PersonalCenterPage.js';

afterEach(() => { cleanup(); sessionStorage.clear(); localStorage.clear(); });
const signedOut: GatewayAccountState = { source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null, bindingVersion: null, models: [], activationError: null };
const signedIn: GatewayAccountState = { ...signedOut, source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true } };
const summary: GatewayBillingSummary = { balance: { availableUnits: '123000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' }, subscription: null, billingAvailable: true };
function createService(initial = signedIn): GatewayAccountSettingsService {
  return { getState: vi.fn(async () => initial), start: vi.fn(), cancel: vi.fn(), logout: vi.fn(async () => signedOut), activate: vi.fn(), setSource: vi.fn(), selectModel: vi.fn(), getBalance: vi.fn(), getSummary: vi.fn(async () => summary), getPlans: vi.fn(async () => ({ plans: [], billingAvailable: false })), getOrders: vi.fn(async () => ({ items: [] })), getOrder: vi.fn(), getCreditGrants: vi.fn(async () => ({ items: [] })), checkout: vi.fn(), portal: vi.fn() };
}
function page(service: GatewayAccountSettingsService | null, accountState?: GatewayAccountState, onBack = vi.fn(), openExternal = vi.fn(), view: 'account' | 'subscription' = 'account', onOpenModelSettings = vi.fn()) {
  return <LanguageProvider initialPreference="zh-CN"><PersonalCenterPage view={view} service={service} accountState={accountState} onBack={onBack} openExternal={openExternal} onOpenModelSettings={onOpenModelSettings}/></LanguageProvider>;
}
it.each(['sv-SE', 'ja-JP'] as const)('localizes account actions in %s and keeps the email intact', async language => {
  const l = createLocalizedCopy(language);
  render(<LanguageProvider initialPreference={language}><PersonalCenterPage service={createService()} accountState={signedIn} onBack={vi.fn()} /></LanguageProvider>);
  expect(await screen.findByText('123')).toBeVisible();
  expect(screen.getByRole('main', { name: l('个人中心', 'Account') })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'a@example.test' })).toBeVisible();
  expect(screen.getByRole('button', { name: l('返回', 'Back') })).toBeEnabled();
});

it('switches the complete personal center from Chinese to English', async () => {
  function SwitchLanguage() {
    const { setPreference } = useAppLanguage();
    return <button type="button" onClick={() => setPreference('en-US')}>Switch to English</button>;
  }
  render(<LanguageProvider initialPreference="zh-CN"><SwitchLanguage /><PersonalCenterPage service={createService()} accountState={signedIn} onBack={vi.fn()} /></LanguageProvider>);
  expect(screen.getByRole('main', { name: '个人中心' })).toBeVisible();
  expect(await screen.findByText('已登录', { exact: true })).toBeVisible();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Switch to English' }));
  expect(screen.getByRole('main', { name: 'Account' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Credit balance' })).toBeVisible();
  expect(screen.getByText('Signed in', { exact: true })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Buy credits' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Billing and recharge history' })).toBeVisible();
  expect(screen.queryByText('个人中心')).not.toBeInTheDocument();
  expect(screen.queryByText('充值积分')).not.toBeInTheDocument();
});

it('provides a single login action and a credits entry with no fabricated guest balance', async () => {
  const service = createService(signedOut); const open = vi.fn();
  render(page(service, signedOut, vi.fn(), open));
  expect(await screen.findByRole('button', { name: '登录 / 注册' })).toBeEnabled();
  expect(screen.getAllByRole('button', { name: '登录 / 注册' })).toHaveLength(1);
  await userEvent.setup().click(screen.getByRole('button', { name: '充值积分' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(open).toHaveBeenCalledWith(expect.stringContaining('/pricing?lang=zh'));
  expect(screen.queryByText('123')).not.toBeInTheDocument();
  expect(service.getSummary).not.toHaveBeenCalled();
});
it('keeps the old recharge route on the unified personal center', async () => {
  const service = createService(signedOut);
  render(page(service, signedOut, vi.fn(), vi.fn(), 'subscription'));
  expect(screen.getByRole('main', { name: '个人中心' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: '充值积分' })).toBeEnabled();
  expect(service.checkout).not.toHaveBeenCalled();
  expect(service.getSummary).not.toHaveBeenCalled();
});
it('shows account and credits and returns to the previous view', async () => {
  const back = vi.fn();
  render(page(createService(), signedIn, back));
  expect(await screen.findByText('123')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'a@example.test' })).toBeInTheDocument();
  expect(screen.getByText('已登录', { exact: true })).toBeInTheDocument();
  expect(screen.queryByText('未订阅')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('API Key')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '返回' }));
  expect(back).toHaveBeenCalledOnce();
});
it.each([undefined, 'gateway'] as const)('keeps route selection hidden while restoring a gateway account (transport=%s)', async transport => {
  const restoring: GatewayAccountState = { ...signedIn, transport, supplier: 'chatanywhere', activationState: 'loading' };
  const ready: GatewayAccountState = { ...restoring, transport: 'gateway', activationState: 'ready' };
  const service = createService(ready);
  let complete!: (state: GatewayAccountState) => void;
  vi.mocked(service.getState).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  service.setRegion = vi.fn();
  render(page(service, restoring));
  expect(screen.getByText('官方模型服务正在连接')).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '连接区域' })).not.toBeInTheDocument();
  await act(async () => complete(ready));
  await waitFor(() => expect(screen.queryByText('官方模型服务正在连接')).not.toBeInTheDocument());
  expect(screen.getByText('已登录', { exact: true })).toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: '连接区域' })).not.toBeInTheDocument();
  expect(service.setRegion).not.toHaveBeenCalled();
});
it('forwards active task state to the credit estimate and hides it when work ends', async () => {
  const service = createService();
  vi.mocked(service.getSummary).mockResolvedValue({ ...summary, balance: { ...summary.balance, reservedUnits: '1000000' } });
  const view = render(<LanguageProvider initialPreference="zh-CN"><PersonalCenterPage service={service} accountState={signedIn} hasActiveTasks onBack={vi.fn()} /></LanguageProvider>);
  expect(await screen.findByText('预估消耗', { exact: true })).toBeInTheDocument();
  view.rerender(<LanguageProvider initialPreference="zh-CN"><PersonalCenterPage service={service} accountState={signedIn} hasActiveTasks={false} onBack={vi.fn()} /></LanguageProvider>);
  expect(screen.queryByText('预估消耗', { exact: true })).not.toBeInTheDocument();
});
it('loads credits immediately after login', async () => {
  const service = createService(signedOut); const open = vi.fn();
  vi.mocked(service.start).mockImplementation(async () => { vi.mocked(service.getState).mockResolvedValue(signedIn); return { attemptId: 'attempt', authorizationUrl: 'https://gateway.example/device', expiresAt: '2026-10-08T00:00:00Z' }; });
  render(page(service, signedOut, vi.fn(), open));
  await userEvent.setup().click(await screen.findByRole('button', { name: '登录 / 注册' }));
  expect(await screen.findByText('123')).toBeInTheDocument();
  expect(open).toHaveBeenCalledWith('https://gateway.example/device?lang=zh');
});
it('clears the balance after logout', async () => {
  const service = createService();
  vi.mocked(service.logout).mockImplementation(async () => { vi.mocked(service.getState).mockResolvedValue(signedOut); return signedOut; });
  render(page(service, signedIn, vi.fn(), vi.fn(), 'subscription'));
  expect(await screen.findByText('123')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByLabelText('账号菜单'));
  await userEvent.setup().click(screen.getByRole('button', { name: '退出登录' }));
  expect(await screen.findByRole('button', { name: '登录 / 注册' })).toBeInTheDocument();
  expect(screen.queryByText('123')).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: '充值订单' })).not.toBeInTheDocument();
});
it('ignores a previous account balance response after switching accounts', async () => {
  const service = createService(); let complete!: (result: GatewayBillingSummary) => void;
  vi.mocked(service.getSummary).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const view = render(page(service, signedIn));
  await waitFor(() => expect(service.getSummary).toHaveBeenCalledOnce());
  const next = { ...signedIn, account: { id: 'b', email: 'b@example.test', verified: true } };
  vi.mocked(service.getState).mockResolvedValue(next);
  vi.mocked(service.getSummary).mockResolvedValue({ ...summary, balance: { ...summary.balance, availableUnits: '8000000' } });
  view.rerender(page(service, next));
  expect(await screen.findByText('8')).toBeInTheDocument();
  await act(async () => complete(summary));
  expect(screen.queryByText('123')).not.toBeInTheDocument();
});
it('shows unavailable login without an enabled action', () => {
  render(page(null));
  expect(within(screen.getByRole('region', { name: 'OpenCreator 账户' })).getByText('登录服务暂不可用')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登录 / 注册' })).toBeDisabled();
});
it('keeps model availability separate from sign-in and opens model settings', async () => {
  const blocked = { ...signedIn, activationState: 'blocked' as const, activationError: { code: 'services_not_ready', message: 'Unavailable' } };
  const settings = vi.fn();
  render(page(createService(blocked), blocked, vi.fn(), vi.fn(), 'account', settings));
  expect(await screen.findByText('已登录', { exact: true })).toBeInTheDocument();
  expect(screen.getByText('官方模型服务暂不可用')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('官方模型服务连接失败，请重新连接');
  await userEvent.setup().click(screen.getByRole('button', { name: '模型设置' }));
  expect(settings).toHaveBeenCalledOnce();
});

it('reconnects model services from the personal center without signing in again or affecting credits', async () => {
  const blocked: GatewayAccountState = { ...signedIn, activationState: 'blocked', activationError: { code: 'gateway_unavailable', message: 'Unavailable', stage: 'bootstrap', request: { path: '/api/v1/client/bootstrap', reason: 'timeout' } } };
  const service = createService(blocked);
  vi.mocked(service.activate).mockImplementation(async () => {
    vi.mocked(service.getState).mockResolvedValue(signedIn);
    return signedIn;
  });
  render(page(service, blocked));
  expect(await screen.findByText('123')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('网关请求超时');
  expect(screen.getByRole('alert')).toHaveTextContent('获取模型凭据');
  await userEvent.setup().click(screen.getByRole('button', { name: '重新连接' }));
  await waitFor(() => expect(screen.queryByText('官方模型服务暂不可用')).not.toBeInTheDocument());
  expect(service.activate).toHaveBeenCalledOnce();
  expect(service.start).not.toHaveBeenCalled();
  expect(service.selectModel).not.toHaveBeenCalled();
  expect(screen.getByText('123')).toBeInTheDocument();
});
