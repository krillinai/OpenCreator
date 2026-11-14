import type { GatewayModel } from '@opencreator/protocol';
import type { LocalizeCopy } from '../../i18n/useLocalizedCopy.js';
import { formatGatewayCreditAmount } from '../../features/account/billing-display.js';

const million = 1_000_000;
const positive = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

function hasAudioTokenRates(model: GatewayModel) {
  return (model.modality === 'speech' || model.modality === 'transcription')
    && (model.price?.inputPerMillion !== undefined || model.price?.outputPerMillion !== undefined);
}

function videoRates(model: GatewayModel) {
  const rates = model.price?.videoUnitsPerSecond;
  const resolutions = (model.resolutions?.length ? model.resolutions : Object.keys(rates ?? {}))
    .filter(resolution => Number.isSafeInteger(rates?.[resolution]) && positive(rates?.[resolution]));
  return resolutions.map(resolution => ({ resolution, credits: rates![resolution]! / million }));
}

function videoRate(model: GatewayModel) {
  const rates = videoRates(model);
  return rates.find(rate => rate.resolution === '720p') ?? rates[0];
}

function videoClipEstimate(model: GatewayModel) {
  const clip = model.price?.estimates?.clip;
  const units = Number(clip?.creditUnits);
  if (clip && Number.isSafeInteger(units) && units > 0 && positive(clip.seconds) && clip.resolution) {
    return { credits: units / million, seconds: clip.seconds, resolution: clip.resolution };
  }
  const rate = videoRate(model);
  const durations = model.durations?.filter(positive).sort((a, b) => a - b) ?? [];
  const seconds = durations.includes(5) ? 5 : durations[0];
  return rate && seconds ? { credits: rate.credits * seconds, seconds, resolution: rate.resolution } : undefined;
}

function videoPriceDescription(model: GatewayModel, l: LocalizeCopy) {
  const rule = l('费用 = 每秒积分 × 视频秒数；清晰度不同，单价不同。显示单价取整，扣费保留内部精度。', 'Cost = credits per second × video duration; rates vary by resolution. Displayed rates are rounded; settlement retains internal precision.');
  const clip = videoClipEstimate(model);
  if (!clip) return rule;
  const cost = formatGatewayCreditAmount(clip.credits);
  return [rule, l(`例如生成 ${clip.seconds} 秒 ${clip.resolution} 视频，约 ${cost} 积分。`, `For example, a ${clip.seconds}-second ${clip.resolution} video costs about ${cost} credits.`)].join('\n');
}

export function officialVideoModelListPrice(model: GatewayModel, l: LocalizeCopy): string {
  const clip = videoClipEstimate(model);
  if (clip) {
    const credits = formatGatewayCreditAmount(clip.credits);
    return l(`约 ${credits} 积分 / ${clip.seconds} 秒 · ${clip.resolution}`,
      `About ${credits} credits / ${clip.seconds}s · ${clip.resolution}`,
      `Cirka ${credits} krediter / ${clip.seconds} s · ${clip.resolution}`);
  }
  if (videoRate(model)) return officialModelPrice(model, l);
  return l('价格暂不可用', 'Price unavailable', 'Pris saknas');
}

function modelEstimate(model: GatewayModel, l: LocalizeCopy) {
  const p = model.price;
  if (!p) return undefined;
  const context = model.modality === 'image' ? 'image' : (model.modality === 'transcription' || model.modality === 'speech' && !p.estimates?.call) && p.estimates?.minute ? 'minute' : 'call';
  const quote = p.estimates?.[context];
  const units = Number(quote?.creditUnits);
  if (quote && Number.isSafeInteger(units) && units > 0) {
    const images = model.modality === 'image' ? quote.images ?? 1 : 1;
    const credits = units / million / images;
    const characters = quote.usage?.base;
    const unit = model.modality === 'image' ? l('积分/张', 'credits / image')
      : context === 'minute' ? l('积分/分钟', 'credits / minute')
        : characters ? l(`积分/${characters}字符`, `credits / ${characters} characters`) : l('积分/次', 'credits / call');
    const description = model.modality === 'image'
      ? images > 1 ? l(`每次返回 ${images} 张图片，按完整批次扣积分。`, `${images} images per request, billed per complete batch.`)
        : l('按服务器提供的图片规格估算，实际按用量结算。', 'Estimate uses server image settings; billed by actual usage.')
      : context === 'minute' ? l('按实际音频秒数结算，不足一分钟按比例扣积分。', 'Billed proportionally by actual audio seconds.')
        : characters ? l(`按 ${characters} 个输入字符估算，实际按模型费率结算。`, `Estimate for ${characters} input characters, billed at the model tariff.`)
          : l(`按输入 ${quote.usage?.input ?? 0}、输出 ${quote.usage?.output ?? 0} token 估算，实际按用量结算。`, `Estimate for ${quote.usage?.input ?? 0} input and ${quote.usage?.output ?? 0} output tokens; billed by actual usage.`);
    return { credits, unit, description };
  }
  // Unit conversion of an explicit tariff does not introduce workload assumptions.
  if (model.modality === 'image' && positive(p.perRequest)) return { credits: p.perRequest / (model.imageOptions?.imagesPerRequest ?? 1), unit: l('积分/张', 'credits / image'), description: l('按每次请求返回的图片数量计价。', 'Priced using the images returned per request.') };
  if (model.modality === 'transcription' && positive(p.perMinute)) return { credits: p.perMinute, unit: l('积分/分钟', 'credits / minute'), description: l('按实际音频秒数结算，不足一分钟按比例扣积分。', 'Actual audio seconds are billed proportionally, including partial minutes.') };
  if (model.modality === 'speech' && p.inputPerMillion === undefined && p.outputPerMillion === undefined && positive(p.perMillionCharacters) && !positive(p.perMinute)) return { credits: p.perMillionCharacters / 1000, unit: l('积分/千字符', 'credits / 1,000 characters'), description: l('按实际输入字符数结算。', 'Billed by actual input character count.') };
  return undefined;
}

export function officialModelPrice(model: GatewayModel, l: LocalizeCopy): string {
  if (!model.price) return '';
  const p = model.price;
  if (model.modality === 'text') {
    if (!positive(p.inputPerMillion) || !positive(p.outputPerMillion)) return l('价格暂不可用', 'Price unavailable');
    return l(`输入 ${formatGatewayCreditAmount(p.inputPerMillion)} / 输出 ${formatGatewayCreditAmount(p.outputPerMillion)} 积分/百万 token`, `Input ${formatGatewayCreditAmount(p.inputPerMillion)} / output ${formatGatewayCreditAmount(p.outputPerMillion)} credits/M tokens`);
  }
  if (model.modality === 'video') {
    const rate = videoRate(model);
    return rate ? l(`${rate.resolution}：每秒约 ${formatGatewayCreditAmount(rate.credits)} 积分`, `${rate.resolution}: about ${formatGatewayCreditAmount(rate.credits)} credits per second`) : l('价格暂不可用', 'Price unavailable');
  }
  if (hasAudioTokenRates(model)) return officialModelTariff(model, l);
  const estimate = modelEstimate(model, l);
  return estimate ? l(`约 ${formatGatewayCreditAmount(estimate.credits)} ${estimate.unit}`, `About ${formatGatewayCreditAmount(estimate.credits)} ${estimate.unit}`) : l('暂无法估算', 'Estimate unavailable');
}

export function officialModelPriceDescription(model: GatewayModel, l: LocalizeCopy): string {
  const description = model.modality === 'text'
    ? l('按实际输入、输出及适用的缓存 token 用量结算；长上下文和分时费率按请求适用规则计算。显示单价取整，扣费保留内部精度。', 'Billed by actual input, output and applicable cache token usage, with context tiers and time-based rates applied per request. Displayed rates are rounded; settlement retains internal precision.')
    : model.modality === 'video'
      ? videoPriceDescription(model, l)
      : hasAudioTokenRates(model)
        ? model.modality === 'speech'
          ? l('按实际文本输入及音频输出用量结算。显示单价取整，扣费保留内部精度。', 'Billed by actual text input and audio output usage. Displayed rates are rounded; settlement retains internal precision.')
          : l('按实际音频输入及文本输出用量结算。显示单价取整，扣费保留内部精度。', 'Billed by actual audio input and text output usage. Displayed rates are rounded; settlement retains internal precision.')
        : modelEstimate(model, l)?.description;
  return [description, officialModelTariff(model, l)].filter(Boolean).join('\n');
}

function officialModelTariff(model: GatewayModel, l: LocalizeCopy): string {
  const p = model.price;
  if (!p) return '';
  const amount = formatGatewayCreditAmount;
  if (model.modality === 'video') return videoRates(model).map(rate => l(`${rate.resolution}：每秒约 ${amount(rate.credits)} 积分`, `${rate.resolution}: about ${amount(rate.credits)} credits per second`)).join('\n');
  const components: string[] = [];
  if (model.modality === 'speech' || model.modality === 'transcription') {
    const rates = [p.inputPerMillion, p.outputPerMillion, p.perMinute, p.perMillionCharacters, p.perRequest];
    if (rates.some(rate => rate !== undefined && (!Number.isFinite(rate) || rate < 0))) return l('价格暂不可用', 'Price unavailable');
    if (p.inputPerMillion !== undefined && p.outputPerMillion !== undefined) {
      components.push(model.modality === 'speech'
        ? l(`文本输入 ${amount(p.inputPerMillion)} / 音频输出 ${amount(p.outputPerMillion)} 积分/百万 token`, `Text input ${amount(p.inputPerMillion)} / audio output ${amount(p.outputPerMillion)} credits/M tokens`)
        : l(`音频输入 ${amount(p.inputPerMillion)} / 文本输出 ${amount(p.outputPerMillion)} 积分/百万 token`, `Audio input ${amount(p.inputPerMillion)} / text output ${amount(p.outputPerMillion)} credits/M tokens`));
    } else {
      if (p.inputPerMillion !== undefined) components.push(model.modality === 'speech' ? l(`文本输入 ${amount(p.inputPerMillion)} 积分/百万 token`, `Text input ${amount(p.inputPerMillion)} credits/M tokens`) : l(`音频输入 ${amount(p.inputPerMillion)} 积分/百万 token`, `Audio input ${amount(p.inputPerMillion)} credits/M tokens`));
      if (p.outputPerMillion !== undefined) components.push(model.modality === 'speech' ? l(`音频输出 ${amount(p.outputPerMillion)} 积分/百万 token`, `Audio output ${amount(p.outputPerMillion)} credits/M tokens`) : l(`文本输出 ${amount(p.outputPerMillion)} 积分/百万 token`, `Text output ${amount(p.outputPerMillion)} credits/M tokens`));
    }
    if (positive(p.perMinute)) components.push(l(`${amount(p.perMinute)} 积分/分钟`, `${amount(p.perMinute)} credits/min`));
    if (positive(p.perMillionCharacters)) components.push(l(`${amount(p.perMillionCharacters)} 积分/百万字符`, `${amount(p.perMillionCharacters)} credits/M characters`));
    if (positive(p.perRequest)) components.push(l(`${amount(p.perRequest)} 积分/次`, `${amount(p.perRequest)} credits/request`));
    return components.join(' + ');
  }
  if (positive(p.perRequest)) return l(`${amount(p.perRequest)} 积分/次`, `${amount(p.perRequest)} credits/request`);
  if (model.modality === 'image' && p.billing === 'usage') return l(`文本输入 ${amount(p.inputPerMillion)} / 图片输入 ${amount(p.imageInputPerMillion)} / 输出 ${amount(p.outputPerMillion)} 积分/百万 token`, `Text ${amount(p.inputPerMillion)} / image ${amount(p.imageInputPerMillion)} in / output ${amount(p.outputPerMillion)} credits/M tokens`);
  if (p.inputPerMillion !== undefined && p.outputPerMillion !== undefined) components.push(l(`输入 ${amount(p.inputPerMillion)} / 输出 ${amount(p.outputPerMillion)} 积分/百万 token`, `${amount(p.inputPerMillion)} in / ${amount(p.outputPerMillion)} out credits/M tokens`));
  if (p.cachedInputPerMillion !== undefined) components.push(l(`缓存输入 ${amount(p.cachedInputPerMillion)}`, `${amount(p.cachedInputPerMillion)} cached input`));
  if (p.cacheWritePerMillion !== undefined) components.push(l(`缓存写入 ${amount(p.cacheWritePerMillion)}`, `${amount(p.cacheWritePerMillion)} cache write`));
  return components.join(' · ');
}
