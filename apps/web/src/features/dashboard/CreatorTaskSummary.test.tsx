import { render, screen } from '@testing-library/react';
import type { CreatorJob } from '@opencreator/protocol';
import { FileVideo } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import CreatorTaskSummary from './CreatorTaskSummary.js';
import { CreatorSessionProvider } from './creator-session-store.js';

describe('CreatorTaskSummary', () => {
  it('shows the preset origin shared by every Creator workspace', () => {
    const createdAt = '2026-09-08T00:00:00.000Z';
    const job: CreatorJob = {
      id: 'creator_job_preset_summary',
      projectId: 'project_1',
      templateId: 'video-translation',
      templateVersion: 2,
      status: 'draft',
      revision: 0,
      presetOrigin: {
        module: 'video-translation',
        id: 'bilibili-bilingual',
        version: 1,
        locale: 'zh-CN',
        title: 'B站双语精翻',
        contentHash: 'a'.repeat(64)
      },
      state: {},
      agentThreadId: null,
      stages: [],
      artifacts: [],
      activities: [],
      createdAt,
      updatedAt: createdAt
    };

    render(
      <LanguageProvider initialPreference="zh-CN">
        <CreatorSessionProvider
          initialJob={job}
          service={{
            applyAction: vi.fn(),
            runAgentTurn: vi.fn()
          } as never}
        >
          <CreatorTaskSummary
            sourceIcon={FileVideo}
            sourceLabel="源视频"
            sourceValue="demo.mp4"
            items={[]}
          />
        </CreatorSessionProvider>
      </LanguageProvider>
    );

    expect(screen.getByText('模板来源')).toBeInTheDocument();
    expect(screen.getByText('B站双语精翻')).toBeInTheDocument();
  });
});
