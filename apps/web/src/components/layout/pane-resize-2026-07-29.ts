import type { MouseEvent as ReactMouseEvent } from 'react';

let activeResizeCleanup: (() => void) | undefined;

export function beginPaneResize(
  event: ReactMouseEvent<HTMLElement>,
  update: (clientX: number) => void
): void {
  if (event.button !== 0) return;

  event.preventDefault();
  activeResizeCleanup?.();

  const shield = document.createElement('div');
  shield.className = 'pane-resize-shield';
  shield.setAttribute('aria-hidden', 'true');
  document.body.append(shield);
  document.documentElement.classList.add('is-pane-resizing');

  const handleMouseMove = (moveEvent: MouseEvent) => {
    update(moveEvent.clientX);
  };
  const cleanup = () => {
    if (activeResizeCleanup !== cleanup) return;
    activeResizeCleanup = undefined;
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', cleanup);
    window.removeEventListener('blur', cleanup);
    shield.remove();
    document.documentElement.classList.remove('is-pane-resizing');
  };

  activeResizeCleanup = cleanup;
  window.addEventListener('mousemove', handleMouseMove);
  window.addEventListener('mouseup', cleanup);
  window.addEventListener('blur', cleanup);
  update(event.clientX);
}
