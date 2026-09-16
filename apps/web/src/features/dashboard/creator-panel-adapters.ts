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
  succeededProgressText?(
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
    '询问生成状态，或调整封面文字、语言、风格和构图',
    'Ask about progress or adjust cover text, language, style, and composition'
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
      reading_source_retry: l('重新连接 YouTube', 'Reconnecting to YouTube'),
      analyzing_source: l('分析视频内容并生成封面文案', 'Analyzing video content and generating cover copy'),
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
  readStageProgress(stage) {
    const progress = readStandardProgress(stage);
    if (
      progress.percent === null
      && (progress.phase === 'reading_source' || progress.phase === 'reading_source_retry')
    ) {
      return {
        ...progress,
        indeterminate: stage.status === 'running'
      };
    }
    if (progress.percent === null || stage.progress.workflow !== true) return progress;
    const normalized = Math.max(0, Math.min(100, progress.percent));
    const percent = stage.stageId === 'analyze-source'
      ? normalized * 0.35
      : stage.stageId === 'generate'
        && typeof stage.progress.workflowParentStageRunId === 'string'
        ? 35 + normalized * 0.65
        : normalized;
    return {
      ...progress,
      percent: Math.round(Math.max(0, Math.min(100, percent)))
    };
  },
  runningProgressText(stage, progress, l) {
    if (progress.phase === 'reading_source_retry') {
      const attempt = readFiniteNumber(stage.progress.retryAttempt);
      const total = readFiniteNumber(stage.progress.retryTotal);
      return attempt !== null && total !== null
        ? l(
            `读取视频信息超时，正在重试 ${attempt}/${total}`,
            `Reading video information timed out. Retrying ${attempt}/${total}`
          )
        : l(
            '读取视频信息超时，正在重新连接',
            'Reading video information timed out. Reconnecting.'
          );
    }
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
  },
  failedProgressText(stage, l) {
    if (stage.errorCode === 'network_unavailable') {
      return l(
        '无法连接 YouTube，请检查网络或代理设置后重试',
        'Unable to connect to YouTube. Check the network or proxy settings and try again.'
      );
    }
    return null;
  },
  succeededProgressText(stage, l) {
    if (stage.stageId === 'analyze-source') {
      return l('视频内容分析完成', 'Video content analysis completed');
    }
    if (stage.stageId === 'generate') {
      return l('封面方案已生成', 'Thumbnail options generated');
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

export const autoClipPanelAdapter: CreatorPanelAdapter = {
  id: 'auto-clip',
  composerPlaceholder: l => l(
    '询问分析或导出状态，或调整内容重点、片段时长和输出画幅',
    'Ask about analysis or export progress, or adjust the focus, clip length, and output format'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'probe') return l('读取视频信息', 'Read video information');
    if (stageId === 'download') return l('下载源视频', 'Download source video');
    if (stageId === 'subtitle') return l('生成视频字幕', 'Generate video transcript');
    if (stageId === 'analyze') return l('识别高光片段', 'Find highlight clips');
    if (stageId === 'render') return l('导出视频切片', 'Export video clips');
    return l('视频切片任务', 'Video clips task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查视频与切片设置', 'Checking the video and clip settings'),
      probing_source: l('读取视频信息', 'Reading video information'),
      preparing_download: l('准备下载源视频', 'Preparing the source video download'),
      downloading: l('下载源视频', 'Downloading the source video'),
      merging_media: l('合并视频与音频', 'Merging video and audio'),
      normalizing_media: l('转换视频格式', 'Converting the video format'),
      preparing_source: l('准备视频内容', 'Preparing the video content'),
      reading_platform_captions: l('获取平台字幕', 'Fetching platform captions'),
      processing_platform_captions: l('解析平台字幕', 'Processing platform captions'),
      transcribing_audio: l('转录视频语音', 'Transcribing the video audio'),
      collecting_subtitles: l('整理视频字幕', 'Collecting the video transcript'),
      analyzing_clips: l('分析高光与传播潜力', 'Analyzing highlights and social potential'),
      rendering_clips: l('生成独立视频切片', 'Rendering individual video clips'),
      completed: l('视频切片已完成', 'Video clips completed')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    if (activity.action === 'run-stage') {
      const stageId = readActivityStageId(activity);
      return {
        label: stageId === null
          ? l('开始视频切片任务', 'Started the video clips task')
          : l(
              `开始${autoClipPanelAdapter.stageLabel(stageId, l)}`,
              `Started ${autoClipPanelAdapter.stageLabel(stageId, l)}`
            ),
        fields: []
      };
    }
    return normalizeCommonActivity(activity, l, autoClipPanelAdapter, {}, autoClipFieldLabel);
  },
  readStageProgress: readStandardProgress,
  runningProgressText(_stage, progress, l) {
    if (progress.total !== null && progress.total > 0 && progress.completed !== null && progress.phase === 'rendering_clips') {
      return l(`正在导出视频切片 ${progress.completed}/${progress.total}`, `Exporting video clips ${progress.completed}/${progress.total}`);
    }
    return progress.phase === null ? null : autoClipPanelAdapter.phaseLabel(progress.phase, l);
  },
  succeededProgressText(stage, l) {
    if (stage.stageId === 'probe') return l('视频信息已读取', 'Video information read');
    if (stage.stageId === 'download') return l('源视频已下载', 'Source video downloaded');
    if (stage.stageId === 'subtitle') return l('视频字幕已生成', 'Video transcript generated');
    if (stage.stageId === 'analyze') return l('高光片段已识别', 'Highlight clips found');
    if (stage.stageId === 'render') return l('视频切片已导出', 'Video clips exported');
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
      'ingest-text': l('保存文本来源', 'Save text source'),
      'source-transcript': l('提取来源字幕', 'Extract source transcript'),
      'source-brief': l('生成来源摘要', 'Create source brief'),
      'content-plan': l('规划内容结构', 'Plan content structure'),
      script: l('生成脚本', 'Generate script'),
      narration: l('生成旁白', 'Generate narration'),
      'audio-timing': l('测量旁白时长', 'Measure narration timing'),
      storyboard: l('生成分镜', 'Generate storyboard'),
      'style-assets': l('准备角色参考图与风格', 'Prepare character reference and style'),
      'prompt-pack': l('生成镜头提示词', 'Build shot prompts'),
      images: l('生成镜头画面', 'Generate shot visuals'),
      'visual-validation': l('校验画面', 'Validate visuals'),
      timeline: l('生成时间线与旁白字幕', 'Build timeline and narration subtitles'),
      'render-clean': l('渲染火柴人动画', 'Render stickman video'),
      'media-validation': l('校验成片媒体', 'Validate rendered media'),
      'package-validation': l('整理成片与字幕', 'Prepare video and subtitles')
    };
    return labels[stageId] ?? l('火柴人视频任务', 'Stickman video task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查任务输入', 'Checking task input'),
      preparing_source: l('准备 YouTube 来源', 'Preparing the YouTube source'),
      reading_platform_captions: l('获取平台字幕', 'Fetching platform captions'),
      processing_platform_captions: l('解析平台字幕', 'Processing platform captions'),
      translating_subtitles: l('整理来源字幕', 'Preparing source captions'),
      preparing_audio: l('平台字幕不可用，准备音频转录', 'Platform captions unavailable; preparing audio transcription'),
      transcribing_audio: l('使用 Whisper 转录音频', 'Transcribing audio with Whisper'),
      collecting_outputs: l('整理来源字幕', 'Collecting source captions'),
      transcribing: l('提取来源字幕', 'Extracting source transcript'),
      analyzing: l('理解来源内容', 'Analyzing source content'),
      planning: l('规划内容结构', 'Planning content structure'),
      writing: l('生成创作内容', 'Writing creative content'),
      reviewing: l('检查脚本结构与语义', 'Reviewing script structure and meaning'),
      materializing: l('准备角色参考图与风格合同', 'Preparing character reference and style contract'),
      submitting: l('提交图像生成服务', 'Submitting to the image provider'),
      retrying_candidate: l('重新生成当前镜头候选', 'Retrying the current shot candidate'),
      generating: l('生成镜头画面', 'Generating shot visuals'),
      synthesizing: l('合成旁白音频', 'Synthesizing narration'),
      measuring: l('测量真实音频时长', 'Measuring real audio timing'),
      validating_media: l('检查视频轨、音频轨与抽帧', 'Checking video, audio, and sampled frames'),
      rendering: l('渲染视频', 'Rendering video'),
      packaging: l('整理成片与字幕', 'Packaging video and subtitles'),
      failed: l('阶段执行失败', 'Stage failed'),
      completed: l('阶段已完成', 'Stage completed')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    if (activity.action === 'run-stage') return null;
    const labels: Record<string, string> = {
      'approve-script': l('审核通过了脚本', 'Approved the script'),
      'continue-after-audio': l('确认配音并开始生成分镜画面', 'Continued from audio to storyboard visuals'),
      'continue-after-visuals': l('确认画面并开始动画合成', 'Continued from visuals to video composition'),
      'edit-script': l('保存了脚本修改', 'Saved script changes'),
      'edit-shot': l('保存了镜头修改', 'Saved shot changes'),
      'regenerate-shot': l('重新生成了单个镜头', 'Regenerated one shot'),
      'generate-missing-shots': l('继续生成剩余分镜画面', 'Continued generating missing shot visuals'),
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
    const scriptStageIds = new Set<string>([
      'ingest-text',
      'source-transcript',
      'source-brief',
      'content-plan',
      'script'
    ]);
    const scriptStages = stages.filter(stage => scriptStageIds.has(stage.stageId));
    const productionStages = stages.filter(stage => (
      !scriptStageIds.has(stage.stageId) && stage.stageId !== 'acquire-source'
    ));
    if (productionStages.length === 0) {
      const scriptPipeline = aggregateStickmanScriptStages(scriptStages);
      return scriptPipeline === undefined ? [] : [scriptPipeline];
    }
    const representative = currentStickmanStage(productionStages);
    return representative === undefined ? [] : [representative];
  },
  runningProgressText(stage, progress, l) {
    if (stage.stageId === 'script' && progress.phase !== null) {
      return stickmanVideoPanelAdapter.phaseLabel(progress.phase, l);
    }
    if (stage.stageId !== 'images') return null;
    if (progress.total === null || progress.completed === null) return null;
    return l(
      `镜头完成 ${progress.completed}/${progress.total}${progress.failed ? `，失败 ${progress.failed}` : ''}`,
      `${progress.completed}/${progress.total} shots completed${progress.failed ? `, ${progress.failed} failed` : ''}`
    );
  }
};

function aggregateStickmanScriptStages(
  stages: CreatorStageRun[]
): CreatorStageRun | undefined {
  if (stages.length === 0) return undefined;
  const textSource = stages.some(stage => stage.stageId === 'ingest-text');
  const order = textSource
    ? ['ingest-text', 'source-brief', 'content-plan', 'script']
    : ['source-transcript', 'source-brief', 'content-plan', 'script'];
  const current = order.flatMap(stageId => (
    stages.find(stage => stage.stageId === stageId) ?? []
  ));
  if (current.length === 0) return undefined;

  const active = latestStartedStage(current.filter(stage => stage.status === 'running'))
    ?? latestStartedStage(current.filter(stage => stage.status === 'queued'));
  const stopped = latestStartedStage(current.filter(stage => (
    stage.status === 'failed'
    || stage.status === 'canceled'
    || stage.status === 'interrupted'
  )));
  const script = current.find(stage => stage.stageId === 'script');
  const representative = active ?? stopped ?? script ?? latestStartedStage(current)!;
  const currentIndex = Math.max(0, order.indexOf(representative.stageId));
  const completed = active === undefined
    && stopped === undefined
    && script?.status === 'succeeded';
  const status = completed
    ? 'succeeded' as const
    : active?.status ?? stopped?.status ?? 'running' as const;
  const stagePercent = representative.status === 'succeeded'
    ? 100
    : Math.max(0, Math.min(100, readFiniteNumber(representative.progress.percent) ?? 0));
  const percent = completed
    ? 100
    : Math.round(((currentIndex + stagePercent / 100) / order.length) * 100);

  return {
    ...representative,
    stageId: 'script',
    scopeKey: null,
    inputFingerprint: null,
    status,
    progress: {
      ...representative.progress,
      phase: representative.progress.phase ?? null,
      message: representative.progress.message ?? null,
      percent,
      completed: completed ? order.length : currentIndex,
      failed: stopped?.status === 'failed' ? 1 : 0,
      total: order.length
    },
    startedAt: current[0]?.startedAt ?? null,
    finishedAt: completed ? script?.finishedAt ?? representative.finishedAt : null
  };
}

function currentStickmanStage(stages: CreatorStageRun[]): CreatorStageRun | undefined {
  return latestStartedStage(stages.filter(stage => stage.status === 'running'))
    ?? latestStartedStage(stages.filter(stage => stage.status === 'queued'))
    ?? latestStartedStage(stages.filter(stage => (
      stage.status === 'failed'
      || stage.status === 'canceled'
      || stage.status === 'interrupted'
    )))
    ?? latestStartedStage(stages.filter(stage => stage.status === 'succeeded'));
}

function latestStartedStage(stages: CreatorStageRun[]): CreatorStageRun | undefined {
  return [...stages].sort((left, right) => (
    (left.startedAt ?? '').localeCompare(right.startedAt ?? '')
    || left.id.localeCompare(right.id)
  )).at(-1);
}

export const smartDubbingPanelAdapter: CreatorPanelAdapter = {
  id: 'smart-dubbing',
  composerPlaceholder: l => l(
    '询问生成状态，或调整文案、音色、风格和语速',
    'Ask about progress or adjust the script, voice, delivery, and speed'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'tts') return l('生成配音', 'Generate dubbing');
    return l('智能配音任务', 'AI dubbing task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查配音设置', 'Checking dubbing settings'),
      generating_voice: l('生成配音音频', 'Generating dubbing audio'),
      finalizing_output: l('整理配音文件', 'Finalizing the dubbing file'),
      completed: l('配音音频已生成', 'Dubbing audio generated')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    if (activity.action === 'run-stage') {
      return { label: l('开始生成配音', 'Started generating dubbing'), fields: [] };
    }
    return normalizeCommonActivity(
      activity,
      l,
      smartDubbingPanelAdapter,
      {},
      smartDubbingFieldLabel
    );
  },
  readStageProgress: readStandardProgress,
  runningProgressText(_stage, progress, l) {
    return progress.phase === null
      ? null
      : smartDubbingPanelAdapter.phaseLabel(progress.phase, l);
  },
  succeededProgressText(_stage, l) {
    return l('配音音频已生成', 'Dubbing audio generated');
  }
};

export const xiaohongshuPostPanelAdapter: CreatorPanelAdapter = {
  id: 'xiaohongshu-post',
  composerPlaceholder: l => l(
    '询问生成状态，或调整主题、受众、内容类型和篇幅',
    'Ask about progress or adjust the topic, audience, style, and length'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'generate') return l('生成小红书帖子', 'Generate Xiaohongshu post');
    return l('小红书帖子任务', 'Xiaohongshu post task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查帖子设置', 'Checking post settings'),
      generating_post: l('生成帖子内容', 'Generating post content'),
      completed: l('帖子已生成', 'Post generated')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    return normalizeCommonActivity(
      activity,
      l,
      xiaohongshuPostPanelAdapter,
      {},
      xiaohongshuPostFieldLabel
    );
  },
  readStageProgress: readStandardProgress,
  runningProgressText(_stage, progress, l) {
    return progress.phase === null
      ? null
      : xiaohongshuPostPanelAdapter.phaseLabel(progress.phase, l);
  },
  failedProgressText(stage, l) {
    return stage.errorCode === 'creator_llm_config_missing'
      ? l(
          '请先在设置的 AI 服务中配置文本模型',
          'Configure a text model in AI Services first.'
        )
      : null;
  },
  succeededProgressText(_stage, l) {
    return l('帖子已生成，可以复制或下载', 'The post is ready to copy or download');
  }
};

export const shortVideoScriptPanelAdapter: CreatorPanelAdapter = {
  id: 'short-video-script',
  composerPlaceholder: l => l(
    '询问生成状态，或调整主题、受众、平台、时长和语气',
    'Ask about progress or adjust the topic, audience, platform, duration, and tone'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'generate') return l('生成短视频脚本', 'Generate short video script');
    return l('短视频脚本任务', 'Short video script task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查脚本设置', 'Checking script settings'),
      generating_script: l('生成脚本内容', 'Generating script content'),
      completed: l('脚本已生成', 'Script generated')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    return normalizeCommonActivity(
      activity,
      l,
      shortVideoScriptPanelAdapter,
      {},
      shortVideoScriptFieldLabel
    );
  },
  readStageProgress: readStandardProgress,
  runningProgressText(_stage, progress, l) {
    return progress.phase === null
      ? null
      : shortVideoScriptPanelAdapter.phaseLabel(progress.phase, l);
  },
  failedProgressText(stage, l) {
    return stage.errorCode === 'creator_llm_config_missing'
      ? l(
          '请先在设置的 AI 服务中配置文本模型',
          'Configure a text model in AI Services first.'
        )
      : null;
  },
  succeededProgressText(_stage, l) {
    return l('脚本已生成，可以修改、复制或下载', 'The script is ready to edit, copy, or download');
  }
};

export const wechatArticlePanelAdapter: CreatorPanelAdapter = {
  id: 'wechat-article',
  composerPlaceholder: l => l(
    '询问写作进度，或调整选题、结构、正文和配图要求',
    'Ask about progress or adjust the topic, structure, article, and images'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'sources') return l('解析内容灵感', 'Parse inspiration sources');
    if (stageId === 'topics') return l('生成候选选题', 'Generate topic options');
    if (stageId === 'outline') return l('生成文章大纲', 'Generate article outline');
    if (stageId === 'article') return l('撰写文章正文', 'Write article');
    if (stageId === 'images') return l('生成文章配图', 'Generate article images');
    if (stageId === 'document') return l('生成文章文档', 'Generate article document');
    return l('文章写作', 'Article writing');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      collecting_sources: l('整理内容灵感', 'Collecting inspiration'),
      reading_video: l('读取视频内容', 'Reading video content'),
      reading_webpage: l('读取网页内容', 'Reading webpage content'),
      reading_document: l('读取文档内容', 'Reading document content'),
      generating_topics: l('生成候选选题', 'Generating topic options'),
      generating_outline: l('生成文章大纲', 'Generating the article outline'),
      writing_article: l('撰写文章正文', 'Writing the article'),
      planning_article_images: l('规划文章配图', 'Planning article images'),
      generating_article_images: l('生成文章配图', 'Generating article images'),
      preparing_document: l('整理文章文档', 'Preparing the article document'),
      completed: l('内容已生成', 'Content generated')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    if (activity.action.startsWith('update-settings')) {
      return normalizeWechatArticleUpdateActivity(activity, l);
    }
    return normalizeCommonActivity(activity, l, wechatArticlePanelAdapter, {
      'register-source-document': l('上传了内容灵感', 'Uploaded an inspiration source')
    }, wechatArticleFieldLabel);
  },
  readStageProgress: readStandardProgress,
  succeededProgressText(stage, l) {
    if (stage.stageId === 'sources') return l('内容灵感已解析', 'Inspiration sources parsed');
    if (stage.stageId === 'topics') return l('候选选题已生成', 'Topic options generated');
    if (stage.stageId === 'outline') return l('文章大纲已生成', 'Article outline generated');
    if (stage.stageId === 'article') return l('文章正文已生成', 'Article generated');
    if (stage.stageId === 'images') return l('文章配图已生成', 'Article images generated');
    if (stage.stageId === 'document') return l('文章文档已生成', 'Article document generated');
    return null;
  }
};

export const videoGenerationPanelAdapter: CreatorPanelAdapter = {
  id: 'video-generation',
  composerPlaceholder: l => l(
    '询问生成状态，或调整视频内容、服务、模型、画幅和时长',
    'Ask about progress or adjust the video content, provider, model, format, and duration'
  ),
  stageLabel(stageId, l) {
    if (stageId === 'generate') return l('生成视频', 'Generate video');
    return l('视频生成任务', 'Video generation task');
  },
  phaseLabel(phase, l) {
    const labels: Record<string, string> = {
      validating: l('检查视频生成设置', 'Checking video generation settings'),
      preparing_reference: l('准备视频参考图', 'Preparing the reference image'),
      submitting: l('提交视频生成任务', 'Submitting the video generation task'),
      queued: l('等待视频服务开始生成', 'Waiting for the video provider'),
      generating: l('视频生成中', 'Generating video'),
      downloading: l('下载生成的视频', 'Downloading the generated video'),
      collecting_output: l('整理视频文件', 'Collecting the video file'),
      validating_output: l('检查视频文件', 'Checking the video file'),
      completed: l('视频已生成', 'Video generated'),
      provider_failed: l('视频服务生成失败', 'Video provider failed')
    };
    return labels[phase] ?? genericPhaseLabel(phase, l);
  },
  activityStageId: readActivityStageId,
  normalizeActivity(activity, l) {
    return normalizeCommonActivity(
      activity,
      l,
      videoGenerationPanelAdapter,
      {
        'register-reference-image': l('上传了视频参考图', 'Uploaded a video reference image')
      },
      videoGenerationFieldLabel
    );
  },
  readStageProgress(stage) {
    const progress = readStandardProgress(stage);
    if (
      progress.percent === null
      && (progress.phase === 'queued' || progress.phase === 'generating')
    ) {
      return {
        ...progress,
        indeterminate: stage.status === 'running'
      };
    }
    return progress;
  },
  runningProgressText(_stage, progress, l) {
    return progress.phase === null
      ? null
      : videoGenerationPanelAdapter.phaseLabel(progress.phase, l);
  },
  failedProgressText(stage, l) {
    if (stage.errorCode === 'creator_video_config_missing') {
      return l(
        '请先在设置的 AI 服务中配置视频生成服务',
        'Configure a video generation provider in AI Services first.'
      );
    }
    if (stage.errorCode === 'creator_video_model_unavailable') {
      return l(
        '当前账号未开通所选视频模型，请切换模型版本或前往服务商控制台开通',
        'The selected video model is not enabled for this account. Switch models or enable it in the provider console.'
      );
    }
    return null;
  },
  succeededProgressText(_stage, l) {
    return l('视频已生成，可以预览或下载', 'The video is ready to preview or download');
  }
};

export function creatorPanelAdapterFor(templateId: string): CreatorPanelAdapter {
  if (templateId === 'video-translation') return videoTranslationPanelAdapter;
  if (templateId === 'video-download') return videoDownloadPanelAdapter;
  if (templateId === 'auto-clip') return autoClipPanelAdapter;
  if (templateId === 'smart-dubbing') return smartDubbingPanelAdapter;
  if (templateId === 'xiaohongshu-post') return xiaohongshuPostPanelAdapter;
  if (templateId === 'short-video-script') return shortVideoScriptPanelAdapter;
  if (templateId === 'wechat-article') return wechatArticlePanelAdapter;
  if (templateId === 'cover') return coverPanelAdapter;
  if (templateId === 'video-generation') return videoGenerationPanelAdapter;
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
  if (activity.action === 'select-result-version') {
    return { label: l(`选择了项目结果 V${activity.details.version}`, `Selected project result V${activity.details.version}`), fields: [] };
  }
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
  if (activity.action === 'needs-input') {
    return {
      label: creatorSystemIssueText(readString(activity.details.code), l)
        ?? l(
          '任务需要处理后才能继续',
          'Action is required before the task can continue'
        ),
      fields: []
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
    return {
      label: l(
        '系统更新了任务状态',
        'System updated the task status'
      ),
      fields: []
    };
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
    prompt: l('内容与补充要求', 'Content and requirements'),
    coverStyle: l('封面风格', 'Thumbnail style'),
    coverTextLanguage: l('封面文字语言', 'Cover text language'),
    customStylePrompt: l('自定义风格', 'Custom style'),
    coverHeadline: l('封面主标题', 'Cover headline'),
    coverSubheadline: l('封面副标题', 'Cover subheadline'),
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
    sourceType: l('内容来源', 'Content source'),
    sourceUrl: l('YouTube 来源', 'YouTube source'),
    sourceText: l('文本来源', 'Text source'),
    characterAsset: l('人物形象', 'Character'),
    styleAsset: l('视觉风格', 'Visual style'),
    targetDurationSeconds: l('目标时长', 'Target duration'),
    targetLanguage: l('目标语言', 'Target language'),
    voice: l('旁白音色', 'Narration voice')
  };
  return labels[field] ?? null;
}

function smartDubbingFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    text: l('配音文案', 'Dubbing script'),
    ttsProvider: l('配音服务', 'TTS provider'),
    ttsModel: l('配音模型', 'TTS model'),
    voiceCode: l('音色', 'Voice'),
    voiceName: l('音色名称', 'Voice name'),
    style: l('表达风格', 'Delivery style'),
    speed: l('语速', 'Speaking rate'),
    format: l('音频格式', 'Audio format')
  };
  return labels[field] ?? null;
}

function xiaohongshuPostFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    topic: l('主题或素材', 'Topic or source material'),
    audience: l('目标读者', 'Audience'),
    style: l('内容类型', 'Post type'),
    length: l('内容篇幅', 'Length'),
    extraRequirements: l('补充要求', 'Additional requirements')
  };
  return labels[field] ?? null;
}

function wechatArticleFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    sourceLinks: l('链接灵感', 'Linked inspiration'),
    sourceDocumentArtifactIds: l('文档灵感', 'Document inspiration'),
    writingPrompt: l('写作要求', 'Writing brief'),
    topicCount: l('选题数量', 'Topic count'),
    topics: l('候选选题', 'Topic options'),
    selectedTopicId: l('选定选题', 'Selected topic'),
    outline: l('文章大纲', 'Article outline'),
    presetId: l('文章模板', 'Article template'),
    layoutStyleId: l('排版风格', 'Layout style'),
    templatePrompt: l('模板要求', 'Template instructions'),
    articleMarkdown: l('文章正文', 'Article content'),
    autoGenerateImages: l('文章配图', 'Article images'),
    articleImageCount: l('配图数量', 'Image count'),
    articleImageStyleId: l('生图风格', 'Image style'),
    articleImagePrompt: l('配图要求', 'Image direction')
  };
  return labels[field] ?? null;
}

function shortVideoScriptFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    topic: l('主题或素材', 'Topic or source material'),
    audience: l('目标受众', 'Audience'),
    platform: l('发布平台或场景', 'Platform or use case'),
    targetDurationSeconds: l('目标时长', 'Target duration'),
    tone: l('表达语气', 'Tone'),
    extraRequirements: l('补充要求', 'Additional requirements')
  };
  return labels[field] ?? null;
}

function autoClipFieldLabel(field: string, l: CreatorPanelLocalize): string | null {
  const labels: Record<string, string> = {
    sourceType: l('视频来源', 'Video source'),
    sourceUrl: l('视频链接', 'Video URL'),
    sourceArtifactId: l('项目视频', 'Project video'),
    focus: l('内容重点', 'Content focus'),
    duration: l('目标时长', 'Target duration'),
    clipCount: l('候选数量', 'Candidate count'),
    aspectRatio: l('输出画幅', 'Output format')
  };
  return labels[field] ?? null;
}

function videoGenerationFieldLabel(
  field: string,
  l: CreatorPanelLocalize
): string | null {
  const labels: Record<string, string> = {
    prompt: l('视频描述', 'Video prompt'),
    provider: l('视频服务', 'Video provider'),
    model: l('模型版本', 'Model version'),
    size: l('画幅与分辨率', 'Format and resolution'),
    duration: l('视频时长', 'Video duration'),
    referenceImageArtifactId: l('参考图', 'Reference image')
  };
  return labels[field] ?? null;
}

function normalizeWechatArticleUpdateActivity(
  activity: CreatorActivity,
  l: CreatorPanelLocalize
): NormalizedCreatorActivity | null {
  const objectId = readString(activity.details.objectId) ?? '';
  const fieldIds = objectId.split(',').filter(field => wechatArticleFieldLabel(field, l) !== null);
  if (fieldIds.length === 0) return null;
  const fieldSet = new Set(fieldIds);

  if (fieldSet.has('selectedTopicId')) {
    return { label: l('选定了文章选题', 'Selected the article topic'), fields: [] };
  }
  if (fieldSet.has('outline')) {
    return { label: l('生成了文章大纲', 'Generated the article outline'), fields: [] };
  }
  if (fieldSet.has('articleMarkdown')) {
    return { label: l('生成了文章正文', 'Generated the article'), fields: [] };
  }
  if (fieldSet.has('topics')) {
    return { label: l('生成了候选选题', 'Generated topic options'), fields: [] };
  }

  const fields = [...new Set(fieldIds
    .map(field => wechatArticleFieldLabel(field, l))
    .filter((field): field is string => field !== null))];
  const hasImageSettings = fieldIds.some(field => [
    'autoGenerateImages',
    'articleImageCount',
    'articleImageStyleId',
    'articleImagePrompt'
  ].includes(field));
  if (hasImageSettings) {
    return { label: l('调整了文章配图', 'Adjusted article images'), fields };
  }
  if (fieldSet.has('layoutStyleId')) {
    return { label: l('选择了排版风格', 'Selected the layout style'), fields };
  }
  const hasWritingBrief = fieldIds.some(field => [
    'writingPrompt',
    'topicCount',
    'presetId',
    'templatePrompt'
  ].includes(field));
  if (hasWritingBrief) {
    return { label: l('完善了写作要求', 'Refined the writing brief'), fields };
  }
  return { label: l('更新了内容灵感', 'Updated inspiration sources'), fields };
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

export function creatorSystemIssueText(
  code: string | null,
  l: CreatorPanelLocalize
): string | null {
  if (code === null) return null;
  const labels: Record<string, string> = {
    creator_llm_config_missing: l(
      '请先配置文本模型',
      'Configure the text model to continue'
    ),
    creator_transcription_config_missing: l(
      '请先配置语音转录服务',
      'Configure speech transcription to continue'
    ),
    creator_tts_config_missing: l(
      '请先配置配音服务',
      'Configure dubbing to continue'
    ),
    creator_image_config_missing: l(
      '请先配置图像生成服务',
      'Configure image generation to continue'
    ),
    creator_video_config_missing: l(
      '请先配置视频生成服务',
      'Configure video generation to continue'
    ),
    creator_video_model_unavailable: l(
      '当前账号未开通所选视频模型',
      'The selected video model is not enabled for this account'
    ),
    unsupported_capability: l(
      '当前服务不支持所需能力，请更换服务',
      'The current provider does not support the required capability'
    ),
    creator_cover_reference_missing: l(
      '请先添加封面参考图',
      'Add a thumbnail reference image to continue'
    ),
    creator_stage_input_missing: l(
      '任务缺少必需输入，请检查设置',
      'Required task input is missing. Check the settings.'
    ),
    network_unavailable: l(
      '网络连接失败，请检查网络或代理设置后重试',
      'Network connection failed. Check the network or proxy settings and try again.'
    ),
    yt_dlp_update_recommended: l(
      'yt-dlp 可能已过期，请更新后重试',
      'yt-dlp may be outdated. Update it and try again.'
    )
  };
  return labels[code] ?? null;
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
