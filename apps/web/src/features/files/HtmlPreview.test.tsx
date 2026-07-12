import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HtmlPreview, resolveWorkspacePreviewPath } from './HtmlPreview.js';

describe('HtmlPreview', () => {
  it('removes executable and navigational content and uses a permissionless sandbox', async () => {
    render(
      <HtmlPreview
        name="unsafe.html"
        path="unsafe.html"
        content={`
          <html>
            <head><meta http-equiv="refresh" content="0;url=https://example.com"></head>
            <body onload="window.top.location='https://example.com'">
              <script>window.top.location = 'https://example.com'</script>
              <iframe src="https://example.com"></iframe>
              <form action="https://example.com"><button>提交</button></form>
              <a href="javascript:alert(1)">危险链接</a>
            </body>
          </html>
        `}
      />
    );

    const frame = await screen.findByTitle('unsafe.html HTML 预览');
    const srcDoc = frame.getAttribute('srcdoc') ?? '';
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(srcDoc).toContain("default-src 'none'");
    expect(srcDoc).not.toContain('<script');
    expect(srcDoc).not.toContain('<iframe');
    expect(srcDoc).not.toContain('<form');
    expect(srcDoc).not.toContain('http-equiv="refresh"');
    expect(srcDoc).not.toContain('onload=');
    expect(srcDoc).not.toContain('javascript:');
  });

  it('loads relative images and stylesheets through controlled workspace resources', async () => {
    const openBlob = vi.fn(async (path: string) => ({
      objectUrl: `blob:${path}`,
      mime: 'image/png',
      size: 4
    }));
    const openText = vi.fn(async (path: string) => ({
      content: path === 'pages/styles/site.css'
        ? '.cover { background-image: url("../images/bg.png"); }'
        : '',
      mime: 'text/css'
    }));
    const revokeBlob = vi.fn();
    const { unmount } = render(
      <HtmlPreview
        name="index.html"
        path="pages/index.html"
        content={`
          <link rel="stylesheet" href="./styles/site.css">
          <main class="cover"><img src="./images/cover.png"></main>
        `}
        resources={{ openBlob, openText, revokeBlob }}
      />
    );

    const frame = await screen.findByTitle('index.html HTML 预览');
    await waitFor(() => {
      expect(frame.getAttribute('srcdoc')).toContain('blob:pages/images/cover.png');
      expect(frame.getAttribute('srcdoc')).toContain('blob:pages/images/bg.png');
    });
    expect(openText).toHaveBeenCalledWith('pages/styles/site.css');
    expect(openBlob).toHaveBeenCalledWith('pages/images/cover.png');
    expect(openBlob).toHaveBeenCalledWith('pages/images/bg.png');

    unmount();
    expect(revokeBlob).toHaveBeenCalledWith('blob:pages/images/cover.png');
    expect(revokeBlob).toHaveBeenCalledWith('blob:pages/images/bg.png');
  });

  it('blocks workspace traversal and external subresources', async () => {
    const openBlob = vi.fn();
    render(
      <HtmlPreview
        name="index.html"
        path="pages/index.html"
        content={`
          <img src="../../secret.png">
          <img src="https://example.com/tracker.png">
        `}
        resources={{
          openBlob,
          openText: vi.fn(),
          revokeBlob: vi.fn()
        }}
      />
    );

    const frame = await screen.findByTitle('index.html HTML 预览');
    await waitFor(() => expect(frame.getAttribute('srcdoc')).not.toContain('正在准备安全预览'));
    expect(openBlob).not.toHaveBeenCalled();
    expect(frame.getAttribute('srcdoc')).not.toContain('secret.png');
    expect(frame.getAttribute('srcdoc')).not.toContain('tracker.png');
  });

  it('intercepts external links and opens them only through an explicit action', async () => {
    const user = userEvent.setup();
    const onOpenExternal = vi.fn();
    render(
      <HtmlPreview
        name="links.html"
        path="links.html"
        content='<a href="https://example.com/docs">产品文档</a>'
        onOpenExternal={onOpenExternal}
      />
    );

    const frame = await screen.findByTitle('links.html HTML 预览');
    expect(frame.getAttribute('srcdoc')).not.toContain('href="https://example.com/docs"');
    await user.click(await screen.findByRole('button', { name: '外部打开 产品文档' }));
    expect(onOpenExternal).toHaveBeenCalledWith('https://example.com/docs');
  });

  it('resolves only paths that stay inside the workspace root', () => {
    expect(resolveWorkspacePreviewPath('pages/index.html', './images/cover.png'))
      .toBe('pages/images/cover.png');
    expect(resolveWorkspacePreviewPath('pages/index.html', '../cover.png')).toBe('cover.png');
    expect(resolveWorkspacePreviewPath('pages/index.html', '../../secret.png')).toBeUndefined();
    expect(resolveWorkspacePreviewPath('pages/index.html', 'https://example.com/a.png')).toBeUndefined();
    expect(resolveWorkspacePreviewPath('pages/index.html', '//example.com/a.png')).toBeUndefined();
  });

  it('caps controlled resource loading for oversized documents', async () => {
    const openBlob = vi.fn(async (path: string) => ({
      objectUrl: `blob:${path}`,
      mime: 'image/png',
      size: 1
    }));
    render(
      <HtmlPreview
        name="many.html"
        path="many.html"
        content={Array.from({ length: 160 }, (_, index) =>
          `<img src="./images/${index}.png">`
        ).join('')}
        resources={{
          openBlob,
          openText: vi.fn(),
          revokeBlob: vi.fn()
        }}
      />
    );

    await screen.findByTitle('many.html HTML 预览');
    await waitFor(() => expect(openBlob).toHaveBeenCalledTimes(128));
  });
});
