import type {
  CodexHomeMode,
  CodexSkillOperationResponse,
  CodexSkillOperationStatus,
  CodexSkillOperationType,
  CodexSkillResponse,
  CodexSkillStatus
} from '@opencreator/protocol';

export type {
  CodexSkillOperationResponse,
  CodexSkillOperationStatus,
  CodexSkillOperationType,
  CodexSkillResponse,
  CodexSkillStatus
};

export type SkillMetadata = {
  name: string;
  description: string;
};

export type ParseSkillMarkdownResult =
  | { ok: true; metadata: SkillMetadata; diagnostics: string[] }
  | { ok: false; diagnostics: string[] };

export type SkillScanResult = {
  codexHome: string;
  codexHomeMode: CodexHomeMode;
  skillsPath: string;
  skillsWritable: boolean;
  requiresWriteConfirmation: boolean;
  skills: CodexSkillResponse[];
  diagnostics: string[];
};

export type InstallSkillInput = {
  sourcePath: string;
  id?: string;
  overwrite?: boolean;
  confirmWriteToCodexHome?: true;
};
