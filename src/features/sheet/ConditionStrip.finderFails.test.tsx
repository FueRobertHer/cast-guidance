// @vitest-environment jsdom
/**
 * The tab's own effects come from the search's chunk, which now loads as the
 * Effects sheet opens. One that fails, loading (offline before it was cached,
 * or a deploy that replaced it) or drawing, fails in its own place: the
 * conditions and the starters under it still work. A failed lazy import is
 * thrown where the component renders, so a finder that throws as it draws
 * stands in for one: here, given a sheet with none of what it reads.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { type CharacterDoc, type DerivedSheet, newCharacterDoc } from '@/engine/types';
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

/** What the strip reads, and none of what the finder does: its actions, attacks or spells. */
const sheet = {
  conditionImmunities: [],
  maxHp: { value: 20, base: 20, parts: [], overridden: false },
} as unknown as DerivedSheet;

function Harness() {
  const [doc, setDoc] = useState(() => newCharacterDoc('c1', 'Hero', 't'));
  const update = ((recipe: (draft: CharacterDoc) => void) =>
    setDoc((current) => {
      const next = structuredClone(current);
      recipe(next);
      return next;
    })) as DocUpdater;
  return <ConditionStrip doc={doc} sheet={sheet} update={update} tab="inventory" />;
}

describe('a search chunk that fails to load', () => {
  it("fails in the tab's list, and the conditions still work", async () => {
    // React reports the caught error; it is the point of the test.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      render(<Harness />);
      fireEvent.click(screen.getByRole('button', { name: 'Add an effect' }));
      const picker = within(await screen.findByRole('dialog', { name: 'Effects' }));
      expect(await picker.findByText(/^This tab's list of effects could not be read/)).toBeTruthy();
      fireEvent.click(picker.getByRole('button', { name: 'Prone' }));
      expect(picker.getByRole('button', { name: 'Prone', pressed: true })).toBeTruthy();
      expect(
        within(screen.getByRole('list', { name: 'Active effects', hidden: true })).getByRole(
          'button',
          {
            name: 'Prone',
            hidden: true,
          },
        ),
      ).toBeTruthy();
    } finally {
      quiet.mockRestore();
    }
  });
});
