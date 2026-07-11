import type { SkillMarketInstallSource } from './types.js';

const installableSkills = {
  biliup: {
    repository: 'biliup/biliup',
    commit: '18c5bf086e943e07e9d88a905d2e5d407d6305bb',
  },
  'codebase-to-course': {
    repository: 'zarazhangrui/codebase-to-course',
    commit: 'ff8837ecf8e9f6ce9874ffa42e42633394a52a00',
  },
  'follow-builders': {
    repository: 'zarazhangrui/follow-builders',
    commit: 'aa6769f2a0be11fe663c4594a48d9679075f06c1',
  },
  'frontend-slides': {
    repository: 'zarazhangrui/frontend-slides',
    commit: '9906a34d640d2111f724544cbc50f7f130569ae1',
  },
  'guizang-social-card-skill': {
    repository: 'op7418/guizang-social-card-skill',
    commit: 'cf4b810fac1c73fb65a2bb31d8c9278d82cbc4c5',
  },
  'op7418-humanizer-zh': {
    repository: 'op7418/Humanizer-zh',
    commit: '91f3d394db8419c20d67ebe22a96cf8fee0a404b',
  },
} as const;

export function installSourceForSkill(skillId: string): SkillMarketInstallSource {
  if (skillId === 'garrytan-gstack') {
    return { available: false, reason: 'unsafe_archive' };
  }

  const source = installableSkills[skillId as keyof typeof installableSkills];
  if (!source) {
    return { available: false, reason: 'missing_skill_manifest' };
  }

  return {
    available: true,
    repository: source.repository,
    skillPath: '.',
    commit: source.commit,
    marketRevision: 1,
  };
}
