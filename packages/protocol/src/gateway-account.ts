export type ServiceSource = 'manual' | 'gateway';
export const gatewayDefaultVoiceId = '__default__';
export type GatewayModel = {
  id: string;
  name?: string;
  modality: 'text' | 'image' | 'video' | 'speech' | 'transcription';
  capabilities: string[];
  voices?: string[];
  sizes?: string[];
  durations?: number[];
  resolutions?: string[];
  aspectRatios?: string[];
  imageOptions?: {
    aspectRatios?: string[];
    resolutions?: string[];
    qualities?: string[];
    outputFormats?: string[];
    maxImages: number;
    maxReferences: number;
  };
};
export type GatewayAccountState = {
  source: ServiceSource;
  authState: 'signed_out' | 'authorizing' | 'signed_in' | 'signing_out' | 'expired' | 'disabled';
  activationState: 'inactive' | 'loading' | 'ready' | 'blocked';
  account: { id: string; email: string; verified: boolean; avatarUrl?: string } | null;
  bindingVersion: string | null;
  models: GatewayModel[];
  selectedModels?: Partial<Record<GatewayModel['modality'], string>>;
  activationError: { code: string; message: string } | null;
};

export function gatewayVideoSizes(model: GatewayModel | undefined): string[] {
  if (model?.sizes?.length) return model.sizes;
  return (model?.resolutions ?? []).flatMap(resolution =>
    (model?.aspectRatios ?? []).filter(ratio => /^\d+:\d+$/.test(ratio)).map(ratio => `${resolution}@${ratio}`));
}

export function gatewayVideoSizeParameters(model: GatewayModel, value: string): { size: string } | { resolution: string; aspect_ratio: string } | undefined {
  if (!gatewayVideoSizes(model).includes(value)) return undefined;
  if (model.sizes?.includes(value)) return { size: value };
  const [resolution, aspect_ratio] = value.split('@');
  return resolution && aspect_ratio ? { resolution, aspect_ratio } : undefined;
}
export type GatewayAuthorization = { attemptId: string; authorizationUrl: string; expiresAt: string };
export type GatewayBalanceSnapshot = { availableUnits: string; reservedUnits: string; periodEnd: string | null; asOf: string };
export type GatewayBalanceState =
  | { status: 'ready'; value: GatewayBalanceSnapshot }
  | { status: 'unavailable'; lastKnown: GatewayBalanceSnapshot | null; code: string };
