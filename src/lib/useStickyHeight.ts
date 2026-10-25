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
    let mine = '';
    const measure = () => {
      mine = `${el.offsetHeight}px`;
      root.setProperty(name, mine);
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      // One mounted bar per name is assumed (the sheet header, the build
      // bar). Should another have set the name since, with a different
      // height, its value is left alone.
      if (root.getPropertyValue(name) === mine) root.removeProperty(name);
    };
  }, [el, name]);
  return ref;
}
