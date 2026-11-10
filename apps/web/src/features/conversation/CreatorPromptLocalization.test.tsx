import { fireEvent, render, screen } from '@testing-library/react';
import { creatorPromptMaxLength } from '@opencreator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CoverGeneratorWorkspace from '../dashboard/CoverGeneratorWorkspace.js';
import ImageGenerationWorkspace from '../dashboard/ImageGenerationWorkspace.js';
import VideoGenerationWorkspace from '../dashboard/VideoGenerationWorkspace.js';

describe('Creator prompt language selection', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['image', ImageGenerationWorkspace, 'Prompt'],
    ['video', VideoGenerationWorkspace, 'Prompt'],
    ['cover', CoverGeneratorWorkspace, 'Content and requirements']
  ] as const)('allows a long original in the %s prompt input', (_module, Workspace, label) => {
    render(<LanguageProvider initialPreference="en-US"><Workspace onBack={() => undefined} /></LanguageProvider>);
    const prompt = screen.getByRole('textbox', { name: label });
    expect(prompt).toHaveAttribute('maxlength', String(creatorPromptMaxLength));
    const original = 'Original English source prompt. '.repeat(200);
    fireEvent.change(prompt, { target: { value: original } });
    expect(prompt).toHaveValue(original);
  });
});
