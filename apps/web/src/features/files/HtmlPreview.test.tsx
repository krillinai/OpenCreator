import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HtmlPreview, resolveWorkspacePreviewPath } from './HtmlPreview.js';

describe('HtmlPreview', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('removes user scripts and navigational content while allowing only the preview runtime', async () => {
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
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(srcDoc).toContain("default-src 'none'");
    expect(srcDoc).toContain('script-src http://localhost:3000');
    expect(srcDoc).toContain('data-opencreator-preview-runtime="true"');
    expect(srcDoc).toContain('html-preview-runtime-2026-07-28.js');
    expect(srcDoc).not.toContain('window.top.location');
    expect(srcDoc).not.toContain('<iframe');
    expect(srcDoc).not.toContain('<form');
    expect(srcDoc).not.toContain('http-equiv="refresh"');
    expect(srcDoc).not.toContain('onload=');
    expect(srcDoc).not.toContain('javascript:');
  });

  it('installs a rendered-content health check instead of enumerating hidden class names', async () => {
    render(
      <HtmlPreview
        name="report.html"
        path="report.html"
        content={`
          <style>
            body { opacity: 0; }
            .report { display: none; scale: 0; translate: -200vw 0; }
          </style>
          <main class="report opacity-0" style="opacity: 0">审计报告正文</main>
        `}
      />
    );

    const frame = await screen.findByTitle('report.html HTML 预览');
    const srcDoc = frame.getAttribute('srcdoc') ?? '';
    const sourceStyleIndex = srcDoc.indexOf('body { opacity: 0; }');
    const previewStyleIndex = srcDoc.indexOf('data-opencreator-preview="true"');
    const runtimeIndex = srcDoc.indexOf('data-opencreator-preview-runtime="true"');

    expect(sourceStyleIndex).toBeGreaterThanOrEqual(0);
    expect(previewStyleIndex).toBeGreaterThan(sourceStyleIndex);
    expect(runtimeIndex).toBeGreaterThan(previewStyleIndex);
    expect(srcDoc).toContain('html-preview-runtime-2026-07-28.js');
    expect(srcDoc).toContain('script-src http://localhost:3000');
    expect(srcDoc).not.toContain('.opacity-0,');
    expect(srcDoc).not.toContain('[style*="visibility: hidden"]');
  });

  it('loads relative images and stylesheets through controlled workspace resources', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const bytes = url.includes('cover.png')
        ? Uint8Array.from([1, 2, 3, 4])
        : Uint8Array.from([5, 6, 7, 8]);
      return new Response(bytes, {
        headers: { 'content-type': 'image/png' }
      });
    }));
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
      expect(frame.getAttribute('srcdoc')).toContain('data:image/png;base64,AQIDBA==');
      expect(frame.getAttribute('srcdoc')).toContain('data:image/png;base64,BQYHCA==');
    });
    expect(openText).toHaveBeenCalledWith('pages/styles/site.css');
    expect(openBlob).toHaveBeenCalledWith('pages/images/cover.png');
    expect(openBlob).toHaveBeenCalledWith('pages/images/bg.png');
    expect(revokeBlob).toHaveBeenCalledWith('blob:pages/images/cover.png');
    expect(revokeBlob).toHaveBeenCalledWith('blob:pages/images/bg.png');

    unmount();
    expect(revokeBlob).toHaveBeenCalledTimes(2);
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

  it('caps the total bytes embedded into a preview document', async () => {
    const fetchMock = vi.fn(async () => new Response(Uint8Array.from([1])));
    vi.stubGlobal('fetch', fetchMock);
    const openBlob = vi.fn(async (path: string) => ({
      objectUrl: `blob:${path}`,
      mime: 'image/png',
      size: 6 * 1024 * 1024
    }));
    const revokeBlob = vi.fn();
    render(
      <HtmlPreview
        name="large.html"
        path="large.html"
        content='<img src="./first.png"><img src="./second.png">'
        resources={{
          openBlob,
          openText: vi.fn(),
          revokeBlob
        }}
      />
    );

    const frame = await screen.findByTitle('large.html HTML 预览');
    await waitFor(() => {
      expect(frame.getAttribute('srcdoc')).toContain('data:image/png;base64,AQ==');
    });
    expect(openBlob).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(revokeBlob).toHaveBeenCalledTimes(2);
  });
});
