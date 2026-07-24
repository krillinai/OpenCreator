import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync('src/styles/app.css', 'utf8');
const appControllerTsx = readFileSync('src/app/AppController.tsx', 'utf8');
const skillMarketCss = readFileSync('src/features/plugins/skill-market.css', 'utf8');
const schedulesCss = readFileSync('src/features/schedules/schedules-view.css', 'utf8');
const settingsCss = readFileSync('src/features/settings/settings-management.css', 'utf8');
const taskCenterCss = readFileSync('src/features/tasks/task-center.css', 'utf8');
const tokensCss = readFileSync('src/styles/tokens.css', 'utf8');

function cssBlock(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = appCss.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? '';
}

function skillMarketCssBlock(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = skillMarketCss.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? '';
}

function schedulesCssBlock(selector: string) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = schedulesCss.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? '';
}

function hexChannels(value: string): number[] {
  const normalized = value.length === 3
    ? value.split('').map(channel => channel.repeat(2)).join('')
    : value;
  return [0, 2, 4].map(offset => Number.parseInt(normalized.slice(offset, offset + 2), 16));
}

describe('app CSS visual contracts', () => {
  it('uses complete light and dark monochrome theme tokens', () => {
    const themeSources = [
      tokensCss,
      appCss,
      skillMarketCss,
      schedulesCss,
      settingsCss,
      taskCenterCss,
      appControllerTsx,
    ].join('\n');
    const colorChannels = [
      ...Array.from(themeSources.matchAll(/#([\da-f]{3}|[\da-f]{6})(?![\da-f])/gi), match =>
        hexChannels(match[1]!)
      ),
      ...Array.from(themeSources.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g), match =>
        [Number(match[1]), Number(match[2]), Number(match[3])]
      ),
    ];

    expect(tokensCss).toContain(':root[data-theme="dark"]');
    expect(tokensCss).toContain(':root[data-theme="light"]');
    expect(tokensCss).toContain('color-scheme: dark;');
    expect(tokensCss).toContain('color-scheme: light;');
    expect(tokensCss).toContain('--accent: #d7d7da;');
    expect(tokensCss).toContain('--accent: #303035;');
    expect(colorChannels.length).toBeGreaterThan(0);
    expect(colorChannels.every(channels => Math.max(...channels) - Math.min(...channels) <= 8)).toBe(true);
  });

  it('keeps sidebar project rows fixed while loading and places the scrollbar at the edge', () => {
    const projectTree = cssBlock('.sidebar-project-tree');
    const sidebarRow = cssBlock('.sidebar-row');
    const projectRow = cssBlock('.project-row');
    const currentProjectIcon = cssBlock('.project-row[data-current-project="true"] .project-icon');
    const selectedConversationRow = cssBlock('.nested-conversation-row[aria-current="page"]');
    const settingsButton = cssBlock('.settings-button');

    expect(projectTree).toContain('align-content: start;');
    expect(projectTree).toContain('grid-auto-rows: max-content;');
    expect(projectTree).toContain('margin-right: -12px;');
    expect(projectTree).toContain('padding: 0 12px 4px 0;');
    expect(sidebarRow).toContain('height: 40px;');
    expect(sidebarRow).toContain('gap: 4px;');
    expect(sidebarRow).toContain('padding: 0 6px;');
    expect(projectRow).toContain('font-weight: 520;');
    expect(appCss).toMatch(/\.conversation-row\s*\{[^}]*padding:\s*0 10px 0 32px;/);
    expect(currentProjectIcon).toContain('color: var(--accent);');
    expect(selectedConversationRow).toContain('background: var(--accent-soft);');
    expect(selectedConversationRow).not.toContain('border-color');
    expect(settingsButton).toContain('gap: 4px;');
    expect(settingsButton).toContain('padding: 0 6px;');
  });

  it('keeps the conversation run indicator compact and motion-aware', () => {
    const meta = cssBlock('.conversation-row-meta');
    const spinner = cssBlock('.conversation-run-spinner');

    expect(meta).toContain('display: inline-flex;');
    expect(meta).toContain('gap: 6px;');
    expect(spinner).toContain('flex: 0 0 auto;');
    expect(spinner).toContain('color: var(--accent);');
    expect(spinner).toContain('animation: conversation-run-spin 900ms linear infinite;');
    expect(appCss).toMatch(/@keyframes conversation-run-spin\s*\{[^}]*transform:\s*rotate\(360deg\);/);
    expect(appCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.conversation-run-spinner\s*\{[^}]*animation:\s*none;/
    );
  });

  it('keeps task rows stable, scrollable, and motion-aware', () => {
    const taskSection = cssBlock('.sidebar-task-section');
    const taskList = cssBlock('.sidebar-task-list');
    const taskRow = cssBlock('.sidebar-task-row');
    const taskSpinner = cssBlock('.sidebar-task-spinner');

    expect(taskSection).toContain('min-height: 0;');
    expect(taskSection).toContain('max-height: 220px;');
    expect(taskList).toContain('overflow-y: auto;');
    expect(taskList).toContain('grid-auto-rows: 44px;');
    expect(taskRow).toContain('height: 44px;');
    expect(taskRow).toContain('min-height: 44px;');
    expect(taskSpinner).toContain('animation: conversation-run-spin 900ms linear infinite;');
    expect(appCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[^}]*\.sidebar-task-spinner\s*\{[^}]*animation:\s*none;/
    );
  });

  it('keeps the task thread toolbar compact and mobile-safe', () => {
    const taskHeader = cssBlock('.conversation-header--task');
    const taskStrip = cssBlock('.conversation-task-strip');
    const taskToolbar = cssBlock('.schedule-thread-header');
    const taskActions = cssBlock('.schedule-thread-actions');

    expect(taskHeader).toContain('grid-template-columns: minmax(0, 1fr) auto;');
    expect(taskStrip).toContain('grid-column: 1 / -1;');
    expect(taskStrip).toContain('min-width: 0;');
    expect(taskToolbar).toContain('min-height: 36px;');
    expect(taskToolbar).toContain('flex-wrap: wrap;');
    expect(taskActions).toContain('flex: 0 0 auto;');
    expect(appCss).toMatch(
      /@media \(max-width: 720px\)\s*\{[\s\S]*?\.schedule-thread-header\s*\{[^}]*align-items:\s*flex-start;/
    );
  });

  it('keeps the schedule select chevron inside the native select click target', () => {
    const control = schedulesCssBlock('.schedule-select-control');
    const select = schedulesCssBlock('.schedule-select-control select');
    const chevron = schedulesCssBlock('.schedule-select-control svg');

    expect(control).toContain('position: relative;');
    expect(schedulesCss).toMatch(
      /\.schedule-select-control select,\s*\.schedule-setting-input,\s*\.schedule-time-input\s*\{[^}]*width:\s*100%;/
    );
    expect(select).toContain('padding-right: 24px;');
    expect(chevron).toContain('position: absolute;');
    expect(chevron).toContain('pointer-events: none;');
  });

  it('keeps global scrollbars darker and trackless', () => {
    const webkitScrollbar = cssBlock('*::-webkit-scrollbar');
    const webkitScrollbarTrack = cssBlock('*::-webkit-scrollbar-track,\n*::-webkit-scrollbar-track-piece,\n*::-webkit-scrollbar-corner');
    const webkitScrollbarThumb = cssBlock('*::-webkit-scrollbar-thumb');
    const activeScrollbar = cssBlock('.is-scrollbar-active');
    const activeScrollbarThumb = cssBlock('.is-scrollbar-active::-webkit-scrollbar-thumb');
    const activeScrollbarThumbHover = cssBlock('.is-scrollbar-active::-webkit-scrollbar-thumb:hover');

    expect(appCss).toContain('scrollbar-color: transparent transparent;');
    expect(activeScrollbar).toContain('scrollbar-color: color-mix(in srgb, var(--text) 24%, transparent) transparent;');
    expect(webkitScrollbar).toContain('width: 4px;');
    expect(webkitScrollbar).toContain('height: 6px;');
    expect(webkitScrollbar).toContain('background: transparent;');
    expect(webkitScrollbarTrack).toContain('background: transparent;');
    expect(webkitScrollbarThumb).toContain('background-color: transparent;');
    expect(activeScrollbarThumb).toContain('background-color: color-mix(in srgb, var(--text) 22%, transparent);');
    expect(activeScrollbarThumbHover).toContain('background-color: color-mix(in srgb, var(--text) 34%, transparent);');
  });

  it('keeps the app shell dark during layout changes', () => {
    const mainPane = cssBlock('.clawee-main-pane');

    expect(appCss).toMatch(/html,\nbody,\n#root\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;[^}]*background:\s*var\(--bg\);/);
    expect(tokensCss).toContain('--bg: #0c0d0f;\n  --conversation-bg: #0c0d0f;');
    expect(tokensCss).toContain('--bg: #fafafa;\n  --conversation-bg: #fafafa;');
    expect(mainPane).toContain('background: var(--conversation-bg);');
    expect(mainPane).toContain('overflow: hidden;');
  });

  it('uses local fonts and opaque primary surfaces during viewport changes', () => {
    const body = cssBlock('body');
    const conversationHeader = cssBlock('.conversation-header');
    const composer = cssBlock('.clawee-composer');

    expect(appCss).not.toContain('@import url(');
    expect(tokensCss).toContain('--font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;');
    expect(body).toContain('text-rendering: auto;');
    expect(conversationHeader).toContain('background: var(--conversation-bg);');
    expect(conversationHeader).not.toMatch(/background:\s*(?:linear-gradient|color-mix)/);
    expect(composer).toContain('background: var(--surface);');
    expect(composer).not.toMatch(/background:\s*(?:linear-gradient|color-mix)/);
    expect(appCss).toMatch(/\.clawee-sidebar-pane\s*\{[^}]*background:\s*var\(--sidebar\);/);
  });

  it('keeps the desktop shell inside short viewports', () => {
    const shell = cssBlock('.clawee-shell');

    expect(shell).toContain('width: 100%;');
    expect(shell).toContain('height: 100%;');
    expect(shell).toContain('min-height: 0;');
    expect(shell).not.toContain('min-height: 640px;');
  });

  it('stretches HTML previews across the full editor area', () => {
    const preview = cssBlock('.file-preview-html');
    const frame = cssBlock('.file-preview-html iframe');

    expect(preview).toContain('height: 100%;');
    expect(preview).toContain('align-self: stretch;');
    expect(preview).toContain('grid-template-rows: minmax(0, 1fr) auto;');
    expect(frame).toContain('height: 100%;');
    expect(frame).toContain('min-height: 0;');
  });

  it('keeps the desktop skill market scrollable inside the fixed app shell', () => {
    expect(skillMarketCss).toMatch(
      /@media \(min-width: 921px\)\s*\{\s*\.skill-market\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/
    );
  });

  it('uses a compact toolbar with sorting and workflow navigation', () => {
    const toolbar = skillMarketCssBlock('.skill-market__toolbar');
    const filterRow = skillMarketCssBlock('.skill-market-filter-row');
    const categoryLine = skillMarketCssBlock('.skill-market-category-line');
    const statusControls = skillMarketCssBlock('.skill-market-status-controls');
    const searchFocus = skillMarketCssBlock('.skill-market-search input:focus-visible');
    const sort = skillMarketCssBlock('.skill-market-sort');

    expect(toolbar).toContain('display: flex;');
    expect(toolbar).toContain('justify-content: flex-end;');
    expect(filterRow).toContain('display: flex;');
    expect(filterRow).toContain('overflow-x: auto;');
    expect(categoryLine).toContain('justify-content: space-between;');
    expect(statusControls).toContain('flex: 0 0 auto;');
    expect(sort).toContain('height: 40px;');
    expect(searchFocus).toContain('outline: none;');
    expect(skillMarketCss).not.toContain('.skill-market-filter-selects');
    expect(skillMarketCss).not.toContain('.skill-market-filter-shell');
    expect(skillMarketCss).not.toContain('.skill-market-chip-row');
  });

  it('centers the collapsed sidebar logo inside its square button', () => {
    const brandButton = cssBlock('.sidebar-brand-button');

    expect(brandButton).toContain('padding: 0;');
  });

  it('uses an avatar-first compact metadata flow without card covers', () => {
    const card = skillMarketCssBlock('.skill-market-card');
    const cardOpen = skillMarketCssBlock('.skill-market-card__open');
    const identity = skillMarketCssBlock('.skill-market-card__identity');
    const body = skillMarketCssBlock('.skill-market-card__body');
    const tags = skillMarketCssBlock('.skill-market-card__tags');
    const tagline = skillMarketCssBlock('.skill-market-card__tagline');
    const avatar = skillMarketCssBlock('.skill-market-avatar--small');

    expect(card).toContain('min-height: 176px;');
    expect(cardOpen).toContain('flex-direction: column;');
    expect(identity).toContain('align-items: center;');
    expect(body).toContain('flex-direction: column;');
    expect(tags).toContain('overflow: hidden;');
    expect(tagline).toContain('-webkit-line-clamp: 2;');
    expect(avatar).toContain('width: 40px;');
    expect(skillMarketCss).not.toContain('.skill-market-card__cover');
    expect(skillMarketCss).not.toContain('.skill-market-task-row');
  });

  it('scales the skill market grid from five columns down to one', () => {
    const grid = skillMarketCssBlock('.skill-market-grid');

    expect(grid).toContain('grid-template-columns: repeat(5, minmax(0, 1fr));');
    expect(skillMarketCss).toMatch(
      /@media \(max-width: 1920px\)[\s\S]*?\.skill-market-grid\s*\{[^}]*repeat\(4, minmax\(0, 1fr\)\)/
    );
    expect(skillMarketCss).toMatch(
      /@media \(max-width: 1560px\)[\s\S]*?\.skill-market-grid\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/
    );
    expect(skillMarketCss).toMatch(
      /@media \(max-width: 1220px\)[\s\S]*?\.skill-market-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/
    );
    expect(skillMarketCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.skill-market-grid[^}]*grid-template-columns: minmax\(0, 1fr\)/
    );
  });

  it('uses a single-column skill detail with real media cases and a fixed primary action', () => {
    const modal = skillMarketCssBlock('.skill-market-modal');
    const body = skillMarketCssBlock('.skill-market-modal__body');
    const head = skillMarketCssBlock('.skill-market-detail-head');
    const identity = skillMarketCssBlock('.skill-market-detail-head__identity');
    const author = skillMarketCssBlock('.skill-market-detail-meta .skill-market-detail-author');
    const layout = skillMarketCssBlock('.skill-market-detail-layout');
    const workflow = skillMarketCssBlock('.skill-market-detail-workflow');
    const workflowList = skillMarketCssBlock('.skill-market-detail-list');
    const workflowTitle = skillMarketCssBlock('.skill-market-detail-list h4');
    const workflowItems = skillMarketCssBlock('.skill-market-detail-list__items');
    const workflowItem = skillMarketCssBlock('.skill-market-detail-list__items span');
    const caseList = skillMarketCssBlock('.skill-market-case-list');
    const scrollableCaseList = skillMarketCssBlock('.skill-market-case-list--scrollable');
    const caseMedia = skillMarketCssBlock('.skill-market-case__media');
    const caseCaption = skillMarketCssBlock('.skill-market-case__caption');
    const titleRow = skillMarketCssBlock('.skill-market-detail-title-row');
    const bookmark = skillMarketCssBlock('.skill-market-detail-bookmark');
    const description = skillMarketCssBlock('.skill-market-detail-description');
    const risk = skillMarketCssBlock('.skill-market-detail-risk');
    const riskList = skillMarketCssBlock('.skill-market-detail-risk ul');
    const riskItem = skillMarketCssBlock('.skill-market-detail-risk li');
    const preview = skillMarketCssBlock('.skill-market-example-preview');
    const previewMedia = skillMarketCssBlock('.skill-market-case__media--preview');
    const primary = skillMarketCssBlock('.skill-market-modal__primary');

    expect(modal).toContain('width: min(600px, 100%);');
    expect(modal).toContain('max-height: min(800px, calc(100dvh - 64px));');
    expect(modal).toContain('outline: none;');
    expect(modal).toContain('grid-template-rows: auto minmax(0, 1fr) auto;');
    expect(body).toContain('padding: 4px 24px 26px;');
    expect(head).toContain('padding: 24px 24px 16px;');
    expect(head).toContain('background: var(--surface);');
    expect(identity).toContain('display: flex;');
    expect(author).toContain('border: 0;');
    expect(author).toContain('background: transparent;');
    expect(author).toContain('font-size: 12px;');
    expect(skillMarketCss).not.toContain('.skill-market-modal__close');
    expect(titleRow).toContain('display: flex;');
    expect(bookmark).toContain('margin-left: auto;');
    expect(description).not.toContain('border-top');
    expect(risk).toContain('padding: 12px 14px;');
    expect(riskList).toContain('gap: 4px;');
    expect(riskItem).toContain('font-size: 12px;');
    expect(riskItem).toContain('line-height: 1.35;');
    expect(layout).toContain('gap: 22px;');
    expect(layout).toContain('margin-top: 0;');
    expect(layout).not.toContain('grid-template-columns');
    expect(workflow).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(workflow).toContain('gap: 10px;');
    expect(workflowList).toContain('min-height: 78px;');
    expect(workflowList).toContain('padding: 10px 12px;');
    expect(workflowTitle).toContain('margin: 0 0 8px;');
    expect(workflowItems).toContain('gap: 5px;');
    expect(workflowItem).toContain('padding: 4px 7px;');
    expect(workflowItem).toContain('font-size: 10px;');
    expect(caseList).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(scrollableCaseList).toContain('grid-auto-flow: column;');
    expect(scrollableCaseList).toContain('grid-auto-columns: calc((100% - 24px) / 3.2);');
    expect(scrollableCaseList).toContain('overflow-x: auto;');
    expect(caseMedia).toContain('aspect-ratio: 16 / 9;');
    expect(caseMedia).toContain('object-fit: contain;');
    expect(caseCaption).toContain('min-height: 32px;');
    expect(caseCaption).toContain('justify-content: center;');
    expect(caseCaption).toContain('text-align: center;');
    expect(skillMarketCss).not.toContain('.skill-market-case__caption svg');
    expect(preview).toContain('width: min(1180px, 100%);');
    expect(previewMedia).toContain('max-height: calc(100dvh - 140px);');
    expect(primary).toContain('width: 100%;');
    expect(skillMarketCss).not.toContain('.skill-market-modal__toolbar');
    expect(skillMarketCss).not.toContain('.skill-market-detail-head__cover');
    expect(skillMarketCss).not.toContain('.skill-market-detail-grid');
    expect(skillMarketCss).not.toContain('.skill-market-detail-aside');
  });

  it('keeps the composer compact over one continuous conversation background', () => {
    const composerWrap = cssBlock('.composer-wrap');
    const composer = cssBlock('.clawee-composer');
    const composerTextarea = cssBlock('.clawee-composer textarea');

    expect(composerWrap).toContain('position: relative;');
    expect(composerWrap).toContain('padding: 0 clamp(18px, 4vw, 52px) 37px;');
    expect(composerWrap).toContain('background: transparent;');
    expect(appCss).not.toContain('.composer-wrap::before');
    expect(composer).toContain('position: relative;');
    expect(composer).toContain('z-index: 1;');
    expect(composer).toContain('gap: 8px;');
    expect(composer).toContain('padding: 10px 18px;');
    expect(appCss).toMatch(/\.composer-wrap\s*\{\s*padding:\s*0 12px 6px;/);
    expect(composerTextarea).toContain('min-height: 48px;');
    expect(composerTextarea).toContain('max-height: 268px;');
    expect(composerTextarea).toContain('font-size: 14px;');
    expect(composerTextarea).toContain('line-height: 22px;');
    expect(composerTextarea).toContain('resize: none;');
    expect(composerTextarea).not.toContain('resize: vertical;');
    expect(appCss).toMatch(/\.composer-select,\n\.composer-model-button\s*\{[^}]*padding:\s*0 2px;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);
    expect(appCss).toMatch(/\.composer-send\s*\{[^}]*width:\s*38px;[^}]*height:\s*38px;/);
    expect(appCss).toMatch(
      /@media \(max-height: 560px\) and \(min-width: 921px\)\s*\{[\s\S]*?\.composer-wrap\s*\{[^}]*padding:\s*0 clamp\(18px, 4vw, 52px\) 10px;/
    );
    expect(cssBlock('.timeline-end-spacer')).toContain('min-height: clamp(72px, 10vh, 112px);');
    expect(cssBlock('.app-drop-shell')).toContain('height: 100%;');
    expect(cssBlock('.project-drop-overlay')).toContain('pointer-events: none;');
  });

  it('keeps the empty-state title centered without the large decorative logo', () => {
    const title = cssBlock('.conversation-empty-state h2');
    const lightTitle = cssBlock(':root[data-theme="light"] .conversation-empty-state h2');
    const lightComposer = cssBlock(':root[data-theme="light"] .clawee-composer');

    expect(appCss).not.toContain('.conversation-empty-logo-bg');
    expect(title).toContain('font-size: 48px;');
    expect(lightTitle).toContain('text-shadow: none;');
    expect(lightComposer).toContain('border-color: color-mix(in srgb, var(--text) 16%, transparent);');
    expect(lightComposer).toContain('background: var(--surface);');
    expect(lightComposer).toContain('backdrop-filter: none;');
    expect(lightComposer).not.toContain('linear-gradient');
    expect(lightComposer).not.toContain('inset');
    expect(appCss).toMatch(/:root\[data-theme="light"\] \.clawee-composer \.composer-icon-button,[\s\S]*?\.composer-submit-menu-button\s*\{[^}]*box-shadow:\s*none;/);
    expect(appCss).toMatch(/\.conversation-empty-state h2\s*\{[^}]*font-size:\s*38px;/);
    expect(appCss).toMatch(/\.conversation-empty-state h2\s*\{[^}]*font-size:\s*30px;/);
  });

  it('styles the color mode selector as a compact product control', () => {
    const colorMode = cssBlock('.settings-color-mode');
    const selectedColorMode = cssBlock('.settings-color-mode button[aria-pressed="true"]');

    expect(colorMode).toContain('display: inline-flex;');
    expect(selectedColorMode).toContain('color: var(--on-accent);');
  });

  it('keeps mobile settings navigation above content without pointer overlap', () => {
    expect(appCss).toMatch(
      /@media \(max-width: 720px\)\s*\{[\s\S]*?\.settings-page\s*\{[^}]*height:\s*100%;[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\);/
    );
    expect(appCss).toMatch(
      /@media \(max-width: 720px\)\s*\{[\s\S]*?\.settings-nav\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;/
    );
    expect(appCss).toMatch(
      /@media \(max-width: 720px\)\s*\{[\s\S]*?\.settings-nav button\s*\{[^}]*flex:\s*0 0 auto;[^}]*white-space:\s*nowrap;/
    );
    expect(appCss).toMatch(
      /@media \(max-width: 720px\)\s*\{[\s\S]*?\.settings-content\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/
    );
  });

  it('uses an overlay drawer and stable scroll container for mobile navigation', () => {
    expect(appCss).toMatch(
      /@media \(max-width: 920px\)\s*\{[\s\S]*?\.clawee-sidebar-pane\s*\{[^}]*position:\s*fixed;[^}]*transform:\s*translateX\(-100%\);/
    );
    expect(appCss).toMatch(
      /@media \(max-width: 920px\)\s*\{[\s\S]*?\.clawee-sidebar-pane\[data-mobile-open="true"\]\s*\{[^}]*transform:\s*translateX\(0\);/
    );
    expect(appCss).toMatch(
      /@media \(max-width: 920px\)\s*\{[\s\S]*?\.clawee-main-content\s*\{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/
    );
    expect(appCss).toMatch(
      /@media \(max-width: 920px\)\s*\{[\s\S]*?\.mobile-navigation-trigger\s*\{[^}]*display:\s*inline-grid;/
    );
  });

  it('uses a full-height unframed Skill detail panel on mobile', () => {
    expect(skillMarketCss).toMatch(
      /@media \(max-width: 760px\)\s*\{[\s\S]*?\.skill-market-modal-backdrop\s*\{[^}]*padding:\s*0;/
    );
    expect(skillMarketCss).toMatch(
      /@media \(max-width: 760px\)\s*\{[\s\S]*?\.skill-market-modal\s*\{[^}]*width:\s*100%;[^}]*height:\s*100dvh;[^}]*border-radius:\s*0;/
    );
  });

  it('uses a solid conversation background without dynamic background assets', () => {
    const conversationPage = cssBlock('.conversation-page');

    expect(tokensCss).toContain('--conversation-bg: #0c0d0f;');
    expect(tokensCss).toContain('--conversation-bg: #fafafa;');
    expect(conversationPage).toContain('background: var(--conversation-bg);');
    expect(appCss).not.toContain('.conversation-lightfall-bg');
    expect(appControllerTsx).not.toContain('Lightfall');
    expect(appControllerTsx).not.toContain('data-background-mode');
    expect(appControllerTsx).not.toContain('data-dynamic-background');
  });

  it('keeps the conversation history loading state on the dark surface', () => {
    const conversationBody = cssBlock('.conversation-body');
    const timelineList = cssBlock('.timeline-list');
    const historyLoading = cssBlock('.conversation-history-loading');

    expect(conversationBody).toContain('background: var(--conversation-bg);');
    expect(timelineList).toContain('background: var(--conversation-bg);');
    expect(historyLoading).toContain('position: absolute;');
    expect(historyLoading).toContain('inset: 0;');
    expect(historyLoading).toContain('background: var(--conversation-bg);');
    expect(historyLoading).toContain('color: var(--muted);');
  });

  it('keeps the file workspace header compact and single-layered', () => {
    const workspace = cssBlock('.file-workspace-view');
    const topBar = cssBlock('.file-top-bar');
    const topBarMain = cssBlock('.file-top-bar-main');
    const topBarPath = cssBlock('.file-top-bar-path');
    const hiddenEditorToolbar = cssBlock('.file-editor-pane[data-toolbar="hidden"]');

    expect(workspace).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(topBar).toContain('min-height: 72px;');
    expect(topBar).toContain('padding: 12px 16px 12px 18px;');
    expect(topBarMain).toContain('flex-direction: column;');
    expect(topBarPath).toContain('font-size: 12px;');
    expect(hiddenEditorToolbar).toContain('grid-template-rows: auto minmax(0, 1fr);');
  });

  it('uses a neutral disabled state for the empty composer send button', () => {
    const disabledSend = cssBlock('.composer-send:disabled');
    const disabledSendIcon = cssBlock('.composer-send:disabled svg');

    expect(disabledSend).toContain('background: var(--control-disabled);');
    expect(disabledSend).toContain('color: var(--control-disabled-text);');
    expect(disabledSendIcon).toContain('color: var(--control-disabled-text);');
  });

  it('keeps user messages as bubbles and assistant replies as unframed prose', () => {
    const userBubble = cssBlock('.timeline-user_message .timeline-bubble');
    const assistantBubble = cssBlock('.timeline-assistant_message .timeline-bubble');

    expect(userBubble).toContain('border-top-right-radius: 0;');
    expect(userBubble).not.toContain('border-bottom-right-radius: 6px;');
    expect(assistantBubble).toContain('border: 0;');
    expect(assistantBubble).toContain('border-radius: 0;');
    expect(assistantBubble).toContain('background: transparent;');
  });

  it('shows the assistant avatar as the logo without a container background', () => {
    const assistantAvatar = cssBlock('.timeline-assistant_message .timeline-avatar');

    expect(assistantAvatar).toContain('border-color: transparent;');
    expect(assistantAvatar).toContain('background: transparent;');
    expect(assistantAvatar).toContain('box-shadow: none;');
    expect(assistantAvatar).not.toMatch(/linear-gradient|var\(--accent/i);
  });

  it('globally disables blur and shadow effects', () => {
    expect(appCss).toMatch(
      /\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-shadow:\s*none !important;[^}]*text-shadow:\s*none !important;[^}]*backdrop-filter:\s*none !important;[^}]*-webkit-backdrop-filter:\s*none !important;[^}]*filter:\s*none !important;/
    );
    expect(appCss).toMatch(
      /html\.is-window-resizing \*,\s*html\.is-window-resizing \*::before,\s*html\.is-window-resizing \*::after\s*\{[^}]*transition:\s*none !important;[^}]*animation-play-state:\s*paused !important;/
    );
  });
});
