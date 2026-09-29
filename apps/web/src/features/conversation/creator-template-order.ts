import type { CreatorPresetSummary } from '@opencreator/protocol';
import operatorOrder from './creator-template-order-运营排序.json' with { type: 'json' };

export type OperatorCategory = 'recommended' | 'all' | 'video' | 'image';
export type OperatorOrder = Record<OperatorCategory, Array<{ preset: string; order: number }>>;

export function orderCreatorPresets(
  presets: CreatorPresetSummary[],
  category: OperatorCategory,
  configuration: OperatorOrder = operatorOrder
): CreatorPresetSummary[] {
  const ranks = new Map(configuration[category].map(entry => [entry.preset, entry.order]));
  return [...presets].sort((left, right) => {
    const leftRank = ranks.get(`${left.module}/${left.id}`) ?? Infinity;
    const rightRank = ranks.get(`${right.module}/${right.id}`) ?? Infinity;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.sortOrder - right.sortOrder
      || left.title.localeCompare(right.title)
      || left.module.localeCompare(right.module)
      || left.id.localeCompare(right.id);
  });
}
