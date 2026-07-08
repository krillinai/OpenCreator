import { Fragment, type MouseEvent, type ReactNode } from 'react';

export type MarkdownVariant = 'assistant' | 'user' | 'process' | 'tool' | 'diagnostic' | 'document';
export type MarkdownLinkClickHandler = (href: string, event: MouseEvent<HTMLAnchorElement>) => void;

export function isSafeHref(href: string, allowRelative: boolean): boolean {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('//')) return false;

  try {
    const parsed = new URL(trimmed, 'https://clawee.local');
    if (parsed.origin === 'https://clawee.local' && !/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed)) {
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
  options: { allowRelative: boolean; onLinkClick?: MarkdownLinkClickHandler; bare?: boolean }
): ReactNode {
  if (!isSafeHref(href, options.allowRelative)) {
    return (
      <span key={key} className="md-link-unsafe">
        {label}
      </span>
    );
  }
  return (
    <a
      key={key}
      className={`md-link${options.bare ? ' md-link-bare' : ''}`}
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      onClick={event => options.onLinkClick?.(href, event)}
    >
      {label}
    </a>
  );
}

function pushTextWithLinks(
  output: ReactNode[],
  text: string,
  baseKey: string | number,
  options: { allowRelative: boolean; onLinkClick?: MarkdownLinkClickHandler }
) {
  if (!text) return;
  const urlRe = /(https?:\/\/[^\s)<>]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  function pushPlain(value: string) {
    if (!value) return;
    const parts = value.split('\n');
    parts.forEach((part, index) => {
      if (index > 0) output.push(<br key={`${baseKey}-${key++}-br`} />);
      if (part) output.push(<Fragment key={`${baseKey}-${key++}`}>{part}</Fragment>);
    });
  }

  while ((match = urlRe.exec(text))) {
    if (match.index > lastIndex) pushPlain(text.slice(lastIndex, match.index));
    const [href, suffix] = splitTrailingAutolinkPunctuation(match[1]!);
    output.push(renderLink(href, href, `${baseKey}-${key++}`, { ...options, bare: true }));
    if (suffix) pushPlain(suffix);
    lastIndex = urlRe.lastIndex;
  }

  if (lastIndex < text.length) pushPlain(text.slice(lastIndex));
}

export function renderInlineMarkdown(
  text: string,
  options: { variant: MarkdownVariant; onLinkClick?: MarkdownLinkClickHandler }
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
      pushTextWithLinks(output, text.slice(lastIndex, match.index), key++, { allowRelative, onLinkClick: options.onLinkClick });
    }

    if (match[1]) {
      output.push(
        <code key={key++} className="md-inline-code">
          {match[1].slice(1, -1)}
        </code>
      );
    } else if (match[3] !== undefined) {
      const alt = match[2]?.trim();
      output.push(<Fragment key={key++}>{alt ? `${alt} [图片]` : '[图片]'}</Fragment>);
    } else if (match[4] && match[5]) {
      output.push(renderLink(match[5], match[4], key++, { allowRelative, onLinkClick: options.onLinkClick }));
    } else if (match[6]) {
      const [href, suffix] = splitTrailingAutolinkPunctuation(match[6]);
      output.push(renderLink(href, href, key++, { allowRelative, onLinkClick: options.onLinkClick, bare: true }));
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
    pushTextWithLinks(output, text.slice(lastIndex), key++, { allowRelative, onLinkClick: options.onLinkClick });
  }

  return <>{output}</>;
}
