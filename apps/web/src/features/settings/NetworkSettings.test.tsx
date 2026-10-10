import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { NetworkSettings } from './NetworkSettings.js';
import type { CreatorServicesSettingsService } from '../../services/creator-services-service.js';

function service() {
  return { getNetwork: vi.fn(async () => ({ proxy: 'http://127.0.0.1:7897' })), saveNetwork: vi.fn(async (value: { proxy: string }) => value), getConfig: vi.fn(), saveConfig: vi.fn() } as unknown as CreatorServicesSettingsService;
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
