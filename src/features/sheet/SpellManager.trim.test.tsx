// @vitest-environment jsdom
// GAME-007: over-limit spell lists stay valid, so the sheet offers a "Trim to
// limit…" action beside the cue instead of trimming for the player. The
// confirm lists exactly what goes, and each class block trims only its own
// list. Kept apart from SpellManager.test.ts, which covers pure counting.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type CharacterDoc,
  type DerivedSheet,
  type EntityRef,
  newCharacterDoc,
  type SpellcastingBlock,
} from '@/engine/types';
import { SpellManager } from './SpellManager';

/** A tiny spell compendium: the trim reads spell levels from the registry. */
const SPELLS = [
  { name: 'Light', source: 'PHB', level: 0 },
  { name: 'Mage Hand', source: 'PHB', level: 0 },
  { name: 'Fire Bolt', source: 'PHB', level: 0 },
  { name: 'Shield', source: 'PHB', level: 1 },
  { name: 'Sleep', source: 'PHB', level: 1 },
  { name: 'Magic Missile', source: 'PHB', level: 1 },
  { name: 'Bless', source: 'PHB', level: 1 },
  { name: 'Cure Wounds', source: 'PHB', level: 1 },
];

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
  useRegistry: () => ({
    get: (_type: string, name: string, source?: string) =>
      SPELLS.find(
        (s) =>
          s.name.toLowerCase() === name.toLowerCase() &&
          (source === undefined || s.source.toLowerCase() === source.toLowerCase()),
      ),
    byType: () => SPELLS,
  }),
}));
vi.mock('@/data5e/spellLookup', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/spellLookup')>()),
  getSpellClassLookup: () => Promise.resolve({}),
}));
vi.mock('@/data5e/sourceFilter', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/data5e/sourceFilter')>();
  return { ...real, useSourcePolicy: () => real.ALLOW_ALL };
});

const dialogs = vi.hoisted(() => ({
  askConfirm: vi.fn<(req: { title: string; detail?: string }) => Promise<boolean>>(),
}));
vi.mock('@/ui/dialogs', () => ({
  askConfirm: dialogs.askConfirm,
  askChoice: () => Promise.resolve(null),
  askNumber: () => Promise.resolve(null),
  askText: () => Promise.resolve(null),
}));

afterEach(() => {
  cleanup();
  dialogs.askConfirm.mockReset();
});

const refs = (...names: string[]): EntityRef[] => names.map((name) => ({ name, source: 'PHB' }));

function block(
  over: Partial<SpellcastingBlock> & Pick<SpellcastingBlock, 'classUid' | 'className'>,
) {
  return {
    ability: 'int',
    mode: 'prepared',
    saveDc: { value: 13 },
    attackMod: { value: 5 },
    slots: [2],
    ...over,
  } as SpellcastingBlock;
}

type Granted = DerivedSheet['grantedSpells'];

/**
 * Render SpellManager over a doc held in state, so a trim re-renders the block
 * exactly as the sheet would. Returns a live doc getter and the update labels.
 */
function renderSpells(
  blocks: SpellcastingBlock[],
  spellcasting: CharacterDoc['spellcasting'],
  grantedSpells: Granted = [],
) {
  const start = newCharacterDoc('c1', 'Caster', 't');
  start.spellcasting = spellcasting;
  const sheet = {
    spellcasting: blocks,
    grantedSpells,
    totalLevel: 1,
    resources: [],
  } as unknown as DerivedSheet;
  const live = { doc: start, labels: [] as Array<string | undefined> };

  function Harness() {
    const [doc, setDoc] = useState(start);
    return (
      <SpellManager
        doc={doc}
        sheet={sheet}
        update={(recipe, label) => {
          const next = structuredClone(live.doc);
          recipe(next);
          live.doc = next;
          live.labels.push(typeof label === 'function' ? label(next) : label);
          setDoc(next);
        }}
      />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return live;
}

/** The section for one class's spells. */
const blockFor = (className: string) => {
  const section = screen
    .getByRole('heading', { name: new RegExp(`${className} spells`) })
    .closest('section');
  if (section === null) throw new Error(`no ${className} block`);
  return within(section);
};

const wizard = block({
  classUid: 'wizard|phb',
  className: 'Wizard',
  mode: 'spellbook',
  cantripsKnown: 3,
  preparedMax: 2,
});

describe('SpellManager "Trim to limit" (GAME-007)', () => {
  it('offers the trim only when the block is over a limit', () => {
    renderSpells([wizard], {
      'wizard|phb': { known: refs('Light', 'Shield', 'Sleep'), prepared: refs('Shield', 'Sleep') },
    });
    expect(screen.queryByRole('button', { name: /^Trim to limit/ })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    cleanup();

    renderSpells([wizard], {
      'wizard|phb': {
        known: refs('Shield', 'Sleep', 'Magic Missile'),
        prepared: refs('Shield', 'Sleep', 'Magic Missile'),
      },
    });
    const button = screen.getByRole('button', { name: /^Trim to limit/ });
    // A sibling of the live cue, so the cue's announcement never reads the button.
    expect(screen.getByRole('status').contains(button)).toBe(false);
  });

  it('lists exactly what goes, and Cancel changes nothing', async () => {
    dialogs.askConfirm.mockResolvedValueOnce(false);
    const spellcasting = {
      'wizard|phb': {
        known: refs('Light', 'Mage Hand', 'Fire Bolt', 'Shield', 'Sleep', 'Magic Missile', 'Bless'),
        prepared: refs('Shield', 'Sleep', 'Magic Missile', 'Bless'),
      },
    };
    const live = renderSpells([{ ...wizard, cantripsKnown: 2 }], structuredClone(spellcasting));
    fireEvent.click(screen.getByRole('button', { name: /^Trim to limit/ }));
    await waitFor(() => expect(dialogs.askConfirm).toHaveBeenCalledTimes(1));
    const req = dialogs.askConfirm.mock.calls[0]?.[0];
    expect(req?.title).toBe('Trim Wizard spells to your limits?');
    expect(req?.detail).toContain('Forget cantrip Fire Bolt');
    expect(req?.detail).toContain('Unprepare Bless, Magic Missile (still in your spellbook)');
    expect(req?.detail).toContain('Over-limit is allowed');
    expect(live.doc.spellcasting).toEqual(spellcasting);
    expect(live.labels).toEqual([]);
  });

  it('trims on confirm, keeps unprepared spells in the spellbook, and clears the cue', async () => {
    dialogs.askConfirm.mockResolvedValueOnce(true);
    const live = renderSpells([wizard], {
      'wizard|phb': {
        known: refs('Shield', 'Sleep', 'Magic Missile', 'Bless'),
        prepared: refs('Shield', 'Sleep', 'Magic Missile', 'Bless'),
      },
    });
    expect(screen.getByRole('status').textContent).toContain('2 over your prepared limit');
    fireEvent.click(screen.getByRole('button', { name: /^Trim to limit/ }));
    await waitFor(() => expect(live.labels).toEqual(['Trimmed Wizard spells to limit']));
    const sc = live.doc.spellcasting['wizard|phb'];
    expect(sc?.prepared).toEqual(refs('Shield', 'Sleep'));
    expect(sc?.known).toEqual(refs('Shield', 'Sleep', 'Magic Missile', 'Bless'));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Trim to limit/ })).toBeNull();
  });

  it('forgets over-limit known spells for a known caster', async () => {
    dialogs.askConfirm.mockResolvedValueOnce(true);
    const bard = block({
      classUid: 'bard|phb',
      className: 'Bard',
      mode: 'known',
      spellsKnownMax: 2,
    });
    const live = renderSpells([bard], {
      'bard|phb': { known: refs('Sleep', 'Bless', 'Cure Wounds'), prepared: [] },
    });
    expect(screen.getByRole('status').textContent).toContain('1 over your spells-known limit');
    fireEvent.click(screen.getByRole('button', { name: /^Trim to limit/ }));
    await waitFor(() => expect(live.labels).toHaveLength(1));
    expect(live.doc.spellcasting['bard|phb']?.known).toEqual(refs('Sleep', 'Bless'));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('unprepares a spell an always-prepared grant covers first, with one casting class', async () => {
    dialogs.askConfirm.mockResolvedValueOnce(true);
    const cleric = block({ classUid: 'cleric|phb', className: 'Cleric', preparedMax: 2 });
    const live = renderSpells(
      [cleric],
      {
        'cleric|phb': {
          known: refs('Bless', 'Sleep', 'Cure Wounds'),
          prepared: refs('Bless', 'Sleep', 'Cure Wounds'),
        },
      },
      // The grant names no source, so it matches by name.
      [{ name: 'Bless', source: '', usage: 'prepared', origin: 'Life Domain' }],
    );
    fireEvent.click(screen.getByRole('button', { name: /^Trim to limit/ }));
    await waitFor(() => expect(live.labels).toHaveLength(1));
    expect(dialogs.askConfirm.mock.calls[0]?.[0].detail).toContain(
      'Unprepare Bless (always prepared anyway)',
    );
    expect(live.doc.spellcasting['cleric|phb']?.prepared).toEqual(refs('Sleep', 'Cure Wounds'));
  });

  it("names each block's trim after its class, and lands focus on the heading after", async () => {
    dialogs.askConfirm.mockResolvedValueOnce(true);
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 0;
    });
    renderSpells([wizard], {
      'wizard|phb': {
        known: refs('Shield', 'Sleep', 'Magic Missile'),
        prepared: refs('Shield', 'Sleep', 'Magic Missile'),
      },
    });
    const button = screen.getByRole('button', { name: 'Trim to limit, Wizard spells' });
    button.focus();
    fireEvent.click(button);
    // The button leaves with the overage; focus goes to the class heading, not <body>.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Trim to limit/ })).toBeNull(),
    );
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Wizard spells/ }));
    raf.mockRestore();
  });

  it('trims one class block without touching the other', async () => {
    dialogs.askConfirm.mockResolvedValueOnce(true);
    const cleric = block({ classUid: 'cleric|phb', className: 'Cleric', preparedMax: 1 });
    // The Cleric also prepares Sleep, the spell the Wizard trim drops, so a trim
    // that reached past its own block would show here.
    const clericLists = {
      known: refs('Sleep', 'Cure Wounds'),
      prepared: refs('Sleep', 'Cure Wounds'),
    };
    const live = renderSpells(
      [wizard, cleric],
      {
        'wizard|phb': {
          known: refs('Bless', 'Shield', 'Sleep'),
          prepared: refs('Bless', 'Shield', 'Sleep'),
        },
        'cleric|phb': structuredClone(clericLists),
      },
      // With two casting classes a grant isn't tied to either, so it doesn't
      // jump the queue: the Wizard trim takes its most recent pick instead.
      [{ name: 'Bless', source: 'PHB', usage: 'prepared', origin: 'Blessed' }],
    );
    fireEvent.click(blockFor('Wizard').getByRole('button', { name: /^Trim to limit/ }));
    await waitFor(() => expect(live.labels).toEqual(['Trimmed Wizard spells to limit']));
    expect(live.doc.spellcasting['wizard|phb']?.prepared).toEqual(refs('Bless', 'Shield'));
    expect(live.doc.spellcasting['cleric|phb']).toEqual(clericLists);
    expect(blockFor('Wizard').queryByRole('status')).toBeNull();
    expect(blockFor('Cleric').getByRole('status').textContent).toContain(
      '1 over your prepared limit',
    );
    expect(blockFor('Cleric').getByRole('button', { name: /^Trim to limit/ })).toBeTruthy();
  });
});
