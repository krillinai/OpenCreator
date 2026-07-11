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
  const sources = [approvedExample?.url, fallbackCover].filter(Boolean) as string[];
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
    <div className="skill-market-cover__css" aria-label={`${item.title} 封面`}>
      <span className="skill-market-cover__pill">{item.subcategory}</span>
      <div className="skill-market-cover__fallback-body">
        <ImageIcon size={compact ? 20 : 24} aria-hidden="true" />
        <strong>{item.title}</strong>
        <span>{item.category.name}</span>
      </div>
    </div>
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
  const [failed, setFailed] = useState(!src);
  const initial = name.trim().charAt(0).toLocaleUpperCase() || '?';

  if (failed || src === undefined) {
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
      src={src}
    />
  );
}
