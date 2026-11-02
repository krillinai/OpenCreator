import type { CreatorSubtitleRenderRequest, CreatorSubtitleRenderBundle } from '@opencreator/protocol';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';
import { buildKrillinSubtitleStyle } from './adapter.js';
import { readKrillinRuntimeManifest, resolveInside } from './manifest.js';

const execute = promisify(execFile);
type Font = { family: string; file: string; sha256: string };

export function createSubtitleRenderService(input: {
  resourceRoot: string; workRoot: string; ensureRuntimeReady(): Promise<void>;
}) {
  const cache = new Map<string, Promise<CreatorSubtitleRenderBundle>>();
  async function fonts(): Promise<Font[]> {
    const manifest = JSON.parse(await readFile(join(input.resourceRoot, 'fonts/manifest.json'), 'utf8')) as { fonts: Font[]; fallbackFonts?: Font[] };
    return [...manifest.fonts, ...manifest.fallbackFonts ?? []];
  }
  async function compile(request: CreatorSubtitleRenderRequest): Promise<CreatorSubtitleRenderBundle> {
    await input.ensureRuntimeReady();
    const manifest = readKrillinRuntimeManifest(input.resourceRoot);
    const cli = manifest.resources.find(resource => /(?:^|\/)krillinai-cli(?:\.exe)?$/i.test(resource.path));
    if (!cli) throw new Error('Subtitle compiler is unavailable');
    const fontManifest = await fonts();
    const style = buildKrillinSubtitleStyle(request.subtitleStyle);
    const hash = createHash('sha256').update(JSON.stringify([1, cli.sha256, fontManifest, request, style])).digest('hex');
    const cached = cache.get(hash);
    if (cached) { cache.delete(hash); cache.set(hash, cached); return cached; }
    const pending = (async () => {
      await mkdir(input.workRoot, { recursive: true });
      const workdir = await mkdtemp(join(input.workRoot, 'subtitle-compile-'));
      try {
        const document = join(workdir, 'document.json');
        const stylePath = join(workdir, 'style.json');
        const output = join(workdir, 'subtitles.ass');
        await writeFile(document, JSON.stringify(request), { mode: 0o600 });
        await writeFile(stylePath, JSON.stringify(style), { mode: 0o600 });
        try {
          await execute(resolveInside(input.resourceRoot, cli.path), ['compile-subtitles', '--input', document, '--output', output, '--subtitle-style-file', stylePath], {
            env: { ...process.env, KRILLINAI_RESOURCE_ROOT: input.resourceRoot },
            timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true
          });
        } catch (cause) {
          const stdout = (cause as { stdout?: string }).stdout;
          let response: { error?: { message?: string } } | undefined;
          try { response = JSON.parse(stdout?.trim().split('\n').at(-1) ?? ''); } catch { /* Keep process failures without JSON diagnostics. */ }
          if (response?.error?.message) throw new Error(response.error.message);
          throw cause;
        }
        const ass = await readFile(output, 'utf8');
        // Load only families selected by the compiled track, including explicit
        // script fallbacks. The native renderer reads the same TTF bytes.
        const selected = fontManifest.filter(font => ass.includes(font.family));
        return { schemaVersion: 1 as const, contentHash: createHash('sha256').update(ass).update(JSON.stringify(selected)).digest('hex'), ass, width: request.width, height: request.height,
          fonts: selected.map(font => ({ id: font.sha256, family: font.family, sha256: font.sha256 })) };
      } finally { await rm(workdir, { recursive: true, force: true }); }
    })();
    cache.set(hash, pending);
    while (cache.size > 8) cache.delete(cache.keys().next().value!);
    try { return await pending; } catch (error) { cache.delete(hash); throw error; }
  }
  return {
    compile,
    async font(id: string): Promise<Buffer | undefined> {
      if (!/^[a-f0-9]{64}$/.test(id)) return undefined;
      await input.ensureRuntimeReady();
      const font = (await fonts()).find(font => font.sha256 === id);
      if (!font) return undefined;
      const data = await readFile(join(input.resourceRoot, 'fonts', basename(font.file)));
      if (createHash('sha256').update(data).digest('hex') !== id) throw new Error('Subtitle font hash mismatch');
      return data;
    }
  };
}
