import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Check, Circle, Paperclip, Plus, ShieldCheck } from 'lucide-react';
import type { ReasoningEffort } from '@clawee/protocol';
import type { ProjectPermission } from '../projects/project-model.js';

export type ComposerRunConfig = {
  permission: ProjectPermission;
  model: string | null;
  reasoning: ReasoningEffort | null;
};

type ComposerModelOption = {
  id: 'default' | 'high' | 'xhigh';
  label: string;
  model: string | null;
  reasoning: ReasoningEffort | null;
};

const permissionOptions: Array<{
  value: ProjectPermission;
  label: string;
  description: string;
}> = [
  {
    value: 'follow-global',
    label: '只读访问',
    description: '只能读取上下文，不写入本机文件'
  },
  {
    value: 'workspace-write',
    label: '工作区读写',
    description: '可修改当前工作区文件'
  },
  {
    value: 'danger-full-access',
    label: '完全访问',
    description: '可访问本机文件并执行本地操作'
  }
];

const modelOptions: ComposerModelOption[] = [
  { id: 'default', label: '默认模型', model: null, reasoning: null },
  { id: 'high', label: '默认模型 高', model: null, reasoning: 'high' },
  { id: 'xhigh', label: '默认模型 超高', model: null, reasoning: 'xhigh' }
];

const TEXTAREA_MIN_HEIGHT = 28;
const TEXTAREA_MAX_VISIBLE_LINES = 3;
const TEXTAREA_LINE_HEIGHT = 24;
const TEXTAREA_VERTICAL_PADDING = 4;
const TEXTAREA_MAX_HEIGHT = Math.ceil(TEXTAREA_LINE_HEIGHT * TEXTAREA_MAX_VISIBLE_LINES + TEXTAREA_VERTICAL_PADDING);

export function Composer(props: {
  disabled?: boolean;
  disabledReason?: string;
  projectName: string;
  permission: ProjectPermission;
  model: string | null;
  reasoning: ReasoningEffort | null;
  onPermissionChange?(permission: ProjectPermission): void;
  onSubmit(prompt: string, config: ComposerRunConfig): void;
}) {
  const [prompt, setPrompt] = useState('');
  const [selectedPermission, setSelectedPermission] = useState<ProjectPermission>(props.permission);
  const [selectedModel, setSelectedModel] = useState(() => modelOptionForConfig(props.model, props.reasoning));
  const [openMenu, setOpenMenu] = useState<'add' | 'permission' | 'model' | null>(null);
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const trimmedPrompt = prompt.trim();

  useEffect(() => {
    setSelectedPermission(props.permission);
  }, [props.permission, props.projectName]);

  useEffect(() => {
    setSelectedModel(modelOptionForConfig(props.model, props.reasoning));
  }, [props.model, props.reasoning, props.projectName]);

  useLayoutEffect(() => {
    const textarea = promptTextareaRef.current;
    if (textarea === null) return;

    textarea.style.height = 'auto';
    const contentHeight = Math.max(textarea.scrollHeight, TEXTAREA_MIN_HEIGHT);
    const nextHeight = Math.min(contentHeight, TEXTAREA_MAX_HEIGHT);
    const isOverflowing = contentHeight > TEXTAREA_MAX_HEIGHT;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = isOverflowing ? 'auto' : 'hidden';
    textarea.scrollTop = isOverflowing ? textarea.scrollHeight : 0;
  }, [prompt]);

  const selectedPermissionOption = permissionOptions.find(option => option.value === selectedPermission) ?? permissionOptions[0]!;
  const canSubmit = !props.disabled && trimmedPrompt.length > 0;
  const submitPrompt = () => {
    if (!canSubmit) return;
    props.onSubmit(trimmedPrompt, {
      permission: selectedPermission,
      model: selectedModel.model,
      reasoning: selectedModel.reasoning
    });
    setPrompt('');
  };
  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submitPrompt();
  };

  return (
    <form
      className="clawee-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submitPrompt();
      }}
    >
      <textarea
        ref={promptTextareaRef}
        aria-label="输入任务"
        rows={1}
        value={prompt}
        disabled={props.disabled}
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={handlePromptKeyDown}
        placeholder={props.disabled ? props.disabledReason ?? '当前对话不可用' : '随心输入'}
      />
      <div className="composer-toolbar">
        <div className="composer-left-actions">
          <div className="composer-control-wrap">
            <button
              className="composer-icon-button"
              type="button"
              aria-label="添加上下文"
              aria-expanded={openMenu === 'add'}
              onClick={() => setOpenMenu(openMenu === 'add' ? null : 'add')}
            >
              <Plus aria-hidden="true" size={17} />
            </button>
            {openMenu === 'add' ? (
              <div className="composer-popover composer-popover-compact" role="menu" aria-label="添加上下文">
                <button className="composer-menu-item" type="button" role="menuitem" onClick={() => setOpenMenu(null)}>
                  <Paperclip aria-hidden="true" size={15} />
                  <span>添加文件</span>
                </button>
              </div>
            ) : null}
          </div>

          <div className="composer-control-wrap">
            <button
              className={`composer-select composer-select-${selectedPermission}`}
              type="button"
              aria-label={`选择访问权限 ${selectedPermissionOption.label}`}
              aria-expanded={openMenu === 'permission'}
              onClick={() => setOpenMenu(openMenu === 'permission' ? null : 'permission')}
            >
              <ShieldCheck aria-hidden="true" size={15} />
              <span>{selectedPermissionOption.label}</span>
            </button>
            {openMenu === 'permission' ? (
              <div className="composer-popover composer-permission-menu" role="menu" aria-label="访问权限">
                {permissionOptions.map(option => (
                  <button
                    key={option.value}
                    className="composer-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedPermission === option.value}
                    onClick={() => {
                      setSelectedPermission(option.value);
                      props.onPermissionChange?.(option.value);
                      setOpenMenu(null);
                    }}
                  >
                    <span className="composer-menu-icon" aria-hidden="true">
                      {selectedPermission === option.value ? <Check size={15} /> : null}
                    </span>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="composer-right-actions">
          <div className="composer-control-wrap">
            <button
              className="composer-model-button"
              type="button"
              aria-label={`选择模型 ${selectedModel.label}`}
              aria-expanded={openMenu === 'model'}
              onClick={() => setOpenMenu(openMenu === 'model' ? null : 'model')}
            >
              <Circle aria-hidden="true" size={9} />
              <span>{selectedModel.label}</span>
            </button>
            {openMenu === 'model' ? (
              <div className="composer-popover composer-model-menu" role="menu" aria-label="模型">
                {modelOptions.map(option => (
                  <button
                    key={option.id}
                    className="composer-menu-item"
                    type="button"
                    role="menuitemradio"
                    aria-checked={selectedModel.id === option.id}
                    onClick={() => {
                      setSelectedModel(option);
                      setOpenMenu(null);
                    }}
                  >
                    <span className="composer-menu-icon" aria-hidden="true">
                      {selectedModel.id === option.id ? <Check size={15} /> : null}
                    </span>
                    <span>
                      <strong>{option.label}</strong>
                      <small>{modelOptionDescription(option)}</small>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            className="composer-send"
            type="submit"
            aria-label="发送"
            disabled={!canSubmit}
          >
            <ArrowUp aria-hidden="true" size={17} />
          </button>
        </div>
      </div>
    </form>
  );
}

function modelOptionForConfig(model: string | null, reasoning: ReasoningEffort | null): ComposerModelOption {
  if (model === null && reasoning === 'xhigh') return modelOptions[2]!;
  if (model === null && reasoning === 'high') return modelOptions[1]!;
  return modelOptions[0]!;
}

function modelOptionDescription(option: ComposerModelOption): string {
  if (option.id === 'xhigh') return '更充分的推理过程';
  if (option.id === 'high') return '较强推理能力';
  return '使用本机默认配置';
}
