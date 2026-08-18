import sourceSkills from './source-skills.json' with { type: 'json' };
import sourceCategories from './source-categories.json' with { type: 'json' };
import { customSkills } from './custom-skills.js';
import type {
  CreatorSkillSource,
  SkillMarketCategory,
  SkillMarketEntry,
} from './types.js';

const visibleStatuses = new Set<SkillMarketEntry['listingStatus']>([
  'featured',
  'verified',
  'curated-exception',
]);

const sourceCommit = '91302f79937b8f4e194e56554afdbb2ca939a1d5';

function isVisibleListingStatus(
  status: CreatorSkillSource['listingStatus']
): status is SkillMarketEntry['listingStatus'] {
  return visibleStatuses.has(status as SkillMarketEntry['listingStatus']);
}

function isVisibleSkill(
  skill: CreatorSkillSource
): skill is CreatorSkillSource & {
  listingStatus: SkillMarketEntry['listingStatus'];
} {
  return isVisibleListingStatus(skill.listingStatus);
}

export const skillMarketCandidateCatalog: readonly SkillMarketEntry[] = deepFreeze(
  [...customSkills, ...(sourceSkills as CreatorSkillSource[])]
    .filter(isVisibleSkill)
    .map(
      (skill): SkillMarketEntry => ({
        id: skill.id,
        name: skill.name,
        title: skill.titleZh,
        githubRepository: skill.github.repo,
        tagline: skill.tagline,
        summary: skill.summary,
        category: skill.category,
        subcategory: skill.subcategory,
        platforms: [...skill.platforms],
        tasks: [...skill.tasks],
        creator: { ...skill.creator },
        examples: skill.examples
          .filter((example) => example.approved)
          .map((example) => ({
            type: example.type,
            url: example.url,
            title: example.title,
            approved: true,
          })),
        inputs: [...skill.inputs],
        outputs: [...skill.outputs],
        risks: {
          requiresLogin: skill.risks.requiresLogin,
          requiresApiKey: skill.risks.requiresApiKey,
          externalWrite: skill.risks.externalWrite,
          readsLocalFiles: skill.risks.readsLocalFiles,
          privateDataRisk: skill.risks.privateDataRisk,
          notes: [...skill.risks.notes],
        },
        listingStatus: skill.listingStatus,
        install: {
          repository: skill.github.repo,
          skillPath: skill.github.skillPath ?? '.',
          ref: skill.github.defaultBranch,
          marketRevision: 1,
        },
      })
    )
);

export const skillMarketCatalog: readonly SkillMarketEntry[] = deepFreeze([]);

export const skillMarketCategories: readonly SkillMarketCategory[] = deepFreeze(
  structuredClone(sourceCategories) as SkillMarketCategory[]
);

export const skillMarketSourceCommit = sourceCommit;

export function getSkillMarketEntry(id: string): SkillMarketEntry | undefined {
  return skillMarketCatalog.find((entry) => entry.id === id);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
