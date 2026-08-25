export type DataSource = 'runtime';

export type WorkspaceFile = {
  path: string;
  name: string;
  language: 'markdown' | 'srt' | 'html' | 'text' | 'json' | 'unknown';
  content: string;
  saved: boolean;
  dirty: boolean;
  updatedAt: string;
  source: DataSource;
};

export type FileTreeNode = {
  type: 'folder' | 'file';
  name: string;
  path: string;
  depth: number;
  language?: WorkspaceFile['language'];
};

export function createUnavailableFileService() {
  return {
    async listTree(): Promise<FileTreeNode[]> {
      return [];
    },
    async openFile(): Promise<WorkspaceFile> {
      throw new Error('Workspace file runtime is unavailable');
    },
    async saveFile(): Promise<WorkspaceFile> {
      throw new Error('Workspace file runtime is unavailable');
    }
  };
}
