// A collection's switch for one character (ADR-002 D3; E2, E4), read as the
// pickers read it. After a tap, every source of every row this device uses
// reads as tapped, and the character's switches for other sources are as
// they were. The cases are the ones the page's first rule got wrong: a file
// of two sources with one hidden, a book hidden by the choice of books, a
// character's own list, a switch already on one source, and Changes to the
// books under a narrow choice.
import { describe, expect, it } from 'vitest';
import {
  characterSourceSwitches,
  pickPolicy,
  policyAllows,
  type SourcePolicy,
} from '@/data5e/sourceFilter';
import type { HomebrewFileMeta } from '@/db/homebrewRepo';
import { deviceOn, type Picker, reachesRow, reachesSource, switchedTo } from './collectionSwitches';

const row = (id: string, over: Partial<HomebrewFileMeta> = {}): HomebrewFileMeta => ({
  id,
  fileName: `${id}.json`,
  enabled: true,
  editable: false,
  sourceIds: [id.toUpperCase()],
  counts: { feat: 1 },
  addedAt: 0,
  ...over,
});

const ALL: SourcePolicy = { mode: 'all', except: [] };
const HIDES_FCB: SourcePolicy = { mode: 'all', except: ['FCB'] };

interface Case {
  name: string;
  who: Picker;
  rows: HomebrewFileMeta[];
  device: SourcePolicy;
}

const CASES: Case[] = [
  {
    name: 'a file of two sources, one hidden here',
    who: {},
    rows: [row('two', { sourceIds: ['FCA', 'FCB'] })],
    device: HIDES_FCB,
  },
  {
    name: 'a file of two sources, a switch already on the hidden one',
    who: { sourceSwitches: { on: ['FCB'] } },
    rows: [row('two', { sourceIds: ['FCA', 'FCB'] })],
    device: HIDES_FCB,
  },
  {
    name: 'a file of two sources, a switch already off one',
    who: { sourceSwitches: { off: ['FCA'] } },
    rows: [row('two', { sourceIds: ['FCA', 'FCB'] })],
    device: ALL,
  },
  {
    name: 'a compendium with a book hidden by the choice of books',
    who: {},
    rows: [
      row('fca', { book: 'Ember Codex', fileName: 'all.xml' }),
      row('fcb', { book: 'Frost Codex', fileName: 'all.xml' }),
    ],
    device: HIDES_FCB,
  },
  {
    name: 'a character whose own list leaves the file out',
    who: { allowedSources: ['TST'], sourceSwitches: { off: ['OTHER'], on: ['ELSE'] } },
    rows: [row('imp')],
    device: ALL,
  },
  {
    name: 'a file switched off on this device',
    who: {},
    rows: [row('imp', { enabled: false })],
    device: ALL,
  },
  {
    name: 'Changes to the books under a narrow choice of books',
    who: { allowedSources: ['TST'] },
    rows: [row('changes', { role: 'changes', editable: true, sourceIds: ['MyChanges'] })],
    device: { mode: 'only', sources: ['TST'] },
  },
];

const ours = (c: Case) => new Set(c.rows.flatMap((r) => r.sourceIds.map((s) => s.toLowerCase())));
const others = (c: Case, who: Picker) => {
  const { on, off } = characterSourceSwitches(who.sourceSwitches);
  const mine = ours(c);
  return {
    on: on.filter((s) => !mine.has(s.toLowerCase())),
    off: off.filter((s) => !mine.has(s.toLowerCase())),
  };
};
const tapped = (c: Case, on: boolean | 'device'): Picker => ({
  ...c.who,
  sourceSwitches: switchedTo(c.who, c.rows, c.device, on),
});
const inUse = (c: Case) => {
  const used = c.rows.filter((r) => deviceOn(r, c.device));
  return used.length > 0 ? used : c.rows[0]?.book === undefined ? c.rows.slice(0, 1) : c.rows;
};

describe('switchedTo', () => {
  for (const c of CASES) {
    it(`on, then off, reads as tapped: ${c.name}`, () => {
      const on = tapped(c, true);
      for (const r of inUse(c)) {
        for (const s of r.sourceIds)
          expect(reachesSource(on, r, s, c.device), `${r.id} ${s}`).toBe(true);
      }
      // A row this device does not use stays out: on is what the device uses.
      for (const r of c.rows.filter((x) => !inUse(c).includes(x))) {
        expect(reachesRow(on, r, c.device), r.id).toBe(false);
      }
      expect(others(c, on)).toEqual(others(c, c.who));

      const off = tapped({ ...c, who: on }, false);
      for (const r of c.rows) expect(reachesRow(off, r, c.device), r.id).toBe(false);
      expect(others(c, off)).toEqual(others(c, c.who));
    });

    it(`as the device leaves no switch of its own: ${c.name}`, () => {
      const device = tapped(c, 'device');
      const { on, off } = characterSourceSwitches(device.sourceSwitches);
      const mine = ours(c);
      expect([...on, ...off].filter((s) => mine.has(s.toLowerCase()))).toEqual([]);
    });
  }

  it('reads an enabled file as the pickers read it, source by source', () => {
    const r = row('two', { sourceIds: ['FCA', 'FCB'] });
    const who = { allowedSources: ['FCA', 'TST'], sourceSwitches: { on: ['FCB'], off: ['FCA'] } };
    const { policy } = pickPolicy(HIDES_FCB, who.allowedSources, who.sourceSwitches);
    for (const s of r.sourceIds) {
      expect(reachesSource(who, r, s, HIDES_FCB)).toBe(policyAllows(policy, s));
    }
  });

  it('writes no switch a tap does not need', () => {
    const c = CASES[0];
    if (c === undefined) throw new Error('no case');
    // On the device's FCA already reaches; off needs only FCA, FCB being hidden.
    expect(switchedTo({}, c.rows, c.device, false)).toEqual({ off: ['FCA'] });
    expect(switchedTo({}, c.rows, c.device, true)).toEqual({ on: ['FCB'] });
    expect(
      switchedTo({ sourceSwitches: { off: ['FCA'] } }, c.rows, c.device, 'device'),
    ).toBeUndefined();
  });

  it('brings a copy switched off here in too, since copies share their sources (a known limit)', () => {
    const rows = [
      row('new', { sourceIds: ['IMP'] }),
      row('old', { sourceIds: ['IMP'], enabled: false }),
    ];
    const on = {
      allowedSources: ['TST'],
      sourceSwitches: switchedTo({ allowedSources: ['TST'] }, rows, ALL, true),
    };
    expect(on.sourceSwitches).toEqual({ on: ['IMP'] });
    // The newer copy was what was asked for; the older one comes with it.
    expect(rows.map((r) => reachesRow(on, r, ALL))).toEqual([true, true]);
  });
});
