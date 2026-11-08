import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildKrillinSubtitleStyle } from '../../src/creator/krillin/adapter.js';
import { createSubtitlePreviewService } from '../../src/creator/krillin/subtitle-preview.js';
import { createSubtitleRenderService } from '../../src/creator/krillin/subtitle-render.js';
import { readKrillinRuntimeManifest } from '../../src/creator/krillin/manifest.js';
import { resolveYtDlpRuntime } from '../../src/creator/yt-dlp/runtime.js';
import sharp from 'sharp';

const repoRoot = resolve(process.cwd(), '../..');
const runtimeRoot = resolve(
  process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT
    ?? join(repoRoot, 'apps/desktop/.pack/creator-runtime/krillinai')
);
const suffix = process.platform === 'win32' ? '.exe' : '';
const cliPath = join(runtimeRoot, 'bin', `krillinai-cli${suffix}`);
const ffmpegPath = join(runtimeRoot, 'bin', `ffmpeg${suffix}`);
const fontManifestPath = join(runtimeRoot, 'fonts', 'manifest.json');
const hasPackagedRuntime = [cliPath, ffmpegPath, fontManifestPath].every(existsSync);
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

describe.runIf(hasPackagedRuntime)('Creator packaged subtitle rendering', () => {
  it('compiles complete documents without model configuration and returns verified packaged fonts', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opencreator-subtitle-document-'));
    roots.push(root);
    const service = createSubtitleRenderService({ resourceRoot: runtimeRoot, workRoot: root, ensureRuntimeReady: async () => {} });
    const input = { width: 640, height: 360, horizontal: true, bilingual: true, subtitlePosition: 'bottom' as const,
      subtitleStyle: { fontPreset: 'sans' }, cues: [{ startMs: 1230, endMs: 4560, text: '完整字幕！\n手动换行', sourceText: 'Original context, '.repeat(20) }] };
    const [first, second] = await Promise.all([service.compile(input), service.compile(input)]);
    expect(first).toEqual(second);
    expect(first.ass).toContain(input.cues[0]!.sourceText);
    expect(first.ass).toContain('完整字幕！\\N手动换行');
    expect(first.ass).toContain('00:00:01.23,00:00:04.56');
    expect(first.fonts.length).toBeGreaterThan(0);
    for (const font of first.fonts) {
      const bytes = await service.font(font.id);
      expect(createHash('sha256').update(bytes!).digest('hex')).toBe(font.sha256);
    }
    expect(await service.font('../manifest.json')).toBeUndefined();
    expect(await service.font('0'.repeat(64))).toBeUndefined();
    const changed = await service.compile({ ...input, subtitleStyle: { fontPreset: 'serif' } });
    expect(changed.contentHash).not.toBe(first.contentHash);
  });

  it('keeps bilingual glyphs sharp with a soft shadow and zero outline', async () => {
    const root = mkdtempSync(join(tmpdir(), 'opencreator-soft-shadow-'));
    roots.push(root);
    const service = createSubtitleRenderService({ resourceRoot: runtimeRoot, workRoot: root, ensureRuntimeReady: async () => {} });
    const input = { width: 1920, height: 1080, horizontal: true, bilingual: true, subtitlePosition: 'top' as const,
      cues: [{ startMs: 0, endMs: 2000, text: '你知道吗？你的人生今晚就可能彻底改变。', sourceText: 'Do you know your entire life can change tonight?' }] };
    const style = { fontPreset: 'sans', fontWeight: 'medium', outlineWidth: 0,
      shadow: { enabled: true, color: '#000000', opacity: 0.85, offsetX: 0, offsetY: 2, blur: 4 } };
    const frames: Buffer[] = [];
    for (const enabled of [false, true]) {
      const bundle = await service.compile({ ...input, subtitleStyle: { ...style, shadow: { ...style.shadow, enabled } } });
      const assPath = join(root, `${enabled}.ass`);
      writeFileSync(assPath, bundle.ass);
      frames.push(run(ffmpegPath, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black@0:s=1920x1080:d=1,format=rgba',
        '-ss', '0.5', '-vf', `ass=filename='${assPath}':fontsdir='${join(runtimeRoot, 'fonts')}':alpha=1`,
        '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], null));
    }
    const countPixels = (frame: Buffer, predicate: (r: number, alpha: number) => boolean) => {
      let count = 0;
      for (let i = 0; i < frame.length; i += 4) if (predicate(frame[i]!, frame[i + 3]!)) count++;
      return count;
    };
    const sharpGlyphs = frames.map(frame => countPixels(frame, (r, alpha) => r > 180 && alpha > 250));
    expect(sharpGlyphs[0]).toBeGreaterThan(10000);
    expect(sharpGlyphs[1]).toBeGreaterThan(sharpGlyphs[0]! * 0.95);
    expect(countPixels(frames[1]!, (r, alpha) => r < 5 && alpha > 5 && alpha < 200)).toBeGreaterThan(1000);
  });
  it.each([
    ['sans', 640, 360, 'top', false],
    ['serif', 640, 360, 'bottom', false],
    ['rounded', 360, 640, 'bottom', false],
    ['sans', 360, 640, 'bottom', true]
  ] as const)('uses the same rendered glyphs for %s preview and %dx%d burn-in with translation on %s (legacy mixed: %s)', async (fontPreset, width, height, position, mixed) => {
    const style = {
      fontPreset, fontWeight: 'bold', fontSize: 'medium',
      primaryColor: '#7EE7FF', secondaryColor: '#FFD45C', outlineColor: '#102030', outlineWidth: 2,
      verticalOffset: 40,
      shadow: { enabled: true, color: '#000000', opacity: 0.6, offsetX: -4, offsetY: 6, blur: 2 }
    } as const;
    const result = renderStyle(style, { width, height, position, mixed });
    const service = createSubtitlePreviewService({
      resourceRoot: runtimeRoot, workRoot: result.paths.workdir,
      ensureRuntimeReady: async () => {},
      getYtDlpRuntime: () => resolveYtDlpRuntime({ resourceRoot: runtimeRoot, manifest: readKrillinRuntimeManifest(runtimeRoot) })
    });
    const png = await service.render({ width, height, subtitleStyle: style, bilingual: true, subtitlePosition: position, translationText: 'Creator subtitle test', originalText: '创作字幕测试' });
    const rgba = await sharp(png).ensureAlpha().raw().toBuffer();
    const assPath = result.assPath;
    const frame = run(ffmpegPath, [
      '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x202020:s=${width}x${height}:d=2,format=rgba`, '-ss', '0.5',
      '-vf', `ass=filename='${assPath}':fontsdir='${join(runtimeRoot, 'fonts')}'`,
      '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
    ], null);
    let changedPixels = 0;
    let error = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const alpha = rgba[pixel * 4 + 3]! / 255;
      if (alpha === 0 && frame[pixel * 3] === 32 && frame[pixel * 3 + 1] === 32 && frame[pixel * 3 + 2] === 32) continue;
      changedPixels += 1;
      for (let channel = 0; channel < 3; channel += 1) {
        const composite = Math.round(rgba[pixel * 4 + channel]! * alpha + 32 * (1 - alpha));
        error += Math.abs(composite - frame[pixel * 3 + channel]!);
      }
    }
    expect(changedPixels).toBeGreaterThan(100);
    expect(rgba[3]).toBe(0);
    expect(error / (changedPixels * 3)).toBeLessThan(2);
  });

  it('applies directional shadow overrides to actual pixels', () => {
    const style = { shadow: { enabled: true, opacity: 0.6, offsetX: -6, offsetY: 6, blur: 0 } };
    const first = renderStyle(style);
    const second = renderStyle({ shadow: { ...style.shadow, offsetX: 6, offsetY: -6 } });
    expect(first.frame.sha256).not.toBe(second.frame.sha256);
  });
  it.each([
    [640, 360],
    [360, 640]
  ])('raises burned subtitles in %dx%d video when height increases', (width, height) => {
    const options = { width, height, position: 'top' };
    const baseline = renderStyle({ verticalOffset: 0 }, options);
    const raised = renderStyle({ verticalOffset: 40 }, options);
    expect(baseline.frame.changedPixels).toBeGreaterThan(100);
    expect(raised.frame.changedPixels).toBeGreaterThan(100);
    expect(baseline.frame.centerY - raised.frame.centerY).toBeGreaterThan(height * 0.1);
  });
  it('renders visibly different fixed frames and fails when a packaged font is missing', () => {
    const first = renderStyle({
      fontPreset: 'sans',
      fontWeight: 'regular',
      fontSize: 'small',
      primaryColor: '#FFFFFF',
      secondaryColor: '#FFD45C',
      outlineColor: '#000000',
      outlineWidth: 1,
      shadow: {
        enabled: false,
        color: '#000000',
        opacity: 0.65,
        offsetX: 2,
        offsetY: 2,
        blur: 1
      }
    });
    const second = renderStyle({
      fontPreset: 'serif',
      fontWeight: 'bold',
      fontSize: 'large',
      primaryColor: '#7EE7FF',
      secondaryColor: '#FF6B6B',
      outlineColor: '#16202A',
      outlineWidth: 5,
      shadow: {
        enabled: true,
        color: '#000000',
        opacity: 0.4,
        offsetX: -4,
        offsetY: 6,
        blur: 2.5
      }
    });

    expect(first.ass).toContain('Style: Major,OpenCreator Sans Regular,14,&H00FFFFFF');
    expect(first.ass).toContain('Style: Minor,OpenCreator Sans Regular,10,&H005CD4FF');
    expect(second.ass).toContain('Style: Major,OpenCreator Serif Bold,22,&H00FFE77E');
    expect(second.ass).toContain('Style: Minor,OpenCreator Serif Bold,15,&H006B6BFF');
    expect(second.ass).toContain('&H99000000');
    expect(second.ass).toContain(',5,6,2,10,10,20,1');
    expect(second.ass).toContain('\\xshad-4\\yshad6\\blur2.5');
    expect(first.frame.changedPixels).toBeGreaterThan(100);
    expect(second.frame.changedPixels).toBeGreaterThan(first.frame.changedPixels);
    expect(second.frame.sha256).not.toBe(first.frame.sha256);

    const missingRuntime = createMissingFontRuntime('OpenCreatorSerif-Bold.ttf');
    const failed = runCli(second.paths, second.stylePath, missingRuntime);
    expect(failed.status).not.toBe(0);
    expect(`${failed.stdout}\n${failed.stderr}`).toContain(
      'creator subtitle font unavailable: fonts/OpenCreatorSerif-Bold.ttf'
    );
  });
});

function renderStyle(style: Parameters<typeof buildKrillinSubtitleStyle>[0], options: { width: number; height: number; position: string; mixed?: boolean } = { width: 640, height: 360, position: 'top' }) {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-subtitle-render-'));
  roots.push(root);
  const launcher = join(root, 'launcher');
  const workdir = join(root, 'workdir');
  mkdirSync(join(launcher, 'config'), { recursive: true });
  mkdirSync(workdir, { recursive: true });
  writeFileSync(join(launcher, 'config', 'config.toml'), '[app]\nproxy = ""\n');
  const inputVideo = join(workdir, 'background.mp4');
  const subtitle = join(workdir, 'bilingual.srt');
  const stylePath = join(workdir, 'subtitle-style.json');
  const targetPath = join(workdir, 'target.srt');
  const timeline = '00:00:00,200 --> 00:00:01,800';
  writeFileSync(targetPath, `1\n${timeline}\nCreator subtitle test\n\n`);
  writeFileSync(
    subtitle,
    options.mixed
      ? `1\n${timeline}\nCreator subtitle test\n\n2\n${timeline}\n创作字幕测试\n\n`
      : `1\n${timeline}\n${(options.position === 'top' ? ['Creator subtitle test', '创作字幕测试'] : ['创作字幕测试', 'Creator subtitle test']).join('\n')}\n\n`
  );
  writeFileSync(stylePath, `${JSON.stringify(buildKrillinSubtitleStyle(style), null, 2)}\n`);
  run(ffmpegPath, [
    '-v', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=#202020:s=${options.width}x${options.height}:d=2:r=25`,
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    inputVideo
  ]);
  const horizontal = options.width >= options.height;
  const result = runCli({ launcher, workdir, inputVideo, subtitle }, stylePath, runtimeRoot, [
    `--line-mode=bilingual-target-${options.position}`,
    ...(options.mixed ? ['--mixed-target-subtitle', targetPath] : [])
  ], horizontal ? 'render-horizontal' : 'render-vertical');
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const outputVideo = join(workdir, `${horizontal ? 'horizontal' : 'vertical'}_bilingual.mp4`);
  const assPath = join(workdir, `formatted_${horizontal ? 'horizontal' : 'vertical'}_bilingual.ass`);
  expect(existsSync(outputVideo)).toBe(true);
  expect(existsSync(assPath)).toBe(true);
  return {
    ass: readFileSync(assPath, 'utf8'),
    assPath,
    frame: compareFramePixels(inputVideo, outputVideo, options.width),
    paths: { launcher, workdir, inputVideo, subtitle },
    stylePath
  };
}

function runCli(
  paths: { launcher: string; workdir: string; inputVideo: string; subtitle: string },
  stylePath: string,
  resourceRoot: string,
  extraArgs: string[] = [],
  command = 'render-horizontal'
) {
  const manifest = JSON.parse(readFileSync(join(runtimeRoot, 'manifest.json'), 'utf8'));
  const env = {
    ...process.env,
    PATH: [join(resourceRoot, 'bin'), process.env.PATH ?? ''].join(delimiter),
    Path: [join(resourceRoot, 'bin'), process.env.Path ?? process.env.PATH ?? ''].join(delimiter),
    KRILLINAI_RESOURCE_ROOT: resourceRoot,
    KRILLINAI_OFFLINE_DEPENDENCIES: '1',
    OPENCREATOR_KRILLINAI_CLI: '1',
    ...(manifest.ytDlp?.mode === 'python'
      ? {
          OPENCREATOR_YT_DLP_COMMAND: JSON.stringify([
            join(runtimeRoot, manifest.ytDlp.executable),
            join(runtimeRoot, manifest.ytDlp.script)
          ])
        }
      : {})
  };
  return spawnSync(cliPath, [
    command,
    '--workdir', paths.workdir,
    '--task-id', 'subtitle-render-test',
    '--video', paths.inputVideo,
    '--subtitle', paths.subtitle,
    '--subtitle-style-file', stylePath,
    ...extraArgs
  ], {
    cwd: paths.launcher,
    env,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024
  });
}

function compareFramePixels(sourceVideo: string, renderedVideo: string, width: number) {
  const source = rawFrame(sourceVideo);
  const rendered = rawFrame(renderedVideo);
  expect(rendered.length).toBe(source.length);
  let changedPixels = 0;
  let totalY = 0;
  for (let offset = 0; offset < rendered.length; offset += 3) {
    const distance = Math.abs(rendered[offset]! - source[offset]!)
      + Math.abs(rendered[offset + 1]! - source[offset + 1]!)
      + Math.abs(rendered[offset + 2]! - source[offset + 2]!);
    if (distance > 24) {
      changedPixels += 1;
      totalY += Math.floor(offset / (width * 3));
    }
  }
  return {
    changedPixels,
    centerY: changedPixels === 0 ? 0 : totalY / changedPixels,
    sha256: createHash('sha256').update(rendered).digest('hex')
  };
}

function rawFrame(video: string): Buffer {
  return run(ffmpegPath, [
    '-v', 'error',
    '-ss', '1',
    '-i', video,
    '-frames:v', '1',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgb24',
    'pipe:1'
  ], null);
}

function createMissingFontRuntime(fileName: string): string {
  const root = mkdtempSync(join(tmpdir(), 'opencreator-missing-font-runtime-'));
  roots.push(root);
  if (process.platform === 'win32') {
    cpSync(join(runtimeRoot, 'bin'), join(root, 'bin'), { recursive: true });
  } else {
    symlinkSync(join(runtimeRoot, 'bin'), join(root, 'bin'), 'dir');
  }
  cpSync(join(runtimeRoot, 'fonts'), join(root, 'fonts'), { recursive: true });
  rmSync(join(root, 'fonts', fileName));
  return root;
}

function run(executable: string, args: string[], encoding: null): Buffer;
function run(executable: string, args: string[], encoding?: BufferEncoding): string;
function run(
  executable: string,
  args: string[],
  encoding: BufferEncoding | null = 'utf8'
): string | Buffer {
  const result = spawnSync(executable, args, {
    encoding,
    timeout: 60_000,
    maxBuffer: 8 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error(
      `${executable} failed (${result.status ?? result.signal}): ${String(result.stderr)}`
    );
  }
  return result.stdout;
}
