import type {
  EnterpriseKnowledgeBaseResponse,
  EnterpriseKnowledgeDocumentResponse,
  EnterpriseSessionResponse
} from '@clawee/protocol';
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  LoaderCircle,
  LogIn,
  MessageSquareText,
  RefreshCw,
  Upload,
  WifiOff
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode
} from 'react';
import './knowledge.css';

const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set([
  '.csv',
  '.docx',
  '.md',
  '.pdf',
  '.txt',
  '.xlsx'
]);

export type KnowledgeUploadState = {
  fileName: string;
  status: 'uploading' | 'failed';
  error?: string;
};

export type KnowledgePageProps = {
  connected: boolean;
  session: EnterpriseSessionResponse;
  knowledgeBases?: EnterpriseKnowledgeBaseResponse[];
  knowledgeBasesLoading: boolean;
  knowledgeBasesError?: string;
  selectedKnowledgeBaseId?: string;
  documents?: EnterpriseKnowledgeDocumentResponse[];
  documentsLoading: boolean;
  documentsError?: string;
  upload?: KnowledgeUploadState;
  uploadNotice?: string;
  conversation?: ReactNode;
  onOpenAccount(): void;
  onRefresh(): void;
  onSelectKnowledgeBase(knowledgeBaseId: string): void;
  onUpload(file: File): void;
};

export function KnowledgePage(props: KnowledgePageProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mobileDocumentsOpen, setMobileDocumentsOpen] = useState(false);
  const [fileSelectionError, setFileSelectionError] = useState<string>();
  const [mode, setMode] = useState<'list' | 'conversation'>('list');
  const selectedKnowledgeBase = props.knowledgeBases?.find(
    item => item.knowledgeBaseId === props.selectedKnowledgeBaseId
  );
  const uploadInProgress = props.upload?.status === 'uploading';

  useEffect(() => {
    if (props.selectedKnowledgeBaseId === undefined) {
      setMobileDocumentsOpen(false);
    }
    setFileSelectionError(undefined);
  }, [props.selectedKnowledgeBaseId]);

  function selectKnowledgeBase(knowledgeBaseId: string) {
    setFileSelectionError(undefined);
    setMobileDocumentsOpen(true);
    props.onSelectKnowledgeBase(knowledgeBaseId);
  }

  function chooseFile() {
    setFileSelectionError(undefined);
    fileInputRef.current?.click();
  }

  function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined) return;
    const error = validateFile(file);
    if (error !== undefined) {
      setFileSelectionError(error);
      return;
    }
    setFileSelectionError(undefined);
    props.onUpload(file);
  }

  if (!props.connected) {
    return (
      <KnowledgeGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title="正在等待本地 Runtime"
        detail="企业知识库暂不可用，本地工作区仍可继续使用。"
      />
    );
  }

  if (props.session.status === 'checking') {
    return (
      <KnowledgeGate
        icon={<LoaderCircle className="knowledge-spinner" size={22} aria-hidden="true" />}
        title="正在验证企业会话"
        detail="验证完成后会自动加载当前账户可访问的知识库。"
      />
    );
  }

  if (props.session.status === 'service_unavailable') {
    return (
      <KnowledgeGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title="企业知识服务暂时不可用"
        detail="服务恢复后可重新加载，不影响本地项目和任务。"
        actionLabel="重新加载"
        onAction={props.onRefresh}
      />
    );
  }

  if (props.session.status !== 'signed_in') {
    return (
      <KnowledgeGate
        icon={<LogIn size={22} aria-hidden="true" />}
        title="登录后访问企业知识库"
        detail="知识库和文档范围由当前企业账户权限决定。"
        actionLabel="登录企业账户"
        onAction={props.onOpenAccount}
      />
    );
  }

  return (
    <main className="knowledge-page">
      <div className="knowledge-page__inner">
        <header className="knowledge-header">
          <div>
            <h1>企业知识库</h1>
            <p>查看当前账户有权访问的知识库和文档</p>
          </div>
          <div className="knowledge-header__actions">
            <button
              className="knowledge-view-toggle"
              type="button"
              onClick={() => setMode(current => (
                current === 'list' ? 'conversation' : 'list'
              ))}
            >
              <MessageSquareText size={16} aria-hidden="true" />
              <span>{mode === 'list' ? '对话知识库' : '返回列表视图'}</span>
            </button>
            <button
              className="knowledge-icon-button"
              type="button"
              aria-label="刷新企业知识库"
              title="刷新"
              onClick={props.onRefresh}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        {props.knowledgeBasesError !== undefined ? (
          <p className="knowledge-banner knowledge-banner--error" role="alert">
            {props.knowledgeBasesError}
          </p>
        ) : null}

        <div
          className="knowledge-workbench"
          data-mobile-documents-open={mobileDocumentsOpen}
          hidden={mode !== 'list'}
        >
          <nav className="knowledge-library-pane" aria-label="授权知识库">
            <div className="knowledge-pane-heading">
              <div>
                <h2>知识库</h2>
                <span>{props.knowledgeBases?.length ?? 0} 个可访问项</span>
              </div>
            </div>

            {props.knowledgeBasesLoading && props.knowledgeBases === undefined ? (
              <KnowledgeLoading label="正在加载知识库" />
            ) : (props.knowledgeBases?.length ?? 0) === 0 ? (
              <KnowledgeEmpty
                icon={<FolderOpen size={22} aria-hidden="true" />}
                title="暂无可访问知识库"
                detail="当前账户没有知识库读取权限，或企业目录暂时为空。"
              />
            ) : (
              <ul className="knowledge-library-list">
                {props.knowledgeBases!.map(knowledgeBase => (
                  <li key={knowledgeBase.knowledgeBaseId}>
                    <button
                      type="button"
                      aria-current={
                        knowledgeBase.knowledgeBaseId ===
                        props.selectedKnowledgeBaseId
                          ? 'page'
                          : undefined
                      }
                      onClick={() => selectKnowledgeBase(
                        knowledgeBase.knowledgeBaseId
                      )}
                    >
                      <span className="knowledge-library-list__title">
                        <strong>{knowledgeBase.name}</strong>
                        <small>{knowledgeBase.documentCount} 个文档</small>
                      </span>
                      <span className="knowledge-library-list__description">
                        {knowledgeBase.description || '暂无说明'}
                      </span>
                      <span className="knowledge-library-list__meta">
                        <KnowledgeStatus value={knowledgeBase.status} kind="library" />
                        {knowledgeBase.permissions.upload ? <em>可上传</em> : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <section className="knowledge-documents-pane" aria-label="知识库文档">
            {selectedKnowledgeBase === undefined ? (
              <KnowledgeEmpty
                icon={<FileText size={22} aria-hidden="true" />}
                title="选择知识库"
                detail="选择左侧知识库后查看其中的文档和处理状态。"
              />
            ) : (
              <>
                <header className="knowledge-documents-header">
                  <button
                    className="knowledge-mobile-back"
                    type="button"
                    aria-label="返回知识库列表"
                    onClick={() => setMobileDocumentsOpen(false)}
                  >
                    <ArrowLeft size={17} aria-hidden="true" />
                  </button>
                  <div className="knowledge-documents-heading">
                    <h2>{selectedKnowledgeBase.name}</h2>
                  </div>
                  {selectedKnowledgeBase.permissions.upload ? (
                    <>
                      <input
                        ref={fileInputRef}
                        className="knowledge-file-input"
                        type="file"
                        aria-label="选择知识库文档"
                        accept=".pdf,.docx,.md,.txt,.xlsx,.csv"
                        disabled={uploadInProgress}
                        onChange={handleFileSelection}
                      />
                      <button
                        className="knowledge-upload-button"
                        type="button"
                        disabled={uploadInProgress}
                        onClick={chooseFile}
                      >
                        {uploadInProgress ? (
                          <LoaderCircle
                            className="knowledge-spinner"
                            size={16}
                            aria-hidden="true"
                          />
                        ) : (
                          <Upload size={16} aria-hidden="true" />
                        )}
                        <span>
                          {uploadInProgress ? '上传中' : '上传文档'}
                        </span>
                      </button>
                    </>
                  ) : null}
                </header>

                {fileSelectionError !== undefined ? (
                  <p className="knowledge-banner knowledge-banner--error" role="alert">
                    {fileSelectionError}
                  </p>
                ) : null}
                {props.upload?.error !== undefined ? (
                  <p className="knowledge-banner knowledge-banner--error" role="alert">
                    {props.upload.error}
                  </p>
                ) : null}
                {props.uploadNotice !== undefined ? (
                  <p className="knowledge-banner" role="status">
                    {props.uploadNotice}
                  </p>
                ) : null}
                {props.documentsError !== undefined ? (
                  <p className="knowledge-banner knowledge-banner--error" role="alert">
                    {props.documentsError}
                  </p>
                ) : null}

                <div className="knowledge-document-content">
                  {props.documentsLoading && props.documents === undefined ? (
                    <KnowledgeLoading label="正在加载文档" />
                  ) : (props.documents?.length ?? 0) === 0 ? (
                    <KnowledgeEmpty
                      icon={<FileText size={22} aria-hidden="true" />}
                      title="暂无文档"
                      detail={
                        selectedKnowledgeBase.permissions.upload
                          ? '可以上传首个文档，处理完成后会在此显示状态。'
                          : '该知识库当前没有可显示的文档。'
                      }
                    />
                  ) : (
                    <div className="knowledge-document-table-wrap">
                      <table className="knowledge-document-table">
                        <thead>
                          <tr>
                            <th>文档</th>
                            <th>状态</th>
                            <th>大小</th>
                            <th>更新时间</th>
                          </tr>
                        </thead>
                        <tbody>
                          {props.documents!.map(document => (
                            <tr key={document.documentId}>
                              <td>
                                <strong>{document.name}</strong>
                                {document.errorMessage ? (
                                  <small>{document.errorMessage}</small>
                                ) : null}
                              </td>
                              <td>
                                <KnowledgeStatus
                                  value={document.status}
                                  kind="document"
                                />
                              </td>
                              <td>{formatBytes(document.sizeBytes)}</td>
                              <td>{formatDate(document.updatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
        <section className="knowledge-conversation" hidden={mode !== 'conversation'}>
          <div className="knowledge-conversation__main">
            {props.conversation ?? (
              <KnowledgeEmpty
                icon={<MessageSquareText size={22} aria-hidden="true" />}
                title="对话知识库"
                detail="知识库对话服务正在准备中。"
              />
            )}
          </div>
          <aside className="knowledge-conversation__context" aria-label="对话知识库范围">
            <div className="knowledge-conversation__context-heading">
              <div>
                <strong>知识库</strong>
                <span>{props.knowledgeBases?.length ?? 0} 个可访问项</span>
              </div>
            </div>
            <ul className="knowledge-conversation__library-list">
              {props.knowledgeBases?.map(knowledgeBase => (
                <li key={knowledgeBase.knowledgeBaseId}>
                  <button
                    type="button"
                    aria-current={knowledgeBase.knowledgeBaseId === props.selectedKnowledgeBaseId
                      ? 'page'
                      : undefined}
                    onClick={() => props.onSelectKnowledgeBase(knowledgeBase.knowledgeBaseId)}
                  >
                    <strong>{knowledgeBase.name}</strong>
                    <span>{knowledgeBase.documentCount} 个文档</span>
                  </button>
                </li>
              ))}
            </ul>
            {selectedKnowledgeBase === undefined ? null : (
              <div className="knowledge-conversation__documents">
                <div>
                  <strong>{selectedKnowledgeBase.name}</strong>
                  <span>文档</span>
                </div>
                {props.documentsLoading ? (
                  <span>正在加载...</span>
                ) : (
                  <ul>
                    {props.documents?.map(document => (
                      <li key={document.documentId}>{document.name}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}

function KnowledgeGate(props: {
  icon: ReactNode;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="knowledge-page">
      <div className="knowledge-gate">
        <h1>企业知识库</h1>
        <span aria-hidden="true">{props.icon}</span>
        <h2>{props.title}</h2>
        <p>{props.detail}</p>
        {props.actionLabel !== undefined && props.onAction !== undefined ? (
          <button type="button" onClick={props.onAction}>
            {props.actionLabel}
          </button>
        ) : null}
      </div>
    </main>
  );
}

function KnowledgeLoading(props: { label: string }) {
  return (
    <div className="knowledge-loading" role="status">
      <LoaderCircle className="knowledge-spinner" size={18} aria-hidden="true" />
      <span>{props.label}</span>
    </div>
  );
}

function KnowledgeEmpty(props: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="knowledge-empty">
      <span aria-hidden="true">{props.icon}</span>
      <strong>{props.title}</strong>
      <p>{props.detail}</p>
    </div>
  );
}

function KnowledgeStatus(props: {
  value: string;
  kind: 'library' | 'document';
}) {
  const normalized = props.value.trim().toLowerCase();
  const presentation = statusPresentation(normalized, props.kind);
  return (
    <span
      className="knowledge-status"
      data-tone={presentation.tone}
      title={props.value}
    >
      {presentation.label}
    </span>
  );
}

function statusPresentation(
  value: string,
  kind: 'library' | 'document'
): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  if (kind === 'library') {
    if (value === 'active') return { label: '可用', tone: 'success' };
    if (value === 'inactive' || value === 'disabled') {
      return { label: '不可用', tone: 'neutral' };
    }
    return { label: '状态未知', tone: 'neutral' };
  }
  if (value === 'ready') return { label: '可用', tone: 'success' };
  if (value === 'processing' || value === 'pending') {
    return { label: '处理中', tone: 'warning' };
  }
  if (value === 'failed' || value === 'error') {
    return { label: '处理失败', tone: 'danger' };
  }
  return { label: '状态未知', tone: 'neutral' };
}

function validateFile(file: File): string | undefined {
  const dotIndex = file.name.lastIndexOf('.');
  const extension =
    dotIndex < 0 ? '' : file.name.slice(dotIndex).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return '仅支持 PDF、DOCX、Markdown、TXT、XLSX 和 CSV 文件。';
  }
  if (file.size <= 0) return '不能上传空文件。';
  if (file.size > MAX_DOCUMENT_BYTES) {
    return '单个文档不能超过 50 MiB。';
  }
  return undefined;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp);
}
