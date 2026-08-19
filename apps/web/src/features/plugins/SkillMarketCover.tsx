import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import type { SkillMarketViewEntry } from './skill-market-model.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

const githubPreviewCacheKey =
  '23d7b9595ae1f6dd0e2cdfe74393932763af58e35606729e825c6d65b2429725';

export function SkillMarketCover({
  item,
  compact = false,
}: {
  item: SkillMarketViewEntry;
  compact?: boolean;
  }) {
  const l = useLocalizedCopy();
  const approvedExample = item.entry.examples.find((example) => example.approved);
  const sources = [
    approvedExample?.url,
    githubSocialPreviewUrl(item.entry.githubRepository),
  ]
    .map((source) => (source ? normalizeSkillMarketAssetUrl(source) : undefined))
    .filter(Boolean) as string[];
  const [sourceIndex, setSourceIndex] = useState(sources.length > 0 ? 0 : -1);
  const source = sourceIndex >= 0 ? sources[sourceIndex] : undefined;

  if (source !== undefined) {
    return (
      <img
        alt={approvedExample?.title ?? `${item.title} ${l('封面', 'cover')}`}
        className="skill-market-cover__image"
        decoding="async"
        draggable={false}
        loading={compact ? 'eager' : 'lazy'}
        onError={() => {
          setSourceIndex((current) =>
            current + 1 < sources.length ? current + 1 : -1
          );
        }}
        src={source}
      />
    );
  }

  return (
    <span className="skill-market-cover__css" aria-label={`${item.title} ${l('封面', 'cover')}`}>
      <span className="skill-market-cover__fallback-body">
        <ImageIcon size={compact ? 20 : 24} aria-hidden="true" />
        <strong>{item.title}</strong>
        <span>{item.category.name}</span>
      </span>
    </span>
  );
}

export function SkillAuthorAvatar({
  name,
  src,
  size = 'small',
}: {
  name: string;
  src?: string;
  size?: 'small' | 'large';
}) {
  const safeSrc = src ? normalizeSkillMarketAssetUrl(src) : undefined;
  const [failed, setFailed] = useState(!safeSrc);
  const initial = name.trim().charAt(0).toLocaleUpperCase() || '?';

  if (failed || safeSrc === undefined) {
    return (
      <span
        aria-label={name}
        className={`skill-market-avatar skill-market-avatar--${size}`}
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      alt={name}
      className={`skill-market-avatar skill-market-avatar--${size}`}
      decoding="async"
      loading={size === 'large' ? 'eager' : 'lazy'}
      onError={() => setFailed(true)}
      src={safeSrc}
    />
  );
}

export function normalizeSkillMarketAssetUrl(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.includes('\\')) return undefined;
  if (trimmed.startsWith('//')) return undefined;
  if (trimmed.startsWith('/')) return trimmed;

  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function githubSocialPreviewUrl(repository: string): string | undefined {
  const segments = repository.trim().split('/');
  if (segments.length !== 2) return undefined;
  if (segments.some((segment) => !/^[a-zA-Z0-9_.-]+$/.test(segment))) return undefined;
  if (segments.some((segment) => segment === '.' || segment === '..')) return undefined;
  return `https://opengraph.githubassets.com/${githubPreviewCacheKey}/${segments[0]}/${segments[1]}`;
}
