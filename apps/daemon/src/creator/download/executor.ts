import { readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { CreatorExecutor, CreatorExecutorInput, CreatorExecutorResult } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { validateMediaFile } from '../validators/media.js';
import { parseDownloadProbe } from './probe-parser.js';

export function createDownloadExecutor(input: {
  ytDlpPath: string;
  ffprobePath: string;
}): CreatorExecutor {
  return {
    id: 'download',
    async run(stage) {
      const url = typeof stage.job.state.sourceUrl === 'string' ? stage.job.state.sourceUrl : '';
      if (!isSupported(url)) throw new CreatorExecutorError('unsupported_source', 'Only YouTube and Bilibili URLs are supported');
      if (stage.stageRun.stageId === 'probe') return probe(input.ytDlpPath, url, stage);
      if (stage.stageRun.stageId === 'download') return download(input, url, stage);
      throw new CreatorExecutorError('creator_stage_not_supported', 'Unsupported download stage');
    }
  };
}

async function probe(binary: string, url: string, stage: CreatorExecutorInput): Promise<CreatorExecutorResult> {
  const stdout = await run(binary, ['--dump-single-json', '--no-playlist', url], stage);
  const parsed = parseDownloadProbe(JSON.parse(stdout));
  const path = join(stage.workdir, 'probe.json');
  await writeFile(path, `${JSON.stringify(parsed, null, 2)}\n`);
  return {
    outputs: [{ kind: 'download_probe', status: 'completed', path, metadata: parsed as never }],
    progress: { formatCount: parsed.formats.length }
  };
}

async function download(
  input: { ytDlpPath: string; ffprobePath: string },
  url: string,
  stage: CreatorExecutorInput
): Promise<CreatorExecutorResult> {
  const probeArtifact = stage.inputArtifacts.find(artifact => artifact.kind === 'download_probe');
  if (probeArtifact?.path === null || probeArtifact?.path === undefined) throw new CreatorExecutorError('creator_stage_input_missing', 'Download probe is required');
  const probe = JSON.parse(await readFile(probeArtifact.path, 'utf8')) as ReturnType<typeof parseDownloadProbe>;
  const formatId = typeof stage.job.state.formatId === 'string' ? stage.job.state.formatId : 'bestvideo+bestaudio/best';
  if (formatId !== 'bestvideo+bestaudio/best' && !probe.formats.some(format => format.id === formatId)) {
    throw new CreatorExecutorError('format_unavailable', 'Selected format is no longer available');
  }
  const template = join(stage.workdir, 'source.%(ext)s');
  const stdout = await run(input.ytDlpPath, [
    '--no-playlist', '--newline', '--print', 'after_move:filepath',
    '-f', formatId, '-o', template, url
  ], stage, line => {
    const match = line.match(/\[download\]\s+([\d.]+)%/);
    if (match) stage.reportProgress({ percent: Number(match[1]) });
  });
  const reportedPath = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!reportedPath) throw new CreatorExecutorError('download_output_missing', 'yt-dlp did not report an output path');
  const path = await safeOutputPath(stage.workdir, reportedPath);
  const metadata = await validateMediaFile(path, input.ffprobePath);
  return { outputs: [{ kind: 'source_video', status: 'completed', path, metadata }] };
}

async function safeOutputPath(workdir: string, path: string): Promise<string> {
  const root = await realpath(workdir);
  const actual = await realpath(resolve(stagePath(workdir, path)));
  if (actual !== root && !actual.startsWith(`${root}\\`) && !actual.startsWith(`${root}/`)) {
    throw new CreatorExecutorError('download_output_escape', 'Downloaded output escapes the stage workdir');
  }
  return actual;
}

function stagePath(workdir: string, path: string): string {
  return resolve(path) === path ? path : join(workdir, path);
}

function run(
  binary: string,
  args: string[],
  stage: CreatorExecutorInput,
  onLine?: (line: string) => void
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnCreatorProcess(binary, args, { cwd: stage.workdir, stdio: ['ignore', 'pipe', 'pipe'] }, stage.signal);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
      String(chunk).split(/\r?\n/).forEach(line => onLine?.(line));
    });
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve(stdout);
      else reject(classifyDownloadError(stderr));
    });
  });
}

function classifyDownloadError(stderr: string): CreatorExecutorError {
  const text = stderr.toLowerCase();
  if (text.includes('requested format is not available')) return new CreatorExecutorError('format_unavailable', 'Requested format is unavailable');
  if (text.includes('sign in') || text.includes('login')) return new CreatorExecutorError('login_required', 'Platform login is required');
  if (text.includes('copyright') || text.includes('not available in your country')) return new CreatorExecutorError('region_or_copyright_restricted', 'Video is region or copyright restricted');
  if (text.includes('no space left')) return new CreatorExecutorError('disk_full', 'Insufficient disk space');
  return new CreatorExecutorError('download_failed', stderr.slice(-2000));
}

function isSupported(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === 'youtu.be' || host.endsWith('youtube.com') || host === 'b23.tv' || host.endsWith('bilibili.com');
  } catch { return false; }
}
