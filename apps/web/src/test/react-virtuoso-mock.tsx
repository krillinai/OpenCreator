import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentType,
  type Key,
  type ReactNode,
  type UIEvent
} from 'react';

type MockVirtuosoProps = {
  atBottomStateChange?(atBottom: boolean): void;
  atTopStateChange?(atTop: boolean): void;
  className?: string;
  components?: {
    Footer?: ComponentType;
    Header?: ComponentType;
  };
  computeItemKey?(index: number, item: unknown): Key;
  data?: readonly unknown[];
  firstItemIndex?: number;
  itemContent?(index: number, item: unknown): ReactNode;
};

export const Virtuoso = forwardRef(function MockVirtuoso(
  props: MockVirtuosoProps,
  ref
) {
  const data = props.data ?? [];
  const firstVisibleIndex = Math.max(0, data.length - 30);
  const visibleData = data.slice(firstVisibleIndex);
  const [atBottom, setAtBottom] = useState(true);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const Header = props.components?.Header;
  const Footer = props.components?.Footer;

  useImperativeHandle(ref, () => ({
    scrollBy(location: ScrollToOptions) {
      const scroller = scrollerRef.current;
      if (scroller === null) return;
      scroller.scrollTop += location.top ?? 0;
    },
    scrollToIndex() {
      setAtBottom(true);
      props.atBottomStateChange?.(true);
    }
  }));

  useEffect(() => {
    props.atBottomStateChange?.(true);
  }, []);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const scroller = event.currentTarget;
    const nextAtBottom =
      scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 1;
    const nextAtTop = scroller.scrollTop <= 0;
    if (nextAtBottom !== atBottom) {
      setAtBottom(nextAtBottom);
      props.atBottomStateChange?.(nextAtBottom);
    }
    props.atTopStateChange?.(nextAtTop);
  }

  return (
    <div
      ref={scrollerRef}
      className={props.className}
      data-testid="virtuoso-scroller"
      onScroll={handleScroll}
    >
      {Header ? <Header /> : null}
      <div data-testid="virtuoso-item-list">
        {visibleData.map((item, visibleIndex) => {
          const dataIndex = firstVisibleIndex + visibleIndex;
          const logicalIndex = (props.firstItemIndex ?? 0) + dataIndex;
          return (
            <div
              key={props.computeItemKey?.(logicalIndex, item) ?? logicalIndex}
              data-item-index={logicalIndex}
            >
              {props.itemContent?.(logicalIndex, item)}
            </div>
          );
        })}
      </div>
      {Footer ? <Footer /> : null}
    </div>
  );
});
