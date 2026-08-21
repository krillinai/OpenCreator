import {
  Captions,
  CirclePlay,
  FileText,
  FolderKanban,
  Image as ImageIcon,
  MoreHorizontal,
  Music2,
  PackageOpen,
  Search,
  Video
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import type { OpenCreatorProject } from './project-model.js';
import './projects-page.css';

const projectCategories = ['全部', '视频创作', '数字人', '图像设计', '内容营销'] as const;
type ProjectCategory = typeof projectCategories[number];
const outputCategories = ['全部', '视频', '图片', '音频', '字幕', '文档'] as const;
type OutputCategory = typeof outputCategories[number];
type ProjectsView = 'projects' | 'outputs';
type ProjectOutputKind = Exclude<OutputCategory, '全部'>;

type ProjectOutput = {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  kind: ProjectOutputKind;
  format: string;
  detail: string;
  cover: string;
  updatedAt?: string;
};

const projectCovers = [
  '/dashboard/templates/video-translation-example.png',
  '/dashboard/templates/ai-video-insane.jpg',
  '/dashboard/templates/video-localization.jpg',
  '/dashboard/templates/digital-presenter.jpg',
  '/dashboard/templates/animated-story.jpg'
];

export default function ProjectsPage(props: {
  projects: OpenCreatorProject[];
  currentProjectId?: string;
  onOpenProject(projectId: string): void;
  onManageProject?(projectId?: string): void;
}) {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const [view, setView] = useState<ProjectsView>('projects');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ProjectCategory>('全部');
  const [outputCategory, setOutputCategory] = useState<OutputCategory>('全部');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = useMemo(() => props.projects
    .filter(project => category === '全部' || inferProjectCategory(project.name) === category)
    .filter(project => normalizedQuery.length === 0 || `${project.name} ${project.cwd}`
      .toLocaleLowerCase()
      .includes(normalizedQuery))
    .sort((left, right) => (right.updatedAt ?? right.createdAt ?? '')
      .localeCompare(left.updatedAt ?? left.createdAt ?? '')), [category, normalizedQuery, props.projects]);
  const outputs = useMemo(() => createProjectOutputs(props.projects, l), [l, props.projects]);
  const visibleOutputs = useMemo(() => outputs
    .filter(output => outputCategory === '全部' || output.kind === outputCategory)
    .filter(output => normalizedQuery.length === 0 || `${output.name} ${output.projectName} ${output.format}`
      .toLocaleLowerCase()
      .includes(normalizedQuery))
    .sort((left, right) => (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')),
  [normalizedQuery, outputCategory, outputs]);

  function selectView(nextView: ProjectsView) {
    setView(nextView);
    setQuery('');
  }

  return (
    <main className="projects-page">
      <div className="projects-page-inner">
        <header className="projects-page-header">
          <div>
            <h1>{l('我的项目', 'My Projects')}</h1>
            <p>{view === 'projects'
              ? l('继续创作、整理素材和查看已有成果', 'Continue creating, organize assets, and review your work')
              : l('集中查看所有项目生成的视频、图片和文件', 'Review videos, images, and files generated across your projects')}</p>
          </div>
          <label className="projects-search">
            <Search size={17} strokeWidth={1.8} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              aria-label={view === 'projects' ? l('搜索项目', 'Search projects') : l('搜索产出', 'Search outputs')}
              placeholder={view === 'projects' ? l('搜索项目', 'Search projects') : l('搜索产出', 'Search outputs')}
            />
          </label>
        </header>

        <div className="projects-dimension-tabs" role="tablist" aria-label={l('内容维度', 'Content view')}>
          <button type="button" role="tab" aria-selected={view === 'projects'} onClick={() => selectView('projects')}>
            <FolderKanban size={16} strokeWidth={1.8} aria-hidden="true" />
            {l('项目', 'Projects')}
          </button>
          <button type="button" role="tab" aria-selected={view === 'outputs'} onClick={() => selectView('outputs')}>
            <PackageOpen size={16} strokeWidth={1.8} aria-hidden="true" />
            {l('产出中心', 'Output Center')}
          </button>
        </div>

        <div className={`projects-category-tabs${view === 'outputs' ? ' is-output' : ''}`} role="tablist" aria-label={view === 'projects' ? l('项目分类', 'Project categories') : l('产出分类', 'Output categories')}>
          {(view === 'projects' ? projectCategories : outputCategories).map(item => (
            <button
              type="button"
              role="tab"
              key={item}
              aria-selected={view === 'projects' ? category === item : outputCategory === item}
              onClick={() => view === 'projects'
                ? setCategory(item as ProjectCategory)
                : setOutputCategory(item as OutputCategory)}
            >
              {view === 'projects'
                ? localizeProjectCategory(item as ProjectCategory, l)
                : localizeOutputCategory(item as OutputCategory, l)}
            </button>
          ))}
        </div>

        <section className="projects-library" aria-labelledby="projects-library-title">
          <div className="projects-library-heading">
            <h2 id="projects-library-title">
              {view === 'projects'
                ? category === '全部' ? l('全部项目', 'All projects') : localizeProjectCategory(category, l)
                : outputCategory === '全部' ? l('全部产出', 'All outputs') : localizeOutputCategory(outputCategory, l)}
            </h2>
            <span>{view === 'projects'
              ? `${visibleProjects.length} ${l('个项目', 'projects')}`
              : `${visibleOutputs.length} ${l('个产出', 'outputs')}`}</span>
          </div>

          {view === 'projects' ? visibleProjects.length > 0 ? (
            <div className="projects-card-grid" role="list" aria-label={l('项目列表', 'Project list')}>
              {visibleProjects.map((project) => {
                const isCurrent = project.id === props.currentProjectId;
                return (
                  <article className="project-card" role="listitem" key={project.id} data-current={isCurrent || undefined}>
                    <button
                      type="button"
                      className="project-card-open"
                      aria-label={`${l('打开项目', 'Open project')} ${project.name}`}
                      onClick={() => props.onOpenProject(project.id)}
                    >
                      <span className="project-card-cover">
                        <img src={projectCover(project.id)} alt="" />
                        {isCurrent ? <small>{l('当前项目', 'Current project')}</small> : null}
                      </span>
                      <span className="project-card-copy">
                        <small>{inferProjectType(project.name, l)}</small>
                        <strong>{project.name}</strong>
                        <span>{formatProjectTime(project.updatedAt ?? project.createdAt, language)}</span>
                      </span>
                    </button>
                    {props.onManageProject ? (
                      <button
                        type="button"
                        className="project-card-menu"
                        aria-label={`${l('项目设置', 'Project settings')} ${project.name}`}
                        title={l('项目设置', 'Project settings')}
                        onClick={() => props.onManageProject?.(project.id)}
                      >
                        <MoreHorizontal size={17} strokeWidth={1.9} aria-hidden="true" />
                      </button>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="projects-empty" role="status">
              <FolderKanban size={28} strokeWidth={1.5} aria-hidden="true" />
              <strong>
                {props.projects.length === 0
                  ? l('还没有项目', 'No projects yet')
                  : normalizedQuery.length > 0
                    ? l('没有找到匹配的项目', 'No matching projects')
                    : l('这个分类还没有项目', 'No projects in this category')}
              </strong>
              <p>
                {props.projects.length === 0
                  ? l('从工作台开始创作后，项目会自动显示在这里。', 'Projects appear here automatically after you start creating from Dashboard.')
                  : normalizedQuery.length > 0
                    ? l('换个名称重新搜索。', 'Try searching with another name.')
                    : l('完成对应类型的创作后，项目会显示在这里。', 'Projects of this type will appear here after you create them.')}
              </p>
            </div>
          ) : visibleOutputs.length > 0 ? (
            <div className="project-output-grid" role="list" aria-label={l('产出列表', 'Output list')}>
              {visibleOutputs.map(output => (
                <article className="project-output-card" role="listitem" key={output.id}>
                  <button
                    type="button"
                    className="project-output-open"
                    aria-label={`${l('在项目中打开产出', 'Open output in project')} ${output.name}`}
                    onClick={() => props.onOpenProject(output.projectId)}
                  >
                    <span className="project-output-preview" data-kind={output.kind}>
                      {output.kind === '视频' || output.kind === '图片' ? (
                        <img src={output.cover} alt="" />
                      ) : (
                        <span className="project-output-file-icon" aria-hidden="true">
                          {outputKindIcon(output.kind, 28)}
                        </span>
                      )}
                      {output.kind === '视频' ? (
                        <span className="project-output-play" aria-hidden="true"><CirclePlay size={28} strokeWidth={1.6} /></span>
                      ) : null}
                      <small>{output.format}</small>
                    </span>
                    <span className="project-output-copy">
                      <span className="project-output-kind">{outputKindIcon(output.kind, 13)}{localizeOutputCategory(output.kind, l)}</span>
                      <strong>{output.name}</strong>
                      <span>{output.projectName}</span>
                      <small>{output.detail} · {formatProjectTime(output.updatedAt, language)}</small>
                    </span>
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="projects-empty" role="status">
              <PackageOpen size={28} strokeWidth={1.5} aria-hidden="true" />
              <strong>{normalizedQuery.length > 0
                ? l('没有找到匹配的产出', 'No matching outputs')
                : outputCategory === '全部'
                  ? l('还没有产出', 'No outputs yet')
                  : l('这个分类还没有产出', 'No outputs in this category')}</strong>
              <p>{normalizedQuery.length > 0
                ? l('换个名称重新搜索。', 'Try searching with another name.')
                : l('完成工作台任务后，生成的文件会集中显示在这里。', 'Generated files will appear here after you complete a Dashboard task.')}</p>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function inferProjectCategory(name: string): Exclude<ProjectCategory, '全部'> {
  if (/数字人|口播|avatar|presenter/i.test(name)) return '数字人';
  if (/营销|推广|品牌|活动|种草|周报|社媒|文案|marketing|campaign|brand|social|copywriting/i.test(name)) return '内容营销';
  if (/封面|海报|配图|图像|图片|写真|thumbnail|cover|poster|image|photo/i.test(name)) return '图像设计';
  return '视频创作';
}

function localizeProjectCategory(category: ProjectCategory, l: LocalizeCopy): string {
  if (category === '全部') return l(category, 'All');
  if (category === '视频创作') return l(category, 'Video Creation');
  if (category === '数字人') return l(category, 'Avatars');
  if (category === '图像设计') return l(category, 'Image Design');
  return l(category, 'Content Marketing');
}

function localizeOutputCategory(category: OutputCategory, l: LocalizeCopy): string {
  if (category === '全部') return l(category, 'All');
  if (category === '视频') return l(category, 'Videos');
  if (category === '图片') return l(category, 'Images');
  if (category === '音频') return l(category, 'Audio');
  if (category === '字幕') return l(category, 'Subtitles');
  return l(category, 'Documents');
}

function outputKindIcon(kind: ProjectOutputKind, size: number) {
  if (kind === '视频') return <Video size={size} strokeWidth={1.8} aria-hidden="true" />;
  if (kind === '图片') return <ImageIcon size={size} strokeWidth={1.8} aria-hidden="true" />;
  if (kind === '音频') return <Music2 size={size} strokeWidth={1.8} aria-hidden="true" />;
  if (kind === '字幕') return <Captions size={size} strokeWidth={1.8} aria-hidden="true" />;
  return <FileText size={size} strokeWidth={1.8} aria-hidden="true" />;
}

function createProjectOutputs(projects: OpenCreatorProject[], l: LocalizeCopy): ProjectOutput[] {
  return projects.flatMap(project => {
    const updatedAt = project.updatedAt ?? project.createdAt;
    const base = {
      projectId: project.id,
      projectName: project.name,
      cover: projectCover(project.id),
      updatedAt
    };
    const output = (
      suffix: string,
      kind: ProjectOutputKind,
      format: string,
      detail: string,
      index: number
    ): ProjectOutput => ({
      ...base,
      id: `${project.id}-${kind}-${index}`,
      name: `${project.name}-${suffix}`,
      kind,
      format,
      detail
    });

    if (/翻译|translation|localization/i.test(project.name)) {
      return [
        output(l('翻译成片', 'translated-video'), '视频', 'MP4', '1920 × 1080', 1),
        output(l('双语字幕', 'bilingual-subtitles'), '字幕', 'SRT', 'UTF-8', 2),
        output(l('配音音轨', 'dubbed-audio'), '音频', 'MP3', '48 kHz', 3)
      ];
    }
    if (/封面|海报|配图|图像|图片|写真|thumbnail|cover|poster|image|photo/i.test(project.name)) {
      return [
        output(l('方案 01', 'option-01'), '图片', 'PNG', '1920 × 1080', 1),
        output(l('方案 02', 'option-02'), '图片', 'PNG', '1920 × 1080', 2)
      ];
    }
    if (/数字人|口播|avatar|presenter/i.test(project.name)) {
      return [
        output(l('数字人成片', 'avatar-video'), '视频', 'MP4', '1920 × 1080', 1),
        output(l('配音音轨', 'voice-track'), '音频', 'WAV', '48 kHz', 2)
      ];
    }
    if (/营销|推广|品牌|活动|种草|周报|社媒|文案|marketing|campaign|brand|social|copywriting/i.test(project.name)) {
      return [
        output(l('社媒配图', 'social-visual'), '图片', 'PNG', '1080 × 1350', 1),
        output(l('发布文案', 'campaign-copy'), '文档', 'DOCX', l('可编辑文档', 'Editable document'), 2)
      ];
    }
    return [
      output(l('最终成片', 'final-video'), '视频', 'MP4', '1920 × 1080', 1)
    ];
  });
}

function inferProjectType(name: string, l: LocalizeCopy): string {
  if (/翻译|translation|localization/i.test(name)) return l('视频翻译', 'Video translation');
  if (/剪辑|clip|cut/i.test(name)) return l('自动剪辑', 'Auto clips');
  if (/封面|cover|thumbnail/i.test(name)) return l('封面生成', 'Thumbnail generation');
  if (/动画|火柴人|animation|stickman/i.test(name)) return l('动画生成', 'Animation');
  if (/数字人|avatar|presenter/i.test(name)) return l('数字人', 'Avatar');
  if (/营销|推广|品牌|活动|种草|周报|社媒|文案|marketing|campaign|brand|social|copywriting/i.test(name)) return l('内容营销', 'Content marketing');
  if (/海报|配图|图像|图片|写真|poster|image|photo/i.test(name)) return l('图像设计', 'Image design');
  return l('视频创作', 'Video creation');
}

function projectCover(projectId: string): string {
  const hash = [...projectId].reduce((total, character) => total + character.charCodeAt(0), 0);
  return projectCovers[hash % projectCovers.length] ?? projectCovers[0]!;
}

function formatProjectTime(value: string | undefined, language: 'zh-CN' | 'en-US'): string {
  if (value === undefined) return language === 'en-US' ? 'Updated just now' : '刚刚更新';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return language === 'en-US' ? 'Recently updated' : '最近更新';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return language === 'en-US' ? 'Updated just now' : '刚刚更新';
  if (minutes < 60) return language === 'en-US' ? `${minutes} min ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return language === 'en-US' ? `${hours} hr ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return language === 'en-US' ? `${days} days ago` : `${days} 天前`;
  return new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric' }).format(timestamp);
}
