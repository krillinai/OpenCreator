import type { ReactNode } from 'react';

export function WorkbenchLayout(props: {
  sidebar: ReactNode;
  main: ReactNode;
  detail?: ReactNode;
  detailOpen?: boolean;
  sidebarCollapsed?: boolean;
}) {
  const shellClassName = [
    'clawee-shell',
    props.detailOpen ? 'has-detail' : undefined,
    props.sidebarCollapsed ? 'sidebar-collapsed' : undefined
  ].filter(Boolean).join(' ');

  return (
    <main className={shellClassName}>
      <aside
        className="clawee-sidebar-pane"
        aria-label="Clawee 导航"
        data-collapsed={props.sidebarCollapsed ? 'true' : 'false'}
      >
        {props.sidebar}
      </aside>
      <section className="clawee-main-pane" aria-label="Clawee 工作区">
        {props.main}
      </section>
      {props.detailOpen ? (
        <aside className="clawee-detail-pane" aria-label="详情">
          {props.detail}
        </aside>
      ) : null}
    </main>
  );
}
