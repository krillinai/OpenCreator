import { Box } from 'lucide-react';
import { useState } from 'react';
import type { GatewayModel } from '@opencreator/protocol';
import './model-brand-icon.css';

type ModelIdentity = Pick<GatewayModel, 'id' | 'name'>;

const brands = [
  { id: 'bytedance', name: 'ByteDance', match: /seedance|seedream|doubao|bytedance|jimeng|volcengine|volcano|字节|豆包|即梦/i, asset: 'bytedance-color.svg' },
  { id: 'minimax', name: 'MiniMax', match: /minimax|speech-[\d.]+-hd/i, asset: 'minimax-color.svg' },
  { id: 'kling', name: 'Kling', match: /kling|可灵/i, asset: 'kling-color.svg' },
  { id: 'google', name: 'Google', match: /google|gemini|\bveo\b|nano[- ]?banana/i, asset: 'google-color.svg' },
  { id: 'openai', name: 'OpenAI', match: /openai|codex-native|\bgpt\b|\bsora\b|\bdall[- ]?e\b|\bo[134](?:\b|-)/i, asset: 'openai.svg', monochrome: true },
  { id: 'anthropic', name: 'Anthropic', match: /anthropic|claude/i, asset: 'claude-color.svg' },
  { id: 'deepseek', name: 'DeepSeek', match: /deepseek/i, asset: 'deepseek-color.svg' },
  { id: 'qwen', name: 'Qwen', match: /qwen|通义千问/i, asset: 'qwen-color.svg' },
  { id: 'alibaba', name: 'Alibaba', match: /alibaba|\bwan\b|wanx|通义万相/i, asset: 'alibaba-color.svg' }
];

export function modelBrand(model: ModelIdentity) {
  if (/openrouter/i.test(model.id)) return undefined;
  return brands.find(brand => brand.match.test(model.name ?? ''))
    ?? brands.find(brand => brand.match.test(model.id));
}

export default function ModelBrandIcon(props: { model: ModelIdentity; className?: string }) {
  const brand = modelBrand(props.model);
  const src = brand ? `/model-brands/${brand.asset}` : undefined;
  const [failedAsset, setFailedAsset] = useState<string>();
  return <span className={`model-brand-icon${props.className ? ` ${props.className}` : ''}`} data-brand={brand?.id ?? 'generic'} aria-hidden="true">
    {src && failedAsset !== src ? <img
      src={src} alt="" width={24} height={24} decoding="async"
      className={brand?.monochrome ? 'model-brand-monochrome' : undefined}
      onError={() => setFailedAsset(src)}
    /> : <Box size={20} strokeWidth={1.6} />}
  </span>;
}
