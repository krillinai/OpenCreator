import {
  socialPublishPlatforms,
  socialPublishTitleMaxLength,
  type CreatorArtifact,
  type CreatorStageRun,
  type SocialPublishPlatform,
  type SocialPublishPlatformResult,
  type SocialPublishTiktokPrivacy,
  type SocialPublishYoutubePrivacy
} from '@opencreator/protocol';
import { Check, CircleAlert, ExternalLink, LoaderCircle, Send, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useConfirmDialog } from '../../components/dialogs/ConfirmDialogProvider.js';
import NativeSelect from '../../components/forms/NativeSelect.js';
import type { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export type PublishingConfigurationStatus = 'loading' | 'configured' | 'missing' | 'unavailable';

/** The delivery manifest's own verdict; publishing follows it (the daemon enforces the same rule). */
export type SocialPublishDeliveryState = {
  packageStatus: 'publishable' | 'technical-draft';
  placeholderAssets: string[];
  blockingChecks: string[];
};

export type SocialPublishSettings = {
  platforms: SocialPublishPlatform[];
  title: string;
  description: string;
  youtubePrivacy: SocialPublishYoutubePrivacy;
  tiktokPrivacy: SocialPublishTiktokPrivacy;
  aiGenerated: boolean;
};

const platformLabels: Record<SocialPublishPlatform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  linkedin: 'LinkedIn',
  facebook: 'Facebook',
  x: 'X',
  threads: 'Threads',
  bluesky: 'Bluesky'
};

export function StickmanSocialPublishPanel(props: {
  l: ReturnType<typeof useLocalizedCopy>;
  configuration: PublishingConfigurationStatus;
  deliveryManifestArtifactId?: string;
  /** Undefined while the delivery manifest is still loading. */
  delivery?: SocialPublishDeliveryState;
  ratio: '16:9' | '9:16';
  defaultTitle: string;
  defaultDescription: string;
  artifacts: CreatorArtifact[];
  stages: CreatorStageRun[];
  onPublish(settings: SocialPublishSettings): Promise<void>;
}) {
  const { l } = props;
  const confirm = useConfirmDialog();
  const [platforms, setPlatforms] = useState<SocialPublishPlatform[]>(
    props.ratio === '9:16' ? ['tiktok', 'instagram', 'youtube'] : ['youtube', 'linkedin']
  );
  const [title, setTitle] = useState(props.defaultTitle.slice(0, socialPublishTitleMaxLength));
  const [description, setDescription] = useState(props.defaultDescription);
  const [youtubePrivacy, setYoutubePrivacy] = useState<SocialPublishYoutubePrivacy>('private');
  const [tiktokPrivacy, setTiktokPrivacy] = useState<SocialPublishTiktokPrivacy>('account-default');
  const [aiGenerated, setAiGenerated] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [copyEdited, setCopyEdited] = useState(false);

  // Follow the script-derived copy (it loads after mount) until the user edits it.
  useEffect(() => {
    if (copyEdited) return;
    setTitle(props.defaultTitle.slice(0, socialPublishTitleMaxLength));
    setDescription(props.defaultDescription);
  }, [copyEdited, props.defaultTitle, props.defaultDescription]);

  const stage = [...props.stages].reverse().find(item => item.stageId === 'social-publish');
  const running = stage?.status === 'queued' || stage?.status === 'running';
  const result = latestResult(props.artifacts, props.deliveryManifestArtifactId);

  if (props.configuration === 'loading') return null;

  if (props.configuration !== 'configured') {
    return (
      <section className="stickman-delivery-files stickman-social-publish" aria-label={l('发布到社交平台', 'Publish to social platforms')}>
        <header><h3>{l('发布到社交平台', 'Publish to social platforms')}</h3></header>
        <p className="stickman-social-publish-hint">
          {props.configuration === 'unavailable'
            ? l('暂时无法读取发布服务配置，请检查 Runtime 后重试。', 'Could not read the publishing settings. Check the Runtime and retry.')
            : l(
                '连接 Upload-Post 后，可直接把成片发布到 TikTok、Instagram、YouTube 等平台。',
                'Connect Upload-Post to publish this video to TikTok, Instagram, YouTube, and more.'
              )}
        </p>
        {props.configuration === 'missing' ? (
          <a className="video-translation-secondary-action" href="#/settings?tab=ai-services&section=publishing">
            {l('配置发布服务', 'Set up publishing')}
          </a>
        ) : null}
      </section>
    );
  }

  const blockers = props.delivery === undefined ? [] : deliveryBlockers(props.delivery, l);
  if (blockers.length > 0) {
    return (
      <section className="stickman-delivery-files stickman-social-publish" aria-label={l('发布到社交平台', 'Publish to social platforms')}>
        <header><h3>{l('发布到社交平台', 'Publish to social platforms')}</h3></header>
        <p className="stickman-social-publish-error" role="status">
          <CircleAlert size={14} />
          {l('这份成片还不能发布：', 'This delivery cannot be published yet:')}
        </p>
        <ul className="stickman-social-publish-blockers">
          {blockers.map(blocker => <li key={blocker}>{blocker}</li>)}
        </ul>
        <p className="stickman-social-publish-hint">
          {l('解决上述检查并重新生成成片后即可发布。', 'Resolve these checks and regenerate the delivery to publish it.')}
        </p>
      </section>
    );
  }

  const canPublish = props.deliveryManifestArtifactId !== undefined
    && props.delivery !== undefined
    && platforms.length > 0
    && title.trim().length > 0
    && !running
    && !submitting;

  async function publish() {
    if (!canPublish) return;
    const names = platforms.map(platform => platformLabels[platform]).join(', ');
    const confirmed = await confirm({
      title: l('确认发布', 'Confirm publishing'),
      description: l(
        `将把当前成片发布到：${names}。发布后需要在各平台手动删除。`,
        `This publishes the current video to: ${names}. To remove it later, delete it on each platform.`
      ),
      confirmLabel: l('发布', 'Publish'),
      cancelLabel: l('取消', 'Cancel')
    });
    if (!confirmed) return;
    setSubmitting(true);
    try {
      await props.onPublish({
        platforms,
        title: title.trim(),
        description,
        youtubePrivacy,
        tiktokPrivacy,
        aiGenerated
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="stickman-delivery-files stickman-social-publish" aria-label={l('发布到社交平台', 'Publish to social platforms')}>
      <header>
        <h3>{l('发布到社交平台', 'Publish to social platforms')}</h3>
        <span>Upload-Post</span>
      </header>
      <fieldset className="stickman-social-publish-platforms" disabled={running || submitting}>
        <legend>{l('平台', 'Platforms')}</legend>
        {socialPublishPlatforms.map(platform => (
          <label key={platform}>
            <input
              type="checkbox"
              checked={platforms.includes(platform)}
              onChange={event => setPlatforms(current => event.target.checked
                ? [...current, platform]
                : current.filter(item => item !== platform))}
            />
            {platformLabels[platform]}
          </label>
        ))}
      </fieldset>
      <label className="stickman-social-publish-field">
        <span>{l('标题 / 文案', 'Title / caption')}</span>
        <input
          type="text"
          value={title}
          maxLength={socialPublishTitleMaxLength}
          disabled={running || submitting}
          onChange={event => { setCopyEdited(true); setTitle(event.target.value); }}
        />
      </label>
      <label className="stickman-social-publish-field">
        <span>{l('描述（YouTube、LinkedIn、Facebook）', 'Description (YouTube, LinkedIn, Facebook)')}</span>
        <textarea
          rows={3}
          value={description}
          disabled={running || submitting}
          onChange={event => { setCopyEdited(true); setDescription(event.target.value); }}
        />
      </label>
      <div className="stickman-social-publish-options">
        {platforms.includes('youtube') ? (
          <label className="stickman-social-publish-field">
            <span>{l('YouTube 可见性', 'YouTube visibility')}</span>
            <NativeSelect value={youtubePrivacy} disabled={running || submitting} onChange={event => setYoutubePrivacy(event.target.value as SocialPublishYoutubePrivacy)}>
              <option value="private">{l('私密', 'Private')}</option>
              <option value="unlisted">{l('不公开', 'Unlisted')}</option>
              <option value="public">{l('公开', 'Public')}</option>
            </NativeSelect>
          </label>
        ) : null}
        {platforms.includes('tiktok') ? (
          <label className="stickman-social-publish-field">
            <span>{l('TikTok 可见性', 'TikTok visibility')}</span>
            <NativeSelect value={tiktokPrivacy} disabled={running || submitting} onChange={event => setTiktokPrivacy(event.target.value as SocialPublishTiktokPrivacy)}>
              <option value="account-default">{l('账号默认', 'Account default')}</option>
              <option value="PUBLIC_TO_EVERYONE">{l('所有人', 'Everyone')}</option>
              <option value="MUTUAL_FOLLOW_FRIENDS">{l('互关好友', 'Friends')}</option>
              <option value="FOLLOWER_OF_CREATOR">{l('粉丝', 'Followers')}</option>
              <option value="SELF_ONLY">{l('仅自己', 'Only me')}</option>
            </NativeSelect>
          </label>
        ) : null}
        <label className="stickman-social-publish-check">
          <input type="checkbox" checked={aiGenerated} disabled={running || submitting} onChange={event => setAiGenerated(event.target.checked)} />
          {l('标注为 AI 生成内容', 'Label as AI-generated content')}
        </label>
      </div>
      <footer className="stickman-social-publish-actions">
        <button className="video-translation-primary-action" type="button" disabled={!canPublish} onClick={() => void publish()}>
          {running || submitting
            ? <LoaderCircle className="creator-collaboration-spin" size={16} />
            : <Send size={16} />}
          {running
            ? publishProgress(stage, l)
            : l('发布…', 'Publish…')}
        </button>
      </footer>
      {stage?.status === 'failed' && stage.errorMessage ? (
        <p className="stickman-social-publish-error" role="alert">
          <CircleAlert size={14} />{stage.errorMessage}
        </p>
      ) : null}
      {result !== undefined ? <PublishResults results={result.results} status={result.status} l={l} /> : null}
    </section>
  );
}

function PublishResults(props: {
  results: SocialPublishPlatformResult[];
  status: string;
  l: ReturnType<typeof useLocalizedCopy>;
}) {
  const { l } = props;
  return (
    <div className="creator-result-files stickman-social-publish-results" aria-label={l('发布结果', 'Publishing results')}>
      {props.status === 'submitted' ? (
        <p className="stickman-social-publish-hint">
          {l('Upload-Post 已接收，平台仍在处理中；结果可在 Upload-Post 控制台查看。', 'Upload-Post accepted the video and the platforms are still processing it; check the Upload-Post dashboard for the outcome.')}
        </p>
      ) : null}
      {props.results.map(result => (
        <article key={result.platform} data-status={result.status}>
          <span>{result.status === 'completed' ? <Check size={15} /> : result.status === 'failed' ? <X size={15} /> : <CircleAlert size={15} />}</span>
          <div>
            <strong>{platformLabels[result.platform as SocialPublishPlatform] ?? result.platform}</strong>
            <small>{resultDetail(result, l)}</small>
          </div>
          {result.url ? (
            <a href={result.url} target="_blank" rel="noreferrer" title={l('打开', 'Open')} aria-label={`${l('打开', 'Open')} ${result.platform}`}>
              <ExternalLink size={15} />
            </a>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function deliveryBlockers(
  delivery: SocialPublishDeliveryState,
  l: ReturnType<typeof useLocalizedCopy>
): string[] {
  const blockers: string[] = [];
  if (delivery.packageStatus !== 'publishable') {
    blockers.push(l('成片仍是技术草稿', 'The delivery is still a technical draft'));
  }
  if (delivery.placeholderAssets.length > 0) {
    const assets = delivery.placeholderAssets.join(', ');
    blockers.push(l(`仍有占位素材：${assets}`, `Placeholder assets remain: ${assets}`));
  }
  if (delivery.blockingChecks.length > 0) {
    const checks = delivery.blockingChecks.join(', ');
    blockers.push(l(`未通过的发布检查：${checks}`, `Unresolved publishing checks: ${checks}`));
  }
  return blockers;
}

function resultDetail(result: SocialPublishPlatformResult, l: ReturnType<typeof useLocalizedCopy>): string {
  if (result.inbox) return l('已发送到 TikTok 草稿箱，请在 App 中发布', 'Sent to TikTok drafts; publish it from the app');
  if (result.status === 'skipped') return l('该 Profile 未连接此平台', 'Not connected on this profile');
  if (result.status === 'completed') return result.url ?? result.note ?? l('已发布', 'Published');
  if (result.status === 'retryable') return l(`将自动重试：${result.error ?? ''}`, `Will retry automatically: ${result.error ?? ''}`);
  if (result.status === 'failed') return result.error ?? l('发布失败', 'Publishing failed');
  return l('处理中', 'Processing');
}

function publishProgress(stage: CreatorStageRun | undefined, l: ReturnType<typeof useLocalizedCopy>): string {
  const completed = typeof stage?.progress.completed === 'number' ? stage.progress.completed : 0;
  const total = typeof stage?.progress.total === 'number' ? stage.progress.total : 0;
  return total > 0
    ? l(`发布中 ${completed}/${total}`, `Publishing ${completed}/${total}`)
    : l('上传中', 'Uploading');
}

function latestResult(
  artifacts: CreatorArtifact[],
  deliveryManifestArtifactId?: string
): { status: string; results: SocialPublishPlatformResult[] } | undefined {
  const artifact = [...artifacts].reverse().find(item => (
    item.kind === 'social_publish_result'
    && item.status === 'completed'
    && item.metadata.deliveryManifestArtifactId === deliveryManifestArtifactId
  ));
  if (artifact === undefined || !Array.isArray(artifact.metadata.results)) return undefined;
  return {
    status: typeof artifact.metadata.publishStatus === 'string' ? artifact.metadata.publishStatus : 'completed',
    results: artifact.metadata.results as unknown as SocialPublishPlatformResult[]
  };
}
