import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowUp,
  Check,
  ChevronDown,
  FileText,
  Paperclip,
  Plus,
  ShieldCheck,
  X
} from 'lucide-react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

type ComposerMenu = 'add' | 'permission' | 'model' | null;
export type ToolAgentPermission = 'approval' | 'full-access';

const models = ['default', 'gpt-5.6-sol'] as const;
type Model = typeof models[number];

export default function ToolAgentComposer(props: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  showAttachments?: boolean;
  showPermission?: boolean;
  showModel?: boolean;
  submitting?: boolean;
  permission?: ToolAgentPermission;
  permissionDisabled?: boolean;
  onChange(value: string): void;
  onPermissionChange?(permission: ToolAgentPermission): void;
  onSubmit(): void;
}) {
  const { t } = useAppLanguage();
  const l = useLocalizedCopy();
  const rootRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [openMenu, setOpenMenu] = useState<ComposerMenu>(null);
  const [localPermission, setLocalPermission] = useState<ToolAgentPermission>('full-access');
  const [model, setModel] = useState<Model>('default');
  const [attachments, setAttachments] = useState<File[]>([]);
  const showAttachments = props.showAttachments ?? true;
  const showPermission = props.showPermission ?? true;
  const showModel = props.showModel ?? true;
  const compact = !showAttachments && !showPermission && !showModel;
  const permission = props.permission ?? localPermission;

  const permissionLabel = permission === 'approval'
    ? t('composer.permission.approval')
    : t('composer.permission.fullAccess');
  const modelLabel = model === 'default' ? t('composer.model.default') : 'GPT-5.6 Sol';

  useEffect(() => {
    function closeMenus(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }
    document.addEventListener('pointerdown', closeMenus);
    return () => document.removeEventListener('pointerdown', closeMenus);
  }, []);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!props.value.trim()) return;
    props.onSubmit();
    setAttachments([]);
    setOpenMenu(null);
  }

  return (
    <form ref={rootRef} className="tool-agent-composer" onSubmit={submit}>
      {showAttachments && attachments.length > 0 ? (
        <div className="tool-agent-composer-attachments" aria-label={l('已添加的文件', 'Attached files')}>
          {attachments.map((file, index) => (
            <span key={`${file.name}-${file.lastModified}-${index}`}>
              <FileText size={14} strokeWidth={1.8} aria-hidden="true" />
              <strong>{file.name}</strong>
              <button
                type="button"
                onClick={() => setAttachments(current => current.filter((_, itemIndex) => itemIndex !== index))}
                aria-label={l(`移除 ${file.name}`, `Remove ${file.name}`)}
              >
                <X size={13} strokeWidth={1.9} aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="tool-agent-composer-input">
        <textarea
          rows={4}
          value={props.value}
          onChange={event => props.onChange(event.target.value)}
          onKeyDown={event => {
            if (event.key !== 'Enter' || event.shiftKey) return;
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }}
          aria-label={props.ariaLabel}
          placeholder={props.placeholder}
        />
      </div>

      <div className="tool-agent-composer-toolbar" data-compact={compact ? 'true' : undefined}>
        {showAttachments || showPermission ? (
          <div className="tool-agent-composer-actions">
          {showAttachments ? <div className="tool-agent-composer-control">
            <button
              className="tool-agent-composer-icon-button"
              type="button"
              aria-label={t('composer.add.context')}
              aria-expanded={openMenu === 'add'}
              title={t('composer.add.title')}
              onClick={() => setOpenMenu(current => current === 'add' ? null : 'add')}
            >
              <Plus size={17} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {openMenu === 'add' ? (
              <div className="tool-agent-composer-menu tool-agent-composer-add-menu" role="menu" aria-label={t('composer.add.context')}>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpenMenu(null);
                    fileInputRef.current?.click();
                  }}
                >
                  <Paperclip size={15} strokeWidth={1.8} aria-hidden="true" />
                  <span>{t('composer.add.file')}</span>
                </button>
              </div>
            ) : null}
            <input
              ref={fileInputRef}
              className="tool-agent-composer-file-input"
              type="file"
              multiple
              aria-label={t('composer.add.file')}
              onChange={event => {
                const files = Array.from(event.currentTarget.files ?? []);
                if (files.length > 0) setAttachments(current => [...current, ...files]);
                event.currentTarget.value = '';
              }}
            />
          </div> : null}

          {showPermission ? <div className="tool-agent-composer-control">
            <button
              className="tool-agent-composer-select"
              type="button"
              disabled={props.permissionDisabled}
              aria-label={l(`选择访问权限 ${permissionLabel}`, `Select access level: ${permissionLabel}`)}
              aria-expanded={openMenu === 'permission'}
              title={props.permissionDisabled ? t('composer.permission.changeAfterRun') : undefined}
              onClick={() => setOpenMenu(current => current === 'permission' ? null : 'permission')}
            >
              <ShieldCheck size={15} strokeWidth={1.8} aria-hidden="true" />
              <span>{permissionLabel}</span>
              <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {openMenu === 'permission' ? (
              <div className="tool-agent-composer-menu tool-agent-composer-option-menu" role="menu" aria-label={t('composer.permission.label')}>
                {([
                  ['approval', t('composer.permission.approval'), t('composer.permission.approvalDescription')],
                  ['full-access', t('composer.permission.fullAccess'), t('composer.permission.fullAccessDescription')]
                ] as const).map(option => (
                  <button
                    key={option[0]}
                    type="button"
                    role="menuitemradio"
                    aria-checked={permission === option[0]}
                    onClick={() => {
                      if (props.permission === undefined) setLocalPermission(option[0]);
                      props.onPermissionChange?.(option[0]);
                      setOpenMenu(null);
                    }}
                  >
                    <span className="tool-agent-composer-check" aria-hidden="true">
                      {permission === option[0] ? <Check size={14} strokeWidth={2} /> : null}
                    </span>
                    <span><strong>{option[1]}</strong><small>{option[2]}</small></span>
                  </button>
                ))}
              </div>
            ) : null}
          </div> : null}
        </div>
        ) : null}

        <div className="tool-agent-composer-actions tool-agent-composer-actions-right">
          {showModel ? <div className="tool-agent-composer-control">
            <button
              className="tool-agent-composer-select"
              type="button"
              aria-label={l(`选择模型 ${modelLabel}`, `Select model: ${modelLabel}`)}
              aria-expanded={openMenu === 'model'}
              onClick={() => setOpenMenu(current => current === 'model' ? null : 'model')}
            >
              <span>{modelLabel}</span>
              <ChevronDown size={13} strokeWidth={1.8} aria-hidden="true" />
            </button>
            {openMenu === 'model' ? (
              <div className="tool-agent-composer-menu tool-agent-composer-model-menu" role="menu" aria-label={t('composer.model.label')}>
                {models.map(option => {
                  const label = option === 'default' ? t('composer.model.default') : 'GPT-5.6 Sol';
                  return (
                    <button
                      key={option}
                      type="button"
                      role="menuitemradio"
                      aria-checked={model === option}
                      onClick={() => {
                        setModel(option);
                        setOpenMenu(null);
                      }}
                    >
                      <span className="tool-agent-composer-check" aria-hidden="true">
                        {model === option ? <Check size={14} strokeWidth={2} /> : null}
                      </span>
                      <span><strong>{label}</strong></span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div> : null}
          <button
            className="tool-agent-composer-send"
            type="submit"
            disabled={props.submitting || !props.value.trim()}
            aria-busy={props.submitting || undefined}
            aria-label={l('发送给 Agent', 'Send to Agent')}
          >
            <ArrowUp size={17} strokeWidth={1.9} aria-hidden="true" />
          </button>
        </div>
      </div>
    </form>
  );
}
