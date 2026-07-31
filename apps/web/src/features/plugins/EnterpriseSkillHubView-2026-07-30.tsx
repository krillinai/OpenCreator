import type {
  EnterpriseSessionResponse,
  EnterpriseSkillAction,
  EnterpriseSkillDetailResponse,
  EnterpriseSkillIntegrity,
  EnterpriseSkillResponse,
  EnterpriseSkillStatus
} from '@clawee/protocol';
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  Download,
  FileWarning,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SkillUseProjectDialog, type SkillMarketProjectOption } from './SkillUseProjectDialog.js';

export type EnterpriseSkillOperation =
  | { skillId: string; kind: 'install' | 'update'; error?: string }
  | undefined;

export type EnterpriseSkillUseError = {
  skillId: string;
  error: string;
};

export type EnterpriseSkillHubViewProps = {
  connected: boolean;
  session: EnterpriseSessionResponse;
  skills?: EnterpriseSkillResponse[];
  loading: boolean;
  loadError?: string;
  operation?: EnterpriseSkillOperation;
  useError?: EnterpriseSkillUseError;
  projects: readonly SkillMarketProjectOption[];
  currentProjectId: string;
  onOpenAccount(): void;
  onRefresh(): void;
  onLoadDetail(skillId: string): Promise<EnterpriseSkillDetailResponse>;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(skill: EnterpriseSkillResponse, projectId: string): void;
};

type EnterpriseStatusFilter =
  | 'all'
  | EnterpriseSkillStatus
  | 'local_changed';

type ActiveDetail = {
  skillId: string;
  detail?: EnterpriseSkillDetailResponse;
  loading: boolean;
  error?: string;
};

export function EnterpriseSkillHubView(props: EnterpriseSkillHubViewProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<EnterpriseStatusFilter>('all');
  const [activeDetail, setActiveDetail] = useState<ActiveDetail>();
  const [pendingUseSkill, setPendingUseSkill] = useState<EnterpriseSkillResponse>();
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const detailRequestRef = useRef(0);
  const mutationLocked = props.operation !== undefined && props.operation.error === undefined;

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return (props.skills ?? []).filter(skill => {
      if (
        statusFilter !== 'all'
        && (
          statusFilter === 'local_changed'
            ? skill.integrity !== 'local_changed'
            : skill.status !== statusFilter
        )
      ) {
        return false;
      }
      if (normalizedQuery.length === 0) return true;
      return [
        skill.skillId,
        skill.name,
        skill.description ?? '',
        skill.version ?? '',
        skill.installedVersion ?? ''
      ].some(value => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [props.skills, query, statusFilter]);

  useEffect(() => {
    if (activeDetail === undefined) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeDetail();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [activeDetail]);

  function closeDetail() {
    detailRequestRef.current += 1;
    setActiveDetail(undefined);
    window.setTimeout(() => {
      detailTriggerRef.current?.focus({ preventScroll: true });
      detailTriggerRef.current = null;
    }, 0);
  }

  function openDetail(skill: EnterpriseSkillResponse, trigger: HTMLElement) {
    detailTriggerRef.current = trigger;
    detailRequestRef.current += 1;
    const requestId = detailRequestRef.current;
    setActiveDetail({ skillId: skill.skillId, loading: true });

    void props.onLoadDetail(skill.skillId)
      .then(detail => {
        if (detailRequestRef.current !== requestId) return;
        setActiveDetail({
          skillId: skill.skillId,
          detail,
          loading: false
        });
      })
      .catch(error => {
        if (detailRequestRef.current !== requestId) return;
        setActiveDetail({
          skillId: skill.skillId,
          loading: false,
          error: formatDetailError(error)
        });
      });
  }

  function requestUse(skill: EnterpriseSkillResponse) {
    setActiveDetail(undefined);
    setPendingUseSkill(skill);
  }

  if (props.session.status === 'signed_out') {
    return (
      <EnterpriseGate
        icon={<Building2 size={24} aria-hidden="true" />}
        title="登录后访问企业 Skill Hub"
        detail="公共市场和本地 Skill 不受影响。"
        actionLabel="登录企业账户"
        onAction={props.onOpenAccount}
      />
    );
  }

  if (props.session.status === 'checking') {
    return (
      <EnterpriseGate
        icon={<LoaderCircle className="enterprise-skill-spinner" size={24} aria-hidden="true" />}
        title="正在验证企业会话"
        detail="验证完成后会自动加载企业目录。"
      />
    );
  }

  if (props.session.status === 'service_unavailable') {
    return (
      <EnterpriseGate
        icon={<AlertCircle size={24} aria-hidden="true" />}
        title="企业 Skill Hub 暂时不可用"
        detail="已安装的本地 Skill 仍可继续使用。"
        actionLabel="刷新企业状态"
        onAction={props.onRefresh}
      />
    );
  }

  return (
    <section className="enterprise-skill-hub" aria-label="企业 Skill Hub">
      <header className="enterprise-skill-heading">
        <div>
          <h1>
            <Building2 size={20} aria-hidden="true" />
            <span>企业 Skill Hub</span>
          </h1>
          <p>{props.session.account?.name ?? '企业账户'} · {props.skills?.length ?? 0} 个 Skill</p>
        </div>
        <button
          aria-label="刷新企业 Skill"
          className="enterprise-skill-icon-button"
          disabled={!props.connected || props.loading || mutationLocked}
          onClick={props.onRefresh}
          title="刷新"
          type="button"
        >
          {props.loading ? (
            <LoaderCircle className="enterprise-skill-spinner" size={17} aria-hidden="true" />
          ) : (
            <RefreshCw size={17} aria-hidden="true" />
          )}
        </button>
      </header>

      <div className="enterprise-skill-toolbar">
        <label className="enterprise-skill-search">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="搜索企业 Skill"
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索名称、描述或版本"
            type="search"
            value={query}
          />
        </label>
        <label className="enterprise-skill-filter">
          <span>状态</span>
          <select
            aria-label="企业 Skill 状态"
            onChange={event => setStatusFilter(event.target.value as EnterpriseStatusFilter)}
            value={statusFilter}
          >
            <option value="all">全部</option>
            <option value="not_installed">未安装</option>
            <option value="installed">已安装</option>
            <option value="update_available">可更新</option>
            <option value="unpublished">已下架</option>
            <option value="installed_unknown_source">来源未知</option>
            <option value="name_conflict">名称冲突</option>
            <option value="invalid">本地内容无效</option>
            <option value="local_changed">本地内容已修改</option>
          </select>
        </label>
      </div>

      {!props.connected ? (
        <p className="enterprise-skill-banner" role="status">
          本地 Runtime 未连接，企业目录暂不可操作。
        </p>
      ) : null}
      {props.loadError !== undefined ? (
        <p className="enterprise-skill-error" role="alert">
          <AlertCircle size={17} aria-hidden="true" />
          <span>{props.loadError}</span>
        </p>
      ) : null}
      {props.useError !== undefined ? (
        <p className="enterprise-skill-error" role="status">
          使用失败：{props.useError.error}
        </p>
      ) : null}

      {props.loading && props.skills === undefined ? (
        <div className="enterprise-skill-empty" role="status">
          <LoaderCircle className="enterprise-skill-spinner" size={22} aria-hidden="true" />
          <span>正在加载企业 Skill</span>
        </div>
      ) : filteredSkills.length === 0 ? (
        <div className="enterprise-skill-empty" role="status">
          <span>
            {(props.skills?.length ?? 0) === 0
              ? '企业目录暂时为空'
              : '没有符合当前条件的 Skill'}
          </span>
        </div>
      ) : (
        <div className="enterprise-skill-list">
          {filteredSkills.map(skill => (
            <EnterpriseSkillRow
              connected={props.connected}
              key={skill.skillId}
              mutationLocked={mutationLocked}
              operation={props.operation}
              skill={skill}
              onInstall={props.onInstall}
              onOpen={trigger => openDetail(skill, trigger)}
              onUpdate={props.onUpdate}
              onUse={() => requestUse(skill)}
            />
          ))}
        </div>
      )}

      {activeDetail !== undefined ? (
        <EnterpriseSkillDetailDialog
          active={activeDetail}
          connected={props.connected}
          fallback={props.skills?.find(skill => skill.skillId === activeDetail.skillId)}
          mutationLocked={mutationLocked}
          operation={props.operation}
          onClose={closeDetail}
          onInstall={props.onInstall}
          onUpdate={props.onUpdate}
          onUse={requestUse}
        />
      ) : null}

      {pendingUseSkill !== undefined ? (
        <SkillUseProjectDialog
          currentProjectId={props.currentProjectId}
          onClose={() => setPendingUseSkill(undefined)}
          onConfirm={projectId => {
            const skill = pendingUseSkill;
            setPendingUseSkill(undefined);
            props.onUse(skill, projectId);
          }}
          projects={props.projects}
          skillTitle={pendingUseSkill.name}
        />
      ) : null}
    </section>
  );
}

function EnterpriseSkillRow(props: {
  connected: boolean;
  skill: EnterpriseSkillResponse;
  mutationLocked: boolean;
  operation?: EnterpriseSkillOperation;
  onOpen(trigger: HTMLElement): void;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(): void;
}) {
  const visual = getEnterpriseSkillVisual(props.skill.status, props.skill.integrity);
  return (
    <article
      className="enterprise-skill-row"
      data-status={props.skill.status}
      data-testid={`enterprise-skill-${props.skill.skillId}`}
    >
      <button
        aria-label={`查看 ${props.skill.name} 详情`}
        className="enterprise-skill-row-open"
        onClick={event => props.onOpen(event.currentTarget)}
        type="button"
      >
        <span className="enterprise-skill-row-icon" data-tone={visual.tone} aria-hidden="true">
          {visual.icon}
        </span>
        <span className="enterprise-skill-row-copy">
          <strong>{props.skill.name}</strong>
          <small>{props.skill.description ?? props.skill.skillId}</small>
        </span>
        <span className="enterprise-skill-version">
          {formatVersionSummary(props.skill)}
        </span>
        <span className="enterprise-skill-status" data-tone={visual.tone}>
          {visual.label}
        </span>
      </button>
      <div
        className="enterprise-skill-actions"
        role="group"
        aria-label={`${props.skill.name} 操作`}
      >
        {props.skill.actions.map(action => (
          <EnterpriseSkillActionButton
            action={action}
            connected={props.connected}
            key={action}
            mutationLocked={props.mutationLocked}
            operation={props.operation}
            skill={props.skill}
            onInstall={props.onInstall}
            onUpdate={props.onUpdate}
            onUse={props.onUse}
          />
        ))}
      </div>
      {props.operation?.skillId === props.skill.skillId && props.operation.error !== undefined ? (
        <p className="enterprise-skill-row-error" role="alert">{props.operation.error}</p>
      ) : null}
    </article>
  );
}

function EnterpriseSkillActionButton(props: {
  action: EnterpriseSkillAction;
  connected: boolean;
  mutationLocked: boolean;
  operation?: EnterpriseSkillOperation;
  skill: EnterpriseSkillResponse;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(): void;
}) {
  const currentOperation =
    props.operation?.skillId === props.skill.skillId
    && props.operation.error === undefined
      ? props.operation.kind
      : undefined;
  const isWrite = props.action === 'install' || props.action === 'update';
  const disabled =
    !props.connected
    || (isWrite && props.mutationLocked);
  const label = currentOperation === props.action
    ? props.action === 'install' ? '安装中' : '更新中'
    : actionLabel(props.action);

  return (
    <button
      className={`enterprise-skill-action enterprise-skill-action--${props.action}`}
      disabled={disabled}
      onClick={() => {
        if (props.action === 'install') props.onInstall(props.skill.skillId);
        if (props.action === 'update') props.onUpdate(props.skill.skillId);
        if (props.action === 'use') props.onUse();
      }}
      type="button"
    >
      {currentOperation === props.action ? (
        <LoaderCircle className="enterprise-skill-spinner" size={15} aria-hidden="true" />
      ) : actionIcon(props.action)}
      <span>{label}</span>
    </button>
  );
}

function EnterpriseSkillDetailDialog(props: {
  active: ActiveDetail;
  fallback?: EnterpriseSkillResponse;
  connected: boolean;
  mutationLocked: boolean;
  operation?: EnterpriseSkillOperation;
  onClose(): void;
  onInstall(skillId: string): void;
  onUpdate(skillId: string): void;
  onUse(skill: EnterpriseSkillResponse): void;
}) {
  const skill = props.active.detail ?? props.fallback;
  return (
    <div className="skill-market-modal-backdrop" onMouseDown={event => {
      if (event.target === event.currentTarget) props.onClose();
    }}>
      <section
        aria-label={`${skill?.name ?? props.active.skillId} 详情`}
        aria-modal="true"
        className="enterprise-skill-detail"
        role="dialog"
      >
        <header>
          <div>
            <span>企业 Skill</span>
            <h2>{skill?.name ?? props.active.skillId}</h2>
          </div>
          <button
            aria-label="关闭详情"
            className="enterprise-skill-icon-button"
            onClick={props.onClose}
            title="关闭"
            type="button"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>
        <div className="enterprise-skill-detail-body">
          {props.active.loading ? (
            <div className="enterprise-skill-empty" role="status">
              <LoaderCircle className="enterprise-skill-spinner" size={22} aria-hidden="true" />
              <span>正在加载详情</span>
            </div>
          ) : props.active.error !== undefined ? (
            <p className="enterprise-skill-error" role="alert">{props.active.error}</p>
          ) : skill !== undefined ? (
            <>
              <section>
                <h3>描述</h3>
                <p>{skill.description ?? '暂无描述'}</p>
              </section>
              <dl>
                <div>
                  <dt>当前版本</dt>
                  <dd>{skill.version ?? '未发布'}</dd>
                </div>
                <div>
                  <dt>本地版本</dt>
                  <dd>{skill.installedVersion ?? '未安装'}</dd>
                </div>
                <div>
                  <dt>更新时间</dt>
                  <dd>{formatUpdatedAt(skill.updatedAt)}</dd>
                </div>
                <div>
                  <dt>本地状态</dt>
                  <dd>{getEnterpriseSkillVisual(skill.status, skill.integrity).label}</dd>
                </div>
              </dl>
              {props.active.detail?.changelog !== undefined ? (
                <section>
                  <h3>更新说明</h3>
                  <p>{props.active.detail.changelog}</p>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
        <footer>
          <span>
            {skill === undefined
              ? ''
              : getEnterpriseSkillVisual(skill.status, skill.integrity).reason}
          </span>
          <div className="enterprise-skill-actions" role="group" aria-label="详情操作">
            {skill?.actions.map(action => (
              <EnterpriseSkillActionButton
                action={action}
                connected={props.connected}
                key={action}
                mutationLocked={props.mutationLocked}
                operation={props.operation}
                skill={skill}
                onInstall={props.onInstall}
                onUpdate={props.onUpdate}
                onUse={() => props.onUse(skill)}
              />
            ))}
          </div>
        </footer>
      </section>
    </div>
  );
}

function EnterpriseGate(props: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="enterprise-skill-gate" aria-label="企业 Skill Hub">
      <span className="enterprise-skill-gate-icon">{props.icon}</span>
      <h1>{props.title}</h1>
      <p>{props.detail}</p>
      {props.actionLabel !== undefined && props.onAction !== undefined ? (
        <button type="button" onClick={props.onAction}>{props.actionLabel}</button>
      ) : null}
    </section>
  );
}

function getEnterpriseSkillVisual(
  status: EnterpriseSkillStatus,
  integrity: EnterpriseSkillIntegrity
): {
  label: string;
  reason: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger';
  icon: React.ReactNode;
} {
  if (integrity === 'local_changed') {
    return {
      label: '本地内容已修改',
      reason: '本地内容与安装记录不一致，只能继续使用，不能静默更新。',
      tone: 'warning',
      icon: <FileWarning size={18} />
    };
  }
  switch (status) {
    case 'not_installed':
      return {
        label: '未安装',
        reason: '可安装到本地 Skill 目录。',
        tone: 'neutral',
        icon: <Download size={18} />
      };
    case 'invalid':
      return {
        label: '本地内容无效',
        reason: '同名本地 Skill 无法通过结构校验。',
        tone: 'danger',
        icon: <AlertCircle size={18} />
      };
    case 'installed_unknown_source':
      return {
        label: '来源未知',
        reason: '本地存在同名 Skill，但没有可验证的企业来源记录。',
        tone: 'warning',
        icon: <ShieldAlert size={18} />
      };
    case 'name_conflict':
      return {
        label: '名称冲突',
        reason: '该名称已由其他来源占用，企业 Hub 不会覆盖。',
        tone: 'danger',
        icon: <AlertCircle size={18} />
      };
    case 'installed':
      return {
        label: '已安装',
        reason: '本地内容与企业安装记录一致。',
        tone: 'success',
        icon: <CheckCircle2 size={18} />
      };
    case 'update_available':
      return {
        label: '可更新',
        reason: '企业目录提供了新的已验证版本。',
        tone: 'success',
        icon: <RefreshCw size={18} />
      };
    case 'unpublished':
      return {
        label: '已下架',
        reason: '远端目录已下架，本地已安装内容仍可使用。',
        tone: 'warning',
        icon: <FileWarning size={18} />
      };
  }
}

function actionLabel(action: EnterpriseSkillAction): string {
  if (action === 'install') return '安装';
  if (action === 'update') return '更新';
  return '使用';
}

function actionIcon(action: EnterpriseSkillAction) {
  if (action === 'install') return <Download size={15} aria-hidden="true" />;
  if (action === 'update') return <RefreshCw size={15} aria-hidden="true" />;
  return <CheckCircle2 size={15} aria-hidden="true" />;
}

function formatVersionSummary(skill: EnterpriseSkillResponse): string {
  if (skill.version !== undefined && skill.installedVersion !== undefined) {
    return `${skill.installedVersion} → ${skill.version}`;
  }
  if (skill.installedVersion !== undefined) return `本地 ${skill.installedVersion}`;
  if (skill.version !== undefined) return `版本 ${skill.version}`;
  return '版本未知';
}

function formatUpdatedAt(value: string | undefined): string {
  if (value === undefined) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function formatDetailError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : '企业 Skill 详情加载失败';
}

export default EnterpriseSkillHubView;
