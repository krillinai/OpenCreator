import { createIndexedDbStore } from '../storage/indexed-db.js';

export type DataSource = 'runtime' | 'mock';

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

export type MockFileServiceOptions = {
  databaseName?: string;
};

const seedFiles: WorkspaceFile[] = [
  {
    path: 'docs/design/enterprise-agent-workbench.md',
    name: 'enterprise-agent-workbench.md',
    language: 'markdown',
    content: '# 企业 Agent 工作台 UI 方案\n\n这是 mock workspace 中的 Markdown 文件。',
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  },
  {
    path: 'transcripts/demo-agent-task.srt',
    name: 'demo-agent-task.srt',
    language: 'srt',
    content: '1\n00:00:00,000 --> 00:00:03,200\nWe need an agent UI.\n',
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  },
  {
    path: 'screens/workbench.html',
    name: 'workbench.html',
    language: 'html',
    content: '<main class="workbench">Agent 对话</main>\n',
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  },
  {
    path: 'notes/release-notes.txt',
    name: 'release-notes.txt',
    language: 'text',
    content: 'Agent Workbench v0.2\n',
    saved: true,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  }
];

export function createMockFileService(options: MockFileServiceOptions = {}) {
  const store = createIndexedDbStore(options.databaseName);

  async function openFile(path: string): Promise<WorkspaceFile> {
    const stored = await store.getFile(path);
    const seed = seedFiles.find(file => file.path === path);
    if (stored !== undefined) {
      return { ...(seed ?? createEmptyFile(path)), content: stored.content, updatedAt: stored.updatedAt, dirty: false, saved: true };
    }
    return seed ?? createEmptyFile(path);
  }

  return {
    async listTree(): Promise<FileTreeNode[]> {
      return [
        { type: 'folder', name: 'docs', path: 'docs', depth: 0 },
        { type: 'folder', name: 'design', path: 'docs/design', depth: 1 },
        {
          type: 'file',
          name: 'enterprise-agent-workbench.md',
          path: 'docs/design/enterprise-agent-workbench.md',
          depth: 2,
          language: 'markdown'
        },
        { type: 'folder', name: 'transcripts', path: 'transcripts', depth: 0 },
        { type: 'file', name: 'demo-agent-task.srt', path: 'transcripts/demo-agent-task.srt', depth: 1, language: 'srt' },
        { type: 'folder', name: 'screens', path: 'screens', depth: 0 },
        { type: 'file', name: 'workbench.html', path: 'screens/workbench.html', depth: 1, language: 'html' },
        { type: 'folder', name: 'notes', path: 'notes', depth: 0 },
        { type: 'file', name: 'release-notes.txt', path: 'notes/release-notes.txt', depth: 1, language: 'text' }
      ];
    },
    openFile,
    async saveFile(path: string, content: string): Promise<WorkspaceFile> {
      const updatedAt = new Date().toISOString();
      await store.saveFile({ path, content, updatedAt });
      return openFile(path);
    }
  };
}

function createEmptyFile(path: string): WorkspaceFile {
  return {
    path,
    name: basename(path),
    language: inferLanguage(path),
    content: '',
    saved: false,
    dirty: false,
    updatedAt: new Date(0).toISOString(),
    source: 'mock'
  };
}

function basename(path: string) {
  return path.split('/').filter(Boolean).at(-1) ?? path;
}

function inferLanguage(path: string): WorkspaceFile['language'] {
  if (path.endsWith('.md')) return 'markdown';
  if (path.endsWith('.srt')) return 'srt';
  if (path.endsWith('.html')) return 'html';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.txt')) return 'text';
  return 'unknown';
}
