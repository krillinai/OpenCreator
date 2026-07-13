import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appCss = readFileSync('src/styles/app.css', 'utf8');
const appControllerTsx = readFileSync('src/app/AppController.tsx', 'utf8');
const skillMarketCss = readFileSync('src/features/plugins/skill-market.css', 'utf8');
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

describe('app CSS visual contracts', () => {
  it('uses the warm brand color as the accent token', () => {
    expect(tokensCss).toContain('--accent: #AD4D1F;');
    expect(tokensCss).not.toMatch(/#7c47e8|#a47cff|124,\s*71,\s*232|164,\s*124,\s*255/i);
    expect(appCss).not.toMatch(/#7c47e8|#a47cff|#b08cff|#8755ee|#a77dff|#7b43e6|#5d2bbf/i);
    expect(appCss).not.toMatch(/124,\s*71,\s*232|164,\s*124,\s*255|167,\s*125,\s*255|123,\s*67,\s*230|93,\s*43,\s*191/i);
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
    expect(selectedConversationRow).toContain('background: rgba(173, 77, 31, 0.14);');
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

  it('keeps global scrollbars darker and trackless', () => {
    const webkitScrollbar = cssBlock('*::-webkit-scrollbar');
    const webkitScrollbarTrack = cssBlock('*::-webkit-scrollbar-track,\n*::-webkit-scrollbar-track-piece,\n*::-webkit-scrollbar-corner');
    const webkitScrollbarThumb = cssBlock('*::-webkit-scrollbar-thumb');
    const webkitScrollbarThumbHover = cssBlock('*::-webkit-scrollbar-thumb:hover');

    expect(appCss).toContain('scrollbar-color: rgba(145, 153, 168, 0.3) transparent;');
    expect(webkitScrollbar).toContain('width: 6px;');
    expect(webkitScrollbar).toContain('background: transparent;');
    expect(webkitScrollbarTrack).toContain('background: transparent;');
    expect(webkitScrollbarThumb).toContain('background-color: rgba(145, 153, 168, 0.28);');
    expect(webkitScrollbarThumbHover).toContain('background-color: rgba(161, 170, 186, 0.38);');
  });

  it('keeps the app shell dark during layout changes', () => {
    const mainPane = cssBlock('.clawee-main-pane');

    expect(appCss).toMatch(/html,\nbody,\n#root\s*\{[^}]*background:\s*var\(--bg\);/);
    expect(mainPane).toContain('background: var(--conversation-bg);');
    expect(mainPane).toContain('overflow: hidden;');
  });

  it('keeps the desktop shell inside short viewports', () => {
    const shell = cssBlock('.clawee-shell');

    expect(shell).toContain('height: 100vh;');
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

  it('uses a compact toolbar and two flat visible filter rows', () => {
    const toolbar = skillMarketCssBlock('.skill-market__toolbar');
    const filterRow = skillMarketCssBlock('.skill-market-filter-row');
    const statusControls = skillMarketCssBlock('.skill-market-status-controls');
    const searchFocus = skillMarketCssBlock('.skill-market-search input:focus-visible');

    expect(toolbar).toContain('display: flex;');
    expect(toolbar).toContain('flex-wrap: wrap;');
    expect(filterRow).toContain('display: flex;');
    expect(filterRow).toContain('flex-wrap: wrap;');
    expect(statusControls).toContain('padding: 3px;');
    expect(searchFocus).toContain('outline: none;');
    expect(skillMarketCss).not.toContain('.skill-market-sort');
    expect(skillMarketCss).not.toContain('.skill-market-filter-selects');
    expect(skillMarketCss).not.toContain('.skill-market-filter-shell');
    expect(skillMarketCss).not.toContain('.skill-market-chip-row');
  });

  it('centers the collapsed sidebar logo inside its square button', () => {
    const brandButton = cssBlock('.sidebar-brand-button');

    expect(brandButton).toContain('padding: 0;');
  });

  it('uses a complete 2:1 cover and one compact metadata flow for skill cards', () => {
    const cardOpen = skillMarketCssBlock('.skill-market-card__open');
    const cover = skillMarketCssBlock('.skill-market-card__cover');
    const image = skillMarketCssBlock('.skill-market-cover__image');
    const body = skillMarketCssBlock('.skill-market-card__body');
    const tags = skillMarketCssBlock('.skill-market-card__tags');
    const tagline = skillMarketCssBlock('.skill-market-card__tagline');

    expect(cardOpen).toContain('grid-template-rows: auto minmax(0, 1fr);');
    expect(cover).toContain('aspect-ratio: 2 / 1;');
    expect(image).toContain('object-fit: contain;');
    expect(body).toContain('gap: 9px;');
    expect(tags).toContain('flex-wrap: wrap;');
    expect(tagline).toContain('-webkit-line-clamp: 2;');
    expect(skillMarketCss).not.toContain('.skill-market-card__cover-top');
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

  it('uses a hierarchy-led skill detail layout without equal nested panels', () => {
    const modal = skillMarketCssBlock('.skill-market-modal');
    const body = skillMarketCssBlock('.skill-market-modal__body');
    const head = skillMarketCssBlock('.skill-market-detail-head');
    const layout = skillMarketCssBlock('.skill-market-detail-layout');
    const block = skillMarketCssBlock('.skill-market-detail-block');

    expect(modal).toContain('width: min(1040px, 100%);');
    expect(body).toContain('padding: 24px 28px 28px;');
    expect(head).toContain('grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);');
    expect(layout).toContain('grid-template-columns: minmax(0, 1.7fr) minmax(260px, 0.8fr);');
    expect(block).toContain('border-top: 1px solid var(--border);');
    expect(skillMarketCss).not.toContain('.skill-market-detail-grid');
    expect(skillMarketCss).not.toContain('.skill-market-modal__bar');
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
    expect(composerTextarea).toContain('min-height: 28px;');
    expect(composerTextarea).toContain('max-height: 76px;');
    expect(composerTextarea).toContain('font-size: 16px;');
    expect(composerTextarea).toContain('resize: none;');
    expect(composerTextarea).not.toContain('resize: vertical;');
    expect(appCss).toMatch(/\.composer-select,\n\.composer-model-button\s*\{[^}]*padding:\s*0 2px;[^}]*border:\s*0;[^}]*background:\s*transparent;[^}]*box-shadow:\s*none;/);
    expect(appCss).toMatch(/\.composer-send\s*\{[^}]*width:\s*38px;[^}]*height:\s*38px;/);
  });

  it('keeps the empty-state title centered without the large decorative logo', () => {
    const title = cssBlock('.conversation-empty-state h2');

    expect(appCss).not.toContain('.conversation-empty-logo-bg');
    expect(title).toContain('font-size: 48px;');
    expect(appCss).toMatch(/\.conversation-empty-state h2\s*\{[^}]*font-size:\s*38px;/);
    expect(appCss).toMatch(/\.conversation-empty-state h2\s*\{[^}]*font-size:\s*30px;/);
  });

  it('styles the settings dynamic background switch as a compact product control', () => {
    const toggle = cssBlock('.settings-switch');
    const toggleChecked = cssBlock('.settings-switch[aria-checked="true"]');
    const staticConversation = cssBlock('.conversation-page[data-dynamic-background="off"]');

    expect(toggle).toContain('width: 42px;');
    expect(toggle).toContain('border-radius: 999px;');
    expect(toggleChecked).toContain('background: rgba(173, 77, 31, 0.86);');
    expect(staticConversation).toContain('background: var(--conversation-bg);');
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

  it('keeps the empty-state dynamic background stable during resize', () => {
    const conversationPage = cssBlock('.conversation-page');
    const lightfallBg = cssBlock('.conversation-lightfall-bg');
    const lightfallOverlay = cssBlock('.conversation-lightfall-bg::after');

    expect(tokensCss).toContain('--conversation-bg: #090d12;');
    expect(conversationPage).toContain('background: var(--conversation-bg);');
    expect(lightfallBg).toContain('background:');
    expect(lightfallBg).toContain('var(--conversation-bg)');
    expect(lightfallBg).toContain('rgba(173, 77, 31, 0.16)');
    expect(lightfallBg).toContain('opacity: 1;');
    expect(lightfallOverlay).toContain('z-index: 0;');
    expect(lightfallOverlay).toContain('rgba(173, 77, 31, 0.16)');
    expect(lightfallOverlay).toContain('rgba(5, 8, 12, 0.52)');
    expect(appCss).toMatch(/\.conversation-lightfall-bg \.lightfall-container\s*\{[^}]*z-index:\s*1;/);
    expect(appControllerTsx).toContain('streakCount={3}');
    expect(appControllerTsx).toContain('streakWidth={0.32}');
    expect(appControllerTsx).toContain('glow={0.48}');
    expect(appControllerTsx).toContain('density={0.12}');
    expect(appControllerTsx).toContain('backgroundGlow={0.34}');
    expect(appControllerTsx).toContain('opacity={0.72}');
  });

  it('keeps the conversation history loading state on the dark surface', () => {
    const conversationBody = cssBlock('.conversation-body');
    const dynamicConversationBody = cssBlock('.conversation-page[data-background-mode="dynamic"] .conversation-body');
    const solidConversationBody = cssBlock('.conversation-page[data-background-mode="solid"] .conversation-body');
    const timelineList = cssBlock('.timeline-list');
    const historyLoading = cssBlock('.conversation-history-loading');

    expect(conversationBody).toContain('background: var(--conversation-bg);');
    expect(dynamicConversationBody).toContain('background: transparent;');
    expect(solidConversationBody).toContain('background: var(--conversation-bg);');
    expect(timelineList).toContain('background: var(--conversation-bg);');
    expect(historyLoading).toContain('position: absolute;');
    expect(historyLoading).toContain('inset: 0;');
    expect(historyLoading).toContain('background: rgba(9, 13, 18, 0.72);');
    expect(historyLoading).toContain('backdrop-filter: blur(10px);');
    expect(historyLoading).toContain('color: var(--muted);');
    expect(appControllerTsx).toContain('data-background-mode={showConversationLightfall ? \'dynamic\' : \'solid\'}');
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

    expect(disabledSend).toContain('background: linear-gradient(180deg, rgba(64, 70, 80, 0.68), rgba(32, 36, 43, 0.72));');
    expect(disabledSend).toContain('color: rgba(252, 253, 255, 0.48);');
    expect(disabledSend).not.toMatch(/#AD4D1F|#DF7440|173,\s*77,\s*31|216,\s*101,\s*50/i);
    expect(disabledSendIcon).toContain('color: rgba(252, 253, 255, 0.48);');
  });

  it('uses chat bubble corners to identify speaker direction', () => {
    const userBubble = cssBlock('.timeline-user_message .timeline-bubble');
    const assistantBubble = cssBlock('.timeline-assistant_message .timeline-bubble');

    expect(userBubble).toContain('border-top-right-radius: 0;');
    expect(userBubble).not.toContain('border-bottom-right-radius: 6px;');
    expect(assistantBubble).toContain('border-top-left-radius: 0;');
  });

  it('shows the assistant avatar as the logo without a container background', () => {
    const assistantAvatar = cssBlock('.timeline-assistant_message .timeline-avatar');

    expect(assistantAvatar).toContain('border-color: transparent;');
    expect(assistantAvatar).toContain('background: transparent;');
    expect(assistantAvatar).toContain('box-shadow: none;');
    expect(assistantAvatar).not.toMatch(/linear-gradient|var\(--accent/i);
  });
});
