import { defaultRangeExtractor, type Range, useWindowVirtualizer } from '@tanstack/react-virtual';
import {
  type FocusEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface VirtualListProps<T> {
  items: readonly T[];
  /**
   * A row's height in px before it is measured, read once when the list
   * mounts. It should be the rendered height exactly: going back to the list
   * restores the window's scroll offset onto rows that have only been
   * estimated, so a row a pixel off puts the reader rows away from where
   * they left by row 500.
   */
  estimateSize: () => number;
  /** Each item's identity, so a filter change never reuses a row for another item. */
  getKey: (item: T) => string;
  /** The id of the element that names the list (the page's heading). */
  labelledBy: string;
  renderRow: (item: T, index: number) => ReactNode;
}

/**
 * The rows rendered around a focused one: the row and its neighbours, so
 * Tab and Shift+Tab from it still reach the next and previous rows by DOM
 * order once the rest of the window has scrolled far away.
 */
function pinned(range: Range, focused: number | null): number[] {
  const rows = defaultRangeExtractor(range);
  if (focused === null) return rows;
  // A focused row can be stale (the list shrank under it); an index past the
  // end has no measurement, and would crash the list.
  for (const i of [focused - 1, focused, focused + 1]) {
    if (i >= 0 && i < range.count) rows.push(i);
  }
  return [...new Set(rows)].sort((a, b) => a - b);
}

/**
 * A list of 1000+ rows (spells, items) that renders only the rows near the
 * window's scroll position, with an overscan of 10.
 *
 * It scrolls with the window, not in a box of its own: `ScrollRestoration`
 * restores the window on Back, the mobile address bar only collapses when
 * the document scrolls, and in landscape or at large text a bounded box
 * would leave a row or two on screen. The html scroll padding then keeps a
 * focused row clear of the bottom tab bar, as anywhere else on the page.
 *
 * A screen reader still hears the whole list: each row says its position
 * and the list's length (`aria-posinset`, `aria-setsize`). A focused row
 * stays rendered while the window scrolls away from it, so focus is never
 * dropped onto the page.
 */
export function VirtualList<T>({
  items,
  estimateSize,
  getKey,
  labelledBy,
  renderRow,
}: VirtualListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const [rowHeight] = useState(estimateSize);
  const [scrollMargin, setScrollMargin] = useState(0);

  // Where the list starts in the document. Anything above it can move it:
  // the section's problem panel, the "Downloading" line, a banner above the
  // page, or a text size change. Measured on mount and when the items
  // change, on resize, and whenever an ancestor resizes: the page, which
  // grows with anything added above a long list and shrinks when a banner
  // pushes in above a short one, and the app shell, which grows by the
  // banner over a long one. (Over a list shorter than the screen, every row
  // is rendered anyway.) `body` and `html` are a fixed 100% tall, so they
  // never report. A stale margin only shifts which rows are rendered, not
  // where they are drawn, and the overscan covers a banner's height.
  const margin = useRef(0);
  const measure = useCallback(() => {
    const el = listRef.current;
    if (el === null) return;
    const next = el.getBoundingClientRect().top + window.scrollY;
    // State only on a real change, checked here rather than left to React's
    // bail-out on an equal value: it can never be what keeps the list
    // rendering.
    if (next === margin.current) return;
    margin.current = next;
    setScrollMargin(next);
  }, []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of items is what can move the list, not something it reads
  useLayoutEffect(measure, [measure, items]);
  useLayoutEffect(() => {
    const el = listRef.current;
    window.addEventListener('resize', measure);
    if (el === null || typeof ResizeObserver === 'undefined') {
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    for (let at = el.parentElement; at !== null && at !== document.body; at = at.parentElement) {
      ro.observe(at);
    }
    return () => {
      window.removeEventListener('resize', measure);
      ro.disconnect();
    };
  }, [measure]);

  // The focused row, by key: a filter or a data refresh can move it to
  // another index, or take it out, while it has focus.
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  // Each row's key. Data can list one entry twice (a homebrew file repeating
  // an official name and source), and a repeated key would make React reuse
  // one row for both, so a repeat gets its occurrence appended.
  const keys = useMemo(() => {
    const seen = new Map<string, number>();
    return items.map((item) => {
      const key = getKey(item);
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      return n === 0 ? key : `${key}#${n}`;
    });
  }, [items, getKey]);
  const focused = useMemo(() => {
    const at = focusedKey === null ? -1 : keys.indexOf(focusedKey);
    return at < 0 ? null : at;
  }, [keys, focusedKey]);
  const rangeExtractor = useCallback((range: Range) => pinned(range, focused), [focused]);
  // A focused row taken out of the list (a filter, a data refresh) loses
  // focus with no blur event, since Chrome fires none for a removed node, so
  // its pin is let go once its key is no longer in the list. Otherwise the
  // entry coming back would be pinned with nothing focused.
  useEffect(() => {
    if (focusedKey !== null && focused === null) setFocusedKey(null);
  }, [focused, focusedKey]);

  // Stable while the items are, since the virtualizer re-lays out every row
  // when it changes.
  const getItemKey = useCallback((index: number) => keys[index] ?? index, [keys]);

  const virtualizer = useWindowVirtualizer({
    count: items.length,
    estimateSize: () => rowHeight,
    getItemKey,
    rangeExtractor,
    overscan: 10,
    scrollMargin,
    // Rows are measured from a ref callback, inside React's commit, where a
    // synchronous flush is not allowed.
    useFlushSync: false,
  });

  // No rows until the list has mounted. Working out which rows to render
  // reads the window's scroll offset, and the virtualizer keeps that first
  // reading and scrolls the window to it as it mounts. In the first render
  // that is the offset before `ScrollRestoration` has put back the one Back
  // returns to, so Back from a spell landed at the top of the list. After
  // mount it reads the restored offset (or, if the restore comes later,
  // follows its scroll event). Mounting re-renders before the browser paints,
  // so no frame is drawn without rows.
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => setMounted(true), []);

  const onFocus = (e: FocusEvent<HTMLUListElement>) => {
    const row = e.target.closest<HTMLElement>('[data-index]');
    setFocusedKey(row === null ? null : (keys[Number(row.dataset.index)] ?? null));
  };
  const onBlur = (e: FocusEvent<HTMLUListElement>) => {
    // The window losing focus (another app, another tab) blurs the row too,
    // but leaves it the active element, and it must survive a scroll while
    // the window is in the background. Focus moving to another row is
    // handled by that row's focus event.
    if (e.relatedTarget === null && !document.hasFocus()) return;
    if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
    setFocusedKey(null);
  };

  const count = items.length;
  return (
    <ul
      ref={listRef}
      data-virtual-list
      // Said explicitly: Safari drops the list role of a list styled without
      // markers. An empty list is announced as nothing at all rather than as
      // a list of none, and naming it would bring its role back.
      role={count > 0 ? 'list' : 'none'}
      aria-labelledby={count > 0 ? labelledBy : undefined}
      onFocus={onFocus}
      onBlur={onBlur}
      className="relative w-full shrink-0"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {(mounted ? virtualizer.getVirtualItems() : []).map((row) => (
        <li
          key={row.key}
          aria-setsize={count}
          aria-posinset={row.index + 1}
          data-index={row.index}
          ref={virtualizer.measureElement}
          className="absolute inset-x-0 top-0"
          style={{ transform: `translateY(${row.start - scrollMargin}px)` }}
        >
          {renderRow(items[row.index] as T, row.index)}
        </li>
      ))}
    </ul>
  );
}
