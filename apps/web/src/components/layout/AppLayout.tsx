import { Menu, X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';

export function AppLayout(props: {
  sidebar: ReactNode;
  mainHeader?: ReactNode;
  main: ReactNode;
  detail?: ReactNode;
  detailOpen?: boolean;
  immersive?: boolean;
  sidebarCollapsed?: boolean;
  mobileSidebarOpen?: boolean;
  onOpenMobileSidebar?(): void;
  onCloseMobileSidebar?(): void;
}) {
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const onCloseMobileSidebarRef = useRef(props.onCloseMobileSidebar);
  const mobileSidebarOpen = props.mobileSidebarOpen === true;
  const shellClassName = [
    'opencreator-shell',
    props.detailOpen ? 'has-detail' : undefined,
    props.sidebarCollapsed ? 'sidebar-collapsed' : undefined,
    props.immersive ? 'is-immersive' : undefined
  ].filter(Boolean).join(' ');

  useEffect(() => {
    onCloseMobileSidebarRef.current = props.onCloseMobileSidebar;
  }, [props.onCloseMobileSidebar]);

  useEffect(() => {
    if (!mobileSidebarOpen) return;

    getFocusableElements(sidebarRef.current)[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseMobileSidebarRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = getFocusableElements(sidebarRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      window.setTimeout(() => mobileTriggerRef.current?.focus(), 0);
    };
  }, [mobileSidebarOpen]);

  return (
    <main className={shellClassName}>
      {mobileSidebarOpen ? (
        <button
          aria-label="关闭导航遮罩"
          className="mobile-navigation-backdrop"
          onClick={props.onCloseMobileSidebar}
          type="button"
        />
      ) : null}
      {props.immersive ? null : <aside
        className="opencreator-sidebar-pane"
        aria-label="OpenCreator 导航"
        data-collapsed={props.sidebarCollapsed ? 'true' : 'false'}
        data-mobile-open={mobileSidebarOpen ? 'true' : 'false'}
        ref={sidebarRef}
      >
        <button
          aria-label="关闭导航"
          className="mobile-navigation-close"
          onClick={props.onCloseMobileSidebar}
          title="关闭导航"
          type="button"
        >
          <X aria-hidden="true" size={18} />
        </button>
        {props.sidebar}
      </aside>}
      <section
        className="opencreator-main-pane"
        aria-label="OpenCreator 工作区"
        data-has-main-header={props.mainHeader === undefined ? undefined : 'true'}
      >
        {props.mainHeader === undefined ? null : (
          <div className="opencreator-main-titlebar">{props.mainHeader}</div>
        )}
        {props.immersive ? null : <div className="mobile-navigation-toolbar">
          <button
            aria-expanded={mobileSidebarOpen}
            aria-label="打开导航"
            className="mobile-navigation-trigger"
            onClick={props.onOpenMobileSidebar}
            ref={mobileTriggerRef}
            title="打开导航"
            type="button"
          >
            <Menu aria-hidden="true" size={20} />
          </button>
        </div>}
        <div className="opencreator-main-content">{props.main}</div>
      </section>
      {props.detailOpen ? (
        <aside className="opencreator-detail-pane" aria-label="详情">
          {props.detail}
        </aside>
      ) : null}
    </main>
  );
}

function getFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (root === null) return [];
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  ).filter(element => !element.hasAttribute('disabled'));
}
