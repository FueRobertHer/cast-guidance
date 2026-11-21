// The re-point walker over a character (ADR-002, D5), without a database.
import { describe, expect, it } from 'vitest';
import {
  type CharacterDoc,
  type ClassLevelEntry,
  type EntityRef,
  type EquipmentEntry,
  newCharacterDoc,
  type PlayState,
} from '@/engine/types';
import { FIELD_WALKERS, type Repoint, repointDoc, type Walkers } from './repoint';

const OLD = 'MyHomebrew';
const NEW = 'HB2';

/** An entry moved from the Workshop file to another collection. */
const move = (type: string, name: string): Repoint => ({
  type,
  from: { name, source: OLD },
  to: { name, source: NEW },
});

/** An entry renamed in its file. */
const rename = (type: string, from: string, to: string): Repoint => ({
  type,
  from: { name: from, source: OLD },
  to: { name: to, source: OLD },
});

const at = (name: string, source = OLD): EntityRef => ({ name, source });
const fresh = () => newCharacterDoc('c1', 'Osk', 'tag');

/** One case per field the walker re-points: what to hold, what moves, what it holds after. */
interface Case {
  changes: Repoint[];
  give: (doc: CharacterDoc) => void;
  check: (doc: CharacterDoc) => void;
}

const CASES: Record<string, Case> = {
  'doc.race': {
    changes: [move('race', 'Stonefolk')],
    give: (d) => {
      d.race = at('Stonefolk');
    },
    check: (d) => expect(d.race).toEqual(at('Stonefolk', NEW)),
  },
  'doc.subrace': {
    changes: [move('subrace', 'Deep')],
    give: (d) => {
      d.subrace = at('Deep');
    },
    check: (d) => expect(d.subrace).toEqual(at('Deep', NEW)),
  },
  'doc.background': {
    changes: [move('background', 'Sailor')],
    give: (d) => {
      d.background = at('Sailor');
    },
    check: (d) => expect(d.background).toEqual(at('Sailor', NEW)),
  },
  'doc.choices': {
    changes: [move('class', 'Brute')],
    give: (d) => {
      d.choices = { 'class:brute|myhomebrew:skill:0': ['Athletics'] };
    },
    check: (d) => expect(d.choices).toEqual({ 'class:brute|hb2:skill:0': ['Athletics'] }),
  },
  'doc.spellcasting': {
    changes: [move('class', 'Brute')],
    give: (d) => {
      d.spellcasting = { 'brute|myhomebrew': { known: [], prepared: [] } };
    },
    check: (d) => expect(Object.keys(d.spellcasting)).toEqual(['brute|hb2']),
  },
  'doc.customEffects': {
    changes: [move('spell', 'Ember Lance')],
    give: (d) => {
      d.customEffects = [
        {
          kind: 'grantSpell',
          spell: at('Ember Lance'),
          ability: 'int',
          origin: { label: 'Mine', uid: 'mine', type: 'custom' },
        },
      ];
    },
    check: (d) => expect(d.customEffects[0]).toMatchObject({ spell: at('Ember Lance', NEW) }),
  },
  'play.foretold': {
    changes: [move('feat', "Ogre's Grip")],
    give: (d) => {
      d.play.foretold = { "spell:ogre's grip|myhomebrew:ember-lance": [3] };
    },
    check: (d) => expect(d.play.foretold).toEqual({ "spell:ogre's grip|hb2:ember-lance": [3] }),
  },
  'classes.ref': {
    changes: [move('class', 'Brute')],
    give: (d) => {
      d.classes = [{ ref: at('Brute'), levels: 1, hp: ['avg'] }];
    },
    check: (d) => expect(d.classes[0]?.ref).toEqual(at('Brute', NEW)),
  },
  'classes.subclass': {
    changes: [move('subclass', 'Path of Rocks')],
    give: (d) => {
      d.classes = [{ ref: at('Warrior', 'TST'), subclass: at('Path of Rocks'), levels: 3, hp: [] }];
    },
    check: (d) => {
      expect(d.classes[0]?.subclass).toEqual(at('Path of Rocks', NEW));
      expect(d.classes[0]?.ref).toEqual(at('Warrior', 'TST'));
    },
  },
  'feats.ref': {
    changes: [move('feat', "Ogre's Grip")],
    give: (d) => {
      d.feats = [{ ref: at("Ogre's Grip"), instanceId: 'f0' }];
    },
    check: (d) => expect(d.feats).toEqual([{ ref: at("Ogre's Grip", NEW), instanceId: 'f0' }]),
  },
  'feats.instanceId': {
    changes: [move('background', 'Sailor'), move('class', 'Brute')],
    give: (d) => {
      d.feats = [
        { ref: at('Alert', 'PHB'), instanceId: 'sailor|myhomebrew' },
        { ref: at('Tough', 'PHB'), instanceId: 'asi4@brute|myhomebrew' },
      ];
    },
    check: (d) =>
      expect(d.feats.map((f) => f.instanceId)).toEqual(['sailor|hb2', 'asi4@brute|hb2']),
  },
  'equipment.ref': {
    changes: [move('item', 'Ember Rod')],
    give: (d) => {
      d.equipment = [{ id: 'e1', ref: at('Ember Rod'), qty: 1, equipped: true, attuned: false }];
    },
    check: (d) => expect(d.equipment[0]?.ref).toEqual(at('Ember Rod', NEW)),
  },
  'spellcasting.known': {
    changes: [move('spell', 'Ember Lance')],
    give: (d) => {
      d.spellcasting = { 'warrior|tst': { known: [at('Ember Lance')], prepared: [] } };
    },
    check: (d) => expect(d.spellcasting['warrior|tst']?.known).toEqual([at('Ember Lance', NEW)]),
  },
  'spellcasting.prepared': {
    changes: [move('spell', 'Ember Lance')],
    give: (d) => {
      d.spellcasting = { 'warrior|tst': { known: [], prepared: [at('Ember Lance')] } };
    },
    check: (d) => expect(d.spellcasting['warrior|tst']?.prepared).toEqual([at('Ember Lance', NEW)]),
  },
  'addedSpells.spell': {
    changes: [move('spell', 'Ember Lance')],
    give: (d) => {
      d.addedSpells = [{ spell: at('Ember Lance'), ability: 'int', uses: 'long' }];
    },
    check: (d) => expect(d.addedSpells?.[0]?.spell).toEqual(at('Ember Lance', NEW)),
  },
  'keptEffects.parts': {
    changes: [rename('condition', 'Dazed', 'Reeling')],
    give: (d) => {
      d.keptEffects = [
        { id: 'k1', name: 'Steady', parts: [{ kind: 'conditionImmune', condition: 'dazed' }] },
      ];
    },
    check: (d) =>
      expect(d.keptEffects?.[0]?.parts).toEqual([
        { kind: 'conditionImmune', condition: 'Reeling' },
      ]),
  },
  'activeEffects.name': {
    changes: [rename('spell', 'Ember Lance', 'Ember Spear')],
    give: (d) => {
      d.play.activeEffects = [{ id: 'a1', name: 'Ember Lance', parts: [] }];
    },
    check: (d) => expect(d.play.activeEffects?.[0]?.name).toBe('Ember Spear'),
  },
  'activeEffects.parts': {
    changes: [rename('class', 'Brute', 'Bruiser')],
    give: (d) => {
      d.classes = [{ ref: at('Brute'), levels: 1, hp: [] }];
      d.play.activeEffects = [
        {
          id: 'a1',
          name: 'Focus',
          parts: [
            { kind: 'spellDcBonus', amount: 1, className: 'Brute' },
            { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'], className: 'brute' } },
          ],
        },
      ];
    },
    check: (d) =>
      expect(d.play.activeEffects?.[0]?.parts).toEqual([
        { kind: 'spellDcBonus', amount: 1, className: 'Bruiser' },
        { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'], className: 'Bruiser' } },
      ]),
  },
  'conditions.id': {
    changes: [rename('condition', 'Dazed', 'Reeling')],
    give: (d) => {
      d.play.conditions = [{ id: 'Dazed', level: 1 }];
    },
    check: (d) => expect(d.play.conditions).toEqual([{ id: 'Reeling', level: 1 }]),
  },
  'concentratingOn.label': {
    changes: [rename('spell', 'Ember Lance', 'Ember Spear')],
    give: (d) => {
      d.play.concentratingOn = { label: 'ember lance', level: 2 };
    },
    check: (d) => expect(d.play.concentratingOn).toEqual({ label: 'Ember Spear', level: 2 }),
  },
  'resources.key': {
    changes: [move('feat', "Ogre's Grip")],
    give: (d) => {
      d.play.resources = [{ key: "spell:ogre's grip|myhomebrew:ember-lance", used: 1 }];
    },
    check: (d) =>
      expect(d.play.resources).toEqual([{ key: "spell:ogre's grip|hb2:ember-lance", used: 1 }]),
  },
};

/**
 * Walkers that hand a field to another map (`doc.classes` to `classes`) and so
 * have their cases there. `spellcasting` also re-keys, its own case.
 */
const DELEGATES = new Set(
  Object.keys(FIELD_WALKERS).filter((k) => k !== 'doc' && k !== 'spellcasting'),
);

describe('the walker’s maps', () => {
  it('need an entry for every field, so a field added without one fails to compile', () => {
    // @ts-expect-error: `newRef` has no entry in the character's map.
    const doc: Walkers<CharacterDoc & { newRef?: EntityRef }> = FIELD_WALKERS.doc;
    // @ts-expect-error: nor `newPool` in play's.
    const play: Walkers<PlayState & { newPool: string }> = FIELD_WALKERS.play;
    // @ts-expect-error: nor `bonus` in a class level's.
    const cls: Walkers<ClassLevelEntry & { bonus: EntityRef }> = FIELD_WALKERS.classes;
    // @ts-expect-error: nor `charm` in an item's.
    const item: Walkers<EquipmentEntry & { charm: EntityRef }> = FIELD_WALKERS.equipment;
    expect([doc, play, cls, item].every((m) => typeof m === 'object')).toBe(true);
  });

  it('have a case below for every field they walk', () => {
    const walked = Object.entries(FIELD_WALKERS).flatMap(([map, walkers]) =>
      Object.entries(walkers)
        .filter(([key, walk]) => walk !== null && !(map !== 'spellcasting' && DELEGATES.has(key)))
        .map(([key]) => `${map}.${key}`),
    );
    expect(Object.keys(CASES).sort()).toEqual(walked.sort());
  });

  for (const [field, { changes, give, check }] of Object.entries(CASES)) {
    it(`re-point ${field}`, () => {
      const doc = fresh();
      give(doc);
      const before = structuredClone(doc);
      const after = repointDoc(doc, changes);
      expect(after).not.toBe(doc);
      // The document handed in is never changed.
      expect(doc).toEqual(before);
      check(after);
    });
  }
});

describe('repointDoc', () => {
  it('hands back the very document when nothing in it moved', () => {
    const doc = fresh();
    doc.race = at('Stonefolk');
    doc.choices = { 'race:stonefolk|myhomebrew:lang:0': ['Elvish'] };
    expect(repointDoc(doc, [move('race', 'Elsewhere')])).toBe(doc);
    expect(repointDoc(doc, [move('feat', 'Stonefolk')])).toBe(doc);
    expect(repointDoc(doc, [])).toBe(doc);
  });

  it('matches without case and writes the entry’s own spelling', () => {
    const doc = fresh();
    doc.race = { name: 'STONEFOLK', source: 'myhomebrew' };
    expect(repointDoc(doc, [move('race', 'Stonefolk')]).race).toEqual(at('Stonefolk', NEW));
  });

  it('adds the new source to what a character it re-pointed depends on, once', () => {
    const doc = fresh();
    doc.race = at('Stonefolk');
    doc.homebrewDeps = [OLD];
    expect(repointDoc(doc, [move('race', 'Stonefolk')]).homebrewDeps).toEqual([OLD, NEW]);
    doc.homebrewDeps = [OLD, NEW];
    expect(repointDoc(doc, [move('race', 'Stonefolk')]).homebrewDeps).toEqual([OLD, NEW]);
  });

  it('leaves a character that depends on the old source but holds nothing that moved', () => {
    const doc = fresh();
    doc.race = at('Elsewhere');
    doc.homebrewDeps = [OLD];
    expect(repointDoc(doc, [move('race', 'Stonefolk')])).toBe(doc);
  });

  it('renames a class an effect names only on a character with that very class', () => {
    const doc = fresh();
    doc.classes = [{ ref: at('Brute', 'PHB'), levels: 1, hp: [] }];
    doc.customEffects = [
      {
        id: 'e1',
        kind: 'spellDcBonus',
        amount: 1,
        className: 'Brute',
        origin: { label: 'Mine', uid: 'mine', type: 'custom' },
      } as unknown as CharacterDoc['customEffects'][number],
    ];
    expect(repointDoc(doc, [rename('class', 'Brute', 'Bruiser')])).toBe(doc);
  });

  it('reads a field that is missing or the wrong shape as holding nothing', () => {
    const doc = { ...fresh(), feats: undefined, choices: 'broken' } as unknown as CharacterDoc;
    expect(repointDoc(doc, [move('feat', 'Grip')])).toBe(doc);
  });
});

describe('repointDoc on picks', () => {
  const picks = (choices: CharacterDoc['choices'], changes: Repoint[]) => {
    const doc = fresh();
    doc.choices = choices;
    return repointDoc(doc, changes).choices;
  };

  it('re-points every key form a type’s uid takes', () => {
    expect(
      picks(
        {
          'race:stonefolk|myhomebrew:lang:0': ['Elvish'],
          'subrace:deep|myhomebrew:skill:0': ['Stealth'],
          // A subrace's own trait picks are under `race:`.
          'race:deep|myhomebrew:pick-sense': ['darkvision'],
          'background:sailor|myhomebrew:skill:0': ['Athletics'],
          // A feat the background gave is under the feat, its instance the background.
          'feat:alert|phb:sailor|myhomebrew:pick-x': ['a'],
          'class:brute|myhomebrew:asi:4': 'feat',
          // A feat taken at a class's ASI, its instance the class.
          'feat:tough|phb:asi4@brute|myhomebrew:ability': ['con'],
          // A feat a class's or subclass's feat progression gave, its instance the progression.
          'feat:skilled|xphb:feats:fighting style@brute|myhomebrew:skill:0': ['Arcana'],
          'feat:skilled|xphb:feats:fighting style@path of rocks|myhomebrew:skill:0': ['History'],
          // A feat a species gave, its instance the species' picks.
          'feat:skilled|xphb:race:stonefolk|myhomebrew:skill:0': ['Nature'],
          'subclass:path of rocks|myhomebrew:feature:stone skin:3': ['a'],
          "feat:ogre's grip|myhomebrew:asi4:ability": ['str'],
          // An optional feature's picks are under its host's type, its spells under `spells-of`.
          'class:stone sight|myhomebrew:cantrip': ['Guidance|TST'],
          'class:warrior|tst:spells-of:stone sight|myhomebrew:spell:u:0:known:_:0': ['Aid|TST'],
          'item:ember rod|myhomebrew:pick-x': ['a'],
          'attached:ember rod|myhomebrew:0': ['a'],
          'spells:ember rod|myhomebrew:ability:0:0': ['int'],
        },
        [
          move('race', 'Stonefolk'),
          move('subrace', 'Deep'),
          move('background', 'Sailor'),
          move('class', 'Brute'),
          move('subclass', 'Path of Rocks'),
          move('feat', "Ogre's Grip"),
          move('optionalfeature', 'Stone Sight'),
          move('item', 'Ember Rod'),
        ],
      ),
    ).toEqual({
      'race:stonefolk|hb2:lang:0': ['Elvish'],
      'subrace:deep|hb2:skill:0': ['Stealth'],
      'race:deep|hb2:pick-sense': ['darkvision'],
      'background:sailor|hb2:skill:0': ['Athletics'],
      'feat:alert|phb:sailor|hb2:pick-x': ['a'],
      'class:brute|hb2:asi:4': 'feat',
      'feat:tough|phb:asi4@brute|hb2:ability': ['con'],
      'feat:skilled|xphb:feats:fighting style@brute|hb2:skill:0': ['Arcana'],
      'feat:skilled|xphb:feats:fighting style@path of rocks|hb2:skill:0': ['History'],
      'feat:skilled|xphb:race:stonefolk|hb2:skill:0': ['Nature'],
      'subclass:path of rocks|hb2:feature:stone skin:3': ['a'],
      "feat:ogre's grip|hb2:asi4:ability": ['str'],
      'class:stone sight|hb2:cantrip': ['Guidance|TST'],
      'class:warrior|tst:spells-of:stone sight|hb2:spell:u:0:known:_:0': ['Aid|TST'],
      'item:ember rod|hb2:pick-x': ['a'],
      'attached:ember rod|hb2:0': ['a'],
      'spells:ember rod|hb2:ability:0:0': ['int'],
    });
  });

  it('re-points a feat, an optional feature and a spell picked, each in its own picks', () => {
    expect(
      picks(
        {
          'class:warrior|tst:asi:4': 'feat',
          'class:warrior|tst:asi:4:feat': "ogre's grip|myhomebrew",
          'background:scholar|tst:feat:0': ["Ogre's Grip|MyHomebrew"],
          'race:human|xphb:feat:0': ["ogre's grip|myhomebrew"],
          'subrace:variant|phb:feat:0': ["ogre's grip|myhomebrew"],
          'class:warrior|tst:feats:fighting style:feat': ["ogre's grip|myhomebrew"],
          'subclass:champion|tst:feats:fighting style:feat': ["ogre's grip|myhomebrew"],
          'class:warrior|tst:optfeature:FS:T': ['stone sight|myhomebrew'],
          'class:warrior|tst:spell:u:0:known:1:0': ['Ember Lance|MyHomebrew', 'Aid|TST'],
        },
        [
          move('feat', "Ogre's Grip"),
          move('optionalfeature', 'Stone Sight'),
          move('spell', 'Ember Lance'),
        ],
      ),
    ).toEqual({
      'class:warrior|tst:asi:4': 'feat',
      'class:warrior|tst:asi:4:feat': "ogre's grip|hb2",
      'background:scholar|tst:feat:0': ["ogre's grip|hb2"],
      'race:human|xphb:feat:0': ["ogre's grip|hb2"],
      'subrace:variant|phb:feat:0': ["ogre's grip|hb2"],
      'class:warrior|tst:feats:fighting style:feat': ["ogre's grip|hb2"],
      'subclass:champion|tst:feats:fighting style:feat': ["ogre's grip|hb2"],
      'class:warrior|tst:optfeature:FS:T': ['stone sight|hb2'],
      'class:warrior|tst:spell:u:0:known:1:0': ['Ember Lance|HB2', 'Aid|TST'],
    });
  });

  it('leaves a pick of another type, or of a longer source, where it is', () => {
    const choices = {
      // A spell that shares the moved feat's name and book is not the feat.
      'class:warrior|tst:spell:u:0:known:1:0': ["Ogre's Grip|MyHomebrew"],
      // Nor is a feat that shares a moved spell's.
      'class:warrior|tst:asi:4:feat': 'ember lance|myhomebrew',
      'race:stonefolk|myhomebrewx:lang:0': ['Elvish'],
      'feat:stonefolk|myhomebrew:asi4:ability': ['str'],
    };
    expect(
      picks(choices, [
        move('feat', "Ogre's Grip"),
        move('spell', 'Ember Lance'),
        move('race', 'Stonefolk'),
      ]),
    ).toEqual({
      ...choices,
      'class:warrior|tst:spell:u:0:known:1:0': ["Ogre's Grip|MyHomebrew"],
      'class:warrior|tst:asi:4:feat': 'ember lance|myhomebrew',
    });
  });

  it('keeps the live pick where a stale one sat under the new key', () => {
    expect(
      picks(
        {
          'class:brute|myhomebrew:skill:0': ['Athletics'],
          'class:brute|hb2:skill:0': ['Survival'],
        },
        [move('class', 'Brute')],
      ),
    ).toEqual({ 'class:brute|hb2:skill:0': ['Athletics'] });
  });

  it('renames a built-in pick’s name with the entry, and a weapon’s mastery by name', () => {
    expect(
      picks(
        {
          'feat:skilled|myhomebrew:skill:skilled': ['Arcana'],
          'feat:skilled|myhomebrew:asi4:skill': ['History'],
          'feat:weapon master|phb:asi4:weaponMastery': ['Ember Rod'],
        },
        [rename('feat', 'Skilled', 'Adept'), rename('item', 'Ember Rod', 'Ember Staff')],
      ),
    ).toEqual({
      'feat:adept|myhomebrew:skill:adept': ['Arcana'],
      'feat:adept|myhomebrew:asi4:skill': ['History'],
      'feat:weapon master|phb:asi4:weaponMastery': ['Ember Staff'],
    });
  });

  it('keeps a `$` in a name as the name’s', () => {
    expect(
      picks({ 'feat:gold $& glory|myhomebrew:asi4:skill': ['Arcana'] }, [
        rename('feat', 'Gold $& Glory', "Gold $' Glory"),
      ]),
    ).toEqual({ "feat:gold $' glory|myhomebrew:asi4:skill": ['Arcana'] });
  });
});

describe('repointDoc on pools', () => {
  const pools = (keys: string[], changes: Repoint[], added?: EntityRef) => {
    const doc = fresh();
    doc.play.resources = keys.map((key) => ({ key, used: 1 }));
    if (added !== undefined) doc.addedSpells = [{ spell: added, ability: 'int', uses: 'long' }];
    return repointDoc(doc, changes).play.resources.map((r) => r.key);
  };

  it('re-points the origin of a granted spell’s pool, and keeps a renamed spell’s place in it', () => {
    // A grant names its spells as it writes them, and a grant is not followed.
    expect(
      pools(
        ['spell:stonefolk|myhomebrew:ember-lance+aid', 'spell:testfolk|tst:ember-lance', 'rage'],
        [move('race', 'Stonefolk'), rename('spell', 'Ember Lance', 'Ember Spear')],
      ),
    ).toEqual(['spell:stonefolk|hb2:ember-lance+aid', 'spell:testfolk|tst:ember-lance', 'rage']);
  });

  it('renames the pool of the very spell the character added, which a move leaves alone', () => {
    const key = ['spell:added:ember lance'];
    expect(pools(key, [move('spell', 'Ember Lance')], at('Ember Lance'))).toEqual(key);
    expect(pools(key, [rename('spell', 'Ember Lance', 'Ember Spear')], at('Ember Lance'))).toEqual([
      'spell:added:ember spear',
    ]);
    // Another book's spell of that name keeps its pool.
    expect(
      pools(key, [rename('spell', 'Ember Lance', 'Ember Spear')], at('Ember Lance', 'PHB')),
    ).toEqual(key);
  });
});
