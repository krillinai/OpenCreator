import { createVideoTranslationTemplate } from './video-translation.js';
import {
  createLegacyVideoDownloadTemplate,
  createVideoDownloadTemplate
} from './video-download.js';
import { createCoverTemplate, createLegacyCoverTemplate } from './cover.js';
import {
  createImageGenerationTemplate,
  createLegacyImageGenerationTemplate
} from './image-generation.js';
import { createAutoClipTemplate } from './auto-clip.js';
import { createStickmanVideoTemplate } from './stickman-video.js';
import { createSmartDubbingTemplate } from './smart-dubbing.js';
import type {
  CreatorTemplateDefinition,
  CreatorTemplateRegistry
} from './types.js';

export {
  createAutoClipTemplate,
  createCoverTemplate,
  createLegacyCoverTemplate,
  createImageGenerationTemplate,
  createLegacyImageGenerationTemplate,
  createStickmanVideoTemplate,
  createSmartDubbingTemplate,
  createLegacyVideoDownloadTemplate,
  createVideoDownloadTemplate,
  createVideoTranslationTemplate
};

export function createDefaultCreatorTemplateRegistry(): CreatorTemplateRegistry {
  return createCreatorTemplateRegistry([
    createVideoTranslationTemplate(),
    createLegacyVideoDownloadTemplate(),
    createVideoDownloadTemplate(),
    createLegacyCoverTemplate(),
    createCoverTemplate(),
    createLegacyImageGenerationTemplate(),
    createImageGenerationTemplate(),
    createSmartDubbingTemplate(),
    createAutoClipTemplate(),
    createStickmanVideoTemplate()
  ]);
}

export function createCreatorTemplateRegistry(
  templates: CreatorTemplateDefinition[]
): CreatorTemplateRegistry {
  const byKey = new Map<string, CreatorTemplateDefinition>();
  for (const template of templates) {
    validateTemplate(template);
    const key = templateKey(template.id, template.version);
    if (byKey.has(key)) throw new Error(`Duplicate template: ${key}`);
    byKey.set(key, template);
  }

  return {
    list: () => [...byKey.values()].sort((left, right) => (
      left.id.localeCompare(right.id) || left.version - right.version
    )),
    get(id, version) {
      const matches = [...byKey.values()].filter(template => template.id === id);
      const template = version === undefined
        ? matches.sort((left, right) => right.version - left.version)[0]
        : byKey.get(templateKey(id, version));
      if (template === undefined) throw new Error(`Unknown creator template: ${id}@${version ?? 'latest'}`);
      return template;
    },
    resolveInvalidatedArtifactKinds(id, version, actionId) {
      const template = this.get(id, version);
      const action = template.actions.find(candidate => candidate.id === actionId);
      if (action === undefined) throw new Error(`Unknown creator action: ${actionId}`);
      const invalidated = new Set<string>();
      for (const rule of action.invalidates ?? []) {
        if (!rule.propagateThroughStageGraph) continue;
        propagateArtifacts(template, rule.sourceArtifactKind, invalidated);
      }
      return [...invalidated].sort();
    }
  };
}

function propagateArtifacts(
  template: CreatorTemplateDefinition,
  sourceKind: string,
  result: Set<string>
): void {
  const queue = [sourceKind];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const stage of template.stages) {
      if (!stage.inputArtifacts.some(input => input.kind === current)) continue;
      for (const output of stage.outputArtifacts) {
        if (!result.has(output.kind)) {
          result.add(output.kind);
          queue.push(output.kind);
        }
      }
    }
  }
}

function validateTemplate(template: CreatorTemplateDefinition): void {
  if (!Number.isInteger(template.version) || template.version < 1) {
    throw new Error(`Invalid template version: ${template.id}`);
  }
  const stageIds = new Set(template.stages.map(stage => stage.id));
  if (stageIds.size !== template.stages.length) throw new Error(`Duplicate stage: ${template.id}`);
  for (const stage of template.stages) {
    for (const artifact of stage.inputArtifacts) {
      if (artifact.selector === 'state-artifact-id' && !artifact.stateKey?.trim()) {
        throw new Error(`State artifact selector requires stateKey: ${template.id}/${stage.id}`);
      }
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`Stage graph cycle: ${template.id}`);
    if (visited.has(id)) return;
    const stage = template.stages.find(candidate => candidate.id === id);
    if (stage === undefined) throw new Error(`Unknown stage dependency: ${id}`);
    visiting.add(id);
    for (const dependency of stage.dependsOn ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of stageIds) visit(id);
}

function templateKey(id: string, version: number): string {
  return `${id}@${version}`;
}
