// @vitest-environment jsdom
// GAME-003: switching rules version re-reads every pick under the other edition,
// so it previews what that does to this character and waits for a yes. It used
// to apply on one tap, under a legend promising warnings that did not exist.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { Component as BuildPage } from './BuildPage';
import type { CharacterSheetState } from './useCharacterSheet';

vi.mock('@/data5e/hooks', () => ({ useRegistry: () => makeTestContext() }));
vi.mock('@/data5e/loader', () => ({ ensureTypePacks: () => Promise.resolve() }));

const dialogs = vi.hoisted(() => ({
  askConfirm: vi.fn<(req: { title: string; detail?: string }) => Promise<boolean>>(),
}));
vi.mock('@/ui/dialogs', () => ({
  askConfirm: dialogs.askConfirm,
  askNumber: () => Promise.resolve(null),
  askText: () => Promise.resolve(null),
  askChoice: () => Promise.resolve(null),
}));

afterEach(() => {
  cleanup();
  dialogs.askConfirm.mockReset();
});

/** The detail text of the last confirm the page raised. */
const lastPrompt = () => dialogs.askConfirm.mock.calls.at(-1)?.[0];

function renderBuild(build?: (doc: CharacterDoc) => void) {
  const doc = newCharacterDoc('b1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.race = { name: 'Testfolk', source: 'TST' };
  doc.background = { name: 'Scholar', source: 'TST' };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  build?.(doc);

  let current = doc;
  const update = (recipe: (d: CharacterDoc) => void) => {
    const d = structuredClone(current);
    recipe(d);
    current = d;
    rerender();
  };
  const ctxValue = () =>
    ({
      doc: current,
      sheet: deriveSheet(current, makeTestContext()),
      update,
      loadStatus: 'ready',
      missing: false,
      error: null,
      saveStatus: 'saved',
      retryLoad: () => undefined,
    }) as unknown as CharacterSheetState;
  const routes = () => [
    {
      path: '/',
      element: <Outlet context={ctxValue()} />,
      children: [{ index: true, element: <BuildPage /> }],
    },
  ];
  const view = render(<RouterProvider router={createMemoryRouter(routes())} />);
  const rerender = () => view.rerender(<RouterProvider router={createMemoryRouter(routes())} />);
  return { getDoc: () => current };
}

describe('BuildPage rules-version switch (GAME-003)', () => {
  it('previews the switch and applies nothing until it is confirmed', async () => {
    const { getDoc } = renderBuild();
    expect(getDoc().rulesVersion).toBe('2014');

    dialogs.askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '2024' }));

    await waitFor(() => expect(dialogs.askConfirm).toHaveBeenCalledTimes(1));
    expect(lastPrompt()?.title).toBe('Switch to 2024 rules?');
    // Declining must leave the character exactly as it was.
    expect(getDoc().rulesVersion).toBe('2014');
  });

  it('applies the switch once confirmed', async () => {
    const { getDoc } = renderBuild();
    dialogs.askConfirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: '2024' }));
    await waitFor(() => expect(getDoc().rulesVersion).toBe('2024'));
  });

  it('tells the player what the switch does to the picks they hold', async () => {
    // Every fixture pick is 2014 content with no reprint, so the preview should
    // both reassure and name them rather than just asking to confirm.
    const { getDoc } = renderBuild();
    dialogs.askConfirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: '2024' }));
    await waitFor(() => expect(dialogs.askConfirm).toHaveBeenCalled());

    const detail = lastPrompt()?.detail ?? '';
    expect(detail).toContain('Nothing is removed');
    expect(detail).toContain('every selection is kept');
    expect(detail).toContain('carry over with no 2024 reprint');
    expect(detail).toContain('Warrior');
    expect(getDoc().rulesVersion).toBe('2014');
  });

  it('does not prompt when the version tapped is the one already set', () => {
    const { getDoc } = renderBuild();
    fireEvent.click(screen.getByRole('button', { name: '2014' }));
    expect(dialogs.askConfirm).not.toHaveBeenCalled();
    expect(getDoc().rulesVersion).toBe('2014');
  });
});

describe('BuildPage edition cues (GAME-003)', () => {
  it('says nothing while every pick suits the version', () => {
    renderBuild();
    expect(screen.queryByText(/^Mixed editions/)).toBeNull();
  });

  it('lists a cue per off-edition pick once the character is on 2024', () => {
    const { getDoc } = renderBuild((d) => {
      d.rulesVersion = '2024';
    });
    expect(getDoc().rulesVersion).toBe('2024');
    // Three 2014 picks (species, background, class) in a 2024 game.
    expect(screen.getByText('Mixed editions (3)')).toBeTruthy();
    expect(
      screen.getByText('Warrior: 2014 content with no 2024 reprint. Kept as chosen.'),
    ).toBeTruthy();
    // And the pick itself carries the compact chip, where you would change it.
    expect(screen.getAllByText('2014 content').length).toBeGreaterThan(0);
  });
});
