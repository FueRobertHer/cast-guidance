// @vitest-environment jsdom
/**
 * Describe an effect, under + Effect (the buffs canvas, Catalog board): what
 * the search does not find is described in parts, lands with its numbers, and
 * can be kept for the search next time.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, type DerivedSheet, newCharacterDoc } from '@/engine/types';
import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import type { DocUpdater } from '@/stores/characterSession';
import { ConditionStrip } from './ConditionStrip';

vi.mock('@/data5e/hooks', () => ({ useRegistry: () => ({ byType: () => [] }) }));

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

const sheet = {
  conditionImmunities: [],
  maxHp: { value: 20, base: 20, parts: [], overridden: false },
  attacks: [],
  actions: [],
  grantedSpells: [],
} as unknown as DerivedSheet;

function renderStrip(setup: (d: CharacterDoc) => void = () => undefined) {
  function Harness() {
    const [doc, setDoc] = useState(() => {
      const d = newCharacterDoc('c1', 'Hero', 't');
      d.play.currentHp = 20;
      setup(d);
      return d;
    });
    const update = ((recipe: (draft: CharacterDoc) => void) =>
      setDoc((current) => {
        const next = structuredClone(current);
        recipe(next);
        return next;
      })) as DocUpdater;
    return (
      <>
        <h1 id="sheet-title" tabIndex={-1}>
          Hero
        </h1>
        <output data-testid="doc">{JSON.stringify(doc)}</output>
        <ConditionStrip doc={doc} sheet={sheet} update={update} addable />
      </>
    );
  }
  render(<Harness />);
}

const saved = () => JSON.parse(screen.getByTestId('doc').textContent ?? '{}') as CharacterDoc;
/** The effects in play as stored, without their ids (each a fresh random one). */
const stored = () => (saved().play.activeEffects ?? []).map(({ id: _, ...rest }) => rest);

type Scope = ReturnType<typeof within>;
const openPicker = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add an effect' }));
  return within(await screen.findByRole('dialog', { name: 'Effects' }));
};
const type = (picker: Scope, words: string) =>
  fireEvent.change(picker.getByRole('searchbox', { name: 'Search effects' }), {
    target: { value: words },
  });
/** Searches for words the catalog does not have, and opens their description. */
const describeFrom = async (picker: Scope, words: string) => {
  type(picker, words);
  fireEvent.click(await picker.findByRole('button', { name: `Describe “${words}”` }));
  const heading = await picker.findByRole('heading', { name: 'Describe an effect' });
  await waitFor(() => expect(document.activeElement).toBe(heading));
};
const addPart = (picker: Scope, kind: string) =>
  fireEvent.click(
    within(picker.getByRole('group', { name: 'Add what it does' })).getByRole('button', {
      name: kind,
    }),
  );
const part = (picker: Scope, title: string) => within(picker.getByRole('group', { name: title }));
const tap = (scope: Scope, group: string, name: string) =>
  fireEvent.click(within(scope.getByRole('group', { name: group })).getByRole('button', { name }));

describe('describing an effect', () => {
  it('describes what the search does not find, and lands it with its numbers', async () => {
    renderStrip();
    const picker = await openPicker();
    await describeFrom(picker, 'Ember blessing');
    expect((picker.getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe(
      'Ember blessing',
    );
    const add = () => picker.getByRole('button', { name: /^(Add to Hero|Say what it does)/ });
    expect(add().textContent).toBe('Say what it does to add it');
    expect((add() as HTMLButtonElement).disabled).toBe(true);

    addPart(picker, 'Raise a number');
    const raise = part(picker, 'Raise a number');
    // A part added takes focus, so a keyboard carries on in it.
    await waitFor(() =>
      expect(document.activeElement).toBe(raise.getByRole('button', { name: 'Armor Class' })),
    );
    tap(raise, 'Which numbers', 'Armor Class');
    fireEvent.click(raise.getByRole('button', { name: 'Raise the amount' }));
    addPart(picker, 'Cut damage');
    tap(part(picker, 'Cut damage'), 'Damage types', 'Cold');
    tap(picker, 'When it ends', 'A long rest');

    expect(picker.getByText('+2 to AC')).toBeTruthy();
    expect(picker.getByText('+2 to attack rolls')).toBeTruthy();
    expect(picker.getByText('Half cold damage')).toBeTruthy();
    expect(picker.getByText('Lasts until you finish a long rest.')).toBeTruthy();
    fireEvent.click(add());

    expect(stored()).toEqual([
      {
        name: 'Ember blessing',
        parts: [
          { kind: 'acBonus', amount: 2 },
          { kind: 'attackBonus', scope: 'all', amount: 2, attack: 'any' },
          { kind: 'resist', damageType: 'fire' },
          { kind: 'resist', damageType: 'cold' },
        ],
        lasts: { rest: 'long' },
      },
    ]);
    // Not kept, and the search starts over.
    expect(saved().keptEffects).toBeUndefined();
    expect(
      (picker.getByRole('searchbox', { name: 'Search effects' }) as HTMLInputElement).value,
    ).toBe('');
  });

  it('keeps one for the search, finds it next time, and forgets it', async () => {
    renderStrip();
    const picker = await openPicker();
    await describeFrom(picker, 'Ember blessing');
    addPart(picker, 'Cut damage');
    addPart(picker, 'Add hit points');
    fireEvent.click(
      picker.getByRole('checkbox', { name: 'Keep it in Hero’s search for next time' }),
    );
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));

    expect(saved().play.tempHp).toBe(5);
    expect(saved().keptEffects?.map(({ id: _, ...k }) => k)).toEqual([
      { name: 'Ember blessing', parts: [{ kind: 'resist', damageType: 'fire' }], tempHp: 5 },
    ]);

    type(picker, 'ember');
    const list = within(await picker.findByRole('list', { name: 'Effects found' }));
    fireEvent.click(list.getByRole('button', { name: /^Ember blessing/ }));
    expect(picker.getByText('Described for Hero. Until you end it.')).toBeTruthy();
    // One of its name is on already, so this one warns and is another.
    fireEvent.click(picker.getByRole('button', { name: 'Add another to Hero' }));
    expect(stored().map((e) => e.name)).toEqual(['Ember blessing', 'Ember blessing']);

    type(picker, 'ember');
    fireEvent.click(
      within(await picker.findByRole('list', { name: 'Effects found' })).getByRole('button', {
        name: /^Ember blessing/,
      }),
    );
    fireEvent.click(picker.getByRole('button', { name: 'Forget it' }));
    expect(saved().keptEffects).toBeUndefined();
    type(picker, 'ember');
    expect(await picker.findByText('Nothing called “ember” that can land on Hero.')).toBeTruthy();
  });

  it('makes a part narrowed to a moment a line, and offers a die that waits only on a d20', async () => {
    renderStrip();
    const picker = await openPicker();
    await describeFrom(picker, 'Wardstone');
    addPart(picker, 'Raise a number');
    const raise = part(picker, 'Raise a number');
    tap(raise, 'Which numbers', 'Attacks');
    tap(raise, 'Which numbers', 'Saves');
    fireEvent.change(raise.getByRole('textbox', { name: 'Only when' }), {
      target: { value: 'against undead' },
    });
    addPart(picker, 'Add a die');
    const die = part(picker, 'Add a die');
    tap(die, 'Added to', 'Damage');
    tap(die, 'When', 'Waits for you');
    // Damage rolls in with the hit, so a die that waits cannot be on it.
    expect(
      within(die.getByRole('group', { name: 'Added to' })).queryByRole('button', {
        name: 'Damage',
      }),
    ).toBeNull();
    // And it is dropped, not hidden: back to rolling in, Damage is not on.
    tap(die, 'When', 'Rolls in');
    expect(
      within(die.getByRole('group', { name: 'Added to' }))
        .getByRole('button', { name: 'Damage' })
        .getAttribute('aria-pressed'),
    ).toBe('false');
    tap(die, 'When', 'Waits for you');
    tap(die, 'Which die', 'd8');
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));

    expect(stored()).toEqual([
      {
        name: 'Wardstone',
        parts: [
          { kind: 'cue', tone: 'help', text: '+1 to every saving throw, only against undead' },
          { kind: 'rollOffer', dice: '1d8', on: { rolls: ['attack'] }, once: true },
        ],
      },
    ]);
  });

  it('starts from the lists with no name, and goes back to the words', async () => {
    renderStrip();
    const picker = await openPicker();
    fireEvent.click(picker.getByRole('button', { name: 'Describe an effect' }));
    await picker.findByRole('heading', { name: 'Describe an effect' });
    addPart(picker, 'Write a note');
    fireEvent.change(picker.getByRole('textbox', { name: 'The note' }), {
      target: { value: 'Glows faintly' },
    });
    expect(picker.getByRole('button', { name: 'Name it to add it' })).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'All effects' }));
    expect(picker.getByRole('heading', { name: 'Helping you' })).toBeTruthy();

    type(picker, 'Moonfall');
    await describeFrom(picker, 'Moonfall');
    fireEvent.click(picker.getByRole('button', { name: 'All effects' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        picker.getByRole('searchbox', { name: 'Search effects' }),
      ),
    );
    expect(
      (picker.getByRole('searchbox', { name: 'Search effects' }) as HTMLInputElement).value,
    ).toBe('Moonfall');
  });

  it('keeps focus on a stepper at its end, and in the sheet when a part goes', async () => {
    renderStrip();
    const picker = await openPicker();
    await describeFrom(picker, 'Ember blessing');
    addPart(picker, 'Add a die');
    const die = part(picker, 'Add a die');
    // Its first control is at its least, and still takes focus: it is only aria-disabled.
    const fewer = die.getByRole('button', { name: 'Lower the number of dice' });
    await waitFor(() => expect(document.activeElement).toBe(fewer));
    expect(fewer.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(die.getByRole('button', { name: 'Raise the number of dice' }));
    fewer.focus();
    fireEvent.click(fewer);
    expect(document.activeElement).toBe(fewer);
    expect(fewer.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(fewer);
    expect(die.getByText('1')).toBeTruthy();

    addPart(picker, 'Write a note');
    // The first goes, and the one now in its place takes focus, as a group.
    fireEvent.click(picker.getByRole('button', { name: 'Remove Add a die' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(picker.getByRole('group', { name: 'Write a note' })),
    );
    // The last goes, and focus goes to what can be added.
    fireEvent.click(picker.getByRole('button', { name: 'Remove Write a note' }));
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(picker.getByRole('group', { name: 'Add what it does' })).getByRole('button', {
          name: 'Raise a number',
        }),
      ),
    );
  });

  it('forgets a kept one beside a stored entry that is not one', async () => {
    renderStrip((d) => {
      d.keptEffects = [
        null,
        // Unreadable (no parts) under the same id: the search passes it over.
        { id: 'k1', name: 'Old' },
        { id: 'k1', name: 'Ember blessing', parts: [{ kind: 'acBonus', amount: 1 }] },
      ] as unknown as CharacterDoc['keptEffects'];
    });
    const picker = await openPicker();
    type(picker, 'ember');
    fireEvent.click(
      within(await picker.findByRole('list', { name: 'Effects found' })).getByRole('button', {
        name: /^Ember blessing/,
      }),
    );
    // Earlier tests forget an Ember blessing too.
    resetAnnouncer();
    fireEvent.click(picker.getByRole('button', { name: 'Forget it' }));
    expect(saved().keptEffects).toEqual([null]);
    // Said by the name the search showed.
    await waitFor(() =>
      expect(getAnnouncerState().messages.map((m) => m.text)).toContain('Ember blessing forgotten'),
    );
  });
});
