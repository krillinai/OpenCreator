import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboardCss = readFileSync(
  'src/features/dashboard/dashboard.css',
  'utf8'
).replaceAll('\r\n', '\n');

function cssBlocks(selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(
    dashboardCss.matchAll(new RegExp(
      `(?:^|[}\\n])\\s*${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`,
      'g'
    )),
    match => match.groups?.body ?? ''
  );
}

describe('dashboard CSS contracts', () => {
  it('keeps article-template icons unframed inside selectable list items', () => {
    for (const selector of [
      '.wechat-template-inline-list > button > span',
      '.wechat-template-grid > button > span'
    ]) {
      const blocks = cssBlocks(selector);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]).toContain('background: transparent;');
      expect(blocks[0]).not.toMatch(/border|box-shadow/);
    }
  });

  it('uses the available article brief height for long writing instructions', () => {
    const scroll = cssBlocks('.wechat-article-scroll[data-step="1"]')[0];
    const grid = cssBlocks('.wechat-brief-grid')[0];
    const field = cssBlocks(
      '.wechat-writing-brief-panel > .creator-tool-field:first-of-type'
    )[0];
    const textarea = cssBlocks(
      '.wechat-writing-brief-panel > .creator-tool-field:first-of-type textarea'
    )[0];

    expect(scroll).toContain('grid-template-rows: minmax(0, 1fr);');
    expect(scroll).toContain('overflow: hidden;');
    expect(grid).toContain('height: 100%;');
    expect(field).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(textarea).toContain('height: 100%;');
    expect(textarea).toContain('min-height: 0;');
  });

  it('uses the available outline step height for long article outlines', () => {
    const scroll = cssBlocks('.wechat-article-scroll[data-step="3"]')[0];
    const panel = cssBlocks(
      '.wechat-article-scroll[data-step="3"] > .wechat-outline-panel'
    )[0];
    const field = cssBlocks('.wechat-outline-panel > .creator-tool-field')[0];
    const textarea = cssBlocks(
      '.wechat-outline-panel .creator-tool-field > .wechat-outline-editor'
    )[0];

    expect(scroll).toContain('grid-template-rows: minmax(0, 1fr);');
    expect(scroll).toContain('overflow: hidden;');
    expect(panel).toContain('height: 100%;');
    expect(panel).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(field).toContain('grid-template-rows: minmax(0, 1fr);');
    expect(textarea).toContain('height: 100%;');
    expect(textarea).toContain('min-height: 0;');
  });

  it('separates Creator form groups and top-aligns fields beside taller previews', () => {
    const formRow = cssBlocks('.creator-tool-form-row');
    const characterPicker = cssBlocks('.stickman-character-picker');

    expect(formRow).toHaveLength(1);
    expect(formRow[0]).toContain('align-items: start;');
    expect(formRow[0]).toContain('gap: 16px;');
    expect(formRow[0]).toContain('margin-top: 16px;');
    expect(characterPicker).toHaveLength(1);
    expect(characterPicker[0]).toContain('margin-top: 16px;');
    expect(cssBlocks('.stickman-voice-settings + .stickman-tts-configuration')[0]).toContain('margin-top: 16px;');
    expect(cssBlocks('.creator-tool-field')[0]).toContain('gap: 8px;');
    expect(cssBlocks('.video-translation-select-wrap select')[0]).toContain('padding: 0 40px 0 12px;');
    expect(cssBlocks('.video-translation-select-wrap svg')[0]).toContain('right: 12px;');
  });

  it('keeps collaboration panels full-height beside the workspace at narrow widths', () => {
    const sharedPanel = cssBlocks('.creator-collaboration');
    const workspaceLayout = cssBlocks('.creator-workspace-layout');
    const translationLayout = cssBlocks('.video-translation-collab-layout');

    expect(sharedPanel).toHaveLength(1);
    expect(sharedPanel[0]).toContain('height: 100%;');
    expect(sharedPanel[0]).toContain('min-height: 0;');
    expect(sharedPanel[0]).toContain('display: flex;');
    expect(sharedPanel[0]).toContain('flex-direction: column;');
    const resizableLayout = cssBlocks('.creator-resizable-layout');
    expect(resizableLayout[0]).toContain('min-width: 680px;');
    expect(resizableLayout[0]).toContain('minmax(280px, 1fr);');
    expect(workspaceLayout[0]).toContain('height: 100%;');
    expect(translationLayout[0]).toContain('height: 100%;');
    expect(dashboardCss).not.toMatch(/\.creator-collaboration-panel\s*\{[^}]*height: auto;/);
  });

  it('constrains portrait source previews without forcing a landscape frame', () => {
    const portraitPreview = cssBlocks('.video-source-preview[data-orientation="portrait"]');

    expect(portraitPreview).toHaveLength(1);
    expect(portraitPreview[0]).toContain('width: min(360px, 100%);');
    expect(portraitPreview[0]).toContain('margin-inline: auto;');
  });

  it('visually distinguishes output formats disabled for portrait sources', () => {
    const disabledFormat = cssBlocks('.video-translation-format button:disabled');

    expect(disabledFormat).toHaveLength(1);
    expect(disabledFormat[0]).toContain('cursor: not-allowed;');
    expect(disabledFormat[0]).toContain('opacity: 0.45;');
  });

  it('keeps subtitle style previews at their output aspect ratio instead of stretching with the form', () => {
    const layout = cssBlocks('.video-translation-subtitle-style-layout');
    const outlineFields = cssBlocks('.video-translation-outline-fields');
    const colorOptions = cssBlocks('.video-translation-color-options');
    const preview = cssBlocks('.video-translation-subtitle-preview');
    const player = cssBlocks('.video-translation-subtitle-preview > div');
    const overlay = cssBlocks('.video-translation-subtitle-preview > div::after');
    const media = cssBlocks('.video-translation-subtitle-preview-media');
    const cues = cssBlocks('.video-translation-subtitle-preview-cues');
    const verticalPreview = cssBlocks('.video-translation-subtitle-preview[data-orientation="portrait"] > div');

    expect(layout[0]).toContain('align-items: start;');
    expect(layout[0]).toContain('minmax(350px, 1.2fr) minmax(260px, 1fr)');
    expect(outlineFields[0]).toContain('grid-template-columns: minmax(0, 1fr) 88px;');
    expect(colorOptions[0]).toContain('flex-wrap: wrap;');
    expect(dashboardCss).toMatch(/@container video-translation-workspace \(max-width: 760px\) \{\s*\.video-translation-subtitle-style-layout/);
    expect(preview[0]).toContain('grid-template-rows: auto auto;');
    expect(preview[0]).toContain('align-content: start;');
    expect(player[0]).toContain('aspect-ratio: var(--subtitle-preview-aspect-ratio, 16 / 9);');
    expect(overlay[0]).toContain('background: rgb(0 0 0 / 55%);');
    expect(overlay[0]).toContain('z-index: 1;');
    expect(media[0]).toContain('object-fit: cover;');
    expect(cues[0]).toContain('position: absolute;');
    expect(cues[0]).toContain('z-index: 2;');
    expect(verticalPreview).toHaveLength(1);
    expect(verticalPreview[0]).toContain('width: min(236px, 100%);');
  });

  it('widens the translation settings consistently and keeps smaller color swatches', () => {
    for (const selector of [
      '.video-translation-source-step',
      '.video-translation-configure-top',
      '.video-translation-wizard-main .video-translation-wizard-body',
      '.video-translation-wizard-main .video-translation-wizard-actions',
      '.video-translation-run-notice'
    ]) {
      expect(cssBlocks(selector)[0]).toContain('width: min(960px, 100%);');
    }
    expect(cssBlocks('.video-translation-color-options > button')[0]).toContain('width: 26px;');
    expect(cssBlocks('.video-translation-custom-color input')[0]).toContain('width: 26px;');
  });

  it('matches video download settings width to translation and centers labeled platforms', () => {
    expect(cssBlocks('.video-download-workspace-page .creator-tool-stack')[0]).toContain('width: min(960px, 100%);');
    expect(cssBlocks('.video-download-platforms')[0]).toContain('justify-content: center;');
    expect(cssBlocks('.video-download-platforms')[0]).toContain('flex-wrap: wrap;');
    expect(cssBlocks('.video-download-platforms img')[0]).toContain('width: 32px;');
    expect(cssBlocks('.video-download-platforms li')[0]).toContain('text-align: center;');
  });

  it('fits subtitle previews to the available pane while keeping cues in one scrollable list', () => {
    const layout = cssBlocks('.video-result-subtitle-preview-layout');
    const pane = cssBlocks('.video-result-subtitle-pane');
    const video = cssBlocks('.video-result-subtitle-video');
    const list = cssBlocks('.video-result-subtitle-preview-layout .video-subtitle-editor');
    const portrait = cssBlocks('.video-result-subtitle-video .video-result-player-frame[data-ratio="9:16"]');
    const cue = cssBlocks('.video-result-subtitle-preview-layout .video-subtitle-cue');
    const editor = cssBlocks('.video-result-subtitle-preview-layout .video-subtitle-editor textarea');

    expect(layout[0]).toContain('grid-template-columns: minmax(0, .95fr) minmax(0, 1.05fr);');
    expect(pane[0]).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(pane[0]).toContain('container-name: video-result-subtitles;');
    expect(video[0]).toContain('container-type: size;');
    expect(video[0]).toContain('align-content: start;');
    expect(list[0]).toContain('min-height: 0;');
    expect(list[0]).toContain('overflow-y: auto;');
    expect(list[0]).not.toContain('max-height:');
    expect(portrait[0]).toContain('width: min(100%, calc((100cqh - 28px) * 0.5625));');
    expect(portrait[1]).toContain('width: min(100%, 440px);');
    expect(cue[0]).toContain('grid-template-columns: 100px minmax(0, 1fr);');
    expect(editor[0]).toContain('field-sizing: content;');
    expect(dashboardCss).toMatch(/@container video-result-subtitles \(max-width: 600px\) \{\s*\.video-result-subtitle-preview-layout/);
  });

  it('keeps video result controls separate from the Agent panel layout', () => {
    const resultVersionButton = cssBlocks('.video-result-version > button');
    const resultVersionItem = cssBlocks('.video-result-version > div button');
    const agentHeader = cssBlocks('.creator-collaboration-header');
    const agentContext = cssBlocks('.creator-collaboration-context');

    expect(resultVersionButton).toHaveLength(1);
    expect(resultVersionButton[0]).toContain('display: inline-flex;');
    expect(resultVersionItem).toHaveLength(1);
    expect(resultVersionItem[0]).toContain('width: 100%;');
    expect(agentHeader).toHaveLength(1);
    expect(agentHeader[0]).toContain(
      'grid-template-columns: 36px minmax(0, 1fr) auto;'
    );
    expect(agentContext).toHaveLength(1);
    expect(agentContext[0]).toContain(
      'grid-template-columns: 18px minmax(0, 1fr);'
    );
  });

  it('keeps the Agent composer textarea from drawing a second focus frame', () => {
    const composerTextareaFocus = cssBlocks(
      '.creator-workspace-page .tool-agent-composer textarea:focus-visible'
    );

    expect(composerTextareaFocus).toHaveLength(1);
    expect(composerTextareaFocus[0]).toContain('outline: 0;');
  });

  it('styles the result toolbar, tabs, version history, and regeneration actions', () => {
    expect(cssBlocks('.video-result-toolbar')).toHaveLength(1);
    expect(cssBlocks('.video-result-tabs')).toHaveLength(1);
    expect(cssBlocks('.video-result-tabs > button')).toHaveLength(1);
    expect(cssBlocks('.video-result-tabs > button[aria-selected="true"]')).toHaveLength(1);
    expect(cssBlocks('.video-result-version > div button[aria-current="true"]')).toHaveLength(1);
    expect(cssBlocks('.video-result-version > div small')).toHaveLength(1);
    expect(cssBlocks('.video-result-notice')).toHaveLength(1);
    expect(cssBlocks('.video-result-regenerate')).toHaveLength(1);
    expect(cssBlocks('.video-result-pane-actions')).toHaveLength(1);
  });

  it('uses the available workspace width for translation results', () => {
    const resultHeader = cssBlocks(
      '.video-translation-wizard-main[data-phase="result"] .video-translation-header'
    );
    const resultBody = cssBlocks(
      '.video-translation-wizard-main[data-phase="result"] .video-translation-wizard-body'
    );

    expect(resultHeader).toHaveLength(1);
    expect(resultHeader[0]).toContain('width: min(1080px, 100%);');
    expect(resultBody).toHaveLength(1);
    expect(resultBody[0]).toContain('width: min(1080px, 100%);');
  });

  it('keeps media generation steps vertically scrollable inside the fixed workspace', () => {
    const stepScroll = cssBlocks('.media-generation-step-scroll');

    expect(stepScroll).toHaveLength(1);
    expect(stepScroll[0]).toContain('min-height: 0;');
    expect(stepScroll[0]).toContain('overflow-x: hidden;');
    expect(stepScroll[0]).toContain('overflow-y: auto;');
    expect(stepScroll[0]).toContain('scrollbar-gutter: stable;');
  });

  it('keeps cover results within the available height and scrolls the result pane', () => {
    const coverWorkspace = cssBlocks('.cover-result-workspace');
    const resultLayout = cssBlocks('.cover-result-workspace .creator-result-layout');
    const resultPane = cssBlocks('.cover-result-workspace .video-result-pane');

    expect(coverWorkspace).toHaveLength(1);
    expect(coverWorkspace[0]).toContain('height: 100%;');
    expect(coverWorkspace[0]).toContain('min-height: 0;');
    expect(resultLayout).toHaveLength(1);
    expect(resultLayout[0]).toContain('flex: 1 1 auto;');
    expect(resultLayout[0]).toContain('min-height: 0;');
    expect(resultLayout[0]).toContain('grid-template-rows: minmax(0, 1fr);');
    expect(resultLayout[0]).toContain('overflow: hidden;');
    expect(resultPane).toHaveLength(1);
    expect(resultPane[0]).toContain('min-height: 0;');
  });

  it('keeps storyboard navigation fixed while only the shot list scrolls', () => {
    const storyboardStep = cssBlocks('.stickman-storyboard-step');
    const storyboardPanel = cssBlocks('.stickman-storyboard-review');
    const storyboardEditor = cssBlocks('.stickman-storyboard-review .stickman-storyboard-editor');

    expect(storyboardStep).toHaveLength(1);
    expect(storyboardStep[0]).toContain('grid-template-rows: minmax(0, 1fr) auto;');
    expect(storyboardPanel).toHaveLength(1);
    expect(storyboardPanel[0]).toContain('overflow: hidden;');
    expect(storyboardEditor).toHaveLength(1);
    expect(storyboardEditor[0]).toContain('overflow-y: auto;');
    expect(storyboardEditor[0]).toContain('scrollbar-gutter: stable;');
  });

  it('keeps script generation content meaningful inside the fixed editor layout', () => {
    const scriptStep = cssBlocks('.stickman-script-step');
    const scriptPanel = cssBlocks('.stickman-script-panel');
    const scriptEditor = cssBlocks('.stickman-script-editor');
    const skeletonBox = cssBlocks('.stickman-script-skeleton-box');

    expect(scriptStep).toHaveLength(1);
    expect(scriptStep[0]).toContain('grid-template-rows: minmax(0, 1fr) auto;');
    expect(scriptPanel).toHaveLength(1);
    expect(scriptPanel[0]).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(scriptPanel[0]).toContain('overflow: hidden;');
    expect(scriptEditor).toHaveLength(1);
    expect(scriptEditor[0]).toContain('overflow-y: auto;');
    expect(skeletonBox).toHaveLength(1);
    expect(skeletonBox[0]).toContain('background: var(--conversation-bg);');
  });

  it('visually preserves creator steps that remain reachable after navigating back', () => {
    const reachableConnector = cssBlocks(
      '.video-translation-steps li[data-next-reachable="true"]::after'
    );
    const visitedStep = cssBlocks(
      '.video-translation-steps li[data-visited="true"] button'
    );

    expect(reachableConnector).toHaveLength(1);
    expect(reachableConnector[0]).toContain('background: var(--accent);');
    expect(visitedStep).toHaveLength(1);
    expect(visitedStep[0]).toContain('color: var(--text);');
  });
});
