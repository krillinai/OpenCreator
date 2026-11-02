import { parse } from '@iarna/toml';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { expect, it } from 'vitest';
import { createKrillinConfigToml } from '../../src/creator/krillin/config-bridge.js';
import { KrillinCliError } from '../../src/creator/krillin/cli-runner.js';

it('classifies a gateway output rejection as a confirmed HTTP failure', () => {
  expect(new KrillinCliError('subtitle_failed', 'failed to batch translate: 字幕1-37: error, status code: 400, status: 400 Bad Request, message: Requested output exceeds the gateway limit of 4096 tokens').publicFacts)
    .toMatchObject({ kind: 'http-rejected', httpStatus: 400, upstreamCode: 'output_too_large' });
});

it('emits the selected ASR marker only for an official runtime and keeps custom configuration unchanged', () => {
  const config = createDefaultCreatorServicesConfig(); config.proxy = 'http://127.0.0.1:7897'; config.transcription.openai.model = 'custom-asr';
  expect(parse(createKrillinConfigToml(config))).toMatchObject({ app: { proxy: config.proxy }, transcribe: { openai: { model: 'custom-asr' } } });
  expect(createKrillinConfigToml(config)).not.toContain('official_model');
  const official = parse(createKrillinConfigToml(config, undefined, 'official-asr'));
  expect(official).toMatchObject({
    app: { youtube_proxy: config.proxy },
    transcribe: { openai: { official_model: 'official-asr' } }
  });
  expect(official.app).not.toHaveProperty('proxy');
  expect(config.transcription.openai.model).toBe('custom-asr');
});

it('passes the selected official text model name without changing its opaque route ID', () => {
  const config = createDefaultCreatorServicesConfig();
  config.llm.model = 'oc_708ac39a01ac1a51';
  const model = { id: config.llm.model, name: 'deepseek-v4.1-flash' };
  expect(parse(createKrillinConfigToml(config, undefined, undefined, model))).toMatchObject({
    llm: { model: model.id, model_name: model.name }
  });
  expect(parse(createKrillinConfigToml(config))).toHaveProperty('llm.model', model.id);
  expect(createKrillinConfigToml(config)).not.toContain('model_name');
});

it('does not apply stale official model metadata to a different selection or a Codex override', () => {
  const config = createDefaultCreatorServicesConfig();
  config.llm.model = 'oc_other';
  const model = { id: 'oc_deepseek', name: 'deepseek-v4.1-flash' };
  expect(createKrillinConfigToml(config, undefined, undefined, model)).not.toContain('model_name');
  const override = { baseUrl: 'http://127.0.0.1:9000/v1', apiKey: 'test-key', model: model.id };
  const document = parse(createKrillinConfigToml(config, override, undefined, model));
  expect(document).toHaveProperty('llm.model', override.model);
  expect(document.llm).not.toHaveProperty('model_name');
});

it('writes an independent Flash fallback without changing the selected primary model', () => {
  const config = createDefaultCreatorServicesConfig();
  config.llm = { source: 'custom', jsonMode: true, model: 'oc_gpt', baseUrl: 'https://primary.example/v1', apiKey: 'primary-key' };
  const fallback = { model: 'oc_flash', modelName: 'deepseek-v4.1-flash', baseUrl: 'https://gateway.example/v1', apiKey: 'fallback-key' };
  expect(parse(createKrillinConfigToml(config, undefined, undefined, { id: 'oc_gpt', name: 'gpt-5.5' }, fallback))).toMatchObject({
    llm: { model: 'oc_gpt', model_name: 'gpt-5.5', api_key: 'primary-key' },
    llm_fallback: { base_url: fallback.baseUrl, api_key: 'fallback-key', model: 'oc_flash', model_name: fallback.modelName }
  });
  expect(config.llm.model).toBe('oc_gpt');
  expect(parse(createKrillinConfigToml(config, { ...config.llm, model: 'codex' }, undefined, undefined, fallback))).not.toHaveProperty('llm_fallback');
  config.llm.model = fallback.model;
  expect(parse(createKrillinConfigToml(config, undefined, undefined, undefined, fallback))).not.toHaveProperty('llm_fallback');
});
