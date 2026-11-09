// @vitest-environment jsdom
// The named buffs on the Play tab (the buffs canvas, "How a buff gets on"):
// Rage and Innate Sorcery put in play by their own Use, which then ends them;
// Rage asking before it ends a concentration; and Bless asking whether its
// caster blessed themself too.
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { innateSorceryEffect, rageEffect } from '@/engine/curated/namedEffects';
import type { CharacterDoc, DataEntity } from '@/engine/types';
import { rollLogStore } from '@/stores/rollLog';
import {
  classEntry,
  concentratingOn,
  dialog,
  HARNESS_TIMEOUT,
  hp,
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

afterEach(async () => {
  vi.restoreAllMocks();
  await resetSheetHarness();
});

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

/**
 * The Use button turns into End under the finger, so a second tap within a
 * second is ignored: a clock the test moves, from after the sheet is up.
 */
function heldClock() {
  let now = Date.now();
  const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  return {
    later: () => {
      now += 2000;
    },
    release: () => spy.mockRestore(),
  };
}

/** A barbarian whose Rage the curated table makes a pool and a bonus action. */
function barbarianWorld(source: string) {
  return {
    class: [
      {
        name: 'Barbarian',
        source,
        hd: { number: 1, faces: 12 },
        proficiency: ['str', 'con'],
        classFeatures: [`Rage|Barbarian|${source}|1`],
      },
    ],
    classFeature: [
      {
        name: 'Rage',
        source,
        className: 'Barbarian',
        classSource: source,
        level: 1,
        entries: ['You can imbue yourself with a primal power called Rage.'],
      },
    ],
  };
}

function barbarian(source: 'TST' | 'XPHB', level: number): CharacterDoc {
  const doc = testCharacter('Grog', [], { str: 16, con: 14 });
  doc.classes = [
    source === 'TST'
      ? classEntry('Barbarian', level)
      : { ref: { name: 'Barbarian', source }, levels: level, hp: Array(level).fill('avg') },
  ];
  if (source === 'XPHB') doc.rulesVersion = '2024';
  return doc;
}

describe('Rage from its own Use', () => {
  it('spends a use and puts Rage in play in one tap, then ends it with End', async () => {
    const sheet = await renderSheet(barbarian('TST', 9), { extra: barbarianWorld('TST') });
    expect(left('Rage use')).toBe(4);
    const clock = heldClock();

    press('Use Rage');

    expect(left('Rage use')).toBe(3);
    const saved = await sheet.saved();
    expect(saved.play.turn?.bonus).toBe(true);
    expect(saved.play.activeEffects).toHaveLength(1);
    expect(saved.play.activeEffects?.[0]).toMatchObject({
      name: 'Rage',
      mine: true,
      lasts: { minutes: 1 },
    });
    // 2014 at 9th level: +3 on melee Strength weapon attacks.
    expect(saved.play.activeEffects?.[0]?.parts).toContainEqual({
      kind: 'damageBonus',
      scope: 'melee',
      amount: 3,
      ability: 'str',
    });
    expect((await sheet.history())[0]).toBe('Used Rage');
    expect(screen.getByRole('list', { name: 'From effects in play' }).textContent).toContain(
      'You cannot cast spells or concentrate while raging',
    );

    // A second tap on the same spot, straight after, is the same tap.
    press('End Rage');
    expect(screen.getByRole('button', { name: 'End Rage' })).toBeTruthy();

    clock.later();
    press('End Rage');
    clock.release();
    expect((await sheet.saved()).play.activeEffects).toBeUndefined();
    expect(left('Rage use')).toBe(3);
    expect((await sheet.history())[0]).toBe('Ended Rage');
    expect(screen.getByRole('button', { name: 'Use Rage' })).toBeTruthy();
  });

  it('asks before it ends a concentration, and does nothing when kept', async () => {
    const doc = barbarian('TST', 3);
    doc.play.concentratingOn = { label: 'Bless', level: 1 };
    doc.play.activeEffects = [
      {
        id: 'own-bless',
        name: 'Bless',
        parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
        lasts: { minutes: 1, concentration: true },
        mine: true,
      },
    ];
    const sheet = await renderSheet(doc, { extra: barbarianWorld('TST') });

    press('Use Rage');
    const ask = await dialog('Start Rage?');
    expect(ask.text).toContain('You cannot concentrate while raging, so this ends Bless.');
    expect(ask.options()).toEqual(['Rage and end Bless', 'Keep concentrating']);
    await ask.press('Keep concentrating');
    expect(left('Rage use')).toBe(3);
    expect(concentratingOn()).toBe('Bless');

    // Keeping it changed nothing, so the next tap asks again at once.
    press('Use Rage');
    await (await dialog('Start Rage?')).press('Rage and end Bless');
    expect(left('Rage use')).toBe(2);
    expect(concentratingOn()).toBeUndefined();
    const saved = await sheet.saved();
    expect(saved.play.concentratingOn).toBeUndefined();
    expect(saved.play.activeEffects?.map((e) => e.name)).toEqual(['Rage']);
  });

  it('follows its 2024 printing', async () => {
    const sheet = await renderSheet(barbarian('XPHB', 3), { extra: barbarianWorld('XPHB') });
    // Out of heavy armor, nothing to warn of.
    expect(screen.queryByText(/heavy armor/)).toBeNull();
    press('Use Rage');
    const rage = (await sheet.saved()).play.activeEffects?.[0];
    expect(rage?.lasts).toEqual({ minutes: 10, endsWhen: 'incapacitated' });
    expect(rage?.parts).toContainEqual({
      kind: 'damageBonus',
      scope: 'all',
      amount: 2,
      ability: 'str',
    });
  });

  it('ends when a hit drops the barbarian to 0 HP', async () => {
    const doc = barbarian('TST', 3);
    doc.play.activeEffects = [rageEffect('rage', 3, '2014')];
    doc.play.currentHp = 4;
    doc.play.hpInitialized = true;
    const sheet = await renderSheet(doc, { extra: barbarianWorld('TST') });
    press('Damage 1 hit point');
    expect((await sheet.saved()).play.activeEffects).toHaveLength(1);
    press('Damage 5 hit points');
    expect(hp().current).toBe(0);
    expect((await sheet.saved()).play.activeEffects).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Use Rage' })).toBeTruthy();
  });

  describe('in heavy armor', () => {
    const chainMail = (doc: CharacterDoc) => {
      doc.equipment = [
        {
          id: 'armor',
          ref: { name: 'Chain Mail', source: 'TST' },
          qty: 1,
          equipped: true,
          attuned: false,
        },
      ];
      return doc;
    };

    it('warns that 2014 Rage gives nothing in it, and still starts', async () => {
      await renderSheet(chainMail(barbarian('TST', 3)), { extra: barbarianWorld('TST') });
      expect(
        screen.getByText("Chain Mail: Rage's benefits need you out of heavy armor"),
      ).toBeTruthy();
      press('Use Rage');
      expect(left('Rage use')).toBe(2);
      expect(screen.getByRole('button', { name: 'End Rage' })).toBeTruthy();
    });

    it('warns that 2024 Rage cannot start in it and ends when it goes on', async () => {
      await renderSheet(chainMail(barbarian('XPHB', 3)), { extra: barbarianWorld('XPHB') });
      expect(
        screen.getByText(
          "Chain Mail: you can't enter Rage in heavy armor, and putting it on ends Rage",
        ),
      ).toBeTruthy();
    });
  });

  it('says None left when the uses are gone', async () => {
    const doc = barbarian('TST', 3);
    doc.play.resources = [{ key: 'rage', used: 3 }];
    await renderSheet(doc, { extra: barbarianWorld('TST') });
    // Its name starts with what it shows.
    const none = screen.getByRole('button', { name: 'None left of Rage' });
    expect(none.textContent).toBe('None left');
    expect((none as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('spells while raging', () => {
  const warning = 'You cannot cast spells while raging';

  it('warns over the spellcasting block', async () => {
    const doc = sorcerer();
    doc.play.activeEffects = [rageEffect('rage', 3, '2014')];
    await renderSheet(doc);
    expect(screen.getByText(warning)).toBeTruthy();
  });

  it('says nothing once Rage is switched off', async () => {
    const doc = sorcerer();
    doc.play.activeEffects = [{ ...rageEffect('rage', 3, '2014'), off: true }];
    await renderSheet(doc);
    expect(screen.queryByText(warning)).toBeNull();
  });

  it('warns on the Spells tab too, and not once Rage is off', async () => {
    const doc = sorcerer();
    doc.play.activeEffects = [rageEffect('rage', 3, '2014')];
    await renderSheet(doc, { path: 'spells' });
    expect(await screen.findByText(warning)).toBeTruthy();
    await resetSheetHarness();

    doc.play.activeEffects = [{ ...rageEffect('rage', 3, '2014'), off: true }];
    await renderSheet(doc, { path: 'spells' });
    expect(screen.queryByText(warning)).toBeNull();
  });
});

describe('Innate Sorcery from its own Use', () => {
  const world = {
    class: [
      {
        name: 'Sorcerer',
        source: 'XPHB',
        hd: { number: 1, faces: 6 },
        proficiency: ['con', 'cha'],
        casterProgression: 'full',
        spellcastingAbility: 'cha',
        cantripProgression: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
        spellsKnownProgression: [
          2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15,
        ],
        classFeatures: ['Innate Sorcery|Sorcerer|XPHB|1'],
      },
    ],
    classFeature: [
      {
        name: 'Innate Sorcery',
        source: 'XPHB',
        className: 'Sorcerer',
        classSource: 'XPHB',
        level: 1,
        entries: [
          'As a Bonus Action, you can unleash that magic for 1 minute.',
          'You can use this feature twice, and you regain all expended uses of it when you finish a Long Rest.',
        ],
      },
    ],
  } satisfies Record<string, DataEntity[]>;

  /** A Sorcerer cantrip with a spell attack, cast from its attack chip. */
  const dart: DataEntity = {
    name: 'Spark Dart',
    source: 'TST',
    level: 0,
    school: 'V',
    time: [{ number: 1, unit: 'action' }],
    spellAttack: ['R'],
    entries: ['Make a ranged spell attack. On a hit, it deals {@damage 1d10} fire damage.'],
  };
  const sparks = () => {
    const doc = testCharacter('Sparks', [], { cha: 16 });
    doc.rulesVersion = '2024';
    doc.classes = [{ ref: { name: 'Sorcerer', source: 'XPHB' }, levels: 1, hp: ['avg'] }];
    const ref = { name: 'Spark Dart', source: 'TST' };
    doc.spellcasting = { 'sorcerer|xphb': { known: [ref], prepared: [ref] } };
    return doc;
  };
  const lastRoll = () => rollLogStore.getState().rolls[0];

  it("raises the Sorcerer's save DC by 1, with the ring saying why", async () => {
    const sheet = await renderSheet(sparks(), { extra: { ...world, spell: [dart] } });
    const dc = () => screen.getByText(/^Save DC/).closest('span')?.textContent ?? '';
    expect(dc()).toBe('Save DC 13');

    press('Use Innate Sorcery');

    expect(dc()).toBe('Save DC 14, raised by Innate Sorcery');
    expect(screen.getByText(/^Save DC/).closest('.fx-lift-on')).not.toBeNull();
    const saved = await sheet.saved();
    expect(saved.play.activeEffects?.map((e) => e.name)).toEqual(['Innate Sorcery']);
    expect((await sheet.history())[0]).toBe('Used Innate Sorcery');
  });

  it('gives a Sorcerer spell attack advantage, the chip saying whose spell it is', async () => {
    rollLogStore.getState().clear();
    await renderSheet(sparks(), { extra: { ...world, spell: [dart] } });
    press('Use Innate Sorcery');
    // Only a test that names the Sorcerer is reached (namedEffects.test.ts).
    fireEvent.click(screen.getByRole('button', { name: 'Atk +5' }));
    expect(lastRoll()?.label).toBe('Spark Dart spell attack');
    expect(lastRoll()?.meta?.advantage).toBe('adv');
    expect(lastRoll()?.meta?.cue).toBe('Advantage: Innate Sorcery');
  });

  it("rings the Spells tab's save DCs too, the class's and a save spell's", async () => {
    const puff: DataEntity = {
      name: 'Frost Puff',
      source: 'TST',
      level: 0,
      school: 'V',
      time: [{ number: 1, unit: 'action' }],
      savingThrow: ['constitution'],
      entries: ['A creature must succeed on a Constitution saving throw.'],
    };
    const doc = sparks();
    const ref = { name: 'Frost Puff', source: 'TST' };
    doc.spellcasting = { 'sorcerer|xphb': { known: [ref], prepared: [ref] } };
    doc.play.activeEffects = [innateSorceryEffect('innate')];
    await renderSheet(doc, { path: 'spells', extra: { ...world, spell: [puff] } });
    const badge = async (text: RegExp) => (await screen.findByText(text)).closest('span');
    const block = await badge(/^Save DC/);
    expect(block?.textContent).toBe('Save DC 14, raised by Innate Sorcery');
    expect(block?.closest('.fx-lift-on')).not.toBeNull();
    const row = await badge(/^DC 14/);
    expect(row?.textContent).toBe('DC 14, raised by Innate Sorcery');
    expect(row?.closest('.fx-lift-on')).not.toBeNull();
  });

  it('reaches the same spell attack from the Spells tab', async () => {
    rollLogStore.getState().clear();
    const doc = sparks();
    doc.play.activeEffects = [innateSorceryEffect('innate')];
    await renderSheet(doc, { path: 'spells', extra: { ...world, spell: [dart] } });
    // The Spells tab's chip is named by its number alone.
    fireEvent.click(await screen.findByRole('button', { name: '+5' }));
    expect(lastRoll()?.meta?.advantage).toBe('adv');
  });

  describe("a feat's spell cast with Charisma", () => {
    // It casts with the Sorcerer's ability and sits in the Sorcerer's list on
    // the Spells tab, but it is not a Sorcerer spell.
    const charm: DataEntity = {
      name: 'Dart Charm',
      source: 'TST',
      additionalSpells: [{ ability: 'cha', prepared: { '1': ['spark dart|tst'] } }],
      entries: ['A charm that throws sparks.'],
    };
    const charmed = () => {
      const doc = sparks();
      doc.spellcasting = { 'sorcerer|xphb': { known: [], prepared: [] } };
      doc.feats = [{ ref: { name: 'Dart Charm', source: 'TST' }, instanceId: 'd1' }];
      doc.play.activeEffects = [innateSorceryEffect('innate')];
      return doc;
    };
    const extra = { ...world, spell: [dart], feat: [charm] };

    it('gets no advantage on Play', async () => {
      rollLogStore.getState().clear();
      await renderSheet(charmed(), { extra });
      fireEvent.click(screen.getByRole('button', { name: 'Atk +5' }));
      expect(lastRoll()?.label).toBe('spark dart spell attack');
      expect(lastRoll()?.meta?.advantage).toBeUndefined();
    });

    it('gets none on the Spells tab either', async () => {
      rollLogStore.getState().clear();
      await renderSheet(charmed(), { path: 'spells', extra });
      fireEvent.click(await screen.findByRole('button', { name: '+5' }));
      expect(lastRoll()?.meta?.advantage).toBeUndefined();
    });
  });
});

describe('casting Bless', () => {
  const bless: DataEntity = {
    name: 'Bless',
    source: 'TST',
    level: 1,
    school: 'E',
    time: [{ number: 1, unit: 'action' }],
    duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
    entries: ['You bless up to three creatures.'],
  };
  const caster = () => {
    const doc = sorcerer();
    doc.spellcasting['sorcerer|tst']?.known.push({ name: 'Bless', source: 'TST' });
    return doc;
  };

  it('asks once whether you are one of its targets, and ends your d4 with your concentration', async () => {
    const sheet = await renderSheet(caster(), { extra: { spell: [bless] } });
    press('Cast Bless');
    // The cast lands first; the ask comes after it.
    expect((await sheet.saved()).play.concentratingOn).toEqual({ label: 'Bless', level: 1 });
    const ask = await dialog('Bless yourself too?');
    expect(ask.options()).toEqual(['Yes, add +d4', 'Others only']);
    await ask.press('Yes, add +d4');
    expect(concentratingOn()).toBe('Bless');

    const saved = await sheet.saved();
    expect(saved.play.activeEffects).toHaveLength(1);
    expect(saved.play.activeEffects?.[0]).toMatchObject({ name: 'Bless', mine: true });
    expect(saved.play.concentratingOn).toEqual({ label: 'Bless', level: 1 });
    expect(screen.getByRole('list', { name: 'Active effects' }).textContent).toContain('Bless');

    fireEvent.click(screen.getByRole('button', { name: /^Concentrating on/ }));
    expect((await sheet.saved()).play.activeEffects).toBeUndefined();
  });

  it('puts nothing on you for Others only', async () => {
    const sheet = await renderSheet(caster(), { extra: { spell: [bless] } });
    press('Cast Bless');
    await (await dialog('Bless yourself too?')).press('Others only');
    const saved = await sheet.saved();
    expect(saved.play.activeEffects).toBeUndefined();
    expect(saved.play.concentratingOn).toEqual({ label: 'Bless', level: 1 });
  });

  it('asks the same when Bless is cast from a daily grant', async () => {
    // A feat's free cast goes through `castGranted`, not the slot path.
    const charm: DataEntity = {
      name: 'Blessing Charm',
      source: 'TST',
      additionalSpells: [{ ability: 'cha', innate: { _: { daily: { '1': ['bless|tst'] } } } }],
      entries: ['A charm that blesses once a day.'],
    };
    const doc = sorcerer();
    doc.feats = [{ ref: { name: 'Blessing Charm', source: 'TST' }, instanceId: 'c1' }];
    const sheet = await renderSheet(doc, { extra: { spell: [bless], feat: [charm] } });
    // A grant's row is named as the feat lists it.
    press('Cast bless');
    await (await dialog('Bless yourself too?')).press('Yes, add +d4');
    const saved = await sheet.saved();
    expect(saved.play.activeEffects?.[0]).toMatchObject({ name: 'Bless', mine: true });
    expect(saved.play.resources).toContainEqual({ key: expect.stringContaining('bless'), used: 1 });
  });
});
