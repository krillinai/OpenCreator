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
  CheckCircle2,
  ChevronDown,
  Download,
  FileWarning,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  Upload,
  WandSparkles,
  X
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SkillAuthorAvatar } from './SkillMarketCover.js';
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
  onCreateSkill?(): void;
  onUploadSkill?(): void;
};

const mockEnterpriseSkillInputs: Array<[string, string, string, EnterpriseSkillStatus]> = [
  ['brand-compliance', '品牌合规审查', '检查营销内容中的品牌规范与敏感表达', 'installed'],
  ['competitor-intelligence', '竞品动态监测', '汇总竞品发布、价格与渠道变化', 'installed'],
  ['customer-insights', '客户洞察分析', '整理客户反馈、画像与流失风险', 'update_available'],
  ['social-operations', '社媒运营助手', '生成内容计划并复盘互动表现', 'installed'],
  ['channel-campaigns', '渠道投放分析', '对比渠道消耗、转化与 ROI', 'not_installed'],
  ['business-weekly', '经营周报生成', '汇总核心业务指标并生成管理摘要', 'installed']
];

const mockEnterpriseSkills: EnterpriseSkillResponse[] = mockEnterpriseSkillInputs.map(([skillId, name, description, status]) => ({
  skillId, name, description, status,
  version: '1.2.0', installedVersion: status === 'not_installed' ? undefined : '1.1.0',
  updatedAt: '2026-08-03T08:00:00.000Z', integrity: status === 'not_installed' ? 'not_applicable' : 'verified',
  actions: status === 'not_installed' ? ['install'] : status === 'update_available' ? ['update', 'use'] : ['use']
}));

const mockEnterpriseSkillAuthors: Record<string, string> = {
  'brand-compliance': '林晓',
  'competitor-intelligence': '周宁',
  'customer-insights': '陈嘉',
  'social-operations': '许一',
  'channel-campaigns': '赵晨',
  'business-weekly': '王璐'
};

const mockEnterpriseSkillUsage: Record<string, number> = {
  'brand-compliance': 1284,
  'competitor-intelligence': 936,
  'customer-insights': 742,
  'social-operations': 1689,
  'channel-campaigns': 418,
  'business-weekly': 1106
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
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const detailRequestRef = useRef(0);
  const mutationLocked = props.operation !== undefined && props.operation.error === undefined;
  const skills = props.skills !== undefined && props.skills.length > 0 ? props.skills : mockEnterpriseSkills;

  const filteredSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return skills.filter(skill => {
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
        skill.installedVersion ?? '',
        getEnterpriseSkillAuthor(skill.skillId)
      ].some(value => value.toLocaleLowerCase().includes(normalizedQuery));
    });
  }, [skills, query, statusFilter]);
  const installedCount = skills.filter(skill => skill.status === 'installed').length;
  const updateCount = skills.filter(skill => skill.status === 'update_available').length;
  const availableCount = skills.filter(skill => skill.status === 'not_installed').length;

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
        title="企业Skills暂时不可用"
        detail="已安装的本地 Skill 仍可继续使用。"
        actionLabel="刷新企业状态"
        onAction={props.onRefresh}
      />
    );
  }

  return (
    <section className="enterprise-skill-hub" aria-label="企业Skills">
      <header className="skill-market-heading">
        <div className="skill-market__toolbar">
          <label className="skill-market-search"><Search size={17} aria-hidden="true" /><input aria-label="搜索企业 Skill" onChange={event => setQuery(event.target.value)} placeholder="搜索技能" type="search" value={query} /></label>
          <div className="skill-market-add">
            <button aria-expanded={addMenuOpen} aria-haspopup="menu" className="skill-market-add__trigger" onClick={() => setAddMenuOpen(open => !open)} type="button"><Plus size={15}/><span>添加技能</span><ChevronDown size={13}/></button>
            {addMenuOpen ? <div className="skill-market-add__menu" role="menu"><button disabled={props.onCreateSkill === undefined} onClick={() => { setAddMenuOpen(false); props.onCreateSkill?.(); }} role="menuitem"><WandSparkles size={16}/><span><strong>创建技能</strong><small>通过对话生成新的技能</small></span></button>{props.onUploadSkill ? <button onClick={() => { setAddMenuOpen(false); props.onUploadSkill?.(); }} role="menuitem"><Upload size={16}/><span><strong>上传技能</strong><small>选择包含 SKILL.md 的文件夹</small></span></button> : null}</div> : null}
          </div>
        </div>
      </header>

      <div className="skill-market-navigation">
        <div className="skill-market-category-line">
          <div className="skill-market-filter-row skill-market-filter-row--categories" aria-label="状态" role="group">
            <EnterpriseFilterButton active={statusFilter === 'installed'} count={installedCount} label="已安装" onClick={() => setStatusFilter('installed')} />
            <EnterpriseFilterButton active={statusFilter === 'all'} count={skills.length} label="全部" onClick={() => setStatusFilter('all')} />
            <EnterpriseFilterButton active={statusFilter === 'update_available'} count={updateCount} label="可更新" onClick={() => setStatusFilter('update_available')} />
            <EnterpriseFilterButton active={statusFilter === 'not_installed'} count={availableCount} label="未安装" onClick={() => setStatusFilter('not_installed')} />
          </div>
        </div>
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
            {skills.length === 0
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
          fallback={skills.find(skill => skill.skillId === activeDetail.skillId)}
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

function EnterpriseFilterButton(props: {
  active: boolean;
  count: number;
  label: string;
  onClick(): void;
}) {
  return (
    <button
      aria-pressed={props.active}
      className={props.active ? 'is-active' : ''}
      onClick={props.onClick}
      type="button"
    >
      <span>{props.label}</span>
      <b>{props.count}</b>
    </button>
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
  const author = getEnterpriseSkillAuthor(props.skill.skillId);
  return (
    <article
      className="enterprise-skill-row skill-market-card"
      data-status={props.skill.status}
      data-testid={`enterprise-skill-${props.skill.skillId}`}
    >
      <button
        aria-label={`查看 ${props.skill.name} 详情`}
        className="enterprise-skill-row-open skill-market-card__open"
        onClick={event => props.onOpen(event.currentTarget)}
        type="button"
      >
          <span className="skill-market-card__body">
          <span className="skill-market-card__identity">
            <SkillAuthorAvatar name={author} />
            <span className="skill-market-card__identity-copy">
              <span className="skill-market-card__title">{props.skill.name}</span>
              <span className="skill-market-card__author">{author}</span>
            </span>
          </span>
          <span className="skill-market-card__tagline" title={props.skill.description}>
            {props.skill.description ?? props.skill.skillId}
          </span>
          <span className="skill-market-card__tags">
            <span>使用 {formatUsageCount(getEnterpriseSkillUsage(props.skill.skillId))} 次</span>
          </span>
        </span>
      </button>
      {props.skill.actions.filter(action => action === 'install' || action === 'use').map(action => (
        <EnterpriseSkillActionButton
          action={action}
          compact
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
      {props.operation?.skillId === props.skill.skillId && props.operation.error !== undefined ? (
        <p className="enterprise-skill-row-error" role="alert">{props.operation.error}</p>
      ) : null}
    </article>
  );
}

function EnterpriseSkillActionButton(props: {
  action: EnterpriseSkillAction;
  compact?: boolean;
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
      aria-label={props.compact ? label : undefined}
      className={`enterprise-skill-action enterprise-skill-action--${props.action} skill-market-action-button skill-market-action-button--${props.action}`}
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
      ) : props.compact && props.action === 'use' ? null : actionIcon(props.action)}
      {props.compact && props.action !== 'use' ? null : <span>{label}</span>}
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
    <section className="enterprise-skill-gate" aria-label="企业Skills">
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
  if (action === 'install') return <Plus size={17} aria-hidden="true" />;
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

function getEnterpriseSkillAuthor(skillId: string): string {
  return mockEnterpriseSkillAuthors[skillId] ?? '企业成员';
}

function getEnterpriseSkillUsage(skillId: string): number {
  return mockEnterpriseSkillUsage[skillId] ?? 0;
}

function formatUsageCount(count: number): string {
  return new Intl.NumberFormat('zh-CN').format(count);
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
