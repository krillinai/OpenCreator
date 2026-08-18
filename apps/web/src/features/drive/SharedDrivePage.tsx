import type {
  EnterpriseSharedFileResponse,
  EnterpriseSharedSpaceResponse
} from '@clawee/protocol';
import {
  Download,
  File,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Image,
  LoaderCircle,
  Music2,
  RefreshCw,
  Replace,
  Search,
  Upload,
  Video,
  WifiOff
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode
} from 'react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import './shared-drive.css';

export type SharedDriveOperationState = {
  kind: 'download' | 'upload' | 'replace';
  fileId?: string;
  fileName: string;
  status: 'working' | 'failed' | 'requires_overwrite';
  error?: string;
};

export type SharedDrivePageProps = {
  connected: boolean;
  spaces?: EnterpriseSharedSpaceResponse[];
  spacesLoading: boolean;
  spacesError?: string;
  spacesHasNext: boolean;
  selectedSpaceId?: string;
  files?: EnterpriseSharedFileResponse[];
  filesLoading: boolean;
  filesError?: string;
  filesHasNext: boolean;
  query: string;
  maxFileSizeBytes: number;
  currentProjectId?: string;
  currentProjectName: string;
  operation?: SharedDriveOperationState;
  notice?: string;
  onRefresh(): void;
  onLoadMoreSpaces(): void;
  onSelectSpace(spaceId?: string): void;
  onSearch(query: string): void;
  onLoadMoreFiles(): void;
  onUpload(spaceId: string, file: File): void;
  onReplace(target: EnterpriseSharedFileResponse, file: File): void;
  onDownload(target: EnterpriseSharedFileResponse, overwrite: boolean): void;
};

export function SharedDrivePage(props: SharedDrivePageProps) {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const replacementTargetRef = useRef<EnterpriseSharedFileResponse>();
  const [searchValue, setSearchValue] = useState(props.query);
  const [selectionError, setSelectionError] = useState<string>();
  const selectedSpace = props.spaces?.find(
    space => space.spaceId === props.selectedSpaceId
  );
  const operationWorking = props.operation?.status === 'working';
  const fileCount = props.files?.length ?? 0;
  const spaceCount = props.spaces?.length ?? 0;

  useEffect(() => {
    setSearchValue(props.query);
  }, [props.query]);

  useEffect(() => {
    setSelectionError(undefined);
    replacementTargetRef.current = undefined;
  }, [props.selectedSpaceId]);

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    props.onSearch(searchValue.trim());
  }

  function chooseUpload() {
    setSelectionError(undefined);
    uploadInputRef.current?.click();
  }

  function chooseReplacement(target: EnterpriseSharedFileResponse) {
    setSelectionError(undefined);
    replacementTargetRef.current = target;
    replaceInputRef.current?.click();
  }

  function handleUploadSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file === undefined || selectedSpace === undefined) return;
    const error = validateFile(file, props.maxFileSizeBytes, l);
    if (error !== undefined) {
      setSelectionError(error);
      return;
    }
    props.onUpload(selectedSpace.spaceId, file);
  }

  function handleReplacementSelection(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    const target = replacementTargetRef.current;
    replacementTargetRef.current = undefined;
    if (file === undefined || target === undefined) return;
    const error = validateFile(file, props.maxFileSizeBytes, l);
    if (error !== undefined) {
      setSelectionError(error);
      return;
    }
    props.onReplace(target, file);
  }

  if (!props.connected) {
    return (
      <DriveGate
        heading={l('素材中心', 'Media Library')}
        icon={<WifiOff size={22} aria-hidden="true" />}
        title={l('正在等待本地 Runtime', 'Waiting for the local runtime')}
        detail={l('素材中心暂不可用，本地项目仍可继续使用。', 'The media library is temporarily unavailable. You can keep working in local projects.')}
      />
    );
  }

  return (
    <main className="shared-drive-page">
      <div className="shared-drive-page__inner">
        <header className="shared-drive-header">
          <div className="shared-drive-header__copy">
            <h1>{l('素材中心', 'Media Library')}</h1>
            <p>{l('集中管理视频、图片、音频和创作文件', 'Manage videos, images, audio, and creative files in one place')}</p>
          </div>
          <div className="shared-drive-header__actions">
            <div className="shared-drive-summary" aria-label={l('素材概览', 'Media overview')}>
              <span><strong>{fileCount}</strong> {l('个素材', 'assets')}</span>
              <span><strong>{spaceCount}</strong> {l('个分类', 'categories')}</span>
            </div>
            <span className="shared-drive-project" title={props.currentProjectName}>
              {l('保存到', 'Save to')} {props.currentProjectName}
            </span>
            <button
              className="shared-drive-icon-button"
              type="button"
              aria-label={l('刷新素材中心', 'Refresh media library')}
              title={l('刷新', 'Refresh')}
              onClick={props.onRefresh}
            >
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        {props.spacesError !== undefined ? (
          <p className="shared-drive-banner shared-drive-banner--error" role="alert">
            {props.spacesError}
          </p>
        ) : null}

        <div className="shared-drive-workbench">
          <nav className="shared-drive-spaces" aria-label={l('素材分类', 'Media categories')}>
            <div className="shared-drive-pane-heading">
              <div>
                <h2>{l('素材分类', 'Media categories')}</h2>
                <span>{spaceCount} {l('个分类', 'categories')}</span>
              </div>
            </div>

            {props.spacesLoading && props.spaces === undefined ? (
              <DriveLoading label={l('正在加载素材分类', 'Loading media categories')} />
            ) : (
              <>
                <ul className="shared-drive-space-list">
                  <li>
                    <button
                      type="button"
                      aria-current={
                        props.selectedSpaceId === undefined ? 'page' : undefined
                      }
                      onClick={() => props.onSelectSpace(undefined)}
                    >
                      <span className="shared-drive-space-list__icon" aria-hidden="true">
                        <FolderOpen size={17} />
                      </span>
                      <span className="shared-drive-space-list__body">
                        <strong>{l('全部素材', 'All assets')}</strong>
                        <span>{l('查看所有分类中的文件', 'View files across all categories')}</span>
                      </span>
                    </button>
                  </li>
                  {props.spaces?.map(space => (
                    <li key={space.spaceId}>
                      <button
                        type="button"
                        aria-current={
                          props.selectedSpaceId === space.spaceId
                            ? 'page'
                            : undefined
                        }
                        onClick={() => props.onSelectSpace(space.spaceId)}
                      >
                        <span className="shared-drive-space-list__icon" aria-hidden="true">
                          <Folder size={17} />
                        </span>
                        <span className="shared-drive-space-list__body">
                          <strong>{space.name}</strong>
                          <span>{space.description || l('暂未添加说明', 'No description')}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
                {props.spacesHasNext ? (
                  <button
                    className="shared-drive-load-more"
                    type="button"
                    disabled={props.spacesLoading}
                    onClick={props.onLoadMoreSpaces}
                  >
                    {props.spacesLoading ? l('加载中', 'Loading') : l('加载更多分类', 'Load more categories')}
                  </button>
                ) : null}
              </>
            )}
          </nav>

          <section className="shared-drive-files" aria-label={l('素材文件', 'Media files')}>
            <header className="shared-drive-files-header">
              <div>
                <h2>{selectedSpace?.name ?? l('全部素材', 'All assets')}</h2>
                <p>
                  {selectedSpace?.description || l('浏览所有分类中的创作文件', 'Browse creative files across all categories')}
                </p>
              </div>
              <div className="shared-drive-files-actions">
                <form role="search" onSubmit={submitSearch}>
                  <Search size={15} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label={l('搜索素材文件', 'Search media files')}
                    placeholder={l('搜索文件名或路径', 'Search by file name or path')}
                    maxLength={200}
                    value={searchValue}
                    onChange={event => setSearchValue(event.target.value)}
                  />
                </form>
                {selectedSpace?.permissions.write ? (
                  <>
                    <input
                      ref={uploadInputRef}
                      className="shared-drive-file-input"
                      type="file"
                      aria-label={l('选择上传到素材中心的文件', 'Choose a file to upload to the media library')}
                      disabled={operationWorking}
                      onChange={handleUploadSelection}
                    />
                    <button
                      className="shared-drive-primary-button"
                      type="button"
                      disabled={operationWorking}
                      onClick={chooseUpload}
                    >
                      <Upload size={15} aria-hidden="true" />
                      <span>{operationWorking ? l('处理中', 'Processing') : l('上传文件', 'Upload file')}</span>
                    </button>
                  </>
                ) : null}
                <input
                  ref={replaceInputRef}
                  className="shared-drive-file-input"
                  type="file"
                  aria-label={l('选择替换素材文件的本地文件', 'Choose a local replacement file')}
                  disabled={operationWorking}
                  onChange={handleReplacementSelection}
                />
              </div>
            </header>

            {selectionError !== undefined ? (
              <p className="shared-drive-banner shared-drive-banner--error" role="alert">
                {selectionError}
              </p>
            ) : null}
            {props.operation?.error !== undefined ? (
              <p className="shared-drive-banner shared-drive-banner--error" role="alert">
                {props.operation.error}
              </p>
            ) : null}
            {props.notice !== undefined ? (
              <p className="shared-drive-banner" role="status">
                {props.notice}
              </p>
            ) : null}
            {props.filesError !== undefined ? (
              <p className="shared-drive-banner shared-drive-banner--error" role="alert">
                {props.filesError}
              </p>
            ) : null}

            <div className="shared-drive-file-content">
              {props.filesLoading && props.files === undefined ? (
                <DriveLoading label={l('正在加载素材文件', 'Loading media files')} />
              ) : (props.files?.length ?? 0) === 0 ? (
                <DriveEmpty
                  icon={<FolderOpen size={22} aria-hidden="true" />}
                  title={l('暂无素材文件', 'No media files')}
                  detail={
                    props.query.length > 0
                      ? l('当前查询没有匹配文件。', 'No files match this search.')
                      : selectedSpace?.permissions.write
                        ? l('可以上传首个文件到当前分类。', 'Upload the first file to this category.')
                        : l('当前范围没有可显示的文件。', 'There are no files to display here.')
                  }
                />
              ) : (
                <>
                  <ul className="shared-drive-file-grid" aria-label={l('素材列表', 'Media list')}>
                    {props.files!.map(file => {
                      const busy =
                        operationWorking
                        && props.operation?.fileId === file.fileId;
                      const requiresOverwrite =
                        props.operation?.status === 'requires_overwrite'
                        && props.operation.fileId === file.fileId;
                      const space = props.spaces?.find(
                        item => item.spaceId === file.spaceId
                      );
                      return (
                        <li className="shared-drive-file-card" key={file.fileId}>
                          <div
                            className="shared-drive-file-preview"
                            data-kind={fileKind(file.contentType)}
                          >
                            <FileTypeIcon contentType={file.contentType} />
                            <span>{fileTypeLabel(file.contentType, file.fileName, l)}</span>
                          </div>
                          <div className="shared-drive-file-card__body">
                            <span className="shared-drive-file-name">
                              <FileTypeIcon contentType={file.contentType} />
                              <span>
                                <strong>{file.fileName}</strong>
                                <small>{file.logicalPath}</small>
                              </span>
                            </span>
                            <dl className="shared-drive-file-meta">
                              <div>
                                <dt>{l('分类', 'Category')}</dt>
                                <dd>{file.spaceName || file.spaceId}</dd>
                              </div>
                              <div>
                                <dt>{l('版本', 'Version')}</dt>
                                <dd>{file.revision}</dd>
                              </div>
                              <div>
                                <dt>{l('大小', 'Size')}</dt>
                                <dd>{formatBytes(file.sizeBytes)}</dd>
                              </div>
                            </dl>
                            <footer className="shared-drive-file-card__footer">
                              <time dateTime={file.updatedAt}>
                                {formatDate(file.updatedAt, language)}
                              </time>
                              <span className="shared-drive-row-actions">
                                {space?.permissions.write ? (
                                  <button
                                    type="button"
                                    aria-label={`${l('替换', 'Replace')} ${file.fileName}`}
                                    title={l('替换内容', 'Replace file')}
                                    disabled={operationWorking}
                                    onClick={() => chooseReplacement(file)}
                                  >
                                    <Replace size={14} aria-hidden="true" />
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  aria-label={
                                    requiresOverwrite
                                      ? `${l('覆盖保存', 'Overwrite')} ${file.fileName}`
                                      : `${l('保存', 'Save')} ${file.fileName} ${l('到当前项目', 'to the current project')}`
                                  }
                                  title={
                                    requiresOverwrite
                                      ? l('确认覆盖项目内文件', 'Confirm overwrite in project')
                                      : l('保存到当前项目', 'Save to current project')
                                  }
                                  disabled={
                                    props.currentProjectId === undefined
                                    || (operationWorking && !busy)
                                  }
                                  onClick={() => props.onDownload(
                                    file,
                                    requiresOverwrite
                                  )}
                                >
                                  {busy ? (
                                    <LoaderCircle
                                      className="shared-drive-spinner"
                                      size={14}
                                      aria-hidden="true"
                                    />
                                  ) : requiresOverwrite ? (
                                    <Replace size={14} aria-hidden="true" />
                                  ) : (
                                    <Download size={14} aria-hidden="true" />
                                  )}
                                </button>
                              </span>
                            </footer>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {props.filesHasNext ? (
                    <button
                      className="shared-drive-load-more shared-drive-load-more--files"
                      type="button"
                      disabled={props.filesLoading}
                      onClick={props.onLoadMoreFiles}
                    >
                      {props.filesLoading ? l('加载中', 'Loading') : l('加载更多文件', 'Load more files')}
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function DriveGate(props: {
  heading: string;
  icon: ReactNode;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="shared-drive-page">
      <div className="shared-drive-gate">
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

function DriveLoading(props: { label: string }) {
  return (
    <div className="shared-drive-loading" role="status">
      <LoaderCircle className="shared-drive-spinner" size={18} aria-hidden="true" />
      <span>{props.label}</span>
    </div>
  );
}

function DriveEmpty(props: {
  icon: ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <div className="shared-drive-empty">
      <span aria-hidden="true">{props.icon}</span>
      <strong>{props.title}</strong>
      <p>{props.detail}</p>
    </div>
  );
}

function FileTypeIcon(props: { contentType: string }) {
  const normalized = props.contentType.toLowerCase();
  if (normalized.includes('spreadsheet') || normalized.includes('excel')) {
    return <FileSpreadsheet size={17} aria-hidden="true" />;
  }
  if (normalized.startsWith('image/')) {
    return <Image size={17} aria-hidden="true" />;
  }
  if (normalized.startsWith('video/')) {
    return <Video size={17} aria-hidden="true" />;
  }
  if (normalized.startsWith('audio/')) {
    return <Music2 size={17} aria-hidden="true" />;
  }
  if (normalized.startsWith('text/') || normalized.includes('pdf')) {
    return <FileText size={17} aria-hidden="true" />;
  }
  return <File size={17} aria-hidden="true" />;
}

function fileKind(
  contentType: string
): 'image' | 'video' | 'audio' | 'document' | 'sheet' | 'file' {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith('image/')) return 'image';
  if (normalized.startsWith('video/')) return 'video';
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.includes('spreadsheet') || normalized.includes('excel')) return 'sheet';
  if (normalized.startsWith('text/') || normalized.includes('pdf')) return 'document';
  return 'file';
}

function fileTypeLabel(contentType: string, fileName: string, l: LocalizeCopy): string {
  const normalized = contentType.toLowerCase();
  if (normalized.startsWith('image/')) return l('图片', 'Image');
  if (normalized.startsWith('video/')) return l('视频', 'Video');
  if (normalized.startsWith('audio/')) return l('音频', 'Audio');
  if (normalized.includes('spreadsheet') || normalized.includes('excel')) return l('表格', 'Spreadsheet');
  if (normalized.includes('pdf')) return 'PDF';
  const dotIndex = fileName.lastIndexOf('.');
  return dotIndex < 0 ? l('文件', 'File') : fileName.slice(dotIndex + 1).toUpperCase();
}

function validateFile(file: File, maximum: number, l: LocalizeCopy): string | undefined {
  if (file.size > maximum) {
    return l(`单个文件不能超过 ${formatBytes(maximum)}。`, `A file cannot exceed ${formatBytes(maximum)}.`);
  }
  return undefined;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 * 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MiB`;
  }
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
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
