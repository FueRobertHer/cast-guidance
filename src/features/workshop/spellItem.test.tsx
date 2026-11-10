// @vitest-environment jsdom
// The spell and item editors: the standard fields each card writes, what the
// preview shows, and a Builder-made entry opening with nothing lost.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import { EntityRegistry } from '@/data5e/normalize';
import { readStoredEffects } from '@/engine/effects/mechanics';

const { choice } = vi.hoisted(() => ({ choice: { current: undefined as string | undefined } }));
vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({ status: 'ready', error: null, offline: false, retry: () => undefined }),
}));
vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(choice.current) }));

import {
  CHARGES,
  editor as item,
  rechargeValue,
  rechargeWords,
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
function mount(spec: EditorSpec, start: Json, registry = new EntityRegistry()) {
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
    return <spec.Body draft={draft} change={change} registry={registry} readOnly={false} />;
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
    expect(within(preview()).getByText('C')).toBeTruthy();
  });
});

describe('item fields', () => {
  it('counts charges on the sheet as a resource, and takes it out with them', () => {
    const withThree = withCharges({}, 3);
    expect(withThree).toEqual({
      charges: 3,
      castGuidance: {
        v: 1,
        effects: [{ kind: 'resource', key: CHARGES, label: 'Charges', max: 3, reset: 'long' }],
      },
    });
    expect(
      readStoredEffects(withThree.castGuidance && (withThree.castGuidance as Json).effects)
        .problems,
    ).toEqual([]);
    expect(withCharges(withThree, 5).castGuidance).toMatchObject({ effects: [{ max: 5 }] });
    expect(withCharges(withThree, undefined)).toEqual({
      charges: undefined,
      castGuidance: undefined,
    });
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

  it('casts a spell from the data by spending its charges', async () => {
    const registry = new EntityRegistry();
    registry.addAll('spell', [
      { name: 'Misty Step', source: 'PHB', level: 2 },
    ] as unknown as Entity[]);
    const draft = mount(item, { name: 'Blink Wand', ...item.blank() }, registry);
    type('Charges', '3');
    choice.current = 'Cast a spell';
    press('More');
    await screen.findByLabelText('Cast a spell: Spell');
    // Before a spell is picked, the card asks for one in words.
    expect(screen.getByText('Cast a spell at will')).toBeTruthy();
    expect(screen.getByText(/pick a spell from the list/)).toBeTruthy();
    expect(screen.queryByText(/name\|source/)).toBeNull();
    type('Cast a spell: Spell', 'misty step');
    type('Cast a spell: Cast', `use:${CHARGES}`);
    type('Cast a spell: Attack and DC from', 'int');
    const effects = (draft().castGuidance as Json).effects as Json[];
    expect(effects).toEqual([
      { kind: 'resource', key: CHARGES, label: 'Charges', max: 3, reset: 'long' },
      {
        kind: 'grantSpell',
        spell: 'Misty Step|PHB',
        resourceKey: CHARGES,
        usage: '1/day',
        ability: 'int',
      },
    ]);
    expect(readStoredEffects(effects).problems).toEqual([]);
    // The charges show under Charges, not again among the cards.
    expect(screen.queryByText(/^Charges: 3 uses/)).toBeNull();
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
