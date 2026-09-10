export type CreatorVisualAssetKind = 'character' | 'style';
export type CreatorVisualAssetSource = 'builtin' | 'user';
export type CreatorVisualAssetStatus = 'draft' | 'ready' | 'disabled';

export type CreatorVisualAssetRef = {
  assetId: string;
  revision: number;
};

export type CreatorVisualAssetLocalizedText = {
  zhCN: string;
  en: string;
};

export type CreatorVisualStyleSwatch = {
  background: string;
  foreground: string;
  accent: string;
  texture: 'none' | 'paper' | 'screentone' | 'marker';
};

export type CreatorVisualAssetSummary = {
  id: string;
  revision: number;
  templateId: string;
  kind: CreatorVisualAssetKind;
  source: CreatorVisualAssetSource;
  status: CreatorVisualAssetStatus;
  name: CreatorVisualAssetLocalizedText;
  description: CreatorVisualAssetLocalizedText;
  previewUrl: string | null;
  referenceCount: number;
  recommended: boolean;
  tags: string[];
  styleAttributes?: {
    medium: CreatorVisualAssetLocalizedText;
    palette: CreatorVisualAssetLocalizedText;
    sceneDensity: CreatorVisualAssetLocalizedText;
    swatch: CreatorVisualStyleSwatch;
  };
};

export type CreatorVisualAssetCatalogResponse = {
  assets: CreatorVisualAssetSummary[];
};
