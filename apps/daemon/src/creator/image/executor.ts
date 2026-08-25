import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorExecutor } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import { validateImageFile } from '../validators/image.js';
import { createOpenAiCompatibleImageProvider } from './openai-compatible-provider.js';

export function createImageExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  providerFactory?: typeof createOpenAiCompatibleImageProvider;
}): CreatorExecutor {
  return {
    id: 'image',
    async run(stage) {
      const config = await input.configStore.read();
      if (!config.image.openai.apiKey) throw new CreatorExecutorError('creator_image_config_missing', 'Image provider API key is missing');
      const provider = (input.providerFactory ?? createOpenAiCompatibleImageProvider)(config.image.openai);
      const reference = stage.inputArtifacts.find(artifact => artifact.kind === 'reference_image');
      if (reference !== undefined && !provider.capabilities.edit) {
        throw new CreatorExecutorError('unsupported_capability', 'Selected image provider cannot edit a reference image');
      }
      const prompt = typeof stage.job.state.prompt === 'string' ? stage.job.state.prompt : '';
      const ratio = stage.job.state.ratio === '1:1' || stage.job.state.ratio === '9:16' ? stage.job.state.ratio : '16:9';
      const count = typeof stage.job.state.candidateCount === 'number'
        ? Math.min(8, Math.max(1, Math.floor(stage.job.state.candidateCount)))
        : 3;
      const referenceImage = reference?.path
        ? { bytes: await readFile(reference.path), mimeType: reference.metadata.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png' }
        : undefined;
      const settled = await Promise.allSettled(Array.from({ length: count }, (_, index) => (
        provider.generate({ prompt, ratio, referenceImage }, stage.signal).then(async result => {
          const path = join(stage.workdir, `cover-${index + 1}.${result.mimeType === 'image/jpeg' ? 'jpg' : 'png'}`);
          await writeFile(path, result.bytes);
          const metadata = await validateImageFile(path);
          return { kind: 'cover_image', status: 'completed' as const, path, metadata: { ...metadata, candidate: index + 1, ratio } };
        })
      )));
      const outputs = settled.flatMap(item => item.status === 'fulfilled' ? [item.value] : []);
      const failures = settled.flatMap((item, index) => item.status === 'rejected'
        ? [{ candidate: index + 1, message: item.reason instanceof Error ? item.reason.message : 'Image generation failed' }]
        : []);
      if (outputs.length === 0) throw new CreatorExecutorError('image_generation_failed', failures[0]?.message ?? 'Image generation failed');
      return {
        outputs,
        progress: {
          status: failures.length > 0 ? 'partial_success' : 'succeeded',
          failures
        }
      };
    }
  };
}
