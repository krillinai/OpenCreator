import { readFile, rename, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import sharp from 'sharp';
import { z } from 'zod';
import type { CreatorServicesConfigStore } from '../../creator-services/config-store.js';
import type { CreatorArtifact, CreatorJson } from '@opencreator/protocol';
import type { CreatorExecutor, CreatorExecutorInput, CreatorExecutorOutput } from '../executor.js';
import { CreatorExecutorError } from '../executor.js';
import {
  stickmanContentPlanSchema,
  stickmanAudioTimingSchema,
  stickmanImagePromptPackSchema,
  stickmanScriptManifestSchema,
  stickmanShotSpecSchema,
  stickmanStyleContractSchema,
  stickmanSourceBriefSchema
} from './contracts.js';
import {
  buildStickmanImagePrompt,
  STICKMAN_IMAGE_PROMPT_CONTRACT,
  shouldUsePreviousShotReference
} from './image-prompt.js';
import {
  DEFAULT_STICKMAN_CHARACTER_ASSET,
  DEFAULT_STICKMAN_STYLE_ASSET,
  readVisualAssetRef,
  type ResolvedVisualAssetFile,
  type StickmanVisualAssetRegistry
} from './visual-assets.js';

type CompleteJson = (input: {
  stageId: string;
  prompt: string;
  signal: AbortSignal;
}) => Promise<unknown>;

type CodexCompleteJson = (input: {
  stageId: string;
  prompt: string;
  signal: AbortSignal;
  jobId: string;
  projectId: string;
  cwd: string;
  model: string;
}) => Promise<unknown>;

const PREFERRED_SCRIPT_SEGMENT_SECONDS = 4;
const MAX_ESTIMATED_SCRIPT_SEGMENT_SECONDS = 4.5;

const generatedSourceBriefSchema = z.object({
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  audience: z.string().trim().min(1),
  claims: z.array(z.object({
    id: z.string().regex(/^claim-\d{3}$/),
    text: z.string().trim().min(1),
    sourceSpanIds: z.array(z.string().regex(/^source-\d{3}$/)).min(1).max(200)
  }).strict()).min(1).max(200)
}).strict();

const generatedContentPlanSchema = z.object({
  title: z.string().trim().min(1),
  audience: z.string().trim().min(1),
  objective: z.string().trim().min(1),
  retainedClaimIds: z.array(z.string().regex(/^claim-\d{3}$/)).min(1).max(200),
  discardedClaimIds: z.array(z.string().regex(/^claim-\d{3}$/)).max(200),
  sections: z.array(z.object({
    id: z.string().regex(/^section-\d{2}$/),
    title: z.string().trim().min(1),
    claimIds: z.array(z.string().regex(/^claim-\d{3}$/)).min(1).max(200)
  }).strict()).min(1).max(200)
}).strict();

const generatedShotScriptSchema = z.object({
  title: z.string().trim().min(1),
  segments: z.array(z.object({
    narration: z.string().trim().min(1),
    claimIds: z.array(z.string().regex(/^claim-\d{3}$/)).min(1).max(200),
    sourceSpanIds: z.array(z.string().regex(/^source-\d{3}$/)).min(1).max(200)
  }).strict()).min(1).max(200)
}).strict();

const generatedStoryboardSchema = z.object({
  shots: z.array(z.object({
    sourceSegmentId: z.string().regex(/^segment-[a-z0-9-]+$/),
    semanticAnchor: z.string().trim().min(1),
    visualDescription: z.string().trim().min(1),
    compositionAndAction: z.string().trim().min(1),
    keyObjects: z.array(z.string().trim().min(1)).min(1).max(12),
    continuityReason: z.string().trim(),
    motion: z.enum(['static', 'push-in', 'pan-left', 'pan-right', 'zoom-out']),
    motionReason: z.string().trim().min(1)
  }).strict()).min(1).max(200)
}).strict();

export function createStickmanContentExecutor(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  completeJson?: CompleteJson;
  codexCompleteJson?: CodexCompleteJson;
  visualAssets?: StickmanVisualAssetRegistry;
}): CreatorExecutor {
  return {
    id: 'stickman-content',
    async run(stage) {
      const completeJson = input.completeJson ?? createStickmanConfiguredCompletion({
        configStore: input.configStore,
        codexCompleteJson: input.codexCompleteJson,
        context: {
          jobId: stage.job.id,
          projectId: stage.job.projectId,
          cwd: stage.workdir
        }
      });
      switch (stage.stageRun.stageId) {
        case 'ingest-text': return ingestText(stage);
        case 'source-brief': return sourceBrief(stage, completeJson);
        case 'content-plan': return contentPlan(stage, completeJson);
        case 'script': return script(stage, completeJson);
        case 'storyboard': return storyboard(stage, completeJson);
        case 'style-assets': return styleAssets(stage, input.visualAssets);
        case 'prompt-pack': return promptPack(stage);
        default: throw new CreatorExecutorError(
          'creator_stage_not_supported',
          `Unsupported stickman content stage: ${stage.stageRun.stageId}`
        );
      }
    }
  };
}

async function ingestText(stage: CreatorExecutorInput) {
  stage.reportProgress({
    phase: 'preparing_source',
    percent: 25,
    completed: 0,
    failed: 0,
    total: 1
  });
  const sourceText = readStateString(stage, 'sourceText', '');
  if (sourceText.length === 0) {
    throw new CreatorExecutorError('creator_stage_input_missing', 'Source text is required');
  }
  const path = join(stage.workdir, 'source-text.txt');
  await writeAtomic(path, `${sourceText}\n`);
  return {
    outputs: [{
      kind: 'source_text',
      status: 'completed' as const,
      path,
      sourceArtifactIds: [],
      metadata: { fileName: 'source-text.txt', characterCount: sourceText.length }
    }],
    progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
  };
}

async function sourceBrief(stage: CreatorExecutorInput, complete: CompleteJson) {
  stage.reportProgress({ phase: 'analyzing', percent: 15, completed: 0, failed: 0, total: 1 });
  const sourceKind = stage.job.state.sourceType === 'text' ? 'source_text' : 'source_subtitle';
  const source = requireArtifact(stage, sourceKind);
  const transcript = source.path === null ? '' : await readFile(source.path, 'utf8');
  const sourceSpans = buildSourceSpans(transcript, sourceKind);
  const generated = await complete({
    stageId: 'source-brief',
    prompt: `你是来源证据分析员。请把以下带稳定编号的来源片段拆成可独立保留或舍弃的内容 Claim，只返回严格 JSON，不要 Markdown。
每个 Claim 必须是来源直接支持的完整含义，字段固定为 id、text、sourceSpanIds；id 从 claim-001 连续编号；sourceSpanIds 必须引用实际支持它的来源片段。
必须覆盖每个来源片段，不能只摘录重点，也不能新增来源中没有的事实、人物属性、因果、结论或常识。重复信息可以合并为一个 Claim，但合并后必须列出全部来源片段。
输出结构：{"title":"标题","summary":"摘要","audience":"受众","claims":[{"id":"claim-001","text":"来源事实","sourceSpanIds":["source-001"]}]}。
来源片段：${JSON.stringify(sourceSpans)}`,
    signal: stage.signal
  });
  stage.reportProgress({ phase: 'analyzing', percent: 85, completed: 0, failed: 0, total: 1 });
  const generatedBrief = generatedSourceBriefSchema.parse(
    normalizeGeneratedJson('source-brief', generated)
  );
  const value = stickmanSourceBriefSchema.parse({ ...generatedBrief, sourceSpans });
  return {
    ...await jsonOutput(stage, 'source_brief', 'source-brief.json', value, [source.id]),
    progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
  };
}

async function contentPlan(stage: CreatorExecutorInput, complete: CompleteJson) {
  stage.reportProgress({ phase: 'planning', percent: 15, completed: 0, failed: 0, total: 1 });
  const source = requireArtifact(stage, 'source_brief');
  const brief = stickmanSourceBriefSchema.parse(await readJson(source));
  const targetDurationSeconds = readStateNumber(stage, 'targetDurationSeconds', 30);
  const targetLanguage = readStateString(stage, 'targetLanguage', 'zh-CN');
  const narrationBudget = narrationBudgetFor(targetDurationSeconds, targetLanguage);
  const generated = await complete({
    stageId: 'content-plan',
    prompt: `你是短视频内容策划。请在目标时长内对来源 Claim 做明确取舍，只返回严格 JSON，不要 Markdown。
所有 Claim 必须且只能进入 retainedClaimIds 或 discardedClaimIds 之一，不能静默遗漏。sections 只能引用 retainedClaimIds，并且必须覆盖每个保留 Claim。
保留最能构成完整叙事的内容；当预算不足时，明确舍弃次要 Claim，不要把一个 Claim 截成残缺语义，不要补充来源之外的知识。
这里只规划内容，不讨论角色、火柴人、镜头、画面、动画、字幕、配音或生图方式。
目标时长：${targetDurationSeconds} 秒。
旁白预算：${JSON.stringify(narrationBudget)}。
输出结构：{"title":"标题","audience":"受众","objective":"目标","retainedClaimIds":["claim-001"],"discardedClaimIds":[],"sections":[{"id":"section-01","title":"章节","claimIds":["claim-001"]}]}。
来源 Claim：${JSON.stringify(brief)}`,
    signal: stage.signal
  });
  stage.reportProgress({ phase: 'planning', percent: 85, completed: 0, failed: 0, total: 1 });
  const generatedPlan = generatedContentPlanSchema.parse(
    normalizeGeneratedJson('content-plan', generated)
  );
  const value = stickmanContentPlanSchema.parse({
    ...generatedPlan,
    targetDurationSeconds,
    narrationBudget
  });
  assertContentPlanClaims(value, brief);
  return {
    ...await jsonOutput(stage, 'content_plan', 'content-plan.json', value, [source.id]),
    progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
  };
}

async function script(stage: CreatorExecutorInput, complete: CompleteJson) {
  stage.reportProgress({ phase: 'writing', percent: 15, completed: 0, failed: 0, total: 1 });
  const planArtifact = requireArtifact(stage, 'content_plan');
  const sourceBriefArtifact = requireArtifact(stage, 'source_brief');
  const plan = stickmanContentPlanSchema.parse(await readJson(planArtifact));
  const sourceBrief = stickmanSourceBriefSchema.parse(await readJson(sourceBriefArtifact));
  const targetLanguage = readStateString(stage, 'targetLanguage', 'zh-CN');
  let draft: unknown;
  let failures: string[] = [];

  for (let attempt = 0; attempt < 3; attempt += 1) {
    draft = await complete({
      stageId: 'script',
      prompt: shotScriptPrompt({
        sourceBrief,
        plan,
        targetLanguage,
        draftToRepair: attempt === 0 ? undefined : draft,
        validationFailures: failures
      }),
      signal: stage.signal
    });
    const finalized = finalizeShotScript(draft, sourceBrief, plan, targetLanguage);
    if (finalized.script !== undefined) {
      const manifestPath = await writeJsonArtifact(stage, 'script-manifest.json', finalized.script);
      const outputs: CreatorExecutorOutput[] = [{
        kind: 'script_manifest',
        status: 'completed',
        path: manifestPath,
        sourceArtifactIds: [planArtifact.id, sourceBriefArtifact.id],
        metadata: {
          contract: finalized.script.contract,
          segmentCount: finalized.script.segmentCount,
          retainedClaimCount: plan.retainedClaimIds.length,
          discardedClaimCount: plan.discardedClaimIds.length,
          generationAttempts: attempt + 1
        }
      }];
      return {
        outputs,
        progress: {
          phase: 'completed',
          percent: 100,
          message: '脚本已生成，等待审核',
          completed: 1,
          failed: 0,
          total: 1
        }
      };
    }
    failures = finalized.failures;
    stage.reportProgress({
      phase: 'writing',
      percent: 40 + attempt * 25,
      message: `脚本第 ${attempt + 1} 次生成未通过完整性校验，正在整稿重生成`,
      completed: 0,
      failed: 1,
      total: 1
    });
  }

  throw new CreatorExecutorError(
    'creator_script_validation_failed',
    `脚本在 3 次整稿生成后仍未通过校验：${formatScriptFailures(failures)}`
  );
}

function narrationBudgetFor(
  targetDurationSeconds: number,
  targetLanguage: string
): z.infer<typeof stickmanContentPlanSchema>['narrationBudget'] {
  const usesCharacters = /^(?:zh|ja|ko)(?:-|$)/iu.test(targetLanguage);
  const unitsPerMinute = usesCharacters ? 240 : 179;
  const expectedUnits = targetDurationSeconds / 60 * unitsPerMinute;
  return {
    unit: usesCharacters ? 'characters' : 'words',
    unitsPerMinute,
    minUnits: Math.max(1, Math.ceil(expectedUnits * 0.9)),
    maxUnits: Math.max(1, Math.floor(expectedUnits * 1.1))
  };
}

function countNarrationUnits(
  narration: string,
  unit: 'characters' | 'words'
): number {
  if (unit === 'words') {
    return narration.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
  }
  return narration.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
}

function shotScriptPrompt(input: {
  sourceBrief: z.infer<typeof stickmanSourceBriefSchema>;
  plan: z.infer<typeof stickmanContentPlanSchema>;
  targetLanguage: string;
  draftToRepair?: unknown;
  validationFailures: string[];
}): string {
  const claims = input.sourceBrief.claims.filter(claim => (
    input.plan.retainedClaimIds.includes(claim.id)
  ));
  const sourceSpanIds = new Set(claims.flatMap(claim => claim.sourceSpanIds));
  const sourceSpans = input.sourceBrief.sourceSpans.filter(span => sourceSpanIds.has(span.id));
  const repair = input.draftToRepair === undefined
    ? ''
    : `
上一份完整草稿：${JSON.stringify(input.draftToRepair)}`
      + `
校验失败原因：${JSON.stringify(input.validationFailures)}`
      + '\n请根据失败原因重新生成整份脚本，不要只返回局部修改。';
  const preferredUnits = Math.max(1, Math.floor(
    input.plan.narrationBudget.unitsPerMinute / 60 * PREFERRED_SCRIPT_SEGMENT_SECONDS
  ));
  const maximumUnits = Math.max(1, Math.floor(
    input.plan.narrationBudget.unitsPerMinute / 60 * MAX_ESTIMATED_SCRIPT_SEGMENT_SECONDS
  ));
  return `你负责生成知识视频旁白。来源 Claim 和来源片段是唯一事实来源。只生成可直接用于配音的旁白单元，不要生成画面、镜头、生图或制作说明；只返回严格 JSON，不要 Markdown。
旁白使用 ${input.targetLanguage}，只能对保留 Claim 做忠实、自然、连贯的改写，不得新增事实。每段只表达一个完整语义节拍，必须可以独立朗读并自然停顿；长内容要改写成多个完整句意，不得按字数截断句子；无独立意义的过渡语要合并到相邻段落。
每段按正常语速设计为约 3-${PREFERRED_SCRIPT_SEGMENT_SECONDS} 秒，估算最多不超过 ${MAX_ESTIMATED_SCRIPT_SEGMENT_SECONDS} 秒，为真实配音的停顿和韵律留出余量。当前语速预算下，每段建议不超过 ${preferredUnits} ${input.plan.narrationBudget.unit === 'characters' ? '个有效字符' : '个单词'}，绝对不超过 ${maximumUnits}；这是生成目标，不能通过截断语义满足。
每段必须填写 claimIds 和 sourceSpanIds。所有 retainedClaimIds 必须至少被一段覆盖；不得引用 discardedClaimIds；引用的来源片段必须确实属于该 Claim。
旁白只能讲来源内容，不得出现角色设定、火柴人、镜头、画面、动画、字幕、配音、生图等制作过程。不要为了凑时长重复同一含义。
整份旁白的${input.plan.narrationBudget.unit === 'characters' ? '有效字符数' : '单词数'}必须在 ${input.plan.narrationBudget.minUnits}-${input.plan.narrationBudget.maxUnits} 之间，对应 ${input.plan.targetDurationSeconds} 秒目标；优先保持语义完整，不要重复同一含义凑时长。
输出结构：{"title":"标题","segments":[{"narration":"完整旁白","claimIds":["claim-001"],"sourceSpanIds":["source-001"]}]}。
内容计划：${JSON.stringify(input.plan)}
保留 Claim：${JSON.stringify(claims)}
对应来源片段：${JSON.stringify(sourceSpans)}${repair}`;
}

function finalizeShotScript(
  payload: unknown,
  sourceBrief: z.infer<typeof stickmanSourceBriefSchema>,
  plan: z.infer<typeof stickmanContentPlanSchema>,
  targetLanguage: string
): { script?: z.infer<typeof stickmanScriptManifestSchema>; failures: string[] } {
  const parsed = generatedShotScriptSchema.safeParse(normalizeGeneratedJson('script', payload));
  if (!parsed.success) {
    return {
      failures: parsed.error.issues.map(issue => (
        `invalid script response at ${issue.path.join('.') || 'root'}: ${issue.message}`
      ))
    };
  }

  const retained = new Set(plan.retainedClaimIds);
  const claimSpans = new Map(sourceBrief.claims.map(claim => [
    claim.id,
    new Set(claim.sourceSpanIds)
  ]));
  const coveredClaims = new Set<string>();
  const failures: string[] = [];
  const normalizedNarrations = new Map<string, string>();
  const segments = parsed.data.segments.map((raw, index) => {
    const id = `segment-${String(index + 1).padStart(2, '0')}`;
    const claimIds = [...new Set(raw.claimIds)];
    const sourceSpanIds = [...new Set(raw.sourceSpanIds)];
    const narration = raw.narration.trim();

    if (!/[。！？!?；;.]\s*["'”’）)\]]?$/u.test(narration)) {
      failures.push(`${id} 的旁白不是完整句子`);
    }
    if (claimIds.some(claimId => !retained.has(claimId))) {
      failures.push(`${id} 引用了未保留或不存在的 Claim`);
    }
    const supportedSpans = new Set(
      claimIds.flatMap(claimId => [...(claimSpans.get(claimId) ?? [])])
    );
    if (sourceSpanIds.some(sourceSpanId => !supportedSpans.has(sourceSpanId))) {
      failures.push(`${id} 的来源片段不受其 Claim 支持`);
    }
    claimIds.forEach(claimId => coveredClaims.add(claimId));

    const normalized = normalizeScriptText(narration);
    if (normalizedNarrations.has(normalized)) {
      failures.push(`${id} 与 ${normalizedNarrations.get(normalized)} 的旁白重复`);
    } else {
      normalizedNarrations.set(normalized, id);
    }
    const narrationUnits = countNarrationUnits(narration, plan.narrationBudget.unit);
    const estimatedDurationSeconds = roundSeconds(
      narrationUnits / plan.narrationBudget.unitsPerMinute * 60
    );
    if (estimatedDurationSeconds > MAX_ESTIMATED_SCRIPT_SEGMENT_SECONDS) {
      failures.push(`${id} 的预计配音时长 ${estimatedDurationSeconds} 秒超过 ${MAX_ESTIMATED_SCRIPT_SEGMENT_SECONDS} 秒，请按完整语义重新拆成多个旁白单元`);
    }
    return {
      id,
      order: index + 1,
      narration,
      claimIds,
      sourceSpanIds,
      narrationUnits,
      estimatedDurationSeconds
    };
  });

  const missingClaims = plan.retainedClaimIds.filter(claimId => !coveredClaims.has(claimId));
  if (missingClaims.length > 0) {
    failures.push(`保留 Claim 未被脚本覆盖：${missingClaims.join('、')}`);
  }
  const totalNarrationUnits = segments.reduce((total, segment) => (
    total + segment.narrationUnits
  ), 0);
  if (
    totalNarrationUnits < plan.narrationBudget.minUnits
    || totalNarrationUnits > plan.narrationBudget.maxUnits
  ) {
    failures.push(
      `旁白总${plan.narrationBudget.unit === 'characters' ? '字符' : '词'}数 ${totalNarrationUnits} `
      + `不在预算 ${plan.narrationBudget.minUnits}-${plan.narrationBudget.maxUnits} 内`
    );
  }
  if (failures.length > 0) return { failures: [...new Set(failures)] };

  const estimatedTotalDurationSeconds = roundSeconds(
    totalNarrationUnits / plan.narrationBudget.unitsPerMinute * 60
  );
  const script = stickmanScriptManifestSchema.parse({
    contract: 'stickman-narration-script-v2',
    reviewStatus: 'needs_review',
    contentLocked: false,
    title: parsed.data.title,
    language: targetLanguage,
    targetDurationSeconds: plan.targetDurationSeconds,
    narrationBudget: plan.narrationBudget,
    segmentCount: segments.length,
    totalNarrationUnits,
    estimatedTotalDurationSeconds,
    segments
  });
  return { script, failures: [] };
}

function assertContentPlanClaims(
  plan: z.infer<typeof stickmanContentPlanSchema>,
  brief: z.infer<typeof stickmanSourceBriefSchema>
): void {
  const expected = new Set(brief.claims.map(claim => claim.id));
  const planned = new Set([...plan.retainedClaimIds, ...plan.discardedClaimIds]);
  const missing = [...expected].filter(claimId => !planned.has(claimId));
  const unknown = [...planned].filter(claimId => !expected.has(claimId));
  if (missing.length > 0 || unknown.length > 0 || planned.size !== expected.size) {
    throw new CreatorExecutorError(
      'creator_content_plan_claim_partition_invalid',
      [
        missing.length > 0 ? `未处理 Claim：${missing.join('、')}` : '',
        unknown.length > 0 ? `未知 Claim：${unknown.join('、')}` : ''
      ].filter(Boolean).join('；') || '内容计划的 Claim 取舍无效'
    );
  }
}

function requestsVisibleText(value: string): boolean {
  return /字幕|标题|标签|文字|水印|写着|标注|caption|headline|label|lettering|subtitle|watermark|\btext\b|written|labeled/iu.test(value);
}

function formatScriptFailures(failures: string[]): string {
  return [...new Set(failures)].join('；');
}

function roundSeconds(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

async function storyboard(stage: CreatorExecutorInput, complete: CompleteJson) {
  stage.reportProgress({ phase: 'planning', percent: 15, completed: 0, failed: 0, total: 1 });
  const scriptArtifact = requireArtifact(stage, 'script_manifest');
  const timingArtifact = requireArtifact(stage, 'audio_timing');
  const scriptValue = stickmanScriptManifestSchema.parse(await readJson(scriptArtifact));
  const timing = stickmanAudioTimingSchema.parse(await readJson(timingArtifact));
  const timingBySegment = new Map(timing.segments.map(segment => [segment.segmentId, segment]));
  let draft: unknown;
  let failures: string[] = [];
  let value: z.infer<typeof stickmanShotSpecSchema> | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    draft = await complete({
      stageId: 'storyboard',
      prompt: storyboardPrompt({
        script: scriptValue,
        timing,
        draftToRepair: attempt === 0 ? undefined : draft,
        validationFailures: failures
      }),
      signal: stage.signal
    });
    const finalized = finalizeStoryboard({
      payload: draft,
      scriptArtifactId: scriptArtifact.id,
      audioTimingArtifactId: timingArtifact.id,
      script: scriptValue,
      timingBySegment
    });
    if (finalized.storyboard !== undefined) {
      value = finalized.storyboard;
      break;
    }
    failures = finalized.failures;
    stage.reportProgress({
      phase: 'planning',
      percent: 40 + attempt * 25,
      message: `分镜第 ${attempt + 1} 次生成未通过语义契约，正在整稿重生成`,
      completed: 0,
      failed: 1,
      total: 1
    });
  }
  if (value === undefined) {
    throw new CreatorExecutorError(
      'creator_storyboard_validation_failed',
      `分镜在 3 次整稿生成后仍未通过校验：${formatScriptFailures(failures)}`
    );
  }
  const shotSpec = await writeJsonArtifact(stage, 'shot-spec.json', value);
  const outputs: CreatorExecutorOutput[] = [
    {
      kind: 'shot_spec',
      status: 'completed',
      path: shotSpec,
      sourceArtifactIds: [scriptArtifact.id, timingArtifact.id],
      metadata: {
        shotCount: value.shots.length,
        contract: 'stickman-semantic-storyboard-v3',
        timingSource: timing.timingSource
      }
    }
  ];
  return {
    outputs,
    progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
  };
}

function storyboardPrompt(input: {
  script: z.infer<typeof stickmanScriptManifestSchema>;
  timing: z.infer<typeof stickmanAudioTimingSchema>;
  draftToRepair?: unknown;
  validationFailures: string[];
}): string {
  const rows = input.script.segments.map(segment => ({
    segmentId: segment.id,
    narration: segment.narration,
    startSeconds: input.timing.segments.find(item => item.segmentId === segment.id)?.startSeconds,
    endSeconds: input.timing.segments.find(item => item.segmentId === segment.id)?.endSeconds,
    durationSeconds: input.timing.segments.find(item => item.segmentId === segment.id)?.durationSeconds
  }));
  const repair = input.draftToRepair === undefined
    ? ''
    : `\n上一份完整分镜：${JSON.stringify(input.draftToRepair)}\n校验失败原因：${JSON.stringify(input.validationFailures)}\n请重新生成整份分镜。`;
  return `你负责把已经审核并完成真实配音的旁白转换成语义分镜，只返回严格 JSON，不要 Markdown。
每个 sourceSegmentId 必须且只能出现一次，并保持输入顺序。每个旁白单元生成一张图，严格采用提供的真实起止时间，不得合并或拆分时间。
visualDescription 是真正用于生图的画面描述：只写当前画面中的主体关系、动作、环境和可见物，不写旁白原文，不写角色长相，不写绘画风格，不要求任何文字、数字、字幕、标题、标签、Logo、界面或分屏。
semanticAnchor 概括画面必须传达的唯一含义；compositionAndAction 描述主体位置、视线、动作方向和空间关系；keyObjects 只列支撑含义的必要物体；continuityReason 说明与前后镜头如何连续，没有要求时返回空字符串。
motion 必须由构图和叙事意图选择：静态说明用 static，聚焦主体用 push-in，揭示全局用 zoom-out，只有存在明确横向关注移动时才使用 pan-left 或 pan-right。motionReason 必须说明选择原因，不能按序号轮换。
角色身份和视觉风格由后续统一契约与真实参考图负责，本阶段不得重新设计人物。
输出结构：{"shots":[{"sourceSegmentId":"segment-01","semanticAnchor":"唯一画面含义","visualDescription":"可直接生图的具体场景","compositionAndAction":"主体位置与动作","keyObjects":["必要道具"],"continuityReason":"连续性说明或空字符串","motion":"push-in","motionReason":"聚焦主体动作"}]}。
旁白与真实时长：${JSON.stringify(rows)}${repair}`;
}

function finalizeStoryboard(input: {
  payload: unknown;
  scriptArtifactId: string;
  audioTimingArtifactId: string;
  script: z.infer<typeof stickmanScriptManifestSchema>;
  timingBySegment: Map<string, z.infer<typeof stickmanAudioTimingSchema>['segments'][number]>;
}): { storyboard?: z.infer<typeof stickmanShotSpecSchema>; failures: string[] } {
  const parsed = generatedStoryboardSchema.safeParse(
    normalizeGeneratedJson('storyboard', input.payload)
  );
  if (!parsed.success) {
    return {
      failures: parsed.error.issues.map(issue => (
        `invalid storyboard response at ${issue.path.join('.') || 'root'}: ${issue.message}`
      ))
    };
  }
  const expectedIds = input.script.segments.map(segment => segment.id);
  const actualIds = parsed.data.shots.map(shot => shot.sourceSegmentId);
  const failures: string[] = [];
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    failures.push('分镜必须按顺序完整覆盖每个旁白单元，且每个单元只能出现一次');
  }
  for (const shot of parsed.data.shots) {
    if (requestsVisibleText(shot.visualDescription)) {
      failures.push(`${shot.sourceSegmentId} 的画面描述要求生成可见文字`);
    }
  }
  if (failures.length > 0) return { failures };
  try {
    return {
      storyboard: stickmanShotSpecSchema.parse({
        scriptArtifactId: input.scriptArtifactId,
        audioTimingArtifactId: input.audioTimingArtifactId,
        timingSource: 'ffprobe_cumulative_tts_duration',
        shots: parsed.data.shots.map((shot, index) => {
          const measured = input.timingBySegment.get(shot.sourceSegmentId);
          if (measured === undefined) {
            throw new CreatorExecutorError(
              'creator_audio_timing_incomplete',
              `Audio timing is missing script segment ${shot.sourceSegmentId}`
            );
          }
          return {
            id: `shot-${String(index + 1).padStart(2, '0')}`,
            ...shot,
            startSeconds: measured.startSeconds,
            endSeconds: measured.endSeconds,
            durationSeconds: measured.durationSeconds
          };
        })
      }),
      failures: []
    };
  } catch (error) {
    if (error instanceof CreatorExecutorError) throw error;
    return { failures: [error instanceof Error ? error.message : String(error)] };
  }
}

async function styleAssets(
  stage: CreatorExecutorInput,
  visualAssets: StickmanVisualAssetRegistry | undefined
) {
  if (visualAssets === undefined) {
    throw new CreatorExecutorError(
      'creator_stickman_runtime_unavailable',
      'Stickman visual asset catalog is unavailable'
    );
  }
  const characterRef = readVisualAssetRef(
    stage.job.state.characterAsset,
    DEFAULT_STICKMAN_CHARACTER_ASSET
  );
  const styleRef = readVisualAssetRef(
    stage.job.state.styleAsset,
    DEFAULT_STICKMAN_STYLE_ASSET
  );
  const character = visualAssets.character(characterRef);
  const style = visualAssets.style(styleRef);
  const characterReferences = visualAssets.referenceFiles(character);
  const styleReferences = visualAssets.referenceFiles(style);
  const primaryCharacter = characterReferences[0];
  if (primaryCharacter === undefined) {
    throw new CreatorExecutorError(
      'creator_character_reference_invalid',
      'Selected character has no identity reference'
    );
  }
  const content = await readFile(primaryCharacter.path);
  const dimensions = await sharp(content).metadata();
  if (!dimensions.width || !dimensions.height) {
    throw new CreatorExecutorError(
      'creator_character_reference_invalid',
      'Selected character reference is not a decodable image'
    );
  }
  const fileName = `character-reference${extname(primaryCharacter.path).toLowerCase()}`;
  const characterPath = join(stage.workdir, fileName);
  await writeFile(characterPath, content);
  const styleContract = stickmanStyleContractSchema.parse({
    contract: 'stickman-visual-profile-v2',
    ratio: '16:9',
    character: {
      assetId: character.id,
      revision: character.revision,
      identity: character.identity,
      references: characterReferences.map(referenceContract)
    },
    style: {
      assetId: style.id,
      revision: style.revision,
      rendering: style.rendering,
      semanticRenderingRules: style.semanticRenderingRules,
      forbiddenDirections: style.forbiddenDirections,
      references: styleReferences.map(referenceContract)
    }
  });
  const styleContractPath = await writeJsonArtifact(stage, 'style-contract.json', styleContract);
  const sourceArtifactIds = stage.inputArtifacts.map(artifact => artifact.id);
  const outputs: CreatorExecutorOutput[] = [
    {
      kind: 'character_reference',
      status: 'completed',
      path: characterPath,
      sourceArtifactIds,
      metadata: {
        assetId: character.id,
        revision: character.revision,
        role: primaryCharacter.role,
        mimeType: primaryCharacter.mimeType,
        width: dimensions.width,
        height: dimensions.height,
        sourceReferenceSha256: primaryCharacter.sha256
      }
    },
    {
      kind: 'style_contract',
      status: 'completed',
      path: styleContractPath,
      sourceArtifactIds,
      metadata: {
        contract: styleContract.contract,
        characterAssetId: character.id,
        characterRevision: character.revision,
        styleAssetId: style.id,
        styleRevision: style.revision,
        styleReferenceCount: styleReferences.length
      }
    }
  ];
  const primaryStyle = styleReferences[0];
  if (primaryStyle !== undefined) {
    const styleReferencePath = join(
      stage.workdir,
      `style-reference${extname(primaryStyle.path).toLowerCase()}`
    );
    await writeFile(styleReferencePath, await readFile(primaryStyle.path));
    outputs.splice(1, 0, {
      kind: 'style_reference',
      status: 'completed',
      path: styleReferencePath,
      sourceArtifactIds,
      metadata: {
        assetId: style.id,
        revision: style.revision,
        role: primaryStyle.role,
        mimeType: primaryStyle.mimeType,
        sourceReferenceSha256: primaryStyle.sha256
      }
    });
  }
  return {
    outputs,
    progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
  };
}

async function promptPack(stage: CreatorExecutorInput) {
  const shotSpecArtifact = requireArtifact(stage, 'shot_spec');
  const characterReference = requireArtifact(stage, 'character_reference');
  const styleContractArtifact = requireArtifact(stage, 'style_contract');
  const styleReference = stage.inputArtifacts.find(artifact => (
    artifact.kind === 'style_reference' && artifact.status === 'completed'
  ));
  const shotSpec = stickmanShotSpecSchema.parse(await readJson(shotSpecArtifact));
  const visualProfile = stickmanStyleContractSchema.parse(await readJson(styleContractArtifact));
  const value = stickmanImagePromptPackSchema.parse({
    shotSpecArtifactId: shotSpecArtifact.id,
    characterReferenceArtifactId: characterReference.id,
    styleContractArtifactId: styleContractArtifact.id,
    ...(styleReference === undefined ? {} : { styleReferenceArtifactId: styleReference.id }),
    prompts: shotSpec.shots.map((shot, shotIndex) => ({
      shotId: shot.id,
      visualDescription: shot.visualDescription,
      prompt: buildStickmanImagePrompt({
        visualProfile,
        shot,
        hasStyleReference: styleReference !== undefined,
        hasPreviousShotReference: shouldUsePreviousShotReference(shot, shotIndex)
      })
    }))
  });
  const sourceArtifactIds = [
    shotSpecArtifact.id,
    characterReference.id,
    styleContractArtifact.id,
    ...(styleReference === undefined ? [] : [styleReference.id])
  ];
  return {
    ...await jsonOutput(
      stage,
      'image_prompt_pack',
      'image-prompt-pack.json',
      value,
      sourceArtifactIds,
      STICKMAN_IMAGE_PROMPT_CONTRACT
    ),
    progress: { phase: 'completed', percent: 100, completed: 1, failed: 0, total: 1 }
  };
}

function referenceContract(reference: ResolvedVisualAssetFile) {
  return {
    role: reference.role,
    sha256: reference.sha256,
    bytes: reference.bytes,
    mimeType: reference.mimeType
  };
}

async function jsonOutput(
  stage: CreatorExecutorInput,
  kind: string,
  fileName: string,
  value: Record<string, unknown>,
  sourceArtifactIds: string[],
  contract = `${kind}-v1`
) {
  const path = await writeJsonArtifact(stage, fileName, value);
  return {
    outputs: [{
      kind,
      status: 'completed' as const,
      path,
      sourceArtifactIds,
      metadata: { contract }
    }]
  };
}

async function writeJsonArtifact(
  stage: CreatorExecutorInput,
  fileName: string,
  value: unknown
): Promise<string> {
  const path = join(stage.workdir, fileName);
  await writeAtomic(path, `${canonicalJson(value)}\n`);
  return path;
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, path);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)])
  );
}

function requireArtifact(stage: CreatorExecutorInput, kind: string): CreatorArtifact {
  const artifact = stage.inputArtifacts.find(item => item.kind === kind && item.status === 'completed');
  if (artifact === undefined) {
    throw new CreatorExecutorError('creator_stage_input_missing', `${kind} artifact is required`);
  }
  return artifact;
}

function requireOneArtifact(stage: CreatorExecutorInput, kinds: string[]): CreatorArtifact {
  const artifacts = stage.inputArtifacts.filter(item => (
    kinds.includes(item.kind) && item.status === 'completed'
  ));
  if (artifacts.length !== 1) {
    throw new CreatorExecutorError(
      'creator_stage_input_missing',
      `Exactly one of ${kinds.join(', ')} is required`
    );
  }
  return artifacts[0]!;
}

async function readJson(artifact: CreatorArtifact): Promise<unknown> {
  if (artifact.path === null) {
    throw new CreatorExecutorError('creator_stage_input_missing', `${artifact.kind} file is required`);
  }
  return JSON.parse(await readFile(artifact.path, 'utf8'));
}

function readStateString(stage: CreatorExecutorInput, key: string, fallback: string): string {
  const value = stage.job.state[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

function readStateNumber(stage: CreatorExecutorInput, key: string, fallback: number): number {
  const value = stage.job.state[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildSourceSpans(
  source: string,
  sourceKind: 'source_text' | 'source_subtitle'
): Array<{ id: string; text: string }> {
  const normalized = source.replace(/\r/g, '').trim();
  const content = sourceKind === 'source_subtitle'
    ? normalized
        .split('\n')
        .map(line => line.trim())
        .filter(line => (
          line.length > 0
          && !/^\d+$/.test(line)
          && !/^WEBVTT$/i.test(line)
          && !/^\d{2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+/.test(line)
        ))
        .join(' ')
    : normalized;
  if (content.length === 0) {
    throw new CreatorExecutorError(
      'creator_source_content_missing',
      '来源内容为空，无法生成来源片段'
    );
  }
  const sentences = (content.match(/[^。！？!?；;\n]+[。！？!?；;]?/gu) ?? [content])
    .map(value => value.trim())
    .filter(Boolean)
    .flatMap(splitLongSourceSpan);
  const grouped = sentences.length <= 200
    ? sentences
    : Array.from({ length: 200 }, (_, index) => {
        const start = Math.floor(index * sentences.length / 200);
        const end = Math.floor((index + 1) * sentences.length / 200);
        return sentences.slice(start, end).join('');
      });
  return grouped.map((text, index) => ({
    id: `source-${String(index + 1).padStart(3, '0')}`,
    text
  }));
}

function splitLongSourceSpan(value: string): string[] {
  const characters = Array.from(value);
  if (characters.length <= 360) return [value];
  const chunks: string[] = [];
  for (let index = 0; index < characters.length; index += 360) {
    chunks.push(characters.slice(index, index + 360).join('').trim());
  }
  return chunks.filter(Boolean);
}

function assertSourceReferences(
  ids: string[],
  spans: Array<{ id: string }>,
  errorCode: string
): void {
  const validIds = new Set(spans.map(span => span.id));
  const invalidIds = [...new Set(ids.filter(id => !validIds.has(id)))];
  if (invalidIds.length > 0) {
    throw new CreatorExecutorError(
      errorCode,
      `内容引用了不存在的来源片段：${invalidIds.join('、')}`
    );
  }
}

function normalizeScriptText(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/gu, '');
}

function normalizeGeneratedJson(stageId: string, value: unknown): unknown {
  if (stageId === 'source-brief') {
    const root = remapGeneratedKeys(value, {
      '标题': 'title',
      '摘要': 'summary',
      '受众': 'audience',
      '内容单元': 'claims',
      '主张': 'claims'
    });
    if (isJsonRecord(root) && Array.isArray(root.claims)) {
      root.claims = root.claims.map(claim => remapGeneratedKeys(claim, {
        '编号': 'id',
        '内容': 'text',
        '来源片段': 'sourceSpanIds'
      }));
    }
    return root;
  }
  if (stageId === 'content-plan') {
    const root = remapGeneratedKeys(value, {
      '标题': 'title',
      '受众': 'audience',
      '目标': 'objective',
      '保留内容': 'retainedClaimIds',
      '舍弃内容': 'discardedClaimIds',
      '章节': 'sections'
    });
    if (isJsonRecord(root) && Array.isArray(root.sections)) {
      root.sections = root.sections.map(item => remapGeneratedKeys(item, {
        '编号': 'id',
        '标题': 'title',
        '内容编号': 'claimIds'
      }));
    }
    return root;
  }
  if (stageId === 'script') {
    const root = remapGeneratedKeys(value, {
      '标题': 'title',
      '段落': 'segments',
      '镜头': 'segments'
    });
    if (isJsonRecord(root) && Array.isArray(root.segments)) {
      root.segments = root.segments.map(segment => remapGeneratedKeys(segment, {
        '旁白': 'narration',
        '内容编号': 'claimIds',
        '来源片段': 'sourceSpanIds'
      }));
    }
    return root;
  }
  if (stageId === 'storyboard') {
    const root = remapGeneratedKeys(value, { '分镜': 'shots', '镜头': 'shots' });
    if (isJsonRecord(root) && Array.isArray(root.shots)) {
      root.shots = root.shots.map(shot => remapGeneratedKeys(shot, {
        '来源段落': 'sourceSegmentId',
        '语义锚点': 'semanticAnchor',
        '画面描述': 'visualDescription',
        '构图与动作': 'compositionAndAction',
        '关键物体': 'keyObjects',
        '连续性说明': 'continuityReason',
        '运镜': 'motion',
        '运镜理由': 'motionReason'
      }));
    }
    return root;
  }
  return value;
}

function remapGeneratedKeys(value: unknown, aliases: Readonly<Record<string, string>>): unknown {
  if (!isJsonRecord(value)) return value;
  const normalized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    const canonicalKey = aliases[key] ?? key;
    if (!(canonicalKey in normalized) || key === canonicalKey) {
      normalized[canonicalKey] = entry;
    }
  }
  return normalized;
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireGeneratedRecord(stageId: string, value: unknown): Record<string, unknown> {
  if (isJsonRecord(value)) return value;
  throw new CreatorExecutorError(
    'creator_llm_invalid_response',
    `${stageId} response was not a JSON object`
  );
}

export function createStickmanConfiguredCompletion(input: {
  configStore: Pick<CreatorServicesConfigStore, 'read'>;
  codexCompleteJson?: CodexCompleteJson;
  context: { jobId: string; projectId: string; cwd: string };
}): CompleteJson {
  return async request => {
    const config = await input.configStore.read();
    if (config.llm.source === 'codex') {
      if (input.codexCompleteJson === undefined) {
        throw new CreatorExecutorError(
          'creator_llm_config_missing',
          'Codex JSON completion runtime is unavailable'
        );
      }
      return input.codexCompleteJson({
        ...request,
        ...input.context,
        model: config.llm.model
      });
    }
    if (!config.llm.apiKey.trim()) {
      throw new CreatorExecutorError('creator_llm_config_missing', 'LLM configuration is incomplete');
    }
    const response = await fetch(
      `${config.llm.baseUrl.replace(/\/$/, '') || 'https://api.openai.com/v1'}/chat/completions`,
      {
        method: 'POST',
        signal: request.signal,
        headers: {
          authorization: `Bearer ${config.llm.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: config.llm.model,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: request.prompt }]
        })
      }
    );
    if (!response.ok) {
      throw new CreatorExecutorError('creator_llm_failed', `LLM request failed: HTTP ${response.status}`);
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new CreatorExecutorError('creator_llm_invalid_response', 'LLM response did not contain JSON');
    }
    try {
      return JSON.parse(content) as Record<string, CreatorJson>;
    } catch {
      throw new CreatorExecutorError('creator_llm_invalid_response', 'LLM response was not valid JSON');
    }
  };
}
