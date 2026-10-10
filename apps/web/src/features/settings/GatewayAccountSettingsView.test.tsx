import { act, render, screen, cleanup, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { GatewayAccountSettingsView } from './GatewayAccountSettingsView.js';
import { GatewaySubscriptionSettingsView } from './GatewaySubscriptionSettingsView.js';
import type { GatewayAccountSettingsService } from '../../services/gateway-account-service.js';
import type { GatewayAccountState } from '@opencreator/protocol';
afterEach(cleanup);
const state: GatewayAccountState = { source: 'gateway', authState: 'signed_in', activationState: 'ready', account: { id: 'a', email: 'a@example.test', verified: true }, bindingVersion: 'a:1', models: [], activationError: null };
function service(): GatewayAccountSettingsService {
  return { getState: vi.fn(async () => state), start: vi.fn(), cancel: vi.fn(), logout: vi.fn(), activate: vi.fn(), setSource: vi.fn(), selectModel: vi.fn(),
    getBalance: vi.fn(),
    getSummary: vi.fn(async () => ({ balance: { availableUnits: '123000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' }, subscription: null, billingAvailable: true, purchaseMode: 'credits' as const, plansUrl: 'https://www.open-creator.ai/pricing' })),
    getPlans: vi.fn(), checkout: vi.fn(), portal: vi.fn() };
}
it('shows an expired session explicitly and keeps reauthorization available', async () => {
  const value = service();
  vi.mocked(value.getState).mockResolvedValue({ ...state, authState: 'expired', activationState: 'inactive' });
  render(<LanguageProvider initialPreference="zh-CN"><GatewayAccountSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('登录已过期，请重新登录')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '登录 OpenCreator' })).toBeEnabled();
});
it('shows credits and opens website recharge without creating checkout in the application', async () => {
  const value = service(); const open = vi.fn();
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value} openExternal={open}/></LanguageProvider>);
  expect(await screen.findByText('123')).toBeInTheDocument();
  expect(screen.queryByText('未订阅')).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole('button', { name: '充值积分' }));
  expect(open).toHaveBeenCalledWith('https://www.open-creator.ai/pricing?lang=zh');
  expect(value.checkout).not.toHaveBeenCalled();
  expect(value.portal).not.toHaveBeenCalled();
});
it('keeps a plans link available with purchases disabled', async () => {
  const value = service();
  vi.mocked(value.getSummary).mockResolvedValue({ balance: { availableUnits: '0', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' }, subscription: null, billingAvailable: false });
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('充值暂不可用')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '充值积分' })).toBeDisabled();
  expect(screen.getByRole('link', { name: '查看积分方案' })).toHaveAttribute('href', 'https://www.open-creator.ai/pricing?lang=zh');
});
it('shows refund review and prevents new recharge', async () => {
  const value = service();
  vi.mocked(value.getSummary).mockResolvedValue({ balance: { availableUnits: '1000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' }, subscription: null, billingAvailable: false, paymentReview: true });
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('付款正在审核，积分使用已暂停，请联系客服')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '充值积分' })).toBeDisabled();
});
it('keeps the last balance marked stale on failure and recovers through retry', async () => {
  const value = service();
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('123')).toBeInTheDocument();
  vi.mocked(value.getSummary).mockRejectedValueOnce(new Error('offline'));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('积分信息暂不可用');
  expect(screen.getByText(/上次更新/)).toBeInTheDocument();
  expect(screen.getByText('123')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '充值积分' })).toBeDisabled();
  await userEvent.setup().click(screen.getByRole('button', { name: '重试' }));
  await waitFor(() => expect(screen.getByRole('button', { name: '充值积分' })).toBeEnabled());
});
it('refreshes the purchased balance on application focus', async () => {
  const value = service();
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByText('123')).toBeInTheDocument();
  vi.mocked(value.getSummary).mockResolvedValue({ balance: { availableUnits: '2500000000', reservedUnits: '0', periodEnd: null, asOf: '2026-10-07T01:00:00Z' }, subscription: null, billingAvailable: true });
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByText('2500')).toBeInTheDocument();
});
it('rejects invalid recharge URL schemes', async () => {
  const value = service();
  vi.mocked(value.getSummary).mockResolvedValue({ balance: { availableUnits: '0', reservedUnits: '0', periodEnd: null, asOf: '2026-10-05T01:00:00Z' }, subscription: null, billingAvailable: true, plansUrl: 'javascript:alert(1)' });
  render(<LanguageProvider initialPreference="zh-CN"><GatewaySubscriptionSettingsView service={value}/></LanguageProvider>);
  expect(await screen.findByRole('button', { name: '充值积分' })).toBeDisabled();
  expect(screen.queryByRole('link', { name: '查看积分方案' })).not.toBeInTheDocument();
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
