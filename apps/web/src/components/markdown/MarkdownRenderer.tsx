import { Fragment, useMemo, type ReactNode } from 'react';
import { MarkdownCodeBlock } from './MarkdownCodeBlock.js';
import { parseMarkdownBlocks, type MarkdownBlock, type TableAlign } from './markdown-parser.js';
import { renderInlineMarkdown, type MarkdownLinkClickHandler, type MarkdownVariant } from './markdown-inline.js';

export type { MarkdownLinkClickHandler, MarkdownVariant };

export type MarkdownRendererProps = {
  text: string;
  variant?: MarkdownVariant;
  className?: string;
  onLinkClick?: MarkdownLinkClickHandler;
  linkifyWorkspaceFiles?: boolean;
};

const PRIVATE_CITATION_MARKER = /[ \t]*\uE200(?:cite|filecite|navlist)\uE202[^\uE201]*\uE201/gu;

export function normalizeMarkdownDisplayText(text: string): string {
  return text
    .replace(PRIVATE_CITATION_MARKER, '')
    .replace(/[ \t]+\n/g, '\n');
}

function alignStyle(align: TableAlign): React.CSSProperties | undefined {
  if (align === null) return undefined;
  return { textAlign: align };
}

function renderTaskListItem(item: string, key: number, options: MarkdownRendererProps & { variant: MarkdownVariant }) {
  const task = /^\[([ xX])\]\s+(.*)$/.exec(item);
  if (!task) {
    return <li key={key}>{renderInlineMarkdown(item, options)}</li>;
  }
  const checked = task[1]?.toLowerCase() === 'x';
  return (
    <li key={key} className="md-task-item" data-checked={checked ? 'true' : undefined}>
      <input className="md-task-check" type="checkbox" checked={checked} readOnly aria-label={checked ? '已完成' : '未完成'} />
      <span>{renderInlineMarkdown(task[2] ?? '', options)}</span>
    </li>
  );
}

function literalizeUserBlock(block: MarkdownBlock): string {
  switch (block.kind) {
    case 'heading':
      return `${'#'.repeat(block.level)} ${block.text}`;
    case 'unordered-list':
      return block.items.map(item => `- ${item}`).join('\n');
    case 'ordered-list':
      return block.items.map((item, index) => `${index + 1}. ${item}`).join('\n');
    case 'blockquote':
      return block.text.split('\n').map(line => `> ${line}`).join('\n');
    case 'table':
      return [
        block.headers.join(' | '),
        block.aligns.map(align => (align === 'right' ? '---:' : align === 'center' ? ':---:' : '---')).join(' | '),
        ...block.rows.map(row => row.join(' | '))
      ].join('\n');
    case 'hr':
      return '---';
    case 'paragraph':
      return block.text;
    case 'code':
      return block.body;
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

function renderBlock(block: MarkdownBlock, key: number, options: MarkdownRendererProps & { variant: MarkdownVariant }): ReactNode {
  if (options.variant === 'user' && block.kind !== 'paragraph' && block.kind !== 'code') {
    return (
      <p key={key} className="md-p">
        {renderInlineMarkdown(literalizeUserBlock(block), options)}
      </p>
    );
  }

  switch (block.kind) {
    case 'paragraph':
      return (
        <p key={key} className="md-p">
          {renderInlineMarkdown(block.text, options)}
        </p>
      );
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4';
      return (
        <Tag key={key} className={`md-h md-h${block.level}`}>
          {renderInlineMarkdown(block.text, options)}
        </Tag>
      );
    }
    case 'unordered-list': {
      const hasTask = block.items.some(item => /^\[[ xX]\]\s+/.test(item));
      return (
        <ul key={key} className={`md-ul${hasTask ? ' md-task-list' : ''}`}>
          {block.items.map((item, index) => renderTaskListItem(item, index, options))}
        </ul>
      );
    }
    case 'ordered-list':
      return (
        <ol key={key} className="md-ol">
          {block.items.map((item, index) => (
            <li key={index}>{renderInlineMarkdown(item, options)}</li>
          ))}
        </ol>
      );
    case 'blockquote':
      return (
        <blockquote key={key} className="md-quote">
          {renderInlineMarkdown(block.text, options)}
        </blockquote>
      );
    case 'code':
      return (
        <MarkdownCodeBlock
          key={key}
          body={block.body}
          lang={block.lang}
          onLinkClick={options.onLinkClick}
          linkifyWorkspaceFiles={options.linkifyWorkspaceFiles}
        />
      );
    case 'table':
      return (
        <div key={key} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.headers.map((header, index) => (
                  <th key={index} style={alignStyle(block.aligns[index] ?? null)}>
                    {renderInlineMarkdown(header, options)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {block.headers.map((_header, cellIndex) => (
                    <td key={cellIndex} style={alignStyle(block.aligns[cellIndex] ?? null)}>
                      {renderInlineMarkdown(row[cellIndex] ?? '', options)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case 'hr':
      return <hr key={key} className="md-hr" />;
    default: {
      const _exhaustive: never = block;
      return _exhaustive;
    }
  }
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
  const variant = props.variant ?? 'assistant';
  const displayText = useMemo(() => normalizeMarkdownDisplayText(props.text), [props.text]);
  const blocks = useMemo(() => parseMarkdownBlocks(displayText), [displayText]);
  const className = props.className ? `markdown-prose ${props.className}` : 'markdown-prose';

  return (
    <div className={className} data-variant={variant}>
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block, index, { ...props, variant })}</Fragment>
      ))}
    </div>
  );
}
