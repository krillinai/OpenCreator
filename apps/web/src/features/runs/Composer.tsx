import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowUp, Cable, Check, Circle, Paperclip, Plus, ShieldCheck, Sparkles, Target } from 'lucide-react';
import type { ReasoningEffort } from '@clawee/protocol';
import type { ProjectPermission } from '../projects/project-model.js';

export type ComposerRunConfig = {
  permission: ProjectPermission;
  model: string | null;
  reasoning: ReasoningEffort | null;
};

export type ComposerDraftRequest = {
  id: number;
  text: string;
};

export type ComposerSlashCommand = {
  id: string;
  category: 'skill' | 'mcp' | 'goal';
  label: string;
  description: string;
  insertText: string;
};

type ComposerModelOption = {
  id: 'default' | 'high' | 'xhigh';
  label: string;
  model: string | null;
  reasoning: ReasoningEffort | null;
};

type SlashTrigger = {
  start: number;
  end: number;
  query: string;
  activeIndex: number;
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
  slashCommands?: ComposerSlashCommand[];
  slashCommandsLoading?: boolean;
  slashCommandsError?: string;
  draftRequest?: ComposerDraftRequest;
  onPermissionChange?(permission: ProjectPermission): void;
  onDraftApplied?(id: number): void;
  onSubmit(prompt: string, config: ComposerRunConfig): void;
}) {
  const [prompt, setPrompt] = useState('');
  const [selectedPermission, setSelectedPermission] = useState<ProjectPermission>(props.permission);
  const [selectedModel, setSelectedModel] = useState(() => modelOptionForConfig(props.model, props.reasoning));
  const [openMenu, setOpenMenu] = useState<'add' | 'permission' | 'model' | null>(null);
  const [slashTrigger, setSlashTrigger] = useState<SlashTrigger | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scheduledDraftIdRef = useRef<number>();
  const appliedDraftIdRef = useRef<number>();
  const trimmedPrompt = prompt.trim();

  useEffect(() => {
    setSelectedPermission(props.permission);
  }, [props.permission, props.projectName]);

  useEffect(() => {
    setSelectedModel(modelOptionForConfig(props.model, props.reasoning));
  }, [props.model, props.reasoning, props.projectName]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;

    textarea.style.height = 'auto';
    const contentHeight = Math.max(textarea.scrollHeight, TEXTAREA_MIN_HEIGHT);
    const nextHeight = Math.min(contentHeight, TEXTAREA_MAX_HEIGHT);
    const isOverflowing = contentHeight > TEXTAREA_MAX_HEIGHT;
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = isOverflowing ? 'auto' : 'hidden';
    textarea.scrollTop = isOverflowing ? textarea.scrollHeight : 0;
  }, [prompt]);

  useEffect(() => {
    const draftRequest = props.draftRequest;
    if (draftRequest === undefined) return;
    if (appliedDraftIdRef.current === draftRequest.id) return;
    if (scheduledDraftIdRef.current === draftRequest.id) return;

    scheduledDraftIdRef.current = draftRequest.id;
    setPrompt(draftRequest.text);
    setSlashTrigger(null);
    setOpenMenu(null);

    const frameId = window.requestAnimationFrame(() => {
      scheduledDraftIdRef.current = undefined;
      const textarea = textareaRef.current;
      if (textarea === null) return;
      const caret = draftRequest.text.length;
      textarea.focus();
      textarea.setSelectionRange(caret, caret);
      appliedDraftIdRef.current = draftRequest.id;
      props.onDraftApplied?.(draftRequest.id);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (scheduledDraftIdRef.current === draftRequest.id) {
        scheduledDraftIdRef.current = undefined;
      }
    };
  }, [props.draftRequest, props.onDraftApplied]);

  const selectedPermissionOption = permissionOptions.find(option => option.value === selectedPermission) ?? permissionOptions[0]!;
  const slashCommands = props.slashCommands ?? [];
  const filteredSlashCommands = useMemo(
    () => filterSlashCommands(slashCommands, slashTrigger?.query ?? ''),
    [slashCommands, slashTrigger?.query]
  );
  const groupedSlashCommands = useMemo(
    () => groupSlashCommands(filteredSlashCommands),
    [filteredSlashCommands]
  );
  const slashMenuOpen = slashTrigger !== null;
  const canSubmit = !props.disabled && trimmedPrompt.length > 0;
  const submitPrompt = () => {
    if (!canSubmit) return;
    props.onSubmit(trimmedPrompt, {
      permission: selectedPermission,
      model: selectedModel.model,
      reasoning: selectedModel.reasoning
    });
    setPrompt('');
    setSlashTrigger(null);
  };

  useEffect(() => {
    if (slashTrigger === null) return;
    if (filteredSlashCommands.length === 0) return;
    if (slashTrigger.activeIndex < filteredSlashCommands.length) return;
    setSlashTrigger({ ...slashTrigger, activeIndex: 0 });
  }, [filteredSlashCommands.length, slashTrigger]);

  const updatePrompt = (value: string, caret: number) => {
    setPrompt(value);
    const nextTrigger = props.disabled ? null : findSlashTrigger(value, caret);
    setSlashTrigger(nextTrigger);
    if (nextTrigger !== null) setOpenMenu(null);
  };

  const applySlashCommand = (command: ComposerSlashCommand) => {
    if (slashTrigger === null) return;

    const nextPrompt = `${prompt.slice(0, slashTrigger.start)}${command.insertText}${prompt.slice(slashTrigger.end)}`;
    const nextCaret = slashTrigger.start + command.insertText.length;
    setPrompt(nextPrompt);
    setSlashTrigger(null);
    setOpenMenu(null);

    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashTrigger !== null) {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSlashTrigger(null);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashTrigger({
          ...slashTrigger,
          activeIndex: nextSlashCommandIndex(slashTrigger.activeIndex, filteredSlashCommands.length, 1)
        });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashTrigger({
          ...slashTrigger,
          activeIndex: nextSlashCommandIndex(slashTrigger.activeIndex, filteredSlashCommands.length, -1)
        });
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const command = filteredSlashCommands[slashTrigger.activeIndex];
        if (command !== undefined) {
          event.preventDefault();
          applySlashCommand(command);
          return;
        }
      }
    }

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
      <div className="composer-input-wrap">
        <textarea
          ref={textareaRef}
          aria-label="输入任务"
          aria-autocomplete="list"
          aria-controls={slashMenuOpen ? 'composer-slash-menu' : undefined}
          aria-expanded={slashMenuOpen}
          rows={1}
          value={prompt}
          disabled={props.disabled}
          onChange={(event) => updatePrompt(event.target.value, event.target.selectionStart)}
          onClick={(event) => updatePrompt(prompt, event.currentTarget.selectionStart)}
          onKeyDown={handlePromptKeyDown}
          placeholder={props.disabled ? props.disabledReason ?? '当前对话不可用' : '随心输入'}
        />
        {slashMenuOpen ? (
          <div
            id="composer-slash-menu"
            className="composer-popover composer-slash-menu"
            role="listbox"
            aria-label="能力菜单"
          >
            {props.slashCommandsLoading ? <div className="composer-slash-status" role="status">正在加载本机能力</div> : null}
            {props.slashCommandsError ? <div className="composer-slash-status composer-slash-status-error">{props.slashCommandsError}</div> : null}
            {!props.slashCommandsLoading && filteredSlashCommands.length === 0 ? (
              <div className="composer-slash-status">没有匹配的能力</div>
            ) : null}
            {groupedSlashCommands.map(group => (
              <div key={group.category} className="composer-slash-group" role="presentation">
                <div className="composer-slash-group-label">{slashCategoryLabel(group.category)}</div>
                {group.commands.map(command => {
                  const commandIndex = filteredSlashCommands.findIndex(item => item.id === command.id);
                  return (
                    <button
                      key={command.id}
                      className={`composer-menu-item composer-slash-item${slashTrigger.activeIndex === commandIndex ? ' is-active' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={slashTrigger.activeIndex === commandIndex}
                      onMouseEnter={() => setSlashTrigger({ ...slashTrigger, activeIndex: commandIndex })}
                      onClick={() => applySlashCommand(command)}
                    >
                      <span className="composer-menu-icon" aria-hidden="true">{slashCategoryIcon(command.category)}</span>
                      <span>
                        <strong>{command.label}</strong>
                        <small>{command.description}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="composer-toolbar">
        <div className="composer-left-actions">
          <div className="composer-control-wrap">
            <button
              className="composer-icon-button"
              type="button"
              aria-label="添加上下文"
              aria-expanded={openMenu === 'add'}
              onClick={() => {
                setSlashTrigger(null);
                setOpenMenu(openMenu === 'add' ? null : 'add');
              }}
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
              onClick={() => {
                setSlashTrigger(null);
                setOpenMenu(openMenu === 'permission' ? null : 'permission');
              }}
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
              onClick={() => {
                setSlashTrigger(null);
                setOpenMenu(openMenu === 'model' ? null : 'model');
              }}
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

function findSlashTrigger(value: string, caret: number): SlashTrigger | null {
  const beforeCaret = value.slice(0, caret);
  const tokenStart = Math.max(beforeCaret.lastIndexOf(' '), beforeCaret.lastIndexOf('\n'), beforeCaret.lastIndexOf('\t')) + 1;
  const token = beforeCaret.slice(tokenStart);
  if (!token.startsWith('/')) return null;
  if (token.slice(1).includes('/')) return null;

  return {
    start: tokenStart,
    end: caret,
    query: token.slice(1),
    activeIndex: 0
  };
}

function filterSlashCommands(commands: ComposerSlashCommand[], query: string): ComposerSlashCommand[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) return commands;

  return commands.filter(command => {
    const haystack = `${command.label} ${command.description} ${command.category}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}

function groupSlashCommands(commands: ComposerSlashCommand[]): Array<{
  category: ComposerSlashCommand['category'];
  commands: ComposerSlashCommand[];
}> {
  return (['skill', 'mcp', 'goal'] as const)
    .map(category => ({ category, commands: commands.filter(command => command.category === category) }))
    .filter(group => group.commands.length > 0);
}

function nextSlashCommandIndex(current: number, length: number, delta: 1 | -1): number {
  if (length <= 0) return 0;
  return (current + delta + length) % length;
}

function slashCategoryLabel(category: ComposerSlashCommand['category']): string {
  if (category === 'skill') return 'Skills';
  if (category === 'mcp') return 'MCP';
  return 'Goal';
}

function slashCategoryIcon(category: ComposerSlashCommand['category']) {
  if (category === 'skill') return <Sparkles size={15} />;
  if (category === 'mcp') return <Cable size={15} />;
  return <Target size={15} />;
}
