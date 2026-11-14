import { selectOption } from '../../test/select-option.js';
import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { GatewayAccountSettingsView } from './GatewayAccountSettingsView.js';
import { GatewaySubscriptionSettingsView } from './GatewaySubscriptionSettingsView.js';
import type { GatewayAccountSettingsService } from '../../services/gateway-account-service.js';
import type { GatewayAccountState } from '@opencreator/protocol';
afterEach(() => { cleanup(); sessionStorage.clear(); window.location.hash = '#/'; });
const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', models: [], activationError: null };
function service(): GatewayAccountSettingsService {
  return { getState: vi.fn(async () => state), start: vi.fn(), cancel: vi.fn(), logout: vi.fn(), activate: vi.fn(), setSource: vi.fn(), selectModel: vi.fn(),
    getBalance: vi.fn(),
    getSummary: vi.fn(async () => ({ balance: { availableUnits: '123000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' }, subscription: null, billingAvailable: true, purchaseMode: 'credits' as const, plansUrl: 'https://www.open-creator.ai/pricing' })),
    getPlans: vi.fn(async () => ({ plans: [{ id: 'starter', name: 'Starter', amountUnits: '500', creditUnits: '2500000000', currency: 'usd' }], billingAvailable: true })), getOrders: vi.fn(async () => ({ items: [] })), getOrder: vi.fn(), getCreditGrants: vi.fn(async () => ({ items: [] })), checkout: vi.fn(), portal: vi.fn() };
}
it('changes the ChatAnywhere region without offering supplier self-selection', async () => {
  const value = service();
  const initial = { ...state, transport: 'supplier-direct' as const, supplier: 'chatanywhere' as const, supplierRegion: 'auto' as const };
  vi.mocked(value.getState).mockResolvedValue(initial);
  value.setRegion = vi.fn(async region => ({ ...initial, supplierRegion: region }));
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView service={value}/></LanguageProvider>);
  const region = await screen.findByRole('combobox', { name: '连接区域' });
  selectOption(region, 'overseas');
  await waitFor(() => expect(value.setRegion).toHaveBeenCalledWith('overseas'));
  expect(region).toHaveValue('overseas');
});
it('keeps supplier region settings hidden when the server owns the gateway route', async () => {
  const value = service();
  vi.mocked(value.getState).mockResolvedValue({ ...state, transport: 'gateway', supplier: 'chatanywhere' });
  value.setRegion = vi.fn();
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView service={value}/></LanguageProvider>);
  await screen.findByText('已登录，可以开始创作');
  expect(screen.queryByRole('combobox', { name: '连接区域' })).not.toBeInTheDocument();
});
it('shows a supplier migration on the signed-in profile', async () => {
  const value = service();
  vi.mocked(value.getState).mockResolvedValue({ ...state, activationState: 'blocked', activationError: { code: 'supplier_migrating', message: 'Switching supplier' } });
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView variant="profile" service={value}/></LanguageProvider>);
  expect(await screen.findByText('官方服务维护中，完成后将自动恢复。')).toBeInTheDocument();
});
it('shows an expired session explicitly and keeps reauthorization available', async () => {
  const value = service();
  vi.mocked(value.getState).mockResolvedValue({ ...state, authState: 'expired', activationState: 'inactive' });
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('登录已过期，请重新登录')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登录 OpenCreator' })).toBeEnabled();
});
it('checks authorization on return and displays sign-in before model services are ready', async () => {
  const value = service();
  vi.mocked(value.getState).mockResolvedValue({ ...state, authState: 'authorizing', activationState: 'loading', account: null });
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView variant="profile" service={value}/></LanguageProvider>);
  expect(await screen.findByText('请在浏览器中完成登录')).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('正在确认登录结果…')).toBeInTheDocument();
  vi.mocked(value.getState).mockResolvedValue({ ...state, activationState: 'loading' });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('已登录', { exact: true })).toBeInTheDocument();
  expect(value.getState).toHaveBeenLastCalledWith({ checkAuthorization: true });
  await userEvent.setup().click(screen.getByLabelText('账号菜单'));
  expect(screen.getByRole('button', { name: '退出登录' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: '重新连接' })).not.toBeInTheDocument();
});
it('checks authorization when a browser callback includes its originating tab', async () => {
  window.location.hash = '#/account?login=complete&tabId=original-tab';
  const value = service();
  vi.mocked(value.getState).mockResolvedValue({ ...state, authState: 'authorizing', activationState: 'loading', account: null });
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView variant="profile" service={value}/></LanguageProvider>);

  expect(await screen.findByText('正在确认登录结果…')).toBeInTheDocument();
  expect(value.getState).toHaveBeenCalledWith({ checkAuthorization: true });
});
it('describes an expired authorization as a sign-in problem with a retry entry', async () => {
  const value = service();
  vi.mocked(value.getState).mockResolvedValue({ ...state, source: 'manual', authState: 'signed_out', activationState: 'inactive', account: null,
    activationError: { code: 'device_expired', message: 'Expired' } });
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView variant="profile" service={value}/></LanguageProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent('登录授权已过期，请重新登录。');
  expect(screen.getByRole('button', { name: '登录 / 注册' })).toBeEnabled();
});
it('shows credits and opens the existing website for recharge', async () => {
  const value = service(); const open = vi.fn();
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value} openExternal={open}/></LanguageProvider>);
  expect(await screen.findByText('123')).toBeInTheDocument();
  expect(screen.queryByText('未订阅')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '充值积分' }));
  expect(open).toHaveBeenCalledWith(expect.stringContaining('https://www.open-creator.ai/pricing'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(value.checkout).not.toHaveBeenCalled();
  expect(value.portal).not.toHaveBeenCalled();
});
it('keeps a plans link available with purchases disabled', async () => {
  const value = service();
  vi.mocked(value.getSummary).mockResolvedValue({ balance: { availableUnits: '0', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' }, subscription: null, billingAvailable: false });
  const open = vi.fn();
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value} openExternal={open}/></LanguageProvider>);
  expect(await screen.findByText('0')).toBeInTheDocument();
  expect(screen.queryByText(/充值暂不可用/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '充值积分' })).toBeEnabled();
  await userEvent.setup().click(screen.getByRole('button', { name: '充值积分' }));
  expect(open).toHaveBeenCalledOnce();
});
it('shows account-specific refund review and leaves billing management accessible', async () => {
  const value = service();
  vi.mocked(value.getSummary).mockResolvedValue({ balance: { availableUnits: '1000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' }, subscription: null, billingAvailable: false, paymentReview: true });
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('付款正在审核，充值和积分使用已暂停，请联系客服。')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '账单与充值记录' })).toBeEnabled();
  expect(value.checkout).not.toHaveBeenCalled();
});
it('keeps the last balance marked stale on failure and recovers through retry', async () => {
  const value = service();
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('123')).toBeInTheDocument();
  vi.mocked(value.getSummary).mockRejectedValueOnce(new Error('offline'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('积分信息加载失败');
  expect(screen.getByText(/上次更新/)).toBeInTheDocument();
  expect(screen.getByText('123')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '充值积分' })).toBeEnabled();
  await userEvent.setup().click(screen.getByRole('button', { name: '刷新积分' }));
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
it('refreshes the purchased balance on application focus', async () => {
  const value = service();
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('123')).toBeInTheDocument();
  vi.mocked(value.getSummary).mockResolvedValue({ balance: { availableUnits: '2500000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-07T01:00:00Z' }, subscription: null, billingAvailable: true });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('2500')).toBeInTheDocument();
});
it('rejects invalid website URL schemes', async () => {
  const value = service();
  value.openWebAccount = vi.fn(async () => ({ url: 'javascript:alert(1)' }));
  const open = vi.fn();
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value} openExternal={open}/></LanguageProvider>);
  expect(await screen.findByText('123')).toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '充值积分' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('网页未打开');
  expect(open).not.toHaveBeenCalled();
});
it('reconnects a signed-in account without manual provider fields', async () => {
  const value = service(); const changed = vi.fn();
  vi.mocked(value.getState).mockResolvedValue({ ...state, activationState: 'blocked' });
  vi.mocked(value.activate).mockResolvedValue(state);
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView variant="login" service={value} onStateChange={changed}/></LanguageProvider>);
  expect(await screen.findByText('已登录，模型服务暂不可用')).toBeInTheDocument();
  expect(screen.queryByText('Base URL')).not.toBeInTheDocument();
  expect(screen.queryByText('API Key')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '重新连接' }));
  await waitFor(() => expect(changed).toHaveBeenLastCalledWith(state));
});

it('refreshes the user model catalog from the account menu', async () => {
  const value = service();
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView variant="profile" service={value}/></LanguageProvider>);
  await screen.findByText('已登录', { exact: true });
  await userEvent.setup().click(screen.getByLabelText('账号菜单'));
  await userEvent.setup().click(screen.getByRole('button', { name: '刷新模型' }));
  await waitFor(() => expect(value.getState).toHaveBeenLastCalledWith({ checkAuthorization: false, refreshModels: true }));
});

it.each([
  ['model_catalog_unavailable', '模型列表暂时无法获取，请重试。'],
  ['no_available_models', '当前没有可用的文本模型。']
])('shows %s separately from sign-in failures', async (code, message) => {
  const value = service();
  vi.mocked(value.getState).mockResolvedValue({ ...state, activationState: 'blocked', activationError: { code, message: 'Unavailable' } });
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView variant="login" service={value}/></LanguageProvider>);
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: '重新连接' })).toBeEnabled();
});
