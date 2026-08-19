import { expect, test } from './fixtures/runtime.js';

test('引用占位符不显示，空白 HTML 会按实际渲染结果恢复正文', async ({
  page,
  runtime
}) => {
  const fileName = '隐藏正文回归-2026-07-28.html';
  runtime.configureInvocations([{
    message: `页面已生成：[打开预览](${fileName}) \uE200cite\uE202turn3search0\uE202turn3search1\uE201`,
    files: {
      [fileName]: `<!doctype html>
        <html lang="zh-CN">
          <head>
            <meta charset="utf-8">
            <style>
              html, body { min-height: 100%; margin: 0; }
              .report {
                display: none;
                visibility: hidden;
                opacity: 0;
                max-height: 0;
                overflow: hidden;
                color: transparent;
                transform: translateX(-200vw) scale(0);
              }
            </style>
          </head>
          <body>
            <main class="report">
              <h1>恢复后的天气报告</h1>
              <p>预览已经渲染出可见正文。</p>
            </main>
          </body>
        </html>`
    }
  }]);

  await runtime.openApp(page);
  await page.getByRole('textbox', { name: '输入任务' }).fill('生成天气 HTML');
  await page.getByRole('button', { name: '发送' }).click();

  await expect(page.getByText('页面已生成：')).toBeVisible();
  await expect(page.getByText(/turn3search0/)).toHaveCount(0);
  await expect(page.getByText(/\uE200|\uE201|\uE202/)).toHaveCount(0);

  await page.getByRole('link', { name: '打开预览' }).click();
  const preview = page.getByTitle(`${fileName} HTML 预览`);
  const frame = preview.contentFrame();

  await expect(preview).toBeVisible();
  await expect(frame.getByRole('heading', { name: '恢复后的天气报告' }))
    .toBeVisible({ timeout: 5_000 });
  await expect(frame.getByText('预览已经渲染出可见正文。')).toBeVisible();
  await expect.poll(
    () => frame.locator('html').getAttribute('data-opencreator-preview-state')
  ).toBe('recovered');

  const headingBox = await frame.getByRole('heading', { name: '恢复后的天气报告' })
    .boundingBox();
  expect(headingBox?.width ?? 0).toBeGreaterThan(20);
  expect(headingBox?.height ?? 0).toBeGreaterThan(10);
});

test('正常天气页面保持原始布局，不触发空白恢复', async ({ page, runtime }) => {
  const fileName = '正常天气页回归-2026-07-28.html';
  runtime.configureInvocations([{
    message: `天气页已生成：[打开天气页](${fileName})`,
    files: {
      [fileName]: `<!doctype html>
        <html lang="zh-CN">
          <head>
            <meta charset="utf-8">
            <style>
              body {
                margin: 0;
                min-height: 100vh;
                color: #fff;
                background: #10202b;
                font-family: system-ui, sans-serif;
              }
              main {
                width: min(720px, calc(100% - 48px));
                margin: 0 auto;
                padding: 48px 0;
                transform: rotate(0.25deg);
              }
            </style>
          </head>
          <body>
            <main>
              <h1>武汉今日天气</h1>
              <p>当前 30°C，今晚有雨，出门请带伞。</p>
            </main>
          </body>
        </html>`
    }
  }]);

  await runtime.openApp(page);
  await page.getByRole('textbox', { name: '输入任务' }).fill('生成正常天气页');
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByRole('link', { name: '打开天气页' }).click();

  const preview = page.getByTitle(`${fileName} HTML 预览`);
  const frame = preview.contentFrame();
  const heading = frame.getByRole('heading', { name: '武汉今日天气' });

  await expect(heading).toBeVisible();
  await expect.poll(
    () => frame.locator('html').getAttribute('data-opencreator-preview-state')
  ).toBe('ready');
  expect(await frame.locator('main').evaluate(element => getComputedStyle(element).transform))
    .not.toBe('none');
  await expect(frame.locator('[data-opencreator-preview-force-visible]')).toHaveCount(0);
});

test('拖动会话和 HTML 预览分隔条进入 iframe 后可以正常松开', async ({
  page,
  runtime
}, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', '桌面布局才显示左右分隔条');

  const fileName = 'HTML分隔条拖拽回归-2026-07-29.html';
  runtime.configureInvocations([{
    message: `页面已生成：[打开预览](${fileName})`,
    files: {
      [fileName]: `<!doctype html>
        <html lang="zh-CN">
          <head><meta charset="utf-8"></head>
          <body><main><h1>HTML 拖拽回归页面</h1></main></body>
        </html>`
    }
  }]);

  await runtime.openApp(page);
  await page.getByRole('textbox', { name: '输入任务' }).fill('生成 HTML 拖拽回归页面');
  await page.getByRole('button', { name: '发送' }).click();
  await page.getByRole('link', { name: '打开预览' }).click();

  const separator = page.getByRole('separator', { name: '调整会话和文件区域宽度' });
  const preview = page.getByTitle(`${fileName} HTML 预览`);
  await expect(preview.contentFrame().getByRole('heading', { name: 'HTML 拖拽回归页面' }))
    .toBeVisible();

  const separatorBox = await separator.boundingBox();
  const previewBox = await preview.boundingBox();
  if (separatorBox === null || previewBox === null) throw new Error('无法读取拖拽区域尺寸');

  const y = separatorBox.y + Math.min(separatorBox.height / 2, 120);
  const targetX = Math.min(previewBox.x + 160, previewBox.x + previewBox.width / 2);
  await page.mouse.move(separatorBox.x + separatorBox.width / 2, y);
  await page.mouse.down();
  await expect(page.locator('.pane-resize-shield')).toBeVisible();
  await page.mouse.move(targetX, y, { steps: 8 });
  await page.mouse.up();

  await expect(page.locator('.pane-resize-shield')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveClass(/is-pane-resizing/);

  const releasedBox = await separator.boundingBox();
  if (releasedBox === null) throw new Error('无法读取松开后的分隔条尺寸');
  await page.mouse.move(Math.max(20, releasedBox.x - 180), y, { steps: 5 });
  const afterFreeMoveBox = await separator.boundingBox();

  expect(Math.abs((afterFreeMoveBox?.x ?? 0) - releasedBox.x)).toBeLessThan(2);
});
