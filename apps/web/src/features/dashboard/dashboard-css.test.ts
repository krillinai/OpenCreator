import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dashboardCss = readFileSync(
  'src/features/dashboard/dashboard.css',
  'utf8'
).replaceAll('\r\n', '\n');

function cssBlocks(selector: string): string[] {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return Array.from(
    dashboardCss.matchAll(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, 'g')),
    match => match.groups?.body ?? ''
  );
}

describe('dashboard CSS contracts', () => {
  it('keeps video result controls separate from the Agent panel layout', () => {
    const resultVersionButton = cssBlocks('.video-result-version > button');
    const resultVersionItem = cssBlocks('.video-result-version > div button');
    const agentHeader = cssBlocks('.video-translation-agent-header');
    const agentContext = cssBlocks('.video-translation-agent-context');

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
});
