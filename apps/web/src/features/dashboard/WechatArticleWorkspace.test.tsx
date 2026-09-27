import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreatorActionRequest, CreatorJob } from '@opencreator/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import WechatArticleWorkspace from './WechatArticleWorkspace.js';
import { CreatorSessionProvider } from './creator-session-store.js';

describe('WechatArticleWorkspace', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens layout templates after article editing and generates a document result', async () => {
    const job = articleJob();
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') {
        Object.assign(job.state, readPatch(request));
      }
      if (request.action === 'run-stage' && request.input.stageId === 'document') {
        job.artifacts.push(...documentArtifacts());
        job.stages.push({
          id: 'document-stage-1',
          jobId: job.id,
          stageId: 'document',
          executor: 'wechat-article',
          status: 'succeeded',
          dispatchStatus: 'finished',
          claimOwner: null,
          claimExpiresAt: null,
          attempt: 1,
          idempotencyKey: null,
          scopeKey: null,
          inputFingerprint: null,
          progress: { phase: 'completed', percent: 100, completed: 3, failed: 0, total: 3 },
          errorCode: null,
          errorMessage: null,
          startedAt: '2026-09-07T08:01:00.000Z',
          finishedAt: '2026-09-07T08:01:01.000Z'
        });
      }
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    const openArtifact = vi.fn(async () => new Response('# 示例文章\n\n正文内容。', {
      status: 200,
      headers: { 'content-type': 'text/markdown' }
    }));
    const NativeURL = URL;
    class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => 'blob:article-document');
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', TestURL);
    const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, openArtifact, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    await screen.findByRole('textbox', { name: '文章正文编辑器' });
    expect(screen.getByText('20 字')).toBeInTheDocument();
    expect(screen.queryByText('排版模板')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '完成编辑，选择排版' }));

    await screen.findByText('排版模板');
    expect(screen.getByRole('heading', { level: 2, name: '文章预览' }).parentElement).toHaveClass('wechat-layout-preview-heading');
    expect(screen.getByRole('complementary', { name: '排版模板' })).toHaveClass('wechat-layout-sidebar');
    expect(container.querySelector('.wechat-layout-workbench > .wechat-layout-preview-pane + .wechat-layout-sidebar')).toBeInTheDocument();
    expect(within(container.querySelector('.wechat-layout-preview-heading')!).getByRole('button', { name: '复制图文' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '生成文档' })).toBeInTheDocument();
    const layoutCategories = screen.getByRole('group', { name: '排版模板分类' });
    expect(within(layoutCategories).getByRole('button', { name: '推荐' })).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.wechat-layout-list button')).toHaveLength(4);

    fireEvent.click(within(layoutCategories).getByRole('button', { name: '资讯' }));
    expect(container.querySelectorAll('.wechat-layout-list button')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^热点简报/ })).toBeInTheDocument();

    fireEvent.click(within(layoutCategories).getByRole('button', { name: '科技' }));
    expect(container.querySelectorAll('.wechat-layout-list button')).toHaveLength(3);
    const podcastLayout = screen.getByRole('button', { name: /^播客访谈/ });
    expect(within(podcastLayout).getByText('嘉宾发言')).toBeInTheDocument();
    fireEvent.click(podcastLayout);
    expect(container.querySelector('.wechat-article-preview')).toHaveAttribute('data-layout', 'podcast');

    fireEvent.click(within(layoutCategories).getByRole('button', { name: '商业' }));

    const businessLayout = screen.getByRole('button', { name: /^商业报告/ });
    expect(within(businessLayout).getByText('内容摘要')).toBeInTheDocument();
    fireEvent.click(businessLayout);

    expect(businessLayout).toHaveAttribute('data-selected', 'true');
    await waitFor(() => {
      expect(container.querySelector('.wechat-article-preview')).toHaveAttribute('data-layout', 'business');
    });

    fireEvent.click(screen.getByRole('button', { name: '生成文档' }));

    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledWith(job.id, expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'document' }
      }));
    });
    expect(screen.queryByRole('navigation', { name: '文章写作流程' })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '作品' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('示例文章.md')).toBeInTheDocument();
    expect(screen.getByText('示例文章.html')).toBeInTheDocument();
    expect(screen.getByText('示例文章.pdf')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: '配图' })).toBeInTheDocument();
    expect(container.querySelector('.wechat-result-preview')).not.toBeInTheDocument();
    expect(container.querySelector('.creator-collaboration-panel')).toBeInTheDocument();
    expect(screen.getByRole('separator', { name: '调整操作区和对话区宽度' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下载 Markdown 文档' }));
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith(job.id, 'article-document-1'));
    expect(clickDownload).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '调整文章' }));
    expect(await screen.findByRole('textbox', { name: '文章正文编辑器' })).toBeInTheDocument();
  });

  it('edits article text beside configurable automatic image generation settings', async () => {
    const job = articleJob();
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') Object.assign(job.state, readPatch(request));
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByRole('textbox', { name: '文章正文编辑器' })).toBeInTheDocument();
    const imagePanel = screen.getByRole('complementary', { name: '文章配图设置' });
    expect(within(imagePanel).getByRole('checkbox')).toBeChecked();
    expect(within(imagePanel).getByRole('button', { name: '适中' })).toHaveAttribute('aria-pressed', 'true');
    expect(imagePanel.querySelectorAll('.wechat-image-style-grid img')).toHaveLength(6);
    expect(imagePanel.querySelector('.wechat-image-style-grid img')).toHaveAttribute(
      'src',
      '/dashboard/wechat-article/image-styles/editorial-v2.webp'
    );
    expect(imagePanel.querySelectorAll('.wechat-image-style-grid img')[1]).toHaveAttribute(
      'src',
      '/dashboard/wechat-article/image-styles/minimal-v2.webp'
    );
    expect(imagePanel.querySelectorAll('.wechat-image-style-grid img')[2]).toHaveAttribute(
      'src',
      '/dashboard/wechat-article/image-styles/documentary-v2.webp'
    );
    expect(imagePanel.querySelectorAll('.wechat-image-style-grid img')[4]).toHaveAttribute(
      'src',
      '/dashboard/wechat-article/image-styles/three-dimensional-v2.webp'
    );

    fireEvent.click(within(imagePanel).getByRole('button', { name: '多图' }));
    fireEvent.click(within(imagePanel).getByRole('button', { name: '增加配图数量' }));
    expect(within(imagePanel).getByRole('slider', { name: '配图数量' })).toHaveValue('9');
    fireEvent.click(within(imagePanel).getByRole('button', { name: /现代插画/ }));
    expect(within(imagePanel).queryByRole('textbox')).not.toBeInTheDocument();
    fireEvent.click(within(imagePanel).getByRole('button', { name: '生成 9 张配图' }));

    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledWith(job.id, expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'images' }
      }));
    });
    expect(job.state).toEqual(expect.objectContaining({
      autoGenerateImages: true,
      articleImageCount: 9,
      articleImageStyleId: 'illustration'
    }));
  });

  it('generates the outline directly from the selected topic action', async () => {
    const job = articleJob();
    job.state.currentStep = 2;
    job.state.furthestStep = 2;
    job.state.outline = '';
    job.state.articleMarkdown = '';
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') Object.assign(job.state, readPatch(request));
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '生成大纲' }));

    expect(await screen.findByRole('heading', { name: '文章大纲' })).toBeInTheDocument();
    await waitFor(() => {
      expect(applyAction).toHaveBeenCalledWith(job.id, expect.objectContaining({
        action: 'run-stage',
        input: { stageId: 'outline' }
      }));
    });
    expect(screen.queryByRole('button', { name: '使用这个选题' })).not.toBeInTheDocument();
  });

  it('inserts generated images at their planned article headings and renders them in preview', async () => {
    const job = articleJob();
    job.state.articleMarkdown = '# 示例文章\n\n## 第一部分\n\n![旧配图](./article-image-01.png)\n\n第一段正文。\n\n## 第二部分\n\n第二段正文。';
    const firstImage = articleImageArtifact('article-image-1', 2, 1);
    firstImage.metadata.fileName = 'article-image-01.png';
    firstImage.metadata.caption = '第一部分配图';
    firstImage.metadata.placementHeading = '第一部分';
    const secondImage = articleImageArtifact('article-image-2', 2, 2);
    secondImage.metadata.fileName = 'article-image-02.png';
    secondImage.metadata.caption = '第二部分配图';
    secondImage.metadata.placementHeading = '## 第二部分';
    job.artifacts.push(firstImage, secondImage);
    const openArtifact = vi.fn(async () => new Response(
      new Blob(['image'], { type: 'image/png' }),
      { status: 200, headers: { 'content-type': 'image/png' } }
    ));
    const NativeURL = URL;
    class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => `blob:article-image-${TestURL.createObjectURL.mock.calls.length}`);
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', TestURL);

    const { container, unmount } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction: vi.fn(), openArtifact, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const editor = container.querySelector('.wechat-article-editor') as HTMLElement;
    await waitFor(() => {
      expect(within(editor).getByRole('img', { name: '第一部分配图' })).toBeInTheDocument();
      expect(within(editor).getByRole('img', { name: '第二部分配图' })).toBeInTheDocument();
    });
    const editorMarkdown = readArticleEditorMarkdown(editor);
    expect(editorMarkdown).toContain('## 第一部分\n\n![第一部分配图](./article-image-01.png)\n\n第一段正文。');
    expect(editorMarkdown).toContain('## 第二部分\n\n![第二部分配图](./article-image-02.png)\n\n第二段正文。');
    expect(editorMarkdown).not.toContain('旧配图');
    expect(editorMarkdown.match(/!\[/g)).toHaveLength(2);
    expect(within(screen.getByRole('complementary', { name: '文章配图设置' })).queryByText('已生成配图')).not.toBeInTheDocument();

    const figures = Array.from(editor.querySelectorAll('.wechat-article-inline-image'));
    const textBlocks = Array.from(editor.querySelectorAll('.wechat-article-editor-segment')) as HTMLTextAreaElement[];
    expect(textBlocks[0]?.value.endsWith('\n')).toBe(false);
    expect(textBlocks[1]?.value.startsWith('\n')).toBe(false);
    const targetBlock = textBlocks.at(-1)!;
    targetBlock.setSelectionRange(targetBlock.value.length, targetBlock.value.length);
    const dataTransfer = {
      effectAllowed: 'none',
      dropEffect: 'none',
      setData: vi.fn()
    };
    fireEvent.dragStart(figures[0]!, { dataTransfer });
    fireEvent.dragOver(targetBlock, { dataTransfer });
    expect(container.querySelector('.wechat-article-image-drop-indicator')).toBeInTheDocument();
    fireEvent.drop(targetBlock, { dataTransfer });
    expect(container.querySelector('.wechat-article-image-drop-indicator')).not.toBeInTheDocument();

    await waitFor(() => {
      const movedEditor = container.querySelector('.wechat-article-editor') as HTMLElement;
      const movedMarkdown = readArticleEditorMarkdown(movedEditor);
      expect(movedMarkdown.indexOf('![第二部分配图]')).toBeLessThan(movedMarkdown.indexOf('![第一部分配图]'));
    });

    fireEvent.click(screen.getByRole('button', { name: '完成编辑，选择排版' }));
    const preview = container.querySelector('.wechat-article-preview') as HTMLElement;
    await waitFor(() => expect(within(preview).getAllByRole('img').map(image => image.getAttribute('alt'))).toEqual([
      '第二部分配图',
      '第一部分配图'
    ]));
    unmount();
  });

  it('uploads, replaces, and removes inline article images at the editor cursor', async () => {
    const job = articleJob();
    let uploadIndex = 0;
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') Object.assign(job.state, readPatch(request));
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    const uploadArticleImage = vi.fn(async (_jobId: string, input: { file: File }) => {
      uploadIndex += 1;
      const artifact = manualArticleImageArtifact(`manual-image-${uploadIndex}`, input.file.name, uploadIndex);
      job.artifacts.push(artifact);
      job.state.manualArticleImageArtifactIds = [
        ...((job.state.manualArticleImageArtifactIds as string[] | undefined) ?? []),
        artifact.id
      ];
      job.revision += 1;
      return { job: structuredClone(job), artifact, deduplicated: false };
    });
    const openArtifact = vi.fn(async () => new Response(
      new Blob(['image'], { type: 'image/png' }),
      { status: 200, headers: { 'content-type': 'image/png' } }
    ));
    const NativeURL = URL;
    class TestURL extends NativeURL {
      static createObjectURL = vi.fn(() => `blob:manual-article-image-${TestURL.createObjectURL.mock.calls.length}`);
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', TestURL);

    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, uploadArticleImage, openArtifact, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const editor = screen.getByRole('textbox', { name: '文章正文编辑器' }) as HTMLTextAreaElement;
    const insertionOffset = editor.value.indexOf('## 第一部分');
    editor.setSelectionRange(insertionOffset, insertionOffset);
    fireEvent.select(editor);
    fireEvent.click(screen.getByRole('button', { name: '插入图片' }));
    const fileInput = container.querySelector('input[type="file"][accept^="image/png"]') as HTMLInputElement;
    const firstFile = new File(['first'], '我的配图.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [firstFile] } });

    await waitFor(() => expect(screen.getByRole('img', { name: '我的配图' })).toBeInTheDocument());
    expect(uploadArticleImage).toHaveBeenCalledWith(job.id, expect.objectContaining({ file: firstFile }));
    const textBeforeImage = container.querySelector('.wechat-article-editor-segment') as HTMLTextAreaElement;
    expect(textBeforeImage.value).toContain('# 示例文章');
    expect(textBeforeImage.value).not.toContain('## 第一部分');

    fireEvent.click(screen.getByRole('button', { name: '替换图片' }));
    const replacement = new File(['replacement'], '替换配图.webp', { type: 'image/webp' });
    fireEvent.change(fileInput, { target: { files: [replacement] } });
    await waitFor(() => expect(screen.getByRole('img', { name: '替换配图' })).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: '我的配图' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '删除图片' }));
    await waitFor(() => expect(screen.queryByRole('img', { name: '替换配图' })).not.toBeInTheDocument());
    expect(screen.getByRole('status')).toHaveTextContent('图片已从正文移除');
  });

  it('shows the latest generated article images in the result and downloads them individually', async () => {
    const job = articleJob();
    job.state.workspacePhase = 'result';
    job.state.articleImageStyleId = 'documentary';
    job.artifacts.push(
      articleImageArtifact('old-image', 1, 1),
      articleImageArtifact('article-image-1', 2, 1),
      articleImageArtifact('article-image-2', 2, 2),
      documentArtifact()
    );
    const openArtifact = vi.fn(async (_jobId: string, artifactId: string) => new Response(
      new Blob([artifactId], { type: 'image/png' }),
      { status: 200, headers: { 'content-type': 'image/png' } }
    ));
    const NativeURL = URL;
    class TestURL extends NativeURL {
      static createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}`);
      static revokeObjectURL = vi.fn();
    }
    vi.stubGlobal('URL', TestURL);
    const clickDownload = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    const { unmount } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction: vi.fn(), openArtifact, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.queryByText('2 张可单独下载的配图')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: '配图' }));
    expect(await screen.findByText('2 张可单独下载')).toBeInTheDocument();
    expect(screen.queryByText('旧版配图')).not.toBeInTheDocument();
    expect(await screen.findByRole('img', { name: '文章配图 1' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '文章配图 2' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下载配图 2' }));
    expect(clickDownload).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('manages links and dropped files in a 10-item inspiration library', async () => {
    const job = inspirationJob();
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') Object.assign(job.state, readPatch(request));
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    const uploadSourceDocument = vi.fn(async (_jobId: string, input: { file: File }) => {
      const artifact = sourceDocumentArtifact('source-document-1', input.file.name);
      job.artifacts.push(artifact);
      job.state.sourceDocumentArtifactIds = [artifact.id];
      job.revision += 1;
      return { job: structuredClone(job), artifact, deduplicated: false };
    });
    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, uploadSourceDocument, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByRole('complementary', { name: '内容灵感' })).toBeInTheDocument();
    expect(screen.getByText('0/10')).toBeInTheDocument();
    const inspirationAdd = container.querySelector('.wechat-inspiration-add')!;
    const linkSection = container.querySelector('.wechat-inspiration-link-section')!;
    const dropzone = container.querySelector('.wechat-inspiration-dropzone')!;
    expect(Array.from(inspirationAdd.children).indexOf(linkSection)).toBeLessThan(
      Array.from(inspirationAdd.children).indexOf(dropzone)
    );
    const urlInput = screen.getByRole('textbox', { name: '视频或网页链接' });
    fireEvent.change(urlInput, { target: { value: 'https://www.bilibili.com/video/BV1test' } });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText('1/10')).toBeInTheDocument();

    const file = new File(['article notes'], 'notes.md', { type: 'text/markdown' });
    fireEvent.drop(dropzone, { dataTransfer: { files: [file], dropEffect: 'copy' } });
    await waitFor(() => expect(uploadSourceDocument).toHaveBeenCalledWith(job.id, expect.objectContaining({ file })));
    expect(await screen.findByText('2/10')).toBeInTheDocument();
    expect(screen.getByText('notes.md')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('文件已加入内容灵感');
  });

  it('parses inspiration before opening the writing brief', async () => {
    const job = inspirationJob(1);
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') Object.assign(job.state, readPatch(request));
      if (request.action === 'run-stage' && request.input.stageId === 'sources') {
        job.artifacts.push(articleSourcesArtifact('article-sources-1', 1));
        job.stages.push(sourceStage('succeeded'));
        job.status = 'draft';
      }
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '解析灵感并继续' }));

    await waitFor(() => expect(applyAction).toHaveBeenCalledWith(job.id, expect.objectContaining({
      action: 'run-stage',
      input: { stageId: 'sources' }
    })));
    expect(await screen.findByRole('heading', { name: '写作要求' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('已解析 1 个内容灵感，其中 1 个视频使用自动字幕');
  });

  it('keeps the writing brief primary and selects templates from a searchable library', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 44,
      width: 920
    } as DOMRect);
    const job = inspirationJob();
    job.state.currentStep = 1;
    job.state.furthestStep = 1;
    job.state.presetId = 'insight';
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') Object.assign(job.state, readPatch(request));
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByRole('textbox', { name: '提示词' })).toBeInTheDocument();
    expect(screen.getByText('深度洞察')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '文章模板库' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更换模板' }));
    const library = screen.getByRole('dialog', { name: '文章模板库' });
    expect(library.parentElement).toHaveClass('wechat-template-library-overlay');
    expect(library.parentElement?.parentElement).toBe(document.body);
    expect(library.parentElement?.style.getPropertyValue('--wechat-template-library-left')).toBe('44px');
    expect(library.parentElement?.style.getPropertyValue('--wechat-template-library-width')).toBe('920px');
    const filters = within(library).getByRole('group', { name: '模板标签' });
    expect(within(filters).getAllByRole('button')).toHaveLength(10);
    expect(within(filters).getByRole('button', { name: '热门' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(library).queryByRole('button', { name: /深度洞察/ })).not.toBeInTheDocument();
    expect(within(library).getByRole('button', { name: /孙割写作\.skill/ })).toBeInTheDocument();
    expect(within(library).getByRole('button', { name: /卡兹克公众号长文写作/ })).toBeInTheDocument();
    expect(within(library).getByRole('button', { name: /科研论文写作/ })).toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: '社区' }));
    expect(within(library).getByRole('button', { name: /孙割写作\.skill/ })).toBeInTheDocument();
    expect(within(library).getByRole('button', { name: /卡兹克公众号长文写作/ })).toBeInTheDocument();
    expect(within(library).queryByRole('button', { name: /深度洞察/ })).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: '科技' }));
    expect(within(library).getByRole('button', { name: /卡兹克公众号长文写作/ })).toBeInTheDocument();
    expect(within(library).queryByRole('button', { name: /孙割写作\.skill/ })).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: '科研' }));
    expect(within(library).getByRole('button', { name: /科研论文写作/ })).toBeInTheDocument();
    expect(within(library).queryByRole('button', { name: /卡兹克公众号长文写作/ })).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: '全部' }));
    const search = within(library).getByRole('textbox', { name: '搜索文章模板' });
    fireEvent.change(search, { target: { value: '教程' } });
    expect(within(library).getByRole('button', { name: /实用教程/ })).toBeInTheDocument();
    expect(within(library).queryByRole('button', { name: /故事叙事/ })).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: '' } });
    expect(within(library).getByRole('button', { name: /卡兹克公众号长文写作/ })).toBeInTheDocument();
    fireEvent.click(within(library).getByRole('button', { name: /孙割写作\.skill/ }));
    expect(within(library).getByText('社区贡献')).toBeInTheDocument();
    expect(within(library).getByRole('link', { name: '查看模板来源' })).toHaveAttribute(
      'href',
      'https://github.com/KKKKhazix/sun-style-writing'
    );
    fireEvent.click(within(library).getByRole('button', { name: /故事叙事/ }));
    fireEvent.click(within(library).getByRole('button', { name: '使用这个模板' }));

    expect(screen.queryByRole('dialog', { name: '文章模板库' })).not.toBeInTheDocument();
    expect(screen.getByText('故事叙事')).toBeInTheDocument();
  });

  it('allows editing the topic count and enforces its range when committed', async () => {
    const job = inspirationJob();
    job.state.currentStep = 1;
    job.state.furthestStep = 1;
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') Object.assign(job.state, readPatch(request));
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const input = screen.getByRole('spinbutton', { name: '候选选题数量' });
    expect(input).toHaveValue(5);

    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveValue(null);

    fireEvent.change(input, { target: { value: '2' } });
    fireEvent.blur(input);
    expect(input).toHaveValue(3);
    await waitFor(() => expect(job.state.topicCount).toBe(3));

    fireEvent.change(input, { target: { value: '7' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue(7);
    await waitFor(() => expect(job.state.topicCount).toBe(7));
  });

  it('starts without a selected template and exposes the template list', () => {
    const job = inspirationJob();
    job.state.currentStep = 1;
    job.state.furthestStep = 1;
    const applyAction = vi.fn();
    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const list = screen.getByRole('group', { name: '文章模板列表' });
    const inlineFilters = screen.getByRole('group', { name: '写作模板标签' });
    const templateButtons = within(list).getAllByRole('button');
    expect(templateButtons).toHaveLength(3);
    expect(templateButtons[0]).toHaveAccessibleName(/孙割写作\.skill/);
    expect(templateButtons[1]).toHaveAccessibleName(/卡兹克公众号长文写作/);
    expect(templateButtons[2]).toHaveAccessibleName(/科研论文写作/);
    expect(container.querySelector('.wechat-current-template')).not.toBeInTheDocument();

    expect(within(inlineFilters).queryByRole('button', { name: '全部' })).not.toBeInTheDocument();
    expect(within(inlineFilters).queryByRole('button', { name: '社区' })).not.toBeInTheDocument();
    expect(within(inlineFilters).getAllByRole('button')).toHaveLength(8);
    expect(within(inlineFilters).getByRole('button', { name: '热门' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(inlineFilters).getByRole('button', { name: '科技' }));
    expect(within(list).getAllByRole('button')).toHaveLength(4);
    expect(within(list).queryByRole('button', { name: /孙割写作\.skill/ })).not.toBeInTheDocument();
    fireEvent.click(within(inlineFilters).getByRole('button', { name: '科技' }));
    expect(within(list).getAllByRole('button')).toHaveLength(7);

    fireEvent.click(within(inlineFilters).getByRole('button', { name: '科研' }));
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    expect(within(list).getByRole('button', { name: /科研论文写作/ })).toBeInTheDocument();
    fireEvent.click(within(inlineFilters).getByRole('button', { name: '科研' }));

    fireEvent.click(within(list).getByRole('button', { name: /故事叙事/ }));

    expect(screen.queryByRole('group', { name: '文章模板列表' })).not.toBeInTheDocument();
    expect(container.querySelector('.wechat-current-template')).toHaveTextContent('故事叙事');

    fireEvent.click(screen.getByRole('button', { name: '取消文章模板' }));

    expect(screen.getByRole('group', { name: '文章模板列表' })).toBeInTheDocument();
    expect(container.querySelector('.wechat-current-template')).not.toBeInTheDocument();
  });

  it('localizes writing template metadata to the active app language', () => {
    const job = inspirationJob();
    job.state.currentStep = 1;
    job.state.furthestStep = 1;
    job.state.presetId = 'community.khazix-writer';
    job.state.templatePrompt = '';

    render(
      <LanguageProvider initialPreference="en-US">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('Khazix Long-form WeChat Writing')).toBeInTheDocument();
    expect(screen.getByText('Conversational long-form writing built on real experience and progressive argument')).toBeInTheDocument();
    expect(screen.queryByText('卡兹克公众号长文写作')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Template instructions'));
    expect((screen.getByRole('textbox', { name: 'Template instructions' }) as HTMLTextAreaElement).value).toContain('Begin with a source-supported event');
  });

  it('keeps legacy template validation failures readable in Agent', async () => {
    vi.useFakeTimers();
    const job = inspirationJob();
    job.state.currentStep = 1;
    job.state.furthestStep = 1;
    job.state.presetId = 'insight';
    const validationError = Object.assign(new Error(JSON.stringify([{
      received: '',
      code: 'invalid_enum_value',
      options: ['insight', 'story', 'tutorial', 'news-analysis'],
      path: ['presetId'],
      message: 'Invalid enum value'
    }])), { code: 'creator_request_invalid' });
    const applyAction = vi.fn(async () => Promise.reject(validationError));
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '取消文章模板' }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    const agent = screen.getByRole('complementary', { name: 'OpenCreator' });
    expect(agent).toHaveTextContent('文章模板状态已更新，请刷新页面后重新选择');
    expect(screen.queryByText(/invalid_enum_value/)).not.toBeInTheDocument();
    expect(screen.queryByText(/诊断编号：OC-/)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(agent).toHaveTextContent('文章模板状态已更新，请刷新页面后重新选择');
    expect(screen.queryByText(/诊断编号：OC-/)).not.toBeInTheDocument();
  });

  it('opens jobs that use the previous community template id with the renamed template selected', () => {
    const job = inspirationJob();
    job.state.currentStep = 1;
    job.state.furthestStep = 1;
    job.state.presetId = 'community.restrained-narrative';

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('孙割写作.skill')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '文章模板列表' })).not.toBeInTheDocument();
  });

  it('stays on inspiration and reports missing subtitles in Agent', async () => {
    const job = inspirationJob(1);
    job.state.sourceLinks = [{
      id: 'video-1',
      url: 'https://www.youtube.com/watch?v=test',
      kind: 'video',
      label: 'youtube.com'
    }];
    const applyAction = vi.fn(async (_jobId: string, request: CreatorActionRequest) => {
      if (request.action === 'update-settings') Object.assign(job.state, readPatch(request));
      if (request.action === 'run-stage' && request.input.stageId === 'sources') {
        job.stages.push(sourceStage('failed'));
        job.status = 'failed';
      }
      job.revision += 1;
      return actionResponse(job, request.action);
    });
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '解析灵感并继续' }));

    await waitFor(() => expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent('没有找到可用的视频字幕：youtube.com'));
    expect(screen.getByRole('heading', { name: '添加内容灵感' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '写作要求' })).not.toBeInTheDocument();
  });

  it('keeps stage errors in Agent instead of dismissing them', async () => {
    vi.useFakeTimers();
    const job = inspirationJob(1);
    job.stages.push(sourceStage('failed'));
    job.status = 'failed';
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const agent = screen.getByRole('complementary', { name: 'OpenCreator' });
    expect(agent).toHaveTextContent('没有找到可用的视频字幕：youtube.com');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(agent).toHaveTextContent('没有找到可用的视频字幕：youtube.com');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('reports document upload failures in Agent without a workspace toast', async () => {
    const job = inspirationJob();
    const uploadError = Object.assign(
      new Error('Document exceeds the 26214400 byte limit'),
      { code: 'creator_document_too_large' }
    );
    const uploadSourceDocument = vi.fn(async () => Promise.reject(uploadError));
    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction: vi.fn(), uploadSourceDocument, runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    const file = new File(['oversized'], 'large.pdf', { type: 'application/pdf' });
    fireEvent.drop(container.querySelector('.wechat-inspiration-dropzone')!, {
      dataTransfer: { files: [file], dropEffect: 'copy' }
    });

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: 'OpenCreator' }).querySelector('.creator-collaboration-issue')).toBeInTheDocument();
      expect(container.querySelector('.wechat-article-toast')).not.toBeInTheDocument();
      expect(container.querySelector('.creator-tool-error')).not.toBeInTheDocument();
    });
  });

  it('disables adding more inspiration when the shared limit is reached', () => {
    const job = inspirationJob(10);
    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('10/10')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '添加' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '选择文件' })).toBeDisabled();
    expect(screen.getByText('已达到 10 个内容灵感上限')).toBeInTheDocument();
  });

  it('shows form validation in Agent without an error toast', async () => {
    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={inspirationJob()}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: '添加' }));

    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent('请输入有效的网页或视频链接');
    expect(container.querySelector('.wechat-article-toast')).not.toBeInTheDocument();
    expect(container.querySelector('.creator-tool-error')).not.toBeInTheDocument();
  });

  it('shows missing image service configuration only in Agent', () => {
    const job = articleJob();
    job.stages.push({
      id: 'images-stage-failed',
      jobId: job.id,
      stageId: 'images',
      executor: 'wechat-article',
      status: 'failed',
      dispatchStatus: 'finished',
      claimOwner: null,
      claimExpiresAt: null,
      attempt: 1,
      idempotencyKey: null,
      scopeKey: null,
      inputFingerprint: null,
      progress: { phase: 'failed', percent: 0, completed: 0, failed: 1, total: 1 },
      errorCode: 'creator_image_config_missing',
      errorMessage: 'Image generation service is not configured',
      startedAt: '2026-09-07T08:00:00.000Z',
      finishedAt: '2026-09-07T08:00:01.000Z'
    });

    const { container } = render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
        >
          <WechatArticleWorkspace onBack={vi.fn()} />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByRole('complementary', { name: 'OpenCreator' })).toHaveTextContent('请先配置图像生成服务');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('.wechat-article-toast')).not.toBeInTheDocument();
    expect(container.querySelector('.wechat-article-footer-stack > .wechat-article-actions')).toBeInTheDocument();
  });
});

function readArticleEditorMarkdown(editor: HTMLElement): string {
  return Array.from(editor.children).map(element => {
    const markdown = element.getAttribute('data-markdown');
    if (markdown !== null) return markdown;
    const textarea = element instanceof HTMLTextAreaElement
      ? element
      : element.querySelector('textarea');
    return textarea?.value ?? '';
  }).join('');
}

function readPatch(request: CreatorActionRequest): Record<string, unknown> {
  const patch = request.input.patch;
  return typeof patch === 'object' && patch !== null && !Array.isArray(patch)
    ? patch
    : {};
}

function actionResponse(job: CreatorJob, action: string) {
  return {
    job: structuredClone(job),
    receipt: {
      actor: 'user' as const,
      action,
      summary: action,
      affectedArtifacts: [],
      newRevision: job.revision,
      createdAt: job.updatedAt
    }
  };
}

function documentArtifacts(): CreatorJob['artifacts'] {
  return [
    documentArtifact('markdown', 'md', 'text/markdown', 128),
    documentArtifact('html', 'html', 'text/html', 512),
    documentArtifact('pdf', 'pdf', 'application/pdf', 2048)
  ];
}

function documentArtifact(
  format = 'markdown',
  extension = 'md',
  mimeType = 'text/markdown',
  bytes = 128
): CreatorJob['artifacts'][number] {
  return {
    id: format === 'markdown' ? 'article-document-1' : `article-document-${format}`,
    jobId: 'creator_job_wechat_article_ui',
    kind: 'article_document',
    version: 1,
    status: 'completed',
    path: `/tmp/示例文章.${extension}`,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: ['article-artifact-1'],
    metadata: {
      fileName: `示例文章.${extension}`,
      mimeType,
      documentFormat: format,
      resultVersion: 1,
      title: '示例文章',
      bytes,
      characterCount: 28,
      layoutStyleId: 'business'
    },
    createdAt: '2026-09-07T08:01:01.000Z'
  };
}

function articleImageArtifact(id: string, resultVersion: number, imageIndex: number): CreatorJob['artifacts'][number] {
  return {
    id,
    jobId: 'creator_job_wechat_article_ui',
    kind: 'article_image',
    version: resultVersion,
    status: 'completed',
    path: `/tmp/${id}.png`,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: ['article-artifact-1'],
    metadata: {
      fileName: `${id}.png`,
      mimeType: 'image/png',
      resultVersion,
      imageIndex,
      caption: resultVersion === 1 ? '旧版配图' : `新版配图 ${imageIndex}`,
      placementHeading: `第 ${imageIndex} 节`,
      imageStyleId: 'documentary'
    },
    createdAt: `2026-09-07T08:02:0${imageIndex}.000Z`
  };
}

function manualArticleImageArtifact(id: string, originalFileName: string, index: number): CreatorJob['artifacts'][number] {
  const extension = originalFileName.split('.').pop() || 'png';
  return {
    id,
    jobId: 'creator_job_wechat_article_ui',
    kind: 'article_image',
    version: index,
    status: 'completed',
    path: `/tmp/${id}.${extension}`,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      fileName: `article-upload-${index}.${extension}`,
      originalFileName,
      mimeType: extension === 'webp' ? 'image/webp' : 'image/png',
      source: 'local-upload'
    },
    createdAt: `2026-09-07T08:00:0${index}.000Z`
  };
}

function sourceDocumentArtifact(id: string, fileName: string): CreatorJob['artifacts'][number] {
  return {
    id,
    jobId: 'creator_job_wechat_article_inspiration',
    kind: 'source_document',
    version: 1,
    status: 'completed',
    path: `/tmp/${fileName}`,
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: { fileName, bytes: 13, mimeType: 'text/markdown' },
    createdAt: '2026-09-07T08:00:00.000Z'
  };
}

function articleSourcesArtifact(id: string, automaticTranscriptCount = 0): CreatorJob['artifacts'][number] {
  return {
    id,
    jobId: 'creator_job_wechat_article_inspiration',
    kind: 'article_sources',
    version: 1,
    status: 'completed',
    path: '/tmp/article-sources.json',
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
    sourceArtifactIds: [],
    metadata: {
      fileName: 'article-sources.json',
      mimeType: 'application/json',
      sourceCount: 1,
      automaticTranscriptCount
    },
    createdAt: '2026-09-07T08:00:01.000Z'
  };
}

function sourceStage(status: 'succeeded' | 'failed'): CreatorJob['stages'][number] {
  return {
    id: `sources-stage-${status}`,
    jobId: 'creator_job_wechat_article_inspiration',
    stageId: 'sources',
    executor: 'wechat-article',
    status,
    dispatchStatus: 'finished',
    claimOwner: null,
    claimExpiresAt: null,
    attempt: 1,
    idempotencyKey: null,
    scopeKey: null,
    inputFingerprint: null,
    progress: { phase: status === 'succeeded' ? 'completed' : 'reading_video', message: 'youtube.com' },
    errorCode: status === 'failed' ? 'creator_source_transcript_missing' : null,
    errorMessage: status === 'failed' ? 'No subtitles are available for video' : null,
    startedAt: '2026-09-07T08:00:00.000Z',
    finishedAt: '2026-09-07T08:00:01.000Z'
  };
}

function inspirationJob(sourceCount = 0): CreatorJob {
  const createdAt = '2026-09-07T08:00:00.000Z';
  return {
    id: 'creator_job_wechat_article_inspiration',
    projectId: 'project_1',
    templateId: 'wechat-article',
    templateVersion: 1,
    status: 'draft',
    revision: 0,
    state: {
      sourceLinks: Array.from({ length: sourceCount }, (_, index) => ({
        id: `source-${index}`,
        url: `https://example.com/${index}`,
        kind: 'webpage',
        label: `example.com/${index}`
      })),
      sourceDocumentArtifactIds: [],
      currentStep: 0,
      furthestStep: 0
    },
    agentThreadId: null,
    stages: [],
    artifacts: [],
    providerRequests: [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
}

function articleJob(): CreatorJob {
  const createdAt = '2026-09-07T08:00:00.000Z';
  return {
    id: 'creator_job_wechat_article_ui',
    projectId: 'project_1',
    templateId: 'wechat-article',
    templateVersion: 1,
    status: 'completed',
    revision: 0,
    state: {
      topics: [{ id: 'topic-1', title: '示例文章', angle: '测试角度', summary: '测试摘要' }],
      selectedTopicId: 'topic-1',
      outline: '# 示例文章\n\n## 第一部分',
      articleMarkdown: '# 示例文章\n\n**这是一段导语。**\n\n## 第一部分\n\n正文内容。',
      layoutStyleId: 'minimal',
      currentStep: 4,
      furthestStep: 4
    },
    agentThreadId: null,
    stages: [],
    artifacts: [{
      id: 'article-artifact-1',
      jobId: 'creator_job_wechat_article_ui',
      kind: 'article_markdown',
      version: 1,
      status: 'completed',
      path: '/tmp/wechat-article.md',
      scopeKey: null,
      inputFingerprint: null,
      sha256: null,
      sourceArtifactIds: [],
      metadata: { fileName: 'wechat-article.md' },
      createdAt
    }],
    providerRequests: [],
    activities: [],
    createdAt,
    updatedAt: createdAt
  };
}
