import { describe, expect, it } from 'vitest';
import { classifyYtDlpFailure, embeddedYtDlpFailure } from '../../src/creator/yt-dlp/failure.js';

describe('shared yt-dlp failure classification', () => {
  it('preserves cover-specific private and unavailable source errors', () => {
    expect(classifyYtDlpFailure('ERROR: Private video', 1, 'cover_source_analysis_failed'))
      .toMatchObject({ code: 'source_private', publicFacts: { provider: 'yt-dlp', kind: 'unauthorized' } });
    expect(classifyYtDlpFailure('ERROR: This video is not available', 1, 'cover_source_analysis_failed'))
      .toMatchObject({ code: 'region_or_copyright_restricted' });
    expect(classifyYtDlpFailure('ERROR: Private video', 1).code).toBe('download_failed');
  });

  it('uses the final yt-dlp error instead of an earlier retry warning', () => {
    expect(embeddedYtDlpFailure('prepare_media_failed',
      'yt-dlp: WARNING: connection timed out.\nERROR: [youtube] Signature extraction failed. Please update.'))
      .toMatchObject({ code: 'yt_dlp_update_recommended' });
    expect(embeddedYtDlpFailure('prepare_media_failed',
      'yt-dlp: WARNING: connection timed out.\nERROR: The provided YouTube account cookies are no longer valid.'))
      .toBeUndefined();
  });
});
