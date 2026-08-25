import { readFile, stat } from 'node:fs/promises';

export async function validateImageFile(path: string): Promise<{ format: 'png' | 'jpeg'; bytes: number }> {
  const info = await stat(path);
  if (!info.isFile() || info.size < 16) throw new Error('invalid_image: empty image');
  const header = (await readFile(path)).subarray(0, 12);
  const png = header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg = header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (!png && !jpeg) throw new Error('invalid_image: unsupported image');
  return { format: png ? 'png' : 'jpeg', bytes: info.size };
}
