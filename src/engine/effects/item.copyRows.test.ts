/**
 * A Workshop copy (`basedOn`) or a converted printing (`printingOf`) of an item
 * a `wornTags` row corrects holds the official item's bonus fields, so it reads
 * the official row for them (ADR-002 D7, the owner's answer 2026-11-19): a copy
 * of Bracers of Archery gives a longsword nothing, and one of the Rod of the
 * Pact Keeper raises a Warlock's spells alone. Its defense tags stay its
 * author's: a copy of the Rod of Alertness keeps the save bonus its fields give.
 * Copies are written as the
 * Workshop writes them (`writeEntry`) and merged as a player's file is
 * (`mergeHomebrew`); a copy with `basedOn` stripped is the control, reading its
 * fields as stated.
 */
import { describe, expect, it } from 'vitest';
import { attachBuiltInRules, loadBuiltInRules } from '@/data5e/builtInRules';
import { engineContextFor } from '@/data5e/engineAdapter';
import { type EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { type Json, writeEntry } from '@/features/workshop/copyWriter';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { deriveSheet } from '../derive';
import { type DataEntity, type DerivedSheet, newCharacterDoc } from '../types';

const BRACERS = {
  name: 'Bracers of Archery',
  source: 'DMG',
  type: 'W',
  rarity: 'uncommon',
  reqAttune: true,
  bonusWeaponDamage: '+2',
  entries: [
    'While wearing these bracers, you have proficiency with the longbow and shortbow, and you gain a +2 bonus to damage rolls on ranged attacks made with such weapons.',
  ],
};
const ROD = {
  name: '+1 Rod of the Pact Keeper',
  source: 'DMG',
  type: 'RD',
  rarity: 'uncommon',
  reqAttune: 'by a warlock',
  bonusSpellAttack: '+1',
  bonusSpellSaveDc: '+1',
  entries: [
    'While holding this rod, you gain a +1 bonus to spell attack rolls and to the saving throw DCs of your warlock spells.',
  ],
};
/** Its row takes its save bonus away (2014 text: advantage on initiative alone). */
const ALERTNESS = {
  name: 'Rod of Alertness',
  source: 'DMG',
  type: 'RD',
  rarity: 'very rare',
  reqAttune: true,
  bonusSavingThrow: '+1',
  entries: ['This rod has a flanged head.'],
};
const weapon = (name: string, type: 'M' | 'R', dmg1: string) => ({
  name,
  source: 'PHB',
  type,
  weaponCategory: 'martial',
  weapon: true,
  dmg1,
  dmgType: type === 'M' ? 'S' : 'P',
});

/** The fixture's Pactcaster and Mage as the release's Warlock and Wizard. */
function casters(): DataEntity[] {
  const base = makeTestContext();
  return [
    ['Warlock', 'Pactcaster'],
    ['Wizard', 'Mage'],
  ].map(([name, from]) => ({
    ...(base.get('class', String(from), 'TST') as DataEntity),
    name,
    source: 'PHB',
    classFeatures: [],
  }));
}

async function release(): Promise<EntityRegistry> {
  const reg = normalizeDataset(
    new Map<string, unknown>([
      ['items.json', { item: [BRACERS, ROD, ALERTNESS] }],
      [
        'items-base.json',
        { baseitem: [weapon('Longsword', 'M', '1d8'), weapon('Longbow', 'R', '1d8')] },
      ],
      ['class/class-casters.json', { class: casters() }],
    ]),
  );
  attachBuiltInRules(reg, await loadBuiltInRules());
  return reg;
}

/** Every way a player's item can stand for the official one, and the control. */
type Kind = 'changes' | 'full' | 'printingOf' | 'no basedOn';

/**
 * The player's file for a copy of `original`, named apart so it is found as
 * itself, with the author's `change` to it.
 */
function playerFile(original: Json, kind: Kind, change: Json): { file: Json; name: string } {
  const name = `${original.name} (${kind})`;
  const draft = { ...original, name, ...change };
  let entry: Json;
  if (kind === 'printingOf') {
    entry = { ...draft, source: 'MYHB', printingOf: [`${original.name}|${original.source}`] };
  } else {
    entry = writeEntry({
      original,
      draft,
      source: 'MYHB',
      mode: kind === 'changes' ? 'changes' : 'full',
    });
    if (kind === 'no basedOn') {
      const { basedOn: _gone, ...guidance } = entry.castGuidance as Json;
      entry = { ...entry, castGuidance: guidance };
    }
  }
  return {
    file: { _meta: { sources: [{ json: 'MYHB', full: 'My Homebrew' }] }, item: [entry] },
    name,
  };
}

async function sheetWith(
  official: Json,
  kind: Kind | 'official',
  classes: string[],
  change: Json = {},
): Promise<DerivedSheet> {
  const reg = await release();
  let item = { name: String(official.name), source: String(official.source) };
  if (kind !== 'official') {
    const { file, name } = playerFile(official, kind, change);
    mergeHomebrew(reg, new Map([['mine', file]]));
    item = { name, source: 'MYHB' };
  }
  const ctx = engineContextFor(reg);
  // The copy is in the registry as itself, or the comparison proves nothing.
  expect(ctx.get('item', item.name, item.source), `${kind}: ${item.name}`).toBeDefined();
  if (kind === 'changes') {
    expect(ctx.get('item', item.name, item.source)?.bonusWeaponDamage).toBe(
      change.bonusWeaponDamage ?? official.bonusWeaponDamage,
    );
  }
  const doc = newCharacterDoc('hero', 'Hero', 'test');
  doc.classes = classes.map((name) => ({ ref: { name, source: 'PHB' }, levels: 1, hp: ['avg'] }));
  doc.equipment = [
    { id: 'sword', ref: { name: 'Longsword', source: 'PHB' } },
    { id: 'bow', ref: { name: 'Longbow', source: 'PHB' } },
    { id: 'it', ref: item, attuned: true },
  ].map((e) => ({ qty: 1, equipped: true, attuned: false, ...e })) as typeof doc.equipment;
  return deriveSheet(doc, ctx);
}

const flat = (damage: string | undefined) => Number(/[+-]\d+$/.exec(damage ?? '')?.[0] ?? 0);

describe('a copy or a converted printing reads the official bonus row', () => {
  const damage = async (kind: Kind | 'official', change: Json = {}) => {
    const s = await sheetWith(BRACERS, kind, ['Wizard'], change);
    return ['Longsword', 'Longbow'].map((l) => flat(s.attacks.find((a) => a.label === l)?.damage));
  };

  it('Bracers of Archery: the bows alone, as the official item', async () => {
    expect(await damage('official')).toEqual([0, 2]);
    for (const kind of ['changes', 'full', 'printingOf'] as const) {
      expect(await damage(kind), kind).toEqual([0, 2]);
    }
  });

  it('a copy with no basedOn reads its fields as stated (the control)', async () => {
    expect(await damage('no basedOn')).toEqual([2, 2]);
  });

  it("takes the row over the author's edit to the field; the copy's own drop takes it away", async () => {
    expect(await damage('changes', { bonusWeaponDamage: '+3' })).toEqual([0, 2]);
    const drop = { castGuidance: { drop: [{ kind: 'damageBonus' }] } };
    expect(await damage('changes', drop)).toEqual([0, 0]);
  });

  it("the Rod of the Pact Keeper: a Warlock's spells alone", async () => {
    const given = async (kind: Kind | 'official') => {
      const s = await sheetWith(ROD, kind, ['Warlock', 'Wizard']);
      return ['Warlock', 'Wizard'].flatMap((c) => {
        const b = s.spellcasting.find((x) => x.className === c);
        const from = (parts: ReadonlyArray<{ label: string; amount: number }> | undefined) =>
          (parts ?? [])
            .filter((p) => p.label.startsWith('+1 Rod'))
            .reduce((n, p) => n + p.amount, 0);
        return [from(b?.attackMod.parts), from(b?.saveDc.parts)];
      });
    };
    expect(await given('official')).toEqual([1, 1, 0, 0]);
    for (const kind of ['changes', 'full', 'printingOf'] as const) {
      expect(await given(kind), kind).toEqual([1, 1, 0, 0]);
    }
    expect(await given('no basedOn')).toEqual([1, 1, 1, 1]);
  });

  it("leaves a copy's defense tags its author's: the Rod of Alertness's save bonus", async () => {
    const save = async (kind: Kind | 'official') =>
      (await sheetWith(ALERTNESS, kind, ['Wizard'])).saves.wis.total.parts
        .filter((p) => p.label.startsWith('Rod of Alertness'))
        .reduce((n, p) => n + p.amount, 0);
    expect(await save('official')).toBe(0);
    for (const kind of ['changes', 'full', 'printingOf'] as const) {
      expect(await save(kind), kind).toBe(1);
    }
  });
});
