import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import { BookOpenText, Images } from 'lucide-react';
import {
  SharedDrivePage,
  type SharedDrivePageProps
} from '../drive/SharedDrivePage.js';
import {
  KnowledgePage,
  type KnowledgePageProps
} from '../knowledge/KnowledgePage.js';
import { useLocalizedCopy } from '../../i18n/useLocalizedCopy.js';
import './assets.css';

export type AssetsTab = 'knowledge' | 'materials';

export type AssetsPageProps = {
  activeTab?: AssetsTab;
  knowledge: KnowledgePageProps;
  materials: SharedDrivePageProps;
  onTabChange?(tab: AssetsTab): void;
};

export default function AssetsPage(props: AssetsPageProps) {
  const l = useLocalizedCopy();
  const activeTab = props.activeTab ?? 'knowledge';

  function handleTabKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const nextTab: AssetsTab = activeTab === 'knowledge' ? 'materials' : 'knowledge';
    props.onTabChange?.(nextTab);
    const tabList = event.currentTarget.closest('[role="tablist"]');
    const nextButton = tabList?.querySelector<HTMLButtonElement>(`#assets-tab-${nextTab}`);
    window.requestAnimationFrame(() => nextButton?.focus());
  }

  return (
    <section className="assets-page" aria-label={l('我的资产', 'My Assets')}>
      <header className="assets-header">
        <div className="assets-tabs" role="tablist" aria-label={l('资产分类', 'Asset categories')}>
          <button
            id="assets-tab-knowledge"
            type="button"
            role="tab"
            aria-controls="assets-panel-knowledge"
            aria-selected={activeTab === 'knowledge'}
            tabIndex={activeTab === 'knowledge' ? 0 : -1}
            onClick={() => props.onTabChange?.('knowledge')}
            onKeyDown={handleTabKeyDown}
          >
            <BookOpenText size={16} aria-hidden="true" />
            {l('知识库', 'Knowledge')}
          </button>
          <button
            id="assets-tab-materials"
            type="button"
            role="tab"
            aria-controls="assets-panel-materials"
            aria-selected={activeTab === 'materials'}
            tabIndex={activeTab === 'materials' ? 0 : -1}
            onClick={() => props.onTabChange?.('materials')}
            onKeyDown={handleTabKeyDown}
          >
            <Images size={16} aria-hidden="true" />
            {l('素材中心', 'Media Library')}
          </button>
        </div>
      </header>
      <div
        className="assets-panel"
        id={`assets-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`assets-tab-${activeTab}`}
      >
        {activeTab === 'knowledge' ? (
          <KnowledgePage {...props.knowledge} />
        ) : (
          <SharedDrivePage {...props.materials} />
        )}
      </div>
    </section>
  );
}
