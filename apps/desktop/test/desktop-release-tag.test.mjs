import { describe, expect, it } from 'vitest';
import { verifyDesktopReleaseTag } from '../scripts/verify-desktop-release-tag.mjs';

describe('Desktop release tag', () => {
  it('accepts a tag matching the Desktop package version', () => {
    expect(verifyDesktopReleaseTag('v1.2.3', '1.2.3')).toEqual({
      skipped: false,
      packageVersion: '1.2.3',
      tag: 'v1.2.3'
    });
  });

  it('rejects malformed and mismatched tags', () => {
    expect(() => verifyDesktopReleaseTag('desktop-v1.2.3', '1.2.3')).toThrow(
      /v<version>/
    );
    expect(() => verifyDesktopReleaseTag('v1.2.4', '1.2.3')).toThrow(
      /does not match/
    );
  });

  it('allows manual workflow runs without a tag', () => {
    expect(verifyDesktopReleaseTag('', '1.2.3')).toEqual({
      skipped: true,
      packageVersion: '1.2.3'
    });
  });
});
