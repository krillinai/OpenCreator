export type BusinessGoal =
  | 'content-production'
  | 'personal-brand'
  | 'creator-operations'
  | 'ecommerce-content'
  | 'marketing-growth'
  | 'lead-generation'
  | 'conversion'
  | 'customer-retention';

export type ListingStatus =
  | 'featured'
  | 'verified'
  | 'curated-exception'
  | 'reviewing'
  | 'rejected';

export type SkillMarketCategory = {
  id: string;
  name: string;
  description: string;
};

export type SkillMarketSourceExample = {
  type: 'image' | 'video';
  url: string;
  title: string;
  source: 'readme' | 'release' | 'docs' | 'manual';
  relevance: 'direct-output' | 'workflow-preview' | 'interface-preview';
  approved: boolean;
};

export type CreatorSkillSource = {
  id: string;
  name: string;
  titleZh: string;
  tagline: string;
  summary: string;
  category: string;
  subcategory: string;
  platforms: string[];
  tasks: string[];
  businessGoals: BusinessGoal[];
  creator: {
    name: string;
    avatarUrl: string;
  };
  github: {
    repo: string;
    url: string;
    stars: number;
    forks: number;
    license: string | null;
    lastPushedAt: string | null;
    defaultBranch: string;
    skillPath?: string;
    readmeText?: string;
    readmeLanguage?: 'zh' | 'en' | 'unknown';
  };
  examples: SkillMarketSourceExample[];
  inputs: string[];
  outputs: string[];
  install: {
    agentInstruction: string;
    humanSteps: string[];
    command?: string;
    officialDocsUrl?: string;
  };
  risks: {
    requiresLogin: boolean;
    requiresApiKey: boolean;
    externalWrite: boolean;
    readsLocalFiles: boolean;
    commercialLicenseReview: boolean;
    privateDataRisk: boolean;
    notes: string[];
  };
  listingStatus: ListingStatus;
  relatedSkillIds: string[];
};

export type SkillMarketInstallSource = {
  repository: string;
  skillPath: string;
  ref: string;
  marketRevision: number;
};

export type SkillMarketEntry = {
  id: string;
  name: string;
  title: string;
  githubRepository: string;
  tagline: string;
  summary: string;
  category: string;
  subcategory: string;
  platforms: string[];
  tasks: string[];
  creator: { name: string; avatarUrl: string };
  examples: Array<{
    type: 'image' | 'video';
    url: string;
    title: string;
    approved: boolean;
  }>;
  inputs: string[];
  outputs: string[];
  risks: {
    requiresLogin: boolean;
    requiresApiKey: boolean;
    externalWrite: boolean;
    readsLocalFiles: boolean;
    privateDataRisk: boolean;
    notes: string[];
  };
  listingStatus: 'featured' | 'verified' | 'curated-exception';
  install: SkillMarketInstallSource;
};
