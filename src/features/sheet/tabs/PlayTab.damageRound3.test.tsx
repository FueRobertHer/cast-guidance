// @vitest-environment jsdom
// Spell attack damage, the Attack action's later attacks and what the turn
// allows, through the real sheet and the roll toast: a spell attack's hit
// offers its damage, which asks as a weapon's does (a cantrip's too); the next
// attack is offered beside a hit's damage; Haste's action allows one attack
// more; 2014 Savage Attacker rerolls the weapon's dice once the damage shows;
// a spell like 2024 Divine Favor puts its dice on every weapon hit as it is
// cast; and the 2024 rules' one spell slot a turn is marked and said.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollDetail, RollResult } from '@/dice/types';
import { catalogFor, landEntry } from '@/engine/curated/effectCatalog';
import type { ActiveEffect, CharacterDoc, DataEntity } from '@/engine/types';
import { heldRollStore } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { RollToast } from '@/ui/RollToast';
import {
  castHeld,
  classEntry,
  HARNESS_TIMEOUT,
  left,
  notice,
  renderSheet,
  resetSheetHarness,
  sorcerer,
  testCharacter,
} from '../../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

beforeEach(() => {
  localStorage.clear();
  rollLogStore.getState().clear();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await resetSheetHarness();
});

/** The faces the next dice show, in order (the roller draws from crypto). */
function nextFaces(...faces: number[]) {
  const queue = [...faces];
  vi.spyOn(crypto, 'getRandomValues').mockImplementation((buf) => {
    const face = queue.shift();
    if (face === undefined) throw new Error('rolled more dice than the test set up');
    if (buf instanceof Uint32Array) buf[0] = face - 1;
    return buf;
  });
}

const rolls = () => rollLogStore.getState().rolls;
/** A roll's die groups as "d8 [3, 5]" faces. */
const dice = (r: RollResult | undefined) =>
  (r?.terms ?? [])
    .filter((t): t is DiceRollDetail => t.kind === 'dice')
    .map((t) => `d${String(t.sides)} [${t.rolls.map((x) => x.v).join(', ')}]`);
const mods = (r: RollResult | undefined) =>
  (r?.terms ?? []).flatMap((t) => (t.kind === 'mod' ? [t.value] : []));

/** Opens a d20 test's roll prompt, and taps the control again to roll it. */
const rollOn = (el: HTMLElement) => {
  fireEvent.click(el);
  fireEvent.click(el);
};
/** The prompt open for `label`: a d20 test's, or a damage roll's. */
const prompt = (label: string) => screen.getByRole('group', { name: `${label}, choose and roll` });
const promptOpen = () => screen.queryByRole('group', { name: /, choose and roll$/ }) !== null;
/** Presses a button inside `el` by its name. */
const press = (el: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(el).getByRole('button', { name }));
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const noButton = (name: string | RegExp) =>
  expect(screen.queryByRole('button', { name })).toBeNull();
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';

const LONGSWORD = { name: 'Longsword', source: 'TST' };
const SHORTBOW = { name: 'Shortbow', source: 'TST' };
const carried = (...refs: Array<{ name: string; source: string }>): CharacterDoc['equipment'] =>
  refs.map((ref, i) => ({
    id: `e${String(i + 1)}`,
    ref,
    qty: 1,
    equipped: true,
    attuned: false,
  }));

/** The harness's level-5 sorcerer (slots 4, 3, 2) knowing `spells`, with a longsword in hand. */
function caster(spells: string[], more: (doc: CharacterDoc) => void = () => {}) {
  const doc = sorcerer();
  const refs = spells.map((name) => ({ name, source: 'TST' }));
  doc.spellcasting = { 'sorcerer|tst': { known: refs, prepared: refs } };
  doc.equipment = carried(LONGSWORD);
  more(doc);
  return doc;
}

/** A warrior with STR 16 (+3), level 3 unless said, and what `more` sets. */
function fighter(more: (doc: CharacterDoc) => void = () => {}, level = 3) {
  const doc = testCharacter('Grog', [classEntry('Warrior', level)], { str: 16, con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.equipment = carried(LONGSWORD);
  more(doc);
  return doc;
}

const attack = (weapon: string) => screen.getByTitle(`${weapon} attack`);
const nextAttack = () => screen.queryByRole('button', { name: /^Next attack/ });

describe("a spell attack's damage", () => {
  const fireDart: DataEntity = {
    name: 'Fire Dart',
    source: 'TST',
    level: 0,
    school: 'V',
    time: [{ number: 1, unit: 'action' }],
    spellAttack: ['R'],
    entries: ['A dart deals {@damage 1d10} fire damage.'],
  };
  const rayLance: DataEntity = {
    name: 'Ray Lance',
    source: 'TST',
    level: 1,
    school: 'V',
    time: [{ number: 1, unit: 'action' }],
    spellAttack: ['R'],
    entries: ['A lance deals {@damage 1d10} fire damage.'],
    entriesHigherLevel: [
      { entries: ['The damage increases by {@scaledamage 1d10|1-9|1d10} per slot above 1st.'] },
    ],
  };
  const world = { extra: { spell: [fireDart, rayLance] } };

  it("offers a cantrip's damage after a hit, and asks before it rolls", async () => {
    await renderSheet(caster(['Fire Dart']), world);
    render(<RollToast />);
    nextFaces(15);
    rollOn(screen.getByTitle('Fire Dart spell attack'));
    nextFaces();
    fireEvent.click(button('Roll 1d10'));
    const group = prompt('Fire Dart fire damage');
    expect(rolls()).toHaveLength(1);
    nextFaces(7);
    press(group, 'Roll');
    const dealt = rolls()[0];
    expect(dealt?.label).toBe('Fire Dart fire damage');
    expect(dice(dealt)).toEqual(['d10 [7]']);
  });

  it("doubles a cantrip's dice on a natural 20, in the prompt and as it lands", async () => {
    await renderSheet(caster(['Fire Dart']), world);
    render(<RollToast />);
    nextFaces(20);
    rollOn(screen.getByTitle('Fire Dart spell attack'));
    nextFaces();
    fireEvent.click(button('Roll 2d10'));
    const group = prompt('Fire Dart fire damage');
    expect(group.textContent).toContain('2d10');
    expect(group.textContent).toContain('Critical hit: every damage die rolls twice');
    nextFaces(3, 9);
    press(group, 'Roll');
    const dealt = rolls()[0];
    expect(dice(dealt)).toEqual(['d10 [3, 9]']);
    expect(dealt?.meta?.critical).toBe(true);
  });

  it("opens the damage prompt from a cantrip's damage chip with no attack waiting", async () => {
    await renderSheet(caster(['Fire Dart']), world);
    render(<RollToast />);
    nextFaces(); // asking rolls nothing
    fireEvent.click(screen.getByTitle('Fire Dart fire damage'));
    const group = prompt('Fire Dart fire damage');
    expect(rolls()).toHaveLength(0);
    expect(group.textContent).not.toContain('Critical hit');
    nextFaces(4);
    press(group, 'Roll');
    expect(dice(rolls()[0])).toEqual(['d10 [4]']);
  });

  it('rolls a leveled spell attack’s damage tapped while it waits at the level picked', async () => {
    await renderSheet(caster(['Ray Lance']), world);
    render(<RollToast />);
    nextFaces();
    fireEvent.click(screen.getByTitle('Ray Lance spell attack'));
    const group = prompt('Ray Lance spell attack');
    press(group, 'Level 2 slot, 3 left');
    fireEvent.click(screen.getByTitle('Ray Lance fire damage'));
    expect(heldRollStore.getState().held?.queued).toBeDefined();
    expect(rolls()).toHaveLength(0);

    // Nothing to add: the damage rolls with the attack, at the 2nd level's dice.
    nextFaces(15, 4, 6);
    press(group, 'Roll');
    expect(promptOpen()).toBe(false);
    const [dealt, swing] = rolls();
    expect(swing?.label).toBe('Ray Lance spell attack');
    expect(dealt?.label).toBe('Ray Lance fire damage');
    expect(dealt?.meta?.withRoll).toBe(swing?.id);
    expect(dice(dealt)).toEqual(['d10 [4, 6]']);
    expect(left('Level 2 slot')).toBe(2);
  });
});

describe('the next attack, right after the attack roll', () => {
  it('is offered beside a hit’s damage, and needs no damage rolled', async () => {
    const sheet = await renderSheet(fighter(undefined, 5));
    render(<RollToast />);
    nextFaces(15);
    rollOn(attack('Longsword'));
    expect((await sheet.history())[0]).toBe('Attacked with Longsword');
    expect(button('Roll 1d8+3')).toBeTruthy();
    expect(nextAttack()?.textContent).toContain('Attack 2 of 2');

    fireEvent.click(nextAttack() as HTMLElement);
    const group = prompt('Longsword attack');
    expect(rolls()).toHaveLength(1);
    nextFaces(12);
    press(group, 'Roll');
    expect(rolls().map((r) => r.label)).toEqual(['Longsword attack', 'Longsword attack']);
    const saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ action: true, attackAction: true, attacks: 2 });
    expect((await sheet.history())[0]).toBe('Attacked with Longsword (2 of 2)');
    expect(nextAttack()).toBeNull();
  });
});

describe("Haste's action", () => {
  /** The catalog's Haste on the character, as the effects sheet lands it. */
  const haste = (): ActiveEffect => {
    const entry = catalogFor('2014').find((e) => e.id === 'haste');
    if (entry === undefined) throw new Error('no Haste in the catalog');
    return landEntry(entry, {}, 'haste1').effect;
  };
  const hasted = () =>
    fighter((d) => {
      d.play.activeEffects = [haste()];
    }, 5);
  const hasteBox = () => screen.getByTitle(/your Haste action$|^Haste action used/);
  /** Rolls a natural 1 with the Longsword: the attack counts, and no damage follows. */
  const swing = () => {
    nextFaces(1);
    rollOn(attack('Longsword'));
  };

  it('allows one attack past Extra Attack, which takes its box', async () => {
    const sheet = await renderSheet(hasted());
    render(<RollToast />);
    expect(hasteBox().textContent).toContain('one weapon attack only');
    swing();
    expect((await sheet.history())[0]).toBe('Attacked with Longsword');
    expect(nextAttack()?.textContent).toContain('Attack 2 of 3');
    swing();
    expect((await sheet.history())[0]).toBe('Attacked with Longsword (2 of 3)');
    let saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ action: true, attacks: 2 });
    expect(saved.play.turn?.extra).toBeUndefined();
    expect(nextAttack()?.textContent).toContain('Attack 3 of 3');

    swing();
    saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ attacks: 3, extra: ['Haste action'], hasted: true });
    expect(pressed(hasteBox())).toBe(true);
    expect((await sheet.history())[0]).toBe('Attacked with Longsword (Haste action)');
    expect(nextAttack()).toBeNull();
  });

  it('takes the first attack when the action went to something else', async () => {
    const sheet = await renderSheet(hasted());
    render(<RollToast />);
    // A Dash, say: the action box ticked by hand.
    fireEvent.click(screen.getByTitle('Tap when you use your action'));
    swing();
    const saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({
      action: true,
      attacks: 1,
      extra: ['Haste action'],
      hasted: true,
    });
    expect(saved.play.turn?.attackAction).toBeUndefined();
    expect((await sheet.history())[0]).toBe('Attacked with Longsword (Haste action)');
    expect(nextAttack()).toBeNull();
  });

  it('adds no attack once its box is ticked by hand', async () => {
    const sheet = await renderSheet(hasted());
    render(<RollToast />);
    fireEvent.click(hasteBox());
    swing();
    expect(nextAttack()?.textContent).toContain('Attack 2 of 2');
    swing();
    expect(nextAttack()).toBeNull();
    const saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ attacks: 2, extra: ['Haste action'] });
    expect(saved.play.turn?.hasted).toBeUndefined();
    expect((await sheet.history())[0]).toBe('Attacked with Longsword (2 of 2)');
  });
});

describe('2014 Savage Attacker', () => {
  const savageAttacker: DataEntity = {
    name: 'Savage Attacker',
    source: 'TST',
    entries: [
      "Once per turn when you roll damage for a melee weapon attack, you can reroll the weapon's damage dice and use either total.",
    ],
  };
  /** A d4 on every weapon hit, of no type: it rolls in the weapon's own roll. */
  const keenEdge: ActiveEffect = {
    id: 'k1',
    name: 'Keen Edge',
    parts: [{ kind: 'damageDie', scope: 'all', dice: '1d4' }],
  };
  const savage = () =>
    fighter((d) => {
      d.equipment = carried(LONGSWORD, SHORTBOW);
      d.feats = [{ ref: { name: 'Savage Attacker', source: 'TST' }, instanceId: 'f1' }];
      d.play.activeEffects = [keenEdge];
    });
  const world = { extra: { feat: [savageAttacker] } };
  const reroll = /^Reroll the weapon's dice with Savage Attacker/;
  /** Opens a weapon's damage prompt from its chip, and rolls it. */
  const rollDamage = (weapon: string, type: string) => {
    fireEvent.click(screen.getByTitle(`${weapon} ${type} damage`));
    const group = prompt(`${weapon} ${type} damage`);
    expect(within(group).queryByRole('button', { name: /Savage Attacker/ })).toBeNull();
    press(group, 'Roll');
  };

  it("offers a reroll of the weapon's dice once the damage shows, and keeps the higher", async () => {
    const sheet = await renderSheet(savage(), world);
    render(<RollToast />);
    nextFaces(2, 3);
    rollDamage('Longsword', 'slashing');
    const first = rolls()[0];
    // The d8 rolled 2, with STR +3, and Keen Edge's d4 rolled in.
    expect(dice(first)).toEqual(['d8 [2]', 'd4 [3]']);
    expect(first?.total).toBe(8);
    expect(button(reroll).textContent).toBe('Reroll weapon dice, Savage Attacker· once a turn');

    nextFaces(7);
    fireEvent.click(button(reroll));
    const dealt = rolls()[0];
    expect(rolls()).toHaveLength(1);
    expect(dealt?.id).toBe(first?.id);
    expect(dice(dealt)).toEqual(['d8 [7]', 'd4 [3]']);
    expect(mods(dealt)).toEqual([3]);
    expect(dealt?.total).toBe(13);
    expect(dealt?.meta?.from).toEqual(first?.meta?.from);
    expect(dealt?.meta?.cue).toBe('Savage Attacker: rolled 5, then 10, kept 10');
    expect(screen.getByText('Savage Attacker: rolled 5, then 10, kept 10')).toBeTruthy();
    noButton(reroll);
    expect((await sheet.saved()).play.turn?.once).toEqual(['feat:savage attacker']);

    // Once a turn: the next damage offers no reroll.
    nextFaces(4, 1);
    rollDamage('Longsword', 'slashing');
    noButton(reroll);
  });

  it('keeps the first roll when the reroll is lower, and says so', async () => {
    await renderSheet(savage(), world);
    render(<RollToast />);
    nextFaces(7, 3);
    rollDamage('Longsword', 'slashing');
    const first = rolls()[0];
    nextFaces(2);
    fireEvent.click(button(reroll));
    const dealt = rolls()[0];
    expect(rolls()).toHaveLength(1);
    expect(dice(dealt)).toEqual(['d8 [7]', 'd4 [3]']);
    expect(dealt?.total).toBe(first?.total);
    expect(dealt?.meta?.cue).toBe('Savage Attacker: rolled 10, then 5, kept 10');
  });

  it('offers the reroll on damage tapped while the attack waited, shown under the attack', async () => {
    await renderSheet(savage(), world);
    render(<RollToast />);
    // The attack waits; its damage, tapped meanwhile, rolls with it on a hit.
    fireEvent.click(attack('Longsword'));
    fireEvent.click(screen.getByTitle('Longsword slashing damage'));
    nextFaces(15, 2, 3);
    press(prompt('Longsword attack'), 'Roll');
    const [first, struck] = rolls();
    expect(first?.meta?.withRoll).toBe(struck?.id);
    expect(first?.total).toBe(8);

    nextFaces(7);
    fireEvent.click(button(reroll));
    const [dealt] = rolls();
    expect(rolls()).toHaveLength(2);
    expect(dealt?.id).toBe(first?.id);
    expect(dealt?.meta?.withRoll).toBe(struck?.id);
    expect(dealt?.total).toBe(13);
    expect(screen.getByText('Savage Attacker: rolled 5, then 10, kept 10')).toBeTruthy();
    noButton(reroll);
  });

  it("offers none on a ranged weapon's damage", async () => {
    await renderSheet(savage(), world);
    render(<RollToast />);
    nextFaces(4, 2);
    rollDamage('Shortbow', 'piercing');
    expect(rolls()[0]?.label).toBe('Shortbow piercing damage');
    noButton(reroll);
  });
});

describe('a spell that puts its dice on every weapon hit as it is cast', () => {
  const favor = (concentration: boolean): DataEntity => ({
    name: 'Divine Favor',
    source: 'TST',
    level: 1,
    school: 'V',
    time: [{ number: 1, unit: 'bonus' }],
    range: { type: 'point', distance: { type: 'self' } },
    duration: [
      {
        type: 'timed',
        duration: { type: 'minute', amount: 1 },
        ...(concentration ? { concentration: true } : {}),
      },
    ],
    entries: [
      'Until the spell ends, your attacks with weapons deal an extra {@damage 1d4} Radiant damage on a hit.',
    ],
  });
  /** Casts Divine Favor from its row's dice chip, on the slot the prompt starts on. */
  const castFavor = () => {
    nextFaces(2);
    fireEvent.click(screen.getByTitle('Divine Favor Radiant damage'));
    castHeld();
  };

  it('starts an effect named for it, whose die rides on a weapon’s damage and not a punch', async () => {
    const sheet = await renderSheet(caster(['Divine Favor']), {
      extra: { spell: [favor(false)] },
    });
    render(<RollToast />);
    castFavor();
    const saved = await sheet.saved();
    expect(left('Level 1 slot')).toBe(3);
    expect(saved.play.concentratingOn).toBeUndefined();
    expect(saved.play.activeEffects).toEqual([
      expect.objectContaining({
        name: 'Divine Favor',
        parts: [
          {
            kind: 'damageDie',
            scope: 'all',
            dice: '1d4',
            damageType: 'radiant',
            weaponsOnly: true,
          },
        ],
        lasts: { minutes: 1 },
      }),
    ]);

    nextFaces();
    fireEvent.click(screen.getByTitle('Longsword slashing damage'));
    const group = prompt('Longsword slashing damage');
    const rider = within(group).getByRole('button', {
      name: /^\+d4 radiant Divine Favor, rolls in/,
    });
    expect(pressed(rider)).toBe(true);
    nextFaces(5, 4);
    press(group, 'Roll');
    const [radiant, slashing] = rolls();
    expect(radiant?.label).toBe('Longsword radiant damage');
    expect(radiant?.meta?.withRoll).toBe(slashing?.id);
    expect(dice(radiant)).toEqual(['d4 [4]']);

    // An unarmed strike is no weapon's hit.
    fireEvent.click(screen.getByTitle(/^Unarmed Strike (\w+ )?damage$/));
    const punch = screen.getByRole('group', { name: /^Unarmed Strike .*choose and roll$/ });
    expect(punch.textContent).not.toContain('Divine Favor');
  });

  it('starts no effect when the spell needs concentration', async () => {
    const sheet = await renderSheet(caster(['Divine Favor']), { extra: { spell: [favor(true)] } });
    render(<RollToast />);
    castFavor();
    const saved = await sheet.saved();
    expect(saved.play.concentratingOn).toEqual({ label: 'Divine Favor', level: 1 });
    expect(saved.play.activeEffects).toBeUndefined();
  });
});

describe('one spell slot a turn, under the 2024 rules', () => {
  const wardFlash: DataEntity = {
    name: 'Ward Flash',
    source: 'TST',
    level: 1,
    school: 'A',
    time: [{ number: 1, unit: 'reaction', condition: 'which you take when you are hit' }],
    entries: ['A flash of light turns the blow.'],
  };
  const searingStrike: DataEntity = {
    name: 'Searing Strike',
    source: 'TST',
    level: 1,
    school: 'V',
    time: [
      {
        number: 1,
        unit: 'bonus',
        condition:
          'which you take immediately after hitting a target with a Melee weapon or an Unarmed Strike',
      },
    ],
    range: { type: 'point', distance: { type: 'self' } },
    entries: [
      'As you hit the target, it takes an extra {@damage 1d6} fire damage from the attack.',
    ],
  };
  const world = { extra: { spell: [wardFlash, searingStrike] } };
  const SPELLS = ['Searing Bolt', 'Quick Bolt', 'Guidance', 'Ward Flash', 'Searing Strike'];
  const of2024 = (d: CharacterDoc) => {
    d.rulesVersion = '2024';
  };
  /** Casts a spell with dice from its row's chip, on the slot the prompt starts on. */
  const castBolt = (title: string) => {
    nextFaces(3, 4);
    fireEvent.click(screen.getByTitle(title));
    castHeld();
  };

  it('marks the first and says the second', async () => {
    const sheet = await renderSheet(caster(SPELLS, of2024), world);
    render(<RollToast />);
    castBolt('Searing Bolt fire damage');
    let saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ action: true, slotSpell: true });
    expect(notice()).toBeUndefined();

    castBolt('Quick Bolt fire damage');
    saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ bonus: true, slotSpell: true });
    expect(notice()).toBe(
      'A second spell slot this turn: Quick Bolt expended a spell slot, and one was expended on a spell this turn already. The 2024 rules allow one a turn.',
    );
    expect(left('Level 1 slot')).toBe(2);
  });

  it('marks nothing for a cantrip or a reaction', async () => {
    const sheet = await renderSheet(caster(SPELLS, of2024), world);
    render(<RollToast />);
    fireEvent.click(button('Cast Guidance'));
    fireEvent.click(button('Cast Ward Flash'));
    castHeld();
    const saved = await sheet.saved();
    expect(saved.play.turn?.reaction).toBe(true);
    expect(saved.play.turn?.slotSpell).toBeUndefined();
    expect(left('Level 1 slot')).toBe(3);
  });

  it('marks nothing under the 2014 rules', async () => {
    const sheet = await renderSheet(caster(SPELLS), world);
    render(<RollToast />);
    castBolt('Searing Bolt fire damage');
    castBolt('Quick Bolt fire damage');
    const saved = await sheet.saved();
    expect(saved.play.turn?.slotSpell).toBeUndefined();
    expect(notice()).toBeUndefined();
  });

  it('warns on a smite offered after a slot was expended this turn', async () => {
    await renderSheet(caster(SPELLS, of2024), world);
    render(<RollToast />);
    const smite = () => {
      fireEvent.click(screen.getByTitle('Longsword slashing damage'));
      const group = prompt('Longsword slashing damage');
      const chip = within(group).getByRole('button', { name: /^Searing Strike, spell/ });
      press(group, 'Cancel this roll');
      return chip.getAttribute('aria-label') ?? '';
    };
    nextFaces();
    expect(smite()).toBe('Searing Strike, spell');
    castBolt('Searing Bolt fire damage');
    nextFaces();
    expect(smite()).toBe(
      'Searing Strike, spell: A spell slot was expended on a spell this turn already',
    );
  });
});
