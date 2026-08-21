import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { Blocks } from 'lucide-react';

export type MarkdownVariant = 'assistant' | 'user' | 'process' | 'tool' | 'diagnostic' | 'document';
export type MarkdownLinkClickHandler = (href: string, event: MouseEvent<HTMLAnchorElement>) => void;

const WORKSPACE_FILE_EXTENSIONS = [
  'markdown', 'md', 'txt', 'jsonl', 'json', 'yaml', 'yml', 'toml',
  'jsx', 'js', 'tsx', 'ts', 'css', 'scss', 'html', 'htm', 'xml', 'csv',
  'py', 'go', 'rs', 'java', 'kt', 'kts', 'swift', 'c', 'cc', 'cpp', 'h', 'hpp',
  'sh', 'bash', 'zsh', 'sql', 'svg', 'png', 'jpg', 'jpeg', 'gif', 'webp',
  'pdf', 'docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'mp3', 'wav', 'mp4', 'mov', 'webm'
].join('|');
const WORKSPACE_FILE_PATH_SOURCE =
  `(?:~\\/|\\.{1,2}\\/|\\/)?(?:[^\\s\`<>"'()\\[\\]{}，。！？；：,;!?]+\\/)*`
  + `[^\\s\`<>"'()\\[\\]{}，。！？；：,;!?/]+\\.(?:${WORKSPACE_FILE_EXTENSIONS})`;

function createWorkspaceFilePathRegex(flags = 'giu'): RegExp {
  return new RegExp(WORKSPACE_FILE_PATH_SOURCE, flags);
}

const SKILL_NAME_ACRONYMS = new Set(['ai', 'api', 'aso', 'b2b', 'cso', 'geo', 'gtm', 'icp', 'ltv', 'mcp', 'roi', 'seo']);
const OFFICIAL_SITE_ICONS: Record<string, string> = {
  'workbuddy.cn': '/site-icons/workbuddy.svg',
  'www.workbuddy.cn': '/site-icons/workbuddy.svg'
};

function formatSkillName(reference: string): string {
  return reference
    .slice(1)
    .split(/[-_.:]+/u)
    .filter(Boolean)
    .map(part => (
      SKILL_NAME_ACRONYMS.has(part.toLowerCase())
        ? part.toUpperCase()
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    ))
    .join(' ');
}

function getSiteIconUrl(href: string): string | undefined {
  if (!/^https?:/iu.test(href)) return undefined;
  const url = new URL(href);
  return OFFICIAL_SITE_ICONS[url.hostname.toLowerCase()] ?? `${url.origin}/favicon.ico`;
}

export function isWorkspaceFilePath(value: string): boolean {
  return new RegExp(`^(?:${WORKSPACE_FILE_PATH_SOURCE})$`, 'iu').test(value.trim());
}

export function extractWorkspaceFilePaths(text: string): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(createWorkspaceFilePathRegex())) {
    const path = match[0];
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

export function isSafeHref(href: string, allowRelative: boolean): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('//')) return false;

  try {
    const parsed = new URL(trimmed, 'https://opencreator.local');
    if (parsed.origin === 'https://opencreator.local' && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) {
      return allowRelative && !trimmed.startsWith('/');
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function splitTrailingAutolinkPunctuation(url: string): [string, string] {
  let href = url;
  let suffix = '';
  while (/[.,;:!?]$/.test(href)) {
    suffix = href.slice(-1) + suffix;
    href = href.slice(0, -1);
  }
  return [href, suffix];
}

function renderLink(
  href: string,
  label: ReactNode,
  key: string | number,
  options: {
    allowRelative: boolean;
    onLinkClick?: MarkdownLinkClickHandler;
    bare?: boolean;
    siteIcon?: boolean;
    allowWorkspaceFile?: boolean;
  }
): ReactNode {
  const workspaceFile = options.allowWorkspaceFile === true
    && options.onLinkClick !== undefined
    && isWorkspaceFilePath(href);
  if (!isSafeHref(href, options.allowRelative) && !workspaceFile) {
    return (
      <span key={key} className="md-link-unsafe">
        {label}
      </span>
    );
  }
  const external = /^(?:https?:|mailto:)/i.test(href);
  const siteIconUrl = options.siteIcon ? getSiteIconUrl(href) : undefined;
  return (
    <a
      key={key}
      className={`md-link${options.bare ? ' md-link-bare' : ''}${workspaceFile ? ' md-file-link' : ''}`}
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noreferrer noopener' : undefined}
      onClick={event => options.onLinkClick?.(href, event)}
    >
      {siteIconUrl ? (
        <img
          className="md-link-site-icon"
          src={siteIconUrl}
          alt=""
          aria-hidden="true"
          onError={event => {
            event.currentTarget.hidden = true;
          }}
        />
      ) : null}
      <span className="md-link-label">{label}</span>
    </a>
  );
}

function pushTextWithLinks(
  output: ReactNode[],
  text: string,
  baseKey: string | number,
  options: {
    allowRelative: boolean;
    onLinkClick?: MarkdownLinkClickHandler;
    linkifyWorkspaceFiles?: boolean;
    linkifySkills?: boolean;
  }
) {
  if (!text) return;
  const urlRe = /(https?:\/\/[^\s)<>]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  function pushLiteral(value: string) {
    if (!value) return;
    const parts = value.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) output.push(<br key={`${baseKey}-${key++}-br`} />);
      if (part) output.push(<Fragment key={`${baseKey}-${key++}`}>{part}</Fragment>);
    });
  }

  function pushPlain(value: string) {
    if (!value) return;
    if (options.linkifySkills) {
      const skillRe = /\$[A-Za-z][A-Za-z0-9._:-]*/g;
      let skillLastIndex = 0;
      let skillMatch: RegExpExecArray | null;
      while ((skillMatch = skillRe.exec(value))) {
        if (skillMatch.index > skillLastIndex) {
          pushPlainWithoutSkills(value.slice(skillLastIndex, skillMatch.index));
        }
        const reference = skillMatch[0];
        output.push(
          <span
            key={`${baseKey}-${key++}`}
            className="md-skill-reference"
            title={`技能：${reference.slice(1)}`}
          >
            <Blocks aria-hidden="true" size={14} strokeWidth={1.8} />
            <span>{formatSkillName(reference)}</span>
          </span>
        );
        skillLastIndex = skillRe.lastIndex;
      }
      if (skillLastIndex < value.length) pushPlainWithoutSkills(value.slice(skillLastIndex));
      return;
    }
    pushPlainWithoutSkills(value);
  }

  function pushPlainWithoutSkills(value: string) {
    if (!value) return;
    if (!options.linkifyWorkspaceFiles || options.onLinkClick === undefined) {
      pushLiteral(value);
      return;
    }

    const fileRe = createWorkspaceFilePathRegex();
    let fileLastIndex = 0;
    let fileMatch: RegExpExecArray | null;
    while ((fileMatch = fileRe.exec(value))) {
      if (fileMatch.index > fileLastIndex) pushLiteral(value.slice(fileLastIndex, fileMatch.index));
      const path = fileMatch[0];
      output.push(renderLink(path, path, `${baseKey}-${key++}`, {
        ...options,
        allowWorkspaceFile: true
      }));
      fileLastIndex = fileRe.lastIndex;
    }
    if (fileLastIndex < value.length) pushLiteral(value.slice(fileLastIndex));
  }

  while ((match = urlRe.exec(text))) {
    if (match.index > lastIndex) pushPlain(text.slice(lastIndex, match.index));
    const [href, suffix] = splitTrailingAutolinkPunctuation(match[1]!);
    output.push(renderLink(href, href, `${baseKey}-${key++}`, {
      ...options,
      bare: true,
      siteIcon: options.linkifySkills
    }));
    if (suffix) pushPlain(suffix);
    lastIndex = urlRe.lastIndex;
  }

  if (lastIndex < text.length) pushPlain(text.slice(lastIndex));
}

export function renderInlineMarkdown(
  text: string,
  options: {
    variant: MarkdownVariant;
    onLinkClick?: MarkdownLinkClickHandler;
    linkifyWorkspaceFiles?: boolean;
  }
): ReactNode {
  const output: ReactNode[] = [];
  const allowRelative = Boolean(options.onLinkClick);
  const userVariant = options.variant === 'user';
  const regex = userVariant
    ? /(`[^`]+`)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)<>]+)/g
    : /(`[^`]+`)|!\[([^\]]*)\]\(([^)\s]+)\)|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)<>]+)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(text))) {
    if (match.index > lastIndex) {
      pushTextWithLinks(output, text.slice(lastIndex, match.index), key++, {
        allowRelative,
        onLinkClick: options.onLinkClick,
        linkifyWorkspaceFiles: options.linkifyWorkspaceFiles,
        linkifySkills: userVariant
      });
    }

    if (match[1]) {
      const code = match[1].slice(1, -1);
      output.push(options.linkifyWorkspaceFiles && options.onLinkClick !== undefined && isWorkspaceFilePath(code)
        ? renderLink(code, <code className="md-inline-code">{code}</code>, key++, {
            allowRelative,
            onLinkClick: options.onLinkClick,
            allowWorkspaceFile: true
          })
        : (
            <code key={key++} className="md-inline-code">
              {code}
            </code>
          ));
    } else if (match[3] !== undefined) {
      const alt = match[2]?.trim();
      output.push(<Fragment key={key++}>{alt ? `${alt} [图片]` : '[图片]'}</Fragment>);
    } else if (match[4] && match[5]) {
      output.push(renderLink(match[5], match[4], key++, {
        allowRelative,
        onLinkClick: options.onLinkClick,
        allowWorkspaceFile: options.linkifyWorkspaceFiles
      }));
    } else if (match[6]) {
      const [href, suffix] = splitTrailingAutolinkPunctuation(match[6]);
      output.push(renderLink(href, href, key++, {
        allowRelative,
        onLinkClick: options.onLinkClick,
        bare: true,
        siteIcon: userVariant
      }));
      if (suffix) output.push(<Fragment key={key++}>{suffix}</Fragment>);
    } else if (!userVariant && match[7]) {
      output.push(<strong key={key++}>{match[7].slice(2, -2)}</strong>);
    } else if (!userVariant && match[8]) {
      output.push(<strong key={key++}>{match[8].slice(2, -2)}</strong>);
    } else if (!userVariant && match[9]) {
      output.push(<em key={key++}>{match[9].slice(1, -1)}</em>);
    } else if (!userVariant && match[10]) {
      output.push(<em key={key++}>{match[10].slice(1, -1)}</em>);
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    pushTextWithLinks(output, text.slice(lastIndex), key++, {
      allowRelative,
      onLinkClick: options.onLinkClick,
      linkifyWorkspaceFiles: options.linkifyWorkspaceFiles,
      linkifySkills: userVariant
    });
  }

  return <>{output}</>;
}

export function renderTextWithWorkspaceFileLinks(
  text: string,
  onLinkClick: MarkdownLinkClickHandler
): ReactNode {
  const output: ReactNode[] = [];
  pushTextWithLinks(output, text, 'workspace-file', {
    allowRelative: true,
    onLinkClick,
    linkifyWorkspaceFiles: true
  });
  return <>{output}</>;
}
