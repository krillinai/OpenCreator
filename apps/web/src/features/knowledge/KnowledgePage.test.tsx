import type {
  EnterpriseKnowledgeBaseResponse,
  EnterpriseKnowledgeDocumentResponse
} from '@opencreator/protocol';
import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  KnowledgePage,
  type KnowledgePageProps
} from './KnowledgePage.js';

const writableKnowledgeBase = createKnowledgeBase({
  knowledgeBaseId: 'kb-product',
  name: '产品资料',
  documentCount: 2,
  permissions: { read: true, upload: true, search: true }
});

const readOnlyKnowledgeBase = createKnowledgeBase({
  knowledgeBaseId: 'kb-policy',
  name: '创作灵感',
  documentCount: 0,
  permissions: { read: true, upload: false, search: true }
});

describe('KnowledgePage', () => {
  it('only gates the page while the local Runtime is unavailable', () => {
    renderKnowledge({ connected: false });

    expect(screen.getByRole('heading', { name: '正在等待本地 Runtime' }))
      .toBeInTheDocument();
    expect(screen.queryByText(/登录/)).not.toBeInTheDocument();
  });

  it('renders only authorized knowledge bases and loads the selected document list', async () => {
    const user = userEvent.setup();
    const onSelectKnowledgeBase = vi.fn();
    const view = renderKnowledge({
      knowledgeBases: [writableKnowledgeBase, readOnlyKnowledgeBase],
      selectedKnowledgeBaseId: writableKnowledgeBase.knowledgeBaseId,
      documents: [
        createDocument({
          documentId: 'doc-ready',
          name: '产品手册.docx',
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          status: 'ready',
          sizeBytes: 1536
        }),
        createDocument({
          documentId: 'doc-failed',
          name: '旧版说明.md',
          status: 'failed',
          errorMessage: '内容解析失败'
        })
      ],
      onSelectKnowledgeBase
    });

    expect(screen.getByRole('heading', { level: 1, name: '知识库' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新知识库' }))
      .toBeInTheDocument();
    const documentHeader = view.container.querySelector('.knowledge-documents-header');
    expect(documentHeader).not.toBeNull();
    expect(within(documentHeader as HTMLElement).queryByText('企业授权内容'))
      .not.toBeInTheDocument();
    expect(within(documentHeader as HTMLElement).queryByText('可用'))
      .not.toBeInTheDocument();
    expect(within(documentHeader as HTMLElement).queryByText('2 个文档'))
      .not.toBeInTheDocument();
    const libraryPane = screen.getByRole('navigation', { name: '资料集合' });
    expect(within(libraryPane).getByText('产品资料')).toBeInTheDocument();
    expect(within(libraryPane).getByText('创作灵感')).toBeInTheDocument();

    const documentList = screen.getByRole('list', { name: '文档列表' });
    expect(within(documentList).getByText('产品手册.docx')).toBeInTheDocument();
    expect(within(documentList).queryByText(
      'VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT'
    )).not.toBeInTheDocument();
    expect(within(documentList).getByText('1.5 KiB')).toBeInTheDocument();
    expect(within(documentList).getByText('处理失败')).toBeInTheDocument();
    expect(within(documentList).getByText('内容解析失败')).toBeInTheDocument();

    await user.click(within(libraryPane).getByRole('button', { name: /创作灵感/ }));
    expect(onSelectKnowledgeBase).toHaveBeenCalledWith('kb-policy');
  });

  it('only exposes upload for a knowledge base with upload permission', () => {
    const view = renderKnowledge({
      knowledgeBases: [readOnlyKnowledgeBase],
      selectedKnowledgeBaseId: readOnlyKnowledgeBase.knowledgeBaseId,
      documents: []
    });

    expect(screen.queryByRole('button', { name: '上传文档' }))
      .not.toBeInTheDocument();
    expect(screen.getByText('该知识库当前没有可显示的文档。'))
      .toBeInTheDocument();

    view.rerender(createKnowledge({
      knowledgeBases: [writableKnowledgeBase],
      selectedKnowledgeBaseId: writableKnowledgeBase.knowledgeBaseId,
      documents: []
    }));
    expect(screen.getByRole('button', { name: '上传文档' })).toBeInTheDocument();
    expect(screen.getByText('可以上传首个文档，处理完成后会在此显示状态。'))
      .toBeInTheDocument();
  });

  it('validates file type and size before upload, then submits a valid file', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const onUpload = vi.fn();
    renderKnowledge({
      knowledgeBases: [writableKnowledgeBase],
      selectedKnowledgeBaseId: writableKnowledgeBase.knowledgeBaseId,
      documents: [],
      onUpload
    });

    const input = screen.getByLabelText('选择知识库文档');
    await user.upload(input, new File(['script'], 'script.exe'));
    expect(screen.getByRole('alert')).toHaveTextContent(
      '仅支持 PDF、DOCX、Markdown、TXT、XLSX 和 CSV 文件。'
    );
    expect(onUpload).not.toHaveBeenCalled();

    const oversized = new File(['large'], 'large.pdf', {
      type: 'application/pdf'
    });
    Object.defineProperty(oversized, 'size', {
      configurable: true,
      value: 50 * 1024 * 1024 + 1
    });
    await user.upload(input, oversized);
    expect(screen.getByRole('alert')).toHaveTextContent(
      '单个文档不能超过 50 MiB。'
    );
    expect(onUpload).not.toHaveBeenCalled();

    const valid = new File(['manual'], 'manual.pdf', {
      type: 'application/pdf'
    });
    await user.upload(input, valid);
    expect(onUpload).toHaveBeenCalledWith(valid);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows upload progress and errors without resizing the command surface', () => {
    const view = renderKnowledge({
      knowledgeBases: [writableKnowledgeBase],
      selectedKnowledgeBaseId: writableKnowledgeBase.knowledgeBaseId,
      documents: [],
      upload: { fileName: 'manual.pdf', status: 'uploading' }
    });

    expect(screen.getByRole('button', { name: '上传中' })).toBeDisabled();
    expect(screen.getByLabelText('选择知识库文档')).toBeDisabled();

    view.rerender(createKnowledge({
      knowledgeBases: [writableKnowledgeBase],
      selectedKnowledgeBaseId: writableKnowledgeBase.knowledgeBaseId,
      documents: [],
      upload: {
        fileName: 'manual.pdf',
        status: 'failed',
        error: '文档上传失败'
      },
      uploadNotice: 'manual.pdf 已提交处理'
    }));

    expect(screen.getByRole('alert')).toHaveTextContent('文档上传失败');
    expect(screen.getByRole('status')).toHaveTextContent('manual.pdf 已提交处理');
  });

  it('supports the mobile drill-down and back interaction', async () => {
    const user = userEvent.setup();
    const view = renderKnowledge({
      knowledgeBases: [writableKnowledgeBase],
      documents: []
    });
    const dashboard = view.container.querySelector('.knowledge-dashboard');
    expect(dashboard).toHaveAttribute('data-mobile-documents-open', 'false');

    await user.click(screen.getByRole('button', { name: /产品资料/ }));
    expect(dashboard).toHaveAttribute('data-mobile-documents-open', 'true');

    view.rerender(createKnowledge({
      knowledgeBases: [writableKnowledgeBase],
      selectedKnowledgeBaseId: writableKnowledgeBase.knowledgeBaseId,
      documents: []
    }));
    await user.click(screen.getByRole('button', { name: '返回知识库列表' }));
    expect(dashboard).toHaveAttribute('data-mobile-documents-open', 'false');
  });

  it('keeps knowledge management free of conversation entry points', () => {
    renderKnowledge({ knowledgeBases: [writableKnowledgeBase] });

    expect(screen.getByRole('button', { name: '刷新知识库' }))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '对话知识库' }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: '资料集合' })).toBeVisible();
  });
});

function renderKnowledge(overrides: Partial<KnowledgePageProps> = {}) {
  return render(createKnowledge(overrides));
}

function createKnowledge(overrides: Partial<KnowledgePageProps> = {}) {
  return (
    <KnowledgePage
      connected
      knowledgeBases={[]}
      knowledgeBasesLoading={false}
      documentsLoading={false}
      onRefresh={vi.fn()}
      onSelectKnowledgeBase={vi.fn()}
      onUpload={vi.fn()}
      {...overrides}
    />
  );
}

function createKnowledgeBase(
  overrides: Partial<EnterpriseKnowledgeBaseResponse> = {}
): EnterpriseKnowledgeBaseResponse {
  return {
    knowledgeBaseId: 'kb-default',
    name: '知识库',
    description: '个人创作资料',
    status: 'active',
    documentCount: 0,
    permissions: {
      read: true,
      upload: false,
      search: false
    },
    ...overrides
  };
}

function createDocument(
  overrides: Partial<EnterpriseKnowledgeDocumentResponse> = {}
): EnterpriseKnowledgeDocumentResponse {
  return {
    documentId: 'doc-default',
    knowledgeBaseId: writableKnowledgeBase.knowledgeBaseId,
    name: '文档.pdf',
    sizeBytes: 1024,
    mimeType: 'application/pdf',
    status: 'ready',
    errorMessage: '',
    uploadedBy: 'member@example.com',
    createdAt: '2026-08-05T08:00:00.000Z',
    updatedAt: '2026-08-05T09:00:00.000Z',
    ...overrides
  };
}
