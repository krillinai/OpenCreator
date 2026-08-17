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
  it('keeps body copy readable and navigation or status text at 12px or larger', () => {
    const productCss = [appCss, skillMarketCss, schedulesCss, settingsCss, taskCenterCss].join('\n');

    expect(cssBlock('body')).toContain('font: 13px/1.45 var(--font);');
    expect(productCss).not.toMatch(/font(?:-size)?:[^;}]*(?:10|11)(?:\.\d+)?px/);
  });

  it('uses only the 400, 500, and 600 weight scale with tabular figures', () => {
    const productCss = [appCss, skillMarketCss, schedulesCss, settingsCss, taskCenterCss].join('\n');

    expect(cssBlock('body')).toContain('font-variant-numeric: tabular-nums;');
    expect(productCss).not.toMatch(/font-weight:\s*(?!400|500|600)\d{3}/);
    expect(productCss).not.toMatch(/font:\s*(?!400|500|600)\d{3}\s/);
  });

  it('uses complete light and dark neutral theme tokens outside approvals', () => {
    const neutralTokensCss = tokensCss.split(':root[data-accent="blue"]')[0]!;
    const themeSources = [
      neutralTokensCss,
      appCss,
      skillMarketCss,
      schedulesCss,
      settingsCss,
      taskCenterCss,
      appControllerTsx,
    ].join('\n');
    const neutralThemeSources = themeSources
      .replaceAll('#f59e0b', '')
      .replace(/--status-(?:connected|disconnected)(?:-soft)?:\s*[^;]+;/g, '');
    const colorChannels = [
      ...Array.from(neutralThemeSources.matchAll(/#([\da-f]{3}|[\da-f]{6})(?![\da-f])/gi), match =>
        hexChannels(match[1]!)
      ),
      ...Array.from(neutralThemeSources.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g), match =>
        [Number(match[1]), Number(match[2]), Number(match[3])]
      ),
    ];

    expect(tokensCss).toContain(':root[data-theme="dark"]');
    expect(tokensCss).toContain(':root[data-theme="light"]');
    expect(tokensCss).toContain('color-scheme: dark;');
    expect(tokensCss).toContain('color-scheme: light;');
    expect(tokensCss).toContain('--accent: #d7d7da;');
    expect(tokensCss).toContain('--accent: #303035;');
    expect(tokensCss).toContain('--surface-page: #fafafa;');
    expect(tokensCss).toContain('--surface-sidebar: #f3f3f4;');
    expect(tokensCss).toContain('--surface-input: #ffffff;');
    expect(tokensCss).toContain('--surface-popover: #ffffff;');
    expect(tokensCss).toContain('--sidebar: var(--surface-sidebar);');
    expect(tokensCss).toContain('--sidebar-hover: #e9e9eb;');
    expect(colorChannels.length).toBeGreaterThan(0);
    expect(colorChannels.every(channels => Math.max(...channels) - Math.min(...channels) <= 8)).toBe(true);
  });

  it('assigns page, sidebar, composer, and popover surfaces by semantic role', () => {
    expect(tokensCss).toContain('--bg: var(--surface-page);');
    expect(tokensCss).toContain('--conversation-bg: var(--surface-page);');
    expect(tokensCss).toContain('--popover: var(--surface-popover);');
    expect(cssBlock('.clawee-sidebar-pane')).toContain('background: var(--sidebar);');
    expect(cssBlock('.clawee-composer::after')).toContain('background: var(--composer-input-background);');
    expect(cssBlock('.composer-popover')).toContain('background: var(--popover);');
  });

  it('limits ordinary corner radii to the 4px, 6px, and 8px scale', () => {
    const productCss = [appCss, skillMarketCss, schedulesCss, settingsCss, taskCenterCss].join('\n');
    const radiusValues = Array.from(
      productCss.matchAll(/border(?:-[a-z]+){0,2}-radius:\s*([^;]+);/g),
      match => match[1]!.trim()
    );
    const allowedRadiusPart = /^(?:0|4px|6px|8px|50%|999px|var\(--radius\))$/;

    expect(tokensCss).toContain('--radius-sm: 4px;');
    expect(tokensCss).toContain('--radius-md: 6px;');
    expect(tokensCss).toContain('--radius-lg: 8px;');
    expect(tokensCss).toContain('--radius: var(--radius-lg);');
    expect(radiusValues.length).toBeGreaterThan(0);
    expect(radiusValues.every(value => value.split(/\s+/).every(part => allowedRadiusPart.test(part)))).toBe(true);
  });

  it('uses compact desktop control sizes and 44px mobile touch targets', () => {
    expect(tokensCss).toContain('--control-compact-sm: 30px;');
    expect(tokensCss).toContain('--control-compact-md: 32px;');
    expect(tokensCss).toContain('--control-compact-lg: 34px;');
    expect(tokensCss).toContain('--control-touch: 44px;');
    expect(cssBlock('.sidebar-row')).toContain('height: var(--control-compact-md);');
    expect(cssBlock('.sidebar-primary .sidebar-row')).toContain('height: var(--control-compact-sm);');
    expect(cssBlock('.composer-menu-item')).toContain('min-height: var(--control-compact-lg);');
    expect(appCss).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*?button,[\s\S]*?min-height:\s*var\(--control-touch\) !important;/);
    expect(appCss).toMatch(/@media \(max-width: 760px\)\s*\{[\s\S]*?\.sidebar-task-list\s*\{[^}]*grid-auto-rows:\s*var\(--control-touch\);/);
  });

  it('uses shared hover, pressed, focus-visible, and disabled states', () => {
    expect(tokensCss).toContain('--state-hover-bg:');
    expect(tokensCss).toContain('--state-pressed-bg:');
    expect(tokensCss).toContain('--state-border-hover:');
    expect(tokensCss).toContain('--state-focus-ring:');
    expect(tokensCss).toContain('--state-disabled-opacity: 0.46;');
    expect(tokensCss).toContain('--state-pressed-opacity: 0.86;');
    expect(cssBlock('button:disabled')).toContain('opacity: var(--state-disabled-opacity);');
    expect(cssBlock('button:not(:disabled):active')).toContain('opacity: var(--state-pressed-opacity);');
    expect(appCss).toMatch(/:where\(button, \[role="button"\]\)\[aria-disabled="true"\]\s*\{[^}]*opacity:\s*var\(--state-disabled-opacity\);[^}]*pointer-events:\s*none;/);
    expect(appCss).toMatch(/:where\(input, textarea, select\):not\(:disabled\):hover\s*\{[^}]*border-color:\s*var\(--state-border-hover\);/);
    expect(appCss).toMatch(/:where\(button, \[role="button"\], input, textarea, select\):focus-visible\s*\{[^}]*outline:\s*2px solid var\(--state-focus-ring\);/);
  });

  it('defines selectable accent tokens for both light and dark modes', () => {
    for (const color of ['blue', 'cyan', 'purple', 'orange', 'red']) {
      expect(tokensCss).toContain(`:root[data-accent="${color}"]`);
      expect(tokensCss).toContain(`:root[data-theme="light"][data-accent="${color}"]`);
    }
    expect(tokensCss).toContain(':root[data-accent="custom"]');
    expect(tokensCss).toContain('--accent: var(--custom-accent-value);');
    expect(tokensCss).toContain('--on-accent: var(--custom-on-accent);');
  });

  it('keeps sidebar project rows fixed while loading and places the scrollbar at the edge', () => {
    const projectTree = cssBlock('.sidebar-project-tree');
    const sidebarRow = cssBlock('.sidebar-row');
    const projectRow = cssBlock('.project-row');
    const currentProjectIcon = cssBlock('.project-row[data-current-project="true"] .project-icon');
    const selectedConversationRow = cssBlock('.nested-conversation-row[aria-current="page"]');
    const accountButton = cssBlock('.sidebar-account-button');
    const settingsButton = cssBlock('.sidebar-settings-button');

    expect(projectTree).toContain('align-content: start;');
    expect(projectTree).toContain('grid-auto-rows: max-content;');
    expect(projectTree).toContain('margin-right: -12px;');
    expect(projectTree).toContain('padding: 0 12px 4px 0;');
    expect(sidebarRow).toContain('height: var(--control-compact-md);');
    expect(sidebarRow).toContain('font-size: 12px;');
    expect(sidebarRow).toContain('font-weight: 500;');
    expect(sidebarRow).toContain('gap: 4px;');
    expect(sidebarRow).toContain('padding: 0 6px;');
    expect(projectRow).toContain('font-weight: 500;');
    expect(cssBlock('.conversation-row strong')).toContain('font-weight: 500;');
    expect(cssBlock('.sidebar-task-copy strong')).toContain('font-weight: 500;');
    expect(cssBlock('.sidebar-section h2')).toContain('font-weight: 500;');
    expect(appCss).toMatch(/\.conversation-row\s*\{[^}]*padding:\s*0 10px 0 29px;/);
    expect(cssBlock('.sidebar-row svg')).toContain('width: 16px;');
    expect(currentProjectIcon).toContain('color: var(--accent);');
    expect(selectedConversationRow).toContain('background: var(--accent-soft);');
    expect(selectedConversationRow).not.toContain('border-color');
    expect(appCss).toContain(
      '.sidebar-conversation-row-shell:hover .nested-conversation-row[aria-current="page"]'
    );
    expect(appCss).toContain(
      '.sidebar-conversation-row-shell:focus-within .nested-conversation-row[aria-current="page"]'
    );
    expect(accountButton).toContain('height: 42px;');
    expect(accountButton).toContain('gap: 7px;');
    expect(accountButton).toContain('padding: 0 6px;');
    expect(settingsButton).toContain('width: 36px;');
    expect(settingsButton).toContain('height: 36px;');
    expect(settingsButton).toContain('padding: 0;');
    expect(appCss).toContain(
      '.sidebar-conversation-row-shell:hover .sidebar-conversation-actions'
    );
    expect(appCss).toContain(
      '.sidebar-conversation-row-shell:hover .conversation-updated-label'
    );
    expect(appCss).toMatch(
      /\.sidebar-conversation-row-shell:hover \.conversation-updated-label,[^{]+\{\s*opacity: 0;/
    );
    expect(cssBlock('.conversation-updated-label')).toContain('transform: scale(0.92);');
    expect(appCss).toMatch(
      /\.conversation-row strong,[^{]+\.conversation-row \.conversation-updated-label\s*\{\s*color: var\(--text\);/
    );
    expect(appCss).toMatch(
      /\.sidebar-conversation-row-shell:hover \.conversation-row-meta,[^{]+\{\s*display: none;/
    );
    expect(appCss).toMatch(
      /\.sidebar-conversation-row-shell:hover \.conversation-row,[^{]+\{[^}]*padding-right: 88px;[^}]*background:/
    );
    expect(cssBlock('.conversation-title-hover')).toContain('display: none;');
    expect(appCss).toContain('.sidebar-conversation-row-shell:hover .conversation-title-hover');
    expect(cssBlock('.sidebar-conversation-actions')).toContain('width: 84px;');
    expect(cssBlock('.sidebar-conversation-actions')).toContain('grid-template-columns: repeat(3, 28px);');
    expect(cssBlock('.sidebar-conversation-actions')).toContain('position: absolute;');
    expect(cssBlock('.sidebar-conversation-action')).toContain('width: 28px;');
    expect(cssBlock('.sidebar-conversation-action')).toContain('height: 28px;');
    expect(appCss).toMatch(
      /\.sidebar-conversation-action:hover:not\(:disabled\),[^{]+\{[^}]*background: transparent;/
    );
    expect(cssBlock('.sidebar-conversation-menu')).toContain('border-radius: 8px;');
    expect(cssBlock('.sidebar-conversation-rename-input')).toContain('width: calc(100% - 8px);');
    expect(appCss).not.toContain(
      '.nested-conversation-row[aria-current="page"] + .sidebar-conversation-archive'
    );
  });

  it('keeps the conversation run indicator compact and motion-aware', () => {
    const spinner = cssBlock('.conversation-run-spinner');

    expect(appCss).toMatch(/\.conversation-row-meta\s*\{[^}]*display: inline-flex;/);
    expect(appCss).toMatch(/\.conversation-row-meta\s*\{[^}]*gap: 6px;/);
    expect(spinner).toContain('flex: 0 0 auto;');
    expect(spinner).toContain('color: var(--accent);');
    expect(spinner).toContain('animation: conversation-run-spin 900ms linear infinite;');
    expect(appCss).toMatch(/@keyframes conversation-run-spin\s*\{[^}]*transform:\s*rotate\(360deg\);/);
    expect(appCss).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.conversation-run-spinner,\s*\.process-live-activity-icon\.is-running\s*\{[^}]*animation:\s*none;/
    );
    expect(cssBlock('.process-live-activity-icon.is-running')).toContain(
      'animation: conversation-run-spin 900ms linear infinite;'
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
    expect(taskList).toContain('grid-auto-rows: 34px;');
    expect(taskRow).toContain('height: 34px;');
    expect(taskRow).toContain('min-height: 34px;');
    expect(appCss).toMatch(/\.sidebar-task-copy span\s*\{[^}]*transform: scale\(0\.92\);/);
    expect(appCss).toContain('.sidebar-task-row-shell:hover .sidebar-task-row');
    expect(appCss).toMatch(
      /\.sidebar-task-row-shell:hover \.sidebar-task-row,[^{]+\{\s*padding-right: 56px;/
    );
    expect(appCss).toMatch(
      /\.sidebar-task-action:hover:not\(:disabled\),[^{]+\{[^}]*background: transparent;/
    );
    expect(appCss).toContain(
      '.sidebar-task-row-shell:hover .sidebar-task-row[aria-current="page"]'
    );
    expect(appCss).toContain(
      '.sidebar-task-row-shell:focus-within .sidebar-task-row[aria-current="page"]'
    );
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

  it('keeps the schedule editor scrollbar clear of form controls', () => {
    const dialog = cssBlock('.schedule-thread-editor-dialog');
    const scroll = schedulesCssBlock('.schedule-editor__scroll');

    expect(dialog).toContain('width: min(760px, 100%);');
    expect(dialog).toContain('height: min(720px, calc(100dvh - 48px));');
    expect(scroll).toContain('padding: 24px 20px 32px;');
    expect(scroll).toContain('scrollbar-gutter: stable;');
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
    expect(tokensCss).toContain('--surface-page: #0c0d0f;');
    expect(tokensCss).toContain('--surface-page: #fafafa;');
    expect(tokensCss).toContain('--bg: var(--surface-page);\n  --conversation-bg: var(--surface-page);');
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
    expect(conversationHeader).toContain('min-height: 56px;');
    expect(conversationHeader).toContain('padding: 10px 22px;');
    expect(conversationHeader).toContain('background: var(--conversation-bg);');
    expect(conversationHeader).not.toMatch(/background:\s*(?:linear-gradient|color-mix)/);
    expect(appCss).not.toContain('.conversation-project');
    expect(composer).toContain('background: var(--composer-project-background);');
    expect(composer).not.toMatch(/background:\s*(?:linear-gradient|color-mix)/);
    expect(appCss).toMatch(/\.clawee-sidebar-pane\s*\{[^}]*background:\s*var\(--sidebar\);[^}]*border-right:\s*1px solid var\(--border-hairline\);/);
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

  it('top-aligns the signed-in enterprise account icon', () => {
    expect(cssBlock('.enterprise-account-profile-icon')).toContain('align-self: start;');
  });

  it('keeps code block actions compact', () => {
    const action = cssBlock('.markdown-prose .md-code-action');

    expect(action).toContain('min-height: 26px;');
    expect(action).toContain('font-size: 12px;');
  });

  it('keeps the desktop skill market scrollable inside the fixed app shell', () => {
    expect(skillMarketCss).toMatch(
      /@media \(min-width: 921px\)\s*\{\s*\.skill-market\s*\{[^}]*height:\s*100%;[^}]*min-height:\s*0;[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/
    );
  });

  it('uses a compact toolbar with an add menu and workflow navigation', () => {
    const toolbar = skillMarketCssBlock('.skill-market__toolbar');
    const filterRow = skillMarketCssBlock('.skill-market-filter-row');
    const categoryLine = skillMarketCssBlock('.skill-market-category-line');
    const searchFocus = skillMarketCssBlock('.skill-market-search input:focus-visible');
    const addTrigger = skillMarketCssBlock('.skill-market-add__trigger');

    expect(toolbar).toContain('display: flex;');
    expect(toolbar).toContain('justify-content: flex-end;');
    expect(filterRow).toContain('display: flex;');
    expect(filterRow).toContain('overflow-x: auto;');
    expect(categoryLine).toContain('justify-content: space-between;');
    expect(addTrigger).toContain('height: 34px;');
    expect(searchFocus).toContain('outline: none;');
    expect(skillMarketCss).not.toContain('.skill-market-filter-selects');
    expect(skillMarketCss).not.toContain('.skill-market-filter-shell');
    expect(skillMarketCss).not.toContain('.skill-market-chip-row');
  });

  it('gives enterprise use actions a background without a visible border', () => {
    const useActionHover = skillMarketCssBlock('.skill-market-card > .skill-market-action-button--use:hover:not(:disabled)');
    const enterpriseUseActionHover = skillMarketCssBlock('.enterprise-skill-row.skill-market-card > .enterprise-skill-action--use:hover:not(:disabled)');
    const enterpriseUseActionDisabled = skillMarketCssBlock('.enterprise-skill-row.skill-market-card > .enterprise-skill-action--use:disabled');

    expect(skillMarketCss).toMatch(
      /\.skill-market-card > \.skill-market-action-button--use\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;[^}]*color:\s*var\(--accent-strong\);[^}]*box-shadow:\s*0 1px 4px color-mix\(in srgb, var\(--text\) 16%, transparent\);/
    );
    expect(useActionHover).toContain('background: transparent;');
    expect(useActionHover).toContain('color: var(--accent-strong);');
    expect(useActionHover).toContain('box-shadow: 0 2px 6px color-mix(in srgb, var(--text) 20%, transparent);');
    expect(skillMarketCss).toMatch(
      /\.enterprise-skill-row\.skill-market-card > \.enterprise-skill-action--use\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*var\(--accent-soft\);/
    );
    expect(enterpriseUseActionHover).toContain('border-color: transparent;');
    expect(enterpriseUseActionHover).toContain('background: color-mix(in srgb, var(--accent) 16%, var(--surface));');
    expect(enterpriseUseActionDisabled).toContain('border-color: transparent;');
    expect(enterpriseUseActionDisabled).toContain('background: var(--surface-3);');
  });

  it('renders enterprise skill usage without a border', () => {
    expect(
      skillMarketCssBlock('.enterprise-skill-row .skill-market-card__tags > span')
    ).toContain('border: 0;');
  });

  it('uses a compact wordmark image in the expanded sidebar and centers the collapsed logo button', () => {
    const brandButton = cssBlock('.sidebar-brand-button');
    const logoLockup = cssBlock('.sidebar-logo-lockup');
    const wordmark = cssBlock('.sidebar-brand-lockup-logo');
    const logoMark = cssBlock('.sidebar-logo-mark');
    const productName = cssBlock('.sidebar-logo-word');
    const productVersion = cssBlock('.sidebar-brand-version');

    expect(brandButton).toContain('padding: 0;');
    expect(logoLockup).toContain('justify-content: flex-start;');
    expect(logoLockup).toContain('padding-top: 10px;');
    expect(wordmark).toContain('width: 72px;');
    expect(wordmark).toContain('height: 17px;');
    expect(productName).toContain('font-size: 12px;');
    expect(productVersion).toContain('font-size: 12px;');
    expect(appCss).not.toContain('.sidebar-logo-full');
    expect(appCss).toMatch(
      /\n\.sidebar-collapse-button\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/
    );
    expect(logoMark).toContain('width: 28px;');
    expect(logoMark).toContain('height: 28px;');
    expect(appCss).toMatch(/\n\.sidebar-brand-button\s*\{[^}]*border:\s*0;[^}]*background:\s*transparent;/);
    expect(appCss).not.toContain('.sidebar-logo-mark-crop');
  });

  it('aligns sidebar project actions to shared hierarchy columns', () => {
    const sectionHeading = cssBlock('.sidebar-section-heading');
    const sectionActions = cssBlock('.sidebar-section-actions');
    const projectRowShell = cssBlock('.sidebar-project-row-shell');
    const projectActions = cssBlock('.sidebar-project-actions');

    expect(sectionHeading).toContain('grid-template-columns: minmax(0, 1fr) 58px;');
    expect(sectionHeading).toContain('padding-right: 0;');
    expect(sectionActions).toContain('width: 58px;');
    expect(sectionActions).toContain('grid-template-columns: repeat(2, 28px);');
    expect(projectRowShell).toContain('grid-template-columns: minmax(0, 1fr) 58px;');
    expect(projectActions).toContain('width: 58px;');
    expect(projectActions).toContain('grid-template-columns: repeat(2, 28px);');
  });

  it('uses an avatar-first compact metadata flow without card covers', () => {
    const card = skillMarketCssBlock('.skill-market-card');
    const cardOpen = skillMarketCssBlock('.skill-market-card__open');
    const identity = skillMarketCssBlock('.skill-market-card__identity');
    const body = skillMarketCssBlock('.skill-market-card__body');
    const tags = skillMarketCssBlock('.skill-market-card__tags');
    const tagline = skillMarketCssBlock('.skill-market-card__tagline');
    const avatar = skillMarketCssBlock('.skill-market-avatar--small');

    expect(card).toContain('min-height: 142px;');
    expect(cardOpen).toContain('flex-direction: column;');
    expect(identity).toContain('align-items: center;');
    expect(body).toContain('flex-direction: column;');
    expect(tags).toContain('overflow: hidden;');
    expect(tagline).toContain('-webkit-line-clamp: 2;');
    expect(avatar).toContain('width: 40px;');
    expect(skillMarketCss).not.toContain('.skill-market-card__cover');
    expect(skillMarketCss).not.toContain('.skill-market-task-row');
  });

  it('scales the skill market grid from four columns down to one', () => {
    const grid = skillMarketCssBlock('.skill-market-grid');

    expect(grid).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));');
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

  it('uses a single-column skill detail with real media cases and a compact primary action', () => {
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
    const description = skillMarketCssBlock('.skill-market-detail-description');
    const risk = skillMarketCssBlock('.skill-market-detail-risk');
    const riskList = skillMarketCssBlock('.skill-market-detail-risk ul');
    const riskItem = skillMarketCssBlock('.skill-market-detail-risk li');
    const preview = skillMarketCssBlock('.skill-market-example-preview');
    const previewMedia = skillMarketCssBlock('.skill-market-case__media--preview');
    const primary = skillMarketCssBlock('.skill-market-modal__primary');

    expect(modal).toContain('width: min(720px, 100%);');
    expect(modal).toContain('max-height: min(800px, calc(100dvh - 64px));');
    expect(modal).toContain('outline: none;');
    expect(modal).toContain('grid-template-rows: auto minmax(0, 1fr) auto;');
    expect(body).toContain('padding: 8px 24px 24px;');
    expect(head).toContain('padding: 22px 24px 14px;');
    expect(head).toContain('background: var(--surface);');
    expect(identity).toContain('display: flex;');
    expect(author).toContain('border: 0;');
    expect(author).toContain('background: transparent;');
    expect(author).toContain('font-size: 12px;');
    expect(skillMarketCss).not.toContain('.skill-market-modal__close');
    expect(skillMarketCss).not.toContain('.skill-market-detail-bookmark');
    expect(skillMarketCss).not.toContain('.skill-market-detail-users');
    expect(description).not.toContain('border-top');
    expect(risk).toContain('padding: 0;');
    expect(riskList).toContain('gap: 4px;');
    expect(riskItem).toContain('font-size: 12px;');
    expect(riskItem).toContain('line-height: 1.35;');
    expect(layout).toContain('gap: 20px;');
    expect(layout).toContain('margin-top: 0;');
    expect(layout).not.toContain('grid-template-columns');
    expect(workflow).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(workflow).toContain('gap: 20px;');
    expect(workflowList).toContain('min-height: 36px;');
    expect(workflowList).toContain('padding: 0;');
    expect(workflowTitle).toContain('margin: 0;');
    expect(workflowItems).toContain('gap: 0;');
    expect(workflowItem).toContain('padding: 0;');
    expect(workflowItem).toContain('font-size: 12px;');
    expect(caseList).toContain('grid-template-columns: repeat(3, minmax(0, 1fr));');
    expect(scrollableCaseList).toContain('grid-auto-flow: column;');
    expect(scrollableCaseList).toContain('grid-auto-columns: calc((100% - 12px) / 2.2);');
    expect(scrollableCaseList).toContain('overflow-x: auto;');
    expect(caseMedia).toContain('aspect-ratio: 16 / 9;');
    expect(caseMedia).toContain('object-fit: contain;');
    expect(caseCaption).toContain('min-height: 32px;');
    expect(caseCaption).toContain('justify-content: flex-start;');
    expect(caseCaption).toContain('text-align: left;');
    expect(skillMarketCss).not.toContain('.skill-market-case__caption svg');
    expect(preview).toContain('width: min(1180px, 100%);');
    expect(previewMedia).toContain('max-height: calc(100dvh - 140px);');
    expect(primary).toContain('width: auto;');
    expect(skillMarketCss).not.toContain('.skill-market-modal__toolbar');
    expect(skillMarketCss).not.toContain('.skill-market-detail-head__cover');
    expect(skillMarketCss).not.toContain('.skill-market-detail-grid');
    expect(skillMarketCss).not.toContain('.skill-market-detail-aside');
  });

  it('keeps the composer compact over one continuous conversation background', () => {
    const composerWrap = cssBlock('.composer-wrap');
    const composerStack = cssBlock('.composer-stack');
    const composer = cssBlock('.clawee-composer');
    const composerTextarea = cssBlock('.clawee-composer textarea');
    const composerQueue = cssBlock('.composer-queue');
    const composerQueueItem = cssBlock('.composer-queue-item');

    expect(composerWrap).toContain('position: relative;');
    expect(tokensCss).toContain('--conversation-content-max: 816px;');
    expect(tokensCss).toContain('--conversation-gutter: clamp(18px, 5vw, 72px);');
    expect(composerWrap).toContain('padding: 0 var(--conversation-gutter) 24px;');
    expect(composerWrap).toContain('background: transparent;');
    expect(appCss).not.toContain('.composer-wrap::before');
    expect(composerStack).toContain('width: min(var(--conversation-content-max), 100%);');
    expect(composerStack).toContain('display: grid;');
    expect(composer).toContain('position: relative;');
    expect(composer).toContain('z-index: 1;');
    expect(composer).toContain('gap: 8px;');
    expect(composer).toContain('padding: 10px 18px;');
    expect(composer).toContain('width: 100%;');
    expect(composer).toContain('--composer-input-background: #1a1b1e;');
    expect(composer).toContain('--composer-project-background: #232427;');
    expect(composer).toContain('--composer-border: rgba(245, 245, 246, 0.12);');
    expect(composer).toContain('--composer-separator: rgba(245, 245, 246, 0.06);');
    expect(composer).toContain('border: 1px solid var(--composer-border);');
    expect(cssBlock('.clawee-composer::after')).toContain(
      'background: var(--composer-input-background);'
    );
    expect(composerQueue).toContain('margin: 0 14px -1px;');
    expect(composerQueue).toContain('border-bottom: 0;');
    expect(composerQueue).toContain('max-height: 148px;');
    expect(composerQueueItem).toContain('grid-template-columns: 18px minmax(0, 1fr) auto auto auto;');
    expect(composerQueueItem).not.toContain('background:');
    expect(appCss).toMatch(/\.composer-wrap\s*\{\s*padding:\s*0 12px 6px;/);
    expect(composerTextarea).toContain('min-height: 48px;');
    expect(composerTextarea).toContain('max-height: 268px;');
    expect(composerTextarea).toContain('font-size: 14px;');
    expect(composerTextarea).toContain('line-height: 22px;');
    expect(composerTextarea).toContain('resize: none;');
    expect(composerTextarea).not.toContain('resize: vertical;');
    expect(appCss).toMatch(/\n\.composer-project-context\s*\{[^}]*order:\s*10;/);
    expect(appCss).toMatch(/\n\.composer-project-context\s*\{[^}]*margin:\s*2px -18px -10px;/);
    expect(appCss).toMatch(/\n\.composer-project-context\s*\{[^}]*border-top:\s*1px solid var\(--composer-separator\);/);
    expect(appCss).toMatch(/\n\.composer-project-context\s*\{[^}]*border-radius:\s*0 0 8px 8px;/);
    expect(appCss).toMatch(/\.composer-select,\n\.composer-model-button\s*\{[^}]*padding:\s*0 2px;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);
    expect(appCss).toMatch(/\.composer-select,\n\.composer-model-button\s*\{[^}]*font-size:\s*12px;[^}]*font-weight:\s*400;/);
    expect(cssBlock('.composer-project-button')).toContain('font-size: 12px;');
    expect(cssBlock('.composer-popover')).toContain('border: 1px solid #343438;');
    expect(cssBlock('.composer-popover')).toContain('background: var(--popover);');
    expect(cssBlock('.composer-popover')).toContain('opacity: 1;');
    expect(cssBlock(':root[data-theme="light"] .composer-popover')).toContain('background: var(--surface-popover);');
    expect(cssBlock(':root[data-theme="light"] .composer-popover')).toContain('border-color: #dedee1;');
    expect(cssBlock(':root[data-theme="light"] .composer-popover')).toContain('opacity: 1;');
    expect(cssBlock('.composer-menu-item')).toContain('min-height: var(--control-compact-lg);');
    expect(cssBlock('.composer-menu-item strong')).toContain('font-size: 12px;');
    expect(cssBlock('.composer-menu-item strong')).toContain('font-weight: 400;');
    expect(cssBlock('.composer-control-wrap[data-composer-menu-root="model"] .composer-popover')).toContain('left: 0;');
    expect(cssBlock('.composer-control-wrap[data-composer-menu-root="model"] .composer-popover')).toContain('right: auto;');
    expect(cssBlock('.composer-project-option span')).toContain('font-size: 12px;');
    expect(cssBlock('.composer-project-option span')).toContain('font-weight: 400;');
    expect(cssBlock('.composer-popover.composer-project-popover')).toContain('border: 1px solid #343438;');
    expect(cssBlock(':root[data-theme="light"] .composer-popover.composer-project-popover')).toContain('border-color: #e8e8ea;');
    expect(cssBlock('.composer-project-search')).toContain('border: 0;');
    expect(cssBlock(':root[data-theme="light"] .composer-project-search')).toContain('background: #f3f3f4;');
    expect(cssBlock(':root[data-theme="light"] .composer-project-create')).toContain('border-top-color: #eeeeef;');
    expect(appCss).toMatch(/\.composer-send\s*\{[^}]*width:\s*38px;[^}]*height:\s*38px;/);
    expect(appCss).toMatch(/\n\.composer-icon-button\s*\{[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);
    expect(cssBlock('.composer-icon-button:hover')).toContain('color-mix(in srgb, var(--text) 4%, transparent)');
    expect(appCss).toMatch(
      /@media \(max-height: 560px\) and \(min-width: 921px\)\s*\{[\s\S]*?\.composer-wrap\s*\{[^}]*padding:\s*0 var\(--conversation-gutter\) 10px;/
    );
    expect(cssBlock('.timeline-end-spacer')).toContain('min-height: clamp(72px, 10vh, 112px);');
    expect(cssBlock('.app-drop-shell')).toContain('height: 100%;');
    expect(cssBlock('.project-drop-overlay')).toContain('pointer-events: none;');
  });

  it('centers the empty composer beneath a compact greeting without decorative controls', () => {
    const emptyPage = cssBlock('.conversation-page.is-empty');
    const title = cssBlock('.conversation-empty-greeting h2');
    const subtitle = cssBlock('.conversation-empty-greeting p');
    const emptyComposer = cssBlock('.conversation-page.is-empty .composer-wrap');
    const titledEmptyPage = cssBlock('.conversation-page.is-empty.has-header');
    const lightComposer = cssBlock(':root[data-theme="light"] .clawee-composer');

    expect(appCss).not.toContain('.conversation-empty-logo-bg');
    expect(appCss).not.toContain('日常办公');
    expect(appCss).not.toContain('代码开发');
    expect(emptyPage).toContain('grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);');
    expect(titledEmptyPage).toContain(
      'grid-template-rows: auto minmax(0, 1fr) minmax(0, 1fr);'
    );
    expect(appCss).not.toContain(
      '.conversation-page.is-empty.has-header .conversation-empty-state,\n' +
      '.conversation-page.is-empty.has-header .composer-wrap'
    );
    expect(cssBlock('.conversation-empty-greeting')).toContain('width: min(760px, 100%);');
    expect(cssBlock('.conversation-empty-greeting')).toContain('justify-items: start;');
    expect(cssBlock('.conversation-empty-greeting')).toContain('text-align: left;');
    expect(title).toContain('font-family: var(--font);');
    expect(title).toContain('font-size: 30px;');
    expect(subtitle).toContain('font-size: 30px;');
    expect(emptyComposer).toContain('align-self: start;');
    expect(appCss).toMatch(/\.conversation-page\.is-empty \.conversation-empty-greeting,\n\.conversation-page\.is-empty \.conversation-starter-tags\s*\{[^}]*width:\s*min\(740px, 100%\);/);
    expect(cssBlock('.conversation-page.is-empty .composer-stack')).toContain('width: min(740px, 100%);');
    expect(appCss).toMatch(/\.conversation-page\.is-empty \.clawee-composer textarea\s*\{[^}]*min-height:\s*72px;/);
    expect(appCss).toMatch(
      /\.conversation-page\.is-empty \.conversation-empty-state,\n\.conversation-page\.is-empty \.composer-wrap\s*\{[^}]*transform:\s*translateY\(clamp\(-150px, -14vh, -108px\)\);/
    );
    expect(tokensCss).toContain('--border-hairline: rgba(245, 245, 246, 0.08);');
    expect(tokensCss).toContain('--border-hairline: rgba(24, 24, 27, 0.07);');
    expect(cssBlock('.clawee-composer')).toContain('border: 1px solid var(--composer-border);');
    expect(cssBlock('.clawee-composer.without-project-selector')).toContain(
      'background: var(--composer-input-background);'
    );
    expect(cssBlock('.clawee-composer.without-project-selector::after')).toContain('inset: 0;');
    expect(cssBlock('.clawee-composer::before')).toContain('border: 0;');
    expect(cssBlock('.clawee-composer::before')).toContain('z-index: 0;');
    expect(lightComposer).toContain('--composer-project-background: #eeeeef;');
    expect(lightComposer).toContain('background: var(--composer-project-background);');
    expect(cssBlock(':root[data-theme="light"] .clawee-composer::after')).toContain('background: var(--surface-input);');
    expect(lightComposer).toContain('backdrop-filter: none;');
    expect(lightComposer).not.toContain('linear-gradient');
    expect(lightComposer).not.toContain('inset');
    expect(appCss).toMatch(/:root\[data-theme="light"\] \.clawee-composer \.composer-icon-button,[\s\S]*?\.composer-submit-menu-button\s*\{[^}]*box-shadow:\s*none;/);
    expect(appCss).toMatch(/\.conversation-empty-greeting h2\s*\{[^}]*font-size:\s*26px;/);
    expect(appCss).toMatch(/\.conversation-empty-greeting h2\s*\{[^}]*font-size:\s*23px;/);
    expect(appCss).toMatch(/\.conversation-empty-greeting p\s*\{[^}]*font-size:\s*26px;/);
    expect(appCss).toMatch(/\.conversation-empty-greeting p\s*\{[^}]*font-size:\s*23px;/);
  });

  it('styles the color mode selector as a compact product control', () => {
    const colorMode = cssBlock('.settings-color-mode');
    const selectedColorMode = cssBlock('.settings-color-mode button[aria-pressed="true"]');

    expect(colorMode).toContain('display: inline-flex;');
    expect(selectedColorMode).toContain('background: var(--text);');
    expect(selectedColorMode).toContain('color: var(--bg);');
    expect(selectedColorMode).toContain('box-shadow: none;');
    expect(selectedColorMode).not.toContain('var(--accent)');
  });

  it('renders accent choices as compact color swatches', () => {
    const accentColor = cssBlock('.settings-accent-color');
    const accentButton = cssBlock('.settings-accent-options > button');
    const selectedAccent = cssBlock('.settings-accent-options > button[aria-checked="true"]');
    const swatch = cssBlock('.settings-accent-swatch');

    expect(accentColor).toContain('display: flex;');
    expect(accentColor).toContain('flex-wrap: wrap;');
    expect(accentButton).toContain('width: 30px;');
    expect(selectedAccent).toContain('var(--settings-accent-swatch)');
    expect(swatch).toContain('background: var(--settings-accent-swatch);');
  });

  it('separates the custom accent label, preview swatch, and value input', () => {
    const customAccentOption = cssBlock('.settings-custom-accent-option');
    const customAccentChoice = cssBlock(
      '.settings-custom-accent-option > .settings-custom-accent-choice'
    );
    const separator = cssBlock('.settings-row .settings-accent-separator');

    expect(customAccentOption).toContain('display: inline-flex;');
    expect(customAccentChoice).toContain('width: auto;');
    expect(customAccentChoice).toContain('display: inline-flex;');
    expect(customAccentChoice).toContain('flex-direction: row;');
    expect(customAccentChoice).toContain('align-items: center;');
    expect(customAccentChoice).toContain('background: transparent;');
    expect(separator).toContain('color: var(--subtle);');
  });

  it('keeps the custom accent input compact and free of visual effects', () => {
    const customAccent = cssBlock('.settings-custom-accent');
    const customAccentInput = cssBlock('.settings-custom-accent input');

    expect(customAccent).toContain('width: 128px;');
    expect(customAccentInput).toContain('height: 30px;');
    expect(customAccentInput).toContain('background: var(--surface-2);');
    expect(customAccentInput).toContain('box-shadow: none;');
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

    expect(tokensCss).toContain('--surface-page: #0c0d0f;');
    expect(tokensCss).toContain('--surface-page: #fafafa;');
    expect(tokensCss).toContain('--conversation-bg: var(--surface-page);');
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

  it('keeps the file workspace header compact with aligned title and control rows', () => {
    const workspace = cssBlock('.file-workspace-view');
    const conversationFileLayout = cssBlock('.conversation-file-layout');
    const topBar = cssBlock('.file-top-bar');
    const titleRow = cssBlock('.file-top-bar-title-row');
    const controlRow = cssBlock('.file-top-bar-control-row');
    const topBarPathGroup = cssBlock('.file-top-bar-path-group');
    const topBarPath = cssBlock('.file-top-bar-path');
    const pathOpenButton = cssBlock('.file-top-bar-path-open-button');
    const topBarActions = cssBlock('.file-top-bar-actions');
    const hiddenEditorToolbar = cssBlock('.file-editor-pane[data-toolbar="hidden"]');

    expect(workspace).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(conversationFileLayout).toContain('420px');
    expect(conversationFileLayout).toContain('var(--conversation-pane-width, calc(60% - 6px))');
    expect(conversationFileLayout).toContain('calc(100% - 286px)');
    expect(conversationFileLayout).toContain('minmax(280px, 1fr)');
    expect(topBar).toContain('min-height: 72px;');
    expect(topBar).toContain('padding: 12px 16px 12px 18px;');
    expect(topBar).toContain('grid-template-rows: auto auto;');
    expect(titleRow).toContain('justify-content: space-between;');
    expect(controlRow).toContain('justify-content: space-between;');
    expect(topBarPath).toContain('font-size: 12px;');
    expect(topBarPath).toContain('flex: 0 1 auto;');
    expect(topBarPathGroup).toContain('flex: 1 1 auto;');
    expect(pathOpenButton).toContain('width: 28px;');
    expect(pathOpenButton).toContain('flex: 0 0 auto;');
    expect(topBarActions).toContain('flex: 0 0 auto;');
    expect(hiddenEditorToolbar).toContain('grid-template-rows: auto minmax(0, 1fr);');
  });

  it('uses solid fills for active and disabled composer send buttons', () => {
    const composerControlBlocks = Array.from(
      appCss.matchAll(/\.composer-send,\s*\.composer-stop\s*\{(?<body>[^}]*)\}/g),
      match => match.groups?.body ?? ''
    );
    const activeComposerControls = composerControlBlocks.find(block =>
      block.includes('background: var(--accent);')
    ) ?? '';
    const sendHover = cssBlock('.composer-send:not(:disabled):hover');
    const submitMenuButton = Array.from(
      appCss.matchAll(/\.composer-submit-menu-button\s*\{(?<body>[^}]*)\}/g),
      match => match.groups?.body ?? ''
    ).find(block => block.includes('background: var(--accent);')) ?? '';
    const disabledSend = cssBlock('.composer-send:disabled');
    const disabledSendIcon = cssBlock('.composer-send:disabled svg');

    expect(activeComposerControls).toContain('background: var(--accent);');
    expect(activeComposerControls).not.toContain('linear-gradient');
    expect(sendHover).toContain('color-mix(in srgb, var(--accent) 90%, var(--text))');
    expect(submitMenuButton).toContain('background: var(--accent);');
    expect(submitMenuButton).not.toContain('linear-gradient');
    expect(disabledSend).toContain('background: var(--surface-3);');
    expect(disabledSend).toContain('color: var(--control-disabled-text);');
    expect(disabledSendIcon).toContain('color: #fff;');
  });

  it('aligns Composer input, add icon, and project folder to one left baseline', () => {
    const composer = cssBlock('.clawee-composer');
    const textarea = cssBlock('.clawee-composer textarea');
    const firstLeftControl = cssBlock(
      '.composer-left-actions > .composer-control-wrap:first-child'
    );
    const projectContext = Array.from(
      appCss.matchAll(/\.composer-project-context\s*\{(?<body>[^}]*)\}/g),
      match => match.groups?.body ?? ''
    ).find(block => block.includes('min-height: 40px;')) ?? '';
    const iconButton = cssBlock('.composer-icon-button');

    expect(composer).toContain('--composer-left-baseline: 20px;');
    expect(textarea).toContain(
      'padding-left: calc(var(--composer-left-baseline) - 18px);'
    );
    expect(firstLeftControl).toContain(
      'margin-left: calc(var(--composer-left-baseline) - 29px);'
    );
    expect(projectContext).toContain(
      'padding-left: calc(var(--composer-left-baseline) - 6px);'
    );
    expect(iconButton).toContain('width: 38px;');
  });

  it('keeps enabled MCP icons compact after the permission control', () => {
    const connectorList = cssBlock('.composer-enabled-connectors');
    const connectorIcon = cssBlock('.composer-enabled-connector');

    expect(connectorList).toContain('max-width: min(180px, 32vw);');
    expect(connectorList).toContain('overflow-x: auto;');
    expect(connectorIcon).toContain('width: 22px;');
    expect(connectorIcon).toContain('height: 22px;');
    expect(connectorIcon).toContain('flex: 0 0 22px;');
    expect(connectorIcon).toContain('border: 0;');
    expect(connectorIcon).toContain('border-radius: 0;');
    expect(connectorIcon).toContain('background: transparent;');
    expect(connectorIcon).toContain('box-shadow: none;');
    expect(connectorIcon).toContain('letter-spacing: 0;');
    expect(cssBlock('.composer-enabled-connectors > span + span'))
      .toContain('margin-left: -5px;');
  });

  it('uses a compact switch list for the Composer connector shortcut', () => {
    const card = cssBlock('.composer-connector-card');
    const item = cssBlock('.composer-connector-quick-item');
    const connectorSwitch = cssBlock('.composer-connector-switch');
    const more = cssBlock('.composer-connector-more');

    expect(card).toContain('width: min(260px, calc(100vw - 24px));');
    expect(item).toContain('grid-template-columns: 22px minmax(0, 1fr) 32px;');
    expect(connectorSwitch).toContain('width: 30px;');
    expect(connectorSwitch).toContain('height: 18px;');
    expect(more).toContain('border-top: 1px solid var(--border);');
  });

  it('separates the dark Composer input, project bar, and outer border', () => {
    const composer = cssBlock('.clawee-composer');
    const composerAfter = cssBlock('.clawee-composer::after');
    const projectContext = Array.from(
      appCss.matchAll(/\.composer-project-context\s*\{(?<body>[^}]*)\}/g),
      match => match.groups?.body ?? ''
    ).find(block => block.includes('min-height: 40px;')) ?? '';

    expect(composer).toContain('--composer-input-background: #1a1b1e;');
    expect(composer).toContain('--composer-project-background: #232427;');
    expect(composer).toContain('--composer-border: rgba(245, 245, 246, 0.12);');
    expect(composer).toContain('--composer-separator: rgba(245, 245, 246, 0.06);');
    expect(composer).toContain('border: 1px solid var(--composer-border);');
    expect(composerAfter).toContain('background: var(--composer-input-background);');
    expect(projectContext).toContain('background: var(--composer-project-background);');
    expect(projectContext).toContain('border-top: 1px solid var(--composer-separator);');
  });

  it('positions the Composer capability submenu beside the add menu', () => {
    const composerWrap = cssBlock('.composer-wrap');
    const submenu = cssBlock('.composer-add-submenu');
    const openToolbar = cssBlock('.composer-toolbar:has([aria-expanded="true"])');
    const commandList = cssBlock('.composer-add-command-list');
    const search = cssBlock('.composer-add-search');

    expect(composerWrap).toContain('z-index: 4;');
    expect(submenu).toContain('left: calc(100% + 8px);');
    expect(submenu).toContain('width: min(320px, calc(100vw - 24px));');
    expect(submenu).toContain('max-height: min(440px, 70dvh);');
    expect(submenu).toContain('z-index: 40;');
    expect(openToolbar).toContain('z-index: 41;');
    expect(commandList).toContain('overflow-y: auto;');
    expect(search).toContain('display: grid;');
  });

  it('keeps add-menu submenu arrows in the third grid column', () => {
    const trigger = cssBlock('.composer-menu-item.composer-add-menu-trigger');

    expect(trigger).toContain('grid-template-columns: 20px minmax(0, 1fr) 14px;');
  });

  it('keeps the Composer capability submenu inside the mobile viewport', () => {
    const mobileRule = appCss.match(
      /@media \(max-width: 620px\) \{\s*\.composer-add-submenu\s*\{(?<body>[^}]*)\}/
    );
    const submenu = mobileRule?.groups?.body ?? '';

    expect(submenu).toContain('position: fixed;');
    expect(submenu).toContain('top: 12px;');
    expect(submenu).toContain('right: 12px;');
    expect(submenu).toContain('bottom: 12px;');
    expect(submenu).toContain('left: 12px;');
    expect(submenu).toContain('max-height: none;');
  });

  it('keeps composer image attachments as compact square previews', () => {
    const tray = cssBlock('.composer-attachment-tray');
    const attachment = cssBlock('.composer-attachment');
    const trigger = cssBlock(
      '.clawee-composer button.composer-attachment-preview-trigger:not(:disabled)'
    );
    const thumbnail = cssBlock('.composer-attachment-preview-trigger img');
    const preview = cssBlock('.attachment-image-preview');
    const previewImage = cssBlock('.attachment-image-preview > img');

    expect(tray).toContain('display: flex;');
    expect(tray).toContain('flex-wrap: wrap;');
    expect(attachment).toContain('width: 72px;');
    expect(attachment).toContain('flex: 0 0 72px;');
    expect(attachment).toContain('aspect-ratio: 1;');
    expect(trigger).toContain('position: absolute;');
    expect(trigger).toContain('inset: 0;');
    expect(thumbnail).toContain('object-fit: cover;');
    expect(preview).toContain('width: min(960px, 80vw);');
    expect(preview).toContain('height: min(720px, 80dvh);');
    expect(preview).toContain('overflow: hidden;');
    expect(previewImage).toContain('position: absolute;');
    expect(previewImage).toContain('inset: 0;');
    expect(previewImage).toContain('width: 100%;');
    expect(previewImage).toContain('height: 100%;');
    expect(previewImage).toContain('min-height: 0;');
    expect(previewImage).toContain('max-height: 100%;');
    expect(previewImage).toContain('object-fit: contain;');
    expect(previewImage).toContain('background: transparent;');
  });

  it('keeps user messages as bubbles and assistant replies as unframed prose', () => {
    const userBubble = cssBlock('.timeline-user_message .timeline-bubble');
    const lightUserBubble = cssBlock(':root[data-theme="light"] .timeline-user_message .timeline-bubble');
    const assistantBubble = cssBlock('.timeline-assistant_message .timeline-bubble');
    const virtualItem = cssBlock('.timeline-virtual-item');
    const timelineItem = cssBlock('.timeline-item');
    const messageMeta = cssBlock('.timeline-message-meta');
    const assistantMessageMeta = cssBlock('.timeline-assistant_message .timeline-message-meta');
    const assistantProse = cssBlock('.markdown-prose[data-variant="assistant"]');

    expect(virtualItem).toContain('padding: 8px var(--conversation-gutter);');
    expect(timelineItem).toContain('gap: 6px;');
    expect(userBubble).toContain('padding: 10px 14px;');
    expect(userBubble).toContain('border: 0;');
    expect(userBubble).toContain('border-top-right-radius: 0;');
    expect(userBubble).not.toContain('border-bottom-right-radius: 6px;');
    expect(lightUserBubble).toContain('background: #f2f2f2;');
    expect(assistantBubble).toContain('border: 0;');
    expect(assistantBubble).toContain('border-radius: 0;');
    expect(assistantBubble).toContain('background: transparent;');
    expect(assistantProse).toContain('font-size: 14px;');
    expect(assistantProse).toContain('line-height: 1.68;');
    expect(messageMeta).toContain('min-height: 24px;');
    expect(messageMeta).toContain('padding: 0 4px;');
    expect(messageMeta).toContain('opacity: 0;');
    expect(messageMeta).toContain('pointer-events: none;');
    expect(assistantMessageMeta).toContain('justify-content: flex-start;');
    expect(assistantMessageMeta).toContain('padding-left: 0;');
    expect(appCss).toContain('.timeline-user_message:hover .timeline-message-meta');
    expect(appCss).toContain('.timeline-assistant_message:hover .timeline-message-meta');
    expect(appCss).toContain('.timeline-message-meta.is-latest-assistant');
    expect(appCss).toMatch(
      /\.timeline-message-meta\.is-latest-assistant time\s*\{[^}]*opacity:\s*0;/
    );
    expect(appCss).toContain('@media (hover: none)');
  });

  it('keeps the conversation header compact and leaves connection state to the connection panel', () => {
    const conversationHeader = cssBlock('.conversation-header');
    const conversationTitle = cssBlock('.conversation-title h1');
    const connected = cssBlock('.connection-status-dot.connected');
    const disconnected = cssBlock(
      '.connection-status-dot.disconnected,\n.connection-status-dot.invalid_token'
    );

    expect(conversationHeader).not.toContain('border-bottom:');
    expect(conversationTitle).toContain('font-size: 14px;');
    expect(conversationTitle).toContain('font-weight: 500;');
    expect(appCss).not.toContain('.connection-indicator');
    expect(tokensCss).toContain('--status-connected: #34d399;');
    expect(tokensCss).toContain('--status-connected: #16a34a;');
    expect(tokensCss).toContain('--status-disconnected: #f87171;');
    expect(tokensCss).toContain('--status-disconnected: #dc2626;');
    expect(connected).toContain('background: var(--status-connected);');
    expect(disconnected).toContain('background: var(--status-disconnected);');
    expect(appCss).not.toContain('.connection-pill');
  });

  it('uses a very subtle divider between process groups', () => {
    const processDetails = cssBlock('.timeline-process details');

    expect(processDetails).toContain(
      'border-bottom: 1px solid color-mix(in srgb, var(--text) 5%, transparent);'
    );
    expect(processDetails).not.toContain('border-bottom: 1px solid var(--border);');
  });

  it('renders approvals as compact neutral floating confirmations', () => {
    const approvalBubble = cssBlock('.timeline-approval .timeline-bubble');
    const approvalPanel = cssBlock('.approval-panel');
    const approvalTitle = cssBlock('.approval-copy strong');
    const approvalApprove = cssBlock('.approval-approve');

    expect(approvalBubble).toContain('border: 1px solid var(--border-hairline);');
    expect(approvalBubble).toContain('background: var(--surface-popover);');
    expect(approvalPanel).toContain('padding: 14px 16px;');
    expect(approvalTitle).toContain('font-size: 14px;');
    expect(approvalTitle).toContain('font-weight: 500;');
    expect(approvalApprove).toContain('background: var(--text);');
    expect(approvalApprove).toContain('color: var(--bg);');
    expect(appCss).not.toContain('color-mix(in srgb, #f59e0b 8%, var(--surface-2))');
  });

  it('shows the assistant avatar as the logo without a container background', () => {
    const assistantAvatar = cssBlock('.timeline-assistant_message .timeline-avatar');
    const assistantHeader = cssBlock('.timeline-assistant_message .timeline-item-header');
    const assistantKind = cssBlock('.timeline-assistant_message .timeline-kind');
    const assistantLogo = cssBlock('.timeline-avatar-logo');
    const lightAssistantLogo = cssBlock(':root[data-theme="light"] .timeline-avatar-logo');

    expect(assistantAvatar).toContain('border-color: transparent;');
    expect(assistantAvatar).toContain('background: transparent;');
    expect(assistantAvatar).toContain('box-shadow: none;');
    expect(assistantAvatar).toContain('width: 18px;');
    expect(assistantAvatar).toContain('height: 18px;');
    expect(assistantAvatar).not.toMatch(/linear-gradient|var\(--accent/i);
    expect(assistantHeader).toContain('gap: 4px;');
    expect(assistantKind).toContain('font-size: 13px;');
    expect(assistantKind).toContain('font-weight: 600;');
    expect(assistantLogo).toContain("url('/logo-v2-white-logo.svg')");
    expect(cssBlock('.timeline-assistant_message .timeline-avatar-logo')).toContain('width: 16px;');
    expect(cssBlock('.timeline-assistant_message .timeline-avatar-logo')).toContain('height: 16px;');
    expect(cssBlock('.timeline-assistant_message .timeline-avatar-logo')).toContain('background-size: 30px 30px;');
    expect(assistantLogo).toContain('width: 24px;');
    expect(assistantLogo).toContain('height: 24px;');
    expect(assistantLogo).toContain('background-position: calc(50% - 1px) center;');
    expect(assistantLogo).toContain('background-size: 46px 46px;');
    expect(lightAssistantLogo).toContain("url('/logo-v2-black-logo.svg')");
    expect(appCss).not.toContain('/logo-cor.png');
  });

  it('reserves shadows for menus and floating overlays', () => {
    expect(appCss).toMatch(
      /\*,\s*\*::before,\s*\*::after\s*\{[^}]*box-shadow:\s*none !important;[^}]*text-shadow:\s*none !important;[^}]*backdrop-filter:\s*none !important;[^}]*-webkit-backdrop-filter:\s*none !important;[^}]*filter:\s*none !important;/
    );
    expect(appCss).toMatch(
      /html\.is-window-resizing \*,\s*html\.is-window-resizing \*::before,\s*html\.is-window-resizing \*::after\s*\{[^}]*transition:\s*none !important;[^}]*animation-play-state:\s*paused !important;/
    );
    expect(tokensCss).toContain('--shadow-popover:');
    expect(tokensCss).toContain('--shadow-dialog:');
    expect(appCss).toMatch(/\.clawee-composer\s*\{[^}]*box-shadow:\s*none !important;/);
    expect(appCss).not.toMatch(/\.clawee-composer::before\s*\{[^}]*box-shadow:[^}]*!important;/);
    expect(appCss).toMatch(/\.composer-popover,[\s\S]*?\.timeline-approval \.timeline-bubble\s*\{[^}]*box-shadow:\s*var\(--shadow-popover\) !important;/);
    expect(appCss).toMatch(/\.project-drop-overlay,[\s\S]*?\.file-workspace-toast\s*\{[^}]*box-shadow:\s*var\(--shadow-dialog\) !important;/);
    expect(appCss).not.toMatch(/\.composer-project-context\s*\{[^}]*box-shadow:[^}]*!important;/);
    expect(cssBlock(':root[data-theme="light"] .composer-project-context')).toContain('background: var(--composer-project-background);');
  });
});
