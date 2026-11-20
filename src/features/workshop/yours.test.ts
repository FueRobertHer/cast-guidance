// The Yours shelf's helpers for select mode (phase U8): a row's key, an
// export of the picked entries, and a source for a collection started on the
// move sheet.
import { describe, expect, it } from 'vitest';
import { COLLECTION_ID_KEY } from '@/db/homebrewOrder';
import type { HomebrewFile } from '@/db/homebrewRepo';
import { entriesOf, mineKey, newSource, selectionFile } from './yours';

const file = (id: string, json: Record<string, unknown>): HomebrewFile => ({
  id,
  fileName: `${id}.json`,
  json,
  enabled: true,
  editable: true,
  sourceIds: [],
  counts: {},
  addedAt: 0,
});

const LANTERN = file('lantern', {
  _meta: {
    sources: [{ json: 'HB', full: 'Lantern Coast', version: '1.0.0' }],
    [COLLECTION_ID_KEY]: 'lantern-id',
  },
  class: [{ name: 'Warden', source: 'HB' }],
  classFeature: [
    { name: 'Watch', source: 'HB', className: 'Warden', classSource: 'HB', level: 1 },
    { name: 'Other', source: 'HB', className: 'Ranger', classSource: 'PHB', level: 1 },
  ],
  subclass: [{ name: 'Lantern Blood', shortName: 'Lantern', source: 'HB', className: 'Sorcerer' }],
  subclassFeature: [
    {
      name: 'Lamp Heart',
      source: 'HB',
      className: 'Sorcerer',
      subclassShortName: 'Lantern',
      subclassSource: 'HB',
      level: 1,
    },
  ],
  spell: [{ name: 'Glimmer', source: 'ODD' }],
});

describe('selectionFile', () => {
  it('takes each entry with what it owns, and the books as the file declares them', () => {
    const mine = entriesOf([LANTERN]);
    const out = selectionFile(
      [LANTERN],
      mine.filter((m) => m.type !== 'spell'),
    );
    expect(out.class).toEqual(LANTERN.json.class);
    expect(out.classFeature).toEqual([(LANTERN.json.classFeature as unknown[])[0]]);
    expect(out.subclassFeature).toEqual(LANTERN.json.subclassFeature);
    expect(out._meta).toEqual({
      sources: [{ json: 'HB', full: 'Lantern Coast', version: '1.0.0' }],
    });
    // No collection's id: importing it never takes the place of Lantern Coast.
    expect(Object.hasOwn(out._meta as object, COLLECTION_ID_KEY)).toBe(false);
  });

  it('declares the book of an owned entry too', () => {
    const odd = file('odd', {
      _meta: { sources: [{ json: 'HB', full: 'Lantern Coast' }] },
      class: [{ name: 'Warden', source: 'HB' }],
      classFeature: [
        { name: 'Watch', source: 'ELS', className: 'Warden', classSource: 'HB', level: 1 },
      ],
    });
    const out = selectionFile([odd], entriesOf([odd]));
    expect((out._meta as { sources: Array<{ json: string }> }).sources.map((s) => s.json)).toEqual([
      'HB',
      'ELS',
    ]);
  });

  it('takes a book as another picked file declares it, whichever comes first', () => {
    const bare = file('bare', { feat: [{ name: 'A', source: 'HB' }] });
    const named = file('named', {
      _meta: { sources: [{ json: 'HB', full: 'Lantern Coast' }] },
      feat: [{ name: 'B', source: 'HB' }, { name: 'C' }],
    });
    for (const order of [
      [bare, named],
      [named, bare],
    ]) {
      expect(selectionFile(order, entriesOf(order))._meta).toEqual({
        sources: [{ json: 'HB', full: 'Lantern Coast' }],
      });
    }
  });

  it('names a book the file does not declare by its code', () => {
    const spell = entriesOf([LANTERN]).filter((m) => m.type === 'spell');
    expect(selectionFile([LANTERN], spell)._meta).toEqual({
      sources: [{ json: 'ODD', abbreviation: 'ODD', full: 'ODD' }],
    });
  });
});

describe('mineKey', () => {
  it('tells two changes of one name and book apart by their parents', () => {
    const hill = (raceName: string) => ({
      type: 'subrace',
      fileId: 'changes',
      entry: { name: 'Hill', source: 'PHB', raceName, raceSource: 'PHB' },
    });
    expect(mineKey(hill('Dwarf'))).not.toBe(mineKey(hill('Gnome')));
  });
});

describe('newSource', () => {
  it('joins the words of the name, as MyHomebrew is', () => {
    expect(newSource('Lantern Coast')).toBe('LanternCoast');
    expect(newSource('sea shanties & salt')).toBe('SeaShantiesSalt');
    expect(newSource('  ***  ')).toBe('MyCollection');
    expect(newSource('A very long name for a collection indeed')).toHaveLength(24);
  });

  it('puts Homebrew after a short or capitals-only name', () => {
    expect(newSource('MM')).toBe('MMHomebrew');
    expect(newSource('Sky')).toBe('SkyHomebrew');
    expect(newSource('XGE 2')).toBe('XGE2Homebrew');
    expect(newSource('ABCDEFGHIJKLMNOPQRSTUVWXYZ')).toBe('ABCDEFGHIJKLMNOPHomebrew');
  });

  it('puts Homebrew after a published book’s code, in any case', () => {
    expect(newSource('DSotDQ')).toBe('DSotDQHomebrew');
    expect(newSource('dsotdq')).toBe('DsotdqHomebrew');
  });
});
