export type DataSource = 'runtime' | 'mock';

export type Project = {
  id: string;
  name: string;
  rootPath: string;
  source: DataSource;
};

const DEFAULT_PROJECT: Project = {
  id: 'default-project',
  name: 'Clawee Agent Demo',
  rootPath: '/mock/clawee-agent',
  source: 'mock'
};

export function createMockProjectService() {
  return {
    async listProjects(): Promise<Project[]> {
      return [DEFAULT_PROJECT];
    },
    async getDefaultProject(): Promise<Project> {
      return DEFAULT_PROJECT;
    }
  };
}
