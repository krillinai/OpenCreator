import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreatorJob } from '@opencreator/protocol';
import { describe, expect, it, vi } from 'vitest';
import ProjectsPage, { youtubeThumbnailUrls } from './ProjectsPage.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';

const workspaces = [{
  id: 'workspace_1',
  name: '默认工作目录',
  cwd: '/projects/default',
  sandbox: 'follow-global' as const,
  profile: 'default',
  model: null,
  reasoning: null
}];

const jobs = [
  creatorJob({
    id: 'job_cover',
    templateId: 'cover',
    state: { prompt: '夏季新品封面' },
    updatedAt: '2026-08-18T10:00:00.000Z'
  }),
  creatorJob({
    id: 'job_translation',
    templateId: 'video-translation',
    state: { sourceUrl: 'https://www.youtube.com/watch?v=launch-talk' },
    updatedAt: '2026-08-17T10:00:00.000Z',
    artifacts: [
      artifact('job_translation', 'target_subtitle', 'target.srt'),
      artifact('job_translation', 'horizontal_video', 'translated.mp4')
    ]
  }),
  creatorJob({
    id: 'job_stickman',
    templateId: 'stickman-video',
    state: { topic: '如何建立内容创作流程' },
    updatedAt: '2026-08-19T10:00:00.000Z'
  })
];

describe('ProjectsPage', () => {
  it('shows real Creator jobs as recent projects in the selected language', () => {
    render(
      <LanguageProvider initialPreference="en-US">
        <ProjectsPage jobs={jobs} workspaces={workspaces} onOpenJob={vi.fn()} />
      </LanguageProvider>
    );

    expect(screen.getByRole('heading', { name: 'My Projects' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recent projects' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project 夏季新品封面' })).toBeInTheDocument();
    expect(screen.getByText('Thumbnail generation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project 夏季新品封面' }))
      .toHaveTextContent('默认工作目录');
    expect(screen.getByRole('button', { name: 'Open project youtube.com · launch-talk' }).querySelector('img'))
      .toHaveAttribute('src', 'https://i.ytimg.com/vi/launch-talk/maxresdefault.jpg');
  });

  it('derives platform thumbnails from supported YouTube URL forms', () => {
    expect(youtubeThumbnailUrls('https://www.youtube.com/watch?v=dCwXjBa_jNs')[0])
      .toBe('https://i.ytimg.com/vi/dCwXjBa_jNs/maxresdefault.jpg');
    expect(youtubeThumbnailUrls('https://youtu.be/dCwXjBa_jNs')[1])
      .toBe('https://i.ytimg.com/vi/dCwXjBa_jNs/hqdefault.jpg');
    expect(youtubeThumbnailUrls('https://youtube.com/shorts/dCwXjBa_jNs')).toHaveLength(2);
    expect(youtubeThumbnailUrls('https://www.bilibili.com/video/BV1test')).toEqual([]);
  });

  it('falls back from unavailable platform thumbnails to the authenticated runtime cover', async () => {
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:project-cover')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    const service = {
      openProjectCover: vi.fn(async () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' })))
    };
    const rendered = render(
      <ProjectsPage
        jobs={[jobs[1]!]}
        workspaces={workspaces}
        service={service}
        onOpenJob={vi.fn()}
      />
    );
    try {
      const image = screen.getByRole('button', { name: '打开项目 youtube.com · launch-talk' }).querySelector('img')!;
      fireEvent.error(image);
      expect(image).toHaveAttribute('src', 'https://i.ytimg.com/vi/launch-talk/hqdefault.jpg');
      fireEvent.error(image);
      await waitFor(() => expect(service.openProjectCover).toHaveBeenCalledWith('job_translation'));
      await waitFor(() => expect(image).toHaveAttribute('src', 'blob:project-cover'));
    } finally {
      rendered.unmount();
      restoreUrlMethod('createObjectURL', createObjectUrlDescriptor);
      restoreUrlMethod('revokeObjectURL', revokeObjectUrlDescriptor);
    }
  });

  it('orders recent projects by their actual update time and opens the exact job', () => {
    const onOpenJob = vi.fn();
    render(<ProjectsPage jobs={jobs} workspaces={workspaces} onOpenJob={onOpenJob} />);

    const buttons = within(screen.getByRole('list', { name: '项目列表' }))
      .getAllByRole('button', { name: /^打开项目/ });
    expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
      '打开项目 如何建立内容创作流程',
      '打开项目 夏季新品封面',
      '打开项目 youtube.com · launch-talk'
    ]);

    fireEvent.click(screen.getByRole('button', { name: '打开项目 youtube.com · launch-talk' }));
    expect(onOpenJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job_translation' }));
  });

  it('explains that Workbench templates create new projects when the history is empty', () => {
    render(<ProjectsPage jobs={[]} workspaces={workspaces} onOpenJob={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('从工作台选择模板后会新建项目');
  });

  it('filters real Creator jobs by category and search text', () => {
    render(<ProjectsPage jobs={jobs} workspaces={workspaces} onOpenJob={vi.fn()} />);

    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(screen.getByRole('button', { name: '打开项目 夏季新品封面' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开项目 如何建立内容创作流程' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: '全部' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), {
      target: { value: 'launch-talk' }
    });
    expect(screen.getByRole('button', { name: '打开项目 youtube.com · launch-talk' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开项目 夏季新品封面' })).not.toBeInTheDocument();
  });

  it('builds the output center from persisted artifacts without synthetic files', () => {
    const onOpenJob = vi.fn();
    render(<ProjectsPage jobs={jobs} workspaces={workspaces} onOpenJob={onOpenJob} />);

    fireEvent.click(within(screen.getByRole('tablist', { name: '内容维度' }))
      .getByRole('tab', { name: '产出中心' }));

    const outputList = screen.getByRole('list', { name: '产出列表' });
    expect(within(outputList).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('target.srt')).toBeInTheDocument();
    expect(screen.getByText('translated.mp4')).toBeInTheDocument();
    expect(screen.queryByText(/最终成片|方案 01|配音音轨/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '在项目中打开产出 translated.mp4' }));
    expect(onOpenJob).toHaveBeenCalledWith(expect.objectContaining({ id: 'job_translation' }));
  });

  it('shows loading and runtime errors explicitly', () => {
    const { rerender } = render(
      <ProjectsPage jobs={[]} workspaces={workspaces} loading onOpenJob={vi.fn()} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('正在加载最近项目');

    rerender(
      <ProjectsPage jobs={[]} workspaces={workspaces} error="Creator Runtime unavailable" onOpenJob={vi.fn()} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Creator Runtime unavailable');
  });
});

function creatorJob(input: {
  id: string;
  templateId: string;
  state: CreatorJob['state'];
  updatedAt: string;
  artifacts?: CreatorJob['artifacts'];
}): CreatorJob {
  return {
    id: input.id,
    projectId: 'workspace_1',
    templateId: input.templateId,
    templateVersion: 1,
    status: input.artifacts === undefined ? 'draft' : 'completed',
    revision: 0,
    state: input.state,
    agentThreadId: null,
    stages: [],
    artifacts: input.artifacts ?? [],
    activities: [],
    createdAt: input.updatedAt,
    updatedAt: input.updatedAt
  };
}

function artifact(jobId: string, kind: string, fileName: string): CreatorJob['artifacts'][number] {
  return {
    id: `artifact_${kind}`,
    jobId,
    kind,
    version: 1,
    status: 'completed',
    path: `/outputs/${fileName}`,
    sourceArtifactIds: [],
    metadata: { fileName },
    createdAt: '2026-08-17T10:00:00.000Z'
  };
}

function restoreUrlMethod(
  key: 'createObjectURL' | 'revokeObjectURL',
  descriptor: PropertyDescriptor | undefined
) {
  if (descriptor === undefined) delete (URL as unknown as Record<string, unknown>)[key];
  else Object.defineProperty(URL, key, descriptor);
}
