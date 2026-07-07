import { useState } from 'react';
import { Plus, SendHorizontal } from 'lucide-react';
import type { ProjectPermission } from '../projects/project-model.js';

const permissionLabels: Record<ProjectPermission, string> = {
  'danger-full-access': '完全访问',
  'workspace-write': '工作区读写',
  'follow-global': '跟随全局配置'
};

export function Composer(props: {
  disabled?: boolean;
  projectName: string;
  branchName: string;
  permission: ProjectPermission;
  modelLabel: string;
  onSubmit(prompt: string): void;
}) {
  const [prompt, setPrompt] = useState('');
  const trimmedPrompt = prompt.trim();

  return (
    <form
      className="clawee-composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.disabled) return;
        if (trimmedPrompt.length === 0) return;
        props.onSubmit(trimmedPrompt);
        setPrompt('');
      }}
    >
      <textarea
        aria-label="输入任务"
        value={prompt}
        disabled={props.disabled}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={props.disabled ? '当前对话有任务运行中' : '随心输入'}
      />
      <div className="composer-toolbar">
        <div className="composer-left-actions">
          <button className="composer-icon-button" type="button" aria-label="添加" disabled={props.disabled}>
            <Plus aria-hidden="true" size={16} />
          </button>
          <span className="composer-pill" role="status">
            {permissionLabels[props.permission]}
          </span>
          <span className="composer-pill" role="status">
            {props.modelLabel}
          </span>
        </div>
        <div className="composer-right-actions">
          <div className="composer-context" aria-label="会话上下文">
            <span>{props.projectName}</span>
            <span>本地模式</span>
            <span>{props.branchName}</span>
          </div>
          <button
            className="composer-send"
            type="submit"
            aria-label="发送"
            disabled={props.disabled || trimmedPrompt.length === 0}
          >
            <SendHorizontal aria-hidden="true" size={16} />
          </button>
        </div>
      </div>
    </form>
  );
}
