import { ChevronDown, FolderKanban, MoreHorizontal, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy, type LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import type { ClaweeProject } from './project-model.js';
import './projects-page.css';

type ProjectSort = 'updated-desc' | 'updated-asc' | 'name';

const projectCovers = [
  '/workbench/templates/video-translation-example.png',
  '/workbench/templates/ai-video-insane.jpg',
  '/workbench/templates/video-localization.jpg',
  '/workbench/templates/digital-presenter.jpg',
  '/workbench/templates/animated-story.jpg'
];

export default function ProjectsPage(props: {
  projects: ClaweeProject[];
  currentProjectId?: string;
  onOpenProject(projectId: string): void;
  onCreateProject?(): void;
  onManageProject?(projectId?: string): void;
}) {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<ProjectSort>('updated-desc');
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleProjects = useMemo(() => props.projects
    .filter(project => normalizedQuery.length === 0 || `${project.name} ${project.cwd}`
      .toLocaleLowerCase()
      .includes(normalizedQuery))
    .sort((left, right) => {
      if (sort === 'name') return left.name.localeCompare(right.name, language);
      const order = (right.updatedAt ?? right.createdAt ?? '')
        .localeCompare(left.updatedAt ?? left.createdAt ?? '');
      return sort === 'updated-desc' ? order : -order;
    }), [language, normalizedQuery, props.projects, sort]);

  return (
    <main className="projects-page">
      <div className="projects-page-inner">
        <header className="projects-page-header">
          <div>
            <h1>{l('我的项目', 'My Projects')}</h1>
            <p>{l('继续创作、整理素材和查看已有成果', 'Continue creating, organize assets, and review your work')}</p>
          </div>
          {props.onCreateProject ? (
            <button type="button" className="projects-create-button" onClick={props.onCreateProject}>
              <Plus size={17} strokeWidth={1.9} aria-hidden="true" />
              {l('新建项目', 'New project')}
            </button>
          ) : null}
        </header>

        <div className="projects-toolbar">
          <label className="projects-search">
            <Search size={17} strokeWidth={1.8} aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={event => setQuery(event.target.value)}
              aria-label={l('搜索项目', 'Search projects')}
              placeholder={l('搜索项目', 'Search projects')}
            />
          </label>
          <label className="projects-sort">
            <span className="app-visually-hidden">{l('项目排序', 'Sort projects')}</span>
            <select
              value={sort}
              onChange={event => setSort(event.target.value as ProjectSort)}
              aria-label={l('项目排序', 'Sort projects')}
            >
              <option value="updated-desc">{l('最近更新', 'Recently updated')}</option>
              <option value="updated-asc">{l('最早更新', 'Oldest updated')}</option>
              <option value="name">{l('项目名称', 'Project name')}</option>
            </select>
            <ChevronDown size={15} strokeWidth={1.8} aria-hidden="true" />
          </label>
        </div>

        <section className="projects-library" aria-labelledby="projects-library-title">
          <div className="projects-library-heading">
            <h2 id="projects-library-title">{l('全部项目', 'All projects')}</h2>
            <span>{visibleProjects.length} {l('个项目', 'projects')}</span>
          </div>

          {visibleProjects.length > 0 ? (
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
              <strong>{props.projects.length === 0 ? l('还没有项目', 'No projects yet') : l('没有找到匹配的项目', 'No matching projects')}</strong>
              <p>{props.projects.length === 0 ? l('创建项目后，创作内容会集中显示在这里。', 'Create a project to keep its content and outputs together.') : l('换个名称重新搜索。', 'Try searching with another name.')}</p>
              {props.projects.length === 0 && props.onCreateProject ? (
                <button type="button" onClick={props.onCreateProject}>{l('新建项目', 'New project')}</button>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function inferProjectType(name: string, l: LocalizeCopy): string {
  if (/翻译|translation|localization/i.test(name)) return l('视频翻译', 'Video translation');
  if (/剪辑|clip|cut/i.test(name)) return l('自动剪辑', 'Auto clips');
  if (/封面|cover|thumbnail/i.test(name)) return l('封面生成', 'Thumbnail generation');
  if (/动画|火柴人|animation|stickman/i.test(name)) return l('动画生成', 'Animation');
  if (/数字人|avatar|presenter/i.test(name)) return l('数字人', 'Avatar');
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
