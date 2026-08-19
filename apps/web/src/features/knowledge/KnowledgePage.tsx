import type {
  EnterpriseKnowledgeBaseResponse,
  EnterpriseKnowledgeDocumentResponse
} from '@opencreator/protocol';
import {
  ArrowLeft,
  BookOpenText,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  LoaderCircle,
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
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
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
  knowledgeBases?: EnterpriseKnowledgeBaseResponse[];
  knowledgeBasesLoading: boolean;
  knowledgeBasesError?: string;
  selectedKnowledgeBaseId?: string;
  documents?: EnterpriseKnowledgeDocumentResponse[];
  documentsLoading: boolean;
  documentsError?: string;
  upload?: KnowledgeUploadState;
  uploadNotice?: string;
  onRefresh(): void;
  onSelectKnowledgeBase(knowledgeBaseId: string): void;
  onUpload(file: File): void;
};

export function KnowledgePage(props: KnowledgePageProps) {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [mobileDocumentsOpen, setMobileDocumentsOpen] = useState(false);
  const [fileSelectionError, setFileSelectionError] = useState<string>();
  const selectedKnowledgeBase = props.knowledgeBases?.find(
    item => item.knowledgeBaseId === props.selectedKnowledgeBaseId
  );
  const uploadInProgress = props.upload?.status === 'uploading';
  const knowledgeBaseCount = props.knowledgeBases?.length ?? 0;
  const documentCount = props.knowledgeBases?.reduce(
    (total, item) => total + item.documentCount,
    0
  ) ?? 0;

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
    const error = validateFile(file, l);
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
        heading={l('知识库', 'Knowledge')}
        icon={<WifiOff size={22} aria-hidden="true" />}
        title={l('正在等待本地 Runtime', 'Waiting for the local runtime')}
        detail={l('知识库暂不可用，本地工作区仍可继续使用。', 'Knowledge is temporarily unavailable. You can keep working in local projects.')}
      />
    );
  }

  return (
    <main className="knowledge-page">
      <div className="knowledge-page__inner">
        <header className="knowledge-header">
          <div className="knowledge-header__copy">
            <h1>{l('知识库', 'Knowledge')}</h1>
            <p>{l('整理脚本、参考资料和创作知识', 'Organize scripts, references, and creative knowledge')}</p>
          </div>
          <div className="knowledge-header__actions">
            <div className="knowledge-summary" aria-label={l('知识库概览', 'Knowledge overview')}>
              <span><strong>{knowledgeBaseCount}</strong> {l('个资料集合', 'collections')}</span>
              <span><strong>{documentCount}</strong> {l('份文档', 'documents')}</span>
            </div>
            <button
              className="knowledge-icon-button"
              type="button"
              aria-label={l('刷新知识库', 'Refresh knowledge')}
              title={l('刷新', 'Refresh')}
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
          className="knowledge-dashboard"
          data-mobile-documents-open={mobileDocumentsOpen}
        >
          <nav className="knowledge-library-pane" aria-label={l('资料集合', 'Collections')}>
            <div className="knowledge-pane-heading">
              <div>
                <h2>{l('资料集合', 'Collections')}</h2>
                <span>{knowledgeBaseCount} {l('个集合', 'collections')}</span>
              </div>
            </div>

            {props.knowledgeBasesLoading && props.knowledgeBases === undefined ? (
              <KnowledgeLoading label={l('正在加载知识库', 'Loading knowledge')} />
            ) : (props.knowledgeBases?.length ?? 0) === 0 ? (
              <KnowledgeEmpty
                icon={<Folder size={22} aria-hidden="true" />}
                title={l('还没有资料集合', 'No collections yet')}
                detail={l('添加资料后，集合会显示在这里。', 'Collections will appear here after you add source material.')}
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
                      <span className="knowledge-library-list__icon" aria-hidden="true">
                        <BookOpenText size={17} />
                      </span>
                      <span className="knowledge-library-list__body">
                        <span className="knowledge-library-list__title">
                          <strong>{knowledgeBase.name}</strong>
                          <small>{knowledgeBase.documentCount} {l('份', 'items')}</small>
                        </span>
                        <span className="knowledge-library-list__description">
                          {knowledgeBase.description || l('暂未添加说明', 'No description')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <section className="knowledge-documents-pane" aria-label={l('知识库文档', 'Knowledge documents')}>
            {selectedKnowledgeBase === undefined ? (
              <KnowledgeEmpty
                icon={<FileText size={22} aria-hidden="true" />}
                title={l('选择资料集合', 'Select a collection')}
                detail={l('选择左侧集合后查看其中的文档和处理状态。', 'Select a collection to view its documents and processing status.')}
              />
            ) : (
              <>
                <header className="knowledge-documents-header">
                  <button
                    className="knowledge-mobile-back"
                    type="button"
                    aria-label={l('返回知识库列表', 'Back to collections')}
                    onClick={() => setMobileDocumentsOpen(false)}
                  >
                    <ArrowLeft size={17} aria-hidden="true" />
                  </button>
                  <div className="knowledge-documents-heading">
                    <h2>{selectedKnowledgeBase.name}</h2>
                    <p>{selectedKnowledgeBase.documentCount} {l('份资料', 'documents')}</p>
                  </div>
                  {selectedKnowledgeBase.permissions.upload ? (
                    <>
                      <input
                        ref={fileInputRef}
                        className="knowledge-file-input"
                        type="file"
                        aria-label={l('选择知识库文档', 'Choose a knowledge document')}
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
                          {uploadInProgress ? l('上传中', 'Uploading') : l('上传文档', 'Upload document')}
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
                    <KnowledgeLoading label={l('正在加载文档', 'Loading documents')} />
                  ) : (props.documents?.length ?? 0) === 0 ? (
                    <KnowledgeEmpty
                      icon={<FileText size={22} aria-hidden="true" />}
                      title={l('暂无文档', 'No documents')}
                      detail={
                        selectedKnowledgeBase.permissions.upload
                          ? l('可以上传首个文档，处理完成后会在此显示状态。', 'Upload the first document. Its status will appear here after processing.')
                          : l('该知识库当前没有可显示的文档。', 'There are no documents to display in this collection.')
                      }
                    />
                  ) : (
                    <ul className="knowledge-document-list" aria-label={l('文档列表', 'Document list')}>
                      {props.documents!.map(document => (
                        <li key={document.documentId}>
                          <span className="knowledge-document-list__icon" aria-hidden="true">
                            <KnowledgeFileIcon
                              name={document.name}
                              mimeType={document.mimeType}
                            />
                          </span>
                          <span className="knowledge-document-list__main">
                            <strong>{document.name}</strong>
                            {document.errorMessage ? (
                              <small data-error="true">{document.errorMessage}</small>
                            ) : (
                              <small>{fileTypeLabel(document.name, l)}</small>
                            )}
                          </span>
                          <span className="knowledge-document-list__status">
                            <KnowledgeStatus
                              value={document.status}
                              kind="document"
                              localize={l}
                            />
                          </span>
                          <span className="knowledge-document-list__size">
                            {formatBytes(document.sizeBytes)}
                          </span>
                          <time
                            className="knowledge-document-list__date"
                            dateTime={document.updatedAt}
                          >
                            {formatDate(document.updatedAt, language)}
                          </time>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function KnowledgeGate(props: {
  heading: string;
  icon: ReactNode;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="knowledge-page">
      <div className="knowledge-gate">
        <h1>{props.heading}</h1>
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
  localize: LocalizeCopy;
}) {
  const normalized = props.value.trim().toLowerCase();
  const presentation = statusPresentation(normalized, props.kind, props.localize);
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

function KnowledgeFileIcon(props: { name: string; mimeType: string }) {
  const extension = fileExtension(props.name);
  const mimeType = props.mimeType.toLowerCase();
  if (extension === 'csv' || extension === 'xlsx' || mimeType.includes('spreadsheet')) {
    return <FileSpreadsheet size={19} />;
  }
  if (['docx', 'md', 'pdf', 'txt'].includes(extension)) {
    return <FileText size={19} />;
  }
  return <File size={19} />;
}

function fileExtension(name: string): string {
  const dotIndex = name.lastIndexOf('.');
  return dotIndex < 0 ? '' : name.slice(dotIndex + 1).toLowerCase();
}

function fileTypeLabel(name: string, l: LocalizeCopy): string {
  const extension = fileExtension(name);
  return extension.length > 0
    ? `${extension.toUpperCase()} ${l('文档', 'document')}`
    : l('文档', 'Document');
}

function statusPresentation(
  value: string,
  kind: 'library' | 'document',
  l: LocalizeCopy
): { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' } {
  if (kind === 'library') {
    if (value === 'active') return { label: l('可用', 'Available'), tone: 'success' };
    if (value === 'inactive' || value === 'disabled') {
      return { label: l('不可用', 'Unavailable'), tone: 'neutral' };
    }
    return { label: l('状态未知', 'Unknown status'), tone: 'neutral' };
  }
  if (value === 'ready') return { label: l('可用', 'Available'), tone: 'success' };
  if (value === 'processing' || value === 'pending') {
    return { label: l('处理中', 'Processing'), tone: 'warning' };
  }
  if (value === 'failed' || value === 'error') {
    return { label: l('处理失败', 'Processing failed'), tone: 'danger' };
  }
  return { label: l('状态未知', 'Unknown status'), tone: 'neutral' };
}

function validateFile(file: File, l: LocalizeCopy): string | undefined {
  const dotIndex = file.name.lastIndexOf('.');
  const extension =
    dotIndex < 0 ? '' : file.name.slice(dotIndex).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return l('仅支持 PDF、DOCX、Markdown、TXT、XLSX 和 CSV 文件。', 'Only PDF, DOCX, Markdown, TXT, XLSX, and CSV files are supported.');
  }
  if (file.size <= 0) return l('不能上传空文件。', 'Empty files cannot be uploaded.');
  if (file.size > MAX_DOCUMENT_BYTES) {
    return l('单个文档不能超过 50 MiB。', 'A document cannot exceed 50 MiB.');
  }
  return undefined;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
}

function formatDate(value: string, language: 'zh-CN' | 'en-US'): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return language === 'en-US' ? 'Unknown time' : '时间未知';
  return new Intl.DateTimeFormat(language, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(timestamp);
}
