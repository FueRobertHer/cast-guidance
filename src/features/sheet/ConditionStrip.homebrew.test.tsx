// @vitest-environment jsdom
/**
 * Homebrew in the condition strip (Workshop phase 7): a homebrew condition is
 * offered beside the built-in ones and says what it does, and + Effect finds a
 * homebrew spell that puts an effect on a target.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type ActiveEffect,
  type CharacterDoc,
  type DerivedSheet,
  newCharacterDoc,
} from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { ConditionStrip } from './ConditionStrip';

vi.mock('@/data5e/hooks', () => {
  const data: Record<string, unknown[]> = {
    condition: [
      { name: 'Poisoned', source: 'XPHB', entries: ['Official text.'] },
      {
        name: 'Dazed',
        source: 'MyHomebrew',
        entries: ['You reel from the blow.'],
        castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: -2 }] },
      },
      { name: 'Awed', source: 'MyHomebrew', entries: ['You stare.'] },
      { name: 'dazed', source: 'Other', entries: [] },
    ],
    spell: [
      {
        name: 'Valor Hymn',
        source: 'MyHomebrew',
        level: 1,
        range: { type: 'point', distance: { type: 'feet', amount: 30 } },
        duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
        entries: ['You sing, and your allies grow braver.'],
        castGuidance: {
          v: 1,
          effects: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'] } }],
        },
      },
    ],
  };
  const registry = { byType: (type: string) => data[type] ?? [] };
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

const sheet = {
  conditionImmunities: [],
  maxHp: { value: 20, base: 20, parts: [], overridden: false },
  attacks: [],
  actions: [],
  grantedSpells: [],
} as unknown as DerivedSheet;

function renderStrip() {
  function Harness() {
    const [doc, setDoc] = useState(() => {
      const d = newCharacterDoc('c1', 'Hero', 't');
      d.rulesVersion = '2024';
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
        <output data-testid="play">{JSON.stringify(doc.play)}</output>
        <ConditionStrip doc={doc} sheet={sheet} update={update} tab="" />
      </>
    );
  }
  render(<Harness />);
}

const play = () =>
  JSON.parse(screen.getByTestId('play').textContent ?? '{}') as CharacterDoc['play'];
const openPicker = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add an effect' }));
  return within(await screen.findByRole('dialog', { name: 'Effects' }));
};

describe('homebrew in the condition strip', () => {
  it('offers homebrew conditions after the built-in ones, once each', async () => {
    renderStrip();
    const picker = await openPicker();
    const names = picker
      .getAllByRole('button')
      .map((b) => b.textContent)
      .filter((t) => t === 'Unconscious' || t === 'Awed' || t === 'Dazed' || t === 'dazed');
    expect(names).toEqual(['Unconscious', 'Awed', 'Dazed']);
    fireEvent.click(picker.getByRole('button', { name: 'Dazed' }));
    expect(play().conditions).toEqual([{ id: 'Dazed' }]);
  });

  it('says what a homebrew condition does on the sheet, and its text', async () => {
    renderStrip();
    const picker = await openPicker();
    fireEvent.click(picker.getByRole('button', { name: 'Dazed' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const strip = within(screen.getByRole('list', { name: 'Active effects' }));
    fireEvent.click(strip.getByRole('button', { name: /^Dazed/ }));
    const info = within(await screen.findByRole('dialog', { name: 'Dazed' }));
    expect(info.getByText('−2 to AC')).toBeTruthy();
    expect(info.getByText('You reel from the blow.')).toBeTruthy();
  });

  it('finds a homebrew spell under + Effect, and lands what it puts on a target', async () => {
    renderStrip();
    const picker = await openPicker();
    fireEvent.change(picker.getByRole('searchbox', { name: 'Search effects' }), {
      target: { value: 'valor' },
    });
    const list = within(await picker.findByRole('list', { name: 'Effects found' }));
    fireEvent.click(list.getByRole('button', { name: /^Valor Hymn\b/ }));
    expect(picker.getByText('Spell, 1st level. Concentration, up to 1 minute.')).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));
    expect((play().activeEffects ?? []).map(({ id: _, ...rest }: ActiveEffect) => rest)).toEqual([
      {
        name: 'Valor Hymn',
        parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack'] } }],
        lasts: { minutes: 1, concentration: true },
      },
    ]);
  });
});
