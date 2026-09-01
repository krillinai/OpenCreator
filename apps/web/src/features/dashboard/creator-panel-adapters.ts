import type {
  CreatorActivity,
  CreatorJson,
  CreatorStageRun
} from '@opencreator/protocol';

export type CreatorPanelLocalize = (zh: string, en: string) => string;

export type NormalizedCreatorActivity = {
  label: string;
  fields: string[];
};

export type CreatorStageProgressView = {
  percent: number | null;
  indeterminate?: boolean;
  phase: string | null;
  message: string | null;
  completed: number | null;
  failed: number | null;
  total: number | null;
};

export type CreatorPanelAdapter = {
  id: string;
  composerPlaceholder(l: CreatorPanelLocalize): string;
  stageLabel(stageId: string, l: CreatorPanelLocalize): string;
  phaseLabel(phase: string, l: CreatorPanelLocalize): string | null;
  activityStageId(activity: CreatorActivity): string | null;
  normalizeActivity(
    activity: CreatorActivity,
    l: CreatorPanelLocalize
  ): NormalizedCreatorActivity | null;
  readStageProgress(stage: CreatorStageRun): CreatorStageProgressView;
  aggregateStages?(stages: CreatorStageRun[]): CreatorStageRun[];
  runningProgressText?(
    stage: CreatorStageRun,
    progress: CreatorStageProgressView,
    l: CreatorPanelLocalize
  ): string | null;
  failedProgressText?(
    stage: CreatorStageRun,
    l: CreatorPanelLocalize
  ): string | null;
};

const genericAdapter: CreatorPanelAdapter = {
  id: 'generic',
  composerPlaceholder: l => l(
    '询问任务状态，或描述需要调整的创作要求',
    'Ask about progress or describe the creative changes you need'
  ),
  stageLabel: (_stageId, l) => l('创作任务', 'Creator task'),
  phaseLabel: genericPhaseLabel,
  activityStageId: readActivityStageId,
  normalizeActivity: (activity, l) => normalizeCommonActivity(
    activity,
    l,
    genericAdapter,
    {}
  ),
  readStageProgress: readStandardProgress
};

export const videoTranslationPanelAdapter: CreatorPanelAdapter = {
  id: 'video-translation',
  composerPlaceholder: l => l(
    '询问状态，或描述要调整的语言、字幕、配音和成片要求',
    'Ask about status or describe language, subtitle, dubbing, and video changes'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'subtitle') return l('字幕翻译', 'Subtitle translation');
    if (stageId === 'tts') return l('配音生成', 'Dubbing');
    if (stageId === 'render-horizontal') return l('横屏成片', 'Landscape render');
    if (stageId === 'render-vertical') return l('竖屏成片', 'Portrait render');
    return l('视频翻译任务', 'Video translation task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查任务设置', 'Checking task settings'),
      preparing_source: l('准备视频来源', 'Preparing the video source'),
      reading_platform_captions: l('获取平台字幕', 'Fetching platform captions'),
      processing_platform_captions: l('解析平台字幕', 'Processing platform captions'),
      translating_subtitles: l('翻译字幕', 'Translating subtitles'),
      collecting_subtitles: l('生成双语字幕', 'Generating bilingual subtitles'),
      preparing_original_media: l('准备原始视频', 'Preparing the original video'),
      preparing_audio: l('准备音频转录', 'Preparing audio transcription'),
      transcribing_audio: l('转录并翻译音频', 'Transcribing and translating audio'),
      collecting_outputs: l('整理输出文件', 'Collecting outputs'),
      generating_voice: l('生成配音', 'Generating dubbing'),
      rendering_video: l('渲染视频', 'Rendering video')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    if (activity.action === 'run-stage') {
      const stageId = readActivityStageId(activity);
      return {
        label: stageId === null
          ? l('启动了视频翻译任务', 'Started a video translation task')
          : l(
              `开始生成${videoTranslationPanelAdapter.stageLabel(stageId, l)}`,
              `Started generating ${videoTranslationPanelAdapter.stageLabel(stageId, l)}`
            ),
        fields: []
      };
    }
    return normalizeCommonActivity(activity, l, videoTranslationPanelAdapter, {
      editSubtitle: l('保存了字幕修改', 'Saved subtitle changes')
    }, videoTranslationFieldLabel);
  },
  readStageProgress(stage) {
    const standard = readStandardProgress(stage);
    const legacy = readRecord(stage.progress.krillinEventPayload);
    return {
      percent: standard.percent ?? readFiniteNumber(legacy?.percent),
      phase: standard.phase ?? readString(legacy?.phase),
      message: standard.message ?? readString(legacy?.message),
      completed: standard.completed,
      failed: standard.failed,
      total: standard.total
    };
  }
};

export const coverPanelAdapter: CreatorPanelAdapter = {
  id: 'cover',
  composerPlaceholder: l => l(
    '询问生成状态，或描述要调整的主体、构图、风格和比例',
    'Ask about progress or describe subject, composition, style, and ratio changes'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'analyze-source') return l('分析视频内容', 'Analyze video content');
    if (stageId === 'generate') return l('生成封面方案', 'Generate thumbnail options');
    return l('封面生成任务', 'Thumbnail generation task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查封面设置', 'Checking thumbnail settings'),
      reading_source: l('读取 YouTube 视频信息', 'Reading YouTube video information'),
      analyzing_source: l('分析视频内容和封面方向', 'Analyzing video content and thumbnail direction'),
      downloading_thumbnail: l('获取视频参考画面', 'Fetching the video reference image'),
      preparing_reference: l('准备封面参考素材', 'Preparing thumbnail references'),
      requesting_provider: l('提交图像生成服务', 'Submitting to the image provider'),
      generating_candidates: l('生成封面候选方案', 'Generating thumbnail candidates'),
      finalizing_outputs: l('整理封面方案', 'Finalizing thumbnail options'),
      completed: l('封面方案已生成', 'Thumbnail options generated')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    if (activity.action === 'select-cover') return null;
    return normalizeCommonActivity(activity, l, coverPanelAdapter, {
      'register-reference-image': l('上传了封面参考图', 'Uploaded a thumbnail reference')
    }, coverFieldLabel);
  },
  readStageProgress: readStandardProgress,
  runningProgressText(_stage, progress, l) {
    if (
      progress.total !== null
      && progress.total > 0
      && progress.completed !== null
    ) {
      const failed = progress.failed ?? 0;
      return failed > 0
        ? l(
            `已完成 ${progress.completed}/${progress.total}，失败 ${failed}`,
            `${progress.completed}/${progress.total} completed, ${failed} failed`
          )
        : l(
            `正在生成封面方案，已完成 ${progress.completed}/${progress.total}`,
            `Generating thumbnail options, ${progress.completed}/${progress.total} completed`
          );
    }
    return null;
  }
};

export const videoDownloadPanelAdapter: CreatorPanelAdapter = {
  id: 'video-download',
  composerPlaceholder: l => l(
    '询问解析或下载状态，或描述要下载的视频和音频规格',
    'Ask about analysis or download status, or describe the video or audio format you need'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'probe') return l('解析视频信息', 'Analyze video information');
    if (stageId === 'download') return l('下载到项目', 'Download to project');
    return l('视频下载任务', 'Video download task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查视频链接', 'Checking the video URL'),
      probing_source: l('读取视频信息与可用规格', 'Reading video information and formats'),
      preparing_download: l('准备下载规格', 'Preparing the selected format'),
      downloading: l('下载媒体文件', 'Downloading the media file'),
      merging_media: l('合并视频与音频', 'Merging video and audio'),
      extracting_audio: l('转换 MP3 音频', 'Converting MP3 audio'),
      normalizing_media: l('转换为本机兼容格式', 'Converting for local playback'),
      validating_output: l('检查下载文件', 'Checking the downloaded file'),
      completed: l('文件已保存到项目', 'File saved to the project')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    if (activity.action === 'run-stage') {
      const stageId = readActivityStageId(activity);
      if (stageId === 'probe') {
        return { label: l('开始解析视频链接', 'Started analyzing the video URL'), fields: [] };
      }
      if (stageId === 'download') {
        return { label: l('开始下载到项目', 'Started downloading to the project'), fields: [] };
      }
    }
    return normalizeCommonActivity(
      activity,
      l,
      videoDownloadPanelAdapter,
      {},
      videoDownloadFieldLabel
    );
  },
  readStageProgress(stage) {
    const progress = readStandardProgress(stage);
    if (stage.stageId === 'download') {
      return {
        ...progress,
        percent: null,
        indeterminate: false
      };
    }
    return progress.phase === 'validating'
      || progress.phase === 'probing_source'
      ? { ...progress, percent: null, indeterminate: true }
      : progress;
  },
  runningProgressText(_stage, progress, l) {
    return progress.phase === null
      ? null
      : videoDownloadPanelAdapter.phaseLabel(progress.phase, l);
  },
  failedProgressText(stage, l) {
    if (stage.errorCode === 'network_unavailable') {
      return l(
        '无法连接视频平台，请检查网络或代理设置后重试',
        'Unable to connect to the video platform. Check the network or proxy settings and try again.'
      );
    }
    return null;
  }
};

export const stickmanVideoPanelAdapter: CreatorPanelAdapter = {
  id: 'stickman-video',
  composerPlaceholder: l => l(
    '询问状态，或描述要调整的脚本、镜头、角色和成片要求',
    'Ask about status or describe script, shot, character, and delivery changes'
  ),
  stageLabel(stageId, l) {
    const labels: Record<string, string> = {
      'acquire-source': l('获取 YouTube 来源', 'Acquire YouTube source'),
      'source-transcript': l('提取来源字幕', 'Extract source transcript'),
      'source-brief': l('生成来源摘要', 'Create source brief'),
      'content-plan': l('规划内容结构', 'Plan content structure'),
      script: l('生成脚本', 'Generate script'),
      storyboard: l('生成分镜', 'Generate storyboard'),
      images: l('生成镜头画面', 'Generate shot visuals'),
      narration: l('生成旁白', 'Generate narration'),
      'visual-validation': l('校验画面', 'Validate visuals'),
      timeline: l('编排时间线', 'Build timeline'),
      'render-clean': l('渲染纯净视频', 'Render clean video'),
      cover: l('生成 YouTube 封面', 'Generate YouTube cover'),
      subtitles: l('生成双语字幕', 'Generate bilingual subtitles'),
      'publish-copy': l('生成发布文案', 'Generate publish copy'),
      'bilingual-render': l('渲染双语视频', 'Render bilingual video'),
      'package-validation': l('校验固定交付', 'Validate delivery package')
    };
    return labels[stageId] ?? l('火柴人视频任务', 'Stickman video task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查任务输入', 'Checking task input'),
      downloading: l('下载 YouTube 视频', 'Downloading YouTube video'),
      transcribing: l('提取来源字幕', 'Extracting source transcript'),
      analyzing: l('理解来源内容', 'Analyzing source content'),
      planning: l('规划内容结构', 'Planning content structure'),
      writing: l('生成创作内容', 'Writing creative content'),
      submitting: l('提交图像生成服务', 'Submitting to the image provider'),
      generating: l('生成镜头画面', 'Generating shot visuals'),
      synthesizing: l('合成旁白音频', 'Synthesizing narration'),
      rendering: l('渲染视频', 'Rendering video'),
      packaging: l('整理固定交付', 'Packaging deliverables'),
      failed: l('阶段执行失败', 'Stage failed'),
      completed: l('阶段已完成', 'Stage completed')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    const labels: Record<string, string> = {
      'approve-script': l('审核通过了脚本', 'Approved the script'),
      'edit-script': l('保存了脚本修改', 'Saved script changes'),
      'edit-shot': l('保存了镜头修改', 'Saved shot changes'),
      'approve-storyboard': l('审核通过了分镜', 'Approved the storyboard'),
      'regenerate-shot': l('重新生成了单个镜头', 'Regenerated one shot'),
      'approve-visuals': l('确认了镜头画面', 'Approved shot visuals'),
      'retry-stage': l('重试了失败阶段', 'Retried a failed stage'),
      'commit-version': l('保存了新的交付版本', 'Committed a new delivery version')
    };
    if (activity.action === 'resolve-provider-request') {
      const decision = readString(activity.details.decision);
      if (decision === 'confirm-resubmit') {
        return { label: l('用户确认了可能重复计费的重提', 'User confirmed a potentially duplicate billed resubmission'), fields: [] };
      }
      if (decision === 'cancel-scope') {
        return { label: l('用户取消了状态未知的镜头请求', 'User canceled the unresolved shot request'), fields: [] };
      }
      return { label: l('查询了状态未知的 Provider 请求', 'Queried an unresolved provider request'), fields: [] };
    }
    return normalizeCommonActivity(
      activity,
      l,
      stickmanVideoPanelAdapter,
      labels,
      stickmanFieldLabel
    );
  },
  readStageProgress: readStandardProgress,
  aggregateStages(stages) {
    const otherStages = stages.filter(stage => stage.stageId !== 'images');
    const imageStages = stages.filter(stage => stage.stageId === 'images');
    if (imageStages.length === 0) return stages;
    const latestByScope = new Map<string, CreatorStageRun>();
    for (const stage of imageStages) latestByScope.set(stage.scopeKey ?? stage.id, stage);
    const current = [...latestByScope.values()];
    const representative = current.sort((left, right) => (
      (left.startedAt ?? '').localeCompare(right.startedAt ?? '')
    )).at(-1)!;
    const completed = current.filter(stage => stage.status === 'succeeded').length;
    const failed = current.filter(stage => stage.status === 'failed').length;
    const running = current.some(stage => stage.status === 'running' || stage.status === 'queued');
    const aggregate: CreatorStageRun = {
      ...representative,
      id: `stickman-images:${current.map(stage => stage.id).sort().join(':')}`,
      scopeKey: null,
      inputFingerprint: null,
      status: running ? 'running' : failed > 0 ? 'failed' : 'succeeded',
      progress: {
        ...representative.progress,
        completed,
        failed,
        total: current.length,
        percent: current.length === 0 ? 0 : Math.round((completed / current.length) * 100)
      }
    };
    return [...otherStages, aggregate];
  },
  runningProgressText(_stage, progress, l) {
    if (progress.total === null || progress.completed === null) return null;
    return l(
      `镜头完成 ${progress.completed}/${progress.total}${progress.failed ? `，失败 ${progress.failed}` : ''}`,
      `${progress.completed}/${progress.total} shots completed${progress.failed ? `, ${progress.failed} failed` : ''}`
    );
  }
};

export function creatorPanelAdapterFor(templateId: string): CreatorPanelAdapter {
  if (templateId === 'video-translation') return videoTranslationPanelAdapter;
  if (templateId === 'video-download') return videoDownloadPanelAdapter;
  if (templateId === 'cover') return coverPanelAdapter;
  if (templateId === 'stickman-video') return stickmanVideoPanelAdapter;
  return genericAdapter;
}

function normalizeCommonActivity(
  activity: CreatorActivity,
  l: CreatorPanelLocalize,
  adapter: CreatorPanelAdapter,
  actionLabels: Record<string, string>,
  fieldLabel: (
    field: string,
    l: CreatorPanelLocalize
  ) => string | null = () => null
): NormalizedCreatorActivity | null {
  if (activity.action === 'create-job') return null;
  if (activity.action.startsWith('update-settings')) {
    const objectId = readString(activity.details.objectId) ?? '';
    const fields = objectId
      .split(',')
      .map(field => fieldLabel(field, l))
      .filter((field): field is string => field !== null);
    if (fields.length === 0) return null;
    return {
      label: adapter.id === 'cover'
        ? l('更新了封面设置', 'Updated thumbnail settings')
        : l('更新了创作设置', 'Updated creative settings'),
      fields
    };
  }
  const directLabel = actionLabels[activity.action];
  if (directLabel !== undefined) return { label: directLabel, fields: [] };
  if (activity.action === 'run-stage') {
    const stageId = adapter.activityStageId(activity);
    return {
      label: stageId === null
        ? l('启动了创作任务', 'Started a creator task')
        : l(
            `开始${adapter.stageLabel(stageId, l)}`,
            `Started ${adapter.stageLabel(stageId, l)}`
          ),
      fields: []
    };
  }
  if (activity.action === 'undo-action') {
    return { label: l('撤销了上一次修改', 'Undid the previous change'), fields: [] };
  }
  if (
    activity.actor === 'system'
    && activity.summary.trim().length > 0
  ) {
    return { label: activity.summary, fields: [] };
  }
  return null;
}

function videoTranslationFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    sourceLanguage: l('源语言', 'Source language'),
    targetLanguage: l('目标语言', 'Target language'),
    bilingual: l('双语字幕', 'Bilingual subtitles'),
    subtitlePosition: l('字幕位置', 'Subtitle position'),
    subtitleStyle: l('字幕样式', 'Subtitle style'),
    preferPlatformCaptions: l('平台字幕优先', 'Prefer platform captions'),
    dubbing: l('配音', 'Dubbing'),
    voiceCode: l('音色', 'Voice'),
    composeVideo: l('成片输出', 'Video output'),
    videoFormat: l('成片比例', 'Video format'),
    verticalTitle: l('竖屏标题', 'Portrait title'),
    verticalSubtitle: l('竖屏字幕', 'Portrait subtitles'),
    voiceSampleName: l('声音样本', 'Voice sample'),
    subtitleCues: l('字幕内容', 'Subtitle content')
  };
  return labels[field] ?? null;
}

function coverFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    sourceType: l('生成依据', 'Source'),
    sourceUrl: l('YouTube 来源', 'YouTube source'),
    prompt: l('封面描述', 'Thumbnail prompt'),
    ratio: l('封面比例', 'Thumbnail ratio'),
    candidateCount: l('方案数量', 'Option count'),
    quality: l('生成质量', 'Generation quality'),
    provider: l('图像服务', 'Image provider'),
    referenceImageArtifactId: l('参考图', 'Reference image')
  };
  return labels[field] ?? null;
}

function videoDownloadFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    sourceUrl: l('视频链接', 'Video URL'),
    mediaType: l('媒体类型', 'Media type'),
    selectedOptionId: l('下载规格', 'Download format'),
    formatId: l('下载规格', 'Download format')
  };
  return labels[field] ?? null;
}

function stickmanFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    sourceUrl: l('YouTube 来源', 'YouTube source'),
    selectedPresetId: l('角色预设', 'Character preset'),
    characterPrompt: l('角色描述', 'Character prompt'),
    style: l('视觉风格', 'Visual style'),
    targetDurationSeconds: l('目标时长', 'Target duration'),
    targetLanguage: l('目标语言', 'Target language'),
    voice: l('旁白音色', 'Narration voice')
  };
  return labels[field] ?? null;
}

function readActivityStageId(activity: CreatorActivity): string | null {
  const structured = readString(activity.details.stageId);
  if (structured !== null) return structured;
  const match = /(?:启动阶段|stage)\s+([a-z0-9-]+)/i.exec(activity.summary);
  return match?.[1] ?? null;
}

function readStandardProgress(stage: CreatorStageRun): CreatorStageProgressView {
  return {
    percent: readFiniteNumber(stage.progress.percent),
    phase: readString(stage.progress.phase),
    message: readString(stage.progress.message),
    completed: readFiniteNumber(stage.progress.completed),
    failed: readFiniteNumber(stage.progress.failed),
    total: readFiniteNumber(stage.progress.total)
  };
}

function genericPhaseLabel(
  phase: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    validating: l('检查任务设置', 'Checking task settings'),
    preparing_source: l('准备任务素材', 'Preparing source material'),
    requesting_provider: l('提交生成服务', 'Submitting to the provider'),
    collecting_outputs: l('整理输出文件', 'Collecting outputs'),
    finalizing_outputs: l('整理创作结果', 'Finalizing outputs'),
    completed: l('任务已完成', 'Task completed')
  };
  return labels[phase] ?? null;
}

function readRecord(value: CreatorJson | undefined): Record<string, CreatorJson> | null {
  return value !== null && value !== undefined && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function readString(value: CreatorJson | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : null;
}

function readFiniteNumber(value: CreatorJson | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
