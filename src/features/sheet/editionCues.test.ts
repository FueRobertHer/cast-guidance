import { describe, expect, it } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import type { EntityType } from '@/data5e/normalize';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import {
  cueKey,
  type EntityLookup,
  editionCueNotes,
  editionCues,
  editionSwitchPreview,
} from './editionCues';

/**
 * A tiny world keyed by `type:name|source`, so a test can say exactly what is
 * installed. `PHB` reads as 2014 and `XPHB` as 2024 through `editionOf`.
 */
function world(entries: Array<[EntityType, Entity]>): EntityLookup {
  const byKey = new Map<string, Entity>();
  for (const [type, entity] of entries) {
    byKey.set(`${type}:${String(entity.name)}|${String(entity.source)}`.toLowerCase(), entity);
  }
  return (type, ref) => byKey.get(`${type}:${ref.name}|${ref.source}`.toLowerCase());
}

const ref = (name: string, source: string) => ({ name, source });

/** A 2014 character holding a 2014 fighter and a 2014 elf. */
function doc2014(): CharacterDoc {
  const d = newCharacterDoc('c1', 'Hero', 't');
  d.race = ref('Elf', 'PHB');
  d.background = ref('Acolyte', 'PHB');
  d.classes = [{ ref: ref('Fighter', 'PHB'), levels: 3, hp: ['avg', 'avg', 'avg'] }];
  return d;
}

const baseWorld = world([
  ['race', { name: 'Elf', source: 'PHB', reprintedAs: ['Elf|XPHB'] } as Entity],
  ['race', { name: 'Elf', source: 'XPHB' } as Entity],
  ['background', { name: 'Acolyte', source: 'PHB' } as Entity],
  ['class', { name: 'Fighter', source: 'PHB' } as Entity],
]);

describe('editionCues', () => {
  it('finds nothing to say while every pick suits the version', () => {
    const cues = editionCues(doc2014(), '2014', baseWorld);
    expect(cues.map((c) => c.fit.kind)).toEqual(['match', 'match', 'match']);
    expect(editionCueNotes(cues, '2014')).toEqual([]);
  });

  it('classifies each identity pick against the character version', () => {
    // The same character read as 2024: the elf has an installed reprint, the
    // background and class do not.
    const cues = editionCues(doc2014(), '2024', baseWorld);
    expect(cues.map((c) => [c.slot, c.fit.kind])).toEqual([
      ['race', 'reprinted'],
      ['background', 'carryOver'],
      ['class', 'carryOver'],
    ]);
    expect(editionCueNotes(cues, '2024')).toEqual([
      'Elf: 2014 content, reprinted for 2024 as Elf. Kept as chosen.',
      'Acolyte: 2014 content with no 2024 reprint. Kept as chosen.',
      'Fighter: 2014 content with no 2024 reprint. Kept as chosen.',
    ]);
  });

  it('covers subrace and subclass, naming a subclass by its class', () => {
    const d = doc2014();
    d.subrace = ref('High Elf', 'PHB');
    d.classes = [
      { ref: ref('Fighter', 'PHB'), subclass: ref('Champion', 'PHB'), levels: 3, hp: ['avg'] },
    ];
    const w = world([
      ['race', { name: 'Elf', source: 'PHB' } as Entity],
      ['subrace', { name: 'High Elf', source: 'PHB' } as Entity],
      ['background', { name: 'Acolyte', source: 'PHB' } as Entity],
      ['class', { name: 'Fighter', source: 'PHB' } as Entity],
      ['subclass', { name: 'Champion', source: 'PHB' } as Entity],
    ]);
    const cues = editionCues(d, '2024', w);
    expect(cues.map((c) => c.slot)).toEqual(['race', 'subrace', 'background', 'class', 'subclass']);
    // A bare "Champion" would not say which class it belongs to on a multiclass.
    expect(cues.find((c) => c.slot === 'subclass')?.label).toBe("Fighter's Champion");
  });

  it('keys every cue so a chip beside a pick finds its own', () => {
    const cues = editionCues(doc2014(), '2024', baseWorld);
    expect(cues.find((c) => c.slot === 'race')?.key).toBe(cueKey('race', ref('Elf', 'PHB')));
    // A race and a subrace of the same name must not share a cue.
    expect(cueKey('race', ref('Elf', 'PHB'))).not.toBe(cueKey('subrace', ref('Elf', 'PHB')));
  });

  it('says nothing about a pick whose entity is missing', () => {
    // The engine already reports that as "not found"; guessing an edition from
    // the source alone would add a second, vaguer note about one broken ref.
    const d = doc2014();
    d.race = ref('Gone', 'NOPE');
    const cues = editionCues(d, '2024', baseWorld);
    expect(cues.some((c) => c.slot === 'race')).toBe(false);
    expect(cues).toHaveLength(2);
  });

  it('reads an older pick on a 2024 character and a newer one on a 2014 character', () => {
    const d = newCharacterDoc('c2', 'Hero', 't');
    d.race = ref('Elf', 'XPHB');
    d.classes = [];
    const w = world([['race', { name: 'Elf', source: 'XPHB' } as Entity]]);
    expect(editionCues(d, '2024', w).map((c) => c.fit.kind)).toEqual(['match']);
    expect(editionCues(d, '2014', w).map((c) => c.fit.kind)).toEqual(['newer']);
  });
});

describe('editionSwitchPreview', () => {
  it('reads the picks as if the switch had already happened', () => {
    const d = doc2014();
    // Against 2014 (where it is now) there is nothing to report.
    expect(editionSwitchPreview(d, '2014', baseWorld)).toEqual({
      match: 3,
      reprinted: [],
      carryOver: [],
      newer: [],
    });
    // Against 2024 the same picks classify differently, which is the preview.
    expect(editionSwitchPreview(d, '2024', baseWorld)).toEqual({
      match: 0,
      reprinted: [{ label: 'Elf', as: { name: 'Elf', source: 'XPHB' } }],
      carryOver: ['Acolyte', 'Fighter'],
      newer: [],
    });
  });

  it('counts matches alongside mismatches so the total is every pick', () => {
    const d = doc2014();
    d.classes = [{ ref: ref('Fighter', 'XPHB'), levels: 1, hp: ['avg'] }];
    const w = world([
      ['race', { name: 'Elf', source: 'PHB', reprintedAs: ['Elf|XPHB'] } as Entity],
      ['race', { name: 'Elf', source: 'XPHB' } as Entity],
      ['background', { name: 'Acolyte', source: 'PHB' } as Entity],
      ['class', { name: 'Fighter', source: 'XPHB' } as Entity],
    ]);
    const preview = editionSwitchPreview(d, '2024', w);
    expect(preview.match).toBe(1); // the 2024 fighter
    expect(preview.reprinted).toHaveLength(1);
    expect(preview.carryOver).toEqual(['Acolyte']);
  });
});
