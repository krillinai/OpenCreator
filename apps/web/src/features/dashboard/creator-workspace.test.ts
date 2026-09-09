import { describe, expect, it } from 'vitest';
import {
  creatorPresetWorkspaces,
  creatorTemplateForWorkspace,
  creatorTemplateVersionForWorkspace,
  creatorWorkspaceForTemplate
} from './creator-workspace.js';

describe('creator workspace contract', () => {
  it('uses the shared public preset workspace identity', () => {
    expect(creatorPresetWorkspaces).toEqual([
      'video-translation',
      'video-download',
      'image-generation',
      'video-generation',
      'cover-generator',
      'smart-dubbing'
    ]);
    expect(creatorTemplateForWorkspace('cover-generator')).toBe('cover');
    expect(creatorTemplateVersionForWorkspace('video-translation')).toBe(2);
    expect(creatorTemplateVersionForWorkspace('video-download')).toBe(2);
    expect(creatorTemplateVersionForWorkspace('image-generation')).toBe(2);
    expect(creatorTemplateVersionForWorkspace('cover-generator')).toBe(2);
    expect(creatorTemplateVersionForWorkspace('video-generation')).toBe(1);
    expect(creatorTemplateVersionForWorkspace('smart-dubbing')).toBe(1);
    expect(creatorWorkspaceForTemplate('cover')).toBe('cover-generator');
  });
});
