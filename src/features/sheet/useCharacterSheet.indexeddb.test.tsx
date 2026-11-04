// @vitest-environment jsdom
import 'fake-indexeddb/auto';
// A sheet's numbers come from more than the essentials every page waits for: a
// class file holds the hit die, proficiencies and features, and items.json holds
// most equipped gear. Deriving before those arrived drew a healthy-looking sheet
// with the wrong numbers (a Fighter on a d8), and a long rest or a heal could
// then save them. These run the real loader, registry and database; only the
// network is a stand-in, so what a held or failed download does here is what a
// fresh device importing a character sees.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { validMirror } from '../../../tests-fixtures/dataMirror';

const { fetchFile } = vi.hoisted(() => ({ fetchFile: vi.fn() }));
vi.mock('@/data5e/source', () => ({
  GithubTagSource: class {
    readonly tag: string;
    constructor(tag: string) {
      this.tag = tag;
    }
    fetchFile(path: string): Promise<unknown> {
      return fetchFile(this.tag, path) as Promise<unknown>;
    }
  },
}));

const CLASS_FILE = 'class/class-fighter.json';
const ITEMS_FILE = 'items.json';

const serve = validMirror({
  [CLASS_FILE]: { class: [{ name: 'Fighter', source: 'PHB', hd: { number: 1, faces: 10 } }] },
  [ITEMS_FILE]: { item: [{ name: 'Ring of Protection', source: 'DMG', bonusAc: '+1' }] },
});

/** A held request, answered when its release is called. */
function holdFile(held: string): { release: () => void } {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchFile.mockImplementation(async (tag: string, path: string) => {
    if (path === held) await gate;
    return serve(tag, path);
  });
  return { release };
}

/** Fails `failing`, the way an offline or broken mirror does. */
function failFile(failing: string): void {
  fetchFile.mockImplementation((tag: string, path: string) =>
    path === failing ? Promise.reject(new Error('Failed to fetch')) : serve(tag, path),
  );
}

/** A level 3 character saved on this device, not yet on any data but essentials. */
async function setUp(edit: (doc: ReturnType<typeof newCharacterDoc>) => void = () => undefined) {
  vi.resetModules();
  const [{ db }, { characterRepo }, { DATA_TAG }, loader, { flushLanded }, sheet, session] =
    await Promise.all([
      import('@/db/db'),
      import('@/db/characterRepo'),
      import('@/data5e/config'),
      import('@/data5e/loader'),
      import('@/data5e/landing'),
      import('./useCharacterSheet'),
      import('@/stores/characterSession'),
    ]);
  await Promise.all(db.tables.map((t) => t.clear()));
  await db.settings.put({ key: 'dataTag', value: DATA_TAG });
  const doc = newCharacterDoc('c1', 'Hero', DATA_TAG);
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 10, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Fighter', source: 'PHB' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  edit(doc);
  await characterRepo.put(doc);
  await loader.ensurePack('essentials');
  flushLanded();
  return { db, sheetHook: sheet.useCharacterSheet, session: session.characterSessionStore };
}

/** The d10 maximum at level 3, with a +0 CON: 10 + 6 + 6. */
const FIGHTER_MAX_HP = 22;

beforeEach(() => {
  fetchFile.mockReset();
  fetchFile.mockImplementation(serve);
  // The update check asks GitHub for releases; an empty list is no update.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('[]'))),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a sheet whose class file has not arrived', () => {
  it('draws no numbers until it has, then draws the right ones', async () => {
    const held = holdFile(CLASS_FILE);
    const { sheetHook } = await setUp();

    const { result } = renderHook(() => sheetHook('c1'));
    await waitFor(() => expect(result.current.doc).not.toBeNull());
    await waitFor(() => expect(fetchFile).toHaveBeenCalledWith(expect.anything(), CLASS_FILE));

    expect(result.current.sheet).toBeNull();
    expect(result.current.data.status).toBe('loading');

    await act(async () => held.release());
    await waitFor(() => expect(result.current.sheet).not.toBeNull());
    expect(result.current.sheet?.maxHp.value).toBe(FIGHTER_MAX_HP);
    expect(result.current.data.status).toBe('ready');
  });

  it('does not write a current HP worked out from a guessed hit die', async () => {
    const held = holdFile(CLASS_FILE);
    const { sheetHook, session } = await setUp((doc) => {
      doc.play.hpInitialized = false;
      doc.play.currentHp = 1;
    });

    const { result } = renderHook(() => sheetHook('c1'));
    await waitFor(() => expect(result.current.doc).not.toBeNull());
    await waitFor(() => expect(fetchFile).toHaveBeenCalledWith(expect.anything(), CLASS_FILE));
    expect(session.getState().doc?.play.currentHp).toBe(1);

    await act(async () => held.release());
    await waitFor(() => expect(session.getState().doc?.play.currentHp).toBe(FIGHTER_MAX_HP));
  });

  it('says the data is missing when it cannot arrive, and Retry brings it', async () => {
    failFile(CLASS_FILE);
    const { sheetHook } = await setUp();

    const { result } = renderHook(() => sheetHook('c1'));
    await waitFor(() => expect(result.current.data.status).toBe('error'));
    expect(result.current.data.error).toContain('Failed to fetch');
    expect(result.current.sheet).toBeNull();

    fetchFile.mockImplementation(serve);
    act(() => result.current.data.retry());
    await waitFor(() => expect(result.current.sheet?.maxHp.value).toBe(FIGHTER_MAX_HP));
    expect(result.current.data.status).toBe('ready');
  });

  it('finds a class that is not named after its file', async () => {
    fetchFile.mockImplementation(
      validMirror({
        'class/index.json': { Sidekick: 'class-sidekick.json' },
        'class/class-sidekick.json': {
          class: [{ name: 'Expert Sidekick', source: 'PHB', hd: { number: 1, faces: 8 } }],
        },
      }),
    );
    const { sheetHook } = await setUp((doc) => {
      doc.classes = [{ ref: { name: 'Expert Sidekick', source: 'PHB' }, levels: 1, hp: ['avg'] }];
    });

    const { result } = renderHook(() => sheetHook('c1'));
    await waitFor(() => expect(result.current.sheet).not.toBeNull());
    expect(fetchFile).toHaveBeenCalledWith(expect.anything(), 'class/class-sidekick.json');
  });

  it('still derives a class no file holds, with the warning that says so', async () => {
    const { sheetHook } = await setUp((doc) => {
      doc.classes = [{ ref: { name: 'Gone', source: 'HB' }, levels: 1, hp: ['avg'] }];
    });

    const { result } = renderHook(() => sheetHook('c1'));
    await waitFor(() => expect(result.current.sheet).not.toBeNull());
    expect(result.current.sheet?.warnings).toContain('Class not found: gone|hb');
    expect(result.current.data.status).toBe('ready');
  });
});

describe('a sheet whose equipped gear has not arrived', () => {
  const wearing = (doc: ReturnType<typeof newCharacterDoc>) => {
    doc.equipment = [
      {
        id: 'ring',
        ref: { name: 'Ring of Protection', source: 'DMG' },
        qty: 1,
        equipped: true,
        attuned: true,
      },
    ];
  };

  /** Only the class is here yet, so the gear is all that can be missing. */
  const classOnDevice = async (setup: Awaited<ReturnType<typeof setUp>>) => {
    const loader = await import('@/data5e/loader');
    await loader.ensurePack('class:fighter');
    (await import('@/data5e/landing')).flushLanded();
    return setup;
  };

  it('waits for it, so AC does not read one short and then jump', async () => {
    const held = holdFile(ITEMS_FILE);
    const { sheetHook } = await classOnDevice(await setUp(wearing));

    const { result } = renderHook(() => sheetHook('c1'));
    await waitFor(() => expect(result.current.doc).not.toBeNull());
    await waitFor(() => expect(fetchFile).toHaveBeenCalledWith(expect.anything(), ITEMS_FILE));
    expect(result.current.sheet).toBeNull();

    await act(async () => held.release());
    await waitFor(() => expect(result.current.sheet).not.toBeNull());
    expect(result.current.data.equipment).toBeUndefined();
    // 10 + 1 DEX, and the ring's +1.
    expect(result.current.sheet?.ac.value).toBe(12);
  });

  it('keeps the sheet if it cannot arrive, and says what is left out', async () => {
    failFile(ITEMS_FILE);
    const { sheetHook } = await classOnDevice(await setUp(wearing));

    const { result } = renderHook(() => sheetHook('c1'));
    await waitFor(() => expect(result.current.sheet).not.toBeNull());
    expect(result.current.data.status).toBe('ready');
    expect(result.current.data.equipment?.status).toBe('error');
    expect(result.current.sheet?.maxHp.value).toBe(FIGHTER_MAX_HP);

    fetchFile.mockImplementation(serve);
    act(() => result.current.data.equipment?.retry());
    await waitFor(() => expect(result.current.sheet?.ac.value).toBe(12));
    expect(result.current.data.equipment).toBeUndefined();
  });

  it('does not wait on gear nobody is using', async () => {
    const held = holdFile(ITEMS_FILE);
    const { sheetHook } = await classOnDevice(
      await setUp((doc) => {
        wearing(doc);
        const [ring] = doc.equipment;
        if (ring !== undefined) ring.equipped = false;
      }),
    );

    const { result } = renderHook(() => sheetHook('c1'));
    await waitFor(() => expect(result.current.sheet).not.toBeNull());
    expect(fetchFile).not.toHaveBeenCalledWith(expect.anything(), ITEMS_FILE);
    held.release();
  });
});
