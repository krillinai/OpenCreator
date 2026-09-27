import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { CreatorJob } from '@opencreator/protocol';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import ProjectsPage, { isMeaningfulCreatorJob, youtubeThumbnailUrls } from './ProjectsPage.js';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import { ApiClientError } from '../../runtime/client.js';

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
    updatedAt: '2026-08-19T10:00:00.000Z',
    artifacts: [
      artifact('job_stickman', 'clean_video', 'landscape-clean.mp4'),
      artifact('job_stickman', 'cover_image', 'youtube-cover.png'),
      artifact('job_stickman', 'publish_copy', 'publish-copy-youtube.md'),
      artifact('job_stickman', 'bilingual_video', 'horizontal-bilingual.mp4'),
      artifact('job_stickman', 'bilingual_subtitle', 'bilingual.srt')
    ]
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
    expect(screen.getByRole('tablist', { name: 'Project categories' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Copywriting' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project 夏季新品封面' })).toBeInTheDocument();
    expect(screen.getByText('Thumbnail generation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open project 夏季新品封面' }).querySelector('img'))
      .toHaveAttribute('src', '/dashboard/templates/image-generation-project-cover.png');
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

  it('creates the selected project type from the projects page dropdown', async () => {
    const onCreateProject = vi.fn();

    render(
      <ProjectsPage
        jobs={jobs}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
        onCreateProject={onCreateProject}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '新建项目' }));
    expect(screen.getByRole('menu', { name: '项目类型' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: '创建项目' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /图像生成/ }));

    await waitFor(() => expect(screen.queryByRole('menu', { name: '项目类型' }))
      .not.toBeInTheDocument());
    expect(onCreateProject).toHaveBeenCalledOnce();
    expect(onCreateProject).toHaveBeenCalledWith(
      expect.objectContaining({ workspace: 'image-generation' })
    );
  });

  it.each([
    ['video-translation', '/dashboard/templates/video-translation-project-cover.png'],
    ['video-download', '/dashboard/templates/video-download-project-cover.png'],
    ['video-generation', '/dashboard/templates/animated-story.jpg']
  ])('uses the dedicated fallback cover for %s projects', (templateId, expectedCover) => {
    const job = creatorJob({
      id: `job_${templateId}_fallback`,
      templateId,
      updatedAt: '2026-09-05T00:00:00.000Z',
      state: { sourceUrl: 'https://www.bilibili.com/video/BV1test' }
    });

    render(<ProjectsPage jobs={[job]} workspaces={workspaces} onOpenJob={vi.fn()} />);

    expect(screen.getByRole('button', { name: '打开项目 bilibili.com · BV1test' }).querySelector('img'))
      .toHaveAttribute('src', expectedCover);
  });

  it('shows a video generation Creator job and requests its generated frame cover', async () => {
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:generated-video-cover')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    const job = creatorJob({
      id: 'job_video_generation',
      templateId: 'video-generation',
      state: { prompt: '雨夜中的未来城市' },
      updatedAt: '2026-09-07T08:00:00.000Z',
      artifacts: [artifact('job_video_generation', 'generated_video', 'generated.mp4')]
    });
    const service = {
      openProjectCover: vi.fn(async () => new Response(
        new Blob(['jpeg'], { type: 'image/jpeg' })
      ))
    };

    const rendered = render(
      <ProjectsPage
        jobs={[job]}
        workspaces={workspaces}
        service={service}
        onOpenJob={vi.fn()}
      />
    );
    try {
      expect(screen.getByText('视频生成')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '打开项目 雨夜中的未来城市' }))
        .toBeInTheDocument();
      await waitFor(() => expect(service.openProjectCover).toHaveBeenCalledWith(job.id));
      await waitFor(() => expect(
        screen.getByRole('button', { name: '打开项目 雨夜中的未来城市' }).querySelector('img')
      ).toHaveAttribute('src', 'blob:generated-video-cover'));
    } finally {
      rendered.unmount();
      restoreUrlMethod('createObjectURL', createObjectUrlDescriptor);
      restoreUrlMethod('revokeObjectURL', revokeObjectUrlDescriptor);
    }
  });

  it('uses the localized preset origin title for a preset-created project', () => {
    const job = creatorJob({
      id: 'job_preset_title',
      templateId: 'image-generation',
      state: { prompt: '内部默认提示词不应成为标题' },
      updatedAt: '2026-09-08T08:00:00.000Z',
      presetOrigin: {
        module: 'image-generation',
        id: 'ecommerce-product',
        version: 1,
        locale: 'zh-CN',
        title: '电商商品主图',
        contentHash: 'a'.repeat(64)
      }
    });

    render(<ProjectsPage jobs={[job]} workspaces={workspaces} onOpenJob={vi.fn()} />);

    expect(screen.getByRole('button', { name: '打开项目 电商商品主图' }))
      .toBeInTheDocument();
    expect(screen.queryByText('内部默认提示词不应成为标题')).not.toBeInTheDocument();
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

  it('does not request a runtime cover before a project has a cover-capable artifact', async () => {
    const service = {
      openProjectCover: vi.fn(async () => new Response())
    };
    render(
      <ProjectsPage
        jobs={[jobs[0]!]}
        workspaces={workspaces}
        service={service}
        onOpenJob={vi.fn()}
      />
    );

    await Promise.resolve();
    expect(service.openProjectCover).not.toHaveBeenCalled();
  });

  it('keeps the uploaded video cover request alive under StrictMode', async () => {
    const createObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
    const revokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:uploaded-video-cover')
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn()
    });
    const localVideoJob = creatorJob({
      id: 'job_local_video',
      templateId: 'video-translation',
      state: { sourceType: 'file', sourceFileName: 'uploaded-video.mp4' },
      updatedAt: '2026-08-29T02:09:40.694Z',
      artifacts: [artifact('job_local_video', 'source_video', 'uploaded-video.mp4')]
    });
    const service = {
      openProjectCover: vi.fn(async () => new Response(new Blob(['jpeg'], { type: 'image/jpeg' })))
    };
    const rendered = render(
      <StrictMode>
        <ProjectsPage
          jobs={[localVideoJob]}
          workspaces={workspaces}
          service={service}
          onOpenJob={vi.fn()}
        />
      </StrictMode>
    );
    try {
      const image = screen.getByRole('button', { name: '打开项目 uploaded-video.mp4' }).querySelector('img')!;
      await waitFor(() => expect(image).toHaveAttribute('src', 'blob:uploaded-video-cover'));
      expect(service.openProjectCover).toHaveBeenCalledWith('job_local_video');
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

  it('confirms before deleting the exact creator project', async () => {
    const onDeleteJob = vi.fn(async () => undefined);
    render(
      <ProjectsPage
        jobs={jobs}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
        onDeleteJob={onDeleteJob}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '删除项目 夏季新品封面' }));
    const dialog = screen.getByRole('alertdialog', { name: '删除项目' });
    expect(dialog).toHaveTextContent('项目记录及创作历史将无法恢复');
    const deleteFiles = within(dialog).getByRole('checkbox', { name: '同时删除项目文件' });
    expect(deleteFiles).not.toBeChecked();

    fireEvent.click(within(dialog).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(onDeleteJob).toHaveBeenCalledWith('job_cover', { deleteFiles: false }));
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '删除项目' }))
      .not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: '删除项目 夏季新品封面' }));
    const dialogWithFiles = screen.getByRole('alertdialog', { name: '删除项目' });
    const deleteFilesAfterReopen = within(dialogWithFiles)
      .getByRole('checkbox', { name: '同时删除项目文件' });
    expect(deleteFilesAfterReopen).not.toBeChecked();
    fireEvent.click(deleteFilesAfterReopen);
    fireEvent.click(within(dialogWithFiles).getByRole('button', { name: '删除' }));
    await waitFor(() => expect(onDeleteJob)
      .toHaveBeenLastCalledWith('job_cover', { deleteFiles: true }));
  });

  it('selects projects without opening them and selects only the current search results', () => {
    const onOpenJob = vi.fn();
    render(
      <ProjectsPage
        jobs={jobs}
        workspaces={workspaces}
        onOpenJob={onOpenJob}
        onDeleteJob={vi.fn(async () => undefined)}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '批量管理' }));
    fireEvent.click(screen.getByRole('button', { name: '选择项目 如何建立内容创作流程' }));
    expect(onOpenJob).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: '选择项目 如何建立内容创作流程' })).toBeChecked();
    expect(screen.getByText('已选择 1 个')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), {
      target: { value: '夏季新品' }
    });
    fireEvent.click(screen.getByRole('button', { name: '全选当前结果' }));
    expect(screen.getByText('已选择 2 个')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), {
      target: { value: '' }
    });
    expect(screen.getByRole('checkbox', { name: '选择项目 夏季新品封面' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择项目 如何建立内容创作流程' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择项目 youtube.com · launch-talk' })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(screen.queryByRole('checkbox', { name: /^选择项目/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开项目 夏季新品封面' })).toBeInTheDocument();
  });

  it('deletes selected projects in one confirmed batch with the chosen file option', async () => {
    const onDeleteJob = vi.fn(async () => undefined);
    render(
      <ProjectsPage
        jobs={jobs}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
        onDeleteJob={onDeleteJob}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '批量管理' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择项目 夏季新品封面' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择项目 youtube.com · launch-talk' }));
    fireEvent.click(screen.getByRole('button', { name: '删除已选 (2)' }));

    const dialog = screen.getByRole('alertdialog', { name: '批量删除项目' });
    expect(dialog).toHaveTextContent('确认永久删除已选择的 2 个项目');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: '同时删除项目文件' }));
    fireEvent.click(within(dialog).getByRole('button', { name: '删除 2 个项目' }));

    await waitFor(() => expect(onDeleteJob).toHaveBeenCalledTimes(2));
    expect(onDeleteJob.mock.calls).toEqual([
      ['job_cover', { deleteFiles: true }],
      ['job_translation', { deleteFiles: true }]
    ]);
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '批量删除项目' }))
      .not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: '批量管理' })).toBeInTheDocument();
  });

  it('continues a batch after a failure and keeps only failed projects selected', async () => {
    const onDeleteJob = vi.fn(async (jobId: string) => {
      if (jobId === 'job_cover') {
        throw new ApiClientError({
          status: 409,
          code: 'creator_job_has_active_run',
          message: 'active run'
        });
      }
    });
    render(
      <ProjectsPage
        jobs={jobs}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
        onDeleteJob={onDeleteJob}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '批量管理' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择项目 夏季新品封面' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择项目 如何建立内容创作流程' }));
    fireEvent.click(screen.getByRole('button', { name: '删除已选 (2)' }));
    fireEvent.click(within(
      screen.getByRole('alertdialog', { name: '批量删除项目' })
    ).getByRole('button', { name: '删除 2 个项目' }));

    await waitFor(() => expect(onDeleteJob).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('项目仍在运行，请先停止任务后再删除。'));
    expect(screen.getByRole('alert')).not.toHaveTextContent(/诊断编号：OC-/);
    expect(screen.getByRole('status')).toHaveTextContent('已删除 1 个项目');
    expect(screen.queryByText(/另有 1 个项目仍在运行|1 are still running/)).not.toBeInTheDocument();
    expect(screen.getByText('已选择 1 个')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择项目 夏季新品封面' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择项目 如何建立内容创作流程' })).not.toBeChecked();
  });

  it('prevents repeated batch deletion submissions while a deletion is running', async () => {
    let finishDeletion: (() => void) | undefined;
    const onDeleteJob = vi.fn(() => new Promise<void>(resolve => {
      finishDeletion = resolve;
    }));
    render(
      <ProjectsPage
        jobs={[jobs[0]!]}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
        onDeleteJob={onDeleteJob}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '批量管理' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择项目 夏季新品封面' }));
    fireEvent.click(screen.getByRole('button', { name: '删除已选 (1)' }));
    fireEvent.click(within(
      screen.getByRole('alertdialog', { name: '批量删除项目' })
    ).getByRole('button', { name: '删除 1 个项目' }));

    await waitFor(() => expect(onDeleteJob).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '处理中' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '处理中' }));
    expect(onDeleteJob).toHaveBeenCalledTimes(1);

    finishDeletion?.();
    await waitFor(() => expect(screen.queryByRole('alertdialog', { name: '批量删除项目' }))
      .not.toBeInTheDocument());
  });

  it('explains that projects appear after the user starts creating', () => {
    render(<ProjectsPage jobs={[]} workspaces={workspaces} onOpenJob={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent('开始编辑或执行创作后，项目会显示在这里');
  });

  it('hides historical drafts that only contain template defaults', () => {
    const emptyDraftBase = creatorJob({
      id: 'job_empty',
      templateId: 'cover',
      state: {
        prompt: '面向创作者的 AI 视频工作流，主体清晰，高对比标题，专业但有冲击力',
        ratio: '16:9',
        sourceUrl: '',
        candidateCount: 4
      },
      updatedAt: '2026-08-20T10:00:00.000Z'
    });
    const emptyDraft = {
      ...emptyDraftBase,
      activities: [{
        id: 'activity_defaults',
        jobId: emptyDraftBase.id,
        revision: 1,
        actor: 'user' as const,
        action: 'update-settings:draft',
        summary: '同步模板默认设置',
        details: {},
        createdAt: emptyDraftBase.updatedAt
      }]
    };
    const editedDraft = creatorJob({
      id: 'job_edited',
      templateId: 'cover',
      state: { prompt: '用户修改过的封面需求', ratio: '16:9', sourceUrl: '', candidateCount: 4 },
      updatedAt: '2026-08-20T11:00:00.000Z'
    });
    const failedDraft = { ...emptyDraft, id: 'job_failed', status: 'failed' as const };
    const legacyTranslationDraft = creatorJob({
      id: 'job_legacy_translation',
      templateId: 'video-translation',
      state: { sourceLanguage: 'zh_cn', targetLanguage: 'en' },
      updatedAt: '2026-08-20T09:00:00.000Z'
    });
    const emptyTranslationDraft = creatorJob({
      id: 'job_empty_translation',
      templateId: 'video-translation',
      state: {
        sourceType: 'url',
        sourceUrl: '',
        sourceLanguage: 'en',
        targetLanguage: 'zh_cn',
        preferPlatformCaptions: true,
        bilingual: true,
        subtitlePosition: 'top',
        subtitleFont: 'system',
        subtitleSize: 'medium',
        subtitleColor: '#FFFFFF',
        dubbing: false,
        ttsProvider: 'openai',
        ttsModel: 'gpt-4o-mini-tts',
        voiceCode: 'marin',
        voiceName: 'marin',
        composeVideo: false,
        videoFormat: 'horizontal',
        subtitleCues: [],
        currentStage: null,
        sourceOrientation: 'landscape',
        verticalTitle: '',
        verticalSubtitle: '',
        currentStep: 0,
        furthestStep: 0,
        workspacePhase: 'configure',
        resultVersion: null,
        latestResultVersion: null,
        resultTab: 'video',
        resultVersions: [],
        draftBaseVersion: null
      },
      updatedAt: '2026-09-02T08:05:45.730Z'
    });
    const editedTranslationDraft = creatorJob({
      id: 'job_edited_translation',
      templateId: 'video-translation',
      state: { sourceLanguage: 'en', targetLanguage: 'en' },
      updatedAt: '2026-08-20T09:30:00.000Z'
    });
    const emptyImageDraft = creatorJob({
      id: 'job_empty_image',
      templateId: 'image-generation',
      state: {
        prompt: '',
        provider: 'openai',
        size: '1024x1024',
        quality: 'medium',
        candidateCount: 2,
        referenceImageArtifactId: null,
        currentStage: null
      },
      updatedAt: '2026-08-20T09:40:00.000Z'
    });
    const editedImageDraft = creatorJob({
      id: 'job_edited_image',
      templateId: 'image-generation',
      state: { ...emptyImageDraft.state, prompt: '清晨海边的产品摄影' },
      updatedAt: '2026-08-20T09:50:00.000Z'
    });

    expect(isMeaningfulCreatorJob(emptyDraft)).toBe(false);
    expect(isMeaningfulCreatorJob(editedDraft)).toBe(true);
    expect(isMeaningfulCreatorJob(failedDraft)).toBe(true);
    expect(isMeaningfulCreatorJob(legacyTranslationDraft)).toBe(false);
    expect(isMeaningfulCreatorJob(emptyTranslationDraft)).toBe(false);
    expect(isMeaningfulCreatorJob(editedTranslationDraft)).toBe(true);
    expect(isMeaningfulCreatorJob(emptyImageDraft)).toBe(false);
    expect(isMeaningfulCreatorJob(editedImageDraft)).toBe(true);

    render(
      <ProjectsPage
        jobs={[emptyDraft, emptyTranslationDraft, emptyImageDraft, editedDraft]}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
      />
    );
    expect(screen.getByRole('list', { name: '项目列表' })).toHaveTextContent('用户修改过的封面需求');
    expect(within(screen.getByRole('list', { name: '项目列表' })).getAllByRole('listitem')).toHaveLength(1);
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

  it('builds the output center from persisted artifacts without synthetic files', async () => {
    const onOpenJob = vi.fn();
    const openArtifact = vi.fn(async () => new Response(new Blob(['file'], { type: 'text/plain' }), {
      status: 200
    }));
    render(
      <ProjectsPage
        jobs={jobs}
        workspaces={workspaces}
        service={{
          openArtifact,
          openProjectCover: vi.fn(async () => new Response())
        }}
        onOpenJob={onOpenJob}
      />
    );

    fireEvent.click(within(screen.getByRole('tablist', { name: '内容维度' }))
      .getByRole('tab', { name: '产出中心' }));

    const outputList = screen.getByRole('list', { name: '产出列表' });
    expect(within(outputList).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByText('target.srt')).toBeInTheDocument();
    expect(screen.getByText('translated.mp4')).toBeInTheDocument();
    for (const fileName of [
      'landscape-clean.mp4',
      'youtube-cover.png',
      'publish-copy-youtube.md',
      'horizontal-bilingual.mp4',
      'bilingual.srt'
    ]) {
      expect(screen.getByText(fileName)).toBeInTheDocument();
    }
    expect(screen.queryByText(/最终成片|方案 01|配音音轨/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下载产出 translated.mp4' }));
    await waitFor(() => expect(openArtifact).toHaveBeenCalledWith('job_translation', 'artifact_horizontal_video'));
    expect(onOpenJob).not.toHaveBeenCalled();
  });

  it('classifies generated image projects and shows their shared project cover', () => {
    const imageJob = creatorJob({
      id: 'job_image_generation',
      templateId: 'image-generation',
      state: { prompt: '清晨海边的产品摄影' },
      updatedAt: '2026-08-20T10:00:00.000Z',
      artifacts: [artifact('job_image_generation', 'generated_image', 'generated-image.png')]
    });
    render(
      <ProjectsPage
        jobs={[imageJob, ...jobs]}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '图像设计' }));
    expect(screen.getByRole('button', { name: '打开项目 清晨海边的产品摄影' }))
      .toHaveTextContent('图像生成');
    expect(screen.getByRole('button', { name: '打开项目 清晨海边的产品摄影' }).querySelector('img'))
      .toHaveAttribute('src', '/dashboard/templates/image-generation-project-cover.png');
    fireEvent.click(within(screen.getByRole('tablist', { name: '内容维度' }))
      .getByRole('tab', { name: '产出中心' }));
    const output = screen.getByRole('button', { name: '下载产出 generated-image.png' });
    expect(output).toBeInTheDocument();
    expect(within(output).getByText('PNG')).toBeInTheDocument();
  });

  it('lists Xiaohongshu posts as writing projects and hides untouched drafts', () => {
    const empty = creatorJob({
      id: 'job_xiaohongshu_empty',
      templateId: 'xiaohongshu-post',
      state: {
        topic: '',
        audience: '',
        style: 'experience',
        length: 'medium',
        extraRequirements: '',
        currentStage: null
      },
      updatedAt: '2026-09-08T08:00:00.000Z'
    });
    const generated = creatorJob({
      id: 'job_xiaohongshu_generated',
      templateId: 'xiaohongshu-post',
      state: { ...empty.state, topic: '第一次参与开源项目' },
      updatedAt: '2026-09-08T08:10:00.000Z',
      artifacts: [artifact('job_xiaohongshu_generated', 'xiaohongshu_post', 'post.md')]
    });

    expect(isMeaningfulCreatorJob(empty)).toBe(false);
    render(
      <ProjectsPage
        jobs={[empty, generated]}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '文案创作' }));
    const project = screen.getByRole('button', { name: '打开项目 第一次参与开源项目' });
    expect(project).toHaveTextContent('小红书帖子');
    expect(project.querySelector('img')).toHaveAttribute(
      'src',
      '/dashboard/templates/digital-presenter.jpg'
    );
    expect(within(screen.getByRole('list', { name: '项目列表' })).getAllByRole('listitem'))
      .toHaveLength(1);
  });

  it('lists short video scripts as writing projects and hides untouched drafts', () => {
    const empty = creatorJob({
      id: 'job_script_empty',
      templateId: 'short-video-script',
      state: {
        topic: '',
        audience: '',
        platform: 'douyin',
        targetDurationSeconds: 60,
        tone: 'natural',
        extraRequirements: '',
        currentStage: null
      },
      updatedAt: '2026-09-08T09:00:00.000Z'
    });
    const generated = creatorJob({
      id: 'job_script_generated',
      templateId: 'short-video-script',
      state: { ...empty.state, topic: '第一次参与开源项目' },
      updatedAt: '2026-09-08T09:10:00.000Z',
      artifacts: [artifact('job_script_generated', 'short_video_script', 'script.md')]
    });

    expect(isMeaningfulCreatorJob(empty)).toBe(false);
    render(
      <ProjectsPage
        jobs={[empty, generated]}
        workspaces={workspaces}
        onOpenJob={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole('tab', { name: '文案创作' }));
    const project = screen.getByRole('button', { name: '打开项目 第一次参与开源项目' });
    expect(project).toHaveTextContent('短视频脚本');
    expect(project.querySelector('img')).toHaveAttribute(
      'src',
      '/skill-market/examples/gpt-image-2-info-poster.png'
    );
    expect(within(screen.getByRole('list', { name: '项目列表' })).getAllByRole('listitem'))
      .toHaveLength(1);
  });

  it('shows loading and runtime errors explicitly', () => {
    const { rerender } = render(
      <ProjectsPage jobs={[]} workspaces={workspaces} loading onOpenJob={vi.fn()} />
    );
    expect(screen.getByRole('status')).toHaveTextContent('正在加载最近项目');

    rerender(
      <ProjectsPage jobs={[]} workspaces={workspaces} error="Creator Runtime unavailable" onOpenJob={vi.fn()} />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('无法加载最近项目，请稍后重试。');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/诊断编号：OC-/);
    expect(screen.getByRole('alert')).not.toHaveTextContent('Creator Runtime unavailable');
  });
});

function creatorJob(input: {
  id: string;
  templateId: string;
  state: CreatorJob['state'];
  updatedAt: string;
  artifacts?: CreatorJob['artifacts'];
  presetOrigin?: CreatorJob['presetOrigin'];
}): CreatorJob {
  return {
    id: input.id,
    projectId: 'workspace_1',
    templateId: input.templateId,
    templateVersion: input.templateId === 'stickman-video' ? 2 : 1,
    status: input.artifacts === undefined ? 'draft' : 'completed',
    revision: 0,
    presetOrigin: input.presetOrigin ?? null,
    state: input.state,
    agentThreadId: null,
    stages: [],
    artifacts: input.artifacts ?? [],
    providerRequests: [],
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
    scopeKey: null,
    inputFingerprint: null,
    sha256: null,
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
