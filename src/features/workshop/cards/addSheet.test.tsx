// @vitest-environment jsdom
// The Add an effect sheet (ADR-002, D6, board 4): More opens a sheet that
// searches by what a kind does, lists kinds under their file's group, and
// offers a reminder when nothing does what was typed.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DialogHost } from '@/ui/dialogs';
import { EffectCards, moreKinds } from '../EffectCards';
import { cards as abilities, group as abilitiesGroup } from './abilities';
import { cards as actions, group as actionsGroup } from './actions';
import { cards as attacks, group as attacksGroup } from './attacks';
import { cards as defenses, group as defensesGroup } from './defenses';
import type { Eff, KindSpec } from './kit/types';
import { cards as movement, group as movementGroup } from './movement';
import { cards as rolls, group as rollsGroup } from './rolls';
import { cards as spells, group as spellsGroup } from './spells';
import { cards as words, group as wordsGroup } from './words';

// jsdom has no matchMedia and the drawer asks for one on mount.
beforeAll(() => {
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

// The sheet's request outlives a render: one left open is dismissed, as Escape does.
afterEach(async () => {
  const open = screen.queryByRole('dialog');
  if (open !== null) {
    await act(async () => {
      fireEvent.keyDown(open, { key: 'Escape' });
    });
  }
  cleanup();
});

const FILES: ReadonlyArray<readonly [string, readonly KindSpec[]]> = [
  [abilitiesGroup, abilities],
  [defensesGroup, defenses],
  [movementGroup, movement],
  [attacksGroup, attacks],
  [spellsGroup, spells],
  [rollsGroup, rolls],
  [actionsGroup, actions],
  [wordsGroup, words],
];

let written: Eff[] = [];

function List({ inPlay = false }: { inPlay?: boolean }) {
  const [effects, setEffects] = useState<Eff[]>([]);
  return (
    <>
      <EffectCards
        effects={effects}
        readOnly={false}
        inPlay={inPlay}
        spells={[{ name: 'Misty Step', source: 'XPHB' }]}
        onChange={(next) => {
          written = next;
          setEffects(next);
        }}
      />
      <DialogHost />
    </>
  );
}

async function openMore(inPlay?: boolean) {
  written = [];
  render(<List inPlay={inPlay} />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
  });
  return screen.getByRole('dialog');
}

const search = (text: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search by what it does' }), {
    target: { value: text },
  });

/** The kinds the sheet lists, by name. */
const listed = (sheet: HTMLElement) =>
  within(sheet)
    .queryAllByRole('button')
    .map((b) => b.querySelector('[id$="-label"]')?.textContent)
    .filter((n) => n !== undefined);

describe('the Add an effect sheet', () => {
  it('lists every kind More offers, each under its file group, saying what it does', async () => {
    const sheet = await openMore();
    expect(listed(sheet)).toEqual(
      // Group by group, in the order the add list ranks their first kind.
      moreKinds({ inPlay: false, spells: true }).sort((a, b) => groupRank(a) - groupRank(b)),
    );
    for (const [group, specs] of FILES) {
      const offered = specs.filter((k) => listed(sheet).includes(k.add));
      if (offered.length === 0) continue;
      const box = within(sheet).getByRole('heading', { name: group }).parentElement as HTMLElement;
      for (const k of offered) {
        const button = within(box).getByRole('button', { name: k.add });
        const line = document.getElementById(button.getAttribute('aria-describedby') ?? '');
        expect(line?.textContent).toBe(k.does);
      }
    }
  });

  it('finds a kind by what it does, not only by its name', async () => {
    const sheet = await openMore();
    search('minimum');
    expect(listed(sheet)).toEqual(['Ability score is at least']);
    search('darkvision');
    expect(listed(sheet)).toEqual(['Sense']);
    search('fly');
    expect(listed(sheet)).toEqual(['Fly, swim or climb']);
  });

  it('adds the kind tapped', async () => {
    const sheet = await openMore();
    search('minimum');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Ability score is at least' }));
    });
    expect(written.map((e) => e.kind)).toEqual(['abilityMin']);
  });

  it('offers a reminder when nothing does what was typed', async () => {
    const sheet = await openMore();
    search('teleport');
    expect(within(sheet).getByRole('status').textContent).toBe(
      'Nothing does "teleport" yet. Add a reminder instead: a line on the sheet with nothing to count.',
    );
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Add a reminder' }));
    });
    expect(written.map((e) => e.kind)).toEqual(['cue']);
  });

  it('every kind says what it does in words of its own', () => {
    const all = FILES.flatMap(([, specs]) => specs);
    for (const k of all) expect(k.does.trim(), k.add).not.toBe('');
    expect(new Set(all.map((k) => k.does)).size).toBe(all.length);
  });
});

/** Where a kind's group first comes in the add list's order. */
function groupRank(add: string): number {
  const order = moreKinds({ inPlay: false, spells: true });
  const groupOf = (a: string) => FILES.find(([, specs]) => specs.some((k) => k.add === a))?.[0];
  return order.findIndex((a) => groupOf(a) === groupOf(add));
}
