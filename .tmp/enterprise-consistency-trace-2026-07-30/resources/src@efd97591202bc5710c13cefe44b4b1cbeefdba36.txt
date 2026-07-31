import type { Page, Route } from '@playwright/test';

export type FakeEnterpriseRequest = {
  method: string;
  path: string;
  bodyKeys: string[];
};

export type FakeEnterpriseState = {
  session: 'signed_out' | 'signed_in';
  installed: boolean;
  createdThread: boolean;
};

const runtimePrefix = '/.clawee/runtime';
const project = {
  id: 'project-enterprise',
  name: '企业项目',
  cwd: '/workspace/enterprise',
  canonicalCwd: '/workspace/enterprise',
  directoryState: 'available',
  profile: 'default',
  model: null,
  reasoning: null,
  sandbox: 'workspace-write',
  status: 'active',
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  archivedAt: null
};

export class FakeEnterpriseDaemon {
  private state: FakeEnterpriseState = {
    session: 'signed_out',
    installed: false,
    createdThread: false
  };
  private requests: FakeEnterpriseRequest[] = [];
  private unknownPaths: string[] = [];

  reset(): void {
    this.state = {
      session: 'signed_out',
      installed: false,
      createdThread: false
    };
    this.requests = [];
    this.unknownPaths = [];
  }

  async attach(page: Page): Promise<void> {
    await page.route('**/.clawee/runtime-config', route => route.fulfill({
      json: { baseUrl: runtimePrefix }
    }));
    await page.route('**/.clawee/runtime/**', route => this.handle(route));
  }

  snapshot(): FakeEnterpriseState {
    return { ...this.state };
  }

  requestLog(): FakeEnterpriseRequest[] {
    return this.requests.map(request => ({
      ...request,
      bodyKeys: [...request.bodyKeys]
    }));
  }

  unknownRequestPaths(): string[] {
    return [...this.unknownPaths];
  }

  private async handle(route: Route): Promise<void> {
    const request = route.request();
    const url = new URL(request.url());
    const path = `${url.pathname.slice(runtimePrefix.length)}${url.search}` || '/';
    const body = readBodyKeys(request.postData());
    this.requests.push({
      method: request.method(),
      path,
      bodyKeys: body.keys
    });

    if (path === '/healthz') return fulfill(route, { ok: true });
    if (path === '/codex/status') return fulfill(route, codexStatus());
    if (path === '/projects/migrations/local-storage-v1' && request.method() === 'POST') {
      return fulfill(route, {
        status: 'applied',
        projectIdMap: {},
        assignedThreadIds: [],
        unassignedThreadIds: []
      });
    }
    if (path === '/projects?status=active' || path === '/projects?status=all') {
      return fulfill(route, { projects: [project] });
    }
    if (path.startsWith('/threads?') && path.includes('assignment=unassigned')) {
      return fulfill(route, { threads: [] });
    }
    if (
      path === '/threads?status=active&limit=50'
      || path === '/threads?status=active&excludePurpose=schedule_task&limit=50'
    ) {
      return fulfill(route, {
        threads: this.state.createdThread ? [createdThread()] : []
      });
    }
    if (path === '/threads?status=active&purpose=schedule_task&limit=100') {
      return fulfill(route, { threads: [] });
    }
    if (path.startsWith('/tasks?')) return fulfill(route, { tasks: [], hasMore: false });
    if (path === '/schedules') return fulfill(route, { schedules: [] });
    if (path === '/enterprise/session') return fulfill(route, sessionResponse(this.state.session));
    if (path === '/enterprise/session/refresh' && request.method() === 'POST') {
      return fulfill(route, sessionResponse(this.state.session));
    }
    if (path === '/enterprise/login' && request.method() === 'POST') {
      this.state.session = 'signed_in';
      return fulfill(route, sessionResponse('signed_in'));
    }
    if (path === '/enterprise/logout' && request.method() === 'POST') {
      this.state.session = 'signed_out';
      return fulfill(route, sessionResponse('signed_out'));
    }
    if (path === '/enterprise/skills' && request.method() === 'GET') {
      return fulfill(route, {
        skills: [enterpriseSkill(this.state.installed)],
        refreshedAt: '2026-07-30T08:00:00.000Z'
      });
    }
    if (path === '/enterprise/skills/enterprise-skill' && request.method() === 'GET') {
      return fulfill(route, {
        ...enterpriseSkill(this.state.installed),
        changelog: '改进企业知识检索和输出格式。'
      });
    }
    if (
      path === '/enterprise/skills/enterprise-skill/install'
      && request.method() === 'POST'
    ) {
      this.state.installed = true;
      return fulfill(route, {
        skill: enterpriseSkill(true),
        localSkill: localSkill(),
        operation: {}
      });
    }
    if (path === '/codex/skills') {
      return fulfill(route, {
        codexHome: '/tmp/codex',
        codexHomeMode: 'global',
        skillsPath: '/tmp/codex/skills',
        skillsWritable: true,
        requiresWriteConfirmation: false,
        skills: this.state.installed ? [localSkill()] : [],
        diagnostics: []
      });
    }
    if (path === '/codex/mcp') {
      return fulfill(route, {
        codexHome: '/tmp/codex',
        codexHomeMode: 'global',
        requiresWriteConfirmation: false,
        servers: [],
        diagnostics: []
      });
    }
    if (path === '/codex/profiles') {
      return fulfill(route, {
        codexHome: '/tmp/codex',
        codexHomeMode: 'global',
        writable: true,
        baseConfigValid: true,
        profiles: [],
        diagnostics: []
      });
    }
    if (path === '/codex/skill-market/install-records') {
      return fulfill(route, { records: [] });
    }
    if (path === '/threads' && request.method() === 'POST') {
      this.state.createdThread = true;
      return fulfill(route, { thread: createdThread() }, 201);
    }
    if (path === '/threads/thread-enterprise-skill/history?limit=50') {
      return fulfill(route, {
        threadId: 'thread-enterprise-skill',
        codexThreadId: null,
        items: []
      });
    }
    if (path === '/threads/thread-enterprise-skill/runs?limit=50') {
      return fulfill(route, { runs: [] });
    }

    this.unknownPaths.push(`${request.method()} ${path}`);
    return fulfill(route, {
      error: {
        code: 'FAKE_RUNTIME_ROUTE_NOT_FOUND',
        message: `Unhandled fake Runtime route: ${request.method()} ${path}`
      }
    }, 404);
  }
}

function readBodyKeys(raw: string | null): { keys: string[] } {
  if (raw === null || raw.length === 0) return { keys: [] };
  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { keys: [] };
    }
    return { keys: Object.keys(value).sort() };
  } catch {
    return { keys: [] };
  }
}

function sessionResponse(status: 'signed_out' | 'signed_in') {
  return status === 'signed_in'
    ? {
        status,
        account: {
          email: 'member@example.com',
          name: 'Enterprise Member'
        },
        expiresAt: '2026-08-30T12:00:00.000Z',
        transportSecurity: 'secure_https'
      }
    : {
        status,
        transportSecurity: 'secure_https'
      };
}

function enterpriseSkill(installed: boolean) {
  return {
    skillId: 'enterprise-skill',
    name: 'enterprise-name',
    description: '企业知识检索与报告生成',
    version: '1.0.0',
    ...(installed ? { installedVersion: '1.0.0' } : {}),
    updatedAt: '2026-07-30T08:00:00.000Z',
    status: installed ? 'installed' : 'not_installed',
    integrity: installed ? 'verified' : 'not_applicable',
    actions: installed ? ['use'] : ['install']
  };
}

function localSkill() {
  return {
    id: 'enterprise-name',
    name: 'enterprise-name',
    description: '企业知识检索与报告生成',
    status: 'valid',
    diagnostics: [],
    codexHome: '/tmp/codex',
    codexHomeMode: 'global',
    skillsPath: '/tmp/codex/skills',
    skillPath: '/tmp/codex/skills/enterprise-name',
    skillFilePath: '/tmp/codex/skills/enterprise-name/SKILL.md'
  };
}

function createdThread() {
  return {
    id: 'thread-enterprise-skill',
    title: 'enterprise-name',
    projectId: project.id,
    origin: 'clawee_created',
    codexThreadId: null,
    cwd: project.cwd,
    canonicalCwd: project.canonicalCwd,
    workspaceMode: 'external',
    profile: 'default',
    model: null,
    reasoning: null,
    sandbox: 'workspace-write',
    status: 'active',
    purpose: 'conversation',
    createdAt: '2026-07-30T08:00:00.000Z',
    updatedAt: '2026-07-30T08:00:00.000Z',
    archivedAt: null
  };
}

function codexStatus() {
  return {
    codexBin: 'codex',
    codexVersion: 'codex-cli enterprise-e2e',
    codexHome: '/tmp/codex',
    codexHomeMode: 'global',
    codexHomeSource: 'default',
    codexHomeWritable: true,
    capabilities: {},
    diagnostics: []
  };
}

function fulfill(route: Route, value: unknown, status = 200): Promise<void> {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(value)
  });
}
