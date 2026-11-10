import { Download } from 'lucide-react';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';

const sources = ['youtube', 'bilibili', 'tiktok', 'instagram', 'facebook', 'douyin'];

export default function DashboardVideoDownloadCover() {
  const l = useLocalizedCopy();
  return (
    <span className="dashboard-app-media dashboard-download-cover" aria-hidden="true">
      <span className="dashboard-download-cover-sources" aria-hidden="true">
        <span className="dashboard-download-cover-track">
          {[...sources, ...sources].map((source, index) => <span key={`${source}-${index}`}><img src={`/platforms/${source}.png`} alt="" /></span>)}
        </span>
      </span>
      <span className="dashboard-download-cover-value" aria-hidden="true">
        <span className="dashboard-download-cover-icon"><Download size={25} strokeWidth={2} /></span>
        <strong>{l('免费 · 无限下载', 'Free · Unlimited')}</strong>
      </span>
    </span>
  );
}
