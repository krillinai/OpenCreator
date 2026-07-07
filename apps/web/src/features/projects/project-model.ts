export type ProjectPermission = 'follow-global' | 'workspace-write' | 'danger-full-access';

export type ClaweeProject = {
  id: string;
  name: string;
  cwd: string;
  sandbox: ProjectPermission;
  profile: string;
  model: string;
  reasoning: string;
};

export type ClaweeConversation = {
  id: string;
  projectId: string;
  title: string;
  updatedLabel: string;
};

const defaultRuntime = {
  profile: 'default',
  model: '5.5',
  reasoning: 'xhigh'
} as const;

export function createDefaultProjects(): ClaweeProject[] {
  return [
    createProject('playground', 'Playground', '~/develop/clawee/playground', 'follow-global'),
    createProject('content-design', 'content-design', '~/develop/content-design', 'danger-full-access'),
    createProject('bili', 'bili', '~/develop/clawee/bili', 'follow-global'),
    createProject('default', 'default', '~/develop/clawee/default', 'follow-global'),
    createProject('feigua', 'feigua', '~/develop/clawee/feigua', 'follow-global'),
    createProject('cover', 'cover', '~/develop/clawee/cover', 'follow-global')
  ];
}

export function findProjectById(projects: ClaweeProject[], projectId: string): ClaweeProject | undefined {
  return projects.find((project) => project.id === projectId);
}

export function listRecentConversations(): ClaweeConversation[] {
  return [
    createConversation('weekly-progress-brief', '整理本周项目进展', '4天'),
    createConversation('meeting-action-items', '提炼会议待办事项', '5天'),
    createConversation('review-project-design', '评审项目设计', '1周'),
    createConversation('check-content-pipeline-progress', '检查内容产线进度', '1周'),
    createConversation('summarize-team-updates', '汇总团队最新更新', '3周')
  ];
}

function createProject(id: string, name: string, cwd: string, sandbox: ProjectPermission): ClaweeProject {
  return {
    id,
    name,
    cwd,
    sandbox,
    ...defaultRuntime
  };
}

function createConversation(id: string, title: string, updatedLabel: string): ClaweeConversation {
  return {
    id,
    projectId: 'content-design',
    title,
    updatedLabel
  };
}
