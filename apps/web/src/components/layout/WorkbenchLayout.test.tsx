import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkbenchLayout } from './WorkbenchLayout.js';

describe('WorkbenchLayout', () => {
  it('renders four workbench regions', () => {
    render(
      <WorkbenchLayout
        sidebar={<div>左侧</div>}
        timeline={<div>中间</div>}
        rightPanel={<div>右侧</div>}
        fileTree={<div>最右</div>}
      />
    );

    expect(screen.getByLabelText('主导航和会话')).toBeInTheDocument();
    expect(screen.getByLabelText('Agent 对话')).toBeInTheDocument();
    expect(screen.getByLabelText('文件和运行详情')).toBeInTheDocument();
    expect(screen.getByLabelText('项目文件树')).toBeInTheDocument();
  });
});
