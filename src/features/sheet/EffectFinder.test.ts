/**
 * What + Effect leads with on each sheet tab (the rolls and casting canvas,
 * Effects C): read from what the catalog says each entry is and does, the
 * character's own first, and nothing already on offered again.
 */
import { describe, expect, it } from 'vitest';
import { type CatalogEntry, catalogFor } from '@/engine/curated/effectCatalog';
import { blessEffect, rageEffect } from '@/engine/curated/namedEffects';
import type { ActiveEffect } from '@/engine/types';
import { carries, type EffectTab, type TabCharacter, tabEffects } from './EffectFinder';
import type { NamedStart } from './namedStarts';

const rage: NamedStart = {
  name: 'Rage',
  build: (id) => rageEffect(id, 5, '2024'),
  endsConcentration: true,
};

/** The catalog as the finder holds it: another class's own feature is never there. */
const catalog = (edition: '2014' | '2024', own: readonly string[] = []): CatalogEntry[] =>
  catalogFor(edition).filter((e) => e.own !== true || own.includes(e.name));

const nobody: TabCharacter = { effects: [], spells: new Set(), carried: [], starts: new Map() };

const names = (
  tab: EffectTab,
  who: Partial<TabCharacter> = {},
  entries: readonly CatalogEntry[] = catalog('2024'),
) => tabEffects(tab, entries, { ...nobody, ...who }).map((e) => e.name);

describe("a tab's own effects", () => {
  it('on Play, what changes an attack or its damage, or gives an action to attack with', () => {
    const play = names('play');
    for (const name of ['Haste', 'Magic Weapon', 'Elemental Weapon', 'Enlarge/Reduce, enlarged']) {
      expect(play).toContain(name);
    }
    // Armor, a speed and a sense are not for attacks.
    for (const name of ['Shield of Faith', 'Longstrider', 'Darkvision', 'Stoneskin']) {
      expect(play).not.toContain(name);
    }
  });

  it('on Stats, help for checks and saves', () => {
    const stats = names('stats');
    for (const name of [
      'Enhance Ability',
      'Warding Bond',
      'Beacon of Hope',
      'Aura of Protection',
    ]) {
      expect(stats).toContain(name);
    }
    expect(stats).not.toContain('Magic Weapon');
    // Its line names a save, but the one its targets make.
    expect(stats).not.toContain("Dragon's Breath");
    // 2014 Resistance is a d4 on a save; 2024's cuts damage instead.
    expect(names('stats', {}, catalog('2014'))).toContain('Resistance');
    expect(stats).not.toContain('Resistance');
  });

  it('leaves out the starters, whose chips follow in the same sheet', () => {
    for (const tab of ['play', 'stats', 'spells', 'features'] as const) {
      const listed = names(tab);
      for (const starter of ['Bless', 'Guidance', 'Bardic Inspiration']) {
        expect(listed).not.toContain(starter);
      }
    }
  });

  it('on Spells, spells only, and those only their caster gets when the character has them, first', () => {
    const entries = catalog('2024');
    const spells = tabEffects('spells', entries, nobody);
    expect(spells.every((e) => /^(Spell|Cantrip)\b/.test(e.what))).toBe(true);
    const listed = spells.map((e) => e.name);
    for (const name of ['Haste', 'Shield of Faith', 'Resistance', 'Magic Weapon']) {
      expect(listed).toContain(name);
    }
    // A potion that gives a spell, a feature, an action, or a spell the character lacks.
    for (const name of ['Potion of Speed', 'Aura of Protection', 'Help', 'Shield']) {
      expect(listed).not.toContain(name);
    }

    const caster = names('spells', { spells: new Set(['shield', 'blur']) });
    expect(caster.slice(0, 2)).toEqual(['Shield', 'Blur']);
    expect(caster).not.toContain('See Invisibility');
  });

  it('on Items, the potions, those the character carries first and saying so', () => {
    const entries = catalog('2024');
    const carried = ['Potion of Fire Resistance', 'Rope, Hempen (50 feet)', 'Potion of Speed'];
    const items = tabEffects('items', entries, { ...nobody, carried });
    expect(items.every((e) => e.what === 'Potion')).toBe(true);
    expect(items.map((e) => e.name).slice(0, 2)).toEqual([
      'Potion of Resistance',
      'Potion of Speed',
    ]);
    expect(items).toHaveLength(9);
    expect(items.map((e) => e.name)).not.toContain('Haste');

    const giant = entries.find((e) => e.id === 'potion-of-giant-strength') as CatalogEntry;
    expect(carries(giant, ['Potion of Hill Giant Strength'])).toBe(true);
    expect(carries(giant, ['Potion of Healing'])).toBe(false);
    // Only a potion is carried: a spell of the same words is not an item.
    const haste = entries.find((e) => e.id === 'haste') as CatalogEntry;
    expect(carries(haste, ['Haste'])).toBe(false);
  });

  it("on Features, the character's own first, then an ally's", () => {
    const entries = catalog('2024', ['Rage']);
    const starts = new Map([['rage', rage]]);
    expect(names('features', { starts }, entries)).toEqual([
      'Rage',
      'Aura of Protection',
      'Aura of Courage',
    ]);
    // What Rage starts is for attacks and damage, so Play leads with it too.
    expect(names('play', { starts }, entries)[0]).toBe('Rage');
    // Another class's own feature is not in the catalog the finder holds.
    expect(names('features')).toEqual(['Aura of Protection', 'Aura of Courage']);
  });

  it('offers nothing already on, nor one of a name already on', () => {
    const haste: ActiveEffect = {
      id: 'h',
      name: 'Haste',
      parts: [{ kind: 'acBonus', amount: 2 }],
    };
    const play = names('play', { effects: [haste] });
    expect(play).not.toContain('Haste');
    expect(names('items', { effects: [haste] })).not.toContain('Potion of Speed');

    // A Potion of Heroism's d4 is Bless, which is on.
    const items = names('items', { effects: [blessEffect('b', false)] });
    expect(items).not.toContain('Potion of Heroism');

    // A potion of one damage type on does not hide the potion of another.
    const acid: ActiveEffect = {
      id: 'a',
      name: 'Acid potion',
      same: 'Potion of Acid Resistance',
      parts: [{ kind: 'resist', damageType: 'acid' }],
    };
    const carrying = { effects: [acid], carried: ['Potion of Fire Resistance'] };
    expect(names('items', carrying)[0]).toBe('Potion of Resistance');

    // Rage on: it is not offered on Features, and Play no longer leads with it.
    const entries = catalog('2024', ['Rage']);
    const raging = { starts: new Map([['rage', rage]]), effects: [rageEffect('r', 5, '2024')] };
    expect(names('features', raging, entries)).not.toContain('Rage');
    expect(names('play', raging, entries)).not.toContain('Rage');
  });
});
