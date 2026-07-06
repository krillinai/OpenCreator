import { useState } from 'react';

export function Composer(props: { disabled?: boolean; onSubmit(prompt: string): void }) {
  const [prompt, setPrompt] = useState('');

  return (
    <form
      className="composer"
      onSubmit={(event) => {
        event.preventDefault();
        if (props.disabled) return;
        const trimmed = prompt.trim();
        if (trimmed.length === 0) return;
        props.onSubmit(trimmed);
        setPrompt('');
      }}
    >
      <textarea
        aria-label="输入任务"
        value={prompt}
        disabled={props.disabled}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={props.disabled ? '当前会话有任务运行中' : '输入要交给 Agent 的任务...'}
      />
      <button type="submit" disabled={props.disabled || prompt.trim().length === 0}>
        发送
      </button>
    </form>
  );
}
