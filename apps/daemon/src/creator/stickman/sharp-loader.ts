import type sharp from 'sharp';

let loading: Promise<typeof sharp> | undefined;

export async function loadSharp(): Promise<typeof sharp> {
  loading ??= import('sharp').then(module => module.default);
  return await loading;
}
