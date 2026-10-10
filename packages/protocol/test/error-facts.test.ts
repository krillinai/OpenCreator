import { describe, expect, it } from 'vitest';
import { publicErrorCodeFromFailure, publicErrorMessageFromFailure, publicErrorKindForCode, safePublicErrorCode, safePublicErrorMessage, safePublicRequestId } from '../src/errors.js';
import { isPublicErrorFacts, sanitizePublicErrorFacts } from '../src/issues.js';

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
    ['ERR_FS_FILE_TOO_LARGE', 'storage'],
    ['audio_no_speech', 'validation'],
    ['audio_transcription_invalid_response', 'invalid-response'],
    ['audio_transcription_timestamps_missing', 'unsupported'],
    ['audio_transcription_api_failed', 'provider-failed'],
    ['audio_transcription_empty', undefined],
    ['creator_provider_request_failed', undefined]
  ])('classifies %s conservatively', (code, expected) => {
    expect(publicErrorKindForCode(code)).toBe(expected);
  });
});

it('preserves a nested filesystem code and reason with bounded, sanitized cause traversal', () => {
  const bottom = Object.assign(new Error('File size (4014655674) is greater than 2 GiB token=private'), { code: 'ERR_FS_FILE_TOO_LARGE' });
  const error = new Error('Output collection failed', { cause: bottom });
  expect(publicErrorCodeFromFailure(error)).toBe('ERR_FS_FILE_TOO_LARGE');
  expect(publicErrorMessageFromFailure(error)).toContain('File size (4014655674)');
  expect(publicErrorMessageFromFailure(error)).not.toContain('private');
  expect(publicErrorCodeFromFailure({ code: 'sk-private-secret' })).toBeUndefined();
  const cycle: { message: string; cause?: unknown } = { message: 'Cyclic failure' };
  cycle.cause = cycle;
  expect(publicErrorCodeFromFailure(cycle)).toBeUndefined();
  expect(publicErrorMessageFromFailure(cycle)).toBe('Cyclic failure');
});

it('rejects token-like business codes before Agent output', () => {
  expect(safePublicErrorCode('IMAGE_GENERATION_UPSTREAM_ERROR')).toBe('IMAGE_GENERATION_UPSTREAM_ERROR');
  expect(safePublicErrorCode('sk-private-long-secret-value')).toBeUndefined();
  expect(safePublicErrorCode('a'.repeat(40))).toBeUndefined();
  expect(isPublicErrorFacts({ kind: 'unknown', upstreamCode: 'sk-private-secret' })).toBe(false);
});

it('preserves long structured provider codes without accepting opaque credentials', () => {
  const code = 'InputImageSensitiveContentDetected.SensitiveContent';
  expect(safePublicErrorCode(code)).toBe(code);
  expect(isPublicErrorFacts({ kind: 'http-rejected', provider: 'seedance', upstreamCode: code, httpStatus: 400 })).toBe(true);
  expect(safePublicErrorCode('0123456789abcdef'.repeat(3))).toBeUndefined();
  expect(safePublicErrorCode('opaqueCredentialValue1234567890ABCDE')).toBeUndefined();
});

it('retains useful provider explanations while redacting credentials and media data', () => {
  const message = safePublicErrorMessage('Input image was rejected. "api_key": "private-key" Bearer private-token https://example.test/?token=private-url /Users/private-user/file.jpg data:image/png;base64,cHJpdmF0ZQ==');
  expect(message).toContain('Input image was rejected.');
  expect(message).not.toContain('private');
  expect(message).not.toContain('cHJpdmF0ZQ');
  expect(safePublicErrorMessage(message)).toBe(message);
  expect(safePublicErrorMessage('token=private')).toBeUndefined();
  expect(safePublicErrorMessage('Bearer private')).toBeUndefined();
  expect(safePublicErrorMessage('Too long '.repeat(600))).toBeUndefined();
  expect(safePublicErrorMessage('Reason '.repeat(100))!.length).toBeLessThanOrEqual(500);
});

it('sanitizes public diagnostic fields and validates the sanitized result', () => {
  const facts = sanitizePublicErrorFacts({
    kind: 'provider-failed', provider: 'seedance', upstreamCode: 'InputImageSensitiveContentDetected.SensitiveContent',
    upstreamMessage: 'Reference rejected. token=private', requestId: '0123456789abcdef'.repeat(2), httpStatus: 900
  });
  expect(facts).toMatchObject({ upstreamMessage: 'Reference rejected. [redacted]', requestId: '0123456789abcdef'.repeat(2) });
  expect(facts.httpStatus).toBeUndefined();
  expect(isPublicErrorFacts(facts)).toBe(true);
  expect(isPublicErrorFacts({ ...facts, upstreamMessage: 'token=private' })).toBe(false);
  expect(safePublicRequestId('sk-private-key')).toBeUndefined();
  expect(safePublicRequestId('https://private.test')).toBeUndefined();
});
