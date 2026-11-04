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
const ignoreOnce = (rolls: string) =>
  screen.getAllByRole('button', { name: `Ignore once: your next ${rolls} without these effects` });

describe('the cue on the Stats tab', () => {
  it('says what Poisoned does to checks, and rolls them with disadvantage', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned' }]);
    // Above the abilities and above the skills, each where its rolls start.
    expect(screen.getAllByText('Disadvantage: Poisoned')).toHaveLength(2);
    expect(namelessControls()).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: /^Roll STR check/ }));
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

    fireEvent.click(screen.getByRole('button', { name: /Athletics/ }));
    expect(latest()?.meta?.advantage).toBeUndefined();
    expect(latest()?.meta?.cue).toBe('Conditions ignored for this roll');
    expect(abilities.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /Athletics/ }));
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
    fireEvent.click(within(saves).getByRole('button', { name: /^DEX/ }));
    expect(latest()?.meta).toMatchObject({ autoFail: true });
    // The toast says it fails, and never celebrates the die.
    expect(screen.getByText('Fails')).toBeTruthy();
    expect(screen.queryByText('Natural 20!')).toBeNull();
    fireEvent.click(within(saves).getByRole('button', { name: /^WIS/ }));
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
    fireEvent.click(within(saves).getByRole('button', { name: /^WIS/ }));
    expect(ignore.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(saves).getByRole('button', { name: /^DEX/ }));
    expect(latest()?.meta?.advantage).toBeUndefined();
    expect(latest()?.meta?.cue).toBe('Conditions ignored for this roll');
    expect(ignore.getAttribute('aria-pressed')).toBe('false');
  });

  it("takes 2024 exhaustion's penalty off every check", () => {
    renderTab(<StatsTab />, [{ id: 'Exhaustion', level: 2 }], '2024');
    expect(screen.getAllByText('−4: Exhaustion 2').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: /^Roll WIS check/ }));
    expect(latest()?.expr).toBe('1d20+0-4');
  });

  it('shows nothing for a condition whose effects are switched off', () => {
    renderTab(<StatsTab />, [{ id: 'Poisoned', ignored: true }]);
    expect(screen.queryByText(/Poisoned/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Roll STR check/ }));
    expect(latest()?.meta?.advantage).toBeUndefined();
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
    fireEvent.click(chip);
    expect(latest()?.meta).toMatchObject({ advantage: 'dis', cue: 'Disadvantage: Prone' });

    fireEvent.click(ignoreOnce('attack roll')[0] as HTMLElement);
    fireEvent.click(chip);
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
    fireEvent.click(screen.getByRole('button', { name: /Initiative/ }));
    expect(latest()?.meta).toMatchObject({ advantage: 'adv', cue: 'Advantage: Invisible' });
  });

  it('halves the 2014 hit point maximum at exhaustion 4', () => {
    const sheet = renderTab(<PlayTab />, [{ id: 'Exhaustion', level: 4 }]);
    const half = Math.floor(sheet.maxHp.value / 2);
    expect(screen.getByText(`/ ${half}`)).toBeTruthy();
    expect(screen.getByText('· max halved')).toBeTruthy();
    // Current HP above the halved maximum is never cut silently.
    expect(screen.getByRole('alert').textContent).toMatch(
      new RegExp(`Current HP: ${sheet.maxHp.value} → max ${half}`),
    );
  });

  it('cancels the dock’s advantage against a condition, and says so', () => {
    act(() => advModeStore.getState().set('adv'));
    renderTab(<PlayTab />, [{ id: 'Poisoned' }]);
    fireEvent.click(screen.getByRole('button', { name: /Initiative/ }));
    expect(latest()?.meta?.advantage).toBeUndefined();
    expect(latest()?.meta?.cue).toBe('Advantage and disadvantage cancel: Poisoned');
  });
});
