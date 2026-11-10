// @vitest-environment jsdom
// Conditions change the rolls they reach, with a cue where each roll starts
// and an "Ignore once" that makes the next roll without them (FUTURE_WORK
// "Condition effects"). The rules are the engine's; this is what a player sees.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { advModeStore } from '@/stores/advMode';
import { rollLogStore } from '@/stores/rollLog';
import { RollToast } from '@/ui/RollToast';
import { namelessControls } from '../../../../tests-fixtures/a11y';
import { makeTestContext } from '../../../../tests-fixtures/testWorld';
import type { CharacterSheetState } from '../useCharacterSheet';
import { Component as PlayTab } from './PlayTab';
import { Component as StatsTab } from './StatsTab';

vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => makeTestContext(),
  useRegistryRefreshing: () => false,
  useTypePacks: () => ({
    status: 'ready',
    error: null,
    offline: false,
    retry: () => undefined,
    repair: () => undefined,
  }),
}));

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

afterEach(() => {
  cleanup();
  rollLogStore.getState().clear();
  advModeStore.getState().set('normal');
});

/** A level-3 Warrior under `conditions`, on one tab, with the roll toast mounted. */
function renderTab(
  tab: ReactElement,
  conditions: CharacterDoc['play']['conditions'],
  edition: CharacterDoc['rulesVersion'] = '2014',
) {
  const doc = newCharacterDoc('c1', 'Hero', 't');
  doc.rulesVersion = edition;
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  const sheet = deriveSheet(doc, makeTestContext());
  doc.play.currentHp = sheet.maxHp.value;
  doc.play.hpInitialized = true;
  doc.play.conditions = conditions;
  const context = { doc, sheet, update: () => undefined } as unknown as CharacterSheetState;
  const router = createMemoryRouter([
    {
      path: '/',
      element: (
        <>
          <Outlet context={context} />
          <RollToast />
        </>
      ),
      children: [{ index: true, element: tab }],
    },
  ]);
  render(<RouterProvider router={router} />);
  return sheet;
}

const latest = () => rollLogStore.getState().rolls[0];
/** A d20 roll from the sheet: the control opens the roll prompt, and tapped again rolls it. */
const rollOn = (el: HTMLElement) => {
  fireEvent.click(el);
  fireEvent.click(el);
};
const ignoreOnce = (rolls: string) =>
  screen.getAllByRole('button', { name: `Ignore once: your next ${rolls} without these effects` });

describe('the cue on the Stats tab', () => {
  it('says what Poisoned does to checks, and rolls them with disadvantage', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned' }]);
    // Above the abilities and above the skills, each where its rolls start.
    expect(screen.getAllByText('Disadvantage: Poisoned')).toHaveLength(2);
    expect(namelessControls()).toEqual([]);

    rollOn(screen.getByRole('button', { name: /^Roll STR check/ }));
    expect(latest()?.meta).toMatchObject({ advantage: 'dis', cue: 'Disadvantage: Poisoned' });
    expect(latest()?.terms[0]).toMatchObject({ sides: 20 });
    expect((latest()?.terms[0] as { rolls: unknown[] }).rolls).toHaveLength(2);
    // The roll's result says it too, where the player looks.
    expect(screen.getAllByText('Disadvantage: Poisoned')).toHaveLength(3);
  });

  it('makes the next check plain with Ignore once, then lets go', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned' }]);
    const [abilities, skills] = ignoreOnce('ability check');
    if (abilities === undefined || skills === undefined) throw new Error('no cue buttons');
    fireEvent.click(abilities);
    // One override for the group: both cues show it pressed.
    expect(abilities.getAttribute('aria-pressed')).toBe('true');
    expect(skills.getAttribute('aria-pressed')).toBe('true');

    rollOn(screen.getByRole('button', { name: /Athletics/ }));
    expect(latest()?.meta?.advantage).toBeUndefined();
    expect(latest()?.meta?.cue).toBe('Conditions ignored for this roll');
    expect(abilities.getAttribute('aria-pressed')).toBe('false');

    rollOn(screen.getByRole('button', { name: /Athletics/ }));
    expect(latest()?.meta?.advantage).toBe('dis');
  });

  it('leaves saves alone under Poisoned, and fails STR and DEX saves under Stunned', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned' }]);
    expect(screen.queryAllByRole('button', { name: /next save/ })).toEqual([]);
    cleanup();

    renderTab(<StatsTab />, [{ id: 'Stunned' }]);
    expect(screen.getByText('STR and DEX saves fail automatically: Stunned')).toBeTruthy();
    const saves = screen.getByRole('heading', { name: 'Saving throws' }).parentElement;
    if (saves === null) throw new Error('no saves section');
    rollOn(within(saves).getByRole('button', { name: /^DEX/ }));
    expect(latest()?.meta).toMatchObject({ autoFail: true });
    // The toast says it fails, and never celebrates the die.
    expect(screen.getByText('Fails')).toBeTruthy();
    expect(screen.queryByText('Natural 20!')).toBeNull();
    rollOn(within(saves).getByRole('button', { name: /^WIS/ }));
    expect(latest()?.meta?.autoFail).toBeUndefined();
  });

  it('keeps Ignore once for the save a condition reaches, past one it does not', () => {
    renderTab(<StatsTab />, [{ id: 'Restrained' }]);
    const saves = screen.getByRole('heading', { name: 'Saving throws' }).parentElement;
    if (saves === null) throw new Error('no saves section');
    const [ignore] = ignoreOnce('save');
    if (ignore === undefined) throw new Error('no save cue button');
    fireEvent.click(ignore);
    // WIS saves are untouched by Restrained, so the override waits.
    rollOn(within(saves).getByRole('button', { name: /^WIS/ }));
    expect(ignore.getAttribute('aria-pressed')).toBe('true');
    rollOn(within(saves).getByRole('button', { name: /^DEX/ }));
    expect(latest()?.meta?.advantage).toBeUndefined();
    expect(latest()?.meta?.cue).toBe('Conditions ignored for this roll');
    expect(ignore.getAttribute('aria-pressed')).toBe('false');
  });

  it("takes 2024 exhaustion's penalty off every check", () => {
    renderTab(<StatsTab />, [{ id: 'Exhaustion', level: 2 }], '2024');
    expect(screen.getAllByText('−4: Exhaustion 2').length).toBeGreaterThan(0);
    rollOn(screen.getByRole('button', { name: /^Roll WIS check/ }));
    expect(latest()?.expr).toBe('1d20+0-4');
  });

  it('shows nothing for a condition whose effects are switched off', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned', ignored: true }]);
    expect(screen.queryByText(/Poisoned/)).toBeNull();
    rollOn(screen.getByRole('button', { name: /^Roll STR check/ }));
    expect(latest()?.label).toBe('STR check');
    expect(latest()?.meta?.advantage).toBeUndefined();
  });
});

describe('the attack chips on the Play tab', () => {
  const attackChip = () => {
    const attacks = screen.getByRole('heading', { name: 'Attacks' }).parentElement;
    if (attacks === null) throw new Error('no attacks section');
    const chip = within(attacks).getAllByTitle(/ attack$/)[0];
    if (chip === undefined) throw new Error('no attack chip');
    return chip;
  };
  const looksOn = (chip: HTMLElement) =>
    [...(chip.querySelector('.cx')?.classList ?? [])].filter((c) => !c.startsWith('cx-on'));

  it('wear what the cue says, at rest on arriving at the tab', () => {
    renderTab(<PlayTab />, [{ id: 'Poisoned' }]);
    const chip = attackChip();
    expect(looksOn(chip)).toEqual(['cx', 'cx-poisoned']);
    expect(chip.querySelector('.cx-liquid')).not.toBeNull();
  });

  it('are plain blue on the same face with no condition on them', () => {
    renderTab(<PlayTab />, []);
    const chip = attackChip();
    expect(looksOn(chip)).toEqual(['cx']);
    expect(chip.querySelector('.cx-mat')).toBeNull();
  });

  it('wear a condition that only stops actions, and still roll', () => {
    renderTab(<PlayTab />, [{ id: 'Paralyzed' }]);
    const chip = attackChip();
    expect(looksOn(chip)).toEqual(['cx', 'cx-paralyzed']);
    rollOn(chip);
    expect(latest()).toBeDefined();
  });

  it('go plain with a ring when Ignore once is armed, for the one roll', () => {
    renderTab(<PlayTab />, [{ id: 'Prone' }]);
    const chip = attackChip();
    fireEvent.click(ignoreOnce('attack roll')[0] as HTMLElement);
    expect(chip.querySelector('.cx')?.classList.contains('cx-ig')).toBe(true);
    expect(chip.querySelector('.cx-ignore-ring')).not.toBeNull();

    rollOn(chip);
    expect(latest()?.meta?.cue).toBe('Conditions ignored for this roll');
    // Its total shows on the plain chip it was rolled from.
    expect(chip.querySelector('.cx')?.classList.contains('cx-ig')).toBe(true);
  });

  it('never touch the damage chips beside them', () => {
    renderTab(<PlayTab />, [{ id: 'Poisoned' }]);
    const damage = screen.getAllByTitle(/ damage$/);
    expect(damage.length).toBeGreaterThan(0);
    for (const chip of damage) expect(chip.querySelector('.cx')).toBeNull();
  });
});

describe('what a condition wears on the Stats tab', () => {
  const saveButton = (name: RegExp) => {
    const saves = screen.getByRole('heading', { name: 'Saving throws' }).parentElement;
    if (saves === null) throw new Error('no saves section');
    return within(saves).getByRole('button', { name });
  };
  const checkButton = (name: string) =>
    screen.getByRole('button', { name: new RegExp(`^Roll ${name} check`) });
  /** The look on a control, with the tile a check button sits in. */
  const wornOn = (control: Element) => {
    const root = control.closest('.cx') ?? control.querySelector('.cx');
    if (root === null) throw new Error('nothing that can wear a look');
    return root;
  };
  const skillsCard = () => wornOn(screen.getByRole('button', { name: /Athletics/ }));

  it('wears Paralyzed on the saves it fails, and leaves the rest plain', () => {
    renderTab(<StatsTab />, [{ id: 'Paralyzed' }]);
    for (const save of [/^STR/, /^DEX/]) {
      expect(wornOn(saveButton(save)).className).toContain('cx-paralyzed');
    }
    for (const save of [/^CON/, /^INT/, /^WIS/, /^CHA/]) {
      expect(wornOn(saveButton(save)).className).not.toContain('cx-on');
    }
    // It does nothing to a check.
    expect(wornOn(checkButton('STR')).className).not.toContain('cx-on');
    expect(skillsCard().className).not.toContain('cx-on');
  });

  it('flashes a save it reaches as the roll lands, and not one it does not', () => {
    renderTab(<StatsTab />, [{ id: 'Restrained' }]);
    rollOn(saveButton(/^WIS/));
    expect(wornOn(saveButton(/^WIS/)).querySelector('.cx-surge')).toBeNull();
    rollOn(saveButton(/^DEX/));
    expect(wornOn(saveButton(/^DEX/)).querySelector('.cx-surge')).not.toBeNull();
    expect(wornOn(saveButton(/^DEX/)).querySelector('.cx-chain')).not.toBeNull();
  });

  it('goes plain with a ring on the save Ignore once reaches', () => {
    renderTab(<StatsTab />, [{ id: 'Restrained' }]);
    fireEvent.click(ignoreOnce('save')[0] as HTMLElement);
    expect(wornOn(saveButton(/^DEX/)).className).toContain('cx-ig');
    expect(wornOn(saveButton(/^WIS/)).className).not.toContain('cx-ig');
  });

  it('wears Poisoned on every tile and the whole Skills card, and on no save', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned' }]);
    for (const ability of ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA']) {
      const tile = wornOn(checkButton(ability));
      expect(tile.className, ability).toContain('cx-at-tile');
      expect(tile.className, ability).toContain('cx-poisoned');
    }
    expect(skillsCard().className).toContain('cx-at-card');
    expect(skillsCard().className).toContain('cx-poisoned');
    expect(skillsCard().querySelectorAll('.cx-strip')).toHaveLength(1);
    expect(wornOn(saveButton(/^STR/)).className).not.toContain('cx-on');
    expect(namelessControls()).toEqual([]);
  });

  it('flashes the tile it rolled from, and the Skills strip for any skill', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned' }]);
    rollOn(checkButton('STR'));
    expect(wornOn(checkButton('STR')).querySelector('.cx-surge')).not.toBeNull();
    expect(wornOn(checkButton('DEX')).querySelector('.cx-surge')).toBeNull();
    rollOn(screen.getByRole('button', { name: /Stealth/ }));
    expect(skillsCard().querySelector('.cx-strip .cx-surge')).not.toBeNull();
  });

  it('moves only a tile’s number under Frightened', () => {
    renderTab(<StatsTab />, [{ id: 'Frightened' }]);
    const button = checkButton('STR');
    expect(button.querySelector('.cx-move')?.textContent).toBe(button.textContent);
    expect(wornOn(button).querySelector('.cx-face')?.className).toContain('cx-body-cower');
  });

  it('clears the tiles and the card together with the checks’ one Ignore once', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned' }]);
    fireEvent.click(ignoreOnce('ability check')[0] as HTMLElement);
    expect(wornOn(checkButton('STR')).className).toContain('cx-ig');
    expect(skillsCard().className).toContain('cx-ig');
    // Nothing moves in the strip, which keeps its place so no skill moves either.
    expect(skillsCard().querySelector('.cx-strip')?.childElementCount).toBe(0);
  });

  it('leaves Blinded and Deafened to their notes on checks', () => {
    renderTab(<StatsTab />, [{ id: 'Blinded' }]);
    expect(wornOn(checkButton('STR')).className).not.toContain('cx-on');
    expect(skillsCard().className).not.toContain('cx-on');
  });

  it('tags 2024 exhaustion on each tile, each save, and the Skills strip', () => {
    renderTab(<StatsTab />, [{ id: 'Exhaustion', level: 2 }], '2024');
    expect(wornOn(checkButton('STR')).querySelector('.cx-tag')?.textContent).toBe('−4');
    expect(wornOn(saveButton(/^WIS/)).querySelector('.cx-tag')?.textContent).toBe('−4');
    expect(skillsCard().querySelector('.cx-strip .cx-tag')?.textContent).toBe('−4');
  });
});

describe('what a condition wears on the Play tab’s strip', () => {
  const initiative = () => screen.getByRole('button', { name: /Initiative/ });
  const speedCell = () => {
    const speed = screen.getByText('Speed', { exact: false }).closest('.cx');
    if (speed === null) throw new Error('no Speed cell');
    return speed;
  };
  const worn = () => initiative().querySelector('.cx')?.className;

  it('wears Initiative by the edition', () => {
    renderTab(<PlayTab />, [{ id: 'Paralyzed' }]);
    expect(worn()).not.toContain('cx-on');
    expect(speedCell().className).toContain('cx-paralyzed');
    cleanup();
    renderTab(<PlayTab />, [{ id: 'Paralyzed' }], '2024');
    expect(worn()).toContain('cx-paralyzed');
    cleanup();
    renderTab(<PlayTab />, [{ id: 'Invisible' }], '2024');
    expect(worn()).toContain('cx-invisible');
  });

  it('flashes Initiative as the roll lands, and tags 2024 exhaustion on it', () => {
    renderTab(<PlayTab />, [{ id: 'Exhaustion', level: 1 }], '2024');
    expect(initiative().querySelector('.cx-tag')?.textContent).toBe('−2');
    rollOn(initiative());
    expect(initiative().querySelector('.cx-surge')).not.toBeNull();
  });

  it('wears Grappled on Speed alone, as wrap claws', () => {
    renderTab(<PlayTab />, [{ id: 'Grappled' }]);
    expect(speedCell().className).toContain('cx-grappled');
    expect(speedCell().querySelectorAll('.cx-prong')).toHaveLength(4);
    expect(worn()).not.toContain('cx-on');
    const chip = screen.getAllByTitle(/ attack$/)[0];
    expect(chip?.querySelector('.cx')?.className).not.toContain('cx-grappled');
  });

  it('gives Speed no tag, and no flash from the roll beside it', () => {
    renderTab(<PlayTab />, [{ id: 'Exhaustion', level: 2 }], '2024');
    expect(speedCell().className).toContain('cx-exhaustion');
    expect(speedCell().querySelector('.cx-tag')).toBeNull();
    rollOn(initiative());
    expect(initiative().querySelector('.cx-surge')).not.toBeNull();
    expect(speedCell().querySelector('.cx-surge')).toBeNull();
  });

  it('leaves Speed plain under exhaustion that has not lowered it', () => {
    renderTab(<PlayTab />, [{ id: 'Exhaustion', level: 1 }]);
    expect(speedCell().className).not.toContain('cx-on');
  });
});

describe('the cues on the Play tab', () => {
  it('rolls attacks with Prone’s disadvantage, said over the attack list', () => {
    renderTab(<PlayTab />, [{ id: 'Prone' }]);
    const attacks = screen.getByRole('heading', { name: 'Attacks' }).parentElement;
    if (attacks === null) throw new Error('no attacks section');
    expect(within(attacks).getByText('Disadvantage: Prone')).toBeTruthy();
    const chip = within(attacks).getAllByTitle(/ attack$/)[0];
    if (chip === undefined) throw new Error('no attack chip');
    rollOn(chip);
    expect(latest()?.meta).toMatchObject({ advantage: 'dis', cue: 'Disadvantage: Prone' });

    fireEvent.click(ignoreOnce('attack roll')[0] as HTMLElement);
    rollOn(chip);
    expect(latest()?.meta?.advantage).toBeUndefined();
  });

  it('says what Prone means for attacks against the character, as information', () => {
    renderTab(<PlayTab />, [{ id: 'Prone' }]);
    const list = screen.getByRole('list', { name: 'Attacks against you' });
    expect(list.textContent).toBe(
      'Attack rolls against you have advantage within 5 ft, disadvantage beyond: Prone',
    );
  });

  it('sets speed to 0 under Grappled and names it', () => {
    renderTab(<PlayTab />, [{ id: 'Grappled' }]);
    expect(screen.getByText('· Grappled')).toBeTruthy();
    expect(screen.getByText(', down from')).toBeTruthy();
  });

  it('rolls initiative with 2024 Invisible’s advantage', () => {
    renderTab(<PlayTab />, [{ id: 'Invisible' }], '2024');
    // The cue under the stat strip, headed for the roll it is about.
    expect(screen.getAllByText('Initiative')).toHaveLength(2);
    // Under the strip for initiative, over the attacks for attack rolls.
    expect(screen.getAllByText('Advantage: Invisible')).toHaveLength(2);
    rollOn(screen.getByRole('button', { name: /Initiative/ }));
    expect(latest()?.meta).toMatchObject({ advantage: 'adv', cue: 'Advantage: Invisible' });
  });

  it('halves the 2014 hit point maximum at exhaustion 4', () => {
    const sheet = renderTab(<PlayTab />, [{ id: 'Exhaustion', level: 4 }]);
    const half = Math.floor(sheet.maxHp.value / 2);
    expect(screen.getByText(`/ ${half}`)).toBeTruthy();
    expect(screen.getByText('max halved')).toBeTruthy();
    // Current HP above the halved maximum is never cut silently.
    expect(screen.getByRole('alert').textContent).toMatch(
      new RegExp(`Current HP: ${sheet.maxHp.value} → max ${half}`),
    );
  });

  it('cancels the dock’s advantage against a condition, and says so', () => {
    act(() => advModeStore.getState().set('adv'));
    renderTab(<PlayTab />, [{ id: 'Poisoned' }]);
    rollOn(screen.getByRole('button', { name: /Initiative/ }));
    expect(latest()?.meta?.advantage).toBeUndefined();
    expect(latest()?.meta?.cue).toBe('Advantage and disadvantage cancel: Poisoned');
  });
});
