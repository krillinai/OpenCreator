import { ImageIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SkillMarketViewEntry } from './skill-market-model.js';

const fallbackCovers = [
  '/skill-market/examples/gpt-image-2-info-poster.png',
  '/skill-market/examples/nano-banana-pro-product-visual.png',
  '/skill-market/examples/seedance-2-video-ad.png',
] as const;

export function SkillMarketCover({
  item,
  compact = false,
}: {
  item: SkillMarketViewEntry;
  compact?: boolean;
}) {
  const approvedExample = item.entry.examples.find((example) => example.approved);
  const fallbackCover = useMemo(() => {
    const hash = [...item.id].reduce((sum, char) => sum + char.charCodeAt(0), 0);
    return fallbackCovers[hash % fallbackCovers.length];
  }, [item.id]);
  const sources = [approvedExample?.url, fallbackCover]
    .map((source) => (source ? normalizeSkillMarketAssetUrl(source) : undefined))
    .filter(Boolean) as string[];
  const [sourceIndex, setSourceIndex] = useState(sources.length > 0 ? 0 : -1);
  const source = sourceIndex >= 0 ? sources[sourceIndex] : undefined;

  if (source !== undefined) {
    return (
      <img
        alt={approvedExample?.title ?? `${item.title} 封面`}
        className="skill-market-cover__image"
        draggable={false}
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
    <span className="skill-market-cover__css" aria-label={`${item.title} 封面`}>
      <span className="skill-market-cover__pill">{item.subcategory}</span>
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
