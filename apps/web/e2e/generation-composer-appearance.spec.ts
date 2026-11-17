import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const styles = [
  'apps/web/src/styles/tokens.css',
  'apps/web/src/styles/app.css',
  'apps/web/src/features/dashboard/dashboard.css',
  'apps/web/src/features/dashboard/DashboardGenerationComposer.css',
  'apps/web/src/features/dashboard/DashboardGenerationSession.css'
].map(path => readFileSync(path, 'utf8').replace(/^@import[^;]+;/gm, '')).join('\n');

const composer = `<div class="dashboard-generation"><div class="creator-tool-embedded">
  <form class="image-generation-composer"><fieldset class="image-generation-fields" disabled>
    <div class="image-generation-submit-row"><button class="creator-tool-primary" disabled>Generating</button></div>
  </fieldset></form>
</div></div>`;

test.beforeEach(async ({ page }) => {
  await page.setContent(`<style>${styles}</style>
    <main id="dashboard">${composer}</main>
    <div class="dashboard-generation-session" style="height: 800px">
      <div class="dashboard-generation-session-composer is-expanded">
        <div class="dashboard-generation-session-composer-inner">${composer}</div>
      </div>
    </div>`);
});

test('busy image generation action stays readable with custom accents', async ({ page }) => {
  for (const theme of ['dark', 'light']) {
    await page.evaluate(theme => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.dataset.accent = 'custom';
      document.documentElement.style.setProperty('--custom-accent-value', theme === 'dark' ? '#eeeeee' : '#111111');
      document.documentElement.style.setProperty('--custom-on-accent', theme === 'dark' ? '#111111' : '#eeeeee');
    }, theme);

    const appearance = await page.locator('.dashboard-generation-session-composer button.creator-tool-primary').evaluate(button => {
      const style = getComputedStyle(button);
      return { opacity: Number(style.opacity), color: style.color, background: style.backgroundColor, image: style.backgroundImage };
    });
    expect(appearance.opacity).toBe(1);
    expect(appearance.image).toBe('none');
    expect(contrastRatio(appearance.color, appearance.background)).toBeGreaterThanOrEqual(4.5);
  }
});

test('expanded history composer matches the Dashboard form height', async ({ page }) => {
  const dashboard = await page.locator('#dashboard .image-generation-composer').boundingBox();
  const history = await page.locator('.dashboard-generation-session-composer .image-generation-composer').boundingBox();
  expect(dashboard).not.toBeNull();
  expect(history).not.toBeNull();
  expect(history!.height).toBe(dashboard!.height);
});

function contrastRatio(foreground: string, background: string): number {
  const luminance = (rgb: string) => {
    const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number) ?? [];
    const linear = channels.map(channel => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}
