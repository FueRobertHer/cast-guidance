// @vitest-environment jsdom
// TEST-003: casting from the Play tab, read back off the next render. A cast
// is one `update` whose spend, turn and concentration have to agree with what
// the pips, the turn tracker and the concentration toggle then show, and with
// the history row it leaves.
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDoc, DataEntity } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import {
  castHeld,
  castNote,
  castTiles,
  classEntry,
  concentratingOn,
  grantedSpell,
  HARNESS_TIMEOUT,
  left,
  pips,
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

afterEach(resetSheetHarness);

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const pressed = (name: string) =>
  screen.getByRole('button', { name }).getAttribute('aria-pressed') === 'true';

/** A dice-free level 1 spell that concentrates, so it casts from its Cast button. */
const focusSpell = (name: string): DataEntity => ({
  name,
  source: 'TST',
  level: 1,
  school: 'E',
  time: [{ number: 1, unit: 'action' }],
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
  entries: ['You hold your focus.'],
});
const focusSpells = { spell: [focusSpell('Steady Gaze'), focusSpell('Warding Hum')] };
/** A cantrip cast as an Action, so casting it leaves a mark on the turn. */
const flick: DataEntity = {
  name: 'Spark Flick',
  source: 'TST',
  level: 0,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  entries: ['A harmless spark.'],
};
const ref = (name: string) => ({ name, source: 'TST' });
/** A concentration spell whose dice are rolled turn after turn, and scale with the slot. */
const shaft: DataEntity = {
  name: 'Moon Shaft',
  source: 'TST',
  level: 2,
  school: 'V',
  time: [{ number: 1, unit: 'action' }],
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
  entries: ['A beam deals {@damage 2d10} radiant damage.'],
  entriesHigherLevel: [
    { entries: ['The damage increases by {@scaledamage 2d10|2-9|1d10} per slot above 2nd.'] },
  ],
};

describe('casting from the Play tab (TEST-003)', () => {
  it('spends the lowest slot from the roll chip and lights one fewer pip', async () => {
    const sheet = await renderSheet(sorcerer());
    expect(left('Level 1 slot')).toBe(4);

    // The chip opens the roll prompt on the lowest slot, and spends nothing yet.
    press('2d6');
    expect(castNote()).toBe('Spends a 1st-level slot.');
    expect(left('Level 1 slot')).toBe(4);
    // Tapped again, as Roll is pressed, it casts.
    press('2d6');

    expect(pips('Level 1 slot')).toEqual(['available', 'available', 'available', 'spent']);
    expect(left('Level 2 slot')).toBe(3);
    expect(left('Level 3 slot')).toBe(2);
    expect(pressed('Action')).toBe(true);
    expect((await sheet.saved()).play.slotsSpent.slice(0, 3)).toEqual([1, 0, 0]);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt');
  });

  it('spends the upcast slot the player chose, at the dice it scales to', async () => {
    const sheet = await renderSheet(sorcerer());
    press('2d6');
    expect(castTiles()).toContain('Level 3 slot, 2 left');
    castHeld('Level 3 slot');

    // The dice are the pick's.
    expect(rollLogStore.getState().rolls.map((r) => r.expr)).toEqual(['4d6']);
    expect(left('Level 3 slot')).toBe(1);
    expect(left('Level 1 slot')).toBe(4);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L3)');
    // A pick is for one cast: the next starts on the lowest slot again rather
    // than quietly upcasting.
    fireEvent.click(screen.getByTitle('Searing Bolt fire damage'));
    expect(castNote()).toBe('Spends a 1st-level slot.');
  });

  it('converts sorcery points instead of a slot when that is the pick', async () => {
    const sheet = await renderSheet(sorcerer());
    press('2d6');
    castHeld('Level 1 slot from Sorcery Points');

    expect(left('Level 1 slot')).toBe(4);
    expect(pips('Sorcery Points use')).toEqual([
      'available',
      'available',
      'available',
      'spent',
      'spent',
    ]);
    // Converting takes the Bonus Action on top of the spell's own Action.
    expect(pressed('Action')).toBe(true);
    expect(pressed('Bonus action')).toBe(true);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L1 from 2 Sorcery Points)');
  });

  it('spends a pact slot before a leveled one, at the pact slot level', async () => {
    // A level of sorcerer adds two level 1 slots, so the cast has both to pick from.
    const doc = testCharacter('Hex', [classEntry('Pactcaster', 3), classEntry('Sorcerer', 1)], {
      cha: 16,
    });
    doc.spellcasting = { 'pactcaster|tst': { known: [ref('Searing Bolt')], prepared: [] } };
    const sheet = await renderSheet(doc);
    expect(pips('Pact slot')).toEqual(['available', 'available']);
    expect(left('Level 1 slot')).toBe(2);

    // Pact slots are level 2 at Pactcaster 3, so the bolt is cast upcast, and
    // the chip shows the dice of the pact slot the prompt starts on.
    press('3d6');
    expect(castNote()).toBe('Spends a pact slot (2nd level).');
    expect(castTiles()).toEqual(['Level 1 slot, 2 left', 'Pact slot · level 2, 2 left']);
    press('3d6');

    expect(pips('Pact slot')).toEqual(['available', 'spent']);
    expect(left('Level 1 slot')).toBe(2);
    const saved = await sheet.saved();
    expect(saved.play.pactSlotsSpent).toBe(1);
    expect(saved.play.slotsSpent.every((n) => n === 0)).toBe(true);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (pact slot)');
  });

  it('casts a cantrip without touching a slot', async () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Spark Flick'));
    const sheet = await renderSheet(doc, { extra: { spell: [flick] } });

    press('Cast Spark Flick');

    expect(pressed('Action')).toBe(true);
    expect(left('Level 1 slot')).toBe(4);
    expect(left('Sorcery Points use')).toBe(5);
    expect((await sheet.history())[0]).toBe('Cast Spark Flick');
    expect((await sheet.saved()).play.slotsSpent.every((n) => n === 0)).toBe(true);
  });

  it('rolls a running concentration spell at its cast slot, spending nothing more', async () => {
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Moon Shaft')], prepared: [] } };
    await renderSheet(doc, { extra: { spell: [shaft] } });
    press('2d10');
    castHeld('Level 3 slot');
    expect(left('Level 3 slot')).toBe(1);
    expect(concentratingOn()).toBe('Moon Shaft');

    // Its next turn: the same dice, and every slot where it was. The chip is
    // still showing its total, so it is found by what it rolls.
    fireEvent.click(screen.getByTitle('Moon Shaft radiant damage'));
    expect(rollLogStore.getState().rolls.map((r) => r.expr)).toEqual(['3d10', '3d10']);
    expect(left('Level 3 slot')).toBe(1);
    expect(left('Level 2 slot')).toBe(3);
    // Nothing waits to be cast: the running spell's roll landed at once.
    expect(castTiles()).toEqual([]);
  });

  it('replaces one concentration spell with the next', async () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Steady Gaze'), ref('Warding Hum'));
    const sheet = await renderSheet(doc, { extra: focusSpells });
    expect(concentratingOn()).toBeUndefined();

    press('Cast Steady Gaze');
    castHeld();
    expect(concentratingOn()).toBe('Steady Gaze');
    press('New turn');
    press('Cast Warding Hum');
    castHeld();

    expect(concentratingOn()).toBe('Warding Hum');
    expect(left('Level 1 slot')).toBe(2);
    expect((await sheet.saved()).play.concentratingOn).toEqual({
      label: 'Warding Hum',
      level: 1,
    });
  });
});

describe('a condition on casting from the Play tab', () => {
  const wearing = (control: Element) => control.querySelector('.cx')?.className ?? '';
  /** Knows a spell that casts from its chip, and one that casts from its button. */
  const caster = (conditions: CharacterDoc['play']['conditions']) => {
    const doc = sorcerer();
    doc.spellcasting = {
      'sorcerer|tst': {
        known: [ref('Searing Bolt'), ref('Daze Mote'), ref('Moon Shaft')],
        prepared: [],
      },
    };
    doc.play.conditions = conditions;
    return doc;
  };

  it('wears what stops casting on Cast and the chip that casts', async () => {
    await renderSheet(caster([{ id: 'Paralyzed' }]), { extra: { spell: [shaft] } });
    expect(wearing(screen.getByRole('button', { name: 'Cast Daze Mote' }))).toContain(
      'cx-paralyzed',
    );
    expect(wearing(screen.getByTitle('Searing Bolt fire damage'))).toContain('cx-paralyzed');
  });

  it('leaves them plain under a condition that only touches attacks', async () => {
    await renderSheet(caster([{ id: 'Poisoned' }]), { extra: { spell: [shaft] } });
    expect(wearing(screen.getByRole('button', { name: 'Cast Daze Mote' }))).not.toContain('cx-on');
    expect(wearing(screen.getByTitle('Searing Bolt fire damage'))).not.toContain('cx-on');
  });

  it('fades off a chip whose own roll starts its concentration, as it stops casting', async () => {
    await renderSheet(caster([{ id: 'Paralyzed' }]), { extra: { spell: [shaft] } });
    const chip = screen.getByTitle('Moon Shaft radiant damage');
    expect(wearing(chip)).toContain('cx-paralyzed');

    fireEvent.click(chip);
    castHeld();

    expect(wearing(screen.getByTitle('Moon Shaft radiant damage'))).toContain('cx-rm');
  });
});

describe('casting with nothing left (TEST-003)', () => {
  it('keeps Cast on offer once every slot is spent, and says it spends nothing', async () => {
    const doc = testCharacter('Quill', [classEntry('Mage', 1)], { int: 14 });
    doc.spellcasting = {
      'mage|tst': { known: [ref('Steady Gaze')], prepared: [ref('Steady Gaze')] },
    };
    const sheet = await renderSheet(doc, { extra: focusSpells });
    press('Level 1 slot 2');
    expect(pips('Level 1 slot')).toEqual(['spent', 'spent']);

    press('Cast Steady Gaze');
    // The spent slot stays on show, and Roll says the cast spends nothing.
    expect(castTiles()).toEqual(['Level 1 slot, 0 left, cannot pay now']);
    expect(castNote()).toBe('Nothing left to spend: it marks only your turn.');
    castHeld();

    expect(concentratingOn()).toBe('Steady Gaze');
    expect(pressed('Action')).toBe(true);
    expect(pips('Level 1 slot')).toEqual(['spent', 'spent']);
    expect((await sheet.history())[0]).toBe('Cast Steady Gaze (no slot)');
  });

  it('falls back to a point conversion, said by Roll, when the slots are gone', async () => {
    const sheet = await renderSheet(sorcerer());
    press('Level 1 slot 4');
    press('Level 2 slot 3');
    press('Level 3 slot 2');

    // The prompt says so, or the chip would empty the pool unannounced.
    press('2d6');
    expect(castNote()).toBe('Spends 2 Sorcery Points and a Bonus Action to convert.');
    press('2d6');

    expect(left('Sorcery Points use')).toBe(3);
    expect((await sheet.history())[0]).toBe('Cast Searing Bolt (L1 from 2 Sorcery Points)');
  });
});

describe("casting from an item's charges", () => {
  /** Heals 1d8, a die more a slot level: the canvas's example with the staff. */
  const cure: DataEntity = {
    name: 'Cure Wounds',
    source: 'TST',
    level: 1,
    school: 'A',
    time: [{ number: 1, unit: 'action' }],
    entries: ['A creature you touch regains {@dice 1d8} hit points.'],
    entriesHigherLevel: [
      { entries: ['The healing increases by {@scaledice 1d8|1-9|1d8} per slot above 1st.'] },
    ],
  };
  const staff: DataEntity = {
    name: 'Staff of Healing',
    source: 'XDMG',
    type: 'ST|XDMG',
    rarity: 'rare',
    reqAttune: 'by a Bard, Cleric, or Druid',
    entries: ['This staff has 10 charges.'],
  };
  const healer = (attuned: boolean) => {
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [ref('Cure Wounds')], prepared: [] } };
    doc.equipment = [
      {
        id: 's1',
        ref: { name: 'Staff of Healing', source: 'XDMG' },
        qty: 1,
        equipped: true,
        attuned,
      },
    ];
    return doc;
  };
  const world = { extra: { spell: [cure], item: [staff] } };
  /** The spell rows of the card titled `title` whose text has `has`. */
  const rowsIn = (title: string, has: string) =>
    [
      ...(screen
        .getByText(title)
        .closest('section')
        ?.querySelectorAll<HTMLElement>('.min-h-10, .min-h-11') ?? []),
    ].filter((r) => r.textContent?.includes(has));
  const press1d8 = (row: HTMLElement | undefined) => {
    if (row === undefined) throw new Error('no row');
    fireEvent.click(within(row).getByRole('button', { name: '1d8' }));
  };

  it('offers the staff beside the slots, and spends its charges at the level picked', async () => {
    const sheet = await renderSheet(healer(true), world);
    expect(left('Staff of Healing charges use')).toBe(10);

    press1d8(rowsIn('Sorcerer spellcasting', 'Cure Wounds')[0]);
    expect(castTiles()).toEqual([
      'Level 1 slot, 4 left',
      'Level 2 slot, 3 left',
      'Level 3 slot, 2 left',
      'Level 1 slot from Sorcery Points, 2 points',
      'Level 2 slot from Sorcery Points, 3 points',
      'Level 3 slot from Sorcery Points, 5 points',
      'Level 4 slot from Sorcery Points, 6 points, cannot pay now',
      'Level 5 slot from Sorcery Points, 7 points, cannot pay now',
      'Level 1 from Staff of Healing, 1 charge',
      'Level 2 from Staff of Healing, 2 charges',
      'Level 3 from Staff of Healing, 3 charges',
      'Level 4 from Staff of Healing, 4 charges',
    ]);
    castHeld('Level 3 from Staff of Healing');

    expect(rollLogStore.getState().rolls.map((r) => [r.expr, r.kind])).toEqual([['3d8', 'heal']]);
    expect(left('Staff of Healing charges use')).toBe(7);
    expect(left('Level 1 slot')).toBe(4);
    expect(pressed('Action')).toBe(true);
    expect((await sheet.history())[0]).toBe(
      'Cast Cure Wounds (L3 from 3 Staff of Healing charges)',
    );
  });

  it('offers no charges until the staff is attuned', async () => {
    await renderSheet(healer(false), world);
    expect(screen.queryByRole('button', { name: /^Staff of Healing charges use/ })).toBeNull();
    press('1d8');
    expect(castTiles().some((t) => t.includes('Staff of Healing'))).toBe(false);
  });

  it("grants the staff's spells a row each, cast from its charges alone", async () => {
    // Its built-in row's spells (O2b), found by name in the character's rules version.
    const doc = healer(true);
    doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
    await renderSheet(doc, world);
    const own = rowsIn('Innate & granted spells', 'Staff of Healing');
    expect(own.map((r) => r.querySelector('button')?.textContent)).toEqual([
      'cure wounds10/10 charges',
      'lesser restoration10/10 charges',
      'mass cure wounds10/10 charges',
    ]);
    press1d8(own[0]);
    expect(castTiles()).toEqual([
      'Level 1 from Staff of Healing, 1 charge',
      'Level 2 from Staff of Healing, 2 charges',
      'Level 3 from Staff of Healing, 3 charges',
      'Level 4 from Staff of Healing, 4 charges',
    ]);
  });

  it("offers the staff on a grant's row with a use of its own, beside that use", async () => {
    /** Grants Cure Wounds once a day, which the staff's charges cast too. */
    const healersSpark: DataEntity = {
      name: "Healer's Spark",
      source: 'TST',
      additionalSpells: [
        { ability: 'wis', innate: { _: { daily: { '1': ['cure wounds|tst'] } } } },
      ],
      entries: ['You carry a healing spark.'],
    };
    const doc = healer(true);
    doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
    doc.feats = [{ ref: { name: "Healer's Spark", source: 'TST' }, instanceId: 'f1' }];
    await renderSheet(doc, { extra: { ...world.extra, feat: [healersSpark] } });

    // Its own use's row (cast with Wisdom), beside the staff's row of the same spell.
    press1d8(rowsIn('Innate & granted spells', 'WIS')[0]);
    expect(castTiles().some((t) => t.startsWith("Healer's Spark"))).toBe(true);
    expect(castTiles().filter((t) => t.includes('Staff of Healing'))).toEqual([
      'Level 1 from Staff of Healing, 1 charge',
      'Level 2 from Staff of Healing, 2 charges',
      'Level 3 from Staff of Healing, 3 charges',
      'Level 4 from Staff of Healing, 4 charges',
    ]);
  });
});

describe('what an item casts as its text says (O2b)', () => {
  /** Force darts, a die more a slot level. */
  const missile: DataEntity = {
    name: 'Magic Missile',
    source: 'TST',
    level: 1,
    school: 'V',
    time: [{ number: 1, unit: 'action' }],
    entries: ['Each dart deals {@damage 1d4} force damage.'],
    entriesHigherLevel: [{ entries: ['One more {@scaledice 1d4|1-9|1d4} a slot above 1st.'] }],
  };
  /** A Wisdom save. */
  const thoughts: DataEntity = {
    name: 'Detect Thoughts',
    source: 'TST',
    level: 2,
    school: 'D',
    time: [{ number: 1, unit: 'action' }],
    savingThrow: ['wisdom'],
    entries: ['You read a mind.'],
  };
  const worn = (name: string, source: string) => {
    const doc = sorcerer();
    doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
    doc.equipment = [{ id: 'r1', ref: { name, source }, qty: 1, equipped: true, attuned: true }];
    return doc;
  };
  const rowOf = (has: string) => {
    const row = [
      ...(screen
        .getByText('Innate & granted spells')
        .closest('section')
        ?.querySelectorAll<HTMLElement>('.min-h-11') ?? []),
    ].find((r) => r.textContent?.includes(has));
    if (row === undefined) throw new Error(`no row with ${has}`);
    return row;
  };

  it("casts a Robe of Stars' Magic Missile at 5th for one charge, as the dice say", async () => {
    const robe: DataEntity = {
      name: 'Robe of Stars',
      source: 'DMG',
      type: 'OTH',
      rarity: 'very rare',
      reqAttune: true,
    };
    const sheet = await renderSheet(worn('Robe of Stars', 'DMG'), {
      extra: { spell: [missile], item: [robe] },
    });
    expect(left('Robe of Stars charges use')).toBe(6);

    // Its dice are the level it casts at, not the spell's own.
    fireEvent.click(within(rowOf('Robe of Stars')).getByRole('button', { name: '5d4' }));
    expect(castTiles()).toEqual(['Level 5 from Robe of Stars, 1 charge']);
    castHeld('Level 5 from Robe of Stars');

    expect(rollLogStore.getState().rolls.map((r) => [r.expr, r.kind])).toEqual([['5d4', 'damage']]);
    expect(left('Robe of Stars charges use')).toBe(5);
    // Named as the row writes it, as any grant the data names in lower case.
    expect((await sheet.history())[0]).toBe('Cast magic missile (L5 from 1 Robe of Stars charge)');
  });

  it("shows the DC an item's text fixes, not the character's", async () => {
    const shards: DataEntity = {
      name: 'True-Ice Shards (Dagger)',
      source: 'CoA',
      type: 'M',
      rarity: 'artifact',
      reqAttune: true,
      attachedSpells: { will: ['detect thoughts'] },
    };
    await renderSheet(worn('True-Ice Shards (Dagger)', 'CoA'), {
      extra: { spell: [thoughts], item: [shards] },
    });
    expect(within(rowOf('detect thoughts')).getByText('DC 20')).toBeTruthy();
  });
});

/** Heals 1d8, a die more a slot level. */
const cureWounds: DataEntity = {
  name: 'Cure Wounds',
  source: 'TST',
  level: 1,
  school: 'A',
  time: [{ number: 1, unit: 'action' }],
  entries: ['A creature you touch regains {@dice 1d8} hit points.'],
  entriesHigherLevel: [
    { entries: ['The healing increases by {@scaledice 1d8|1-9|1d8} per slot above 1st.'] },
  ],
};
/**
 * A homebrew rod that says its own charges (O1): 7, 1d6 + 1 back at dawn,
 * Cure Wounds for `cost` a casting, one more a level up to 3rd.
 */
const rodOf = (cost = 1, regain: string = '1d6+1'): DataEntity => ({
  name: 'Rod of Mending',
  source: 'HB',
  type: 'RD',
  rarity: 'rare',
  reqAttune: true,
  entries: ['This rod has 7 charges.'],
  castGuidance: {
    v: 1,
    effects: [
      {
        kind: 'charges',
        charges: 7,
        regain,
        ability: 'wis',
        spells: [{ spell: 'Cure Wounds|TST', cost, upTo: 3 }],
      },
    ],
  },
});
const rodEntry = (id: string, equipped = true) => ({
  id,
  ref: { name: 'Rod of Mending', source: 'HB' },
  qty: 1,
  equipped,
  attuned: true,
});

describe("a homebrew item's own charges", () => {
  const world = (cost = 1) => ({ extra: { spell: [cureWounds], item: [rodOf(cost)] } });
  const ROD_TILES = [
    'Level 1 from Rod of Mending, 1 charge',
    'Level 2 from Rod of Mending, 2 charges',
    'Level 3 from Rod of Mending, 3 charges',
  ];
  const rodTiles = () => castTiles().filter((t) => t.includes('Rod of Mending'));
  const mender = (known: boolean, ...ids: string[]) => {
    const doc = sorcerer();
    doc.spellcasting = {
      'sorcerer|tst': { known: known ? [ref('Cure Wounds')] : [], prepared: [] },
    };
    doc.equipment = ids.map((id) => rodEntry(id));
    return doc;
  };

  it('grants its spell on a row of its own, priced by level from its charges', async () => {
    const sheet = await renderSheet(mender(false, 'r1'), world());
    expect(grantedSpell('Cure Wounds')).toEqual({
      alwaysPrepared: false,
      uses: '7/7 charges',
      usesTitle: 'charges from Rod of Mending',
    });

    press('1d8');
    expect(castTiles()).toEqual(ROD_TILES);
    castHeld('Level 2 from Rod of Mending');

    expect(rollLogStore.getState().rolls.map((r) => [r.expr, r.kind])).toEqual([['2d8', 'heal']]);
    expect(left('Rod of Mending charges use')).toBe(5);
    expect(grantedSpell('Cure Wounds').uses).toBe('5/7 charges');
    expect(pressed('Action')).toBe(true);
    expect((await sheet.history())[0]).toBe('Cast Cure Wounds (L2 from 2 Rod of Mending charges)');
  });

  it("offers its charges on a class spell's row by level, never as a use", async () => {
    await renderSheet(mender(true, 'r1'), world());
    // The class's row comes first, then the rod's own.
    fireEvent.click(screen.getAllByRole('button', { name: '1d8' })[0] as HTMLElement);
    expect(castTiles()[0]).toBe('Level 1 slot, 4 left');
    expect(rodTiles()).toEqual(ROD_TILES);
  });

  it('casts nothing from its row with too few charges left for any level', async () => {
    // Two charges a casting, with one left.
    const doc = mender(false, 'r1');
    doc.play.resources = [{ key: 'item-charges:r1', used: 6 }];
    const sheet = await renderSheet(doc, world(2));
    expect(grantedSpell('Cure Wounds').uses).toBe('1/7 charges');

    press('1d8');
    expect(castTiles()).toEqual([]);
    expect(pressed('Action')).toBe(false);
    expect((await sheet.saved()).play.resources).toEqual([{ key: 'item-charges:r1', used: 6 }]);
  });

  it('says a cantrip it cannot pay for wants charges, not a rest', async () => {
    // Spark Flick for 2 charges, with one left.
    const rod = rodOf();
    const effects = (rod.castGuidance as { effects: Array<{ spells: unknown[] }> }).effects;
    if (effects[0] !== undefined) effects[0].spells = [{ spell: 'Spark Flick|TST', cost: 2 }];
    const doc = mender(false, 'r1');
    doc.play.resources = [{ key: 'item-charges:r1', used: 6 }];
    await renderSheet(doc, { extra: { spell: [cureWounds, flick], item: [rod] } });
    const cast = screen.getAllByRole('button', { name: 'Cast Spark Flick' })[0];
    expect(cast?.hasAttribute('disabled')).toBe(true);
    expect(cast?.getAttribute('title')).toBe('Not enough charges left');
  });

  it('gives two rods two rows, each spending its own charges', async () => {
    const sheet = await renderSheet(mender(false, 'r1', 'r2'), world());
    const chips = screen.getAllByRole('button', { name: '1d8' });
    expect(chips).toHaveLength(2);

    fireEvent.click(chips[1] as HTMLElement);
    expect(castTiles()).toEqual([
      'Level 1 from Rod of Mending 2, 1 charge',
      'Level 2 from Rod of Mending 2, 2 charges',
      'Level 3 from Rod of Mending 2, 3 charges',
    ]);
    castHeld('Level 1 from Rod of Mending 2');
    expect((await sheet.saved()).play.resources).toEqual([{ key: 'item-charges:r2', used: 1 }]);
  });
});
