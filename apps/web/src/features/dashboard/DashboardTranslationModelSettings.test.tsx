import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import DashboardTranslationModelSettings from './DashboardTranslationModelSettings.js';

vi.mock('../settings/CreatorServicesSettingsView.js', () => ({
  CreatorServicesSettingsView: () => <div>模型配置面板</div>
}));

describe('DashboardTranslationModelSettings', () => {
  it('opens the real model settings and refreshes the selected service summary', async () => {
    const service = {
      getConfig: vi.fn(async () => ({ config: createDefaultCreatorServicesConfig() }))
    };
    render(
      <LanguageProvider initialPreference="zh-CN">
        <DashboardTranslationModelSettings service={service as never} />
      </LanguageProvider>
    );

    const trigger = await screen.findByRole('button', { name: '设置翻译模型' });
    expect(trigger).toHaveTextContent('本机 Codex');
    expect(trigger.querySelector('[data-brand="openai"] img')).not.toBeNull();
    fireEvent.click(trigger);

    expect(await screen.findByRole('dialog', { name: '翻译模型设置' })).toBeInTheDocument();
    expect(screen.getByText('模型配置面板')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭模型设置' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(service.getConfig).toHaveBeenCalledTimes(2);
  });
});
