import { describe, expect, it } from 'vitest';
import {
  type CharacterDoc,
  type ChoicePrompt,
  type DerivedSheet,
  newCharacterDoc,
} from '@/engine/types';
import { outOfPolicyPicks } from './sourceCues';

const origin = { label: 'Cleric 4', uid: 'cleric|phb', type: 'class' } as const;

function prompt(kind: ChoicePrompt['kind'], id: string, label: string): ChoicePrompt {
  return { id: `p:${id}`, origin, kind, label: 'Pick', count: 1, options: [{ id, label }] };
}

/** A cleric built mostly from the PHB, with a pick from another book in every slot. */
function mixedDoc(allowedSources: string[]): CharacterDoc {
  const doc = newCharacterDoc('s1', 'Mixed', 't');
  doc.allowedSources = allowedSources;
  doc.race = { name: 'Eladrin', source: 'MPMM' };
  doc.subrace = { name: 'Duergar', source: 'MTF' };
  doc.background = { name: 'Feylost', source: 'WBtW' };
  doc.classes = [
    {
      ref: { name: 'Cleric', source: 'PHB' },
      subclass: { name: 'Twilight Domain', source: 'TCE' },
      levels: 4,
      hp: ['avg', 'avg', 'avg', 'avg'],
    },
  ];
  doc.feats = [{ ref: { name: 'Fey Touched', source: 'TCE' }, instanceId: 'f1' }];
  doc.equipment = [
    { id: 'e1', ref: { name: 'Mace', source: 'PHB' }, qty: 1, equipped: true, attuned: false },
    {
      id: 'e2',
      ref: { name: 'Hat of Wizardry', source: 'XGE' },
      qty: 1,
      equipped: false,
      attuned: false,
    },
    { id: 'e3', custom: { name: 'Lucky coin' }, qty: 1, equipped: false, attuned: false },
  ];
  doc.spellcasting = {
    'cleric|phb': {
      known: [
        { name: 'Bless', source: 'PHB' },
        { name: 'Toll the Dead', source: 'XGE' },
      ],
      prepared: [{ name: 'Toll the Dead', source: 'XGE' }],
    },
  };
  return doc;
}

const resolved: DerivedSheet['resolvedChoices'] = [
  // Choice ids are lowercased `name|source`; the label keeps the dataset's spelling.
  { prompt: prompt('feat', 'telekinetic|tce', 'Telekinetic (TCE)'), selected: ['telekinetic|tce'] },
  { prompt: prompt('optionalfeature', 'defense|phb', 'Defense (PHB)'), selected: ['defense|phb'] },
  { prompt: prompt('skill', 'Arcana|xge', 'Arcana'), selected: ['Arcana|xge'] },
];

describe('outOfPolicyPicks (GAME-005)', () => {
  it('names every pick from a book outside the list, in every slot, touching none', () => {
    // Stored lowercased on purpose: matching ignores case.
    const doc = mixedDoc(['phb']);
    const before = structuredClone(doc);
    const picks = outOfPolicyPicks(doc, resolved);
    // Read-only: naming a pick never takes it back.
    expect(doc).toEqual(before);
    expect(picks.map((p) => [p.label, p.source])).toEqual([
      ['Eladrin', 'MPMM'],
      ['Duergar', 'MTF'],
      ['Feylost', 'WBtW'],
      ['Twilight Domain', 'TCE'],
      ['Fey Touched', 'TCE'],
      ['Telekinetic', 'TCE'],
      ['Hat of Wizardry', 'XGE'],
      // Known and prepared, named once.
      ['Toll the Dead', 'XGE'],
    ]);
  });

  it('finds nothing when the character has no list', () => {
    expect(outOfPolicyPicks(mixedDoc([]), resolved)).toEqual([]);
    expect(
      outOfPolicyPicks(mixedDoc(['PHB', 'TCE', 'XGE', 'WBTW', 'MPMM', 'MTF']), resolved),
    ).toEqual([]);
  });
});
