const SCROLLBAR_ACTIVE_CLASS = 'is-scrollbar-active';
const SCROLLBAR_HIDE_DELAY_MS = 650;

export function installAutoHidingScrollbars(): () => void {
  const hideTimers = new Map<Element, number>();

  function resolveScrollElement(target: EventTarget | null): Element | null {
    if (target instanceof Element) return target;
    if (target === document || target === window) {
      return document.scrollingElement ?? document.documentElement;
    }
    return null;
  }

  function handleScroll(event: Event) {
    const element = resolveScrollElement(event.target);
    if (element === null) return;

    element.classList.add(SCROLLBAR_ACTIVE_CLASS);
    const currentTimer = hideTimers.get(element);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);

    const hideTimer = window.setTimeout(() => {
      element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
      hideTimers.delete(element);
    }, SCROLLBAR_HIDE_DELAY_MS);
    hideTimers.set(element, hideTimer);
  }

  document.addEventListener('scroll', handleScroll, { capture: true, passive: true });
  window.addEventListener('scroll', handleScroll, { passive: true });

  return () => {
    document.removeEventListener('scroll', handleScroll, true);
    window.removeEventListener('scroll', handleScroll);
    hideTimers.forEach((timer, element) => {
      window.clearTimeout(timer);
      element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
    });
    hideTimers.clear();
  };
}
