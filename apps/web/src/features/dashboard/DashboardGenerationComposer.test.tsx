import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import DashboardGenerationComposer from './DashboardGenerationComposer.js';

describe('DashboardGenerationComposer', () => {
  it('keeps the original homepage tabs and only shows extended modes in workspaces', () => {
    const renderWorkspace = vi.fn((workspace: string, tabs: React.ReactNode) => <div>{workspace}{tabs}</div>);
    const view = render(
      <LanguageProvider initialPreference="en-US">
        <DashboardGenerationComposer renderWorkspace={renderWorkspace} />
      </LanguageProvider>
    );

    expect(screen.getByRole('tab', { name: 'Image Generation' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Video Generation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video Translation' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Video Downloader/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Image to Image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Video Transcription' })).not.toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Text to Speech' })).not.toBeInTheDocument();

    view.rerender(
      <LanguageProvider initialPreference="en-US">
        <DashboardGenerationComposer showExtendedModes initialMode="transcription" renderWorkspace={renderWorkspace} />
      </LanguageProvider>
    );
    expect(screen.queryByRole('tab', { name: 'Image to Image' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Cover Generator' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video Transcription' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Text to Speech' })).toBeInTheDocument();
    expect(renderWorkspace).toHaveBeenCalledWith('transcription', expect.anything(), 'transcription');

    view.rerender(
      <LanguageProvider initialPreference="en-US">
        <DashboardGenerationComposer showExtendedModes initialMode="speech" renderWorkspace={renderWorkspace} />
      </LanguageProvider>
    );
    expect(screen.getByRole('tab', { name: 'Text to Speech' })).toHaveAttribute('aria-selected', 'true');
    expect(renderWorkspace).toHaveBeenCalledWith('smart-dubbing', expect.anything(), 'speech');
  });

  it('maps the legacy voiceover mode to the video translation tab', () => {
    const renderWorkspace = vi.fn((workspace: string, tabs: React.ReactNode) => <div>{workspace}{tabs}</div>);
    render(
      <LanguageProvider initialPreference="en-US">
        <DashboardGenerationComposer showExtendedModes initialMode="voiceover" renderWorkspace={renderWorkspace} />
      </LanguageProvider>
    );

    expect(screen.queryByRole('tab', { name: 'Voiceover' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Video Translation' })).toHaveAttribute('aria-selected', 'true');
    expect(renderWorkspace).toHaveBeenCalledWith('video-translation', expect.anything(), 'voiceover');
  });

  it.each([
    { group: 'video', initialMode: 'translation', tabs: ['Video Translation', 'Video Generation', 'Video Transcription', 'Video DownloaderFree', 'Video Clips'] },
    { group: 'image', initialMode: 'image', tabs: ['Image Generation', 'Cover Generator'] },
    { group: 'audio', initialMode: 'audio-transcription', tabs: ['Audio Transcription', 'Text to Speech'] },
    { group: 'text', initialMode: 'script', tabs: ['Short Video Script'] }
  ] as const)('shows only $group creation tabs in a grouped workspace', ({ group, initialMode, tabs }) => {
    render(
      <LanguageProvider initialPreference="en-US">
        <DashboardGenerationComposer showExtendedModes modeGroup={group} initialMode={initialMode} renderWorkspace={(_workspace, tabs) => <>{tabs}</>} />
      </LanguageProvider>
    );

    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(tabs);
    expect(screen.getAllByRole('tab', { selected: true })).toHaveLength(1);
  });
});
