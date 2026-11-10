// @vitest-environment jsdom
// The effect strip (the buffs canvas, Strip A): the conditions and the effects
// in play under the sheet header, each opening what it does and removable, and
// the Effects sheet behind the strip's end. Focus never drops to the page when
// a chip it was on goes.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bardicEffect, blessEffect, rageEffect } from '@/engine/curated/namedEffects';
import {
  type ActiveEffect,
  type CharacterDoc,
  type DerivedSheet,
  newCharacterDoc,
} from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { conditionSheetStore } from '@/stores/conditionSheet';
import { noticeStore } from '@/stores/notices';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { ConditionStrip, effectTab } from './ConditionStrip';

// Rules text in both editions, so the sheet is seen to pick the character's.
vi.mock('@/data5e/hooks', () => {
  const rows: Record<string, { name: string; source: string; entries: string[] }[]> = {
    condition: [
      { name: 'Poisoned', source: 'PHB', entries: ['Poisoned, as printed in 2014.'] },
      { name: 'Poisoned', source: 'XPHB', entries: ['Poisoned, as printed in 2024.'] },
      { name: 'Exhaustion', source: 'XPHB', entries: ['Exhaustion, as printed in 2024.'] },
    ],
  };
  const registry = { byType: (type: string) => rows[type] ?? [] };
  return { useRegistry: () => registry };
});

beforeAll(() => {
  // vaul asks for matchMedia, which jsdom does not have.
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(cleanup);

type Conditions = CharacterDoc['play']['conditions'];

/**
 * What the strip reads of the sheet: immunities, and the HP maximum effects
 * move; and what the tab's effects read: no weapons, features or spells.
 */
const sheetWith = (immune: DerivedSheet['conditionImmunities']) =>
  ({
    conditionImmunities: immune,
    maxHp: { value: 20, base: 20, parts: [], overridden: false },
    attacks: [],
    actions: [],
    grantedSpells: [],
  }) as unknown as DerivedSheet;

/** The strip over a character held in state, as the session store holds it. */
function renderStrip(
  conditions: Conditions,
  {
    tab = '',
    effects,
    immune = [],
    edition = '2024',
    concentrating,
  }: {
    /** The sheet tab, by its route segment: Play unless said. */
    tab?: string;
    effects?: ActiveEffect[];
    immune?: DerivedSheet['conditionImmunities'];
    edition?: CharacterDoc['rulesVersion'];
    concentrating?: string;
  } = {},
) {
  function Harness() {
    const [doc, setDoc] = useState(() => {
      const d = newCharacterDoc('c1', 'Hero', 't');
      d.rulesVersion = edition;
      d.play.conditions = conditions;
      if (effects !== undefined) d.play.activeEffects = effects;
      if (concentrating !== undefined) d.play.concentratingOn = { label: concentrating };
      return d;
    });
    // The recipe runs at once, as the session store runs it.
    const current = useRef(doc);
    const update = ((recipe: (draft: CharacterDoc) => void) => {
      const next = structuredClone(current.current);
      recipe(next);
      current.current = next;
      setDoc(next);
    }) as DocUpdater;
    return (
      <>
        <h1 id="sheet-title" tabIndex={-1}>
          Hero
        </h1>
        <p>HP {doc.play.currentHp ?? 'unset'}</p>
        <p>Concentrating on {doc.play.concentratingOn?.label ?? 'nothing'}</p>
        <p>
          Effects{' '}
          {(doc.play.activeEffects ?? []).map((e) => `${e.name}${e.off ? ' off' : ''}`).join(', ')}
        </p>
        <output data-testid="stored">{JSON.stringify(doc.play.activeEffects ?? [])}</output>
        <ConditionStrip doc={doc} sheet={sheetWith(immune)} update={update} tab={tab} />
      </>
    );
  }
  render(<Harness />);
}

const button = (name: string) => screen.getByRole('button', { name });
/** The effects in play as stored, without their ids (each a fresh random one). */
const stored = (): Array<Omit<ActiveEffect, 'id'>> =>
  (JSON.parse(screen.getByTestId('stored').textContent ?? '[]') as ActiveEffect[]).map(
    ({ id: _, ...rest }) => rest,
  );
const strip = () => within(screen.getByRole('list', { name: 'Active effects' }));
const closeSheet = async () => {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

describe('the condition strip', () => {
  it('keeps its add chip, + Effect, on every tab with nothing active', () => {
    for (const tab of ['', 'stats', 'spells', 'inventory', 'features']) {
      renderStrip([], { tab });
      expect(screen.queryByRole('list')).toBeNull();
      const add = button('Add an effect');
      expect(add.getAttribute('aria-haspopup')).toBe('dialog');
      expect(add.textContent).toBe('Effect');
      cleanup();
    }
  });

  it('knows each tab by its route segment, and Build or another by none', () => {
    expect(['', 'stats', 'spells', 'inventory', 'features'].map(effectTab)).toEqual([
      'play',
      'stats',
      'spells',
      'items',
      'features',
    ]);
    expect(effectTab('build')).toBeUndefined();
    expect(effectTab('toString')).toBeUndefined();
  });

  it('lists what is active, exhaustion at its level, with the add chip after the list', () => {
    renderStrip([{ id: 'Poisoned' }, { id: 'Exhaustion', level: 2 }]);
    const names = strip()
      .getAllByRole('button')
      .map((b) => b.textContent || b.getAttribute('aria-label'));
    expect(names).toEqual(['Poisoned', 'Remove Poisoned', 'Exhausted 2', 'Remove Exhaustion']);
    // The add chip is no active condition, so it is outside the list.
    expect(strip().queryByRole('button', { name: 'Add an effect' })).toBeNull();
    expect(button('Add an effect')).toBeTruthy();
  });

  it('removes a condition, focus going to the chip in its place, then the one before, then the add chip', () => {
    renderStrip([{ id: 'Poisoned' }, { id: 'Prone' }, { id: 'Blinded' }], { tab: 'stats' });
    fireEvent.click(button('Remove Poisoned'));
    expect(document.activeElement).toBe(button('Remove Prone'));
    fireEvent.click(button('Remove Blinded'));
    expect(document.activeElement).toBe(button('Remove Prone'));
    fireEvent.click(button('Remove Prone'));
    // The strip stays on every tab, so its end takes focus.
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.activeElement).toBe(button('Add an effect'));
  });

  it('puts focus on the add chip once the last condition goes, on Items too', () => {
    renderStrip([{ id: 'Poisoned' }], { tab: 'inventory' });
    fireEvent.click(button('Remove Poisoned'));
    expect(document.activeElement).toBe(button('Add an effect'));
  });

  it("switches a condition's effects off and back on from its sheet, keeping it listed", async () => {
    renderStrip([{ id: 'Poisoned' }]);
    fireEvent.click(button('Poisoned'));
    const sheet = within(await screen.findByRole('dialog', { name: 'Poisoned' }));
    const apply = sheet.getByRole('button', { name: /^Apply its effects/ });
    expect(apply.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(apply);
    expect(apply.getAttribute('aria-pressed')).toBe('false');
    expect(apply.textContent).toBe('Apply its effectsOff');
    await closeSheet();
    // Still on the strip, saying it is off.
    expect(strip().getByRole('button', { name: 'Poisoned off' })).toBeTruthy();

    fireEvent.click(button('Poisoned off'));
    const again = within(await screen.findByRole('dialog', { name: 'Poisoned' }));
    fireEvent.click(again.getByRole('button', { name: /^Apply its effects/ }));
    await closeSheet();
    expect(strip().getByRole('button', { name: 'Poisoned' })).toBeTruthy();
  });

  it("opens what a condition does from its name, in the character's edition, and hands focus back", async () => {
    renderStrip([{ id: 'Poisoned' }]);
    fireEvent.click(button('Poisoned'));
    const sheet = within(await screen.findByRole('dialog', { name: 'Poisoned' }));
    expect(sheet.getByText('Disadvantage on attack rolls and ability checks.')).toBeTruthy();
    expect(sheet.getByText('Poisoned, as printed in 2024.')).toBeTruthy();
    expect(sheet.queryByText('Poisoned, as printed in 2014.')).toBeNull();
    await closeSheet();
    await waitFor(() => expect(document.activeElement).toBe(button('Poisoned')));
  });

  it('steps exhaustion down in its own sheet, which stays open when it reaches 0', async () => {
    renderStrip([{ id: 'Exhaustion', level: 1 }]);
    fireEvent.click(button('Exhausted 1'));
    const sheet = within(await screen.findByRole('dialog', { name: 'Exhaustion' }));
    expect(sheet.getByText('Exhaustion, as printed in 2024.')).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Decrease exhaustion' }));
    expect(screen.queryByRole('list')).toBeNull();
    expect(sheet.getByText('0 / 6')).toBeTruthy();
    await closeSheet();
    // Its chip is gone, so focus goes to the add chip.
    await waitFor(() => expect(document.activeElement).toBe(button('Add an effect')));
  });
});

describe('exhaustion at its limits', () => {
  it('keeps its stepper buttons focusable at 0 and 6, saying they go no further', async () => {
    renderStrip([{ id: 'Exhaustion', level: 5 }]);
    fireEvent.click(button('Add an effect'));
    const picker = within(await screen.findByRole('dialog', { name: 'Effects' }));
    const up = picker.getByRole('button', { name: 'Increase exhaustion' });
    fireEvent.click(up);
    // Not `disabled`, which in a browser takes focus off the button pressed
    // (jsdom keeps it, so keyboard.spec.ts checks the focus itself).
    expect(up.hasAttribute('disabled')).toBe(false);
    expect(up.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(up);
    expect(picker.getByText('6 / 6')).toBeTruthy();
  });

  it('drops to 0 HP from Apply death at 6, closing the sheet to show it', async () => {
    renderStrip([{ id: 'Exhaustion', level: 6 }]);
    fireEvent.click(button('Exhausted 6'));
    const sheet = within(await screen.findByRole('dialog', { name: 'Exhaustion' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Apply death: drop to 0 HP' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByText('HP 0')).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(button('Exhausted 6')));
  });
});

describe('while a condition sheet is over the attack chips', () => {
  const held = () => conditionSheetStore.getState().open;

  afterEach(() => conditionSheetStore.setState({ open: false }));

  it('holds them from the moment a sheet opens until just after it closes', async () => {
    renderStrip([{ id: 'Poisoned' }]);
    expect(held()).toBe(false);

    fireEvent.click(button('Add an effect'));
    await screen.findByRole('dialog', { name: 'Effects' });
    expect(held()).toBe(true);

    const closing = Date.now();
    await closeSheet();
    // Closed, and still held: the chips play what changed once it has cleared.
    expect(held()).toBe(true);
    await waitFor(() => expect(held()).toBe(false));
    expect(Date.now() - closing).toBeGreaterThanOrEqual(290);
  });

  it('keeps holding across one sheet closing and another opening', async () => {
    renderStrip([{ id: 'Poisoned' }]);
    fireEvent.click(button('Add an effect'));
    await screen.findByRole('dialog', { name: 'Effects' });
    await closeSheet();
    fireEvent.click(button('Poisoned'));
    await screen.findByRole('dialog', { name: 'Poisoned' });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(held()).toBe(true);
  });

  it('holds them for a condition’s own sheet too', async () => {
    renderStrip([{ id: 'Poisoned' }]);
    fireEvent.click(button('Poisoned'));
    await screen.findByRole('dialog', { name: 'Poisoned' });
    expect(held()).toBe(true);
  });

  it('lets go at once if the strip goes while a sheet is up', async () => {
    renderStrip([{ id: 'Poisoned' }]);
    fireEvent.click(button('Poisoned'));
    await screen.findByRole('dialog', { name: 'Poisoned' });
    expect(held()).toBe(true);
    cleanup();
    expect(held()).toBe(false);
  });
});

describe('what a condition coming on ends', () => {
  const concentrating = () => screen.getByText(/^Concentrating on/, { selector: 'p' }).textContent;
  const effectsNow = () => screen.getByText(/^Effects/, { selector: 'p' }).textContent;
  const pickCondition = async (name: string) => {
    fireEvent.click(button('Add an effect'));
    const picker = within(await screen.findByRole('dialog', { name: 'Effects' }));
    fireEvent.click(picker.getByRole('button', { name }));
  };
  afterEach(() => noticeStore.getState().clear());

  it('breaks concentration under Stunned, ending what it held, and says so', async () => {
    renderStrip([], {
      edition: '2014',
      effects: [blessEffect('mine', true), blessEffect('ally', false)],
      concentrating: 'Bless',
    });
    await pickCondition('Stunned');
    expect(concentrating()).toBe('Concentrating on nothing');
    // The ally's Bless is held by their concentration, not this character's.
    expect(effectsNow()).toBe('Effects Bless');
    expect(noticeStore.getState().notice).toEqual({
      title: 'Concentration broken',
      detail: 'Bless · Stunned · Ended Bless',
      tone: 'warn',
    });
  });

  it('ends nothing under a condition that does not incapacitate', async () => {
    renderStrip([], { concentrating: 'Hold Person' });
    await pickCondition('Poisoned');
    expect(concentrating()).toBe('Concentrating on Hold Person');
    expect(noticeStore.getState().notice).toBeNull();
  });

  it('leaves concentration kept up under Stunned alone when another condition comes on', async () => {
    // The sheet warns and never blocks, so the player may concentrate while stunned.
    renderStrip([{ id: 'Stunned' }], { concentrating: 'Hold Person' });
    await pickCondition('Prone');
    expect(concentrating()).toBe('Concentrating on Hold Person');
    expect(noticeStore.getState().notice).toBeNull();
  });

  it('breaks it when a switched-off Paralyzed is switched back on', async () => {
    renderStrip([{ id: 'Paralyzed', ignored: true }], { concentrating: 'Hold Person' });
    expect(concentrating()).toBe('Concentrating on Hold Person');
    fireEvent.click(button('Paralyzed off'));
    const sheet = within(await screen.findByRole('dialog', { name: 'Paralyzed' }));
    fireEvent.click(sheet.getByRole('button', { name: /^Apply its effects/ }));
    expect(concentrating()).toBe('Concentrating on nothing');
    expect(noticeStore.getState().notice).toMatchObject({ detail: 'Hold Person · Paralyzed' });
  });

  it('ends 2024 Rage under Incapacitated, and 2014 Rage only when knocked unconscious', async () => {
    renderStrip([], { effects: [rageEffect('r', 3, '2024')] });
    await pickCondition('Incapacitated');
    expect(effectsNow()).toBe('Effects ');
    expect(noticeStore.getState().notice).toEqual({
      title: 'Ended Rage',
      detail: 'Incapacitated',
      tone: 'warn',
    });
    cleanup();

    renderStrip([], { edition: '2014', effects: [rageEffect('r', 3, '2014')] });
    await pickCondition('Stunned');
    expect(effectsNow()).toBe('Effects Rage');
    const picker = within(screen.getByRole('dialog', { name: 'Effects' }));
    fireEvent.click(picker.getByRole('button', { name: 'Unconscious' }));
    expect(effectsNow()).toBe('Effects ');
  });

  it('ends Rage and concentration with Apply death', async () => {
    renderStrip([{ id: 'Exhaustion', level: 6 }], {
      effects: [rageEffect('r', 3, '2014')],
      concentrating: 'Hold Person',
    });
    fireEvent.click(button('Exhausted 6'));
    const sheet = within(await screen.findByRole('dialog', { name: 'Exhaustion' }));
    fireEvent.click(sheet.getByRole('button', { name: 'Apply death: drop to 0 HP' }));
    expect(effectsNow()).toBe('Effects ');
    expect(concentrating()).toBe('Concentrating on nothing');
  });
});

describe('the condition picker', () => {
  it('holds every condition as a toggle that says whether it is on, and the exhaustion stepper', async () => {
    renderStrip([{ id: 'Poisoned' }]);
    fireEvent.click(button('Add an effect'));
    const picker = within(await screen.findByRole('dialog', { name: 'Effects' }));
    // The 13 conditions besides Poisoned, and the three starters (Bless,
    // Guidance, Bardic Inspiration).
    expect(picker.getAllByRole('button', { pressed: false })).toHaveLength(16);
    expect(picker.getByRole('button', { name: 'Poisoned', pressed: true })).toBeTruthy();
    expect(picker.getByRole('button', { name: 'Blinded', pressed: false })).toBeTruthy();

    fireEvent.click(picker.getByRole('button', { name: 'Blinded' }));
    expect(picker.getByRole('button', { name: 'Blinded', pressed: true })).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Poisoned' }));
    fireEvent.click(picker.getByRole('button', { name: 'Increase exhaustion' }));
    // The strip follows at once, behind the sheet (which hides it from the
    // accessibility tree while it is open, hence `hidden`).
    const behind = within(screen.getByRole('list', { name: 'Active effects', hidden: true }));
    expect(
      behind
        .getAllByRole('button', { name: /^Remove /, hidden: true })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Remove Blinded', 'Remove Exhaustion']);
    expect(behind.getByRole('button', { name: 'Exhausted 1', hidden: true })).toBeTruthy();

    await closeSheet();
    await waitFor(() => expect(document.activeElement).toBe(button('Add an effect')));
  });

  it("names every control, Stunned's included, on the strip and in the picker", async () => {
    renderStrip([{ id: 'Stunned' }]);
    expect(namelessControls()).toEqual([]);
    expect(button('Stunned').getAttribute('aria-haspopup')).toBe('dialog');
    expect(button('Remove Stunned')).toBeTruthy();
    fireEvent.click(button('Add an effect'));
    await screen.findByRole('dialog', { name: 'Effects' });
    expect(namelessControls()).toEqual([]);
  });
});

const bless: ActiveEffect = {
  id: 'bless',
  name: 'Bless',
  parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
  lasts: { minutes: 1, concentration: true },
};
const shield: ActiveEffect = {
  id: 'sof',
  name: 'Shield of Faith',
  parts: [{ kind: 'acBonus', amount: 2 }],
  lasts: { minutes: 10, concentration: true },
};
const effectsLine = () => screen.getByText(/^Effects/, { selector: 'p' }).textContent;

describe('effects in play on the strip', () => {
  it('lists them after the conditions, each with its die, and ends one from its x', () => {
    renderStrip([{ id: 'Poisoned' }], { effects: [bless, shield] });
    expect(
      strip()
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label') ?? b.textContent),
    ).toEqual([
      'Poisoned',
      'Remove Poisoned',
      '+d4 Bless',
      'Remove Bless',
      'Shield of Faith',
      'Remove Shield of Faith',
    ]);
    fireEvent.click(button('Remove Bless'));
    expect(effectsLine()).toBe('Effects Shield of Faith');
    // Focus goes to the chip now in its place.
    expect(document.activeElement).toBe(button('Remove Shield of Faith'));
  });

  it('says what one does and how long it lasts, switches it off, and removes it', async () => {
    renderStrip([], { effects: [bless] });
    fireEvent.click(button('+d4 Bless'));
    const sheet = within(await screen.findByRole('dialog', { name: 'Bless' }));
    expect(sheet.getByText('Add 1d4 to attack rolls and saving throws')).toBeTruthy();
    expect(sheet.getByText('Lasts up to 1 minute, while its caster concentrates.')).toBeTruthy();
    const apply = sheet.getByRole('button', { name: /^Apply its effects/ });
    fireEvent.click(apply);
    expect(apply.getAttribute('aria-pressed')).toBe('false');
    expect(effectsLine()).toBe('Effects Bless off');
    await closeSheet();
    expect(strip().getByRole('button', { name: '+d4 Bless off' })).toBeTruthy();

    fireEvent.click(button('+d4 Bless off'));
    const again = within(await screen.findByRole('dialog', { name: 'Bless' }));
    fireEvent.click(again.getByRole('button', { name: 'Remove it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(effectsLine()).toBe('Effects ');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('says when another of the same name counts instead', async () => {
    renderStrip([], { effects: [bless, { ...bless, id: 'bless2' }] });
    fireEvent.click(strip().getAllByRole('button', { name: '+d4 Bless' })[1] as HTMLElement);
    const sheet = within(await screen.findByRole('dialog', { name: 'Bless' }));
    expect(
      sheet.getByText('Another Bless counts instead: effects of one name never add up.'),
    ).toBeTruthy();
  });

  it('lists them under Helping you in the Effects sheet, where a tap ends one', async () => {
    renderStrip([], { effects: [bless, shield] });
    fireEvent.click(button('Add an effect'));
    const picker = within(await screen.findByRole('dialog', { name: 'Effects' }));
    expect(picker.getByRole('heading', { name: 'Helping you' })).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: '+d4 Bless', pressed: true }));
    expect(effectsLine()).toBe('Effects Shield of Faith');
    // Bless is a starter, so its chip stays where it was, ready to add again.
    expect(picker.getByRole('button', { name: '+d4 Bless', pressed: false })).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Shield of Faith', pressed: true }));
    expect(picker.queryByRole('button', { name: 'Shield of Faith' })).toBeNull();
  });

  it('counts the chips out of sight on its end, which still opens the Effects sheet', async () => {
    // A 300px strip whose end starts at 250px: chips 120px wide every 128px,
    // so the third and fourth are past the end.
    const rect = (left: number, width: number) =>
      ({ left, right: left + width, top: 0, bottom: 32, width, height: 32 }) as DOMRect;
    const spy = vi
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === 'LI') {
          const at = [...(this.parentElement?.children ?? [])].indexOf(this);
          return rect(at * 128, 120);
        }
        if (this.getAttribute('aria-haspopup') === 'dialog' && this.closest('li') === null) {
          return rect(250, 50);
        }
        return rect(0, 300);
      });
    try {
      renderStrip([{ id: 'Poisoned' }, { id: 'Prone' }], { effects: [bless, shield] });
      const end = button('Effects, 2 more not shown');
      expect(end.textContent).toBe('2 more');
      fireEvent.click(end);
      expect(await screen.findByRole('dialog', { name: 'Effects' })).toBeTruthy();
    } finally {
      spy.mockRestore();
    }
  });
});

describe('a condition the character is immune to', () => {
  const periapt = [{ condition: 'Poisoned', origin: 'Periapt of Proof against Poison' }];

  it('is refused in the picker with the reason, and nothing is added', async () => {
    renderStrip([], { immune: periapt });
    fireEvent.click(button('Add an effect'));
    const picker = within(await screen.findByRole('dialog', { name: 'Effects' }));
    const chip = picker.getByRole('button', { name: 'Poisoned, you are immune' });
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip);
    await waitFor(() =>
      expect(picker.getByRole('status').textContent).toMatch(
        /^You cannot be poisoned: Periapt of Proof against Poison\..* Nothing was added\.$/,
      ),
    );
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('list', { name: 'Active effects', hidden: true })).toBeNull();
  });

  it('shows one already on as held off, with the reason in place of the switch', async () => {
    renderStrip([{ id: 'Poisoned' }], { immune: periapt });
    const chip = strip().getByRole('button', {
      name: 'Poisoned off, held off by Periapt of Proof against Poison',
    });
    fireEvent.click(chip);
    const sheet = within(await screen.findByRole('dialog', { name: 'Poisoned' }));
    expect(sheet.queryByRole('button', { name: /^Apply its effects/ })).toBeNull();
    expect(
      sheet.getByText(/^Off while you are immune: Periapt of Proof against Poison\./),
    ).toBeTruthy();
  });
});

describe('the starter list under Helping you', () => {
  const openPicker = async () => {
    fireEvent.click(button('Add an effect'));
    return within(await screen.findByRole('dialog', { name: 'Effects' }));
  };

  it("adds an ally's Bless, Guidance and Bardic Inspiration in 2014, and asks the bard's die", async () => {
    renderStrip([], { edition: '2014' });
    const picker = await openPicker();

    fireEvent.click(picker.getByRole('button', { name: '+d4 Bless', pressed: false }));
    fireEvent.click(picker.getByRole('button', { name: '+d4 Guidance', pressed: false }));
    expect(stored()).toEqual([
      {
        name: 'Bless',
        parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
        lasts: { minutes: 1, concentration: true },
      },
      {
        name: 'Guidance',
        parts: [{ kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'] }, once: true }],
        lasts: { minutes: 1, concentration: true },
      },
    ]);
    expect(picker.getByRole('button', { name: '+d4 Bless', pressed: true })).toBeTruthy();
    expect(picker.queryByRole('group', { name: "The bard's die, by their level" })).toBeNull();

    // A bard's die depends on their level: it lands as a d8 and asks.
    fireEvent.click(picker.getByRole('button', { name: '+d8 Bardic Inspiration', pressed: false }));
    const die = within(picker.getByRole('group', { name: "The bard's die, by their level" }));
    expect(die.getByRole('button', { name: 'd8', pressed: true })).toBeTruthy();
    fireEvent.click(die.getByRole('button', { name: 'd12' }));
    expect(stored()[2]).toEqual({
      name: 'Bardic Inspiration',
      parts: [
        { kind: 'rollOffer', dice: '1d12', on: { rolls: ['attack', 'save', 'check'] }, once: true },
      ],
      lasts: { minutes: 10 },
    });
    expect(
      picker.getByRole('button', { name: '+d12 Bardic Inspiration', pressed: true }),
    ).toBeTruthy();

    // Tapping one in play ends it, and its chip stays to add again.
    fireEvent.click(picker.getByRole('button', { name: '+d12 Bardic Inspiration' }));
    expect(effectsLine()).toBe('Effects Bless, Guidance');
    expect(
      picker.getByRole('button', { name: '+d8 Bardic Inspiration', pressed: false }),
    ).toBeTruthy();
    expect(picker.queryByRole('group', { name: "The bard's die, by their level" })).toBeNull();
  });

  it('adds 2024 Guidance at once, offered on skill checks, and waits for a failed roll with Bardic', async () => {
    renderStrip([], { edition: '2024' });
    const picker = await openPicker();
    const guidance = picker.getByRole('button', { name: '+d4 Guidance' });
    expect(guidance.getAttribute('aria-expanded')).toBeNull();
    fireEvent.click(guidance);
    // No skill asked for: the die is offered on each skill check instead.
    expect(stored()).toEqual([
      {
        name: 'Guidance',
        parts: [{ kind: 'rollOffer', dice: '1d4', on: { rolls: ['check'], skilled: true } }],
        lasts: { minutes: 1, concentration: true },
      },
    ]);
    expect(picker.getByRole('button', { name: '+d4 Guidance', pressed: true })).toBeTruthy();

    fireEvent.click(picker.getByRole('button', { name: '+d8 Bardic Inspiration' }));
    expect(stored()[1]).toMatchObject({
      parts: [{ dice: '1d8', once: true, ifFailed: true }],
      lasts: { minutes: 60 },
    });
  });

  it("changes only the bard's die, leaving a switched-off Bardic Inspiration off", async () => {
    const bardic = { ...bardicEffect('b1', '2024', 'd8'), off: true, turnsLeft: 2 };
    renderStrip([], { effects: [bardic] });
    const picker = await openPicker();
    const dice = within(picker.getByRole('group', { name: "The bard's die, by their level" }));
    fireEvent.click(dice.getByRole('button', { name: 'd10' }));
    const { id: _, ...want } = { ...bardicEffect('b1', '2024', 'd10'), off: true, turnsLeft: 2 };
    expect(stored()).toEqual([want]);
  });
});
