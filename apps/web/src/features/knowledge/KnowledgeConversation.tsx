import type { CodexModelResponse } from '@clawee/protocol';
import { useState } from 'react';
import { Composer } from '../runs/Composer.js';

export type KnowledgeConversationProps = {
  disabled?: boolean;
  models?: readonly CodexModelResponse[];
  modelsLoading?: boolean;
  modelsError?: string;
  onSend(prompt: string): Promise<void>;
};

export function KnowledgeConversation(props: KnowledgeConversationProps) {
  const [messages, setMessages] = useState<string[]>([]);
  const [error, setError] = useState<string>();

  return (
    <section className="conversation-page knowledge-conversation__workspace">
      <div className="conversation-body knowledge-conversation__timeline" aria-live="polite">
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
      <div className="composer-wrap">
        {error === undefined ? null : (
          <p className="knowledge-conversation__composer-error" role="alert">{error}</p>
        )}
        <Composer
          disabled={props.disabled}
          disabledReason="本地运行内核未连接"
          projectId=""
          projectName=""
          projects={[]}
          showProjectSelector={false}
          permission="workspace-write"
          permissionChangeDisabled
          profile="default"
          model={null}
          reasoning={null}
          models={props.models}
          modelsLoading={props.modelsLoading}
          modelsError={props.modelsError}
          imageInputSupported={false}
          imageInputUnsupportedReason="知识库对话不支持附件"
          onSelectProject={() => undefined}
          onSubmit={async prompt => {
            setError(undefined);
            try {
              await props.onSend(prompt);
              setMessages(current => [...current, prompt]);
            } catch (reason) {
              setError(reason instanceof Error ? reason.message : '知识库对话提交失败');
              return false;
            }
          }}
        />
      </div>
    </section>
  );
}
