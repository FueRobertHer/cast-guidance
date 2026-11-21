import { describe, expect, it } from 'vitest';
import { withBooks } from './homebrewCopy';

const books = new Map([
  ['emb', 'EMB2'],
  ['frc', 'FRC2'],
]);

describe('withBooks', () => {
  it('moves every place a book is named, and leaves other books and words alone', () => {
    const json = {
      class: [
        {
          name: 'Hexer',
          source: 'EMB',
          classFeatures: ['Hex Bolt|Hexer|EMB|1', { classFeature: 'Path|Hexer|emb|3|EMB' }],
        },
      ],
      subclass: [
        {
          name: 'Coals',
          shortName: 'Coals',
          source: 'FRC',
          className: 'Hexer',
          classSource: 'EMB',
        },
      ],
      spell: [
        {
          name: 'Ember',
          source: 'EMB',
          entries: [
            'As {@spell Fire Bolt|EMB}, or {@spell Fire Bolt|PHB}, plus {@item Rod|FRC|a rod}.',
          ],
          classes: { fromClassList: [{ name: 'Hexer', source: 'EMB' }] },
        },
      ],
      item: [{ name: 'Rod', source: 'FRC', _copy: { name: 'Wand', source: 'EMB' } }],
      race: [
        {
          name: 'Kin',
          source: 'EMB',
          additionalSpells: [{ known: { 1: ['ember|emb', 'thaw|frc#c'] } }],
        },
      ],
      background: [{ name: 'Scribe', source: 'EMB', feats: [{ 'ember adept|emb': true }] }],
      feat: [{ name: 'EMB Fan', source: 'PHB', entries: ['Say EMB out loud.'] }],
    };
    expect(withBooks(json, books)).toEqual({
      class: [
        {
          name: 'Hexer',
          source: 'EMB2',
          classFeatures: ['Hex Bolt|Hexer|EMB2|1', { classFeature: 'Path|Hexer|EMB2|3|EMB2' }],
        },
      ],
      subclass: [
        {
          name: 'Coals',
          shortName: 'Coals',
          source: 'FRC2',
          className: 'Hexer',
          classSource: 'EMB2',
        },
      ],
      spell: [
        {
          name: 'Ember',
          source: 'EMB2',
          entries: [
            'As {@spell Fire Bolt|EMB2}, or {@spell Fire Bolt|PHB}, plus {@item Rod|FRC2|a rod}.',
          ],
          classes: { fromClassList: [{ name: 'Hexer', source: 'EMB2' }] },
        },
      ],
      item: [{ name: 'Rod', source: 'FRC2', _copy: { name: 'Wand', source: 'EMB2' } }],
      race: [
        {
          name: 'Kin',
          source: 'EMB2',
          additionalSpells: [{ known: { 1: ['ember|EMB2', 'thaw|FRC2#c'] } }],
        },
      ],
      background: [{ name: 'Scribe', source: 'EMB2', feats: [{ 'ember adept|EMB2': true }] }],
      feat: [{ name: 'EMB Fan', source: 'PHB', entries: ['Say EMB out loud.'] }],
    });
  });

  it('never copies a prototype key', () => {
    const json = JSON.parse('{"spell":[{"name":"A","source":"EMB","__proto__":{"x":1}}]}');
    const out = withBooks(json, books) as { spell: Record<string, unknown>[] };
    expect(Object.hasOwn(out.spell[0] ?? {}, '__proto__')).toBe(false);
    expect(out.spell[0]?.source).toBe('EMB2');
  });
});
