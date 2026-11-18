import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { NetworkSettings } from './NetworkSettings.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';

function service() {
  return { getNetwork: vi.fn(async () => ({ proxy: 'http://127.0.0.1:7897' })), saveNetwork: vi.fn(async (value: { proxy: string }) => value),
    testNetwork: vi.fn(async () => ({ status: 'proxy_unreachable' as const })), getConfig: vi.fn(), saveConfig: vi.fn() } as unknown as CreatorServicesSettingsService;
}

it('saves and clears a proxy through the independent network API', async () => {
  const api = service(); const user = userEvent.setup();
  render(<NetworkSettings connected service={api} />);
  const input = await screen.findByDisplayValue('http://127.0.0.1:7897');
  await user.clear(input); await user.type(input, 'http://127.0.0.1:8888');
  await user.click(screen.getByRole('button', { name: '保存网络代理' }));
  expect(api.saveNetwork).toHaveBeenCalledWith({ proxy: 'http://127.0.0.1:8888' });
  await user.clear(input); await user.click(screen.getByRole('button', { name: '保存网络代理' }));
  expect(api.saveNetwork).toHaveBeenLastCalledWith({ proxy: '' });
  expect(api.getConfig).not.toHaveBeenCalled(); expect(api.saveConfig).not.toHaveBeenCalled();
});

it('rejects an unsupported proxy without changing any configuration', async () => {
  const api = service(); const user = userEvent.setup(); render(<NetworkSettings connected service={api} />);
  const input = await screen.findByDisplayValue('http://127.0.0.1:7897');
  await user.clear(input); await user.type(input, 'socks5://127.0.0.1:1080');
  await user.click(screen.getByRole('button', { name: '保存网络代理' }));
  expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的 HTTP 或 HTTPS 代理地址');
  expect(api.saveNetwork).not.toHaveBeenCalled();
});

it('tests the draft proxy and explains when its endpoint cannot be reached', async () => {
  const api = service(); const user = userEvent.setup(); render(<NetworkSettings connected service={api} />);
  const input = await screen.findByDisplayValue('http://127.0.0.1:7897');
  await user.clear(input); await user.type(input, 'http://127.0.0.1:8888');
  await user.click(screen.getByRole('button', { name: '检测代理连接' }));
  expect(api.testNetwork).toHaveBeenCalledWith({ proxy: 'http://127.0.0.1:8888' });
  expect(await screen.findByRole('status')).toHaveTextContent('无法连接代理服务');
  expect(api.saveNetwork).not.toHaveBeenCalled();
});

it.each([
  ['en-US', 'The proxy is reachable, but the video site cannot be accessed through it.'],
  ['sv-SE', 'Proxyn kan nås, men videoportalen kan inte nås via den.']
] as const)('localizes the upstream probe result in %s', async (language, message) => {
  const api = service();
  vi.mocked(api.testNetwork!).mockResolvedValue({ status: 'upstream_unreachable' });
  const user = userEvent.setup();
  render(<LanguageProvider initialPreference={language}><NetworkSettings connected service={api} /></LanguageProvider>);
  await screen.findByDisplayValue('http://127.0.0.1:7897');
  await user.click(screen.getByRole('button', { name: language === 'en-US' ? 'Test proxy connection' : 'Testa proxyanslutning' }));
  expect(await screen.findByRole('status')).toHaveTextContent(message);
  expect(screen.getByRole('status')).not.toHaveTextContent(/无法经代理访问/);
});

it.each([
  ['zh-CN', '代理要求认证'],
  ['en-US', 'The proxy requires authentication'],
  ['sv-SE', 'Proxyn kräver autentisering']
] as const)('explains proxy authentication in %s', async (language, message) => {
  const api = service();
  vi.mocked(api.testNetwork!).mockResolvedValue({ status: 'proxy_auth_required' });
  render(<LanguageProvider initialPreference={language}><NetworkSettings connected service={api} /></LanguageProvider>);
  await screen.findByDisplayValue('http://127.0.0.1:7897');
  await userEvent.setup().click(screen.getByRole('button', { name: language === 'zh-CN' ? '检测代理连接'
    : language === 'en-US' ? 'Test proxy connection' : 'Testa proxyanslutning' }));
  expect(await screen.findByRole('status')).toHaveTextContent(message);
});
