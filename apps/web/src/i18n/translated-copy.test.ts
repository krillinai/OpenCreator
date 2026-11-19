import { describe, expect, it } from 'vitest';
import { additionalLanguageCatalogs, translateEnglishCopy } from './translated-copy.js';
import type { AppLanguage } from './language.js';
import { openCreatorLanguages } from '@opencreator/protocol';

describe('additional language catalogs', () => {
  it('covers immersive subtitle editing controls in every client language', () => {
    for (const [language, catalog] of Object.entries(additionalLanguageCatalogs)) {
      for (const key of ['Back to project', 'Subtitle editor', 'Undo', 'Redo', 'Agent Mode', 'Advanced editing',
        'Export subtitles', 'Resize subtitles and preview', 'Time', 'Original text', 'Done',
        'Current version', 'Adjusting from V{{0}}', 'Presets', 'My styles', 'Customize',
        'Save as template', 'Customize subtitle style',
        'No saved styles yet. Adjust a style in Customize, then choose Save as template.']) {
        expect(Object.hasOwn(catalog!, key), `${language}: ${key}`).toBe(true);
        expect(catalog![key]?.trim().length, `${language}: ${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('loads a catalog for every supported language except the built-in Chinese and English sources', () => {
    expect(Object.keys(additionalLanguageCatalogs).sort()).toEqual(
      openCreatorLanguages.filter(language => language !== 'zh-CN' && language !== 'en-US').sort()
    );
  });

  it('covers subtitle translation and download messages in every additional language', () => {
    const messages = [
      'Add an SRT file to translate first', 'Add source', 'Add subtitles', 'Automatic captions',
      'Bilingual SRT', 'Manual subtitles', 'Not enough credits.', 'Remove subtitles', 'Replace file', 'Save subtitles',
      'Source type', 'Subtitle Translation', 'Subtitles were saved; the project remains V{{0}}.',
      'Top up your credits and retry this stage.', 'Translate subtitles', 'Translate video', 'Translated SRT', 'Waiting for subtitles'
    ];
    for (const [language, catalog] of Object.entries(additionalLanguageCatalogs)) {
      for (const message of messages) {
        expect(Object.hasOwn(catalog!, message), `${language}: ${message}`).toBe(true);
        expect(translateEnglishCopy(language as AppLanguage, message)).not.toBe(message);
      }
      expect(translateEnglishCopy(language as AppLanguage, 'Subtitles were saved; the project remains V12.'))
        .toBe(catalog!['Subtitles were saved; the project remains V{{0}}.']!.replace('{{0}}', '12'));
    }
  });

  it('localizes translation model selection and credit estimates in every additional language', () => {
    const reusedMessages = ['Loading models', 'Could not load the model list. Try again.',
      'Local model', 'Custom model service', 'Open text model settings', 'Retry'];
    const newMessages = ['Translation model',
      'The selected model is unavailable for this account. Another model is selected.',
      'Price unavailable', 'Input {{0}} / output {{1}} credits/M tokens'];
    for (const [language, catalog] of Object.entries(additionalLanguageCatalogs)) {
      for (const message of [...reusedMessages, ...newMessages]) {
        expect(Object.hasOwn(catalog!, message), `${language}: ${message}`).toBe(true);
      }
      for (const message of newMessages) {
        expect(translateEnglishCopy(language as AppLanguage, message), `${language}: ${message}`).not.toBe(message);
      }
      expect(translateEnglishCopy(language as AppLanguage, 'Input 1 / output 2 credits/M tokens'))
        .toBe(catalog!['Input {{0}} / output {{1}} credits/M tokens']!.replace('{{0}}', '1').replace('{{1}}', '2'));
    }
  });

  it('localizes the shared generation editor controls in every additional language', () => {
    for (const language of Object.keys(additionalLanguageCatalogs) as AppLanguage[]) {
      expect(additionalLanguageCatalogs[language]).toHaveProperty('Model');
      for (const message of [
        'Search languages', 'No matching languages',
        'Expand editor', 'Collapse editor', 'Add visual reference', 'Reference mode',
        'Reference images', 'Reference videos', 'Reference audio', 'First and last frames',
        'First frame', 'Last frame', 'Maximum 3 files for references', 'Maximum',
        'Unsupported file format or file exceeds 5 MB', 'Reference upload failed. Retry.'
      ]) {
        expect(translateEnglishCopy(language, message), language).not.toBe(message);
      }
      const uploadTemplate = additionalLanguageCatalogs[language]!['Upload {{0}}'];
      expect(uploadTemplate, language).toBeDefined();
      expect(translateEnglishCopy(language, 'Upload reference'), language)
        .toBe(uploadTemplate!.replace('{{0}}', 'reference'));
    }
  });

  it.each([
    ['ja-JP', '取得'], ['ko-KR', '가져오기'], ['es-ES', 'Obtener'],
    ['fr-FR', 'Récupérer'], ['de-DE', 'Abrufen'], ['pt-BR', 'Obter'],
    ['zh-TW', '擷取'], ['it-IT', 'Recupera'], ['ru-RU', 'Получить'],
    ['tr-TR', 'Getir'], ['id-ID', 'Ambil'], ['vi-VN', 'Lấy'],
    ['th-TH', 'ดึงข้อมูล'], ['fil-PH', 'Kunin'], ['hi-IN', 'प्राप्त करें'],
    ['bn-BD', 'আনুন'], ['pl-PL', 'Pobierz'], ['uk-UA', 'Отримати'], ['nl-NL', 'Ophalen'],
    ['ms-MY', 'Dapatkan'], ['da-DK', 'Hent'], ['nb-NO', 'Hent'], ['fi-FI', 'Nouda'],
    ['cs-CZ', 'Načíst'], ['ro-RO', 'Preia'], ['hu-HU', 'Lekérés'], ['el-GR', 'Ανάκτηση'],
    ['ta-IN', 'பெறு'], ['te-IN', 'పొందు'], ['bg-BG', 'Извлечи'],
    ['sk-SK', 'Načítať'], ['hr-HR', 'Dohvati'], ['sr-RS', 'Дохвати'],
    ['ar-SA', 'جلب'], ['fa-IR', 'دریافت'], ['ur-PK', 'حاصل کریں'], ['he-IL', 'אחזור'],
    ['mr-IN', 'मिळवा'], ['gu-IN', 'મેળવો'], ['pa-IN', 'ਪ੍ਰਾਪਤ ਕਰੋ']
  ] as const)('translates primary actions in %s', (language, expected) => {
    expect(translateEnglishCopy(language, 'Fetch')).toBe(expected);
    expect(translateEnglishCopy(language, 'Some unknown UI text')).toBe('Some unknown UI text');
    expect(translateEnglishCopy(language, 'toString')).toBe('toString');
  });

  it('preserves all interpolation tokens and covers the same messages in every locale', () => {
    const keys = Object.keys(additionalLanguageCatalogs['ja-JP']!).sort();
    for (const [language, catalog] of Object.entries(additionalLanguageCatalogs)) {
      expect(Object.keys(catalog!).sort()).toEqual(keys);
      const invalidEntries: string[] = [];
      for (const [source, translation] of Object.entries(catalog!)) {
        if (!translation.trim()) invalidEntries.push(`Empty translation: ${source}`);
        const actual = (translation.match(/\{\{[^}]+\}\}/g) ?? []).sort();
        const expected = (source.match(/\{\{[^}]+\}\}/g) ?? []).sort();
        if (JSON.stringify(actual) !== JSON.stringify(expected)) invalidEntries.push(`Placeholder mismatch: ${source}`);
      }
      expect(invalidEntries, language).toEqual([]);
    }
  });

  it('preserves literal values and chooses the specific template', () => {
    for (const language of Object.keys(additionalLanguageCatalogs) as AppLanguage[]) {
      const catalog = additionalLanguageCatalogs[language]!;
      const name = 'Report $& [v2] {{secret}}';
      expect(translateEnglishCopy(language, `Download ${name} document`))
        .toBe(catalog['Download {{0}} document']!.replace('{{0}}', () => name));
      expect(translateEnglishCopy(language, 'Ready · Pinterest · 12 options'))
        .toBe(catalog['Ready · {{0}} · {{1}} options']!.replace('{{0}}', 'Pinterest').replace('{{1}}', '12'));
    }
  });

  it.each(['th-TH', 'fil-PH', 'hi-IN', 'bn-BD', 'pl-PL', 'uk-UA', 'nl-NL', 'ms-MY', 'da-DK', 'nb-NO', 'fi-FI', 'cs-CZ', 'ro-RO', 'hu-HU', 'el-GR', 'ta-IN', 'te-IN', 'bg-BG', 'sk-SK', 'hr-HR', 'sr-RS', 'ar-SA', 'fa-IR', 'ur-PK', 'he-IL', 'mr-IN', 'gu-IN', 'pa-IN'] as const)('retains product names in %s service guidance', language => {
    const l = (source: string) => translateEnglishCopy(language, source);
    expect(l('OpenCreator version')).toContain('OpenCreator');
    expect(l('Maintain reusable Codex configuration for sessions and scheduled tasks.')).toContain('Codex');
    const services = l('Configure Seedance, Kling, or Veo video generation and the default model for new tasks.');
    for (const name of ['Seedance', 'Kling', 'Veo']) expect(services).toContain(name);
    const videoSources = l('Enter a valid public YouTube, Bilibili, X, TikTok, Instagram, Douyin, Facebook, Xiaohongshu, Pinterest, or Reddit video URL');
    for (const name of ['YouTube', 'Bilibili', 'TikTok', 'Instagram', 'Douyin', 'Facebook', 'Xiaohongshu', 'Pinterest', 'Reddit']) expect(videoSources).toContain(name);
  });
});
