// @vitest-environment jsdom
// The condition strip (DS "Conditions"): the active conditions under the sheet
// header, each opening what it does and removable, and the picker behind
// "+ Condition". Focus never drops to the page when a chip it was on goes.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { namelessControls } from '../../../tests-fixtures/a11y';
import { ConditionStrip } from './ConditionStrip';

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

/** The strip over a character held in state, as the session store holds it. */
function renderStrip(conditions: Conditions, { addable = false } = {}) {
  function Harness() {
    const [doc, setDoc] = useState(() => {
      const d = newCharacterDoc('c1', 'Hero', 't');
      d.rulesVersion = '2024';
      d.play.conditions = conditions;
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
        <p>HP {doc.play.currentHp ?? 'unset'}</p>
        <ConditionStrip doc={doc} update={update} addable={addable} />
      </>
    );
  }
  render(<Harness />);
}

const button = (name: string) => screen.getByRole('button', { name });
const strip = () => within(screen.getByRole('list', { name: 'Active conditions' }));
const closeSheet = async () => {
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
};

describe('the condition strip', () => {
  it('is not there with nothing active, except for the add chip on Play', () => {
    renderStrip([]);
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Condition' })).toBeNull();
    cleanup();

    renderStrip([], { addable: true });
    expect(screen.queryByRole('list')).toBeNull();
    expect(button('Condition').getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('lists what is active, exhaustion at its level, with the add chip after the list', () => {
    renderStrip([{ id: 'Poisoned' }, { id: 'Exhaustion', level: 2 }]);
    const names = strip()
      .getAllByRole('button')
      .map((b) => b.textContent || b.getAttribute('aria-label'));
    expect(names).toEqual(['Poisoned', 'Remove Poisoned', 'Exhausted 2', 'Remove Exhaustion']);
    // The add chip is no active condition, so it is outside the list.
    expect(strip().queryByRole('button', { name: 'Condition' })).toBeNull();
    expect(button('Condition')).toBeTruthy();
  });

  it('removes a condition, focus going to the chip in its place, then the one before, then the title', () => {
    renderStrip([{ id: 'Poisoned' }, { id: 'Prone' }, { id: 'Blinded' }]);
    fireEvent.click(button('Remove Poisoned'));
    expect(document.activeElement).toBe(button('Remove Prone'));
    fireEvent.click(button('Remove Blinded'));
    expect(document.activeElement).toBe(button('Remove Prone'));
    fireEvent.click(button('Remove Prone'));
    // Off Play the strip goes with its last chip, so the title takes focus.
    expect(screen.queryByRole('list')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Hero' }));
  });

  it('puts focus on the add chip once the last condition goes, on Play', () => {
    renderStrip([{ id: 'Poisoned' }], { addable: true });
    fireEvent.click(button('Remove Poisoned'));
    expect(document.activeElement).toBe(button('Condition'));
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
    renderStrip([{ id: 'Exhaustion', level: 1 }], { addable: true });
    fireEvent.click(button('Exhausted 1'));
    const sheet = within(await screen.findByRole('dialog', { name: 'Exhaustion' }));
    expect(sheet.getByText('Exhaustion, as printed in 2024.')).toBeTruthy();
    fireEvent.click(sheet.getByRole('button', { name: 'Decrease exhaustion' }));
    expect(screen.queryByRole('list')).toBeNull();
    expect(sheet.getByText('0 / 6')).toBeTruthy();
    await closeSheet();
    // Its chip is gone, so focus goes to the add chip.
    await waitFor(() => expect(document.activeElement).toBe(button('Condition')));
  });
});

describe('exhaustion at its limits', () => {
  it('keeps its stepper buttons focusable at 0 and 6, saying they go no further', async () => {
    renderStrip([{ id: 'Exhaustion', level: 5 }], { addable: true });
    fireEvent.click(button('Condition'));
    const picker = within(await screen.findByRole('dialog', { name: 'Conditions' }));
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

describe('the condition picker', () => {
  it('holds every condition as a toggle that says whether it is on, and the exhaustion stepper', async () => {
    renderStrip([{ id: 'Poisoned' }], { addable: true });
    fireEvent.click(button('Condition'));
    const picker = within(await screen.findByRole('dialog', { name: 'Conditions' }));
    expect(picker.getAllByRole('button', { pressed: false })).toHaveLength(13);
    expect(picker.getByRole('button', { name: 'Poisoned', pressed: true })).toBeTruthy();
    expect(picker.getByRole('button', { name: 'Blinded', pressed: false })).toBeTruthy();

    fireEvent.click(picker.getByRole('button', { name: 'Blinded' }));
    expect(picker.getByRole('button', { name: 'Blinded', pressed: true })).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Poisoned' }));
    fireEvent.click(picker.getByRole('button', { name: 'Increase exhaustion' }));
    // The strip follows at once, behind the sheet (which hides it from the
    // accessibility tree while it is open, hence `hidden`).
    const behind = within(screen.getByRole('list', { name: 'Active conditions', hidden: true }));
    expect(
      behind
        .getAllByRole('button', { name: /^Remove /, hidden: true })
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Remove Blinded', 'Remove Exhaustion']);
    expect(behind.getByRole('button', { name: 'Exhausted 1', hidden: true })).toBeTruthy();

    await closeSheet();
    await waitFor(() => expect(document.activeElement).toBe(button('Condition')));
  });

  it("names every control, Stunned's included, on the strip and in the picker", async () => {
    renderStrip([{ id: 'Stunned' }], { addable: true });
    expect(namelessControls()).toEqual([]);
    expect(button('Stunned').getAttribute('aria-haspopup')).toBe('dialog');
    expect(button('Remove Stunned')).toBeTruthy();
    fireEvent.click(button('Condition'));
    await screen.findByRole('dialog', { name: 'Conditions' });
    expect(namelessControls()).toEqual([]);
  });
});
