// @vitest-environment jsdom
// The library's long lists (A11Y-003, #114): the list must render only the
// rows near the window's scroll position, say each row's place in the whole
// list, and never unmount the row that has focus.
//
// jsdom lays nothing out, so the test supplies what the virtualizer reads:
// a row's height (`offsetHeight`, which is what it measures), where the
// list starts (its rect, which moves up as the window scrolls, as in a
// browser) and the window's scroll offset.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualList } from './VirtualList';

const ROW = 49;
/** Where the list starts in the document, below a header and a filter. */
let listTop = 100;

interface Item {
  id: string;
  name: string;
}
const make = (n: number, from = 0): Item[] =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${from + i}`, name: `Row ${from + i + 1}` }));
const ITEMS = make(1000);

function setScrollY(y: number) {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true, writable: true });
}

/** Whether this test scrolled, which leaves the virtualizer's scroll-end timer pending. */
let scrolled = false;

function scrollTo(y: number) {
  scrolled = true;
  act(() => {
    setScrollY(y);
    window.dispatchEvent(new Event('scroll'));
  });
}

function List({ items }: { items: readonly Item[] }) {
  return (
    <>
      <h1 id="heading">Spells</h1>
      <input aria-label="Filter" />
      <VirtualList
        items={items}
        estimateSize={() => ROW}
        getKey={(item) => item.id}
        labelledBy="heading"
        renderRow={(item) => <a href={`#${item.id}`}>{item.name}</a>}
      />
    </>
  );
}

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-virtual-list] > li')];
const positions = () => rows().map((r) => Number(r.getAttribute('aria-posinset')));
const link = (name: string) => screen.getByRole('link', { name, hidden: true });

beforeEach(() => {
  listTop = 100;
  setScrollY(0);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.hasAttribute('data-index') ? ROW : 0;
  });
  const rect = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (!this.hasAttribute('data-virtual-list')) return rect.call(this);
    const top = listTop - window.scrollY;
    return { top, bottom: top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top } as DOMRect;
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
});

afterEach(async () => {
  // It marks the end of a scroll 150 ms after the last scroll event, and
  // would otherwise fire after the last test, with jsdom already gone.
  if (scrolled) await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  scrolled = false;
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setScrollY(0);
});

describe('VirtualList', () => {
  it('renders only the rows near the top of 1,000', () => {
    render(<List items={ITEMS} />);
    // 768 px of window at 49 px a row is about 14 rows, plus the overscan.
    expect(rows().length).toBeGreaterThan(10);
    expect(rows().length).toBeLessThan(50);
    expect(link('Row 1')).toBeTruthy();
    expect(screen.queryByText('Row 200')).toBeNull();
  });

  it("says each row's place in the whole list", () => {
    render(<List items={ITEMS} />);
    rows().forEach((row, i) => {
      expect(row.getAttribute('aria-setsize')).toBe('1000');
      expect(row.getAttribute('aria-posinset')).toBe(String(i + 1));
    });
    expect(screen.getByRole('list', { name: 'Spells' })).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(rows().length);
  });

  it('renders the rows the window has scrolled to', () => {
    render(<List items={ITEMS} />);
    scrollTo(30_000);
    // (30000 - 100) / 49 is row 611, give or take the overscan.
    expect(positions()).toContain(613);
    expect(positions()).not.toContain(20);
    expect(positions().length).toBeLessThan(50);
  });

  it('starts the window at the list, not at the top of the page', () => {
    // A tall panel above the list puts it past the bottom of the window.
    listTop = 2000;
    render(<List items={ITEMS} />);
    // Nothing of the list is in view, so only the overscan is rendered,
    // not the 14 rows a window at the top of the list would hold.
    expect(rows().length).toBeLessThanOrEqual(11);
  });

  it('measures the list again when something above it changes size', () => {
    // The virtualizer has an observer of its own, for its rows.
    const observed = new Map<Element, () => void>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        readonly cb: (entries: ResizeObserverEntry[]) => void;
        constructor(cb: (entries: ResizeObserverEntry[]) => void) {
          this.cb = cb;
        }
        observe(el: Element) {
          observed.set(el, () => this.cb([]));
        }
        unobserve() {}
        disconnect() {}
      },
    );
    render(
      <div data-testid="shell">
        <main>
          <List items={ITEMS} />
        </main>
      </div>,
    );
    // The page and the shell around it: a banner pushes in above the page,
    // which grows the shell over a long list.
    const shell = screen.getByTestId('shell');
    expect(observed.has(screen.getByRole('main'))).toBe(true);
    expect(observed.has(shell)).toBe(true);
    const before = rows().length;
    listTop = 2000;
    act(() => observed.get(shell)?.());
    expect(rows().length).toBeLessThan(before);
  });

  it('does not measure where the list starts on every scroll', () => {
    render(<List items={ITEMS} />);
    const list = document.querySelector('[data-virtual-list]') as Element;
    const reads = () =>
      vi.mocked(Element.prototype.getBoundingClientRect).mock.contexts.filter((c) => c === list)
        .length;
    const before = reads();
    // Each of these renders new rows; none of them moves the list.
    for (const y of [5_000, 10_000, 30_000]) scrollTo(y);
    expect(reads()).toBe(before);
  });

  it('measures the list again when its items change', () => {
    const { rerender } = render(<List items={ITEMS} />);
    const before = rows().length;
    // A filter's "nothing matches" line or a section's problem panel comes
    // and goes with the items, above the list.
    listTop = 2000;
    rerender(<List items={make(1000)} />);
    expect(rows().length).toBeLessThan(before);
  });

  it('keeps a scroll offset restored as it mounts, as Back does', () => {
    // `ScrollRestoration` sits before the page in the app shell, so its
    // layout effect puts the window back before the list's run.
    function Restore() {
      useLayoutEffect(() => setScrollY(30_000), []);
      return null;
    }
    render(
      <>
        <Restore />
        <List items={ITEMS} />
      </>,
    );
    expect(window.scrollTo).not.toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    expect(positions()).toContain(613);
    expect(positions()).not.toContain(1);
  });

  it('renders an entry the data lists twice as two rows', () => {
    const error = vi.spyOn(console, 'error');
    const twice = { id: 'id-1', name: 'Twice' };
    const { rerender } = render(<List items={[twice, twice, ...make(3, 10)]} />);
    expect(positions()).toEqual([1, 2, 3, 4, 5]);
    // Dropping the first copy keeps every row showing its own item.
    rerender(<List items={[twice, ...make(3, 10)]} />);
    expect(rows().map((r) => r.textContent)).toEqual(['Twice', 'Row 11', 'Row 12', 'Row 13']);
    expect(error).not.toHaveBeenCalled();
  });

  it('is not a list while it is empty', () => {
    const { rerender } = render(<List items={[]} />);
    const list = document.querySelector('[data-virtual-list]') as HTMLElement;
    expect(list.getAttribute('role')).toBe('none');
    expect(list.hasAttribute('aria-labelledby')).toBe(false);
    expect(screen.queryByRole('list')).toBeNull();
    rerender(<List items={make(3)} />);
    expect(screen.getByRole('list', { name: 'Spells' })).toBe(list);
  });

  describe('the focused row', () => {
    it('stays rendered, with its neighbours, when the window scrolls away from it', () => {
      render(<List items={ITEMS} />);
      const row4 = link('Row 4');
      act(() => row4.focus());
      scrollTo(30_000);
      expect(positions()).toContain(613);
      expect(positions()).not.toContain(20);
      expect(link('Row 4')).toBe(row4);
      expect(document.activeElement).toBe(row4);
      // Its neighbours too, and in order, so Tab and Shift+Tab still move
      // to the next and previous rows rather than off into the window.
      expect(positions().slice(0, 3)).toEqual([3, 4, 5]);
      expect(positions()).toEqual([...positions()].sort((a, b) => a - b));
    });

    it('is followed by its item, not its index, when the list changes', () => {
      const { rerender } = render(<List items={ITEMS} />);
      const row4 = link('Row 4');
      act(() => row4.focus());
      // Twenty new rows ahead of it, as a homebrew file or a refresh adds.
      rerender(<List items={[...make(20, 5000), ...ITEMS]} />);
      // The same element, still showing the same item: rows are keyed by
      // item, so no row is reused for another.
      expect(document.activeElement).toBe(row4);
      expect(row4.textContent).toBe('Row 4');
      expect(row4.closest('li')?.getAttribute('aria-posinset')).toBe('24');
      scrollTo(30_000);
      expect(document.activeElement).toBe(row4);
      expect(positions().slice(0, 3)).toEqual([23, 24, 25]);
    });

    it('does not pin a row past the end of the list', () => {
      const { rerender } = render(<List items={make(5)} />);
      act(() => link('Row 5').focus());
      expect(positions()).toEqual([1, 2, 3, 4, 5]);
      // The focused row taken out, and the list shorter than where it was.
      rerender(<List items={make(2)} />);
      expect(positions()).toEqual([1, 2]);
    });

    it('stays rendered while the window is in the background', () => {
      render(<List items={ITEMS} />);
      const row4 = link('Row 4');
      act(() => row4.focus());
      // Switching apps blurs the row but leaves it the active element.
      vi.spyOn(document, 'hasFocus').mockReturnValue(false);
      fireEvent.blur(row4, { relatedTarget: null });
      scrollTo(30_000);
      expect(link('Row 4')).toBe(row4);
    });

    it('is let go once focus leaves the list', () => {
      render(<List items={ITEMS} />);
      act(() => link('Row 4').focus());
      act(() => screen.getByRole('textbox', { name: 'Filter' }).focus());
      scrollTo(30_000);
      expect(positions()).not.toContain(4);
    });

    it('is let go when its row is taken out, which fires no blur', () => {
      const { rerender } = render(<List items={ITEMS} />);
      act(() => link('Row 4').focus());
      // Filtered out while focused: the node goes, and focus with it, as
      // Chrome does it, without a blur event.
      rerender(<List items={ITEMS.filter((item) => item.id !== 'id-3')} />);
      expect(document.activeElement).toBe(document.body);
      // Back again, it is an ordinary row: nothing has focus to keep.
      rerender(<List items={ITEMS} />);
      scrollTo(30_000);
      expect(positions()).not.toContain(4);
    });
  });
});
