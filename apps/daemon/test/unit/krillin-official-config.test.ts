import { parse } from '@iarna/toml';
import { createDefaultCreatorServicesConfig } from '@opencreator/protocol';
import { expect, it } from 'vitest';
import { createKrillinConfigToml } from '../../src/creator/krillin/config-bridge.js';

it('emits the selected ASR marker only for an official runtime and keeps custom configuration unchanged', () => {
  const config = createDefaultCreatorServicesConfig(); config.proxy = 'http://127.0.0.1:7897'; config.transcription.openai.model = 'custom-asr';
  expect(parse(createKrillinConfigToml(config))).toMatchObject({ app: { proxy: config.proxy }, transcribe: { openai: { model: 'custom-asr' } } });
  expect(createKrillinConfigToml(config)).not.toContain('official_model');
  const official = parse(createKrillinConfigToml(config, undefined, 'official-asr'));
  expect(official).toMatchObject({ transcribe: { openai: { official_model: 'official-asr' } } });
  expect(official.app).not.toHaveProperty('proxy');
  expect(config.transcription.openai.model).toBe('custom-asr');
});
