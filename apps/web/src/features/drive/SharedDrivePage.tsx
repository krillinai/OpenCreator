import type {
  EnterpriseSessionResponse,
  EnterpriseSharedFileResponse,
  EnterpriseSharedSpaceResponse
} from '@clawee/protocol';
import {
  Download,
  File,
  FileSpreadsheet,
  FileText,
  FolderOpen,
  Image,
  LoaderCircle,
  LogIn,
  RefreshCw,
  Replace,
  Search,
  Upload,
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
  session: EnterpriseSessionResponse;
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
  onOpenAccount(): void;
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
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const replacementTargetRef = useRef<EnterpriseSharedFileResponse>();
  const [searchValue, setSearchValue] = useState(props.query);
  const [selectionError, setSelectionError] = useState<string>();
  const selectedSpace = props.spaces?.find(
    space => space.spaceId === props.selectedSpaceId
  );
  const operationWorking = props.operation?.status === 'working';

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
    const error = validateFile(file, props.maxFileSizeBytes);
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
    const error = validateFile(file, props.maxFileSizeBytes);
    if (error !== undefined) {
      setSelectionError(error);
      return;
    }
    props.onReplace(target, file);
  }

  if (!props.connected) {
    return (
      <DriveGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title="正在等待本地 Runtime"
        detail="共享网盘暂不可用，本地项目仍可继续使用。"
      />
    );
  }

  if (props.session.status === 'checking') {
    return (
      <DriveGate
        icon={<LoaderCircle className="shared-drive-spinner" size={22} aria-hidden="true" />}
        title="正在验证企业会话"
        detail="验证完成后会自动加载当前账户可访问的共享空间。"
      />
    );
  }

  if (props.session.status === 'service_unavailable') {
    return (
      <DriveGate
        icon={<WifiOff size={22} aria-hidden="true" />}
        title="企业文件服务暂时不可用"
        detail="服务恢复后可重新加载，不影响本地项目和任务。"
        actionLabel="重新加载"
        onAction={props.onRefresh}
      />
    );
  }

  if (props.session.status !== 'signed_in') {
    return (
      <DriveGate
        icon={<LogIn size={22} aria-hidden="true" />}
        title="登录后访问共享网盘"
        detail="共享空间和文件范围由当前企业账户权限决定。"
        actionLabel="登录企业账户"
        onAction={props.onOpenAccount}
      />
    );
  }

  return (
    <main className="shared-drive-page">
      <div className="shared-drive-page__inner">
        <header className="shared-drive-header">
          <div>
            <h1>共享网盘</h1>
            <p>查看授权空间，并将远端文件保存到当前项目</p>
          </div>
          <div className="shared-drive-header__actions">
            <span className="shared-drive-project">
              当前项目：{props.currentProjectName}
            </span>
            <button
              className="shared-drive-icon-button"
              type="button"
              aria-label="刷新共享网盘"
              title="刷新"
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
          <nav className="shared-drive-spaces" aria-label="授权共享空间">
            <div className="shared-drive-pane-heading">
              <div>
                <h2>共享空间</h2>
                <span>{props.spaces?.length ?? 0} 个已加载</span>
              </div>
            </div>

            {props.spacesLoading && props.spaces === undefined ? (
              <DriveLoading label="正在加载共享空间" />
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
                      <strong>全部文件</strong>
                      <span>跨全部授权空间查询</span>
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
                        <strong>{space.name}</strong>
                        <span>{space.description || '暂无说明'}</span>
                        {space.permissions.write ? <em>可写</em> : null}
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
                    {props.spacesLoading ? '加载中' : '加载更多空间'}
                  </button>
                ) : null}
              </>
            )}
          </nav>

          <section className="shared-drive-files" aria-label="共享文件">
            <header className="shared-drive-files-header">
              <div>
                <h2>{selectedSpace?.name ?? '全部文件'}</h2>
                <p>
                  {selectedSpace?.description || '跨当前账户的全部授权空间查询'}
                </p>
              </div>
              <div className="shared-drive-files-actions">
                <form role="search" onSubmit={submitSearch}>
                  <Search size={15} aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="搜索共享文件"
                    placeholder="搜索文件名或文件 ID"
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
                      aria-label="选择上传到共享网盘的文件"
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
                      <span>{operationWorking ? '处理中' : '上传文件'}</span>
                    </button>
                  </>
                ) : null}
                <input
                  ref={replaceInputRef}
                  className="shared-drive-file-input"
                  type="file"
                  aria-label="选择替换共享文件的本地文件"
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
                <DriveLoading label="正在加载共享文件" />
              ) : (props.files?.length ?? 0) === 0 ? (
                <DriveEmpty
                  icon={<FolderOpen size={22} aria-hidden="true" />}
                  title="暂无共享文件"
                  detail={
                    props.query.length > 0
                      ? '当前查询没有匹配文件。'
                      : selectedSpace?.permissions.write
                        ? '可以上传首个文件到当前空间。'
                        : '当前范围没有可显示的文件。'
                  }
                />
              ) : (
                <>
                  <div className="shared-drive-table-wrap">
                    <table className="shared-drive-table">
                      <thead>
                        <tr>
                          <th>文件</th>
                          <th>空间</th>
                          <th>更新者</th>
                          <th>更新时间</th>
                          <th>大小</th>
                          <th className="shared-drive-actions-cell" aria-label="操作" />
                        </tr>
                      </thead>
                      <tbody>
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
                            <tr key={file.fileId}>
                              <td className="shared-drive-actions-cell">
                                <span className="shared-drive-file-name">
                                  <FileTypeIcon contentType={file.contentType} />
                                  <span>
                                    <strong>{file.fileName}</strong>
                                    <small>{file.logicalPath} · revision {file.revision}</small>
                                  </span>
                                </span>
                              </td>
                              <td>{file.spaceName || file.spaceId}</td>
                              <td>
                                {file.updatedByUserId || file.updatedByAgentId || '未知'}
                              </td>
                              <td>{formatDate(file.updatedAt)}</td>
                              <td>{formatBytes(file.sizeBytes)}</td>
                              <td>
                                <span className="shared-drive-row-actions">
                                  {space?.permissions.write ? (
                                    <button
                                      type="button"
                                      aria-label={`替换 ${file.fileName}`}
                                      title="替换内容"
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
                                        ? `覆盖保存 ${file.fileName}`
                                        : `保存 ${file.fileName} 到当前项目`
                                    }
                                    title={
                                      requiresOverwrite
                                        ? '确认覆盖项目内文件'
                                        : '保存到当前项目'
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
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {props.filesHasNext ? (
                    <button
                      className="shared-drive-load-more shared-drive-load-more--files"
                      type="button"
                      disabled={props.filesLoading}
                      onClick={props.onLoadMoreFiles}
                    >
                      {props.filesLoading ? '加载中' : '加载更多文件'}
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
  icon: ReactNode;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <main className="shared-drive-page">
      <div className="shared-drive-gate">
        <h1>共享网盘</h1>
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
  if (normalized.startsWith('text/') || normalized.includes('pdf')) {
    return <FileText size={17} aria-hidden="true" />;
  }
  return <File size={17} aria-hidden="true" />;
}

function validateFile(file: File, maximum: number): string | undefined {
  if (file.size > maximum) {
    return `单个文件不能超过 ${formatBytes(maximum)}。`;
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
