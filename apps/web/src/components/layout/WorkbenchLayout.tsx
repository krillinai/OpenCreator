import type { ReactNode } from 'react';

export function WorkbenchLayout(props: {
  sidebar: ReactNode;
  main: ReactNode;
  detail?: ReactNode;
  detailOpen?: boolean;
}) {
  const shellClassName = props.detailOpen ? 'clawee-shell has-detail' : 'clawee-shell';

  return (
    <main className={shellClassName}>
      <aside className="clawee-sidebar-pane" aria-label="Clawee 导航">
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
