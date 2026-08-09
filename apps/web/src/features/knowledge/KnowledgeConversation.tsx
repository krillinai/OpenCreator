import type { CodexModelResponse } from '@clawee/protocol';
import { Timeline } from '../../components/timeline/Timeline.js';
import type { TimelineItem } from '../../components/timeline/timeline-model.js';
import { Composer, type ComposerSlashCommand } from '../runs/Composer.js';

export type KnowledgeConversationProps = {
  disabled?: boolean;
  models?: readonly CodexModelResponse[];
  modelsLoading?: boolean;
  modelsError?: string;
  slashCommands?: ComposerSlashCommand[];
  slashCommandsLoading?: boolean;
  slashCommandsError?: string;
  items: TimelineItem[];
  running?: boolean;
  error?: string;
  onSend(prompt: string): Promise<void>;
  onCancel?(): Promise<void>;
  onManageSkills?(): void;
  onManageConnectors?(): void;
};

export function KnowledgeConversation(props: KnowledgeConversationProps) {
  return (
    <section className="conversation-page knowledge-conversation__workspace">
      <div className="conversation-body knowledge-conversation__timeline" aria-live="polite">
        {props.items.length === 0 ? (
          <div className="knowledge-conversation__empty">
            <strong>询问企业知识库</strong>
            <span>回答仅基于当前账户有权访问的知识内容</span>
          </div>
        ) : <Timeline items={props.items} />}
      </div>
      <div className="composer-wrap">
        {props.error === undefined ? null : (
          <p className="knowledge-conversation__composer-error" role="alert">{props.error}</p>
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
          slashCommands={props.slashCommands}
          slashCommandsLoading={props.slashCommandsLoading}
          slashCommandsError={props.slashCommandsError}
          imageInputSupported={false}
          imageInputUnsupportedReason="知识库对话不支持附件"
          onSelectProject={() => undefined}
          running={props.running}
          onCancel={props.onCancel}
          onManageSkills={props.onManageSkills}
          onManageConnectors={props.onManageConnectors}
          onSubmit={props.onSend}
        />
      </div>
    </section>
  );
}
