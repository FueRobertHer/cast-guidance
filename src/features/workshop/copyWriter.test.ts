import { describe, expect, it } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type DataEntity, type EngineContext, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import {
  basedOnKey,
  changeCount,
  copiedFrom,
  diffEntries,
  fingerprint,
  missingOriginal,
  originalChanged,
  readStored,
  resolveStored,
  writeEntry,
} from './copyWriter';

type Json = Record<string, unknown>;

// Shaped like the 2024 Alert: a lead line, then two named benefits.
const alert = (): Json => ({
  name: 'Alert',
  source: 'XPHB',
  page: 200,
  category: 'O',
  srd52: true,
  entries: [
    'You gain the following benefits.',
    { type: 'entries', name: 'Initiative Proficiency', entries: ['Add your bonus.'] },
    { type: 'entries', name: 'Initiative Swap', entries: ['Swap with an ally.'] },
  ],
});

const copyOf = (original: Json, edit: (d: Json) => void = () => {}): Json => {
  const d = structuredClone(original);
  edit(d);
  return d;
};

/** The fields an editor shows, without what the data keeps about the book. */
const shown = (e: Json) => {
  const { page: _p, srd52: _s, _copy: _c, castGuidance: _g, source: _src, ...rest } = e;
  return rest;
};

describe('writeEntry: a new entry', () => {
  it('writes its fields, its name and the player book, and guidance only when it has effects', () => {
    const plain = writeEntry({
      draft: { name: ' Lucky Charm ', category: 'G', entries: ['Hold it.'] },
      source: 'MyHomebrew',
      mode: 'changes',
    });
    expect(plain).toEqual({
      name: 'Lucky Charm',
      source: 'MyHomebrew',
      category: 'G',
      entries: ['Hold it.'],
    });
    const effects = [{ kind: 'acBonus', amount: 1 }];
    expect(
      writeEntry({
        draft: { name: 'Ward', castGuidance: { v: 1, effects }, entries: [] },
        source: 'MyHomebrew',
        mode: 'changes',
      }).castGuidance,
    ).toEqual({ v: 1, effects });
  });
});

describe('writeEntry: a copy saved as its changes', () => {
  it('stores no book text it did not change, and points at the original', () => {
    const out = writeEntry({
      original: alert(),
      draft: copyOf(alert()),
      source: 'MyHomebrew',
      mode: 'changes',
    });
    expect(out).toEqual({
      name: 'Alert',
      source: 'MyHomebrew',
      _copy: { name: 'Alert', source: 'XPHB' },
      castGuidance: { v: 1, basedOn: 'Alert|XPHB', basedOnFingerprint: fingerprint(alert()) },
    });
  });

  it('writes a changed field, and null for one taken out', () => {
    const out = writeEntry({
      original: alert(),
      draft: copyOf(alert(), (d) => {
        d.name = 'Watchful';
        d.repeatable = true;
        delete d.category;
      }),
      source: 'MyHomebrew',
      mode: 'changes',
    });
    expect(out).toMatchObject({ name: 'Watchful', repeatable: true, category: null });
    expect(out).not.toHaveProperty('entries');
  });

  it('names parts by name and paragraphs by their text, never by position', () => {
    const draft = copyOf(alert(), (d) => {
      const entries = d.entries as unknown[];
      entries[0] = 'You gain these benefits.';
      (entries[2] as Json).entries = ['Swap with anyone.'];
      entries.splice(1, 1);
      entries.push({ type: 'entries', name: 'Keen Ears', entries: ['You hear well.'] });
    });
    const out = writeEntry({ original: alert(), draft, source: 'MyHomebrew', mode: 'changes' });
    expect((out._copy as Json)._mod).toEqual({
      entries: [
        { mode: 'removeArr', names: ['Initiative Proficiency'] },
        {
          mode: 'replaceArr',
          replace: 'You gain the following benefits.',
          items: ['You gain these benefits.'],
        },
        {
          mode: 'replaceArr',
          replace: 'Initiative Swap',
          items: [{ type: 'entries', name: 'Initiative Swap', entries: ['Swap with anyone.'] }],
        },
        {
          mode: 'appendArr',
          items: [{ type: 'entries', name: 'Keen Ears', entries: ['You hear well.'] }],
        },
      ],
    });
    expect(shown(resolveStored(out, alert()))).toEqual(shown(draft));
  });

  it('saves a renamed part as that part replaced, by the name it had', () => {
    const draft = copyOf(alert(), (d) => {
      (d.entries as unknown[])[2] = {
        type: 'entries',
        name: 'Quick Swap',
        entries: ['Swap with an ally.'],
        castGuidance: { v: 1, basedOn: 'Initiative Swap|XPHB' },
      };
    });
    const out = writeEntry({ original: alert(), draft, source: 'MyHomebrew', mode: 'changes' });
    const ops = ((out._copy as Json)._mod as Json).entries as Json[];
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ mode: 'replaceArr', replace: 'Initiative Swap' });
    expect(shown(resolveStored(out, alert()))).toEqual(shown(draft));
  });

  it('writes the whole list where name-matched operations cannot say it', () => {
    const draft = copyOf(alert(), (d) => {
      (d.entries as unknown[]).splice(1, 0, {
        type: 'entries',
        name: 'Between',
        entries: ['In the middle.'],
      });
    });
    const out = writeEntry({ original: alert(), draft, source: 'MyHomebrew', mode: 'changes' });
    expect(out.entries).toEqual(draft.entries);
    expect((out._copy as Json)._mod).toBeUndefined();
    expect(shown(resolveStored(out, alert()))).toEqual(shown(draft));
  });

  it('points a copy of a copy at the official entry it stands for', () => {
    const watchful = {
      name: 'Watchful',
      source: 'HB',
      castGuidance: { v: 1, basedOn: 'Alert|PHB' },
    };
    expect(basedOnKey(watchful)).toBe('Alert|PHB');
    expect(basedOnKey(alert())).toBe('Alert|XPHB');
  });

  it('keeps the effects the player gave it', () => {
    const effects = [{ kind: 'initiativeBonus', amount: 1 }];
    const out = writeEntry({
      original: alert(),
      draft: copyOf(alert(), (d) => {
        d.castGuidance = { v: 1, effects, replace: true };
      }),
      source: 'MyHomebrew',
      mode: 'changes',
    });
    expect(out.castGuidance).toMatchObject({ v: 1, effects, replace: true, basedOn: 'Alert|XPHB' });
  });
});

describe('writeEntry: a full copy', () => {
  it('writes every field out, with the same pointer and no _copy', () => {
    const out = writeEntry({
      original: alert(),
      draft: copyOf(alert(), (d) => {
        d.name = 'Watchful';
      }),
      source: 'MyHomebrew',
      mode: 'full',
    });
    expect(out).toEqual({
      name: 'Watchful',
      source: 'MyHomebrew',
      category: 'O',
      entries: alert().entries,
      castGuidance: { v: 1, basedOn: 'Alert|XPHB', basedOnFingerprint: fingerprint(alert()) },
    });
  });

  it('keeps its pointer and mark when saved again without its original', () => {
    const first = writeEntry({
      original: alert(),
      draft: alert(),
      source: 'MyHomebrew',
      mode: 'full',
    });
    const again = writeEntry({ draft: first, source: 'MyHomebrew', mode: 'full' });
    expect(again.castGuidance).toEqual(first.castGuidance);
  });
});

describe('reading a stored copy back', () => {
  it('says what it copies, and whether as changes only', () => {
    const changes = writeEntry({
      original: alert(),
      draft: alert(),
      source: 'MyHomebrew',
      mode: 'changes',
    });
    const full = writeEntry({
      original: alert(),
      draft: alert(),
      source: 'MyHomebrew',
      mode: 'full',
    });
    expect(copiedFrom(changes)).toEqual({ name: 'Alert', source: 'XPHB', changesOnly: true });
    expect(copiedFrom(full)).toEqual({ name: 'Alert', source: 'XPHB', changesOnly: false });
    expect(copiedFrom({ name: 'Mine', source: 'MyHomebrew' })).toBeUndefined();
  });

  it('notices when the original changed since', () => {
    const stored = writeEntry({
      original: alert(),
      draft: alert(),
      source: 'MyHomebrew',
      mode: 'changes',
    });
    expect(originalChanged(stored, alert())).toBe(false);
    expect(originalChanged(stored, { ...alert(), category: 'G' })).toBe(true);
    // The page number is the book's, not the entry's.
    expect(originalChanged(stored, { ...alert(), page: 7 })).toBe(false);
  });

  it('says so in the words the brief gives when the original is missing', () => {
    expect(missingOriginal('Alert')).toBe('Based on Alert, which your data does not have.');
  });

  it('counts what Save would store', () => {
    expect(changeCount(alert(), alert())).toBe(0);
    const draft = copyOf(alert(), (d) => {
      d.name = 'Watchful';
      d.repeatable = true;
      (d.entries as unknown[]).splice(1, 1);
    });
    expect(changeCount(alert(), draft)).toBe(3);
    // Leaving the original's mechanics out is a change, as an effect is.
    const replaced = copyOf(alert(), (d) => {
      d.castGuidance = { v: 1, replace: true };
    });
    expect(changeCount(alert(), replaced)).toBe(1);
  });

  it('counts the changes that no longer fit a reworded original', () => {
    const draft = copyOf(alert(), (d) => {
      (d.entries as unknown[])[0] = 'You gain these benefits.';
    });
    const stored = writeEntry({ original: alert(), draft, source: 'MyHomebrew', mode: 'changes' });
    expect(readStored(stored, alert())).toEqual({ entry: expect.anything(), lost: 0 });
    const reworded = copyOf(alert(), (d) => {
      (d.entries as unknown[])[0] = 'You gain the benefits below.';
    });
    const { entry, lost } = readStored(stored, reworded);
    expect(lost).toBe(1);
    expect((entry.entries as unknown[])[0]).toBe('You gain the benefits below.');
  });

  it('says a copy of a 2024 entry is 2024 when the book alone said so, and does not count it', () => {
    const original = { ...alert(), bookEdition: 'one' };
    const draft = copyOf(original, (d) => {
      d.name = 'Watchful';
    });
    for (const mode of ['changes', 'full'] as const) {
      const out = writeEntry({ original, draft, source: 'MyHomebrew', mode });
      expect(out.edition).toBe('one');
      expect(out).not.toHaveProperty('bookEdition');
    }
    expect(changeCount(original, draft)).toBe(1);
    // An entry that says its edition itself keeps saying it, as any field.
    const said = { ...original, edition: 'classic' };
    expect(
      writeEntry({ original: said, draft: said, source: 'X', mode: 'changes' }),
    ).not.toHaveProperty('edition');
    expect(writeEntry({ draft: { name: 'New' }, source: 'X', mode: 'changes' })).not.toHaveProperty(
      'edition',
    );
  });

  it('prints the same mark whatever order the keys are in', () => {
    expect(fingerprint({ a: 1, b: [1, { c: 2, d: 3 }] })).toBe(
      fingerprint({ b: [1, { d: 3, c: 2 }], a: 1 }),
    );
  });
});

describe('diffEntries', () => {
  it('writes the whole list when the original repeats a part name', () => {
    const was = [
      { type: 'entries', name: 'Twice', entries: ['a'] },
      { type: 'entries', name: 'Twice', entries: ['b'] },
    ];
    expect(diffEntries(was, [was[0]])).toEqual({ whole: true });
  });

  it('writes the whole list when a paragraph is added or a list changes', () => {
    expect(diffEntries(['a'], ['a', 'b'])).toEqual({ whole: true });
    const list = { type: 'list', items: ['x'] };
    expect(diffEntries([list], [{ type: 'list', items: ['y'] }])).toEqual({ whole: true });
  });
});

// What the sheet reads from a saved copy: through the registry's own copy
// resolution, then the derive.
describe('a saved copy on the sheet', () => {
  const world = (extra: Record<string, DataEntity[]>): EngineContext => {
    const base = makeTestContext();
    return {
      get(type, name, source) {
        const hit = (extra[type] ?? []).find(
          (e) =>
            String(e.name).toLowerCase() === name.toLowerCase() &&
            (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
        );
        return hit ?? base.get(type, name, source);
      },
      byType: (type) => [...base.byType(type), ...(extra[type] ?? [])],
    };
  };
  const hero = (edit: (d: ReturnType<typeof newCharacterDoc>) => void) => {
    const d = newCharacterDoc('hero', 'Hero', 'test');
    d.abilities.base = { str: 10, dex: 14, con: 12, int: 10, wis: 10, cha: 10 };
    d.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 1, hp: ['avg'] }];
    edit(d);
    return d;
  };

  it("keeps the original's curated mechanics through basedOn, renamed and reworded", () => {
    const original = { name: 'Alert', source: 'PHB', entries: ['You are always on the lookout.'] };
    const stored = writeEntry({
      original,
      draft: { ...original, name: 'Watchful', entries: ['You never sleep.'] },
      source: 'MyHomebrew',
      mode: 'changes',
    });
    const copy = resolveStored(stored, original) as DataEntity;
    const sheet = deriveSheet(
      hero((d) => {
        d.feats = [{ ref: { name: 'Watchful', source: 'MyHomebrew' }, instanceId: 'f0' }];
      }),
      world({ feat: [original as DataEntity, copy] }),
    );
    expect(sheet.initiative.parts.find((p) => p.label === 'Watchful')?.amount).toBe(5);
  });

  it('reads a field the copy took out (null) as absent', () => {
    const original: Json = {
      name: 'Stonefolk',
      source: 'HB',
      size: ['M'],
      speed: 30,
      darkvision: 60,
      resist: ['poison'],
      entries: [],
    };
    const draft = copyOf(original, (d) => {
      delete d.darkvision;
      delete d.resist;
    });
    const stored = writeEntry({ original, draft, source: 'MyHomebrew', mode: 'changes' });
    expect(stored).toMatchObject({ darkvision: null, resist: null });
    const sheet = (race: Json) =>
      deriveSheet(
        hero((d) => {
          d.race = { name: String(race.name), source: String(race.source) };
        }),
        world({ race: [race as DataEntity] }),
      );
    const before = sheet(original);
    expect(before.senses.some((s) => s.sense === 'darkvision')).toBe(true);
    expect(before.resists.some((r) => r.damageType === 'poison')).toBe(true);
    const after = sheet(resolveStored(stored, original));
    expect(after.senses.some((s) => s.sense === 'darkvision')).toBe(false);
    expect(after.resists.some((r) => r.damageType === 'poison')).toBe(false);
  });
});
