import { describe, expect, it } from 'vitest';
import { Collector } from '../effects/base';
import {
  type DataEntity,
  type EffectInput,
  type EffectOrigin,
  type EngineContext,
  newCharacterDoc,
} from '../types';
import { emitCuratedEffects, emitCuratedTrait } from './curatedEffects';

const ctx: EngineContext = { get: () => undefined, byType: () => [] };
const origin: EffectOrigin = { label: 'Feature', uid: 'x', type: 'class' };

function col(className?: string, levels = 5) {
  const doc = newCharacterDoc('c', 'H', 't');
  if (className) doc.classes = [{ ref: { name: className, source: 'PHB' }, levels, hp: [] }];
  return new Collector(doc, ctx);
}

describe('emitCuratedEffects', () => {
  it('returns false and emits nothing for an unknown key', () => {
    const c = col();
    expect(emitCuratedEffects(c, 'nonexistent|zzz', origin)).toBe(false);
    expect(c.effects).toEqual([]);
  });

  it('emits Alert’s +5 initiative', () => {
    const c = col();
    expect(emitCuratedEffects(c, 'alert|phb', origin)).toBe(true);
    expect(c.effects).toContainEqual(
      expect.objectContaining({ kind: 'initiativeBonus', amount: 5 }),
    );
  });

  it('marks the rolls that give hit points back as heals, and no others', () => {
    const rolls = (key: string, className?: string) => {
      const c = col(className);
      emitCuratedEffects(c, key, origin);
      return c.effects.flatMap((e) => (e.kind === 'action' && e.roll ? [e.heals === true] : []));
    };
    expect(rolls('healer|phb')).toEqual([true]);
    expect(rolls('healer|xphb')).toEqual([true]);
    expect(rolls('polearm master|phb')).toEqual([false]);
  });

  it('emits the Lay on Hands pool as 5 x paladin level with an action', () => {
    const c = col('Paladin', 5);
    expect(emitCuratedEffects(c, 'lay on hands|paladin', origin)).toBe(true);
    expect(c.effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', key: 'lay-on-hands', max: 25, resetOn: 'long' }),
    );
    expect(c.effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'action', label: 'Lay on Hands' }),
    );
  });

  it('makes Lay on Hands a bonus action under 2024 rules', () => {
    const c = col('Paladin', 3);
    c.doc.rulesVersion = '2024';
    emitCuratedEffects(c, 'lay on hands|paladin', origin);
    expect(c.effects).toContainEqual(
      expect.objectContaining({ kind: 'action', economy: 'bonus', label: 'Lay on Hands' }),
    );
  });

  it('scales paladin Channel Divinity by edition and level', () => {
    const c2014 = col('Paladin', 12);
    emitCuratedEffects(c2014, 'channel divinity|paladin', origin);
    expect(c2014.effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', key: 'channel-divinity-paladin', max: 1 }),
    );

    const c2024 = col('Paladin', 12);
    c2024.doc.rulesVersion = '2024';
    emitCuratedEffects(c2024, 'channel divinity|paladin', origin);
    expect(c2024.effects).toContainEqual(
      expect.objectContaining({ kind: 'resource', key: 'channel-divinity-paladin', max: 3 }),
    );
  });

  it('keeps paladin and cleric Channel Divinity in separate pools', () => {
    // Sharing one key made the max depend on which class was added first, and
    // the 2024 text is explicit that the uses belong to each class separately.
    const c = col('Paladin', 5);
    c.doc.classes.push({ ref: { name: 'Cleric', source: 'PHB' }, levels: 6, hp: [] });
    emitCuratedEffects(c, 'channel divinity|paladin', origin);
    emitCuratedEffects(c, 'channel divinity|cleric', origin);
    const keys = c.effects
      .filter((e) => e.kind === 'resource')
      .map((e) => (e as Extract<typeof e, { kind: 'resource' }>).key);
    expect(new Set(keys)).toEqual(new Set(['channel-divinity-paladin', 'channel-divinity']));
  });

  it('emits Arcane Recovery once per long rest', () => {
    const c = col('Wizard', 2);
    expect(emitCuratedEffects(c, 'arcane recovery|wizard', origin)).toBe(true);
    expect(c.effects).toContainEqual(
      expect.objectContaining({
        kind: 'resource',
        key: 'arcane-recovery',
        max: 1,
        resetOn: 'long',
      }),
    );
  });

  it('emits a stacking superiority-dice pool for Battle Master', () => {
    const c = col('Fighter', 5);
    expect(emitCuratedEffects(c, 'combat superiority|battle master', origin)).toBe(true);
    const pool = c.effects.find(
      (e): e is Extract<typeof e, { kind: 'resource' }> =>
        e.kind === 'resource' && e.key === 'superiority-dice',
    );
    expect(pool).toBeDefined();
    expect(pool?.stack).toBe(true);
    expect(typeof pool?.max === 'number' && pool.max > 0).toBe(true);
  });
});

describe('features that add to checks and initiative', () => {
  const printing = (uid: string): EffectOrigin => ({ label: 'Feature', uid, type: 'class' });
  const emit = (key: string, uid = 'x') => {
    const c = col();
    expect(emitCuratedEffects(c, key, printing(uid))).toBe(true);
    return c.effects.map(({ origin: _, ...e }) => e);
  };

  it('reads Jack of All Trades by printing: every check in 2014, skills only in 2024', () => {
    expect(emit('jack of all trades|bard', 'bard|phb')).toEqual([
      { kind: 'halfProf', round: 'down' },
    ]);
    expect(emit('jack of all trades|bard', 'bard|xphb')).toEqual([
      { kind: 'halfProf', round: 'down', skillsOnly: true },
    ]);
  });

  it('gives Remarkable Athlete half proficiency only in its 2014 printing', () => {
    expect(emit('remarkable athlete|champion', 'champion|phb')).toEqual([
      { kind: 'halfProf', round: 'up', abilities: ['str', 'dex', 'con'] },
    ]);
    // The 2024 feature grants advantage instead, and its prose holds nothing
    // the scanner would have found.
    expect(emit('remarkable athlete|champion', 'champion|xphb')).toEqual([]);
  });

  it('keeps the 2024 Dread Ambusher uses the prose scan used to find', () => {
    expect(emit('dread ambusher|gloom stalker', 'gloom stalker|xge')).toEqual([
      { kind: 'initiativeBonus', amount: 'abilityModMin0:wis' },
    ]);
    expect(emit('dread ambusher|gloom stalker', 'gloom stalker|xphb')).toContainEqual({
      kind: 'resource',
      key: 'dread-ambusher',
      label: 'Dread Ambusher',
      max: 'abilityMod:wis',
      resetOn: 'long',
    });
  });

  it.each([
    ['alert|xphb', 'profBonus'],
    ['trait:hare-trigger', 'profBonus'],
    ['aura of the sentinel|oath of the watchers', 'equalToProfBonus'],
    ['rakish audacity|swashbuckler', 'abilityModMin0:cha'],
    ['tactical wit|war magic', 'abilityModMin0:int'],
    ['temporal awareness|chronurgy magic', 'abilityModMin0:int'],
  ])('%s adds %s to initiative', (key, amount) => {
    expect(emit(key)).toEqual([{ kind: 'initiativeBonus', amount }]);
  });

  it('adds to the checks each feature names', () => {
    expect(emit('thaumaturge|cleric')).toEqual([
      { kind: 'checkBonus', skills: ['Arcana', 'Religion'], amount: 'abilityModMin1:wis' },
    ]);
    expect(emit('magician|druid')).toEqual([
      { kind: 'checkBonus', skills: ['Arcana', 'Nature'], amount: 'abilityModMin1:wis' },
    ]);
    expect(emit('otherworldly glamour|fey wanderer')).toEqual([
      { kind: 'checkBonus', ability: 'cha', amount: 'abilityModMin1:wis' },
    ]);
    expect(emit('elegant courtier|samurai')).toEqual([
      { kind: 'checkBonus', skills: ['Persuasion'], amount: 'abilityMod:wis' },
    ]);
    expect(emit("trait:kefnet's blessing")).toEqual([
      { kind: 'halfProf', round: 'down', abilities: ['int'] },
    ]);
    expect(emit('observant|phb')).toEqual([{ kind: 'passivePerceptionBonus', amount: 5 }]);
  });
});

describe('pools a cost spends', () => {
  const printed = (source: string): EffectOrigin => ({
    label: 'Feature',
    uid: `feature|${source}`,
    type: 'class',
  });
  const emit = (key: string, cls: string, levels: number, from: EffectOrigin) => {
    const c = col(cls, levels);
    expect(emitCuratedEffects(c, key, from)).toBe(true);
    return c.effects;
  };
  const resource = (effects: EffectInput[], key: string) =>
    effects.find((e) => e.kind === 'resource' && e.key === key) as
      | Extract<EffectInput, { kind: 'resource' }>
      | undefined;
  const action = (effects: EffectInput[]) =>
    effects.find((e) => e.kind === 'action') as
      | Extract<EffectInput, { kind: 'action' }>
      | undefined;

  it('counts Wild Shape by the printing: 2 uses in 2014, more with levels in 2024', () => {
    const uses = (levels: number, source: string) =>
      resource(emit('wild shape|druid', 'Druid', levels, printed(source)), 'wild-shape')?.max;
    expect(uses(20, 'phb')).toBe(2);
    expect([2, 5, 6, 16, 17].map((level) => uses(level, 'xphb'))).toEqual([2, 2, 3, 3, 4]);
  });

  it('gives Wild Shape the slot its printing says', () => {
    const slot = (source: string) =>
      action(emit('wild shape|druid', 'Druid', 2, printed(source)))?.economy;
    expect(slot('phb')).toBe('action');
    expect(slot('xphb')).toBe('bonus');
  });

  it.each([
    ['psionic power|psi warrior', 'Fighter', 'psi-warrior-dice'],
    ['psionic power|soulknife', 'Rogue', 'soulknife-dice'],
  ])('keeps a pool per subclass for %s', (key, cls, pool) => {
    const dice = (levels: number, source: string) =>
      resource(emit(key, cls, levels, printed(source)), pool);
    // 2014: twice the proficiency bonus, whatever the class level.
    expect(dice(3, 'tce')?.max).toBe('twiceProfBonus');
    expect(dice(3, 'tce')?.resetOn).toBe('long');
    // 2024 prints a table.
    expect([3, 5, 9, 11, 13, 17].map((level) => dice(level, 'xphb')?.max)).toEqual([
      4, 6, 8, 8, 10, 12,
    ]);
    // The die grows at the same levels in both.
    expect([3, 5, 11, 17].map((level) => dice(level, 'xphb')?.label)).toEqual([
      'Psionic Energy Dice (d6)',
      'Psionic Energy Dice (d8)',
      'Psionic Energy Dice (d10)',
      'Psionic Energy Dice (d12)',
    ]);
  });

  it('keeps the 2014 bonus action that regains a die, which 2024 does not have', () => {
    const emitted = (source: string) =>
      emit('psionic power|psi warrior', 'Fighter', 3, printed(source));
    expect(resource(emitted('tce'), 'psionic-power')?.max).toBe(1);
    expect(action(emitted('tce'))?.economy).toBe('bonus');
    expect(resource(emitted('xphb'), 'psionic-power')).toBeUndefined();
    expect(action(emitted('xphb'))).toBeUndefined();
  });

  it('refills a die with the 2014 bonus action', () => {
    const emitted = emit('psionic power|soulknife', 'Rogue', 3, printed('tce'));
    expect(action(emitted)?.regains).toEqual({ resource: 'soulknife-dice', amount: 1 });
  });

  it('regains one die on a short rest in 2024, and none in 2014', () => {
    const dice = (source: string) =>
      resource(
        emit('psionic power|psi warrior', 'Fighter', 3, printed(source)),
        'psi-warrior-dice',
      );
    expect(dice('xphb')).toMatchObject({ resetOn: 'long', regainOnShort: 1 });
    expect(dice('tce')).toMatchObject({ resetOn: 'long' });
    expect(dice('tce')?.regainOnShort).toBeUndefined();
  });

  it('brings Wild Shape back by the printing: one on a short rest in 2024, all in 2014', () => {
    const shape = (source: string) =>
      resource(emit('wild shape|druid', 'Druid', 2, printed(source)), 'wild-shape');
    expect(shape('xphb')).toMatchObject({ resetOn: 'long', regainOnShort: 1 });
    expect(shape('phb')).toMatchObject({ resetOn: 'short' });
    expect(shape('phb')?.regainOnShort).toBeUndefined();
  });

  it('brings Rage back by the printing, and only 2014 is unlimited at 20', () => {
    const rage = (levels: number, source: string) =>
      resource(emit('rage|barbarian', 'Barbarian', levels, printed(source)), 'rage');
    expect(rage(3, 'xphb')).toMatchObject({ max: 3, resetOn: 'long', regainOnShort: 1 });
    expect(rage(3, 'phb')).toMatchObject({ max: 3, resetOn: 'long' });
    expect(rage(3, 'phb')?.regainOnShort).toBeUndefined();
    expect(rage(19, 'xphb')?.max).toBe(6);
    expect(rage(20, 'xphb')?.max).toBe(6);
    expect(rage(20, 'phb')?.max).toBe(99);
  });

  it.each([
    ['second wind|fighter', 'Fighter', 'second-wind'],
    ['channel divinity|cleric', 'Cleric', 'channel-divinity'],
    ['channel divinity|paladin', 'Paladin', 'channel-divinity-paladin'],
  ])('brings %s back by the rules version', (key, cls, pool) => {
    const of = (version: '2014' | '2024') => {
      const c = col(cls, 5);
      c.doc.rulesVersion = version;
      emitCuratedEffects(c, key, origin);
      return resource(c.effects, pool);
    };
    expect(of('2024')).toMatchObject({ resetOn: 'long', regainOnShort: 1 });
    expect(of('2014')).toMatchObject({ resetOn: 'short' });
    expect(of('2014')?.regainOnShort).toBeUndefined();
  });

  it('gives another pool its short rest regain', () => {
    expect(emit('advanced artifice|artificer', 'Artificer', 20, printed('efa'))).toContainEqual(
      expect.objectContaining({ kind: 'resourceRegain', key: 'flash-of-genius', amount: 1 }),
    );
    expect(
      emit('dread incarnate|scion of the three', 'Rogue', 17, printed('frhof')),
    ).toContainEqual(
      expect.objectContaining({ kind: 'resourceRegain', key: 'bloodthirst', amount: 1 }),
    );
  });

  it('reads Sorcerous Restoration by the printing', () => {
    const restoration = (source: string) =>
      emit('sorcerous restoration|sorcerer', 'Sorcerer', 20, printed(source));
    expect(restoration('phb')).toEqual([
      expect.objectContaining({ kind: 'resourceRegain', key: 'sorcery-points', amount: 4 }),
    ]);
    // 2024's is a choice, once per long rest: its one use, and no regain.
    expect(restoration('xphb')).toEqual([
      expect.objectContaining({
        kind: 'resource',
        key: 'sorcerous-restoration',
        max: 1,
        resetOn: 'long',
      }),
    ]);
  });

  it('adds Metamagic Adept to Sorcery Points in either order', () => {
    const adept = emit('metamagic adept|tce', 'Sorcerer', 5, origin);
    const font = emit('font of magic|sorcerer', 'Sorcerer', 5, origin);
    expect(resource(adept, 'sorcery-points')).toMatchObject({
      max: 2,
      stack: true,
      noSlotConversion: 2,
    });
    // The sorcerer's level, read here so a class that reskins the Sorcerer has it too.
    expect(resource(font, 'sorcery-points')).toMatchObject({ max: 5, stack: true });
    expect(resource(font, 'sorcery-points')?.noSlotConversion).toBeUndefined();
  });

  it('lets Stunning Strike ride on a hit, with no slot of its own', () => {
    expect(action(emit('stunning strike|monk', 'Monk', 5, origin))?.economy).toBe('none');
  });
});

describe('the Draconic sorcerer’s dragon', () => {
  const bloodline: EffectOrigin = {
    label: 'Dragon Ancestor',
    uid: 'draconic bloodline|phb',
    type: 'subclass',
  };
  const sorcery: EffectOrigin = {
    label: 'Elemental Affinity',
    uid: 'draconic sorcery|xphb',
    type: 'subclass',
  };
  const run = (key: string, c: Collector, o: EffectOrigin) => {
    expect(emitCuratedEffects(c, key, o)).toBe(true);
    return c;
  };

  it('asks the 2014 Dragon Ancestor for a dragon, and gives Draconic', () => {
    const c = run('dragon ancestor|draconic bloodline', col('Sorcerer', 1), bloodline);
    expect(c.effects).toEqual([{ kind: 'language', name: 'Draconic', origin: bloodline }]);
    expect(c.pending.map((p) => [p.id, p.label, p.options.length])).toEqual([
      ['subclass:draconic bloodline|phb:ancestor', 'Dragon Ancestor', 10],
    ]);
  });

  it('names the ancestor’s type on the 2014 Elemental Affinity chip', () => {
    const affinity = { ...bloodline, label: 'Elemental Affinity' };
    const note = (c: Collector) =>
      run('elemental affinity|draconic bloodline', c, affinity).effects.flatMap((e) =>
        e.kind === 'action' ? [[e.economy, e.note]] : [],
      );
    expect(note(col('Sorcerer', 6))).toEqual([['none', undefined]]);
    const picked = col('Sorcerer', 6);
    picked.doc.choices['subclass:draconic bloodline|phb:ancestor'] = ['silver'];
    expect(note(picked)).toEqual([
      [
        'none',
        'resistance to cold for 1 hour · cold spells add your Charisma modifier to one damage roll',
      ],
    ]);
  });

  it('resists the type the 2024 Elemental Affinity picks', () => {
    const open = run('elemental affinity|draconic sorcery', col('Sorcerer', 6), sorcery);
    expect(open.effects).toEqual([]);
    expect(open.pending.map((p) => [p.id, p.options.map((o) => o.id)])).toEqual([
      ['subclass:draconic sorcery|xphb:affinity', ['acid', 'cold', 'fire', 'lightning', 'poison']],
    ]);
    const picked = col('Sorcerer', 6);
    picked.doc.choices['subclass:draconic sorcery|xphb:affinity'] = ['lightning'];
    expect(run('elemental affinity|draconic sorcery', picked, sorcery).effects).toEqual([
      { kind: 'resist', damageType: 'lightning', origin: sorcery },
    ]);
  });
});

describe('free casts of a spell the class always has prepared', () => {
  const classes: DataEntity[] = [
    { name: 'Ranger', source: 'XPHB', spellcastingAbility: 'wis' },
    { name: 'Ranger', source: 'PHB', spellcastingAbility: 'wis' },
    { name: 'Paladin', source: 'XPHB', spellcastingAbility: 'cha' },
    { name: 'Warlock', source: 'XPHB', spellcastingAbility: 'cha' },
    // A class whose own data counts the casts, as a Death Knight's does.
    {
      name: 'Knight',
      source: 'HB',
      spellcastingAbility: 'cha',
      additionalSpells: [{ prepared: { 5: { daily: { 1: ['find steed|xphb'] } } } }],
    },
  ];
  const world: EngineContext = {
    get: (type, name, source) =>
      type === 'class' ? classes.find((c) => c.name === name && c.source === source) : undefined,
    byType: () => [],
  };
  const cast = (key: string, name: string, source: string, levels: number, from = source) => {
    const doc = newCharacterDoc('c', 'H', 't');
    doc.classes = [{ ref: { name, source }, levels, hp: [] }];
    const c = new Collector(doc, world);
    const uid = `${name}|${source}`.toLowerCase();
    emitCuratedEffects(c, key, { label: 'Feature', uid, type: 'class' }, from.toLowerCase());
    return c.effects;
  };
  const resource = (effects: EffectInput[], key: string) =>
    effects.find((e) => e.kind === 'resource' && e.key === key) as
      | Extract<EffectInput, { kind: 'resource' }>
      | undefined;

  it("gives 2024 Favored Enemy Hunter's Mark casts by Ranger level", () => {
    const at = (levels: number) => cast('favored enemy|ranger', 'Ranger', 'XPHB', levels);
    expect(at(1)).toEqual([
      expect.objectContaining({ kind: 'resource', key: 'favored-enemy', max: 2, resetOn: 'long' }),
      expect.objectContaining({
        kind: 'grantSpell',
        spell: { name: "hunter's mark", source: 'xphb' },
        ability: 'wis',
        usage: '2/day',
        resourceKey: 'favored-enemy',
      }),
    ]);
    expect([4, 5, 9, 13, 17, 20].map((l) => resource(at(l), 'favored-enemy')?.max)).toEqual([
      2, 3, 4, 5, 6, 6,
    ]);
  });

  it('gives the 2014 Favored Enemy nothing, as its prose scan did', () => {
    expect(cast('favored enemy|ranger', 'Ranger', 'PHB', 5)).toEqual([]);
  });

  it.each([
    ["paladin's smite|paladin", 'Paladin', 'divine smite', 'paladin-s-smite', "Paladin's Smite"],
    ['faithful steed|paladin', 'Paladin', 'find steed', 'faithful-steed', 'Faithful Steed'],
    [
      'contact patron|warlock',
      'Warlock',
      'contact other plane',
      'contact-patron',
      'Contact Patron',
    ],
  ])('ties %s to its spell, under the pool the prose scan made', (key, cls, spell, pool, label) => {
    const made = cast(key, cls, 'XPHB', 9);
    expect(resource(made, pool)).toMatchObject({ label, max: 1, resetOn: 'long' });
    expect(made.find((e) => e.kind === 'grantSpell')).toMatchObject({
      spell: { name: spell },
      ability: 'cha',
      usage: '1/day',
      resourceKey: pool,
    });
  });

  it("adds nothing where the class's own data counts the casts", () => {
    expect(cast('faithful steed|paladin', 'Knight', 'HB', 5, 'xphb')).toEqual([]);
  });
});

describe('standing numbers of core class features', () => {
  const printed = (uid: string): EffectOrigin => ({ label: 'Feature', uid, type: 'class' });
  const emit = (key: string, uid: string, className?: string, levels?: number) => {
    const c = col(className, levels);
    expect(emitCuratedEffects(c, key, printed(uid))).toBe(true);
    return c.effects.map(({ origin: _, ...rest }) => rest);
  };

  it('gives Unarmored Movement by Monk level, out of armor and shield', () => {
    const bonus = (levels: number) => emit('unarmored movement|monk', 'monk|phb', 'Monk', levels);
    expect(bonus(2)).toEqual([{ kind: 'speedBonus', amount: 10, unless: 'armorOrShield' }]);
    expect(bonus(6)[0]).toMatchObject({ amount: 15 });
    expect(bonus(13)[0]).toMatchObject({ amount: 20 });
    expect(bonus(14)[0]).toMatchObject({ amount: 25 });
    expect(bonus(20)[0]).toMatchObject({ amount: 30 });
  });

  it('gives Fast Movement and 2024 Roving out of heavy armor, and Roving climbs and swims', () => {
    expect(emit('fast movement|barbarian', 'barbarian|phb')).toEqual([
      { kind: 'speedBonus', amount: 10, unless: 'heavyArmor' },
    ]);
    expect(emit('roving|ranger', 'ranger|xphb')).toEqual([
      { kind: 'speedBonus', amount: 10, unless: 'heavyArmor' },
      { kind: 'moveSpeed', mode: 'climb', speed: 'walk' },
      { kind: 'moveSpeed', mode: 'swim', speed: 'walk' },
    ]);
    // A 2024 Roving lent to another book's class still reads as 2024.
    expect(emit('roving|ranger', 'hunter|wow')).toEqual([]);
    const lent = col();
    emitCuratedEffects(lent, 'roving|ranger', printed('hunter|wow'), 'xphb');
    expect(lent.effects).toHaveLength(3);
  });

  it('gives the save proficiencies each printing of Slippery Mind names, and every save at Monk 14', () => {
    const saves = (key: string, uid: string) =>
      emit(key, uid).flatMap((e) => (e.kind === 'saveProf' ? [e.ability] : []));
    expect(saves('slippery mind|rogue', 'rogue|phb')).toEqual(['wis']);
    expect(saves('slippery mind|rogue', 'rogue|xphb')).toEqual(['wis', 'cha']);
    const all = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
    expect(saves('diamond soul|monk', 'monk|phb')).toEqual(all);
    expect(saves('disciplined survivor|monk', 'monk|xphb')).toEqual(all);
  });

  it('raises two scores by 4 to each printing’s new maximum', () => {
    expect(emit('primal champion|barbarian', 'barbarian|phb')).toEqual([
      { kind: 'abilityBonus', ability: 'str', amount: 4, max: 24 },
      { kind: 'abilityBonus', ability: 'con', amount: 4, max: 24 },
    ]);
    expect(emit('primal champion|barbarian', 'barbarian|xphb')[0]).toMatchObject({ max: 25 });
    expect(emit('body and mind|monk', 'monk|xphb')).toEqual([
      { kind: 'abilityBonus', ability: 'dex', amount: 4, max: 25 },
      { kind: 'abilityBonus', ability: 'wis', amount: 4, max: 25 },
    ]);
  });

  it('gives the paladin’s own aura and the immunities', () => {
    expect(emit('aura of protection|paladin', 'paladin|xphb')).toEqual([
      { kind: 'saveBonus', amount: 'abilityModMin1:cha' },
    ]);
    expect(emit('aura of courage|paladin', 'paladin|phb')).toEqual([
      { kind: 'conditionImmune', condition: 'frightened', note: 'while conscious' },
    ]);
    expect(emit('aura of courage|paladin', 'paladin|xphb')[0]).toMatchObject({
      note: 'not while incapacitated',
    });
    expect(emit('divine health|paladin', 'paladin|phb')).toEqual([
      { kind: 'conditionImmune', condition: 'disease' },
    ]);
    expect(emit('purity of body|monk', 'monk|phb')).toEqual([
      { kind: 'immune', damageType: 'poison' },
      { kind: 'conditionImmune', condition: 'poisoned' },
      { kind: 'conditionImmune', condition: 'disease' },
    ]);
  });

  it('gives a Warforged’s Integrated Protection +1 AC', () => {
    const c = col();
    expect(emitCuratedTrait(c, 'Integrated Protection', origin)).toBe(true);
    expect(c.effects).toEqual([{ kind: 'acBonus', amount: 1, origin }]);
  });

  it('gives 2024 Feral Senses blindsight, and the 2014 one nothing to show', () => {
    expect(emit('feral senses|ranger', 'ranger|xphb')).toEqual([
      { kind: 'sense', sense: 'blindsight', range: 30 },
    ]);
    expect(emit('feral senses|ranger', 'ranger|phb')).toEqual([]);
  });
});
