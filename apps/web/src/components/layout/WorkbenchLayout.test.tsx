import { readFileSync } from 'node:fs';
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

  it('keeps region class names wired to workbench styles', () => {
    render(
      <WorkbenchLayout
        sidebar={<div>左侧</div>}
        timeline={<div>中间</div>}
        rightPanel={<div>右侧</div>}
        fileTree={<div>最右</div>}
      />
    );

    expect(screen.getByLabelText('主导航和会话')).toHaveClass('sidebar-pane');
    expect(screen.getByLabelText('Agent 对话')).toHaveClass('timeline-pane');
    expect(screen.getByLabelText('文件和运行详情')).toHaveClass('right-pane');
    expect(screen.getByLabelText('项目文件树')).toHaveClass('tree-pane');
  });

  it('defines responsive tracks for the workbench', () => {
    const css = readFileSync('src/styles/app.css', 'utf8');

    expect(css).toMatch(/\.workbench-shell\s*{[^}]*grid-template-columns:\s*260px minmax\(420px, 0\.92fr\) minmax\(520px, 1\.08fr\) 280px;/s);
    expect(css).toMatch(/@media\s*\(max-width:\s*1180px\)/);
    expect(css).not.toMatch(/body\s*{[^}]*min-width:\s*1280px;/s);
  });
});
