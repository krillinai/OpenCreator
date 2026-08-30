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

  it('renders the subtitle preview in the selected vertical output ratio', () => {
    const verticalPreview = cssBlocks('.video-translation-subtitle-preview[data-ratio="9:16"] > div');

    expect(verticalPreview).toHaveLength(1);
    expect(verticalPreview[0]).toContain('aspect-ratio: 9 / 16;');
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
