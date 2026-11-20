import type { CreatorJob, OpenCreatorIssue } from '@opencreator/protocol';
import type { LocalizeCopy } from '../../i18n/useLocalizedCopy.js';

export function translationStartupIssue(job: CreatorJob | undefined) {
  if (job?.templateId !== 'video-translation' || job.status !== 'draft' || job.stages.some(stage => stage.stageId === 'subtitle')) return undefined;
  return job.issues?.find(issue => issue.status === 'open' && issue.source === 'preflight'
    && issue.stageId === 'subtitle' && issue.code === 'GATEWAY_SERVICES_NOT_READY');
}

export function translationStartupFailureMessage(issue: OpenCreatorIssue, l: LocalizeCopy) {
  return issue.publicFacts?.kind === 'connection-refused'
    ? l('官方服务连接被拒绝，翻译尚未开始。', 'The official service connection was refused. Translation has not started.', 'Anslutningen till den officiella tjänsten nekades. Översättningen har inte startat.')
    : l('官方服务尚未就绪，翻译尚未开始。', 'The official service is not ready. Translation has not started.', 'Den officiella tjänsten är inte redo. Översättningen har inte startat.');
}
