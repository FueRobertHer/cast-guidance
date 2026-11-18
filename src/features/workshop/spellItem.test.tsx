// @vitest-environment jsdom
// The spell and item editors: the standard fields each card writes, what the
// preview shows, and a Builder-made entry opening with nothing lost.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { EntityRegistry } from '@/data5e/normalize';
import { ITEM_CHARGES } from '@/engine/curated/itemCharges';
import { readOwnEffects, readStoredEffects } from '@/engine/effects/mechanics';
import { BUILT_IN_RULE_SETS } from '../../../tests-fixtures/testWorld';

const { choice } = vi.hoisted(() => ({ choice: { current: undefined as string | undefined } }));
vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({ status: 'ready', error: null, offline: false, retry: () => undefined }),
}));
vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(choice.current) }));

import { EffectCards } from './EffectCards';
import {
  editor as item,
  rechargeValue,
  rechargeWords,
  regainOf,
  withCharges,
  withProperty,
} from './editors/ItemEditor';
import {
  damageRolls,
  healRolls,
  higherBlock,
  inflictSwap,
  editor as spell,
  upcastOf,
  withDamageDice,
  withDamageType,
  withHeal,
  withHigher,
  withLevel,
  withoutScaling,
} from './editors/SpellEditor';
import { EDITORS, type EditorSpec, type Json } from './editorTypes';

afterEach(cleanup);

/** An editor on screen, as the Workshop holds it; returns the draft as it stands. */
function mount(spec: EditorSpec, start: Json, registry = new EntityRegistry(), original?: Json) {
  let latest = start;
  function Harness() {
    const [draft, setDraft] = useState(start);
    latest = draft;
    const change = (patch: Json) =>
      setDraft((d) => {
        const next = { ...d, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next;
      });
    return (
      <spec.Body
        draft={draft}
        change={change}
        registry={registry}
        original={original}
        readOnly={false}
      />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return () => latest;
}

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const preview = () =>
  screen.getByRole('heading', { name: 'On the Spells tab' }).parentElement as HTMLElement;

/** Guiding Bolt as the 2014 book's data has it. */
const BOLT: Json = {
  name: 'Guiding Bolt',
  source: 'PHB',
  level: 1,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  range: { type: 'point', distance: { type: 'feet', amount: 120 } },
  components: { v: true, s: true },
  duration: [{ type: 'timed', duration: { type: 'round', amount: 1 } }],
  entries: [
    'A flash of light streaks toward a creature of your choice within range. Make a ranged spell attack against the target. On a hit, the target takes {@damage 4d6} radiant damage, and the next attack roll made against this target before the end of your next turn has advantage, thanks to the mystical dim light glittering on the target until then.',
  ],
  entriesHigherLevel: [
    {
      type: 'entries',
      name: 'At Higher Levels',
      entries: [
        'When you cast this spell using a spell slot of 2nd level or higher, the damage increases by {@scaledamage 4d6|1-9|1d6} for each slot level above 1st.',
      ],
    },
  ],
  damageInflict: ['radiant'],
  spellAttack: ['R'],
  miscTags: ['ADV'],
};

describe('the editors the Workshop finds', () => {
  it('include spells and items', () => {
    expect(EDITORS.has('spell')).toBe(true);
    expect(EDITORS.has('item')).toBe(true);
  });
});

describe('spell cards, as fields', () => {
  it('reads the damage, its type and its slot scaling from the tags', () => {
    expect(damageRolls(BOLT)).toEqual([{ dice: '4d6', type: 'radiant' }]);
    expect(upcastOf(BOLT)).toEqual({ base: '4d6', step: '1d6', heal: false });
  });

  it('changes the dice in the text and in the scaling tag', () => {
    const patch = withDamageDice(BOLT, { dice: '4d6', type: 'radiant' }, '5d6');
    expect(JSON.stringify(patch.entries)).toContain('{@damage 5d6} radiant');
    expect(JSON.stringify(patch.entriesHigherLevel)).toContain('{@scaledamage 5d6|1-9|1d6}');
  });

  it("changes the type's word, keeping the book's capital, and the types it lists", () => {
    const xphb = { ...BOLT, entries: ['The target takes {@damage 4d6} Radiant damage.'] };
    const patch = withDamageType(xphb, { dice: '4d6', type: 'radiant' }, 'fire');
    expect(patch.entries).toEqual(['The target takes {@damage 4d6} Fire damage.']);
    expect(patch.damageInflict).toEqual(['fire']);
  });

  it('keeps two rolls of the same dice in two types apart', () => {
    const flame = {
      level: 5,
      entries: [
        'Each creature takes {@damage 4d6} fire damage and {@damage 4d6} radiant damage on a failed save.',
      ],
      damageInflict: ['fire', 'radiant'],
      entriesHigherLevel: [
        {
          type: 'entries',
          name: 'At Higher Levels',
          entries: ['The fire damage increases by {@scaledamage 4d6|5-9|1d6} for each slot level.'],
        },
      ],
    };
    const fire = { dice: '4d6', type: 'fire' };
    expect(damageRolls(flame)).toEqual([fire, { dice: '4d6', type: 'radiant' }]);
    const cold = withDamageType(flame, fire, 'cold');
    expect(cold.entries).toEqual([
      'Each creature takes {@damage 4d6} cold damage and {@damage 4d6} radiant damage on a failed save.',
    ]);
    expect(cold.damageInflict).toEqual(['radiant', 'cold']);
    const more = withDamageDice(flame, fire, '5d6');
    expect(more.entries).toEqual([
      'Each creature takes {@damage 5d6} fire damage and {@damage 4d6} radiant damage on a failed save.',
    ]);
    // The radiant roll still has 4d6, so the scaling stays on it.
    expect(more.entriesHigherLevel).toBeUndefined();
  });

  it('adds slot scaling to what a spell already says of higher levels, and takes only it away', () => {
    const ray = [{ type: 'entries', name: 'At Higher Levels', entries: ['One more ray.'] }];
    const block = higherBlock({ level: 2 }, '2d6', '1d6', false);
    const both = withHigher(ray, block);
    expect(both).toEqual([
      {
        type: 'entries',
        name: 'At Higher Levels',
        entries: [
          'One more ray.',
          'The damage increases by {@scaledamage 2d6|2-9|1d6} for each spell slot level above 2nd.',
        ],
      },
    ]);
    expect(withoutScaling(both)).toEqual(ray);
    expect(withoutScaling(block)).toBeUndefined();
    expect(withHigher(undefined, block)).toEqual(block);
  });

  it('keeps a listed type no roll names when another changes', () => {
    const orb = {
      entries: ['It takes {@damage 3d8} acid damage.'],
      damageInflict: ['acid', 'cold', 'fire'],
    };
    const entries = ['It takes {@damage 3d8} thunder damage.'];
    expect(inflictSwap(orb, entries, 'acid', 'thunder').damageInflict).toEqual([
      'cold',
      'fire',
      'thunder',
    ]);
  });

  it('moves the slot scaling with the level, and drops it for a cantrip', () => {
    expect(JSON.stringify(withLevel(BOLT, 3).entriesHigherLevel)).toContain(
      '{@scaledamage 4d6|3-9|1d6} for each slot level above 3rd',
    );
    expect(withLevel(BOLT, 0)).toEqual({
      level: 0,
      entriesHigherLevel: undefined,
      scalingLevelDice: undefined,
    });
  });

  it('adds and takes away the caster modifier on healing', () => {
    const cure = { entries: ['It regains {@dice 1d8} + your spellcasting ability modifier.'] };
    expect(healRolls(cure)).toEqual([{ dice: '1d8', mod: true }]);
    expect(withHeal(cure, '1d8', '2d8', false).entries).toEqual(['It regains {@dice 2d8}.']);
  });
});

describe('SpellEditor', () => {
  it('builds a new spell from cards, and shows it as the Spells tab will', () => {
    const draft = mount(spell, { name: 'Sear', ...spell.blank() });
    press('Saving throw');
    press('Damage');
    fireEvent.change(screen.getByLabelText('Ability'), { target: { value: 'constitution' } });
    press('More at higher levels');
    expect(draft()).toMatchObject({
      level: 1,
      savingThrow: ['constitution'],
      damageInflict: ['fire'],
      entries: ['The target takes {@damage 1d8} fire damage.'],
      entriesHigherLevel: [
        {
          name: 'At Higher Levels',
          entries: [
            'The damage increases by {@scaledamage 1d8|1-9|1d8} for each spell slot level above 1st.',
          ],
        },
      ],
    });
    const shown = within(preview());
    expect(shown.getByText('DC 15')).toBeTruthy();
    expect(shown.getByText('1d8')).toBeTruthy();
    expect(shown.getByText(/With a 2nd-level slot: 2d8/)).toBeTruthy();
  });

  it('edits a copy of Guiding Bolt through its cards', () => {
    const draft = mount(spell, structuredClone(BOLT));
    expect(screen.getByText('4d6 radiant damage')).toBeTruthy();
    expect(screen.getByText('Ranged spell attack')).toBeTruthy();
    expect(within(preview()).getByText('+7')).toBeTruthy();
    type('Dice', '5d6');
    type('Each slot level adds', '1d8');
    expect(draft().entries).toEqual([expect.stringContaining('{@damage 5d6} radiant damage')]);
    expect(JSON.stringify(draft().entriesHigherLevel)).toContain('{@scaledamage 5d6|1-9|1d8}');
    expect(within(preview()).getByText('5d6')).toBeTruthy();
    // Nothing the cards do not own was touched.
    expect(draft().miscTags).toEqual(['ADV']);
    expect(draft().duration).toEqual(BOLT.duration);
  });

  it('takes the text one key at a time, spaces and new paragraphs included', () => {
    const draft = mount(spell, { name: 'Glow', ...spell.blank() });
    for (const ch of 'Each creature\n\nIt glows.') {
      const box = screen.getByLabelText('Text') as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: box.value + ch } });
    }
    expect(draft().entries).toEqual(['Each creature', 'It glows.']);
  });

  it('keeps the dice box while the dice are typed one key at a time', () => {
    const draft = mount(spell, {
      name: 'Bolt',
      ...spell.blank(),
      entries: ['It takes {@damage 1d8} fire damage.'],
    });
    const box = screen.getByLabelText('Dice') as HTMLInputElement;
    for (const value of ['1d', '1d1', '1d10']) fireEvent.change(box, { target: { value } });
    expect(box.isConnected).toBe(true);
    expect(draft().entries).toEqual(['It takes {@damage 1d10} fire damage.']);
  });

  it("changes a condition, keeping its tag's book and capital", () => {
    const draft = mount(spell, {
      name: 'Fear',
      ...spell.blank(),
      conditionInflict: ['frightened'],
      entries: ['The target is {@condition Frightened|XPHB}.'],
    });
    type('Condition', 'charmed');
    expect(draft().entries).toEqual(['The target is {@condition Charmed|XPHB}.']);
    expect(draft().conditionInflict).toEqual(['charmed']);
  });

  it('offers what the text says, and applies it only when accepted', () => {
    const draft = mount(spell, { name: 'Glare', ...spell.blank() });
    type(
      'Text',
      'Each creature in the area must make a Dexterity saving throw, taking 3d8 radiant damage on a failed save.',
    );
    expect(draft().savingThrow).toBeUndefined();
    expect(screen.getByText('Damage: 3d8 radiant damage')).toBeTruthy();
    expect(screen.getByText('Save: Dexterity save')).toBeTruthy();
    press('Add all');
    expect(draft()).toMatchObject({
      savingThrow: ['dexterity'],
      damageInflict: ['radiant'],
      entries: [
        'Each creature in the area must make a Dexterity saving throw, taking {@damage 3d8} radiant damage on a failed save.',
      ],
    });
    expect(screen.queryByText('Found in the text')).toBeNull();
    // The text box still reads as words, and keeps the tag through an edit.
    expect(screen.getByLabelText('Text')).toHaveProperty(
      'value',
      'Each creature in the area must make a Dexterity saving throw, taking 3d8 radiant damage on a failed save.',
    );
    type(
      'Text',
      'Each creature in the area must make a Dexterity saving throw, taking 3d8 radiant damage on a failure.',
    );
    expect(draft().entries).toEqual([
      'Each creature in the area must make a Dexterity saving throw, taking {@damage 3d8} radiant damage on a failure.',
    ]);
  });

  it('picks class lists from the classes in the data, each with its own book', () => {
    const registry = new EntityRegistry();
    registry.addAll('class', [
      { name: 'Wizard', source: 'PHB', spellcastingAbility: 'int' },
      { name: 'Wizard', source: 'XPHB', spellcastingAbility: 'int', edition: 'one' },
      { name: 'Fighter', source: 'PHB' },
      { name: 'Hexblade Knight', source: 'MyBrew', casterProgression: 'half' },
    ] as unknown as Entity[]);
    const draft = mount(spell, { name: 'Sear', edition: 'one', ...spell.blank() }, registry);
    const lists = within(screen.getByRole('group', { name: 'On the spell lists of' }));
    expect(lists.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Hexblade Knight',
      'Wizard',
    ]);
    fireEvent.click(lists.getByRole('button', { name: 'Wizard' }));
    fireEvent.click(lists.getByRole('button', { name: 'Hexblade Knight' }));
    expect(draft().classes).toEqual({
      fromClassList: [
        { name: 'Wizard', source: 'XPHB' },
        { name: 'Hexblade Knight', source: 'MyBrew' },
      ],
    });
  });

  it('opens a spell the Builder made and changes nothing until asked', () => {
    const built: Json = {
      name: 'Ember Lance',
      source: 'HBX',
      level: 1,
      school: 'V',
      classes: { fromClassList: [{ name: 'Sorcerer', source: 'PHB' }] },
      entries: ['A lance deals {@damage 2d6} fire damage.'],
    };
    const draft = mount(spell, structuredClone(built));
    expect(draft()).toEqual(built);
    expect(screen.getByLabelText('Casting time')).toHaveProperty('value', '');
    expect(screen.getByText('2d6 fire damage')).toBeTruthy();
    expect(within(preview()).getByText('2d6')).toBeTruthy();
  });

  it('turns a lasting effect into a duration with concentration, and effects on the target', () => {
    const draft = mount(spell, { name: 'Ward', ...spell.blank() });
    press('Lasting effect');
    expect(draft().duration).toEqual([
      { type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true },
    ]);
    press('Armor Class');
    expect(draft().castGuidance).toEqual({ v: 1, effects: [{ kind: 'acBonus', amount: 1 }] });
    // On the target it holds under the rules of the sheet it is on: no rules version.
    expect(screen.queryByLabelText('Armor Class: Rules')).toBeNull();
    expect(within(preview()).getByText('C')).toBeTruthy();
  });
});

describe('item fields', () => {
  it("counts charges on the sheet with the item's charges effect, and takes it out with them", () => {
    const withThree = withCharges({}, { charges: 3 });
    expect(withThree).toEqual({
      charges: 3,
      castGuidance: { v: 1, effects: [{ kind: 'charges', charges: 3, regain: 'none' }] },
    });
    const effects = (d: Json) => (d.castGuidance as Json).effects;
    expect(readOwnEffects(effects(withThree), 'effects').problems).toEqual([]);
    const dawn = { ...withThree, recharge: 'dawn', rechargeAmount: '{@dice 1d6 + 1}' };
    expect(effects({ ...dawn, ...withCharges(dawn, { charges: 5 }) })).toEqual([
      { kind: 'charges', charges: 5, regain: '1d6+1' },
    ]);
    // Its spells and ability stay through a change to the fields.
    const spells = [{ spell: 'Fireball|XPHB', cost: 1, upTo: 5 }];
    const cast = { ...dawn, ...withCharges(dawn, {}, { spells, ability: 'int' }) };
    expect(effects({ ...cast, ...withCharges(cast, { recharge: undefined }) })).toEqual([
      { kind: 'charges', charges: 3, regain: 'none', ability: 'int', spells },
    ]);
    expect(withCharges(withThree, { charges: undefined })).toEqual({
      charges: undefined,
      castGuidance: undefined,
    });
    expect(withCharges(withThree, { charges: 0 }).charges).toBeUndefined();
  });

  it('begins counting only for charges given an item that had none, or when asked', () => {
    // An item opened with charges the sheet does not count yet keeps them uncounted.
    const opened = { charges: 7, recharge: 'dawn' };
    expect(withCharges(opened, { charges: 6 })).toEqual({ charges: 6 });
    expect((withCharges(opened, {}, {}).castGuidance as Json).effects).toEqual([
      { kind: 'charges', charges: 7, regain: 'all' },
    ]);
    // One counted the older way, by its own pool, gets its fields alone.
    const old = {
      charges: 3,
      castGuidance: {
        v: 1,
        effects: [{ kind: 'resource', key: ITEM_CHARGES, label: 'Charges', max: 3, reset: 'long' }],
      },
    };
    expect(withCharges(old, { charges: 4 }, {})).toEqual({ charges: 4 });
  });

  it('says what comes back as the effect does, from the standard fields', () => {
    expect(regainOf(undefined, '{@dice 1d6 + 1}')).toBe('none');
    expect(regainOf('dawn', undefined)).toBe('all');
    expect(regainOf('dusk', '{@dice 1d6 + 1}')).toBe('1d6+1');
    expect(regainOf('dawn', 3)).toBe(3);
    expect(regainOf('dawn', 'all')).toBe('all');
  });

  it('writes a property as the others are written', () => {
    expect(withProperty({ property: ['L|XPHB'] }, 'F', true)).toEqual(['L|XPHB', 'F|XPHB']);
    expect(withProperty({}, 'F', true)).toEqual(['F']);
    expect(withProperty({ property: ['F', 'L'] }, 'F', false)).toEqual(['L']);
  });

  it('shows a recharge roll as words and stores it tagged, as the data does', () => {
    expect(rechargeWords('{@dice 1d6 + 1}')).toBe('1d6 + 1');
    expect(rechargeWords(3)).toBe('3');
    expect(rechargeWords('all')).toBe('all');
    expect(rechargeValue('1d6 + 1')).toBe('{@dice 1d6 + 1}');
    expect(rechargeValue('d3')).toBe('{@dice d3}');
    expect(rechargeValue('2')).toBe(2);
    expect(rechargeValue('all')).toBe('all');
    expect(rechargeValue(undefined)).toBeUndefined();
    // A round trip leaves what the data had.
    expect(rechargeValue(rechargeWords('{@dice 1d3}'))).toBe('{@dice 1d3}');
  });
});

describe('ItemEditor', () => {
  it('makes a magic weapon the attack list reads', () => {
    const draft = mount(item, { name: 'Ember Edge', ...item.blank() });
    type('Type', 'M');
    type('Damage', '1d8');
    type('Attack and damage', '1');
    type('Extra damage on a hit', '1d4');
    press('Finesse');
    expect(draft()).toMatchObject({
      type: 'M',
      weaponCategory: 'simple',
      dmg1: '1d8',
      dmgType: 'S',
      bonusWeapon: '+1',
      extraDamage: [{ dmgType: 'F', dmg: '1d4' }],
      property: ['F'],
    });
  });

  it('counts its charges with the spells they cast, and says what does not count yet', () => {
    const registry = new EntityRegistry();
    registry.addAll('spell', [
      { name: 'Misty Step', source: 'PHB', level: 2 },
    ] as unknown as Entity[]);
    const draft = mount(item, { name: 'Blink Wand', ...item.blank() }, registry);
    const effects = () => (draft().castGuidance as Json | undefined)?.effects;
    type('Charges', '3');
    expect(effects()).toEqual([{ kind: 'charges', charges: 3, regain: 'none' }]);
    type('Regains them', 'dawn');
    type('How many', '1d6 + 1');
    expect(draft()).toMatchObject({ recharge: 'dawn', rechargeAmount: '{@dice 1d6 + 1}' });
    press('Add a spell its charges cast');
    // Before a spell is picked, the section asks for one in words.
    expect(screen.getByText(/This does not count yet: .*pick a spell from the list/)).toBeTruthy();
    expect(screen.queryByText(/name\|source/)).toBeNull();
    type('Charge spell 1', 'misty step');
    type('Charge spell 1: up to level', '4');
    type("Its spells' attack and DC from", 'int');
    expect(effects()).toEqual([
      {
        kind: 'charges',
        charges: 3,
        regain: '1d6+1',
        ability: 'int',
        spells: [{ spell: 'Misty Step|PHB', cost: 1, upTo: 4 }],
      },
    ]);
    expect(readOwnEffects(effects(), 'effects').problems).toEqual([]);
    expect(screen.queryByText(/This does not count yet/)).toBeNull();
    // The charges show under Charges, not again among the cards.
    expect(screen.queryByRole('button', { name: /^Remove charges/ })).toBeNull();
    expect(screen.getByText(/^Nothing else for the sheet to count yet/)).toBeTruthy();
    type('Charge spell 1: up to level', '');
    type('Charge spell 1: costs', '2');
    expect((effects() as Json[])[0]?.spells).toEqual([{ spell: 'Misty Step|PHB', cost: 2 }]);
    press('Remove charge spell 1');
    expect((effects() as Json[])[0]).not.toHaveProperty('spells');
    type('Charges', '');
    expect(draft()).not.toHaveProperty('castGuidance');
    expect(screen.queryByText(/The sheet counts them/)).toBeNull();
    expect(screen.getByText(/^Nothing for the sheet to count yet/)).toBeTruthy();
  });

  it('lets an action spend its charges once the sheet counts them, and a spell card not', async () => {
    const draft = mount(item, { name: 'Storm Rod', ...item.blank() });
    choice.current = 'Action';
    press('More');
    const spends = () => screen.getByLabelText('Action: Spends') as HTMLSelectElement;
    await screen.findByLabelText('Action: Spends');
    const offered = () => [...spends().options].map((o) => o.textContent);
    expect(offered()).not.toContain('Its charges');
    type('Charges', '5');
    expect(offered()).toContain('Its charges');
    fireEvent.change(spends(), { target: { value: ITEM_CHARGES } });
    const effects = (draft().castGuidance as Json).effects as Json[];
    expect(effects[0]).toMatchObject({ kind: 'charges', charges: 5 });
    expect(effects[1]).toMatchObject({ kind: 'action', cost: { resource: ITEM_CHARGES } });
    expect(readOwnEffects(effects, 'effects').problems).toEqual([]);
    expect(screen.getAllByText(/spends 1 charge\b/).length).toBeGreaterThan(0);
    // A buy-back stays on the pool it names, which is not the copy's.
    const back = screen.getByLabelText('Action: Buys back a use with') as HTMLSelectElement;
    expect([...back.options].map((o) => o.value)).not.toContain(ITEM_CHARGES);
    // A spell an item casts by its charges is listed under Charges, so a card does not spend them.
    choice.current = 'Cast a spell';
    press('More');
    const cast = (await screen.findByLabelText('Cast a spell: Cast')) as HTMLSelectElement;
    expect([...cast.options].map((o) => o.value)).toEqual(['', 'prepared']);
  });

  it("names a pool of its own under the charges' key as its charges, which an action spends", () => {
    // A pool named Charges beside the counted charges: the sheet moves an
    // action's cost under that key to the copy's charges.
    mount(item, {
      name: 'Twin Rod',
      type: 'RD',
      entries: [],
      charges: 3,
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'charges', charges: 3, regain: 'all' },
          { kind: 'resource', key: ITEM_CHARGES, label: 'Charges', max: 2, reset: 'long' },
          { kind: 'action', economy: 'bonus', label: 'Jolt', cost: { resource: ITEM_CHARGES } },
        ],
      },
    });
    const spends = screen.getByLabelText('Action: Spends') as HTMLSelectElement;
    expect([...spends.options].filter((o) => o.value === ITEM_CHARGES).map((o) => o.text)).toEqual([
      'Its charges',
    ]);
    const back = screen.getByLabelText('Action: Buys back a use with') as HTMLSelectElement;
    expect([...back.options].filter((o) => o.value === ITEM_CHARGES).map((o) => o.text)).toEqual([
      'Uses of Charges',
    ]);
  });

  it('leaves charges counted the older way as they are, and says so', () => {
    const old: Json = {
      name: 'Old Wand',
      type: 'WD',
      entries: [],
      charges: 3,
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: ITEM_CHARGES, label: 'Charges', max: 3, reset: 'long' },
          { kind: 'grantSpell', spell: 'Shield|PHB', resourceKey: ITEM_CHARGES, usage: '1/day' },
        ],
      },
    };
    const draft = mount(item, structuredClone(old));
    expect(screen.getByText(/counts these the older way/)).toBeTruthy();
    // Its pool is a card like any other, there to change or remove.
    expect(screen.getByLabelText('Uses per rest: Name')).toHaveProperty('value', 'Charges');
    expect(screen.queryByRole('button', { name: 'Count them on the sheet' })).toBeNull();
    type('Charges', '4');
    expect(draft()).toEqual({ ...old, charges: 4 });
  });

  it('writes out the spells the app prices for a copy of an item it counts', () => {
    const registry = new EntityRegistry();
    registry.setRuleSets(BUILT_IN_RULE_SETS);
    registry.addAll('spell', [
      { name: 'Fireball', source: 'PHB', level: 3 },
      { name: 'Fireball', source: 'XPHB', level: 3 },
    ] as unknown as Entity[]);
    const original: Json = {
      name: 'Wand of Fireballs',
      source: 'XDMG',
      type: 'WD|XDMG',
      charges: 7,
      recharge: 'dawn',
      rechargeAmount: '{@dice 1d6 + 1}',
      entries: [],
    };
    const draft = mount(item, structuredClone(original), registry, original);
    expect(screen.getByText(/cast the spells Wand of Fireballs casts/)).toBeTruthy();
    press('Count them on the sheet');
    expect((draft().castGuidance as Json).effects).toEqual([
      {
        kind: 'charges',
        charges: 7,
        regain: '1d6+1',
        spells: [{ spell: 'Fireball|XPHB', cost: 1, upTo: 5 }],
      },
    ]);
    expect(screen.queryByRole('button', { name: 'Count them on the sheet' })).toBeNull();
  });

  it('counts the charges of an item the app does not price, with no spells yet', () => {
    const draft = mount(item, { name: 'Odd Rod', type: 'RD', entries: [], charges: 2 });
    expect(screen.getByText(/The sheet does not count these yet/)).toBeTruthy();
    expect(screen.queryByText(/cast the spells/)).toBeNull();
    press('Count them on the sheet');
    expect((draft().castGuidance as Json).effects).toEqual([
      { kind: 'charges', charges: 2, regain: 'none' },
    ]);
  });

  it('keeps the granted spell box while its name is cleared and typed again', () => {
    const draft = mount(item, {
      name: 'Ring',
      type: 'RG',
      additionalSpells: [{ known: { _: ['blink'] } }],
      entries: [],
    });
    type('Spell', '');
    expect(draft().additionalSpells).toBeUndefined();
    type('Spell', 'shield');
    expect(JSON.stringify(draft().additionalSpells)).toContain('shield');
  });

  it('keeps a cast spell on the uses it spends when they are renamed', () => {
    const draft = mount(item, {
      name: 'Wand',
      type: 'WD',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'uses', label: 'Uses', max: 3, reset: 'long' },
          { kind: 'grantSpell', spell: 'Shield|PHB', resourceKey: 'uses', usage: '1/day' },
        ],
      },
    });
    type('Uses per rest: Name', 'Sparks');
    const effects = (draft().castGuidance as Json).effects as Json[];
    expect(effects[0]).toMatchObject({ key: 'sparks', label: 'Sparks' });
    expect(effects[1]).toMatchObject({ resourceKey: 'sparks' });
    expect(readStoredEffects(effects).problems).toEqual([]);
  });

  it('shows words a file gives by level, and puts one value in their place when changed', () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'resource',
            key: 'embers',
            label: { byLevel: { '5': 'Embers (d8)', '1': 'Embers (d6)' } },
            max: 2,
            reset: { byLevel: { '1': 'long', '5': 'short' } },
          },
          { kind: 'action', economy: 'bonus', label: { byLevel: { '1': 'Flare' } } },
        ],
      },
    });
    const effects = () => (draft().castGuidance as Json).effects as Json[];
    expect(readStoredEffects(effects()).problems).toEqual([]);
    expect(
      screen.getByText('Embers (d6), by level: 2 uses, back on a rest that changes by level'),
    ).toBeTruthy();
    expect(screen.getByText('Bonus action: Flare, by level')).toBeTruthy();
    const name = screen.getByLabelText('Uses per rest: Name') as HTMLInputElement;
    expect([name.value, name.placeholder]).toEqual(['', 'By level, as written']);
    const back = screen.getByLabelText('Uses per rest: Back on') as HTMLSelectElement;
    expect(back.selectedOptions[0]?.textContent).toBe('By level, as written');
    type('Uses per rest: Back on', 'short');
    type('Action: Name', 'Flare');
    expect(effects()[0]).toMatchObject({ reset: 'short', label: { byLevel: expect.anything() } });
    expect(effects()[1]).toMatchObject({ label: 'Flare' });
    expect(readStoredEffects(effects()).problems).toEqual([]);
  });

  it('shows a spell a file casts with the class that gives it, and keeps it readable when changed', () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'grantSpell',
            spell: 'Shield|PHB',
            ownClass: true,
            usage: { byLevel: { '1': '1/day', '5': '2/day' } },
          },
        ],
      },
    });
    const effects = () => (draft().castGuidance as Json).effects as Json[];
    const from = screen.getByLabelText('Cast a spell: Attack and DC from') as HTMLSelectElement;
    expect(from.selectedOptions[0]?.textContent).toBe('The class that gives it');
    type('Cast a spell: Attack and DC from', 'wis');
    expect(effects()[0]).toMatchObject({ ability: 'wis' });
    expect(effects()[0]).not.toHaveProperty('ownClass');
    expect(readStoredEffects(effects()).problems).toEqual([]);
    type('Cast a spell: Attack and DC from', '');
    expect(effects()[0]).not.toHaveProperty('ability');
    expect(readStoredEffects(effects()).problems).toEqual([]);
  });

  it('shows the rules version a file gives an effect, and a pool named for its class', () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'resource',
            edition: '2024',
            key: 'embers',
            label: 'Embers',
            ownClass: true,
            max: 2,
            reset: 'long',
          },
          { kind: 'acBonus', amount: 1 },
        ],
      },
    });
    const effects = () => (draft().castGuidance as Json).effects as Json[];
    expect(
      screen.getByText('Embers (name of the class that gives it): 2 uses, back on a long rest'),
    ).toBeTruthy();
    const rules = (label: string) =>
      (screen.getByLabelText(label) as HTMLSelectElement).selectedOptions[0]?.textContent;
    expect(rules('Uses per rest: Rules')).toBe('2024 rules only');
    expect(rules('Uses per rest: Class in the name')).toBe('Always');
    // Every card offers one, either rules until one is picked.
    expect(rules('Armor Class: Rules')).toBe('Either rules');
    type('Armor Class: Rules', '2014');
    expect(effects()[1]).toEqual({ kind: 'acBonus', amount: 1, edition: '2014' });
    // Renaming the pool keeps both.
    type('Uses per rest: Name', 'Sparks');
    expect(effects()[0]).toMatchObject({ label: 'Sparks', edition: '2024', ownClass: true });
    type('Uses per rest: Rules', '2014');
    expect(effects()[0]).toMatchObject({ edition: '2014' });
    expect(readStoredEffects(effects()).problems).toEqual([]);
    type('Uses per rest: Rules', '');
    expect(effects()[0]).not.toHaveProperty('edition');
    expect(rules('Uses per rest: Rules')).toBe('Either rules');
    expect(readStoredEffects(effects()).problems).toEqual([]);
  });

  it('names a pool or an action for its class, always or beside the classes typed', () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'embers', label: 'Embers', max: 2, reset: 'long' },
          { kind: 'action', economy: 'bonus', label: 'Kindle' },
          { kind: 'acBonus', amount: 1 },
        ],
      },
    });
    const effects = () => (draft().castGuidance as Json).effects as Json[];
    const naming = (label: string) =>
      (screen.getByLabelText(label) as HTMLSelectElement).selectedOptions[0]?.textContent;
    expect(naming('Uses per rest: Class in the name')).toBe('Never');
    // Only a pool and an action have a name the sheet can add the class to.
    expect(screen.queryByLabelText('Armor Class: Class in the name')).toBeNull();
    type('Uses per rest: Class in the name', 'own');
    expect(effects()[0]).toMatchObject({ ownClass: true });
    expect(
      screen.getByText('Embers (name of the class that gives it): 2 uses, back on a long rest'),
    ).toBeTruthy();
    // Beside: no class yet is a problem the card says in words.
    type('Uses per rest: Class in the name', 'beside');
    expect(effects()[0]).not.toHaveProperty('ownClass');
    expect(effects()[0]).toMatchObject({ ownClassBeside: [] });
    expect(screen.getByText(/name a class it stands beside/)).toBeTruthy();
    // A comma typed stays, for the next name.
    type('Uses per rest: Beside which classes', 'Paladin,');
    expect(effects()[0]).toMatchObject({ ownClassBeside: ['Paladin'] });
    expect(
      (screen.getByLabelText('Uses per rest: Beside which classes') as HTMLInputElement).value,
    ).toBe('Paladin,');
    type('Uses per rest: Beside which classes', 'Paladin, cleric ');
    expect(effects()[0]).toMatchObject({ ownClassBeside: ['Paladin', 'cleric'] });
    expect(readStoredEffects(effects()).problems).toEqual([]);
    expect(screen.queryByText(/name a class it stands beside/)).toBeNull();
    type('Uses per rest: Class in the name', '');
    expect(effects()[0]).toEqual({
      kind: 'resource',
      key: 'embers',
      label: 'Embers',
      max: 2,
      reset: 'long',
    });
    // An action too, so it can share an "ownClass" pool's name.
    type('Action: Class in the name', 'own');
    expect(effects()[1]).toEqual({
      kind: 'action',
      economy: 'bonus',
      label: 'Kindle',
      ownClass: true,
    });
    expect(screen.getByText('Bonus action: Kindle (name of the class that gives it)')).toBeTruthy();
    expect(readStoredEffects(effects()).problems).toEqual([]);
  });

  it('shows the classes a pool is named beside after the card above it goes', () => {
    mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'resource',
            key: 'a',
            label: 'A',
            ownClassBeside: ['Cleric'],
            max: 1,
            reset: 'long',
          },
          {
            kind: 'resource',
            key: 'b',
            label: 'B',
            ownClassBeside: ['Paladin'],
            max: 1,
            reset: 'long',
          },
        ],
      },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove/ })[0] as HTMLElement);
    expect(
      (screen.getByLabelText('Uses per rest: Beside which classes') as HTMLInputElement).value,
    ).toBe('Paladin');
  });

  it('says in its own words a list of classes too long to stand beside', () => {
    const many = Array.from({ length: 13 }, (_, i) => `Class ${i}`);
    mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'a', label: 'A', ownClassBeside: many, max: 1, reset: 'long' },
        ],
      },
    });
    expect(screen.queryByText(/name a class it stands beside/)).toBeNull();
    expect(screen.getByText(/"ownClassBeside" lists at most 12/)).toBeTruthy();
  });

  it('takes away a rules version a file gives that is not one, in play or not', () => {
    for (const inPlay of [false, true]) {
      const changed: unknown[][] = [];
      render(
        <EffectCards
          effects={[
            { kind: 'acBonus', amount: 1, edition: '2015' },
            { kind: 'acBonus', amount: 2, edition: 2014 },
          ]}
          readOnly={false}
          inPlay={inPlay}
          onChange={(next) => changed.push(next)}
        />,
      );
      const boxes = screen.getAllByLabelText('Armor Class: Rules') as HTMLSelectElement[];
      expect(boxes).toHaveLength(2);
      for (const box of boxes) fireEvent.change(box, { target: { value: '' } });
      expect(changed).toEqual([
        [
          { kind: 'acBonus', amount: 1 },
          { kind: 'acBonus', amount: 2, edition: 2014 },
        ],
        [
          { kind: 'acBonus', amount: 1, edition: '2015' },
          { kind: 'acBonus', amount: 2 },
        ],
      ]);
      cleanup();
    }
  });

  it('lists a pool given for each rules version once to spend, kept on the card or elsewhere', () => {
    const half = (edition: '2014' | '2024') => ({
      kind: 'resource',
      edition,
      key: 'vigil',
      label: 'Vigil',
      max: { byLevel: { '1': 2 } },
      reset: 'long',
    });
    render(
      <EffectCards
        effects={[{ kind: 'action', economy: 'bonus', label: 'Watch' }]}
        resources={[half('2014'), half('2024')]}
        readOnly={false}
        onChange={() => undefined}
      />,
    );
    const spends = screen.getByLabelText('Action: Spends') as HTMLSelectElement;
    expect([...spends.options].map((o) => o.textContent)).toEqual([
      'Nothing',
      'Uses of Vigil',
      'A spell slot',
      'A Hit Point Die',
    ]);
  });

  it('offers no rules version on an effect in play, but shows one a file gives to take it away', () => {
    const changed: unknown[][] = [];
    render(
      <EffectCards
        effects={[
          { kind: 'acBonus', amount: 1 },
          { kind: 'acBonus', amount: 2, edition: '2024' },
        ]}
        readOnly={false}
        inPlay
        onChange={(next) => changed.push(next)}
      />,
    );
    const boxes = screen.getAllByLabelText('Armor Class: Rules') as HTMLSelectElement[];
    expect(boxes).toHaveLength(1);
    fireEvent.change(boxes[0] as HTMLSelectElement, { target: { value: '' } });
    expect(changed.at(-1)).toEqual([
      { kind: 'acBonus', amount: 1 },
      { kind: 'acBonus', amount: 2 },
    ]);
  });

  it('says a pool and an action are named for their class beside a class a file lists', () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'resource',
            key: 'embers',
            label: 'Embers',
            ownClassBeside: ['Cleric', 'Paladin'],
            max: 2,
            reset: 'long',
          },
          { kind: 'action', economy: 'bonus', label: 'Embers', ownClassBeside: ['Paladin'] },
          { kind: 'action', economy: 'action', label: 'Vow', ownClass: true },
        ],
      },
    });
    const effects = () => (draft().castGuidance as Json).effects as Json[];
    expect(
      screen.getByText(
        'Embers (name of the class that gives it, beside a level in Cleric or Paladin): 2 uses, back on a long rest',
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        'Bonus action: Embers (name of the class that gives it, beside a level in Paladin)',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Action: Vow (name of the class that gives it)')).toBeTruthy();
    // Editing a card keeps what no box shows.
    type('Uses per rest: Name', 'Sparks');
    expect(effects()[0]).toMatchObject({ label: 'Sparks', ownClassBeside: ['Cleric', 'Paladin'] });
    expect(readStoredEffects(effects()).problems).toEqual([]);
  });

  it("prices an action: a pool's uses, a spell slot or a Hit Point Die, and a buy-back", () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'embers', label: 'Embers', max: 2, reset: 'long' },
          { kind: 'action', economy: 'action', label: 'Flare' },
        ],
      },
    });
    const action = () => ((draft().castGuidance as Json).effects as Json[])[1] as Json;
    const shows = (label: string) => screen.queryByLabelText(`Action: ${label}`) !== null;
    const line = (text: string) => expect(screen.getByText(text)).toBeTruthy();
    const counts = () => expect(readStoredEffects([action()]).problems).toEqual([]);
    // A rider takes nothing from the turn.
    type('Action: Takes', 'none');
    line('No action: Flare');
    expect(shows('How many')).toBe(false);
    type('Action: Spends', 'embers');
    expect(action().cost).toEqual({ resource: 'embers', amount: 1 });
    line('No action: Flare, spends 1 use of embers');
    type('Action: How many', '3');
    expect(action().cost).toEqual({ resource: 'embers', amount: 3 });
    type('Action: How many', 'varies');
    line('No action: Flare, spends uses of embers, as many as you choose');
    type('Action: Paid for', 'optional');
    expect(action().cost).toEqual({ resource: 'embers', amount: 'varies', optional: true });
    line('No action: Flare, free, or uses of embers, as many as you choose for more');
    counts();
    // A spell slot is one, pays for every use, and may need a level or Pact Magic.
    type('Action: Spends', 'spell-slot');
    expect(action().cost).toEqual({ resource: 'spell-slot', amount: 1 });
    expect([shows('How many'), shows('Paid for')]).toEqual([false, false]);
    type('Action: Which slots', '3');
    expect(action().cost).toEqual({ resource: 'spell-slot', amount: 1, minLevel: 3 });
    line('No action: Flare, spends a level 3+ spell slot');
    type('Action: Which slots', 'pact');
    expect(action().cost).toEqual({ resource: 'spell-slot', amount: 1, pactOnly: true });
    counts();
    // A Hit Point Die heals as it is spent.
    type('Action: Spends', 'hit-die');
    expect(action().cost).toEqual({ resource: 'hit-die', amount: 1 });
    type('Action: It heals', 'rollPlusCon');
    expect(action().cost).toEqual({ resource: 'hit-die', amount: 1, hitDieHeals: 'rollPlusCon' });
    line('No action: Flare, spends a Hit Point Die');
    counts();
    type('Action: Spends', 'embers');
    expect(action().cost).toEqual({ resource: 'embers', amount: 1 });
    // What buys a use back once none are left, of the pool it spends: the
    // sheet gives back only a use it is told of, or one sharing the action's name.
    type('Action: Buys back a use with', 'spell-slot');
    type('Action: Buy-back slots', '5');
    expect(action().buyBack).toEqual({
      resource: 'spell-slot',
      amount: 1,
      own: 'embers',
      minLevel: 5,
    });
    line(
      'No action: Flare, spends 1 use of embers, buys a use of embers back with a level 5+ spell slot',
    );
    const restores = screen.getByLabelText('Action: Restores') as HTMLSelectElement;
    expect([...restores.options].map((o) => o.textContent)).toEqual(['Same name', 'Embers']);
    type('Action: Restores', '');
    expect(action().buyBack).toEqual({ resource: 'spell-slot', amount: 1, minLevel: 5 });
    line('No action: Flare, spends 1 use of embers, buys a use back with a level 5+ spell slot');
    type('Action: Restores', 'embers');
    type('Action: Buys back a use with', 'embers');
    type('Action: Buy-back uses', '2');
    expect(action().buyBack).toEqual({ resource: 'embers', amount: 2, own: 'embers' });
    counts();
    type('Action: Buys back a use with', '');
    expect(shows('Restores')).toBe(false);
    type('Action: Spends', '');
    expect(action()).toEqual({ kind: 'action', economy: 'none', label: 'Flare' });
  });

  it('keeps what no price box shows, and shows a price no box offers as written', () => {
    const cost = {
      resource: 'spell-slot',
      amount: 1,
      minLevel: 3,
      pactOnly: true,
      optional: true,
      ownUseToo: true,
      slotDice: { die: 8, base: 1 },
      slotRefills: 'embers',
    };
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'embers', label: 'Embers', max: 2, reset: 'long' },
          {
            kind: 'action',
            economy: 'bonus',
            label: 'Flare',
            cost,
            buyBack: { resource: 'cinders', amount: 15, own: 'embers' },
          },
        ],
      },
    });
    const action = () => ((draft().castGuidance as Json).effects as Json[])[1] as Json;
    const chosen = (label: string) =>
      (screen.getByLabelText(`Action: ${label}`) as HTMLSelectElement).selectedOptions[0]
        ?.textContent;
    // A slot pays for every use, free base use or not.
    expect(
      screen.getByText(
        'Bonus action: Flare, spends a level 3+ Pact Magic slot, buys a use of embers back with 15 uses of cinders',
      ),
    ).toBeTruthy();
    expect(chosen('Which slots')).toBe('a level 3+ Pact Magic slot');
    expect(chosen('Buys back a use with')).toBe('cinders');
    expect(chosen('Restores')).toBe('Embers');
    expect(chosen('Buy-back uses')).toBe('15');
    // A free base use a file gives a slot price shows, so it can be taken away.
    expect(chosen('Paid for')).toBe('Extra uses');
    type('Action: Paid for', '');
    type('Action: Which slots', '');
    const { minLevel: _, pactOnly: _pact, optional: _free, ...kept } = cost;
    expect(action().cost).toEqual(kept);
    type('Action: Buy-back uses', '2');
    expect(action().buyBack).toEqual({ resource: 'cinders', amount: 2, own: 'embers' });
    // Renaming the pool moves every price naming it.
    type('Uses per rest: Name', 'Sparks');
    expect(action().cost).toMatchObject({ slotRefills: 'sparks' });
    expect(action().buyBack).toEqual({ resource: 'cinders', amount: 2, own: 'sparks' });
  });

  it('never names a pool for a spell slot or a Hit Point Die, so a rename leaves their prices alone', () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'embers', label: 'Embers', max: 2, reset: 'long' },
          {
            kind: 'action',
            economy: 'action',
            label: 'Flare',
            cost: { resource: 'spell-slot', amount: 1, minLevel: 2 },
            buyBack: { resource: 'spell-slot', amount: 1, own: 'embers' },
          },
        ],
      },
    });
    const effects = () => (draft().castGuidance as Json).effects as Json[];
    // Typed a letter at a time, the name passes through a price's own word.
    for (const name of ['Spell Slot', 'Spell Slots']) type('Uses per rest: Name', name);
    expect(effects()[0]?.key).toBe('spell-slots');
    expect(effects()[1]).toMatchObject({
      cost: { resource: 'spell-slot', amount: 1, minLevel: 2 },
      buyBack: { resource: 'spell-slot', amount: 1, own: 'spell-slots' },
    });
    type('Uses per rest: Name', 'Hit Die');
    expect(effects()[0]?.key).toBe('hit-die-uses');
    const spends = screen.getByLabelText('Action: Spends') as HTMLSelectElement;
    expect([...spends.options].map((o) => o.value)).toEqual([
      '',
      'hit-die-uses',
      'spell-slot',
      'hit-die',
    ]);
    expect(readStoredEffects(effects()).problems).toEqual([]);
  });

  it('shows a value no box means as written, and takes it away when one is picked', () => {
    const action = (label: string, cost: Json) => ({
      kind: 'action',
      economy: 'action',
      label,
      cost,
    });
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'resource', key: 'embers', label: 'Embers', max: 2, reset: 'long' },
          action('Mend', { resource: 'hit-die', amount: 1, hitDieHeals: 'all' }),
          action('Flare', { resource: 'spell-slot', amount: 1, minLevel: '3' }),
          action('Glow', { resource: 'embers', amount: '2' }),
        ],
      },
    });
    const cost = (i: number) => ((draft().castGuidance as Json).effects as Json[])[i]?.cost;
    const chosen = (label: string) =>
      (screen.getByLabelText(`Action: ${label}`) as HTMLSelectElement).selectedOptions[0]
        ?.textContent;
    expect([chosen('It heals'), chosen('Which slots'), chosen('How many')]).toEqual([
      'all',
      '"3"',
      '"2"',
    ]);
    type('Action: It heals', 'roll');
    type('Action: Which slots', '3');
    type('Action: How many', '2');
    expect([cost(1), cost(2), cost(3)]).toEqual([
      { resource: 'hit-die', amount: 1 },
      { resource: 'spell-slot', amount: 1, minLevel: 3 },
      { resource: 'embers', amount: 2 },
    ]);
  });

  it('keeps a pool given for each rules version one pool when renamed', () => {
    const pool = (edition: string, max: number) => ({
      kind: 'resource',
      edition,
      key: 'embers',
      label: 'Embers',
      max,
      reset: 'long',
    });
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          pool('2024', 2),
          pool('2014', 1),
          {
            kind: 'action',
            economy: 'bonus',
            label: 'Flare',
            cost: { resource: 'embers', amount: 1 },
          },
        ],
      },
    });
    const effects = () => (draft().castGuidance as Json).effects as Json[];
    // One pool to spend, under either version.
    const spends = screen.getByLabelText('Action: Spends') as HTMLSelectElement;
    expect([...spends.options].map((o) => o.textContent)).toEqual([
      'Nothing',
      'Uses of Embers',
      'A spell slot',
      'A Hit Point Die',
    ]);
    const [name] = screen.getAllByLabelText('Uses per rest: Name');
    fireEvent.change(name as HTMLElement, { target: { value: 'Sparks' } });
    expect(effects().map((e) => e.key ?? (e.cost as Json).resource)).toEqual([
      'sparks',
      'sparks',
      'sparks',
    ]);
    // Its name too, under either version.
    expect(effects().map((e) => e.label)).toEqual(['Sparks', 'Sparks', 'Flare']);
    expect(readStoredEffects(effects()).problems).toEqual([]);
  });

  it('counts a spell spending uses that rest by level by its first level’s rest', () => {
    const draft = mount(item, {
      name: 'Ember Lamp',
      type: 'OTH',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          {
            kind: 'resource',
            key: 'embers',
            label: 'Embers',
            max: 2,
            reset: { byLevel: { '1': 'short', '11': 'long' } },
          },
          { kind: 'grantSpell', spell: 'Shield|PHB' },
        ],
      },
    });
    type('Cast a spell: Cast', 'use:embers');
    const effects = (draft().castGuidance as Json).effects as Json[];
    expect(effects[1]).toMatchObject({ resourceKey: 'embers', usage: '1/rest' });
  });

  it('shows the spell a Cast a spell card holds after the card above it goes', () => {
    mount(item, {
      name: 'Staff',
      type: 'ST',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'grantSpell', spell: 'Shield|PHB' },
          { kind: 'grantSpell', spell: 'Misty Step|PHB' },
        ],
      },
    });
    fireEvent.click(screen.getAllByRole('button', { name: /^Remove/ })[0] as HTMLElement);
    expect((screen.getByLabelText('Cast a spell: Spell') as HTMLInputElement).value).toBe(
      'Misty Step',
    );
  });

  it('opens an item the Builder made, its granted spell included, and changes nothing', () => {
    const built: Json = {
      name: 'Ring of Warding',
      source: 'HBX',
      type: 'RG',
      bonusAc: '+1',
      reqAttune: true,
      additionalSpells: [{ innate: { _: { daily: { 1: ['misty step'] } } } }],
      entries: ['A ring.'],
    };
    const draft = mount(item, structuredClone(built));
    expect(draft()).toEqual(built);
    expect(screen.getByLabelText('Spell')).toHaveProperty('value', 'misty step');
    expect(screen.getByLabelText('Times a day')).toHaveProperty('value', '1');
    type('AC', '+2');
    expect(draft()).toEqual({ ...built, bonusAc: '+2' });
  });
});
