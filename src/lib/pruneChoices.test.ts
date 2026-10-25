import { describe, expect, it } from 'vitest';
import { newCharacterDoc } from '@/engine/types';
import { pruneChoicesFor, pruneClass, pruneFeatInstances, pruneOrigin } from './pruneChoices';

describe('pruneChoicesFor', () => {
  it('drops only choices belonging to the given origin', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = {
      'race:elf|phb:skill:0': ['perception'],
      'race:elf|phb:language:0': ['elvish'],
      'background:sage|phb:skill:0': ['arcana'],
      'class:wizard|phb:asi:4': ['int'],
    };
    pruneChoicesFor(doc, 'race', { name: 'Elf', source: 'PHB' });
    expect(Object.keys(doc.choices).sort()).toEqual([
      'background:sage|phb:skill:0',
      'class:wizard|phb:asi:4',
    ]);
  });

  it('matches the ref case-insensitively and leaves unrelated picks', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = { 'background:sage|phb:skill:0': ['arcana'] };
    pruneChoicesFor(doc, 'race', { name: 'Elf', source: 'PHB' });
    expect(Object.keys(doc.choices)).toEqual(['background:sage|phb:skill:0']);
  });

  it('leaves an origin whose uid merely starts the same way', () => {
    // `elf|phb` is a prefix of `elf|phbx` as text, but not the same origin.
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = { 'race:elf|phb:skill:0': ['perception'], 'race:elf|phbx:skill:0': ['stealth'] };
    pruneChoicesFor(doc, 'race', { name: 'Elf', source: 'PHB' });
    expect(Object.keys(doc.choices)).toEqual(['race:elf|phbx:skill:0']);
  });

  it('returns the keys it removed', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = {
      'race:elf|phb:skill:0': ['perception'],
      'race:elf|phb:language:0': ['elvish'],
      'background:sage|phb:skill:0': ['arcana'],
    };
    expect(pruneChoicesFor(doc, 'race', { name: 'Elf', source: 'PHB' }).sort()).toEqual([
      'race:elf|phb:language:0',
      'race:elf|phb:skill:0',
    ]);
  });
});

describe('pruneFeatInstances', () => {
  it('keeps the instance boundary, so asi1 never takes asi12', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = {
      'feat:skilled|tst:asi1:skill': ['arcana'],
      'feat:skilled|tst:asi12:skill': ['history'],
    };
    expect(pruneFeatInstances(doc, 'asi1')).toEqual(['feat:skilled|tst:asi1:skill']);
    expect(Object.keys(doc.choices)).toEqual(['feat:skilled|tst:asi12:skill']);
  });
});

describe('pruneOrigin', () => {
  it('takes the sub-choices of feats a background granted', () => {
    // A background's feats store their picks under the feat, keyed by the
    // background's uid, so a plain prefix sweep left them behind.
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = {
      'background:scholar|tst:skill': ['arcana', 'history'],
      'background:scholar|tst:feat:0': ['skilled|tst'],
      'feat:skilled|tst:scholar|tst:skill': ['stealth'],
      'feat:skilled|tst:asi4:skill': ['athletics'],
      'feat:skilled|tst:scholar|tstx:skill': ['survival'],
    };
    const removed = pruneOrigin(doc, 'background', { name: 'Scholar', source: 'TST' });
    expect(removed.sort()).toEqual([
      'background:scholar|tst:feat:0',
      'background:scholar|tst:skill',
      'feat:skilled|tst:scholar|tst:skill',
    ]);
    expect(Object.keys(doc.choices).sort()).toEqual([
      'feat:skilled|tst:asi4:skill',
      'feat:skilled|tst:scholar|tstx:skill',
    ]);
  });

  it('leaves feat instances alone for a species', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.choices = {
      'race:elf|phb:skill:0': ['perception'],
      'feat:skilled|tst:elf|phb:skill': ['x'],
    };
    expect(pruneOrigin(doc, 'race', { name: 'Elf', source: 'PHB' })).toEqual([
      'race:elf|phb:skill:0',
    ]);
  });
});

describe('pruneClass', () => {
  const mage = { ref: { name: 'Mage', source: 'TST' }, levels: 1, hp: ['avg' as const] };
  const warrior = { ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] };

  it('takes the class, its subclass, its ASI feats and its spell list', () => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [warrior];
    doc.choices = {
      'class:mage|tst:skill': ['arcana'],
      'class:mage|tst:asi:4': ['feat'],
      'class:mage|tst:asi:4:feat': ['skilled|tst'],
      'feat:skilled|tst:asi4:skill': ['stealth'],
      'subclass:school of tests|tst:spells': ['x'],
      'class:warrior|tst:skill': ['athletics'],
    };
    doc.spellcasting = {
      'mage|tst': { known: [{ name: 'Guidance', source: 'TST' }], prepared: [] },
      'warrior|tst': { known: [], prepared: [] },
    };
    const removed = pruneClass(doc, {
      ...mage,
      subclass: { name: 'School of Tests', source: 'TST' },
    });
    expect(removed.sort()).toEqual([
      'class:mage|tst:asi:4',
      'class:mage|tst:asi:4:feat',
      'class:mage|tst:skill',
      'feat:skilled|tst:asi4:skill',
      'subclass:school of tests|tst:spells',
    ]);
    expect(Object.keys(doc.choices)).toEqual(['class:warrior|tst:skill']);
    expect(Object.keys(doc.spellcasting)).toEqual(['warrior|tst']);
  });

  it('keeps a feat instance a remaining class took at the same level', () => {
    // Both classes picked Skilled at their level-4 ASI, so its sub-choices sit
    // under one `asi4` key that the remaining class still reads.
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [warrior];
    doc.choices = {
      'class:mage|tst:asi:4:feat': ['skilled|tst'],
      'class:warrior|tst:asi:4:feat': ['skilled|tst'],
      'feat:skilled|tst:asi4:skill': ['stealth'],
    };
    pruneClass(doc, mage);
    expect(Object.keys(doc.choices).sort()).toEqual([
      'class:warrior|tst:asi:4:feat',
      'feat:skilled|tst:asi4:skill',
    ]);
  });
});
