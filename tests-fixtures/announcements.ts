/**
 * What a screen reader would hear while a test runs (A11Y-002), as close as a
 * DOM can tell: every line the announcer says, plus the text of any other live
 * region that is inserted or changes. Counting the second kind is deliberately
 * generous: a status region that mounts with its text may or may not be read,
 * and a test of restraint should fail either way.
 */
import { announcerStore } from '@/stores/announcer';

const LIVE = '[aria-live],[role="status"],[role="alert"],[role="log"],output';

/** A live region other than the announcer's own, which the store reports. */
function regionOf(node: Node | null): Element | null {
  const el = node instanceof Element ? node : (node?.parentElement ?? null);
  const region = el?.closest(LIVE) ?? null;
  return region === null || region.closest('[data-announcer]') !== null ? null : region;
}

export interface AnnouncementListener {
  /** Everything heard so far, in order. */
  readonly heard: string[];
  /** Waits for pending DOM changes to be counted, then stops listening. */
  stop(): void;
}

export function listenForAnnouncements(root: Node = document.body): AnnouncementListener {
  const heard: string[] = [];
  const unsubscribe = announcerStore.subscribe((state, prev) => {
    const known = new Set(prev.messages.map((m) => m.id));
    for (const m of state.messages) if (!known.has(m.id)) heard.push(m.text);
  });
  const collect = (records: MutationRecord[]) => {
    const regions = new Set<Element>();
    for (const record of records) {
      const changed = regionOf(record.target);
      if (changed !== null) regions.add(changed);
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue;
        const own = regionOf(node);
        if (own !== null) regions.add(own);
        for (const inner of node.querySelectorAll(LIVE)) {
          const nested = regionOf(inner);
          if (nested !== null) regions.add(nested);
        }
      }
    }
    for (const region of regions) {
      const text = region.textContent?.trim() ?? '';
      if (text !== '') heard.push(text);
    }
  };
  const observer = new MutationObserver(collect);
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  return {
    heard,
    stop() {
      collect(observer.takeRecords());
      observer.disconnect();
      unsubscribe();
    },
  };
}
