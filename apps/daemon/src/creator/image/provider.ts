export type ImageGenerationRequest = {
  prompt: string;
  ratio: '16:9' | '1:1' | '9:16';
  referenceImage?: { bytes: Buffer; mimeType: string };
};

export type ImageGenerationResult = { bytes: Buffer; mimeType: 'image/png' | 'image/jpeg' };

export interface ImageProvider {
  readonly id: string;
  readonly capabilities: { generate: boolean; edit: boolean };
  generate(request: ImageGenerationRequest, signal: AbortSignal): Promise<ImageGenerationResult>;
}
