import { describe, expect, it } from 'vitest';
import { normalizeKrillinFailure } from '../../src/creator/krillin/adapter.js';
import { KrillinCliError } from '../../src/creator/krillin/cli-runner.js';

describe('KrillinAI error mapping', () => {
  it('preserves structured HTTP diagnostics without exposing raw response text to telemetry', () => {
    const requestId = `ocreq_${'b'.repeat(48)}`;
    const error = new KrillinCliError('audio_transcription_api_failed', 'private upstream body', 'retryable', true,
      undefined, { http_status: 429, upstream_code: 'rate_limit_exceeded', request_id: requestId });
    expect(error.publicFacts).toMatchObject({ httpStatus: 429, upstreamCode: 'rate_limit_exceeded', requestId });
  });
  it.each(['Douyin', 'Douyin+opencreator'])('preserves the confirmed %s signature incompatibility in translation failures', prefix => {
    const error = new KrillinCliError('prepare_media_failed',
      `ERROR: [${prefix}] Douyin request signature is required (HTTP Error 403; Signature Not Found).`);
    expect(normalizeKrillinFailure(error).code).toBe('platform_request_signature_required');
    expect(error.publicFacts).toMatchObject({ kind: 'unsupported', httpStatus: 403, upstreamCode: 'prepare_media_failed' });
  });
  it.each(['prepare_media_failed', 'prepare_audio_fallback_failed'])('maps the confirmed Douyin session requirement during %s and preserves upstream evidence', code => {
    const message = 'linkToFile download audio yt-dlp error: exit status 1: WARNING: [Douyin] Failed to download web detail JSON: HTTP Error 403: Forbidden\nERROR: [Douyin] Fresh cookies (not necessarily logged in) are needed';
    const error = new KrillinCliError(code, message);
    expect(normalizeKrillinFailure(error)).toEqual({ code: 'platform_session_required', message });
    expect(error.publicFacts).toMatchObject({ kind: 'unauthorized', provider: 'krillinai', httpStatus: 403,
      upstreamCode: code, upstreamMessage: expect.stringContaining('Fresh cookies (not necessarily logged in) are needed') });
    expect(normalizeKrillinFailure(new KrillinCliError(code, 'HTTP Error 403: Forbidden')).code).toBe(code);
  });
  it('reports a confirmed Bilibili risk-control rejection without inventing an HTTP status', () => {
    const error = new KrillinCliError('prepare_media_failed',
      'Bilibili risk control blocked media extraction after 3 attempts; wait and retry');
    expect(error.publicFacts).toMatchObject({ kind: 'http-rejected', provider: 'krillinai' });
    expect(error.publicFacts.httpStatus).toBeUndefined();
    expect(new KrillinCliError('prepare_media_failed', 'No video formats found!').publicFacts.kind).toBe('unknown');
    expect(new KrillinCliError('prepare_media_failed',
      'WARNING: Bilibili risk control rejected the playback API request; retaining webpage media formats when available\nERROR: Requested format is not available'
    ).publicFacts.kind).toBe('unknown');
  });
  it('maps generic CLI usage errors to actionable creator configuration codes', () => {
    expect(normalizeKrillinFailure({
      code: 'usage',
      message: '使用OpenAI转录服务需要配置 OpenAI API Key'
    })).toEqual({
      code: 'creator_transcription_config_missing',
      message: '使用OpenAI转录服务需要配置 OpenAI API Key'
    });

    expect(normalizeKrillinFailure({
      code: 'usage',
      message: 'TTS 服务配置不完整'
    }).code).toBe('creator_tts_config_missing');
  });

  it('maps a deferred transcription failure after platform caption fallback', () => {
    expect(normalizeKrillinFailure({
      code: 'audio_transcription_failed',
      message: '使用OpenAI转录服务需要配置 OpenAI API Key'
    }).code).toBe('creator_transcription_config_missing');
  });
});
