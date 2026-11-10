// @vitest-environment jsdom
// House rules where they act (the Rules board, C), through the real sheet, the
// real rule store and the roll toast: the rest card says how long rests take
// and what a long one heals, its chips opening the rule's sheet for this
// character or every one; a crit's damage names the rule it was counted under,
// whose chip changes it; a melee spell attack offers flanking; and what
// dropping to 0 HP, a new turn or a natural 20 sets off is said.
import 'fake-indexeddb/auto';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDoc, DataEntity } from '@/engine/types';
import { announcerStore, THROTTLE_MS } from '@/stores/announcer';
import { heldRollStore, rollHeld } from '@/stores/heldRoll';
import { noticeStore } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { setAppTableRule } from '@/stores/tableRules';
import { RollToast } from '@/ui/RollToast';
import {
  classEntry,
  dialog,
  HARNESS_TIMEOUT,
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
  for (const id of ['critDamage', 'restLength', 'hpOnLongRest', 'flanking'] as const)
    act(() => setAppTableRule(id, undefined));
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

/** A level-3 warrior with STR 16 (+3) and a longsword in hand. */
function fighter(more: (doc: CharacterDoc) => void = () => {}) {
  const doc = testCharacter('Grog', [classEntry('Warrior', 3)], { str: 16, con: 14 });
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

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const sheetDialog = () => screen.getByRole('dialog');
const pick = (name: RegExp) => fireEvent.click(within(sheetDialog()).getByRole('radio', { name }));
/** Opens a d20 test's roll prompt, and taps the control again to roll it. */
const rollOn = (el: HTMLElement) => {
  fireEvent.click(el);
  fireEvent.click(el);
};

describe('the rest card', () => {
  it('says how long rests take and what a long one heals, under the app’s rules', async () => {
    act(() => setAppTableRule('hpOnLongRest', 'half'));
    await renderSheet(fighter());
    expect(screen.getByRole('button', { name: /^Short 1 hour, long 8 hours/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Long rest HP: half your maximum/ })).toBeTruthy();

    press('Long rest');
    const ask = await dialog('Long rest');
    expect(ask.text).toContain('Half your maximum HP back, all spell slots');
    await ask.press('Cancel');

    act(() => setAppTableRule('hpOnLongRest', 'hitDice'));
    press('Long rest');
    const none = await dialog('Long rest');
    expect(none.text).toContain('No HP back (spend hit dice to heal)');
    await none.press('Cancel');
  });

  it('opens the rule’s sheet from a chip, giving this character a rule of its own', async () => {
    const sheet = await renderSheet(fighter());
    press(/^Short 1 hour, long 8 hours/);
    const opened = sheetDialog();
    expect(within(opened).getByRole('heading', { name: 'Rest length' })).toBeTruthy();
    // Opened where the character is, it starts on every character until they have their own.
    expect(
      within(opened).getByRole('button', { name: 'Every character', pressed: true }),
    ).toBeTruthy();
    fireEvent.click(within(opened).getByRole('button', { name: 'Only Grog' }));
    pick(/^Short 8 hours, long 7 days/);
    fireEvent.click(within(opened).getByRole('button', { name: 'Done' }));

    expect((await sheet.saved()).tableRules).toEqual({ restLength: 'gritty' });
    expect(localStorage.getItem('cast-guidance:table-rule:restLength')).toBeNull();
    expect(
      screen.getByRole('button', { name: /^Short 8 hours, long 7 days/, hidden: true }),
    ).toBeTruthy();
    expect((await sheet.history())[0]).toBe('Rest length: gritty');
  });
});

describe('a crit’s rule on the roll toast', () => {
  it('names the rule the damage was counted under, and changes it for the character there', async () => {
    const sheet = await renderSheet(fighter());
    render(<RollToast />);
    nextFaces(20);
    rollOn(screen.getByTitle('Longsword attack'));
    nextFaces(3, 5);
    fireEvent.click(screen.getByTitle('Longsword slashing damage'));
    expect(rollLogStore.getState().rolls[0]?.meta?.critical).toBe(true);

    const chip = screen.getByRole('button', { name: /^Rule: double the dice/ });
    fireEvent.click(chip);
    const opened = await screen.findByRole('dialog', { name: 'Critical hits' });
    // A crit's chip opens on every character: the rule the toast named.
    expect(
      within(opened).getByRole('button', { name: 'Every character', pressed: true }),
    ).toBeTruthy();
    fireEvent.click(within(opened).getByRole('button', { name: 'Only Grog' }));
    pick(/^Double the total/);
    fireEvent.click(within(opened).getByRole('button', { name: 'Done' }));
    expect((await sheet.saved()).tableRules).toEqual({ critDamage: 'doubleTotal' });

    // The next crit counts under the character's own rule, and its chip says whose.
    nextFaces(20);
    rollOn(screen.getByTitle('Longsword attack'));
    nextFaces(6);
    fireEvent.click(screen.getByTitle('Longsword slashing damage'));
    const dealt = rollLogStore.getState().rolls[0];
    expect(dealt?.meta?.critRule).toBe('doubleTotal');
    expect(dealt?.total).toBe(18);
    expect(screen.getByRole('button', { name: /^Grog’s rule: double the total/ })).toBeTruthy();
  });

  /** A crit's damage rolled from a focused button, and the toast's rule chip. */
  const critChip = async () => {
    await renderSheet(fighter());
    render(<RollToast />);
    nextFaces(20);
    rollOn(screen.getByTitle('Longsword attack'));
    nextFaces(3, 5);
    const damage = screen.getByTitle('Longsword slashing damage');
    damage.focus();
    fireEvent.click(damage);
    return { damage, chip: screen.getByRole('button', { name: /^Rule: double the dice/ }) };
  };
  const closesBackTo = async (el: HTMLElement) => {
    const opened = await screen.findByRole('dialog', { name: 'Critical hits' });
    fireEvent.keyDown(opened, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(el);
  };

  it('hands focus back to the damage button after a tap on the chip', async () => {
    const { damage, chip } = await critChip();
    // A tap that leaves focus where it was (Safari), and the toast goes.
    fireEvent.pointerDown(chip);
    fireEvent.click(chip);
    await closesBackTo(damage);
  });

  it('hands focus back to the damage button after the chip is reached by keys', async () => {
    const { damage, chip } = await critChip();
    fireEvent.focus(chip, { relatedTarget: damage });
    chip.focus();
    fireEvent.click(chip);
    await closesBackTo(damage);
  });

  it('counts a stored value the app does not read as no rule of their own', async () => {
    await renderSheet(
      fighter((d) => {
        (d as { tableRules: unknown }).tableRules = { critDamage: 'triple' };
      }),
    );
    render(<RollToast />);
    nextFaces(20);
    rollOn(screen.getByTitle('Longsword attack'));
    nextFaces(3, 5);
    fireEvent.click(screen.getByTitle('Longsword slashing damage'));
    expect(screen.getByRole('button', { name: /^Rule: double the dice/ })).toBeTruthy();
  });

  it('shows no rule on a hit that did not crit', async () => {
    await renderSheet(fighter());
    render(<RollToast />);
    nextFaces(12);
    rollOn(screen.getByTitle('Longsword attack'));
    nextFaces(4);
    fireEvent.click(screen.getByTitle('Longsword slashing damage'));
    expect(screen.queryByRole('button', { name: /^Rule:/ })).toBeNull();
  });
});

describe('flanking on a melee spell attack', () => {
  const touch: DataEntity = {
    name: 'Shock Touch',
    source: 'TST',
    level: 0,
    school: 'V',
    time: [{ number: 1, unit: 'action' }],
    spellAttack: ['M'],
    entries: ['A touch deals {@damage 1d8} lightning damage.'],
  };
  const ray: DataEntity = { ...touch, name: 'Ray Bolt', spellAttack: ['R'] };
  const caster = () => {
    const doc = sorcerer();
    const refs = [
      { name: 'Shock Touch', source: 'TST' },
      { name: 'Ray Bolt', source: 'TST' },
    ];
    doc.spellcasting = { 'sorcerer|tst': { known: refs, prepared: refs } };
    return doc;
  };

  it('offers it under the table’s rule on a melee spell attack, and never on a ranged one', async () => {
    act(() => setAppTableRule('flanking', 'plusTwo'));
    await renderSheet(caster(), { extra: { spell: [touch, ray] } });
    nextFaces();
    fireEvent.click(screen.getByTitle('Shock Touch spell attack'));
    const offered = heldRollStore.getState().held?.ask?.thisTurn ?? [];
    expect(offered.map((t) => [t.source, t.bonus, t.thisRoll])).toEqual([['Flanking', 2, true]]);
    act(() => heldRollStore.setState({ held: null }));

    fireEvent.click(screen.getByTitle('Ray Bolt spell attack'));
    expect(heldRollStore.getState().held?.ask?.thisTurn ?? []).toEqual([]);
  });
});

describe('what dropping to 0 HP and a new turn set off', () => {
  // Grit with moments of its own: a cue at 0 HP, and one as a turn starts.
  const grit: DataEntity = {
    name: 'Grit',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    level: 1,
    entries: ['You are gritty.'],
    castGuidance: {
      v: 1,
      moments: [
        { at: 'zeroHp', do: [{ kind: 'cue', text: 'Roll on the scar table.', tone: 'warn' }] },
        { at: 'turnStart', do: [{ kind: 'cue', text: 'Shake it off.', tone: 'warn' }] },
      ],
    },
  };

  it('says the 0 HP moment as the keypad drops the character to 0', async () => {
    await renderSheet(
      fighter((d) => {
        d.play.currentHp = 5;
      }),
      { extra: { classFeature: [grit] } },
    );
    press('Damage 5 hit points');
    expect(notice()).toBe('Roll on the scar table.: Grit');
  });

  it('says a start-of-turn moment with where it came from', async () => {
    await renderSheet(fighter(), { extra: { classFeature: [grit] } });
    press('New turn');
    expect(notice()).toBe('New turn: Shake it off. · Grit');
  });
});

describe('a natural 20’s moment', () => {
  // Grit with a moment for a natural 20 on a save only: 5 temporary hit points.
  const grit: DataEntity = {
    name: 'Grit',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    level: 1,
    entries: ['You are gritty.'],
    castGuidance: {
      v: 1,
      moments: [{ at: 'natural20', rolls: ['save'], do: [{ kind: 'tempHp', amount: 5 }] }],
    },
  };
  /** Let the moment's step run: it fires after the roll lands, in a change of its own. */
  const landed = () => act(async () => {});
  const notices = () => noticeStore.getState().seq;

  it('fires on a save rolled from Stats, once, and not on an attack', async () => {
    const sheet = await renderSheet(fighter(), { extra: { classFeature: [grit] } });
    await sheet.tab('Stats');
    fireEvent.click(screen.getByRole('button', { name: /^CON [+-]\d+$/ }));
    nextFaces(20);
    act(() => rollHeld());
    await landed();
    expect(rollLogStore.getState().rolls[0]?.meta).toMatchObject({
      test: 'save',
      d20: { natural: 20 },
    });
    expect((await sheet.saved()).play.tempHp).toBe(5);
    expect(notice()).toMatch(/^Natural 20: /);
    const said = notices();
    const rows = (await sheet.history()).length;

    // Seen again on another tab and back, the roll sets nothing off a second time.
    await sheet.tab('Play');
    await sheet.tab('Stats');
    await landed();
    expect(notices()).toBe(said);
    expect(await sheet.history()).toHaveLength(rows);

    // A natural 20 on an attack is not a save: nothing is said for it.
    await sheet.tab('Play');
    nextFaces(20);
    rollOn(screen.getByTitle('Longsword attack'));
    await landed();
    expect(rollLogStore.getState().rolls[0]?.meta?.test).toBe('attack');
    expect(notices()).toBe(said);
  });

  it('sets nothing off on a save that fails automatically', async () => {
    const sheet = await renderSheet(
      fighter((d) => {
        d.play.conditions = [{ id: 'Stunned' }];
      }),
      { extra: { classFeature: [grit] } },
    );
    await sheet.tab('Stats');
    const said = notices();
    const saves = screen.getByRole('heading', { name: 'Saving throws' }).parentElement;
    if (saves === null) throw new Error('no saves section');
    nextFaces(20);
    rollOn(within(saves).getByRole('button', { name: /^DEX/ }));
    await landed();
    expect(rollLogStore.getState().rolls[0]?.meta).toMatchObject({
      test: 'save',
      autoFail: true,
      d20: { natural: 20 },
    });
    expect(notices()).toBe(said);
    expect((await sheet.saved()).play.tempHp).toBe(0);
  });

  it('keeps the attack’s name on the history row it lands in', async () => {
    const fierce: DataEntity = {
      ...grit,
      castGuidance: {
        v: 1,
        moments: [{ at: 'natural20', rolls: ['attack'], do: [{ kind: 'tempHp', amount: 3 }] }],
      },
    };
    const sheet = await renderSheet(fighter(), { extra: { classFeature: [fierce] } });
    nextFaces(20);
    rollOn(screen.getByTitle('Longsword attack'));
    await landed();
    const saved = await sheet.saved();
    expect(saved.play.tempHp).toBe(3);
    expect(saved.play.turn?.action).toBe(true);
    expect((await sheet.history())[0]).toBe('Attacked with Longsword');
  });
});

describe('a natural 1’s moment on a concentration save', () => {
  // Grit with a cue for a natural 1 on a save.
  const shaky: DataEntity = {
    name: 'Grit',
    source: 'TST',
    className: 'Warrior',
    classSource: 'TST',
    level: 1,
    entries: ['You are shaky.'],
    castGuidance: {
      v: 1,
      moments: [
        { at: 'natural1', rolls: ['save'], do: [{ kind: 'cue', text: 'Drop your shield.' }] },
      ],
    },
  };

  it('joins the concentration notice instead of taking its place', async () => {
    await renderSheet(
      fighter((d) => {
        d.play.concentratingOn = { label: 'Bless' };
      }),
      { extra: { classFeature: [shaky] } },
    );
    nextFaces(1);
    press('Damage 5 hit points');
    await act(async () => {});
    expect(rollLogStore.getState().rolls[0]?.meta).toMatchObject({
      test: 'save',
      d20: { natural: 1 },
    });
    const said = noticeStore.getState().notice;
    expect(said?.title).toMatch(/^Concentration/);
    expect(said?.detail).toContain('Bless');
    expect(said?.detail).toContain('Natural 1 · Drop your shield. · Grit');
    // Said once each: the concentration save, then the moment in its own words
    // (a polite line may wait out the announcer's throttle).
    const spoken = () => announcerStore.getState().messages.map((m) => m.text);
    await waitFor(() => expect(spoken()).toContain('Natural 1. Drop your shield. · Grit'), {
      timeout: THROTTLE_MS * 2,
    });
    expect(spoken().filter((t) => t.includes('Concentration'))).toHaveLength(1);
  });
});
