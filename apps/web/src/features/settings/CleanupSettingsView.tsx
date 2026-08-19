import type {
  CleanupDeleteRequest,
  CleanupDeleteResponse,
  CleanupPreviewItem,
  CleanupPreviewResponse
} from '@opencreator/protocol';
import { AlertTriangle, CheckCircle2, RefreshCw, Trash2 } from 'lucide-react';
import { useState } from 'react';

export type CleanupSettingsService = {
  previewCleanup(olderThanDays: number): Promise<CleanupPreviewResponse>;
  deleteCleanup(input: CleanupDeleteRequest): Promise<CleanupDeleteResponse>;
};

export type CleanupSettingsViewProps = {
  connected: boolean;
  service: CleanupSettingsService | null;
};

type CleanupPhase = 'idle' | 'previewing' | 'deleting';

export function CleanupSettingsView(props: CleanupSettingsViewProps) {
  const [olderThanDays, setOlderThanDays] = useState(30);
  const [preview, setPreview] = useState<CleanupPreviewResponse>();
  const [result, setResult] = useState<CleanupDeleteResponse>();
  const [phase, setPhase] = useState<CleanupPhase>('idle');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();

  const available = props.connected && props.service !== null;
  const candidateCount = preview?.items.length ?? 0;

  async function loadPreview() {
    if (!available || phase !== 'idle') return;
    if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
      setError('保留天数必须是正整数');
      return;
    }

    setPhase('previewing');
    setError(undefined);
    setResult(undefined);
    setConfirming(false);
    try {
      setPreview(await props.service!.previewCleanup(olderThanDays));
    } catch (reason) {
      setPreview(undefined);
      setError(formatError(reason, '无法检查可清理内容'));
    } finally {
      setPhase('idle');
    }
  }

  async function deleteCandidates() {
    if (!available || preview === undefined || phase !== 'idle') return;
    setPhase('deleting');
    setError(undefined);
    try {
      setResult(await props.service!.deleteCleanup({
        olderThanDays: preview.olderThanDays,
        confirm: true
      }));
      setConfirming(false);
    } catch (reason) {
      setError(formatError(reason, '清理失败'));
    } finally {
      setPhase('idle');
    }
  }

  return (
    <section className="settings-section settings-management cleanup-settings" aria-labelledby="settings-cleanup-title">
      <header className="settings-management__header">
        <div>
          <h1 id="settings-cleanup-title">运行数据清理</h1>
          <p>先检查候选内容，再确认删除旧 Run 日志和已归档托管工作区。</p>
        </div>
      </header>

      {!props.connected ? (
        <p className="settings-notice">本地服务未连接，无法检查可清理内容。</p>
      ) : null}
      {props.connected && props.service === null ? (
        <p className="settings-notice">清理服务当前不可用。</p>
      ) : null}
      {error ? <p className="settings-error" role="alert">{error}</p> : null}

      <section className="cleanup-controls" aria-label="清理范围">
        <label>
          <span>保留最近</span>
          <span className="cleanup-retention-input">
            <input
              type="number"
              min="1"
              step="1"
              aria-label="保留天数"
              value={olderThanDays}
              disabled={!available || phase !== 'idle'}
              onChange={(event) => setOlderThanDays(Number(event.target.value))}
            />
            <span>天</span>
          </span>
        </label>
        <button
          className="settings-primary-button"
          type="button"
          disabled={!available || phase !== 'idle'}
          onClick={() => void loadPreview()}
        >
          <RefreshCw className={phase === 'previewing' ? 'settings-spin' : undefined} aria-hidden="true" size={15} />
          {phase === 'previewing' ? '正在检查' : '检查可清理内容'}
        </button>
      </section>

      <section className="cleanup-rules" aria-labelledby="cleanup-rules-title">
        <h2 id="cleanup-rules-title">保留规则</h2>
        <ul>
          <li>运行中、排队中和正在取消的任务不会被清理。</li>
          <li>只清理已归档的托管工作区，活动工作区和外部目录保持不变。</li>
          <li>数据库中的 Run 和会话记录会保留，用于继续查看状态。</li>
        </ul>
      </section>

      {preview ? (
        <section className="cleanup-preview" aria-labelledby="cleanup-preview-title">
          <div className="cleanup-summary">
            <div>
              <h2 id="cleanup-preview-title">清理预览</h2>
              <p>{candidateCount} 项 · {formatBytes(preview.totalSizeBytes)}</p>
            </div>
            {candidateCount > 0 && result === undefined ? (
              <button
                className="settings-secondary-button cleanup-delete-button"
                type="button"
                disabled={phase !== 'idle'}
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden="true" size={15} />
                删除 {candidateCount} 项
              </button>
            ) : null}
          </div>

          {preview.items.length === 0 ? (
            <div className="settings-state">没有符合条件的可清理内容</div>
          ) : (
            <ul className="cleanup-item-list" aria-label="清理候选列表">
              {preview.items.map(item => <CleanupItem key={`${item.type}:${item.id}`} item={item} />)}
            </ul>
          )}

          <WarningList warnings={preview.warnings} />
        </section>
      ) : null}

      {confirming && preview ? (
        <section className="settings-confirmation" role="region" aria-label="确认清理">
          <AlertTriangle aria-hidden="true" size={18} />
          <div>
            <strong>确认永久删除 {candidateCount} 项？</strong>
            <p>此操作无法撤销。删除时会重新检查候选内容，发生变化的项目可能被跳过。</p>
          </div>
          <div className="settings-confirmation__actions">
            <button
              className="settings-text-button"
              type="button"
              disabled={phase !== 'idle'}
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
            <button
              className="settings-primary-button"
              type="button"
              disabled={phase !== 'idle'}
              onClick={() => void deleteCandidates()}
            >
              <Trash2 aria-hidden="true" size={15} />
              {phase === 'deleting' ? '正在删除' : `确认删除 ${candidateCount} 项`}
            </button>
          </div>
        </section>
      ) : null}

      {result && preview ? <CleanupResult preview={preview} result={result} /> : null}
    </section>
  );
}

function CleanupItem(props: { item: CleanupPreviewItem }) {
  return (
    <li>
      <div className="cleanup-item__title">
        <strong>{cleanupTypeLabel(props.item.type)}</strong>
        <span>{formatBytes(props.item.sizeBytes)}</span>
      </div>
      <code>{props.item.path}</code>
      <p>{formatDate(props.item.lastModifiedAt)} · {props.item.reason}</p>
    </li>
  );
}

function CleanupResult(props: {
  preview: CleanupPreviewResponse;
  result: CleanupDeleteResponse;
}) {
  const skipped = Math.max(
    props.preview.items.length - props.result.deleted.length - props.result.failed.length,
    0
  );

  return (
    <section className="cleanup-result" aria-labelledby="cleanup-result-title">
      <div className="cleanup-result__title">
        <CheckCircle2 aria-hidden="true" size={18} />
        <div>
          <h2 id="cleanup-result-title">清理结果</h2>
          <p>已释放 {formatBytes(props.result.totalDeletedBytes)}</p>
        </div>
      </div>
      <div className="cleanup-result__counts">
        <strong>已删除 {props.result.deleted.length} 项</strong>
        <strong data-status={props.result.failed.length > 0 ? 'failed' : 'ok'}>
          删除失败 {props.result.failed.length} 项
        </strong>
        <strong>跳过 {skipped} 项</strong>
      </div>
      {props.result.failed.length > 0 ? (
        <ul className="cleanup-failure-list" aria-label="删除失败明细">
          {props.result.failed.map(item => (
            <li key={`${item.type}:${item.id}`}>
              <code>{item.path}</code>
              <span>{item.error}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <WarningList warnings={props.result.warnings} />
    </section>
  );
}

function WarningList(props: { warnings: string[] }) {
  if (props.warnings.length === 0) return null;
  return (
    <ul className="settings-warning-list" aria-label="清理告警">
      {props.warnings.map(warning => <li key={warning}>{warning}</li>)}
    </ul>
  );
}

function cleanupTypeLabel(type: CleanupPreviewItem['type']): string {
  return type === 'run_logs' ? 'Run 日志' : '已归档托管工作区';
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${formatNumber(value / 1024)} KB`;
  if (value < 1024 * 1024 * 1024) return `${formatNumber(value / (1024 * 1024))} MB`;
  return `${formatNumber(value / (1024 * 1024 * 1024))} GB`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatError(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message.length > 0 ? reason.message : fallback;
}
