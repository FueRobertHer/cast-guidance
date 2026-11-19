// @vitest-environment jsdom
// Spells cast now for damage on later hits, and the opportunity attack,
// through the real sheet and the roll toast. A concentration spell whose dice
// ride on hits (Hex) casts from Cast and rolls nothing, its dice chip only
// rolling; a spell of ordinary dice casts from its chip as before. An
// opportunity attack, claimed in a melee weapon's attack prompt, takes the
// reaction alone, counts toward no Attack action, offers no next attack, and
// finds the once-a-turn extras of the other creature's turn fresh.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiceRollDetail, RollResult } from '@/dice/types';
import type { CharacterDoc, DataEntity } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import { RollToast } from '@/ui/RollToast';
import {
  classEntry,
  HARNESS_TIMEOUT,
  left,
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

/** Opens a d20 test's roll prompt, and taps the control again to roll it. */
const rollOn = (el: HTMLElement) => {
  fireEvent.click(el);
  fireEvent.click(el);
};
/** The prompt open for `label`: a d20 test's, or a damage roll's. */
const prompt = (label: string) => screen.getByRole('group', { name: `${label}, choose and roll` });
/** Presses a button inside `el` by its name. */
const press = (el: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(el).getByRole('button', { name }));
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const pressed = (el: HTMLElement) => el.getAttribute('aria-pressed') === 'true';
const nextAttack = () => screen.queryByRole('button', { name: /^Next attack/ });

const LONGSWORD = { name: 'Longsword', source: 'TST' };
const SHORTBOW = { name: 'Shortbow', source: 'TST' };
const GREATSWORD = { name: 'Greatsword', source: 'TST' };
const carried = (...refs: Array<{ name: string; source: string }>): CharacterDoc['equipment'] =>
  refs.map((ref, i) => ({
    id: `e${String(i + 1)}`,
    ref,
    qty: 1,
    equipped: true,
    attuned: false,
  }));

/** The harness's level-5 sorcerer (slots 4, 3, 2) knowing `spells`, with a longsword in hand. */
function caster(...spells: string[]) {
  const doc = sorcerer();
  const refs = spells.map((name) => ({ name, source: 'TST' }));
  doc.spellcasting = { 'sorcerer|tst': { known: refs, prepared: refs } };
  doc.equipment = carried(LONGSWORD);
  return doc;
}

/** A level-5 warrior (Extra Attack) with STR 16 (+3), a longsword and a shortbow, and what `more` sets. */
function veteran(more: (doc: CharacterDoc) => void = () => {}) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 5)], { str: 16, con: 14 });
  doc.play.currentHp = 20;
  doc.play.hpInitialized = true;
  doc.equipment = carried(LONGSWORD, SHORTBOW);
  more(doc);
  return doc;
}

const attack = (weapon: string) => screen.getByTitle(`${weapon} attack`);
const OPPORTUNITY = /^Opportunity attack, this roll/;
/**
 * Makes an opportunity attack with `weapon`: its prompt, the claim, and Roll
 * on the d20 `face`.
 */
const opportunity = (weapon: string, face: number) => {
  fireEvent.click(attack(weapon));
  const group = prompt(`${weapon} attack`);
  press(group, OPPORTUNITY);
  nextFaces(face);
  press(group, 'Roll');
};
/** Opens the damage prompt a hit's toast offers. */
const offeredDamage = (expr: string, label: string) => {
  nextFaces();
  fireEvent.click(button(`Roll ${expr}`));
  return prompt(label);
};

describe('a spell cast now for damage on later hits', () => {
  /** Hex's shape: a concentration spell whose dice ride on hits. */
  const witchMark: DataEntity = {
    name: 'Witch Mark',
    source: 'TST',
    level: 1,
    school: 'E',
    time: [{ number: 1, unit: 'bonus' }],
    range: { type: 'point', distance: { type: 'feet', amount: 90 } },
    duration: [{ type: 'timed', duration: { type: 'hour', amount: 1 }, concentration: true }],
    entries: [
      'Until the spell ends, you deal an extra {@damage 1d6} necrotic damage to the target whenever you hit it with an attack.',
    ],
  };
  /** Booming Blade's shape: instantaneous, its extra dice cast with its attack. */
  const thunderEdge: DataEntity = {
    name: 'Thunder Edge',
    source: 'TST',
    level: 0,
    school: 'V',
    time: [{ number: 1, unit: 'action' }],
    range: { type: 'point', distance: { type: 'self' } },
    duration: [{ type: 'instant' }],
    entries: [
      'You make a melee attack with a weapon as part of casting it, and the melee attack deals an extra {@damage 1d8} thunder damage to the target on a hit.',
    ],
  };
  const world = { extra: { spell: [witchMark, thunderEdge] } };

  it('casts from Cast with nothing rolled, and its dice chip then only rolls', async () => {
    const sheet = await renderSheet(caster('Witch Mark'), world);
    render(<RollToast />);
    nextFaces(); // casting rolls nothing
    fireEvent.click(button('Cast Witch Mark'));
    const group = screen.getByRole('group', { name: 'Cast Witch Mark, choose and cast' });
    expect(within(group).queryByRole('button', { name: 'Roll' })).toBeNull();
    press(group, 'Cast');
    expect(rolls()).toHaveLength(0);
    expect(left('Level 1 slot')).toBe(3);
    const saved = await sheet.saved();
    expect(saved.play.concentratingOn).toEqual({ label: 'Witch Mark', level: 1 });
    expect(saved.play.turn?.bonus).toBe(true);

    nextFaces(5);
    fireEvent.click(screen.getByTitle('Witch Mark necrotic damage'));
    expect(dice(rolls()[0])).toEqual(['d6 [5]']);
    expect(left('Level 1 slot')).toBe(3);
    expect((await sheet.saved()).play.concentratingOn).toEqual({ label: 'Witch Mark', level: 1 });
  });

  it('leaves a spell of ordinary dice cast and rolled from its chip', async () => {
    await renderSheet(caster('Searing Bolt'), world);
    render(<RollToast />);
    expect(screen.queryByRole('button', { name: 'Cast Searing Bolt' })).toBeNull();
    nextFaces();
    fireEvent.click(screen.getByTitle('Searing Bolt fire damage'));
    const group = screen.getByRole('group', { name: 'Cast Searing Bolt, choose and roll' });
    nextFaces(3, 4);
    press(group, 'Roll');
    expect(dice(rolls()[0])).toEqual(['d6 [3, 4]']);
    expect(left('Level 1 slot')).toBe(3);
  });

  it('leaves an instantaneous cantrip cast with its dice', async () => {
    const sheet = await renderSheet(caster('Thunder Edge'), world);
    render(<RollToast />);
    expect(screen.queryByRole('button', { name: 'Cast Thunder Edge' })).toBeNull();
    nextFaces(6);
    fireEvent.click(screen.getByTitle('Thunder Edge thunder damage'));
    expect(dice(rolls()[0])).toEqual(['d8 [6]']);
    expect((await sheet.saved()).play.turn?.action).toBe(true);
  });
});

describe('an opportunity attack', () => {
  it('takes the reaction alone, and offers no next attack', async () => {
    const sheet = await renderSheet(veteran());
    render(<RollToast />);
    nextFaces();
    // Not with a ranged weapon.
    fireEvent.click(attack('Shortbow'));
    const ranged = prompt('Shortbow attack');
    expect(within(ranged).queryByRole('button', { name: OPPORTUNITY })).toBeNull();
    press(ranged, 'Cancel this roll');

    fireEvent.click(attack('Longsword'));
    const group = prompt('Longsword attack');
    const claim = within(group).getByRole('button', { name: OPPORTUNITY });
    expect(claim.getAttribute('aria-label')).toBe(
      'Opportunity attack, this roll: Uses your reaction, not your action, and is no attack of your Attack action',
    );
    expect(pressed(claim)).toBe(false);
    fireEvent.click(claim);
    nextFaces(12);
    press(group, 'Roll');
    const swing = rolls()[0];
    expect(swing?.meta?.attack?.claimed).toEqual(['Opportunity attack']);
    expect(swing?.total).toBe(18);
    expect((await sheet.history())[0]).toBe('Opportunity attack with Longsword');
    const saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ action: false, reaction: true, offOnce: [] });
    expect(saved.play.turn?.attacks).toBeUndefined();
    // Its hit offers the damage, and no next attack, Extra Attack or not.
    expect(button('Roll 1d8+3')).toBeTruthy();
    expect(nextAttack()).toBeNull();
  });

  it('counts toward no Attack action, which goes on as it was', async () => {
    const sheet = await renderSheet(veteran());
    render(<RollToast />);
    nextFaces(1);
    rollOn(attack('Longsword'));
    expect(nextAttack()?.textContent).toContain('Attack 2 of 2');

    opportunity('Longsword', 1);
    expect((await sheet.history())[0]).toBe('Opportunity attack with Longsword');
    let saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ action: true, reaction: true, attacks: 1 });
    expect(nextAttack()).toBeNull();

    // Not claimed, the next attack is the Attack action's second.
    nextFaces(1);
    rollOn(attack('Longsword'));
    expect((await sheet.history())[0]).toBe('Attacked with Longsword (2 of 2)');
    saved = await sheet.saved();
    expect(saved.play.turn).toMatchObject({ action: true, reaction: true, attacks: 2 });
    expect(nextAttack()).toBeNull();
  });

  describe('once a turn, on the other creature’s turn', () => {
    const origin = { label: 'Test', uid: 'feat|test', type: 'feat' } as const;
    const sneaky: DataEntity = {
      name: 'Sneaky Strike',
      source: 'TST',
      entries: [
        'Once per turn, you can deal an extra {@damage 2d6} damage to one creature you hit with an attack.',
      ],
    };
    const striker = () =>
      veteran((d) => {
        d.feats = [{ ref: { name: 'Sneaky Strike', source: 'TST' }, instanceId: 'f1' }];
        d.customEffects = [
          { origin, kind: 'action', economy: 'none', label: 'Sneaky Strike', roll: '2d6' },
        ];
      });
    const sneak = /^\+2d6 Sneaky Strike, once a turn/;
    /** Puts Sneaky Strike on the damage prompt `group`, and rolls it. */
    const sneakIn = (group: HTMLElement, ...faces: number[]) => {
      fireEvent.click(within(group).getByRole('button', { name: sneak }));
      nextFaces(...faces);
      press(group, 'Roll');
    };

    it('offers an extra used on this turn fresh, and marks it on that turn apart', async () => {
      const sheet = await renderSheet(striker(), { extra: { feat: [sneaky] } });
      render(<RollToast />);
      // On the character's own turn: a hit, with Sneaky Strike on it.
      nextFaces(15);
      rollOn(attack('Longsword'));
      sneakIn(offeredDamage('1d8+3', 'Longsword slashing damage'), 4, 1, 2);
      const once = (await sheet.saved()).play.turn?.once ?? [];
      expect(once).toHaveLength(1);
      expect(once[0]).toContain('Sneaky Strike');

      opportunity('Longsword', 15);
      let group = offeredDamage('1d8+3', 'Longsword slashing damage');
      const fresh = within(group).getByRole('button', { name: sneak });
      expect(fresh.getAttribute('aria-label')).not.toContain('used this turn');
      expect(pressed(fresh)).toBe(false);
      sneakIn(group, 5, 3, 3);
      expect(rolls()[0]?.label).toBe('Sneaky Strike');
      let turn = (await sheet.saved()).play.turn;
      expect(turn?.offOnce).toEqual(once);
      expect(turn?.once).toEqual(once);

      // A second opportunity attack is on another turn again: afresh.
      opportunity('Longsword', 15);
      turn = (await sheet.saved()).play.turn;
      expect(turn?.offOnce).toEqual([]);
      group = offeredDamage('1d8+3', 'Longsword slashing damage');
      expect(
        within(group).getByRole('button', { name: sneak }).getAttribute('aria-label'),
      ).not.toContain('used this turn');
    });
  });

  describe('once a turn, rolled from its own row', () => {
    const origin = { label: 'Test', uid: 'feat|test', type: 'feat' } as const;
    const sneaky: DataEntity = {
      name: 'Sneaky Strike',
      source: 'TST',
      entries: [
        'Once per turn, you can deal an extra {@damage 2d6} damage to one creature you hit with an attack.',
      ],
    };
    const striker = () =>
      veteran((d) => {
        d.feats = [{ ref: { name: 'Sneaky Strike', source: 'TST' }, instanceId: 'f1' }];
        d.customEffects = [
          { origin, kind: 'action', economy: 'none', label: 'Sneaky Strike', roll: '2d6' },
        ];
      });

    it('marks it used for the turn, as the damage prompt does, and says so there', async () => {
      const sheet = await renderSheet(striker(), { extra: { feat: [sneaky] } });
      render(<RollToast />);
      // Its row's chip: no pool of its own to pay, but its once a turn is spent.
      nextFaces(4, 2);
      fireEvent.click(screen.getByRole('button', { name: '2d6' }));
      const once = (await sheet.saved()).play.turn?.once ?? [];
      expect(once).toHaveLength(1);
      expect(once[0]).toContain('Sneaky Strike');
      nextFaces();
      fireEvent.click(screen.getByTitle('Longsword slashing damage'));
      const group = screen.getByRole('group', {
        name: 'Longsword slashing damage, choose and roll',
      });
      expect(
        within(group)
          .getByRole('button', { name: /^\+2d6 Sneaky Strike, once a turn/ })
          .getAttribute('aria-label'),
      ).toContain('used this turn');
    });
  });

  it('starts 2024 Savage Attacker on again when it was used on this turn', async () => {
    const savage2024: DataEntity = {
      name: 'Savage Attacker',
      source: 'TST',
      entries: [
        "Once per turn when you hit a target with a weapon, you can roll the weapon's damage dice twice and use either roll against the target.",
      ],
    };
    const doc = veteran((d) => {
      d.feats = [{ ref: { name: 'Savage Attacker', source: 'TST' }, instanceId: 'f1' }];
      d.play.turn = {
        action: true,
        bonus: false,
        reaction: false,
        attacks: 1,
        once: ['feat:savage attacker'],
      };
    });
    const sheet = await renderSheet(doc, { extra: { feat: [savage2024] } });
    render(<RollToast />);
    // On this turn: used, and off.
    nextFaces();
    fireEvent.click(screen.getByTitle('Longsword slashing damage'));
    let group = prompt('Longsword slashing damage');
    const used = within(group).getByRole('button', { name: /^Savage Attacker, once a turn/ });
    expect(used.getAttribute('aria-label')).toContain('used this turn');
    expect(pressed(used)).toBe(false);
    press(group, 'Cancel this roll');

    opportunity('Longsword', 15);
    group = offeredDamage('1d8+3', 'Longsword slashing damage');
    const fresh = within(group).getByRole('button', { name: /^Savage Attacker, once a turn/ });
    expect(fresh.getAttribute('aria-label')).not.toContain('used this turn');
    expect(pressed(fresh)).toBe(true);
    nextFaces(2, 6);
    press(group, 'Roll');
    expect(rolls()[0]?.meta?.cue).toBe('Savage Attacker: rolled 5 and 9, kept 9');
    const turn = (await sheet.saved()).play.turn;
    expect(turn?.offOnce).toEqual(['feat:savage attacker']);
    expect(turn?.once).toEqual(['feat:savage attacker']);
  });

  it("offers 2014 Savage Attacker's reroll fresh after it was used on this turn", async () => {
    const savage2014: DataEntity = {
      name: 'Savage Attacker',
      source: 'TST',
      entries: [
        "Once per turn when you roll damage for a melee weapon attack, you can reroll the weapon's damage dice and use either total.",
      ],
    };
    const doc = veteran((d) => {
      d.feats = [{ ref: { name: 'Savage Attacker', source: 'TST' }, instanceId: 'f1' }];
      d.play.turn = {
        action: true,
        bonus: false,
        reaction: false,
        attacks: 1,
        once: ['feat:savage attacker'],
      };
    });
    const sheet = await renderSheet(doc, { extra: { feat: [savage2014] } });
    render(<RollToast />);
    const reroll = /^Reroll the weapon's dice with Savage Attacker/;
    opportunity('Longsword', 15);
    const group = offeredDamage('1d8+3', 'Longsword slashing damage');
    nextFaces(2);
    press(group, 'Roll');
    expect(button(reroll).textContent).toBe('Reroll weapon dice, Savage Attacker· once a turn');
    nextFaces(7);
    fireEvent.click(button(reroll));
    expect(rolls()[0]?.total).toBe(10);
    expect(rolls()[0]?.meta?.cue).toBe('Savage Attacker: rolled 5, then 10, kept 10');
    const turn = (await sheet.saved()).play.turn;
    expect(turn?.offOnce).toEqual(['feat:savage attacker']);
    expect(turn?.once).toEqual(['feat:savage attacker']);
  });

  it('says a smite cast on its hit needs a bonus action, which is the character’s own turn’s', async () => {
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
    await renderSheet(caster('Searing Strike'), { extra: { spell: [searingStrike] } });
    render(<RollToast />);
    opportunity('Longsword', 15);
    const group = offeredDamage('1d8', 'Longsword slashing damage');
    expect(
      within(group)
        .getByRole('button', { name: /^Searing Strike, spell/ })
        .getAttribute('aria-label'),
    ).toBe('Searing Strike, spell: It takes a bonus action, which is only yours on your own turn');
  });

  it("starts 2024 Great Weapon Master's bonus off, as no part of the Attack action", async () => {
    const greatsword: DataEntity = {
      name: 'Greatsword',
      source: 'TST',
      type: 'M',
      weaponCategory: 'martial',
      weapon: true,
      dmg1: '2d6',
      dmgType: 'S',
      property: ['H', '2H'],
    };
    const gwm2024: DataEntity = {
      name: 'Great Weapon Master',
      source: 'TST',
      entries: [
        'Heavy Weapon Mastery. When you hit a creature with a weapon that has the Heavy property as part of the Attack action on your turn, you can cause the weapon to deal extra damage to the target. The extra damage equals your Proficiency Bonus.',
      ],
    };
    const doc = veteran((d) => {
      d.equipment = carried(GREATSWORD);
      d.feats = [{ ref: { name: 'Great Weapon Master', source: 'TST' }, instanceId: 'f1' }];
    });
    await renderSheet(doc, { extra: { baseitem: [greatsword], feat: [gwm2024] } });
    render(<RollToast />);
    const bonus = /^\+3 Great Weapon Master, heavy weapon/;
    // In the Attack action, on.
    nextFaces(15);
    rollOn(attack('Greatsword'));
    let group = offeredDamage('2d6+3', 'Greatsword slashing damage');
    expect(pressed(within(group).getByRole('button', { name: bonus }))).toBe(true);
    press(group, 'Cancel this roll');

    opportunity('Greatsword', 15);
    group = offeredDamage('2d6+3', 'Greatsword slashing damage');
    const off = within(group).getByRole('button', { name: bonus });
    expect(pressed(off)).toBe(false);
    expect(off.getAttribute('aria-label')).toBe(
      '+3 Great Weapon Master, heavy weapon: Only as part of the Attack action on your turn',
    );
  });
});
