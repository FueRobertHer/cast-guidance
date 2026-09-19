// @vitest-environment jsdom
// The refresh flag against the real registry module (TEST-002/003). Its whole
// job is telling "not in the data" from "not in the data yet", so what matters
// is not its value in isolation but which frames a consumer commits: a single
// render reporting nothing in flight while the hook still holds the previous
// registry is the false answer, and it renders as "Nothing here yet".
import 'fake-indexeddb/auto';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./loader', () => ({
  getActiveTag: () => 'tag1',
  ensurePack: vi.fn().mockResolvedValue(undefined),
  ensureTypePacks: vi.fn().mockResolvedValue(undefined),
  repairTypePacks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./search/client', () => ({
  ensureSearchIndex: vi.fn().mockResolvedValue(undefined),
  onSearchIndexLost: () => () => undefined,
}));

import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { dataStatusStore } from '@/stores/dataStatus';
import { useRegistryRefreshing, useRegistryState } from './hooks';
import { invalidateRegistry } from './registry';

const putFile = (path: string, json: unknown) =>
  dataCacheRepo.putFile({
    key: dataCacheRepo.key('tag1', path),
    tag: 'tag1',
    path,
    pack: 'essentials',
    json,
    bytes: 0,
    fetchedAt: 1,
  });

/** Stable per-registry labels, so a frame says which build it was holding. */
function labeller() {
  const seen = new WeakMap<object, number>();
  let next = 0;
  return (reg: object | null) => {
    if (reg === null) return 'none';
    const had = seen.get(reg);
    if (had !== undefined) return `reg${had}`;
    seen.set(reg, ++next);
    return `reg${next}`;
  };
}

/** Every frame a page reading both the registry and the flag commits. */
function renderLibraryShapedConsumer() {
  const label = labeller();
  const frames: string[] = [];
  const view = renderHook(() => {
    const reg = useRegistryState();
    const refreshing = useRegistryRefreshing();
    frames.push(`${refreshing}|${label(reg.registry)}`);
    return reg;
  });
  return { frames, ...view };
}

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  invalidateRegistry();
});

afterEach(() => {
  cleanup();
  dataStatusStore.setState({ packs: {}, filesDone: 0, filesTotal: 0, phase: 'idle' });
});

describe('the refresh flag across a rebuild', () => {
  it('never reports settled while the consumer still holds the older registry', async () => {
    await putFile('feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] });
    const { frames, result } = renderLibraryShapedConsumer();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const before = frames.length;

    // One file lands, exactly as the background drain delivers them.
    await putFile('backgrounds.json', { background: [{ name: 'Sage', source: 'PHB' }] });
    dataStatusStore.getState().fileDone();
    await new Promise((r) => setTimeout(r, 50));

    const rebuild = frames.slice(before);
    // The flag has to come back down together with the registry it was raised
    // for. Released a microtask earlier (in `getRegistry`'s own `finally`,
    // before the awaiting hook's `setRegistry`) this read `false|reg1` here,
    // one committed frame calling the section empty right after its files
    // arrived.
    const raised = rebuild.indexOf('true|reg1');
    expect(raised).toBeGreaterThanOrEqual(0);
    expect(rebuild.slice(raised)).not.toContain('false|reg1');

    // And it does settle, on the newer registry.
    expect(rebuild[rebuild.length - 1]).toBe('false|reg2');
  });

  it('costs a page that does not read it fewer frames than one that does', async () => {
    // The regression this split exists for, measured end to end: the flag used
    // to be state inside the shared registry hook, so a page that never looked
    // at it still committed the frame where it moved, once per file landing.
    // Each shape is measured alone, because a second consumer mounted
    // alongside holds the flag up across the first one's render and changes
    // what either commits.
    // Two fixed hook orders rather than one conditional call: a page either
    // reads the flag or it does not, and that is the whole comparison.
    const plainPage = () => useRegistryState();
    const libraryPage = () => {
      const reg = useRegistryState();
      useRegistryRefreshing();
      return reg;
    };

    const framesForOneFileLanding = async (page: typeof plainPage, file: string) => {
      let renders = 0;
      const view = renderHook(() => {
        renders++;
        return page();
      });
      await waitFor(() => expect(view.result.current.status).toBe('ready'));

      const before = renders;
      await putFile(file, { background: [{ name: 'Sage', source: 'PHB' }] });
      dataStatusStore.getState().fileDone();
      await new Promise((r) => setTimeout(r, 50));
      view.unmount();
      return renders - before;
    };

    await putFile('feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] });
    const plain = await framesForOneFileLanding(plainPage, 'backgrounds.json');
    const library = await framesForOneFileLanding(libraryPage, 'races.json');

    // Both see the registry arrive; only the library pays for the flag moving.
    expect(plain).toBeGreaterThan(0);
    expect(plain).toBeLessThan(library);
  });

  it('comes back down when the consumer unmounts mid-rebuild', async () => {
    await putFile('feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] });
    const { result, unmount } = renderLibraryShapedConsumer();
    await waitFor(() => expect(result.current.status).toBe('ready'));

    await putFile('backgrounds.json', { background: [{ name: 'Sage', source: 'PHB' }] });
    dataStatusStore.getState().fileDone();
    // Mid-read: the hook will never apply what it is holding open.
    unmount();
    await new Promise((r) => setTimeout(r, 50));

    const { frames, result: second } = renderLibraryShapedConsumer();
    await waitFor(() => expect(second.current.status).toBe('ready'));
    expect(frames[frames.length - 1]?.startsWith('false|')).toBe(true);
  });
});
