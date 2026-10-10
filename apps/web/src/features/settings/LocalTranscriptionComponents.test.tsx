import type { CreatorLocalComponent, CreatorRuntimeComponentsResponse } from '@opencreator/protocol';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { languagePreferenceStorageKey } from '../../i18n/language.js';
import type { RuntimeDependenciesController } from '../../app/use-runtime-dependencies.js';
import { RuntimeManagedComponents as LocalTranscriptionComponents } from './RuntimeManagedComponents.js';
import { LocalTranscriptionNotice } from '../dashboard/LocalTranscriptionNotice.js';
import { LanguageSwitchControls } from '../../test/LanguageSwitchControls.js';
import { createLocalizedCopy } from '../../i18n/localized-copy.js';
import { localComponentPreparationMessage } from './local-component-copy.js';

beforeEach(() => window.localStorage.removeItem(languagePreferenceStorageKey));

function componentFixture(patch: Partial<CreatorLocalComponent> = {}): CreatorLocalComponent {
  return { id: 'whisperkit', name: 'WhisperKit', available: true, version: null, supportedVersion: '1.1.0', installedAt: null,
    path: '/runtime/dependencies', source: 'Homebrew / ModelScope', models: [{ id: 'large-v2', installed: false, bytes: null }],
    state: 'not_installed', model: 'large-v2', item: null, downloadedBytes: 0, totalBytes: null, percent: null, bytesPerSecond: null, remainingSeconds: null, error: null, ...patch };
}

function controllerFixture(patch: Partial<CreatorLocalComponent> = {}, provider = 'whisperkit') {
  const componentsStatus: CreatorRuntimeComponentsResponse = { platform: 'darwin', arch: 'arm64', selectedProvider: provider, selectedModel: 'large-v2', components: [componentFixture(patch)] };
  const controller: RuntimeDependenciesController = { phase: 'idle', componentsStatus, downloadComponents: vi.fn(async () => {}), refreshComponents: vi.fn(async () => {}), checkYtDlpUpdate: vi.fn(), updateYtDlp: vi.fn() };
  return controller;
}

const managedComponents = [
  { id: 'whisperkit', name: 'WhisperKit', version: '1.1.0', previousVersion: '1.0.0' },
  { id: 'remotion', name: 'Remotion', version: '4.0.473', previousVersion: '4.0.472' }
] as const;

describe('local transcription component management', () => {
  it('offers independent Remotion installation without transcription model fields', async () => {
    const controller = controllerFixture({}, 'openai');
    controller.componentsStatus!.components = [{ ...componentFixture(), id: 'remotion', name: 'Remotion', model: null, models: [], supportedVersion: '4.0.473' }];
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} componentId="remotion" /></LanguageProvider>);
    expect(screen.getByRole('heading', { name: 'Remotion' })).toBeVisible();
    expect(screen.getByText(/仅在执行渲染时按需下载/)).toBeVisible();
    expect(screen.queryByText('当前模型')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '调整转录设置' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载组件' }));
    expect(controller.downloadComponents).toHaveBeenCalledWith('remotion');
    await waitFor(() => expect(screen.getByRole('button', { name: '下载组件' })).toBeEnabled());
  });

  it('keeps Remotion progress visible and does not describe it as transcription', () => {
    const controller = controllerFixture({}, 'openai');
    controller.componentsStatus!.components = [{ ...componentFixture({ state: 'downloading', percent: 50, downloadedBytes: 1024 ** 2, totalBytes: 2 * 1024 ** 2 }), id: 'remotion', name: 'Remotion', model: null, models: [] }];
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    expect(screen.getByText('正在下载 Remotion 渲染组件')).toBeVisible();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50');
    expect(screen.queryByText(/当前尚未开始转录/)).not.toBeInTheDocument();
    expect(controller.downloadComponents).not.toHaveBeenCalled();
  });

  it.each(['downloading', 'verifying', 'extracting'] as const)('switches %s progress copy without restarting component preparation', state => {
    const rawMessage = '后台原文：正在校验转录模型';
    const controller = controllerFixture({ state, percent: 50, downloadedBytes: 1024 ** 3, totalBytes: 2 * 1024 ** 3, message: rawMessage });
    render(<LanguageProvider initialPreference="zh-CN"><LanguageSwitchControls /><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    for (const language of ['zh-CN', 'en-US', 'sv-SE'] as const) {
      fireEvent.click(screen.getByRole('button', { name: language }));
      const expected = localComponentPreparationMessage(state, createLocalizedCopy(language));
      expect(screen.getByText(expected)).toBeVisible();
      if (language !== 'zh-CN') expect(expected).not.toMatch(/\p{Script=Han}/u);
      if (state === 'downloading') expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50');
      else expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    }
    expect(screen.queryByText(rawMessage)).not.toBeInTheDocument();
    expect(controller.refreshComponents).toHaveBeenCalledOnce();
    expect(controller.downloadComponents).not.toHaveBeenCalled();
  });

  it('localizes a failed component while keeping its original error in a collapsed disclosure', () => {
    const raw = '下载模型失败：连接被拒绝';
    render(<LanguageProvider initialPreference="en-US"><LanguageSwitchControls /><LocalTranscriptionComponents controller={controllerFixture({ state: 'failed', error: raw })} /></LanguageProvider>);
    expect(screen.getByText(/Local transcription preparation failed/)).toBeVisible();
    expect(screen.getByText(raw)).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getByText(/Förberedelsen av lokal transkription misslyckades/)).toBeVisible();
    expect(screen.getByText(raw)).not.toBeVisible();
    fireEvent.click(screen.getByText('Visa ursprunglig diagnostik'));
    expect(screen.getByText(raw)).toBeVisible();
  });

  it('shows engine and model information and starts a manual download', async () => {
    const controller = controllerFixture();
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    expect(screen.getByRole('heading', { name: /WhisperKit/ })).toBeInTheDocument();
    expect(screen.getByText('当前模型')).toBeVisible();
    expect(screen.getByText('受支持版本')).not.toBeVisible();
    expect(screen.getByText('/runtime/dependencies')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '下载组件' }));
    expect(controller.downloadComponents).toHaveBeenCalledOnce();
    expect(controller.downloadComponents).toHaveBeenCalledWith('whisperkit');
    await waitFor(() => expect(screen.getByRole('button', { name: '下载组件' })).not.toBeDisabled());
  });

  it.each(['openai', 'aliyun', 'funasr'])('downloads an unselected component while using %s transcription', async provider => {
    const controller = controllerFixture({}, provider);
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);

    expect(screen.queryByText('当前使用')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '下载组件' }));

    expect(controller.downloadComponents).toHaveBeenCalledWith('whisperkit');
    expect(controller.componentsStatus?.selectedProvider).toBe(provider);
    await waitFor(() => expect(screen.getByRole('button', { name: '下载组件' })).not.toBeDisabled());
  });

  it.each(managedComponents)('hides updates for current $name and keeps checks read-only', async component => {
    const controller = controllerFixture({ state: 'ready', version: '1.1.0' });
    controller.componentsStatus!.components = [{ ...componentFixture({ state: 'ready' }), id: component.id, name: component.name, version: component.version, supportedVersion: component.version }];
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    expect(controller.refreshComponents).toHaveBeenCalledOnce();
    const button = screen.getByRole('button', { name: '检查更新' });
    expect(button).toHaveClass('settings-secondary-button');
    expect(button.closest('.runtime-component-actions')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('已就绪');
    expect(screen.queryByRole('button', { name: /更新到|已是受支持版本|下载组件/ })).not.toBeInTheDocument();
    expect(controller.downloadComponents).not.toHaveBeenCalled();

    fireEvent.click(button);

    await waitFor(() => expect(screen.getByText('检查完成，当前组件无需更新。')).toBeVisible());
    expect(screen.queryByRole('button', { name: /更新到|已是受支持版本|下载组件/ })).not.toBeInTheDocument();
    expect(controller.refreshComponents).toHaveBeenCalledTimes(2);
    expect(controller.downloadComponents).not.toHaveBeenCalled();
  });

  it.each(managedComponents)('updates outdated $name without selecting it for transcription, then hides updates', async component => {
    const controller = controllerFixture({}, 'openai');
    controller.componentsStatus!.components = [{ ...componentFixture({ state: 'ready' }), id: component.id, name: component.name, version: component.previousVersion, supportedVersion: component.version }];
    const { rerender } = render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);

    expect(screen.getByRole('status')).toHaveTextContent('有可用更新');
    const update = screen.getByRole('button', { name: `更新到 ${component.version}` });
    expect(update).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));
    await waitFor(() => expect(screen.getByText(`检查完成，可更新到受支持版本 ${component.version}。`)).toBeVisible());
    expect(controller.downloadComponents).not.toHaveBeenCalled();
    fireEvent.click(update);

    expect(controller.downloadComponents).toHaveBeenCalledWith(component.id);
    expect(controller.componentsStatus?.selectedProvider).toBe('openai');
    await waitFor(() => expect(update).toBeEnabled());
    controller.componentsStatus = { ...controller.componentsStatus!, components: controller.componentsStatus!.components.map(installed => ({ ...installed, version: installed.supportedVersion })) };
    rerender(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    expect(screen.queryByRole('button', { name: /更新到|已是受支持版本|下载组件/ })).not.toBeInTheDocument();
    expect(controller.downloadComponents).toHaveBeenCalledOnce();
  });

  it('does not offer an update when the supported version is unknown', () => {
    const controller = controllerFixture({ state: 'ready', version: '1.1.0', supportedVersion: null });
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    expect(screen.getByRole('status')).toHaveTextContent('已就绪');
    expect(screen.queryByRole('button', { name: '已就绪' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /更新到/ })).not.toBeInTheDocument();
    expect(controller.downloadComponents).not.toHaveBeenCalled();
  });

  it('keeps checks read-only even when components are missing', async () => {
    const controller = controllerFixture();
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => expect(screen.getByText('组件状态已刷新，尚未开始下载。')).toBeVisible());
    expect(controller.downloadComponents).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '下载组件' })).toHaveClass('settings-primary-button');
  });

  it('disables duplicate actions until a status check completes', async () => {
    const controller = controllerFixture();
    let finish!: () => void;
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    vi.mocked(controller.refreshComponents!).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    expect(screen.getByRole('button', { name: '正在检查' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下载组件' })).toBeDisabled();
    await act(async () => { finish(); });
    expect(screen.getByRole('button', { name: '检查更新' })).not.toBeDisabled();
  });

  it('shows a failed status check without claiming success or starting a download', async () => {
    const controller = controllerFixture({ state: 'ready', version: '1.1.0' });
    render(<LanguageProvider><LanguageSwitchControls /><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    vi.mocked(controller.refreshComponents!).mockRejectedValueOnce(new Error('status unavailable'));

    fireEvent.click(screen.getByRole('button', { name: '检查更新' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('status unavailable'));
    expect(screen.queryByText('检查完成，当前组件无需更新。')).not.toBeInTheDocument();
    expect(controller.downloadComponents).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '检查更新' })).not.toBeDisabled();
    expect(screen.getByText('status unavailable')).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    expect(screen.getByText('Component status check failed. Check the service connection and retry.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getByText('Kontrollen av komponentstatus misslyckades. Kontrollera anslutningen till tjänsten och försök igen.')).toBeVisible();
    expect(screen.getByText('status unavailable')).not.toBeVisible();
    expect(controller.refreshComponents).toHaveBeenCalledTimes(2);
    expect(controller.downloadComponents).not.toHaveBeenCalled();
  });

  it('keeps detailed component information available in a collapsed disclosure', () => {
    render(<LanguageProvider><LocalTranscriptionComponents controller={controllerFixture({ state: 'ready', version: '1.1.0' })} /></LanguageProvider>);
    const path = screen.getByText('/runtime/dependencies');
    expect(path).not.toBeVisible();
    expect(path.closest('details')).not.toHaveAttribute('open');

    fireEvent.click(screen.getByText('组件详情'));

    expect(path).toBeVisible();
    expect(screen.getByText('受支持版本')).toBeVisible();
  });

  it.each([
    { state: 'partial' as const, name: '补齐组件' },
    { state: 'failed' as const, name: '重试下载' }
  ])('uses a specific primary action for $state components', async ({ state, name }) => {
    const controller = controllerFixture({ state, version: '1.1.0' });
    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);
    const button = screen.getByRole('button', { name });
    expect(button).toHaveClass('settings-primary-button');
    expect(screen.getByText(/将准备所需资源：large-v2 模型/)).toBeVisible();

    fireEvent.click(button);

    expect(controller.downloadComponents).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.getByRole('button', { name })).not.toBeDisabled());
  });

  it('shows real byte progress and explains the long preparation before transcription', () => {
    render(<LanguageProvider><LocalTranscriptionComponents controller={controllerFixture({ state: 'downloading', item: 'WhisperKit large-v2 model', downloadedBytes: 1024 ** 3, totalBytes: 2 * 1024 ** 3, percent: 50, bytesPerSecond: 1024 ** 2, remainingSeconds: 1024 })} /></LanguageProvider>);
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '50');
    expect(screen.getByText(/1.00 GiB \/ 2.00 GiB/)).toBeInTheDocument();
    expect(screen.getByText(/当前尚未开始转录/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([
    { state: 'verifying' as const, label: '正在校验' },
    { state: 'extracting' as const, label: '正在解压安装' }
  ])('keeps $state progress visible outside the folded details', ({ state, label }) => {
    render(<LanguageProvider><LocalTranscriptionComponents controller={controllerFixture({ state })} /></LanguageProvider>);
    expect(screen.getByText(label)).toBeVisible();
    expect(screen.getByText(localComponentPreparationMessage(state, createLocalizedCopy('zh-CN')))).toBeVisible();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('keeps unknown-size progress indeterminate and hides unsupported components', () => {
    const { rerender } = render(<LanguageProvider><LocalTranscriptionComponents controller={controllerFixture({ state: 'downloading' })} /></LanguageProvider>);
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    rerender(<LanguageProvider><LocalTranscriptionComponents controller={controllerFixture({ state: 'unsupported', available: false })} /></LanguageProvider>);
    expect(screen.queryByRole('button', { name: '下载组件' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /WhisperKit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '调整转录设置' })).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it.each([
    { platform: 'darwin', arch: 'arm64', visibleProvider: 'whisperkit' },
    { platform: 'win32', arch: 'x64', visibleProvider: 'whisper.cpp' },
    { platform: 'darwin', arch: 'x64', visibleProvider: null },
    { platform: 'win32', arch: 'arm64', visibleProvider: null },
    { platform: 'linux', arch: 'x64', visibleProvider: null }
  ])('shows only available components on Runtime $platform / $arch', ({ platform, arch, visibleProvider }) => {
    const controller = controllerFixture();
    const providers = [
      { id: 'whisperkit', name: 'WhisperKit' },
      { id: 'whisper.cpp', name: 'whisper.cpp' },
      { id: 'faster-whisper', name: 'Faster Whisper' }
    ] as const;
    controller.componentsStatus = {
      ...controller.componentsStatus!, platform, arch,
      components: providers.map(provider => componentFixture({
        ...provider, available: provider.id === visibleProvider,
        state: provider.id === visibleProvider ? 'not_installed' : 'unsupported'
      }))
    };

    render(<LanguageProvider><LocalTranscriptionComponents controller={controller} /></LanguageProvider>);

    for (const provider of providers) {
      const heading = screen.queryByRole('heading', { name: new RegExp(provider.name) });
      if (provider.id === visibleProvider) expect(heading).toBeInTheDocument();
      else expect(heading).not.toBeInTheDocument();
    }
  });
});

describe('video translation component notice', () => {
  it('only shows the transcription settings link and preserves context before navigating', () => {
    const beforeNavigate = vi.fn();
    window.location.hash = '#/workbench?tool=video-translation&jobId=job_1';
    const controller = controllerFixture();
    controller.componentsStatus!.selectedModel = null;
    render(<LanguageProvider><LanguageSwitchControls /><LocalTranscriptionNotice controller={controller} importedSubtitle={false} beforeNavigate={beforeNavigate} /></LanguageProvider>);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent(/^调整转录设置$/);
    expect(screen.getAllByRole('link')).toHaveLength(1);
    const link = screen.getByRole('link', { name: '调整转录设置' });
    expect(link.getAttribute('href')).toContain('tab=ai-services');
    expect(link.getAttribute('href')).toContain('section=transcription');
    expect(link.getAttribute('href')).toContain('component=whisperkit');
    expect(link.getAttribute('href')).toContain('returnPath=');
    const href = link.getAttribute('href');
    fireEvent.click(screen.getByRole('button', { name: 'en-US' }));
    expect(notice).toHaveTextContent(/^Change transcription settings$/);
    expect(screen.getByRole('link', { name: 'Change transcription settings' })).toHaveAttribute('href', href);
    fireEvent.click(screen.getByRole('button', { name: 'sv-SE' }));
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByRole('link')).toHaveAttribute('href', href);
    expect(beforeNavigate).not.toHaveBeenCalled();
    expect(controller.downloadComponents).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(beforeNavigate).toHaveBeenCalledOnce();
  });

  it('hides the notice when subtitles were imported, cloud transcription is selected, or a local model is configured', () => {
    const { rerender } = render(<LanguageProvider><LocalTranscriptionNotice controller={controllerFixture()} importedSubtitle beforeNavigate={() => {}} /></LanguageProvider>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    rerender(<LanguageProvider><LocalTranscriptionNotice controller={controllerFixture({}, 'openai')} importedSubtitle={false} beforeNavigate={() => {}} /></LanguageProvider>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    for (const state of ['ready', 'not_installed', 'downloading', 'failed'] as const) {
      rerender(<LanguageProvider><LocalTranscriptionNotice controller={controllerFixture({ state })} importedSubtitle={false} beforeNavigate={() => {}} /></LanguageProvider>);
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    }
  });
});
