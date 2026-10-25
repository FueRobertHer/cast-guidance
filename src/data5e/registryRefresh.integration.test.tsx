// @vitest-environment jsdom
// The refresh flag against the real registry module (TEST-002/003). Its whole
// job is telling "not in the data" from "not in the data yet", so what matters
// is not its value in isolation but which frames a consumer commits: a single
// render reporting nothing in flight while the hook still holds the previous
// registry is the false answer, and it renders as "Nothing here yet".
import 'fake-indexeddb/auto';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./loader', () => ({
  getActiveTag: () => 'tag1',
  ensurePack: vi.fn().mockResolvedValue(undefined),
  ensureTypePacks: vi.fn().mockResolvedValue(undefined),
  repairTypePacks: vi.fn().mockResolvedValue(undefined),
  noteRegistryBuilt: vi.fn().mockResolvedValue(undefined),
  noteRegistryBuildFailed: vi.fn().mockResolvedValue(false),
  noteRegistryBuildStarting: vi.fn().mockResolvedValue(false),
  whenTagReady: vi.fn().mockResolvedValue(undefined),
}));
// Landings are flushed by hand, never by the timer, so which frames a test
// sees does not depend on how fast the runner is.
vi.mock('./config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./config')>()),
  LANDING_FLUSH_MS: 60_000,
}));
vi.mock('./search/client', () => ({
  ensureSearchIndex: vi.fn().mockResolvedValue(undefined),
  onSearchIndexLost: () => () => undefined,
}));

import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { dataStatusStore } from '@/stores/dataStatus';
import { useRegistryRefreshing, useRegistryState } from './hooks';
import { flushLanded, noteFileLanded } from './landing';
import { invalidateRegistry, isRegistryRefreshing } from './registry';

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
  // Nothing left pending for the next test to inherit.
  flushLanded();
  vi.restoreAllMocks();
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
    act(() => {
      noteFileLanded();
      dataStatusStore.getState().fileDone();
    });
    // Up the moment the file is on disk, before anyone has been told to read
    // it: the registry in hand does not have it, and that is what the library
    // must not call final.
    expect(frames[frames.length - 1]).toBe('true|reg1');
    act(() => flushLanded());
    await waitFor(() => expect(frames[frames.length - 1]).toBe('false|reg2'));

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
      // Landed first and flushed later, as a drain does: the flag moves at the
      // landing, and only a page reading it renders for that.
      act(() => noteFileLanded());
      act(() => flushLanded());
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
    act(() => {
      noteFileLanded();
      flushLanded();
    });
    // Mid-read: the hook will never apply what it is holding open.
    unmount();
    await new Promise((r) => setTimeout(r, 50));

    const { frames, result: second } = renderLibraryShapedConsumer();
    await waitFor(() => expect(second.current.status).toBe('ready'));
    expect(frames[frames.length - 1]?.startsWith('false|')).toBe(true);
  });
});

/** Every frame a page reading both the registry and the flag commits, labelled by `label`. */
function framesOf(label: (reg: object | null) => string) {
  const frames: string[] = [];
  const view = renderHook(() => {
    const reg = useRegistryState();
    const refreshing = useRegistryRefreshing();
    frames.push(`${refreshing}|${label(reg.registry)}`);
    return reg;
  });
  return { frames, ...view };
}

describe('a download landing many files (DATA-003)', () => {
  it('rebuilds a bounded number of times however many files land', async () => {
    await putFile('feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] });
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    const rebuilds = vi.spyOn(dataCacheRepo, 'filesByTag');

    // Exactly as the drain delivers them: written, counted as landed, and
    // ticked on the progress counter, one task at a time.
    for (let i = 0; i < 50; i++) {
      await act(async () => {
        await putFile(`spells/spells-${i}.json`, { spell: [{ name: `Spell ${i}`, source: 'X' }] });
        noteFileLanded();
        dataStatusStore.getState().fileDone();
      });
    }
    act(() => flushLanded());
    await waitFor(() => expect(result.current.registry?.byType('spell').length ?? 0).toBe(50));

    // One rebuild for the flush. Per file, this was fifty.
    expect(rebuilds.mock.calls.length).toBeLessThanOrEqual(3);
    expect(result.current.registry?.byType('feat').map((f) => f.name)).toEqual(['Alert']);
  });

  it('builds once for every consumer a flush wakes', async () => {
    // Every page holding a registry hook reads on the same flush; each one
    // rebuilding the same registry from the same rows is that work times the
    // number of screens mounted.
    await putFile('feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] });
    const a = renderHook(() => useRegistryState());
    const b = renderHook(() => useRegistryState());
    await waitFor(() => expect(a.result.current.status).toBe('ready'));
    await waitFor(() => expect(b.result.current.status).toBe('ready'));
    const rebuilds = vi.spyOn(dataCacheRepo, 'filesByTag');

    await putFile('backgrounds.json', { background: [{ name: 'Sage', source: 'PHB' }] });
    act(() => {
      noteFileLanded();
      flushLanded();
    });
    await waitFor(() => expect(a.result.current.registry?.get('background', 'Sage')).toBeDefined());
    await waitFor(() => expect(b.result.current.registry?.get('background', 'Sage')).toBeDefined());

    expect(rebuilds).toHaveBeenCalledTimes(1);
    expect(a.result.current.registry).toBe(b.result.current.registry);
  });

  it('stays up over a page that has not been told yet when another one reads', async () => {
    // A page mounting between a landing and its flush reads the new file at
    // once. The page already mounted does not read again until the flush, so
    // it is still holding the registry without that file, and a flag lowered
    // by the newcomer's read tells it "Nothing here yet" about a section that
    // just arrived.
    await putFile('feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] });
    const label = labeller();
    const first = framesOf(label);
    await waitFor(() => expect(first.frames[first.frames.length - 1]).toBe('false|reg1'));

    await putFile('backgrounds.json', { background: [{ name: 'Sage', source: 'PHB' }] });
    act(() => noteFileLanded());
    const raised = first.frames.length - 1;
    expect(first.frames[raised]).toBe('true|reg1');

    const second = renderHook(() => useRegistryState());
    await waitFor(() =>
      expect(second.result.current.registry?.get('background', 'Sage')).toBeDefined(),
    );
    // Nothing is reading any more, and the flag is still up for the page
    // that has not caught up.
    expect(isRegistryRefreshing()).toBe(true);
    expect(first.frames.slice(raised)).not.toContain('false|reg1');

    act(() => flushLanded());
    await waitFor(() => expect(isRegistryRefreshing()).toBe(false));
    expect(first.frames.slice(raised)).not.toContain('false|reg1');
    expect(first.result.current.registry?.get('background', 'Sage')).toBeDefined();
  });

  it('comes down after a read that was not kept as current', async () => {
    // An invalidation during a rebuild keeps that build from being published,
    // but the consumer still got it, and it holds the landed file. Only a
    // published read lowering the flag left it up with nothing left to read.
    await putFile('feats.json', { feat: [{ name: 'Alert', source: 'PHB' }] });
    const { result } = renderHook(() => useRegistryState());
    await waitFor(() => expect(result.current.status).toBe('ready'));

    let release = (): void => undefined;
    const real = dataCacheRepo.filesByTag.bind(dataCacheRepo);
    const read = vi.spyOn(dataCacheRepo, 'filesByTag').mockImplementationOnce(async (tag) => {
      const rows = await real(tag);
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return rows;
    });
    await putFile('backgrounds.json', { background: [{ name: 'Sage', source: 'PHB' }] });
    act(() => {
      noteFileLanded();
      flushLanded();
    });
    await waitFor(() => expect(read).toHaveBeenCalled());
    invalidateRegistry();
    release();

    await waitFor(() => expect(result.current.registry?.get('background', 'Sage')).toBeDefined());
    await waitFor(() => expect(isRegistryRefreshing()).toBe(false));
  });
});
