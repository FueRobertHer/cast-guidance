import { describe, expect, it } from 'vitest';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { emitCuratedEffects } from '../curated/curatedEffects';
import { deriveSheet } from '../derive';
import { type EffectInput, type EffectOrigin, newCharacterDoc } from '../types';
import { Collector } from './base';
import { flattenEntries, proseScanFeature } from './proseScan';
import { collectRace } from './race';

const origin: EffectOrigin = { label: 'Trait', uid: 'race|x', type: 'race' };

function scan(name: string, entries: unknown): EffectInput[] {
  const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
  proseScanFeature(col, name, entries, origin);
  return col.effects;
}

describe('flattenEntries', () => {
  it('walks nested entries/entry/items and lowercases', () => {
    expect(flattenEntries([{ entries: ['Hello'] }, { entry: 'World' }, { items: ['A'] }])).toBe(
      'hello world a',
    );
  });

  it('keeps the display text of {@tag ...} markup and folds apostrophes', () => {
    expect(flattenEntries('Cast {@spell bless|phb} once')).toBe('cast bless once');
    expect(flattenEntries('It’s fine')).toBe("it's fine");
  });

  it('reads a three-part tag by its display text, not its name', () => {
    expect(flattenEntries('your {@variantrule Proficiency|XPHB|Proficiency Bonus}')).toBe(
      'your proficiency bonus',
    );
    expect(flattenEntries('a 15-foot {@variantrule Cone [Area of Effect]|XPHB|Cone}')).toBe(
      'a 15-foot cone',
    );
    expect(
      flattenEntries('a {@variantrule Short Rest|XPHB|Short} or {@variantrule Long Rest|XPHB}'),
    ).toBe('a short or long rest');
  });

  it('keeps the body of tags whose third part is not display text', () => {
    expect(flattenEntries('{@scaledamage 8d6|3-9|1d6}')).toBe('8d6');
    expect(flattenEntries('{@filter Light|items|type=martial weapon}')).toBe('light');
  });

  it('reads each string on its own, so an unclosed tag leaves the next one readable', () => {
    expect(
      flattenEntries([
        'broken {@spell bless',
        'your {@variantrule Proficiency|XPHB|Proficiency Bonus}',
      ]),
    ).toBe('broken {@spell bless your proficiency bonus');
  });

  it('is empty for non-text content', () => {
    expect(flattenEntries(undefined)).toBe('');
    expect(flattenEntries([{ type: 'table' }])).toBe('');
  });
});

describe('proseScanFeature — limited-use detection', () => {
  const resource = (effects: EffectInput[]) =>
    effects.find((e): e is Extract<EffectInput, { kind: 'resource' }> => e.kind === 'resource');

  it('emits a once-per-long-rest resource', () => {
    const r = resource(scan('Breath', ['You can use it once per long rest.']));
    expect(r).toMatchObject({ kind: 'resource', label: 'Breath', max: 1, resetOn: 'long' });
  });

  it('resets on a short rest when the prose says so', () => {
    const r = resource(
      scan('Trick', ['You can use it twice, and you regain all uses on a short or long rest.']),
    );
    expect(r?.resetOn).toBe('short');
    expect(r?.max).toBe(2);
  });

  it('reads a proficiency-bonus number of uses', () => {
    const r = resource(
      scan('Channel', ['You can use it a number of times equal to your proficiency bonus.']),
    );
    expect(r?.max).toBe('profBonus');
  });

  it('adds nothing when there is no usage wording', () => {
    expect(scan('Flavor', ['You have a keen sense of smell.'])).toEqual([]);
  });

  it('reads an ability-modifier number of uses (Cleansing Touch wording)', () => {
    const r = resource(
      scan('Cleansing Touch', [
        'You can use this feature a number of times equal to your Charisma modifier (a minimum of once). You regain expended uses when you finish a long rest.',
      ]),
    );
    expect(r).toMatchObject({ max: 'abilityMod:cha', resetOn: 'long' });
  });

  it('reads a "1 + modifier" number of uses (Divine Sense wording)', () => {
    const r = resource(
      scan('Divine Sense', [
        'As an action, you can open your awareness to detect such forces.',
        'You can use this feature a number of times equal to 1 + your Charisma modifier. When you finish a long rest, you regain all expended uses.',
      ]),
    );
    expect(r).toMatchObject({ max: 'abilityModPlus1:cha', resetOn: 'long' });
  });

  it('takes the reset from the clause that returns the uses, not any rest it mentions', () => {
    // Star Map: the short rest here is when a replacement ritual can happen.
    const ritual = resource(
      scan('Star Map', [
        'You can do so a number of times equal to your {@variantrule Proficiency|XPHB|Proficiency Bonus}, and you regain all expended uses when you finish a {@variantrule Long Rest|XPHB}. A ceremony to replace the map can be performed during a {@variantrule Short Rest|XPHB|Short} or {@variantrule Long Rest|XPHB}.',
      ]),
    );
    expect(ritual?.resetOn).toBe('long');

    // Mist Walker: the short rest here is when the mists drain you.
    const drain = resource(
      scan('Mist Walker', [
        'You can use this feature a number of times equal to your proficiency bonus, and you regain all expended uses when you finish a long rest. Whenever you finish a short rest in that area, make a Constitution saving throw.',
      ]),
    );
    expect(drain?.resetOn).toBe('long');
  });

  it.each([
    'You regain one expended use when you finish a short rest, and you regain all expended uses when you finish a long rest.',
    'You regain one of its expended uses when you finish a short rest, and you regain all expended uses when you finish a long rest.',
    'You regain all expended uses when you finish a long rest, and you regain one expended use when you finish a short rest.',
  ])('resets on a short rest when that rest returns even one use: %s', (returning) => {
    const r = resource(scan('Second Wind', [`You can use it twice. ${returning}`]));
    expect(r).toMatchObject({ max: 2, resetOn: 'short' });
  });
});

describe('proseScanFeature beside a counted spell', () => {
  /** A scan on a sheet whose additionalSpells already count these spells for this origin. */
  function scanBeside(spells: string[], text: string, from: EffectOrigin = origin) {
    const col = new Collector(newCharacterDoc('c', 'H', 't'), makeTestContext());
    for (const name of spells) {
      col.add({
        kind: 'grantSpell',
        spell: { name, source: 'HB' },
        usage: '1/day',
        resourceKey: `spell:${from.uid}:${name}`,
        origin: from,
      });
    }
    proseScanFeature(col, 'Gift', [text], origin);
    return col.effects.filter((e) => e.kind === 'resource' || e.kind === 'action');
  }
  const trackers = (spells: string[], text: string) =>
    scanBeside(spells, text).filter((e) => e.kind === 'resource');
  /** The plain limit each form takes, in wording of our own. */
  const CAST_LIMIT =
    'Once you cast it with this gift, you can’t do so again until you finish a long rest.';
  const USE_LIMIT =
    'Once you use this trait, you can’t do so again until you complete a long rest.';

  describe('reads no second tracker from', () => {
    it.each([
      ['a limit on casting it', `You may cast fake ward here. ${CAST_LIMIT}`],
      ['a limit on using the trait to cast it', `You may cast fake ward here. ${USE_LIMIT}`],
      ['"the" before the name', `You may cast the fake ward spell here. ${CAST_LIMIT}`],
      ['the spell named some sentences back', `You learn fake ward. It hums softly. ${CAST_LIMIT}`],
      [
        'the spell named in the limit',
        'You learn fake ward. Once you cast fake ward with this gift, you can’t do so again until you finish a long rest.',
      ],
      [
        'a way to cast it again',
        'You may cast fake ward here. Once you cast it with this gift, you can’t do so again until you finish a long rest, unless you pay a mote to cast it again.',
      ],
      [
        'plain words about the spell between',
        `You may cast fake ward here. Its glow is pale. ${USE_LIMIT}`,
      ],
    ])('%s', (_case, text) => {
      expect(trackers(['fake ward'], text)).toEqual([]);
    });

    it('that limit, keeping an action of its own, which no longer spends a use', () => {
      const text = `You may cast fake ward here. While it lasts, you can make a strike as a bonus action. ${CAST_LIMIT}`;
      expect(scanBeside(['fake ward'], text)).toMatchObject([{ kind: 'action', economy: 'bonus' }]);
    });
  });

  describe('keeps the tracker for', () => {
    it.each([
      ['a spell it does not count', ['fake other'], `You may cast fake ward here. ${CAST_LIMIT}`],
      ['a name only inside a longer word', ['fake'], `You may cast fakeness here. ${CAST_LIMIT}`],
      [
        'a change made to the spell',
        ['fake ward'],
        'When you cast fake ward, you may reshape it. Once you use this trait to reshape it, you can’t do so again until you complete a long rest.',
      ],
      [
        'a verb of its own',
        ['fake ward'],
        'You may cast fake ward here. Once you reshape it, you can’t do so again until you finish a long rest.',
      ],
      ['a benefit before the spell', ['fake ward'], `${USE_LIMIT} You also learn fake ward.`],
      [
        'a benefit between the spell and the limit',
        ['fake ward'],
        `You may cast fake ward here. As a bonus action you can hurl a mote. ${USE_LIMIT}`,
      ],
      [
        'dice between the spell and the limit',
        ['fake ward'],
        `You may cast fake ward here. You can add 2d6 to a roll. ${USE_LIMIT}`,
      ],
      [
        'a trait that only names the spell',
        ['fake ward'],
        `You know fake ward. You can raise a glow. ${USE_LIMIT}`,
      ],
      ['a spell name that is an ordinary word', ['glow'], `You raise a glow. ${USE_LIMIT}`],
      [
        'another spell in the limit',
        ['fake ward'],
        'You learn fake ward. You also learn fake bolt. Once you cast fake bolt with this gift, you can’t do so again until you finish a long rest.',
      ],
      [
        'any spell in the limit',
        ['fake ward'],
        'You learn fake ward. When you cast a spell, you can add 1 to it. Once you cast a spell like this, you can’t do so again until you finish a long rest.',
      ],
      [
        'a rider in the limit',
        ['fake ward'],
        'You learn fake ward. Once you cast fake ward, you can reroll one die, and you can’t do so again until you finish a long rest.',
      ],
      [
        'a second limit in the sentence',
        ['fake ward'],
        'You learn fake ward. Once you cast it with this gift, you can’t do so again until you finish a long rest; when struck you can parry, and you must finish a short rest before you can use that again.',
      ],
      [
        'a second limit in the prose',
        ['fake ward'],
        `You may cast fake ward here. ${CAST_LIMIT} You may also dash. After you dash, you can’t use it again until you finish a short rest.`,
      ],
      [
        'a count of another kind',
        ['fake ward'],
        `You may cast fake ward here. ${CAST_LIMIT} You can use your parry twice.`,
      ],
    ])('%s', (_case, spells, text) => {
      expect(trackers(spells, text)).toHaveLength(1);
    });

    it('a spell counted for another origin', () => {
      const wand: EffectOrigin = { label: 'Wand', uid: 'item|wand', type: 'item' };
      const text = `You may cast fake ward here. ${CAST_LIMIT}`;
      expect(
        scanBeside(['fake ward'], text, wand).filter((e) => e.kind === 'resource'),
      ).toHaveLength(1);
    });

    it('no counted spell, when it is the only count there is', () => {
      expect(trackers([], `You may cast fake ward here. ${CAST_LIMIT}`)).toHaveLength(1);
    });

    it('its roll', () => {
      const text = `You may cast fake ward here. As a bonus action you can hurl a mote, dealing 2d6 fire damage. ${USE_LIMIT}`;
      expect(scanBeside(['fake ward'], text)).toMatchObject([
        { kind: 'resource' },
        { kind: 'action', roll: '2d6' },
      ]);
    });
  });
});

describe('proseScanFeature: whose rest a tracker reads', () => {
  const resets = (text: string) =>
    scan('Gift', [text]).flatMap((e) => (e.kind === 'resource' ? [e.resetOn] : []));
  const LIMIT =
    'When you slip, you can take a reaction to roll 1d6. Once you’ve done it, you can’t do so again until you finish a long rest.';

  it.each([
    [
      'last',
      'You may cast fake ward once with no slot, and you regain the ability to cast it in that way when you finish a short or long rest.',
    ],
    ['first', 'When you finish a short or long rest, you regain the ability to cast fake ward.'],
    ['alone', 'You regain the ability to cast fake ward, when you finish a short or long rest.'],
  ])('takes no rest from a spell’s free cast, with its rest %s', (_order, spellSentence) => {
    expect(resets(`${LIMIT} ${spellSentence}`)).toEqual(['long']);
  });

  it('takes it when the limit is in that same sentence', () => {
    expect(
      resets(
        'You may cast fake ward once per short rest with no slot, and you regain the ability to cast it this way when you finish a short or long rest.',
      ),
    ).toEqual(['short']);
  });
});

describe('proseScanFeature on 2024 tagged prose', () => {
  const resource = (effects: EffectInput[]) =>
    effects.find((e): e is Extract<EffectInput, { kind: 'resource' }> => e.kind === 'resource');
  const action = (effects: EffectInput[]) =>
    effects.find((e): e is Extract<EffectInput, { kind: 'action' }> => e.kind === 'action');

  /** The shape of the XPHB trait: a typed save, a choice of area, proficiency-bonus uses. */
  const BREATH_WEAPON = [
    'You can replace one of your attacks with a breath in either a 15-foot {@variantrule Cone [Area of Effect]|XPHB|Cone} or a 30-foot {@variantrule Line [Area of Effect]|XPHB|Line}. Each creature there must make a Dexterity saving throw ({@dc 8} plus your Constitution modifier and {@variantrule Proficiency|XPHB|Proficiency Bonus}) or take {@damage 1d10} Fire damage.',
    'You can use this a number of times equal to your {@variantrule Proficiency|XPHB|Proficiency Bonus}, and you regain all expended uses when you finish a {@variantrule Long Rest|XPHB}.',
  ];

  it('gives Adrenaline Rush its proficiency-bonus uses and bonus action', () => {
    const effects = scan('Adrenaline Rush', [
      'You can take the {@action Dash|XPHB} action as a {@variantrule Bonus Action|XPHB}.',
      'You can use this trait a number of times equal to your {@variantrule Proficiency|XPHB|Proficiency Bonus}, and you regain all expended uses when you finish a {@variantrule Short Rest|XPHB|Short} or {@variantrule Long Rest|XPHB}.',
    ]);
    expect(resource(effects)).toMatchObject({
      label: 'Adrenaline Rush',
      max: 'profBonus',
      resetOn: 'short',
    });
    expect(action(effects)).toMatchObject({ label: 'Adrenaline Rush', economy: 'bonus' });
  });

  it('gives Breath Weapon its action, uses, save and damage type', () => {
    const effects = scan('Breath Weapon', BREATH_WEAPON);
    expect(resource(effects)).toMatchObject({ max: 'profBonus', resetOn: 'long' });
    expect(action(effects)).toMatchObject({
      economy: 'action',
      roll: '1d10',
      note: 'fire',
      save: { targetAbility: 'dex', dcAbility: 'con' },
    });
  });

  function collectBreathWeapon(raceName: string, rulesVersion: '2014' | '2024'): EffectInput[] {
    const race = {
      name: raceName,
      source: 'XPHB',
      entries: [{ name: 'Breath Weapon', type: 'entries', entries: BREATH_WEAPON }],
    };
    const doc = newCharacterDoc('c', 'H', 't');
    doc.rulesVersion = rulesVersion;
    doc.race = { name: race.name, source: race.source };
    const col = new Collector(doc, { get: () => race, byType: () => [race] });
    collectRace(col);
    return col.effects;
  }

  // "in either a ... or a ..." is a choice, not one area the scanner can state.
  // A character switched to 2014 rules keeps the race, and its prose still offers it.
  it.each([
    '2024',
    '2014',
  ] as const)('gets the Breath Weapon area from the ancestry table on a %s character', (rulesVersion) => {
    const effects = collectBreathWeapon('Dragonborn (Red)', rulesVersion);
    expect(resource(effects)).toMatchObject({ max: 'profBonus', resetOn: 'long' });
    expect(action(effects)).toMatchObject({
      label: 'Breath Weapon',
      economy: 'action',
      note: 'fire · 15 ft cone or 30 ft line',
      save: { targetAbility: 'dex', dcAbility: 'con' },
    });
  });

  it('leaves a scanned damage type alone when the ancestry table disagrees', () => {
    // The table's type for black is acid; this prose says fire.
    expect(action(collectBreathWeapon('Dragonborn (Black)', '2024'))?.note).toBe('fire');
  });

  it('reads a per-level HP rider worded through a tag (Dwarven Toughness)', () => {
    const effects = scan('Dwarven Toughness', [
      'Your {@variantrule Hit Points|XPHB|Hit Point} maximum increases by 1 whenever you gain a level.',
    ]);
    expect(effects).toMatchObject([{ kind: 'hpPerLevel', amount: 1 }]);
  });
});

describe('proseScanFeature reaction wording', () => {
  const economies = (entries: unknown) =>
    scan('Trait', entries).flatMap((e) => (e.kind === 'action' ? [e.economy] : []));

  it('keeps the 2014 phrasings', () => {
    expect(economies(['As a reaction, you can halve the damage.'])).toEqual(['reaction']);
    expect(economies(['You can use your reaction to halve the damage.'])).toEqual(['reaction']);
  });

  it.each([
    ['you can', 'When an attacker hits you, you can take a Reaction to halve the damage.'],
    ['you must', 'To help another creature, you must take a Reaction to do so.'],
    // How the 2024 data really writes it, tag and all.
    ['the tagged rule', 'When you fall, you can take a {@variantrule Reaction|XPHB} to slow it.'],
  ])('reads the 2024 phrasing: %s', (_, prose) => {
    expect(economies([prose])).toEqual(['reaction']);
  });

  it.each([
    ['a familiar', 'Your familiar can take a Reaction to add a bonus to the armor class.'],
    ['a mount', 'Your mount can take a {@variantrule Reaction|XPHB} to move up to its speed.'],
    ['each target', 'Each target can then take a Reaction to also teleport up to 30 feet.'],
    ['each ally', 'Each of those allies can immediately take a Reaction to move.'],
    ['one creature', 'The creature can also immediately take a Reaction to teleport.'],
  ])('leaves out a Reaction that %s takes', (_, prose) => {
    expect(economies([prose])).toEqual([]);
  });

  it('does not read a Reaction the prose forbids', () => {
    expect(economies(["While the rage lasts, you can't take a Reaction."])).toEqual([]);
  });

  it('gives the 2024 chip what a limited-use chip carries', () => {
    const effects = scan('Trait', [
      "When you fail a save, you can take a Reaction to roll 1d4 and add it. You can't use this feature again until you finish a long rest.",
    ]);
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'reaction', roll: '1d4' }),
    );
    expect(effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', max: 1, resetOn: 'long' }),
    );
  });
});

describe('proseScanFeature rolls', () => {
  const action = (entries: string) =>
    scan('Trait', entries).find((e) => e.kind === 'action') as
      | (EffectInput & { kind: 'action' })
      | undefined;

  it('marks dice in a sentence about regaining hit points as a heal', () => {
    const heal = action('Once per long rest, as a bonus action, you regain 1d10 + 2 hit points.');
    expect(heal?.roll).toBe('1d10+2');
    expect(heal?.heals).toBe(true);
  });

  it('leaves damage dice as damage where the same sentence heals you by their result', () => {
    const drain = action(
      'Once per long rest, as a bonus action, a creature takes 2d6 necrotic damage, and you regain hit points equal to half of it.',
    );
    expect(drain?.roll).toBe('2d6');
    expect(drain?.heals).toBe(false);
  });

  it('leaves damage dice as they were, even beside a sentence about regaining a use', () => {
    const breath = action(
      'Once per long rest, as a bonus action, each creature takes 2d6 fire damage. You regain hit points only by resting.',
    );
    expect(breath).toMatchObject({ roll: '2d6', heals: false, plainDice: false });
  });

  it.each([
    ['dice then damage', 'a creature takes 2d6 damage.', '2d6'],
    ['dice then a type', 'a creature takes 2d6 fire damage.', '2d6'],
    ['dice then two types', 'a creature takes 2d8 lightning or thunder damage.', '2d8'],
    ['dice then a list of types', 'a creature takes 1d6 acid, cold, or fire damage.', '1d6'],
    ['dice then a modifier', 'it deals 1d8 + your Strength modifier slashing damage.', '1d8'],
    ['dice then extra damage', 'your weapon deals 1d6 extra damage.', '1d6'],
    ['an explicit 1d20', 'a creature takes 1d20 fire damage.', '1d20'],
    ['a type then dice', 'a creature takes cold damage equal to 1d8.', '1d8'],
    ['damage that grows', 'your attack hits, and this damage increases by 1d6.', '1d6'],
  ])('reads dice as damage only where the prose says they deal it: %s', (_, sentence, roll) => {
    const hit = action(`Once per long rest, as a bonus action, ${sentence}`);
    expect(hit).toMatchObject({ roll, heals: false, plainDice: false });
  });

  it.each([
    ['temporary hit points', 'an ally gains temporary hit points equal to 2d6.', '2d6'],
    ['damage reduced', 'when you take damage, you reduce the damage taken by 1d4.', '1d4'],
    ['a bonus die', 'an ally can roll a d8 and add it to an attack roll.', '1d8'],
    ['a die swapped for another', 'you can roll 1d6 instead of 1d4.', '1d6'],
    ['less damage taken', 'you take 1d6 less damage.', '1d6'],
    ['a die rolled ahead of damage', 'you can roll 1d6 before damage is dealt.', '1d6'],
    ['a bonus to a damage roll', 'an ally adds 1d8 as a bonus to the damage roll.', '1d8'],
  ])('reads other dice as plain dice: %s', (_, sentence, roll) => {
    const die = action(`Once per long rest, as a bonus action, ${sentence}`);
    expect(die).toMatchObject({ roll, heals: false, plainDice: true });
  });

  it.each([
    'a creature returns to life, regaining a number of hit points equal to 4d10.',
    'a creature returns to life with a number of hit points equal to 4d10.',
  ])('reads hit points brought back as a heal (Hand of Ultimate Mercy wording): %s', (sentence) => {
    const heal = action(`Once per long rest, as a bonus action, ${sentence}`);
    expect(heal).toMatchObject({ roll: '4d10', heals: true, plainDice: false });
  });

  it('keeps damage as damage when it comes first in a sentence that also heals', () => {
    const drain = action(
      'Once per long rest, as a bonus action, a creature takes necrotic damage equal to 1d6, and you regain hit points equal to half of it.',
    );
    expect(drain).toMatchObject({ roll: '1d6', heals: false, plainDice: false });
  });

  it('offers no roll for a d20 it only mentions, nor reads one in place of real dice', () => {
    const test = action(
      'Once per long rest, as a bonus action, you have advantage on d20 tests for 1 hour.',
    );
    expect(test?.economy).toBe('bonus');
    expect(test?.roll).toBeUndefined();
    expect(test?.plainDice).toBe(false);

    const later = action(
      'Once per long rest, as a bonus action, a creature that rolls a d20 takes 2d6 fire damage.',
    );
    expect(later).toMatchObject({ roll: '2d6', plainDice: false });
  });

  it("offers no roll for a d20 that ends a sentence (Hexblade's Curse wording)", () => {
    const crit = action(
      'Once per long rest, as a bonus action, you score a critical hit on a roll of 19 or 20 on the d20.',
    );
    expect(crit?.economy).toBe('bonus');
    expect(crit?.roll).toBeUndefined();
  });

  const ONCE = 'You can use this once per long rest.';

  it.each([
    [
      'reaction',
      'Greater Mark of Warding',
      'You can roll 1d6 instead of 1d4. When a creature attacks you, you can take a Reaction to impose Disadvantage.',
    ],
    [
      'bonus',
      'Spellfire Spark',
      'You reduce the damage taken by 1d4. You can also cast this cantrip as a Bonus Action.',
    ],
    [
      'action',
      'Eldritch Cannon',
      'If the Mending spell is cast on it, it regains 2d6 hit points. You can dismiss it as an action.',
    ],
  ])('offers no %s roll from a die before its sentence (%s wording)', (economy, _, prose) => {
    const chip = action(`${prose} ${ONCE}`);
    expect(chip?.economy).toBe(economy);
    expect(chip?.roll).toBeUndefined();
    expect(chip?.heals).toBe(false);
    expect(chip?.plainDice).toBe(false);
  });

  it('reads past a die before its sentence to the one the action rolls', () => {
    const chip = action(
      `You can roll 1d6 instead of 1d4. As a bonus action, a foe takes 2d8 fire damage. ${ONCE}`,
    );
    expect(chip).toMatchObject({ roll: '2d8', plainDice: false, note: 'fire' });
  });

  it('rolls a die named after its sentence (Elemental Rebuke wording)', () => {
    const chip = action(
      `When you are hit, you can take a Reaction to halve the damage. On a failed save, the attacker takes damage equal to 2d10 plus your Charisma modifier. ${ONCE}`,
    );
    expect(chip).toMatchObject({ economy: 'reaction', roll: '2d10', plainDice: false });
  });

  it('rolls a heal named after its sentence (Fortifying Soul wording)', () => {
    const chip = action(
      `As a Magic action, choose creatures you can see. Each regains hit points equal to 1d10 plus your level. ${ONCE}`,
    );
    expect(chip).toMatchObject({ economy: 'action', roll: '1d10', heals: true });
  });

  it('rolls a die ahead of the phrase in its own sentence (Warding Maneuver wording)', () => {
    const chip = action(`If you are hit by an attack, you can roll 1d8 as a reaction. ${ONCE}`);
    expect(chip).toMatchObject({ economy: 'reaction', roll: '1d8', plainDice: true });
  });

  it.each([
    ['hours (Symbiotic Being)', 'you are Charmed for 1d12 hours.'],
    ['a modifier', 'you are Charmed for 1d4 + 1 hours.'],
    ['rounds', 'you are Stunned for 1d4 rounds.'],
    ['minutes', 'it lasts 1d10 minutes.'],
    ['days', 'it vanishes after 1d4 days.'],
    ['long rests (Limited Wish)', 'you must wait until you finish 1d4 long rests.'],
    ['short rests', 'you must wait until you finish 1d4 short rests.'],
  ])('offers no roll for a die that is a span of time: %s', (_, sentence) => {
    const chip = action(`When you fail a save, you can take a Reaction. ${ONCE} Then ${sentence}`);
    expect(chip?.economy).toBe('reaction');
    expect(chip?.roll).toBeUndefined();
  });

  it('reads past a span of time to the die the action rolls', () => {
    const chip = action(
      `As a bonus action, a foe is Charmed for 1d4 hours and takes 2d6 fire damage. ${ONCE}`,
    );
    expect(chip).toMatchObject({ roll: '2d6', plainDice: false });
  });

  it.each([
    ['the die alone (Psionic Power)', 'at 5th level (d8), 11th level (d10), and 17th level (d12).'],
    ['2024 levels', 'at character levels 5 (2d10), 11 (3d10), and 17 (4d10).'],
    ['2014 levels', 'at 5th level (2d10) and 11th level (3d10).'],
    ['a die before its level', 'to 3d6 at 6th level and 4d6 at 11th level.'],
  ])('offers no roll for a die that is a later level size: %s', (_, steps) => {
    const chip = action(
      `Your dice are each a d6. As a bonus action, you regain one die. ${ONCE} They grow ${steps}`,
    );
    expect(chip?.economy).toBe('bonus');
    expect(chip?.roll).toBeUndefined();
  });

  it('offers no roll for damage the action risks costing you (Ghost Walk wording)', () => {
    const chip = action(
      `As a bonus action, you assume a spectral form. ${ONCE} You can move through objects, but you take 1d10 force damage if you end your turn inside one.`,
    );
    expect(chip?.economy).toBe('bonus');
    expect(chip?.roll).toBeUndefined();
    expect(chip?.note).toBeUndefined();
  });

  it('shows no damage type from a die the limited-use chip does not roll (Dreadnaught wording)', () => {
    const chip = action(
      `The demolisher deals 1d10 force damage on a hit. As a bonus action, you enlarge your armor. ${ONCE}`,
    );
    expect(chip?.economy).toBe('bonus');
    expect(chip?.roll).toBeUndefined();
    expect(chip?.note).toBeUndefined();
  });

  it('reads the damage type from the die it rolls, past a typed die before its sentence', () => {
    const chip = action(
      `The demolisher deals 1d10 force damage on a hit. As a bonus action, a foe takes 2d8 fire damage. ${ONCE}`,
    );
    expect(chip).toMatchObject({ roll: '2d8', note: 'fire' });
  });

  const chipAtLevel = (levels: number, entries: string) => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name: 'Fighter', source: 'PHB' }, levels, hp: [] }];
    const col = new Collector(doc, makeTestContext());
    proseScanFeature(col, 'Trait', entries, origin);
    return col.effects.find((e) => e.kind === 'action');
  };

  it.each([
    ['a die before its level', 'Your bite deals 1d6 damage, and 2d6 at 5th level.'],
    ['a level before its die', 'Your bite deals 1d6 damage, or at 5th level (2d6).'],
  ])('takes no level step from before the die it rolls: %s', (_, earlier) => {
    const prose = `${earlier} As a bonus action, you regain 1d4 hit points. ${ONCE}`;
    expect(chipAtLevel(20, prose)).toMatchObject({ roll: '1d4', heals: true });
  });

  it.each([
    ['a die before its level', 'It grows to 3d6 at 6th level.'],
    ['a level before its die', 'It grows at 6th level (3d6).'],
    ['2024 levels', 'It grows at character levels 6 (3d6) and 11 (4d6).'],
  ])('still scales the die it rolls with its level steps: %s', (_, steps) => {
    const prose = `As a bonus action, a foe takes 2d6 fire damage. ${steps} ${ONCE}`;
    expect(chipAtLevel(5, prose)).toMatchObject({ roll: '2d6' });
    expect(chipAtLevel(6, prose)).toMatchObject({ roll: '3d6' });
  });

  it('still names the damage type on a chip with no uses, which rolls nothing', () => {
    const chip = action('A foe takes 2d6 fire damage. As a bonus action, you do it again.');
    expect(chip?.economy).toBe('bonus');
    expect(chip?.roll).toBeUndefined();
    expect(chip?.note).toBe('fire');
  });
});

describe('proseScanFeature natural weapons', () => {
  const weapon = (effects: EffectInput[]) =>
    effects.find(
      (e): e is Extract<EffectInput, { kind: 'naturalWeapon' }> => e.kind === 'naturalWeapon',
    );

  it('reads the type-first phrasing (Satyr Ram, MOT)', () => {
    const w = weapon(
      scan('Ram', [
        'You can use your head and horns to make unarmed strikes. If you hit with them, you deal bludgeoning damage equal to {@damage 1d4} + your Strength modifier.',
      ]),
    );
    expect(w).toMatchObject({
      label: 'Ram',
      dice: '1d4',
      damageType: 'bludgeoning',
      ability: 'str',
    });
  });

  it('reads the dice-first phrasing (Satyr Ram, MPMM)', () => {
    const w = weapon(
      scan('Ram', [
        'You can use your head and horns to make unarmed strikes. When you hit with them, the strike deals {@damage 1d6} + your Strength modifier bludgeoning damage, instead of the bludgeoning damage normal for an unarmed strike.',
      ]),
    );
    expect(w).toMatchObject({
      label: 'Ram',
      dice: '1d6',
      damageType: 'bludgeoning',
      ability: 'str',
    });
  });

  it('takes the ability from the damage phrase, not elsewhere in the trait', () => {
    // Dhampir: the bite adds CON. A Naga-style trait names CON only in its save
    // DC, so the modifier has to come from the damage sentence itself.
    const bite = weapon(
      scan('Vampiric Bite', [
        'When you use your unarmed strike and deal damage, you can choose to bite with your fangs. You deal piercing damage equal to {@damage 1d4} plus your Constitution modifier instead of the normal damage of an unarmed strike.',
      ]),
    );
    expect(bite).toMatchObject({ dice: '1d4', damageType: 'piercing', ability: 'con' });

    const maw = weapon(
      scan('Natural Weapons', [
        'Your fanged maw is a natural weapon, which you can use to make unarmed strikes. If you hit with your bite, you deal piercing damage equal to {@damage 1d4} + your Strength modifier, and your target must make a Constitution saving throw ({@dc 8} + your proficiency bonus + your Constitution modifier).',
      ]),
    );
    expect(maw?.ability).toBe('str');
  });

  it('ignores a weapon that belongs to a named sub-option (Shifter Longtooth)', () => {
    // Only the Longtooth shifter gets the bite, and only while shifted, so the
    // trait itself must not arm every Beasthide and Swiftstride.
    const w = weapon(
      scan('Shifting', [
        'As a bonus action, you can assume a more bestial appearance.',
        'Whenever you shift, you gain an additional benefit based on one of the following options:',
        {
          type: 'list',
          items: [
            {
              type: 'item',
              name: 'Longtooth',
              entry:
                'You can use your elongated fangs to make an unarmed strike. If you hit with your fangs, you can deal piercing damage equal to {@damage 1d6} + your Strength modifier, instead of the bludgeoning damage normal for an unarmed strike.',
            },
            { type: 'item', name: 'Beasthide', entry: 'You gain temporary hit points.' },
          ],
        },
      ]),
    );
    expect(w).toBeUndefined();
  });

  it('does not turn dice mentioned outside unarmed-strike wording into a weapon', () => {
    expect(
      weapon(scan('Mirthful Leaps', ['Whenever you make a long or high jump, you can roll a d8.'])),
    ).toBeUndefined();
  });
});

describe('proseScanFeature unarmed strike upgrades', () => {
  const weapon = (effects: EffectInput[]) =>
    effects.find(
      (e): e is Extract<EffectInput, { kind: 'naturalWeapon' }> => e.kind === 'naturalWeapon',
    );
  const punch = (effects: EffectInput[]) =>
    effects.find(
      (e): e is Extract<EffectInput, { kind: 'unarmedDamage' }> => e.kind === 'unarmedDamage',
    );

  it('treats a bigger die on an ordinary punch as an upgrade, not a weapon', () => {
    // Unarmed Fighting deals the same damage type off the same ability as the
    // built-in unarmed strike, so its own row would be a strictly better copy.
    const effects = scan('Unarmed Fighting', [
      'When you hit with your unarmed strike and deal damage, you can deal bludgeoning damage equal to {@damage 1d6} plus your Strength modifier instead of the normal damage of an unarmed strike.',
    ]);
    expect(punch(effects)).toMatchObject({ label: 'Unarmed Fighting', dice: '1d6' });
    expect(weapon(effects)).toBeUndefined();
  });

  it('keeps a weapon row when the trait names a body part', () => {
    // Same "instead of the normal damage" wording as the feats above, but a
    // Ram is a distinct thing to attack with.
    const effects = scan('Ram', [
      'You can use your head and horns to make unarmed strikes. When you hit with them, the strike deals {@damage 1d6} + your Strength modifier bludgeoning damage, instead of the bludgeoning damage normal for an unarmed strike.',
    ]);
    expect(weapon(effects)).toMatchObject({ label: 'Ram' });
    expect(punch(effects)).toBeUndefined();
  });

  it('keeps a weapon row when the damage or ability differs from a punch', () => {
    // A Dhampir's bite names no natural weapon, but piercing off CON is a real
    // choice against a bludgeoning STR punch, not a replacement for it.
    const effects = scan('Vampiric Bite', [
      'When you use your unarmed strike and deal damage, you can choose to bite with your fangs. You deal piercing damage equal to {@damage 1d4} plus your Constitution modifier instead of the normal damage of an unarmed strike.',
    ]);
    expect(weapon(effects)).toMatchObject({ ability: 'con', damageType: 'piercing' });
    expect(punch(effects)).toBeUndefined();
  });
});

describe('proseScanFeature: standing bonuses to checks and initiative', () => {
  const BONUS_KINDS: readonly string[] = [
    'halfProf',
    'initiativeBonus',
    'checkBonus',
    'passivePerceptionBonus',
  ];
  const bonusesIn = (effects: readonly EffectInput[]) =>
    effects.filter((e) => BONUS_KINDS.includes(e.kind)).map(({ origin: _, ...effect }) => effect);
  const bonuses = (entries: unknown) => bonusesIn(scan('Odd Knack', entries));

  describe('half proficiency', () => {
    it.each([
      [
        'every check, rounded down',
        "You can add half your proficiency bonus, rounded down, to any ability check that doesn't add your proficiency bonus.",
        { round: 'down' },
      ],
      [
        'the rounding left unsaid, which rounds down',
        'You add half your proficiency bonus to any ability check you make.',
        { round: 'down' },
      ],
      [
        'one ability',
        "You can add half your proficiency bonus (round down) to any Charisma check you make that doesn't already use your proficiency bonus.",
        { round: 'down', abilities: ['cha'] },
      ],
      [
        'a list of abilities, rounded up',
        'You can add half your proficiency bonus (rounded up) to any Intelligence, Wisdom, or Charisma check.',
        { round: 'up', abilities: ['int', 'wis', 'cha'] },
      ],
      [
        'only skills the character lacks',
        "You can add half your proficiency bonus, round down, to any ability check that uses a skill proficiency you lack and that doesn't otherwise use your proficiency bonus.",
        { round: 'down', skillsOnly: true },
      ],
    ])('reads %s', (_name, sentence, expected) => {
      expect(bonuses([sentence])).toEqual([{ kind: 'halfProf', ...expected }]);
    });
  });

  describe('initiative', () => {
    it.each([
      [
        'the proficiency bonus',
        'You can add your proficiency bonus to your initiative roll.',
        'profBonus',
      ],
      [
        'the proficiency bonus once the roll is named',
        'Whenever you roll initiative, you can add your proficiency bonus to the roll.',
        'profBonus',
      ],
      [
        'a bonus that only equals the proficiency bonus',
        'You gain a bonus to initiative equal to your proficiency bonus.',
        'equalToProfBonus',
      ],
      [
        'a bonus shared with others',
        'When you and any allies you choose within 5 feet of you roll initiative, you all gain a bonus to initiative equal to your proficiency bonus.',
        'equalToProfBonus',
      ],
      [
        'an optional modifier given as a bonus',
        'You can give yourself a bonus to initiative equal to your Intelligence modifier.',
        'abilityModMin0:int',
      ],
      [
        'an optional modifier added to the rolls',
        'You can add your Strength modifier to your initiative rolls.',
        'abilityModMin0:str',
      ],
      [
        'an optional modifier added to the roll',
        'When you roll initiative, you can add your Charisma modifier to the roll.',
        'abilityModMin0:cha',
      ],
      [
        'a modifier that is not optional',
        'You gain a bonus to your initiative rolls equal to your Wisdom modifier.',
        'abilityMod:wis',
      ],
      [
        'a modifier with a floor',
        'You gain a bonus to your initiative rolls equal to your Wisdom modifier (minimum of +1).',
        'abilityModMin1:wis',
      ],
      ['a flat number', 'You gain a +3 bonus to initiative.', 3],
      ['a flat number on the rolls', 'You have a +2 bonus to your initiative rolls.', 2],
    ])('reads %s', (_name, sentence, amount) => {
      expect(bonuses([sentence])).toEqual([{ kind: 'initiativeBonus', amount }]);
    });
  });

  describe('named checks', () => {
    it.each([
      [
        'every check of an ability',
        'Whenever you make a Charisma check, you gain a bonus to the check equal to your Intelligence modifier (minimum of +1).',
        { ability: 'cha', amount: 'abilityModMin1:int' },
      ],
      [
        'one skill',
        'Whenever you make a Wisdom (Survival) check, you gain a bonus to the check equal to your Strength modifier.',
        { skills: ['Survival'], amount: 'abilityMod:str' },
      ],
      [
        'a skill of more than one word',
        'You gain a bonus to your Dexterity (Sleight of Hand) checks equal to your Charisma modifier.',
        { skills: ['Sleight of Hand'], amount: 'abilityMod:cha' },
      ],
      [
        'several skills',
        'You have a bonus to your Intelligence (Arcana, History, or Nature) checks equal to your Wisdom modifier.',
        { skills: ['Arcana', 'History', 'Nature'], amount: 'abilityMod:wis' },
      ],
      [
        'a skill with no ability beside it, and an optional modifier',
        'You can give yourself a bonus to your Perception checks equal to your Intelligence modifier.',
        { skills: ['Perception'], amount: 'abilityModMin0:int' },
      ],
      [
        'a size left to the next sentence',
        'Your bond with the deep woods gives you a bonus to your Intelligence (Nature or History) checks. The bonus equals your Charisma modifier (a minimum of +1).',
        { skills: ['Nature', 'History'], amount: 'abilityModMin1:cha' },
      ],
      [
        'the other spelling of the floor',
        'Your bond with the tides gives you a bonus to your Strength checks. The bonus equals your Charisma modifier (minimum bonus of +1).',
        { ability: 'str', amount: 'abilityModMin1:cha' },
      ],
    ])('reads %s', (_name, entries, expected) => {
      expect(bonuses([entries])).toEqual([{ kind: 'checkBonus', ...expected }]);
    });
  });

  it.each([
    'You have a +3 bonus to your passive Wisdom (Perception) score.',
    'You gain a +3 bonus to your passive Perception.',
    'You have a +3 bonus to your passive Perception and passive Investigation scores.',
  ])('reads a flat bonus to passive Perception: %s', (sentence) => {
    expect(bonuses([sentence])).toEqual([{ kind: 'passivePerceptionBonus', amount: 3 }]);
  });

  describe('where the sentence sits', () => {
    const hare = [{ kind: 'initiativeBonus', amount: 'profBonus' }];
    const SENTENCE = 'You add your proficiency bonus to your initiative rolls.';
    const CLAUSE = 'you add your proficiency bonus to your initiative rolls.';

    it.each([
      ['after other sentences', `Your ears twitch at any snap. ${SENTENCE}`],
      ['after "in addition"', `In addition, ${CLAUSE}`],
      ['after "additionally"', `Additionally, ${CLAUSE}`],
      ['after "as a result"', `As a result, ${CLAUSE}`],
      ['before other sentences', `${SENTENCE} Your ears twitch at any snap.`],
      ['after a sentence with a condition of its own', `You glow while awake. ${SENTENCE}`],
    ])('finds it %s', (_name, entries) => {
      expect(bonuses([entries])).toEqual(hare);
    });

    describe('after a level', () => {
      const atLevel = (levels: number, entries: unknown) => {
        const doc = newCharacterDoc('c', 'H', 't');
        doc.classes = [{ ref: { name: 'Fighter', source: 'PHB' }, levels, hp: [] }];
        const col = new Collector(doc, makeTestContext());
        proseScanFeature(col, 'Odd Knack', entries, origin);
        return bonusesIn(col.effects);
      };

      it.each([
        'Starting at 6th level',
        'Beginning at 6th level',
        'At 6th level',
        'By 6th level',
      ])('waits for the level: %s', (lead) => {
        expect(atLevel(5, [`${lead}, ${CLAUSE}`])).toEqual([]);
        expect(atLevel(6, [`${lead}, ${CLAUSE}`])).toEqual(hare);
      });

      it('holds back only the bonus that names the level', () => {
        const entries = [
          'You gain a +1 bonus to initiative. At 10th level, you can add half your proficiency bonus to any Strength check.',
        ];
        expect(atLevel(9, entries)).toEqual([{ kind: 'initiativeBonus', amount: 1 }]);
        expect(atLevel(10, entries)).toEqual([
          { kind: 'initiativeBonus', amount: 1 },
          { kind: 'halfProf', round: 'down', abilities: ['str'] },
        ]);
      });
    });

    describe('under a heading that governs what follows', () => {
      const list = {
        type: 'list',
        items: ['You gain a +3 bonus to initiative.', 'You never trip.'],
      };
      const quick = {
        type: 'entries',
        name: 'Quick',
        entries: ['You gain a +3 bonus to initiative.'],
      };
      const keen = {
        type: 'entries',
        name: 'Keen',
        entries: ['You gain a +1 bonus to initiative.'],
      };

      it.each([
        ['a state over a list', ['While you are raging, you gain the following benefits:', list]],
        [
          'a state over a benefit',
          ['While you are raging, you gain the following benefits.', quick],
        ],
        [
          'a state ending the heading',
          ['You gain the following benefits while you are raging:', list],
        ],
        ['a trigger with no "following"', ['When you rage, you gain these benefits:', list]],
        ['a choice over benefits', ['Choose one of the following benefits.', quick, keen]],
        ['a choice over a list', ['Choose one of the following:', list]],
        ['a choice mid-sentence', ['You gain one of the following benefits of your choice:', list]],
      ])('adds nothing for %s', (_name, entries) => {
        expect(bonuses(entries)).toEqual([]);
      });
    });

    describe('after a sentence that governs what follows', () => {
      it.each([
        [
          'a state',
          'While you are raging, you have resistance to cold damage. In addition, you gain a +2 bonus to initiative.',
        ],
        [
          'an action in its opener',
          'As a bonus action, you can enter a battle trance for 1 minute. You have a +5 bonus to your initiative rolls.',
        ],
        [
          'an action in its tail',
          'You can enter a battle trance as a bonus action. You have a +5 bonus to your initiative rolls.',
        ],
        [
          'a trigger',
          'When you are hit, you can snarl. Additionally, you can add half your proficiency bonus to any Strength check.',
        ],
        [
          'a duration',
          'For 1 minute, you glow. As a result, whenever you make a Strength check, you gain a bonus to the check equal to your Constitution modifier.',
        ],
      ])('adds nothing for %s', (_name, entries) => {
        expect(bonuses([entries])).toEqual([]);
      });

      it('stands in a later string, which is another benefit', () => {
        expect(bonuses(['When you are hit, you can snarl.', SENTENCE])).toEqual(hare);
      });
    });

    it('reads a string of its own after a heading with no full stop', () => {
      expect(bonuses(['{@i 3rd-level Odd feature}', SENTENCE])).toEqual(hare);
    });

    it('reads tags as the words they display', () => {
      expect(
        bonuses([
          'Whenever you roll {@variantrule Initiative|XPHB}, you can add your {@variantrule Proficiency|XPHB|Proficiency Bonus} to the roll.',
        ]),
      ).toEqual(hare);
      expect(
        bonuses([
          'Your bond with the tides gives you a bonus to your Intelligence ({@skill Arcana|XPHB} or {@skill Nature|XPHB}) checks. The bonus equals your Constitution modifier.',
        ]),
      ).toEqual([{ kind: 'checkBonus', skills: ['Arcana', 'Nature'], amount: 'abilityMod:con' }]);
      expect(
        bonuses([
          'You can add half your {@variantrule Proficiency|XPHB|Proficiency Bonus} to any ability check that doesn’t already include your {@variantrule Proficiency|XPHB|Proficiency Bonus}.',
        ]),
      ).toEqual([{ kind: 'halfProf', round: 'down' }]);
    });

    it('reads a named benefit under a plain heading', () => {
      expect(
        bonuses([
          'You gain the following boons.',
          { type: 'entries', name: 'Quick Ears', entries: [SENTENCE] },
        ]),
      ).toEqual(hare);
    });

    it('reads an unnamed list item under a plain heading', () => {
      expect(
        bonuses([
          'You gain the following boons:',
          { type: 'list', items: ['You gain a +3 bonus to initiative.', 'You never trip.'] },
        ]),
      ).toEqual([{ kind: 'initiativeBonus', amount: 3 }]);
    });

    it('skips a named option, which the player has to pick', () => {
      expect(
        bonuses([
          'Choose one of these knacks.',
          {
            type: 'list',
            items: [{ type: 'item', name: 'Quick Ears', entries: [SENTENCE] }],
          },
        ]),
      ).toEqual([]);
    });

    it('takes each bonus a feature grants', () => {
      expect(
        bonuses([
          'You can add your Wisdom modifier to your initiative rolls.',
          'You can add half your proficiency bonus to any Strength check.',
        ]),
      ).toEqual([
        { kind: 'initiativeBonus', amount: 'abilityModMin0:wis' },
        { kind: 'halfProf', round: 'down', abilities: ['str'] },
      ]);
    });
  });

  describe('a bonus with limited uses', () => {
    it.each([
      [
        'a limit by name',
        'Whenever you roll initiative, you can add your proficiency bonus to the roll. Once you do so, you must wait until dawn.',
      ],
      [
        'a limit by rest',
        "You can add your Wisdom modifier to your initiative rolls. You can't use this trait again until you finish a long rest.",
      ],
      [
        'a limit by count',
        'You gain a +2 bonus to initiative. You can do so a number of times equal to your proficiency bonus.',
      ],
      [
        'a limit past the size',
        'You gain a bonus to your Strength checks. The bonus equals your Wisdom modifier. You can do so a number of times equal to your proficiency bonus.',
      ],
      [
        'a limit past another sentence',
        "You can add your Wisdom modifier to your initiative rolls. You feel the rush. You can't use this trait again until you finish a long rest.",
      ],
      [
        'a limit on a benefit',
        "You gain a +2 bonus to initiative. You can't use this benefit again until you finish a long rest.",
      ],
      ['a limit per day', 'You gain a +2 bonus to initiative. You can do so once per day.'],
      ['a duration', 'You gain a +2 bonus to initiative. This bonus lasts for 3 rounds.'],
      [
        'a way to lose it',
        'You gain a +2 bonus to initiative. You lose this bonus if you wear heavy armor.',
      ],
      [
        'a place',
        'You gain a +2 bonus to initiative. This bonus applies only in your favored terrain.',
      ],
    ])('is no sheet number when a later sentence sets %s', (_name, entries) => {
      expect(bonuses([entries])).toEqual([]);
    });

    it('stands beside a limit that belongs to another benefit', () => {
      const effects = scan('Odd Knack', [
        'You can bite for 1d6 extra damage. You can use it a number of times equal to your Wisdom modifier, and you regain all expended uses when you finish a long rest.',
        'Whenever you roll initiative, you can add your Wisdom modifier to the roll.',
      ]);
      expect(bonusesIn(effects)).toEqual([
        { kind: 'initiativeBonus', amount: 'abilityModMin0:wis' },
      ]);
      expect(effects.find((e) => e.kind === 'resource')).toMatchObject({ max: 'abilityMod:wis' });
    });
  });

  describe('adds nothing for', () => {
    it.each([
      // A condition the openers and tails leave room for.
      [
        'a condition inside the subject',
        'Your aura while you are raging gives you a bonus to your Strength checks equal to your Wisdom modifier.',
      ],
      [
        'a condition among those rolling',
        'When you and your allies are surprised and roll initiative, you can add your Wisdom modifier to the roll.',
      ],
      [
        'a place among those rolling',
        'When you and any allies in a forest roll initiative, you can add your Wisdom modifier to the roll.',
      ],
      // Doubling is a proficiency level the data grants, not a bonus.
      [
        'doubled proficiency',
        'Your proficiency bonus is doubled for any ability check you make with the chosen skill.',
      ],
      [
        'a doubled bonus on a condition',
        'Whenever you make an Intelligence (History) check about old maps, you can add twice your proficiency bonus.',
      ],
      ['an added doubled bonus', 'You add double your proficiency bonus to your initiative roll.'],
      // Advantage has no number on the sheet.
      ['advantage on initiative', 'You have advantage on your initiative rolls.'],
      ['advantage on a check', 'You have advantage on your Strength checks.'],
      // A trigger: rolls cannot take a toggled bonus yet.
      [
        'a state in the opener',
        'While raging, you add your proficiency bonus to your initiative rolls.',
      ],
      ['a duration in the opener', 'For 10 minutes, you gain a +2 bonus to initiative.'],
      ['an action in the opener', 'As a bonus action, you gain a +5 bonus to initiative.'],
      ['a state in the tail', 'You gain a +10 bonus to initiative as long as you stay hidden.'],
      [
        'half proficiency in a state',
        'You can add half your proficiency bonus to any Strength check while you hold a rope.',
      ],
      [
        'a narrowed check',
        'Whenever you make a Wisdom (Survival) check related to swamps, you gain a bonus to the check equal to your Wisdom modifier.',
      ],
      [
        'a flat bonus in a state',
        'For 1 hour, you gain a +2 bonus to all ability checks that use Strength.',
      ],
      [
        'a reaction',
        'When a creature you can see makes an ability check, you can use your reaction to add your Intelligence modifier to the roll.',
      ],
      [
        'a spent resource',
        'When you roll initiative, you can expend one knack die and add the die to the roll.',
      ],
      [
        'a spell',
        'You can cast the spell, and you can add your proficiency bonus to its ability check.',
      ],
      // Someone else's roll.
      ['an ally', 'Each ally within 30 feet of you gains a +2 bonus to initiative.'],
      ['a target', 'The target adds 1d6 to its initiative roll.'],
      [
        'a wearer',
        'When the wearer makes a Strength check, it can spend a charge to add a bonus to the roll equal to its Intelligence modifier.',
      ],
      ['a companion', 'Your companion can add your proficiency bonus to its initiative rolls.'],
      // No number the sheet can use.
      [
        'a skill the player chose',
        'When you make a check with the chosen skill, you have a bonus to the check equal to your Constitution modifier.',
      ],
      ['no size', 'Whenever you make a Strength check, you gain a bonus to the check.'],
      [
        'a size that is not a modifier',
        'You gain a bonus to initiative equal to the number rolled.',
      ],
      [
        'a name that is no skill',
        'You gain a bonus to your Cooking checks equal to your Wisdom modifier.',
      ],
      [
        'every check by modifier',
        'You gain a bonus to your ability checks equal to your Wisdom modifier.',
      ],
      ['a roll it does not name', 'You can add your proficiency bonus to the roll.'],
      // The same words, about something else.
      [
        'half proficiency setting a level',
        'You regain one spell slot of a level no higher than half your proficiency bonus (rounded up).',
      ],
      [
        'half proficiency setting a count',
        'You know a number of tricks equal to half your proficiency bonus (rounded down).',
      ],
      [
        'half proficiency as hit points',
        'You regain hit points equal to half your proficiency bonus.',
      ],
      [
        'a use back on initiative',
        'When you roll initiative, you regain one expended use of this trait.',
      ],
      ['a turn order', 'In combat, the companion shares your initiative count.'],
      ['a companion rolling', 'Roll initiative for the companion, which takes its own turns.'],
      [
        'a save DC',
        'A creature can see through it with a Wisdom (Insight) check against a DC of 8 + your proficiency bonus + your Charisma modifier.',
      ],
      ['a passive score left alone', 'You always know your passive Wisdom (Perception) score.'],
      [
        'passive Perception for others',
        'Each ally within 10 feet of you has a +2 bonus to passive Wisdom (Perception) scores.',
      ],
    ])('%s', (_name, entries) => {
      expect(bonuses([entries])).toEqual([]);
    });
  });

  describe('a homebrew feature worded like a curated one', () => {
    const noData = { get: () => undefined, byType: () => [] };
    const curatedEffects = (key: string, uid: string) => {
      const col = new Collector(newCharacterDoc('c', 'H', 't'), noData);
      expect(emitCuratedEffects(col, key, { ...origin, uid })).toBe(true);
      return col.effects;
    };

    const WORDED_LIKE: ReadonlyArray<[string, string, string[]]> = [
      [
        'jack of all trades|bard',
        'bard|phb',
        [
          "Your years on the road pay off. You can add half your proficiency bonus, rounded down, to any ability check that doesn't already add your proficiency bonus.",
        ],
      ],
      [
        'jack of all trades|bard',
        'bard|xphb',
        [
          "You can add half your proficiency bonus (round down) to any ability check that uses a skill proficiency you lack and that doesn't otherwise add your proficiency bonus.",
        ],
      ],
      [
        'remarkable athlete|champion',
        'champion|phb',
        [
          "You can add half your proficiency bonus (round up) to any Strength, Dexterity, or Constitution check that doesn't already add your proficiency bonus.",
        ],
      ],
      [
        "trait:kefnet's blessing",
        'race|x',
        [
          "You can add half your proficiency bonus, rounded down, to any Intelligence check that doesn't already add your proficiency bonus.",
        ],
      ],
      [
        'trait:hare-trigger',
        'race|x',
        ['Nothing startles you for long. You add your proficiency bonus to your initiative rolls.'],
      ],
      [
        'alert|xphb',
        'x',
        ['Whenever you roll initiative, you can add your proficiency bonus to the roll.'],
      ],
      ['alert|phb', 'x', ['You have a +5 bonus to your initiative rolls.']],
      [
        'dread ambusher|gloom stalker',
        'gloom stalker|xge',
        [
          'You sense trouble early. You can give yourself a bonus to your initiative roll equal to your Wisdom modifier.',
        ],
      ],
      [
        'temporal awareness|chronurgy magic',
        'x',
        ['Whenever you roll initiative, you can add your Intelligence modifier to the roll.'],
      ],
      [
        'thaumaturge|cleric',
        'x',
        [
          'Your study of old temples gives you a bonus to your Intelligence (Arcana or Religion) checks. The bonus equals your Wisdom modifier (a minimum of +1).',
        ],
      ],
      [
        'otherworldly glamour|fey wanderer',
        'x',
        [
          'When you make a Charisma check, you have a bonus to the check equal to your Wisdom modifier (a minimum of +1).',
        ],
      ],
      [
        'elegant courtier|samurai',
        'x',
        [
          'When you make a Charisma (Persuasion) check, you have a bonus to the check equal to your Wisdom modifier.',
        ],
      ],
      ['observant|phb', 'x', ['You have a +5 bonus to your passive Wisdom (Perception) score.']],
    ];

    it.each(WORDED_LIKE)('emits what %s (%s) emits', (key, uid, entries) => {
      const curated = bonusesIn(curatedEffects(key, uid));
      expect(curated.length).toBeGreaterThan(0);
      expect(bonuses(entries)).toEqual(curated);
    });

    // The sheet, end to end: a homebrew race's trait against the same race with
    // the curated entry's effects on it. DEX +1, INT +1, WIS +2, CHA -1, proficiency +2.
    const sheetOf = (entries: string[] | undefined, customEffects: EffectInput[] = []) => {
      const race = {
        name: 'Hearthkin',
        source: 'HB',
        entries: entries === undefined ? [] : [{ name: 'Odd Knack', type: 'entries', entries }],
      };
      const doc = newCharacterDoc('c', 'H', 't');
      doc.abilities.method = 'manual';
      doc.abilities.base = { str: 10, dex: 12, con: 10, int: 13, wis: 14, cha: 8 };
      doc.race = { name: race.name, source: race.source };
      doc.customEffects = customEffects;
      return deriveSheet(doc, {
        get: (type) => (type === 'race' ? race : undefined),
        byType: (type) => (type === 'race' ? [race] : []),
      });
    };
    const numbers = (sheet: ReturnType<typeof sheetOf>) => ({
      initiative: sheet.initiative.value,
      passive: sheet.passivePerception.value,
      checks: Object.fromEntries(
        Object.entries(sheet.checks).map(([ability, check]) => [ability, check.total.value]),
      ),
      skills: Object.fromEntries(
        Object.entries(sheet.skills).map(([name, skill]) => [name, skill?.total.value]),
      ),
    });

    it.each(WORDED_LIKE)('changes the sheet as %s (%s) does', (key, uid, entries) => {
      const homebrew = numbers(sheetOf(entries));
      expect(homebrew).toEqual(numbers(sheetOf(undefined, curatedEffects(key, uid))));
      expect(homebrew).not.toEqual(numbers(sheetOf(undefined)));
    });

    it('puts the numbers where the prose says', () => {
      const plain = numbers(sheetOf(undefined));
      expect(plain.initiative).toBe(1);
      const initiativeOf = (sentence: string) => numbers(sheetOf([sentence])).initiative;
      expect(initiativeOf('You add your proficiency bonus to your initiative rolls.')).toBe(3);
      expect(initiativeOf('You can add your Wisdom modifier to your initiative rolls.')).toBe(3);
      const student = numbers(
        sheetOf([
          'Your study gives you a bonus to your Intelligence (Arcana or Religion) checks. The bonus equals your Wisdom modifier (a minimum of +1).',
        ]),
      );
      expect(student.skills.Arcana).toBe((plain.skills.Arcana ?? 0) + 2);
      expect(student.skills.Religion).toBe((plain.skills.Religion ?? 0) + 2);
      expect(student.skills.History).toBe(plain.skills.History);
      expect(student.initiative).toBe(plain.initiative);
    });

    it('keeps a negative modifier off the roll only where the prose makes it optional', () => {
      const initiativeOf = (sentence: string) => numbers(sheetOf([sentence])).initiative;
      expect(initiativeOf('You can add your Charisma modifier to your initiative rolls.')).toBe(1);
      expect(
        initiativeOf('You gain a bonus to your initiative rolls equal to your Charisma modifier.'),
      ).toBe(0);
      expect(
        initiativeOf(
          'You gain a bonus to your initiative rolls equal to your Charisma modifier (minimum of +1).',
        ),
      ).toBe(2);
    });

    it('changes nothing for a trait without that wording', () => {
      expect(numbers(sheetOf(['You have advantage on your initiative rolls.']))).toEqual(
        numbers(sheetOf(undefined)),
      );
    });
  });
});
