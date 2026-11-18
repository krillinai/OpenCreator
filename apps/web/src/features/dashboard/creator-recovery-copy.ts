import { useAppLanguage } from '../../i18n/LanguageProvider.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

export function useCreatorRecoveryCopy() {
  const { language } = useAppLanguage();
  const l = useLocalizedCopy();
  const hasSpecificCopy = language === 'zh-CN' || language === 'en-US' || language === 'sv-SE';
  const failed = l('失败', 'Failed');
  return {
    analysisFailed: hasSpecificCopy ? l('视频解析失败', 'Video analysis failed', 'Videoanalysen misslyckades') : `${l('解析视频信息', 'Analyze video information')} · ${failed}`,
    downloadFailed: hasSpecificCopy ? l('视频下载失败', 'Video download failed', 'Videonedladdningen misslyckades') : `${l('视频下载', 'Video download')} · ${failed}`,
    retryStage: hasSpecificCopy ? l('重试当前阶段', 'Retry stage', 'Försök igen med steget') : l('重试', 'Retry'),
    checkProxy: hasSpecificCopy ? l('检查代理设置', 'Check proxy settings', 'Kontrollera proxyinställningar') : l('网络代理', 'Network proxy')
  };
}
