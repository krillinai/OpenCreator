import type { CreatorJob } from '@opencreator/protocol';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '../../i18n/LanguageProvider.js';
import DigitalAvatarWorkspace from './DigitalAvatarWorkspace.js';
import { CreatorSessionProvider } from './creator-session-store.js';

describe('DigitalAvatarWorkspace', () => {
  const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');

  afterEach(() => {
    if (originalCreateObjectUrl === undefined) {
      delete (URL as unknown as Record<string, unknown>).createObjectURL;
    } else {
      Object.defineProperty(URL, 'createObjectURL', originalCreateObjectUrl);
    }
  });

  it('keeps file validation local without creating a creator issue', () => {
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('上传人物照片'), {
      target: { files: [new File(['bad'], 'avatar.gif', { type: 'image/gif' })] }
    });

    expect(screen.getByRole('alert')).toHaveTextContent('请上传 10MB 以内的 JPG、PNG 或 WebP 图片');
    expect(screen.queryByText(/诊断编号：OC-/)).not.toBeInTheDocument();
  });

  it('routes a browser preview failure to the shared Agent panel', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => { throw new Error('raw object URL failure'); })
    });
    renderWorkspace();

    fireEvent.change(screen.getByLabelText('上传人物照片'), {
      target: { files: [new File(['image'], 'avatar.png', { type: 'image/png' })] }
    });

    expect(await screen.findByText(/人物照片预览失败，请重新选择图片。/)).toBeInTheDocument();
    expect(screen.queryByText(/诊断编号：OC-/)).not.toBeInTheDocument();
    expect(screen.queryByText('raw object URL failure')).not.toBeInTheDocument();
  });
});

function renderWorkspace() {
  return render(
    <LanguageProvider initialPreference="zh-CN">
      <CreatorSessionProvider
        initialJob={job()}
        service={{ applyAction: vi.fn(), runAgentTurn: vi.fn() } as never}
      >
        <DigitalAvatarWorkspace onBack={vi.fn()} />
      </CreatorSessionProvider>
    </LanguageProvider>
  );
}

function job(): CreatorJob {
  return {
    id: 'digital_avatar_job',
    projectId: 'project_1',
    templateId: 'digital-avatar',
    templateVersion: 1,
    status: 'draft',
    revision: 0,
    presetOrigin: null,
    state: {},
    agentThreadId: null,
    stages: [],
    artifacts: [],
    providerRequests: [],
    activities: [],
    issues: [],
    createdAt: '2026-09-22T00:00:00.000Z',
    updatedAt: '2026-09-22T00:00:00.000Z'
  };
}
