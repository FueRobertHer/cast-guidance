import { useLayoutEffect, useState } from 'react';

/**
 * Measures a sticky bar and publishes its height on the root element as the
 * custom property `name` (for example `--sheet-header-h`), for as long as the
 * bar is mounted. Returns the callback ref to put on the bar.
 *
 * Two readers need it. A bar that sticks under another one sits at its
 * height instead of behind it (the build page's Undo under the sheet header).
 * And the page's `scroll-padding-top` in app.css adds the heights up
 * (A11Y-003): Shift+Tab scrolls a control just into view at the top, which
 * was behind the bars, entirely hidden in landscape. Measured, because a
 * bar's contents vary (the class line under the name can be empty).
 */
export function useStickyHeight(name: `--${string}`): (el: HTMLElement | null) => void {
  // A callback ref: the sheet header only mounts once the character has loaded.
  const [el, ref] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (el === null) return;
    const root = document.documentElement.style;
    const measure = () => root.setProperty(name, `${el.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.removeProperty(name);
    };
  }, [el, name]);
  return ref;
}
