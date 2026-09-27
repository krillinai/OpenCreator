import { describe, expect, it } from 'vitest';
import { publicErrorKindForCode, safePublicErrorCode } from '../src/errors.js';
import { isPublicErrorFacts } from '../src/issues.js';

describe('public error kind for business code', () => {
  it.each([
    ['IMAGE_GENERATION_CONFIG_REQUIRED', 'configuration'],
    ['VALIDATION_FAILED', 'validation'],
    ['PROJECT_NOT_FOUND', 'not-found'],
    ['FILE_CONFLICT', 'conflict'],
    ['UNSUPPORTED_FILE_TYPE', 'unsupported'],
    ['CODEX_IMAGE_INPUT_UNSUPPORTED', 'unsupported'],
    ['IMAGE_GENERATION_STORAGE_FAILED', 'storage'],
    ['krillin_auth_failed', 'unauthorized'],
    ['ENOTFOUND', 'dns'],
    ['creator_provider_request_failed', undefined]
  ])('classifies %s conservatively', (code, expected) => {
    expect(publicErrorKindForCode(code)).toBe(expected);
  });
});

it('rejects token-like business codes before Agent output', () => {
  expect(safePublicErrorCode('IMAGE_GENERATION_UPSTREAM_ERROR')).toBe('IMAGE_GENERATION_UPSTREAM_ERROR');
  expect(safePublicErrorCode('sk-private-long-secret-value')).toBeUndefined();
  expect(safePublicErrorCode('a'.repeat(40))).toBeUndefined();
  expect(isPublicErrorFacts({ kind: 'unknown', upstreamCode: 'sk-private-secret' })).toBe(false);
});
