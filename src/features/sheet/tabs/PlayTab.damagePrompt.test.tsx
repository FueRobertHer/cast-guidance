// @vitest-environment jsdom
// The damage prompt through the real sheet and the roll toast: a weapon's
// damage chip asks before it rolls, with the weapon's riders on, and Roll
// rolls it; what the player puts on the weapon rolls apart by its type, for
// the next hit or for every hit; Extra Attack counts the Attack action's
// attacks and offers the next one; and a once-a-turn add (Sneak Attack) is
// marked as it lands, and said used in the next prompt.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollDetail, RollResult } from '@/dice/types';
import type { CharacterDoc, DataEntity } from '@/engine/types';
import { heldRollStore } from '@/stores/heldRoll';
import { rollLogStore } from '@/stores/rollLog';
import { RollToast } from '@/ui/RollToast';
import {
  classEntry,
  HARNESS_TIMEOUT,
  renderSheet,
  resetSheetHarness,
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

/** A warrior with STR 16 (+3) and a longsword in hand, level 3 unless said. */
function fighter(more: (doc: CharacterDoc) => void = () => {}, level = 3) {
  const doc = testCharacter('Grog', [classEntry('Warrior', level)], { str: 16, con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.equipment = [
    {
      id: 'e1',
      ref: { name: 'Longsword', source: 'TST' },
      qty: 1,
      equipped: true,
      attuned: false,
    },
  ];
  more(doc);
  return doc;
}

/** A magic sword whose fire rides on every hit. */
const ember: DataEntity = {
  name: 'Ember Sword',
  source: 'TST',
  type: 'M',
  weaponCategory: 'martial',
  weapon: true,
  dmg1: '1d8',
  dmgType: 'S',
  extraDamage: { dmg: '1d6', dmgType: 'F' },
};

const attack = (weapon: string) => screen.getByTitle(`${weapon} attack`);
const damage = (weapon: string) => screen.getByTitle(`${weapon} slashing damage`);
/** Opens a d20 test's roll prompt, and taps the control again to roll it. */
const rollOn = (el: HTMLElement) => {
  fireEvent.click(el);
  fireEvent.click(el);
};
/** The damage prompt open for `label`. */
const prompt = (label: string) => screen.getByRole('group', { name: `${label}, choose and roll` });
const promptOpen = () => screen.queryByRole('group', { name: /, choose and roll$/ }) !== null;
/** Presses a button inside `el` by its name. */
const press = (el: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(el).getByRole('button', { name }));
/** One extra's toggle in the damage prompt, by the start of its name. */
const extra = (el: HTMLElement, name: RegExp) => within(el).getByRole('button', { name });
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';

describe('a weapon damage chip', () => {
  it('opens the damage prompt with the riders on, and rolls nothing until Roll', async () => {
    const doc = fighter((d) => {
      d.equipment = [
        {
          id: 'e3',
          ref: { name: 'Ember Sword', source: 'TST' },
          qty: 1,
          equipped: true,
          attuned: false,
        },
      ];
    });
    await renderSheet(doc, { extra: { baseitem: [ember] } });
    render(<RollToast />);
    nextFaces(); // asking rolls nothing
    fireEvent.click(damage('Ember Sword'));
    expect(rolls()).toHaveLength(0);
    const group = prompt('Ember Sword slashing damage');
    // The fire is the weapon's own: on to start, and it rolls apart by its type.
    const fire = extra(group, /^\+d6 fire Ember Sword, rolls in/);
    expect(pressed(fire)).toBe(true);
    expect(group.textContent).toContain('1d8+3 slashing');
    expect(group.textContent).toContain('Then d6 fire Ember Sword');

    nextFaces(5, 4);
    press(group, 'Roll');
    expect(promptOpen()).toBe(false);
    const [flame, slashing] = rolls();
    expect(slashing?.label).toBe('Ember Sword slashing damage');
    expect(slashing?.total).toBe(8);
    expect(flame?.label).toBe('Ember Sword fire damage');
    expect(flame?.meta?.withRoll).toBe(slashing?.id);
    expect(dice(flame)).toEqual(['d6 [4]']);
    // The toast shows them together, added up before the target resists each type.
    expect(screen.getByText('Total before resistances').parentElement?.textContent).toContain('12');
  });
});

describe('what the player puts on a weapon', () => {
  /** Opens Longsword's damage prompt and adds Basic Poison (1d4 poison) for `lasts`. */
  const coat = (lasts: 'Next hit' | 'Every hit') => {
    fireEvent.click(damage('Longsword'));
    const group = prompt('Longsword slashing damage');
    press(group, 'Add damage');
    const form = within(group).getByRole('group', { name: 'Add damage' });
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'Basic Poison' } });
    fireEvent.change(within(form).getByLabelText('Dice'), { target: { value: '1d4' } });
    fireEvent.change(within(form).getByLabelText('Damage type'), { target: { value: 'poison' } });
    press(form, lasts);
    press(form, 'Add');
    return group;
  };

  it('rolls apart by its type for the next hit, and is gone from the weapon after', async () => {
    const sheet = await renderSheet(fighter());
    render(<RollToast />);
    nextFaces();
    const group = coat('Next hit');
    expect(rolls()).toHaveLength(0);
    expect(pressed(extra(group, /^\+d4 poison Basic Poison, next hit/))).toBe(true);
    expect(group.textContent).toContain('Basic Poison comes off after this hit.');
    expect((await sheet.saved()).play.weaponExtras?.e1).toMatchObject([
      { source: 'Basic Poison', dice: '1d4', damageType: 'poison', once: true },
    ]);

    nextFaces(6, 3);
    press(group, 'Roll');
    const [poison, slashing] = rolls();
    expect(slashing?.total).toBe(9);
    expect(poison?.label).toBe('Basic Poison poison damage');
    expect(poison?.meta?.withRoll).toBe(slashing?.id);
    expect(poison?.total).toBe(3);
    expect(screen.getByText('Total before resistances').parentElement?.textContent).toContain('12');
    const saved = await sheet.saved();
    expect(saved.play.weaponExtras).toBeUndefined();
    const history = await sheet.history();
    expect(history).toContain('Put Basic Poison on Longsword');
    expect(history[0]).toBe('Used Basic Poison');

    // The next prompt offers it no more.
    fireEvent.click(damage('Longsword'));
    expect(prompt('Longsword slashing damage').textContent).not.toContain('Basic Poison');
  });

  it('stays on the weapon for every hit, and is offered again on the next', async () => {
    const sheet = await renderSheet(fighter());
    render(<RollToast />);
    nextFaces();
    const group = coat('Every hit');
    expect(pressed(extra(group, /^\+d4 poison Basic Poison, every hit/))).toBe(true);
    nextFaces(6, 3);
    press(group, 'Roll');
    expect(rolls().map((r) => r.label)).toEqual([
      'Basic Poison poison damage',
      'Longsword slashing damage',
    ]);
    expect((await sheet.saved()).play.weaponExtras?.e1).toMatchObject([
      { source: 'Basic Poison', dice: '1d4', damageType: 'poison' },
    ]);

    nextFaces();
    fireEvent.click(damage('Longsword'));
    const again = prompt('Longsword slashing damage');
    expect(pressed(extra(again, /^\+d4 poison Basic Poison, every hit/))).toBe(true);
    // Taken off, it is gone from the weapon for good.
    press(again, 'Take Basic Poison off');
    expect(within(again).queryByRole('button', { name: /Basic Poison, every hit/ })).toBeNull();
    expect((await sheet.saved()).play.weaponExtras).toBeUndefined();
  });
});

describe('Extra Attack', () => {
  /** A level-5 warrior, whose class gives Extra Attack. */
  const veteran = () => fighter(undefined, 5);
  const nextAttack = () => screen.getByRole('button', { name: /^Next attack/ });

  it('takes the action with the first attack, counts the second, and offers it after a miss', async () => {
    const sheet = await renderSheet(veteran());
    render(<RollToast />);
    nextFaces(1);
    rollOn(attack('Longsword'));
    let saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ action: true, attacks: 1 });
    expect((await sheet.history())[0]).toBe('Attacked with Longsword');
    // A natural 1 has no damage to offer: the Attack action's next attack instead.
    expect(nextAttack().textContent).toContain('Attack 2 of 2');

    fireEvent.click(nextAttack());
    const group = screen.getByRole('group', { name: 'Longsword attack, choose and roll' });
    nextFaces(15);
    press(group, 'Roll');
    saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ action: true, attacks: 2 });
    expect((await sheet.history())[0]).toBe('Attacked with Longsword (2 of 2)');
    // The second attack is the last: its hit offers the damage, and nothing after.
    expect(screen.queryByRole('button', { name: /^Next attack/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 1d8+3' }));
    nextFaces(4);
    press(prompt('Longsword slashing damage'), 'Roll');
    expect(rolls()[0]?.label).toBe('Longsword slashing damage');
    expect(screen.queryByRole('button', { name: /^Next attack/ })).toBeNull();
  });

  it("offers the next attack once the first hit's damage lands", async () => {
    await renderSheet(veteran());
    render(<RollToast />);
    nextFaces(15);
    rollOn(attack('Longsword'));
    // A hit offers its damage first; the offer opens the damage prompt.
    expect(screen.queryByRole('button', { name: /^Next attack/ })).toBeNull();
    nextFaces();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 1d8+3' }));
    const group = prompt('Longsword slashing damage');
    expect(group.textContent).toContain('Longsword attack: 21');
    nextFaces(4);
    press(group, 'Roll');
    expect(rolls()[0]?.total).toBe(7);
    expect(nextAttack().textContent).toContain('Attack 2 of 2');
    fireEvent.click(nextAttack());
    expect(heldRollStore.getState().held?.ask?.label).toBe('Longsword attack');
  });

  it("makes a new attack when the attack chip is tapped while its hit's damage waits", async () => {
    await renderSheet(veteran());
    render(<RollToast />);
    nextFaces(15);
    rollOn(attack('Longsword'));
    nextFaces();
    fireEvent.click(screen.getByRole('button', { name: 'Roll 1d8+3' }));
    const group = prompt('Longsword slashing damage');
    // Opened from the hit's offer, no chip rolls it: Roll does.
    expect(group.textContent).toContain('Choose what to add, then Roll.');
    // The attack chip asks a new attack, and rolls none of the damage.
    fireEvent.click(attack('Longsword'));
    expect(heldRollStore.getState().held?.ask?.label).toBe('Longsword attack');
    expect(heldRollStore.getState().held?.hit).toBeNull();
    expect(rolls()[0]?.kind).not.toBe('damage');
  });

  it('offers no next attack without Extra Attack', async () => {
    const sheet = await renderSheet(fighter());
    render(<RollToast />);
    nextFaces(1);
    rollOn(attack('Longsword'));
    expect((await sheet.saved()).play.turn).toMatchObject({ action: true, attacks: 1 });
    expect(screen.queryByRole('button', { name: /^Next attack/ })).toBeNull();
  });
});

describe('a once-a-turn add', () => {
  const origin = { label: 'Test', uid: 'feat|test', type: 'feat' } as const;
  /** The feat whose text holds the action to once a turn, as Sneak Attack's does. */
  const sneaky: DataEntity = {
    name: 'Sneaky Strike',
    source: 'TST',
    entries: [
      'Once per turn, you can deal an extra {@damage 2d6} damage to one creature you hit with an attack.',
    ],
  };
  const striker = () =>
    fighter((d) => {
      d.feats = [{ ref: { name: 'Sneaky Strike', source: 'TST' }, instanceId: 'f1' }];
      d.customEffects = [
        { origin, kind: 'action', economy: 'none', label: 'Sneaky Strike', roll: '2d6' },
      ];
    });

  it('is offered off, marks the turn as it lands, and is said used in the next prompt', async () => {
    const sheet = await renderSheet(striker(), { extra: { feat: [sneaky] } });
    render(<RollToast />);
    nextFaces(15);
    rollOn(attack('Longsword'));
    nextFaces();
    fireEvent.click(damage('Longsword'));
    const group = prompt('Longsword slashing damage');
    const add = extra(group, /^\+2d6 Sneaky Strike, once a turn/);
    expect(pressed(add)).toBe(false);
    expect(add.getAttribute('aria-label')).not.toContain('used this turn');
    fireEvent.click(add);
    expect(pressed(extra(group, /^\+2d6 Sneaky Strike, once a turn/))).toBe(true);
    expect(group.textContent).toContain('Adds Sneaky Strike.');

    nextFaces(4, 2, 5);
    press(group, 'Roll');
    const [sneak, slashing] = rolls();
    expect(slashing?.total).toBe(7);
    expect(sneak?.label).toBe('Sneaky Strike');
    expect(sneak?.meta?.withRoll).toBe(slashing?.id);
    expect(dice(sneak)).toEqual(['d6 [2, 5]']);
    const once = (await sheet.saved()).play.turn?.once ?? [];
    expect(once).toHaveLength(1);
    expect(once[0]).toContain('Sneaky Strike');

    // Still the player's to add (the sheet cannot see whose turn it is), but said used.
    nextFaces();
    fireEvent.click(damage('Longsword'));
    const again = prompt('Longsword slashing damage');
    const used = extra(again, /^\+2d6 Sneaky Strike, once a turn, used this turn/);
    expect(pressed(used)).toBe(false);
    fireEvent.click(used);
    expect(again.textContent).toContain('Sneaky Strike was used this turn already.');
    press(again, 'Cancel this roll');

    // A new turn offers it fresh.
    fireEvent.click(screen.getByRole('button', { name: 'New turn' }));
    fireEvent.click(damage('Longsword'));
    expect(
      extra(prompt('Longsword slashing damage'), /^\+2d6 Sneaky Strike/).getAttribute('aria-label'),
    ).not.toContain('used this turn');
  });
});
