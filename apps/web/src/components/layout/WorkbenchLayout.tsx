import type { ReactNode } from 'react';

export function WorkbenchLayout(props: {
  sidebar: ReactNode;
  timeline: ReactNode;
  rightPanel: ReactNode;
  fileTree: ReactNode;
}) {
  return (
    <main className="workbench-shell">
      <aside className="sidebar-pane" aria-label="主导航和会话">
        {props.sidebar}
      </aside>
      <section className="timeline-pane" aria-label="Agent 对话">
        {props.timeline}
      </section>
      <section className="right-pane" aria-label="文件和运行详情">
        {props.rightPanel}
      </section>
      <aside className="tree-pane" aria-label="项目文件树">
        {props.fileTree}
      </aside>
    </main>
  );
}
