import { ArrowRight, Sparkles, X } from 'lucide-react';
import { useState } from 'react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './ImageGenerationGuideBanner.css';

const dismissedStorageKey = 'opencreator.image-generation-guide.dismissed';

export default function ImageGenerationGuideBanner(props: { onUseSample(): void }) {
  const l = useLocalizedCopy();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(dismissedStorageKey) === '1';
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissedStorageKey, '1');
    } catch {}
  }

  return (
    <aside className="image-generation-guide-banner" aria-label={l('图像风格引导', 'Image style guide')}>
      <div className="image-generation-guide-copy">
        <span><Sparkles size={14} strokeWidth={1.8} aria-hidden="true" />{l('试试电影感画面', 'Try a cinematic look')}</span>
        <strong>{l('从一句话，到值得保存的视觉作品', 'Turn one sentence into an image worth keeping')}</strong>
        <p>{l('使用示例提示词，体验光影、构图与氛围的完整表达。', 'Use a sample prompt to explore lighting, composition, and atmosphere.')}</p>
        <button type="button" onClick={props.onUseSample}>
          {l('使用示例', 'Use example')}<ArrowRight size={14} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      <img src="/dashboard/templates/image-generation-cover.png" alt={l('电影感图像示例', 'Cinematic image example')} />
      <button type="button" className="image-generation-guide-dismiss" aria-label={l('关闭引导图', 'Dismiss guide')} title={l('关闭', 'Dismiss')} onClick={dismiss}>
        <X size={15} strokeWidth={1.8} aria-hidden="true" />
      </button>
    </aside>
  );
}
