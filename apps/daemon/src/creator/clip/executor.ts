import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { spawnCreatorProcess } from '../process-tree.js';
import { validateMediaFile } from '../validators/media.js';
import { analyzeClips, parseClipCandidates } from './analyzer.js';

export function createClipExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  ffmpegPath: string;
  ffprobePath: string;
}): CreatorExecutor {
  return {
    id: 'clip',
    async run(stage) {
      if (stage.stageRun.stageId === 'analyze') {
        const config = await input.configStore.read();
        if (!config.llm.apiKey) throw new CreatorExecutorError('creator_llm_config_missing', 'LLM configuration is incomplete');
        const subtitle = stage.inputArtifacts.find(artifact => artifact.kind.includes('subtitle'))?.path;
        const source = stage.inputArtifacts.find(artifact => artifact.kind === 'source_video')?.path;
        if (!subtitle || !source) throw new CreatorExecutorError('creator_stage_input_missing', 'Video and subtitle are required');
        const media = await validateMediaFile(source, input.ffprobePath);
        const candidates = await analyzeClips({
          ...config.llm,
          transcript: await readFile(subtitle, 'utf8'),
          duration: media.duration
        });
        const path = join(stage.workdir, 'clip-candidates.json');
        await writeFile(path, `${JSON.stringify({ candidates }, null, 2)}\n`);
        return { outputs: [{ kind: 'clip_candidates', status: 'completed', path, metadata: { candidates } }] };
      }
      if (stage.stageRun.stageId === 'render') {
        const source = stage.inputArtifacts.find(artifact => artifact.kind === 'source_video')?.path;
        const candidateArtifact = stage.inputArtifacts.find(artifact => artifact.kind === 'clip_candidates');
        if (!source || !candidateArtifact?.path) throw new CreatorExecutorError('creator_stage_input_missing', 'Source and clip candidates are required');
        const raw = JSON.parse(await readFile(candidateArtifact.path, 'utf8')) as unknown;
        const sourceMedia = await validateMediaFile(source, input.ffprobePath);
        const duration = sourceMedia.duration;
        const candidates = parseClipCandidates(raw, duration);
        const selectedIds = Array.isArray(stage.job.state.selectedCandidateIds)
          ? new Set(stage.job.state.selectedCandidateIds.filter(value => typeof value === 'string'))
          : new Set(candidates.map(candidate => candidate.id));
        const selected = candidates.filter(candidate => selectedIds.has(candidate.id));
        if (selected.length === 0) throw new CreatorExecutorError('creator_clip_selection_missing', 'At least one clip must be selected');
        const output = join(stage.workdir, 'auto-clip.mp4');
        const videoFilters = selected.map((candidate, index) => (
          `[0:v]trim=start=${candidate.start}:end=${candidate.end},setpts=PTS-STARTPTS[v${index}]`
        ));
        const filter = sourceMedia.hasAudio
          ? videoFilters.concat(
              selected.map((candidate, index) => `[0:a]atrim=start=${candidate.start}:end=${candidate.end},asetpts=PTS-STARTPTS[a${index}]`),
              `${selected.map((_, index) => `[v${index}][a${index}]`).join('')}concat=n=${selected.length}:v=1:a=1[outv][outa]`
            ).join(';')
          : videoFilters.concat(`${selected.map((_, index) => `[v${index}]`).join('')}concat=n=${selected.length}:v=1:a=0[outv]`).join(';');
        await runProcess(input.ffmpegPath, [
          '-y', '-i', source, '-filter_complex', filter, '-map', '[outv]',
          ...(sourceMedia.hasAudio ? ['-map', '[outa]'] : ['-an']),
          output
        ], stage.signal);
        return { outputs: [{ kind: 'auto_clip_video', status: 'completed', path: output, metadata: await validateMediaFile(output, input.ffprobePath) }] };
      }
      throw new CreatorExecutorError('creator_stage_not_supported', 'Unsupported clip stage');
    }
  };
}

function runProcess(binary: string, args: string[], signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnCreatorProcess(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] }, signal);
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(stderr.slice(-2000))));
  });
}
