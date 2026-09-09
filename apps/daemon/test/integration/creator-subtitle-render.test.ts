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

    expect(first.ass).toContain('Style: Major,OpenCreator Sans Regular,12,&H00FFFFFF');
    expect(first.ass).toContain('Style: Minor,OpenCreator Sans Regular,9,&H005CD4FF');
    expect(second.ass).toContain('Style: Major,OpenCreator Serif Bold,18,&H00FFE77E');
    expect(second.ass).toContain('Style: Minor,OpenCreator Serif Bold,12,&H006B6BFF');
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

function renderStyle(style: Parameters<typeof buildKrillinSubtitleStyle>[0]) {
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
  writeFileSync(
    subtitle,
    '1\n00:00:00,200 --> 00:00:01,800\nCreator subtitle test\n创作字幕测试\n\n'
  );
  writeFileSync(stylePath, `${JSON.stringify(buildKrillinSubtitleStyle(style), null, 2)}\n`);
  run(ffmpegPath, [
    '-v', 'error',
    '-y',
    '-f', 'lavfi',
    '-i', 'color=c=#202020:s=640x360:d=2:r=25',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    inputVideo
  ]);
  const result = runCli({ launcher, workdir, inputVideo, subtitle }, stylePath, runtimeRoot);
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
  const outputVideo = join(workdir, 'horizontal_bilingual.mp4');
  const assPath = join(workdir, 'formatted_horizontal_bilingual.ass');
  expect(existsSync(outputVideo)).toBe(true);
  expect(existsSync(assPath)).toBe(true);
  return {
    ass: readFileSync(assPath, 'utf8'),
    frame: compareFramePixels(inputVideo, outputVideo),
    paths: { launcher, workdir, inputVideo, subtitle },
    stylePath
  };
}

function runCli(
  paths: { launcher: string; workdir: string; inputVideo: string; subtitle: string },
  stylePath: string,
  resourceRoot: string
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
    'render-horizontal',
    '--workdir', paths.workdir,
    '--task-id', 'subtitle-render-test',
    '--video', paths.inputVideo,
    '--subtitle', paths.subtitle,
    '--subtitle-style-file', stylePath
  ], {
    cwd: paths.launcher,
    env,
    encoding: 'utf8',
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024
  });
}

function compareFramePixels(sourceVideo: string, renderedVideo: string) {
  const source = rawFrame(sourceVideo);
  const rendered = rawFrame(renderedVideo);
  expect(rendered.length).toBe(source.length);
  let changedPixels = 0;
  for (let offset = 0; offset < rendered.length; offset += 3) {
    const distance = Math.abs(rendered[offset]! - source[offset]!)
      + Math.abs(rendered[offset + 1]! - source[offset + 1]!)
      + Math.abs(rendered[offset + 2]! - source[offset + 2]!);
    if (distance > 24) changedPixels += 1;
  }
  return {
    changedPixels,
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
