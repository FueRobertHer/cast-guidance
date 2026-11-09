import { describe, expect, it } from 'vitest';
import { readActiveEffects } from '../activeEffects';
import type { EffectPart } from '../types';
import {
  type Answers,
  type CatalogEntry,
  catalogFor,
  initialAnswers,
  landEntry,
  rollRange,
  searchCatalog,
  unanswered,
} from './effectCatalog';

const entry = (edition: '2014' | '2024', id: string): CatalogEntry => {
  const e = catalogFor(edition).find((x) => x.id === id);
  if (e === undefined) throw new Error(`no ${id}`);
  return e;
};

/** Every question answered: its own choice, else the first option, a roll at its least, a weapon. */
function answerAll(e: CatalogEntry): Answers {
  const a: Record<string, string> = { ...initialAnswers(e) };
  for (const q of e.asks) {
    if (a[q.key] !== undefined) continue;
    if (q.kind === 'pick') a[q.key] = q.options[0]?.value ?? '';
    if (q.kind === 'roll') a[q.key] = String(rollRange(q.dice).min);
    if (q.kind === 'weapon') a[q.key] = 'w1';
  }
  return a;
}

const parts = (edition: '2014' | '2024', id: string, answers?: Answers): EffectPart[] => {
  const e = entry(edition, id);
  return landEntry(e, answers ?? answerAll(e), 'x').effect.parts;
};

describe('the effect catalog', () => {
  it('holds the same entries in both rules versions', () => {
    const ids = (ed: '2014' | '2024') => catalogFor(ed).map((e) => e.id);
    expect(ids('2024')).toEqual(ids('2014'));
    expect(new Set(ids('2014')).size).toBe(ids('2014').length);
  });

  it.each([
    '2014',
    '2024',
  ] as const)('lands every %s entry as an effect the sheet reads whole', (edition) => {
    for (const e of catalogFor(edition)) {
      if (e.own === true) continue;
      const { effect } = landEntry(e, answerAll(e), `id-${e.id}`);
      const read = readActiveEffects([effect]);
      expect(read.problems, e.id).toEqual([]);
      expect(read.effects[0]?.parts, e.id).toEqual(effect.parts);
      expect(effect.parts.length, e.id).toBeGreaterThan(0);
    }
  });

  it('points every borrowing entry at one that is there, and counts it as that one', () => {
    for (const edition of ['2014', '2024'] as const) {
      const all = catalogFor(edition);
      for (const e of all.filter((x) => x.borrows !== undefined)) {
        const lent = all.find((x) => x.id === e.borrows);
        expect(lent, e.id).toBeDefined();
      }
    }
    const speed = landEntry(entry('2014', 'potion-of-speed'), {}, 'p').effect;
    const haste = landEntry(entry('2014', 'haste'), {}, 'h').effect;
    expect(speed.same).toBe('Haste');
    expect(speed.parts).toEqual(haste.parts);
    expect(speed.lasts).toEqual({ minutes: 1 });
    expect(haste.lasts).toEqual({ minutes: 1, concentration: true });
  });

  it('gives a 2024 Potion of Speed no lethargy', () => {
    const cues = (ed: '2014' | '2024', id: string) =>
      parts(ed, id).filter((p) => p.kind === 'cue' && p.tone === 'warn');
    expect(cues('2014', 'potion-of-speed')).toHaveLength(1);
    expect(cues('2024', 'potion-of-speed')).toEqual([]);
    expect(cues('2024', 'haste')).toEqual([
      {
        kind: 'cue',
        tone: 'warn',
        text: 'When it ends, you are Incapacitated with a speed of 0 until the end of your next turn',
      },
    ]);
  });

  it('reads each rules version where they differ', () => {
    // Barkskin: a floor of 16 held by concentration, then 17 without.
    expect(parts('2014', 'barkskin')).toEqual([{ kind: 'acMin', min: 16 }]);
    expect(parts('2024', 'barkskin')).toEqual([{ kind: 'acMin', min: 17 }]);
    expect(entry('2014', 'barkskin').lasts).toEqual({ minutes: 60, concentration: true });
    expect(entry('2024', 'barkskin').lasts).toEqual({ minutes: 60 });

    // Guidance: offered on one check, then on every skill check while it lasts,
    // with no skill asked up front (the owner's ruling in #262).
    expect(parts('2014', 'guidance')).toEqual([
      { kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'] }, once: true },
    ]);
    expect(entry('2024', 'guidance').asks).toEqual([]);
    expect(landEntry(entry('2024', 'guidance'), {}, 'g').effect).toEqual({
      id: 'g',
      name: 'Guidance',
      parts: [{ kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'], skilled: true } }],
      lasts: { minutes: 1, concentration: true },
    });

    // Resistance: a d4 on one save, then a cut to one damage type.
    expect(parts('2014', 'resistance')).toEqual([
      { kind: 'rollOffer', dice: '1d4', on: { rolls: ['save'] }, once: true },
    ]);
    expect(landEntry(entry('2024', 'resistance'), { type: 'Fire' }, 'r').effect).toMatchObject({
      name: 'Resistance: fire',
      parts: [{ kind: 'cue', tone: 'ward' }],
    });

    // Stoneskin: nonmagical weapons only in 2014.
    expect(parts('2014', 'stoneskin')[0]).toEqual({
      kind: 'resist',
      damageType: 'bludgeoning',
      note: 'nonmagical',
    });
    expect(parts('2024', 'stoneskin')[0]).toEqual({ kind: 'resist', damageType: 'bludgeoning' });

    // Darkvision 60 ft., then 150 ft.
    expect(parts('2014', 'darkvision')).toEqual([
      { kind: 'sense', sense: 'darkvision', range: 60 },
    ]);
    expect(parts('2024', 'darkvision')).toEqual([
      { kind: 'sense', sense: 'darkvision', range: 150 },
    ]);

    // Freedom of Movement swims in 2024.
    expect(parts('2014', 'freedom-of-movement').some((p) => p.kind === 'moveSpeed')).toBe(false);
    expect(parts('2024', 'freedom-of-movement')).toContainEqual({
      kind: 'moveSpeed',
      mode: 'swim',
      speed: 'walk',
    });

    // Heroes' Feast: immune to poison damage, then resistant.
    expect(parts('2014', 'heroes-feast')[0]).toEqual({ kind: 'immune', damageType: 'poison' });
    expect(parts('2024', 'heroes-feast')[0]).toEqual({ kind: 'resist', damageType: 'poison' });

    // Bardic Inspiration waits for a failed roll in 2024, and lasts an hour.
    expect(parts('2024', 'bardic-inspiration')[0]).toMatchObject({ ifFailed: true });
    expect(entry('2024', 'bardic-inspiration').lasts).toEqual({ minutes: 60 });
    expect(entry('2014', 'bardic-inspiration').lasts).toEqual({ minutes: 10 });

    // Potion of Growth: up to 4 hours, then 10 minutes.
    expect(entry('2014', 'potion-of-growth').lasts).toEqual({ minutes: 240 });
    expect(entry('2024', 'potion-of-growth').lasts).toEqual({ minutes: 10 });

    // Magic Weapon's slots: +2 from 4th, then from 3rd; concentration only in 2014.
    const slots = (ed: '2014' | '2024') => {
      const q = entry(ed, 'magic-weapon').asks.find((a) => a.key === 'slot');
      return q?.kind === 'pick' ? q.options.map((o) => `${o.label}=${o.value}`) : [];
    };
    expect(slots('2014')).toEqual(['2nd or 3rd=1', '4th or 5th=2', '6th or higher=3']);
    expect(slots('2024')).toEqual(['2nd=1', '3rd to 5th=2', '6th or higher=3']);
  });

  it('puts Magic Weapon and Elemental Weapon on the one weapon picked', () => {
    expect(parts('2014', 'magic-weapon', { weapon: 'axe', slot: '2' })).toEqual([
      { kind: 'attackBonus', scope: 'all', amount: 2, weapon: 'axe' },
      { kind: 'damageBonus', scope: 'all', amount: 2, weapon: 'axe' },
    ]);
    expect(parts('2024', 'elemental-weapon', { weapon: 'axe', type: 'Cold', slot: '3' })).toEqual([
      { kind: 'attackBonus', scope: 'all', amount: 3, weapon: 'axe' },
      { kind: 'damageDie', scope: 'all', dice: '3d4', damageType: 'cold', weapon: 'axe' },
    ]);
  });

  it('names an effect by its answer, and counts it by the spell', () => {
    expect(
      landEntry(entry('2014', 'protection-from-energy'), { type: 'Fire' }, 'p').effect,
    ).toEqual({
      id: 'p',
      name: 'Protection: fire',
      same: 'Protection from Energy',
      parts: [{ kind: 'resist', damageType: 'fire' }],
      lasts: { minutes: 60, concentration: true },
    });
  });

  it("makes a caster's own spell theirs, for as long as it lasts", () => {
    expect(landEntry(entry('2024', 'shield'), {}, 's').effect).toEqual({
      id: 's',
      name: 'Shield',
      parts: [
        { kind: 'acBonus', amount: 5 },
        { kind: 'cue', tone: 'ward', text: 'No damage from Magic Missile' },
      ],
      turnsLeft: 1,
      mine: true,
    });
    expect(landEntry(entry('2024', 'blur'), {}, 'b').effect).toMatchObject({
      mine: true,
      lasts: { minutes: 1, concentration: true },
    });
    // An ally's spell is held by the ally's concentration, not this character's.
    expect(landEntry(entry('2024', 'haste'), {}, 'h').effect.mine).toBeUndefined();
  });

  it("gives a Potion of Heroism's temporary hit points, and Bless counted as Bless", () => {
    const { effect, tempHp } = landEntry(entry('2014', 'potion-of-heroism'), {}, 'p');
    expect(tempHp).toBe(10);
    expect(effect).toMatchObject({ name: 'Heroism potion', lasts: { minutes: 60 } });
    expect(effect.parts).toEqual([
      { kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] }, same: 'Bless' },
    ]);
    // Bear's Endurance gives its 2d6 only when it is the one picked.
    const enhance = entry('2014', 'enhance-ability');
    expect(landEntry(enhance, { which: "Bull's Strength", temp: '9' }, 'e').tempHp).toBeUndefined();
    expect(landEntry(enhance, { which: "Bear's Endurance", temp: '9' }, 'e').tempHp).toBe(9);
  });

  it('holds an entry back until each question shown has an answer the dice allow', () => {
    const pfe = entry('2014', 'protection-from-energy');
    expect(unanswered(pfe, {}).map((q) => q.key)).toEqual(['type']);
    expect(unanswered(pfe, { type: 'Fire' })).toEqual([]);

    const feast = entry('2014', 'heroes-feast');
    expect(unanswered(feast, { hp: '1' }).map((q) => q.key)).toEqual(['hp']);
    expect(unanswered(feast, { hp: '21' }).map((q) => q.key)).toEqual(['hp']);
    expect(unanswered(feast, { hp: '20' })).toEqual([]);

    // A question shown only for one answer does not hold the others back.
    const enhance = entry('2014', 'enhance-ability');
    expect(unanswered(enhance, { which: "Cat's Grace" })).toEqual([]);
    expect(unanswered(enhance, { which: "Bear's Endurance" }).map((q) => q.key)).toEqual(['temp']);
  });

  it('says how long each lasts the way a result says it', () => {
    expect(entry('2014', 'guidance').lastsSay).toBe('Concentration, up to 1 minute, or once used');
    expect(entry('2024', 'guidance').lastsSay).toBe('Concentration, up to 1 minute');
    expect(entry('2024', 'shield').lastsSay).toBe('Until the start of your next turn');
    expect(entry('2024', 'aid').lastsSay).toBe('8 hours');
    expect(entry('2024', 'aura-of-courage').lastsSay).toBe('Until you end it');
  });

  it("says when a paladin's aura lapses, as each edition does", () => {
    const where = (edition: '2014' | '2024', id: string) =>
      parts(edition, id).flatMap((p) => (p.kind === 'cue' ? [p.text] : []));
    for (const id of ['aura-of-protection', 'aura-of-courage']) {
      expect(where('2014', id)).toEqual([
        "Only within the paladin's aura while they are conscious: 10 ft., or 30 ft. from 18th level",
      ]);
      expect(where('2024', id)).toEqual([
        "Only within the paladin's aura (10 ft., or 30 ft. from 18th level), and not while they are incapacitated",
      ]);
    }
  });
});

describe('searching the catalog', () => {
  const all = catalogFor('2024');
  const names = (q: string) => searchCatalog(all, q).map((e) => e.name);

  it('finds names first, the closest first, then what an entry does', () => {
    // The whole name, then its start, then a word's start, then anywhere in it.
    expect(names('shield').slice(0, 2)).toEqual(['Shield', 'Shield of Faith']);
    expect(names('rage')[0]).toBe('Rage');
    expect(names('rage').indexOf('Aura of Courage')).toBeGreaterThan(0);
    expect(names('ward').slice(0, 2)).toEqual(['Warding Bond', 'Death Ward']);
    expect(names('fly')).toEqual(['Fly', 'Potion of Flying']);
    expect(names('potion').every((n) => n.startsWith('Potion'))).toBe(true);
    // Every word must be found somewhere, a choice it offers too: "fire resist"
    // is what can resist or cut fire, not every fire entry.
    expect(names('fire resist')).toEqual([
      'Resistance',
      'Protection from Energy',
      'Potion of Resistance',
    ]);
  });

  it('folds case and quote marks', () => {
    expect(names('HEROES FEAST')).toEqual(["Heroes' Feast"]);
    expect(names('hunters mark')).toEqual(["Hunter's Mark"]);
  });

  it('finds nothing for nothing', () => {
    expect(searchCatalog(all, '   ')).toEqual([]);
    expect(names('zzz')).toEqual([]);
  });
});
