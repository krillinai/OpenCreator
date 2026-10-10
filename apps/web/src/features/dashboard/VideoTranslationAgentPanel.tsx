import type { ReactNode } from 'react';
import CreatorCollaborationPanel, {
  type CreatorPanelQuickAction
} from './CreatorCollaborationPanel.js';
import { videoTranslationPanelAdapter } from './creator-panel-adapters.js';

export type VideoTranslationAgentQuickAction = CreatorPanelQuickAction;

export default function VideoTranslationAgentPanel(props: {
  stepLabel: string;
  contextSummary: string;
  taskSummary?: ReactNode;
  promptHint?: string;
  currentIssue?: string;
  quickActions?: VideoTranslationAgentQuickAction[];
  onCancelTask?(): void;
  onResumeTask?(): void;
  taskControlPending?: 'canceling' | 'resuming';
}) {
  return (
    <CreatorCollaborationPanel
      {...props}
      adapter={videoTranslationPanelAdapter}
    />
  );
}
