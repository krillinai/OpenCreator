import type { ImageProvider } from './provider.js';

export function createOpenAiCompatibleImageProvider(input: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}): ImageProvider {
  const fetchImpl = input.fetchImpl ?? fetch;
  return {
    id: 'openai-compatible',
    capabilities: { generate: true, edit: false },
    async generate(request, signal) {
      if (request.referenceImage !== undefined) throw new Error('unsupported_capability: reference image editing');
      const response = await fetchImpl(`${input.baseUrl.replace(/\/$/, '') || 'https://api.openai.com/v1'}/images/generations`, {
        method: 'POST',
        signal,
        headers: { authorization: `Bearer ${input.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: input.model,
          prompt: request.prompt,
          size: request.ratio === '16:9' ? '1536x1024' : request.ratio === '9:16' ? '1024x1536' : '1024x1024',
          response_format: 'b64_json'
        })
      });
      if (!response.ok) throw new Error(`image_provider_failed: HTTP ${response.status}`);
      const payload = await response.json() as { data?: Array<{ b64_json?: string; url?: string }> };
      const item = payload.data?.[0];
      if (item?.b64_json) return { bytes: Buffer.from(item.b64_json, 'base64'), mimeType: 'image/png' };
      if (item?.url) {
        const download = await fetchImpl(item.url, { signal });
        if (!download.ok) throw new Error('image_provider_download_failed');
        return { bytes: Buffer.from(await download.arrayBuffer()), mimeType: 'image/png' };
      }
      throw new Error('image_provider_invalid_response');
    }
  };
}
