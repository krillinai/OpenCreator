import { LoaderCircle, Send } from 'lucide-react';
import { useState, type FormEvent } from 'react';

export type KnowledgeConversationProps = {
  disabled?: boolean;
  onSend(prompt: string): Promise<void>;
};

export function KnowledgeConversation(props: KnowledgeConversationProps) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (prompt.length === 0 || sending || props.disabled) return;
    setSending(true);
    setError(undefined);
    try {
      await props.onSend(prompt);
      setMessages(current => [...current, prompt]);
      setDraft('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '知识库对话提交失败');
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="knowledge-conversation__workspace">
      <div className="knowledge-conversation__timeline" aria-live="polite">
        {messages.length === 0 ? (
          <div className="knowledge-conversation__empty">
            <strong>询问企业知识库</strong>
            <span>回答仅基于当前账户有权访问的知识内容</span>
          </div>
        ) : messages.map((message, index) => (
          <div className="knowledge-conversation__message" key={`${index}-${message}`}>
            {message}
          </div>
        ))}
      </div>
      <form className="knowledge-conversation__composer" onSubmit={submit}>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div>
          <textarea
            aria-label="询问企业知识库"
            placeholder="询问企业知识库"
            rows={3}
            value={draft}
            disabled={props.disabled || sending}
            onChange={event => setDraft(event.target.value)}
          />
          <button
            type="submit"
            aria-label="发送知识库问题"
            disabled={props.disabled || sending || draft.trim().length === 0}
          >
            {sending
              ? <LoaderCircle className="knowledge-spinner" size={17} aria-hidden="true" />
              : <Send size={17} aria-hidden="true" />}
          </button>
        </div>
      </form>
    </div>
  );
}
