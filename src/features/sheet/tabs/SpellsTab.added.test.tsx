// @vitest-environment jsdom
// Spells for every character (rolls and casting plan, phase 6): the Spells tab
// shows on a sheet with no spellcasting, any spell can be added with the
// ability it casts with and how often, and it is marked "Outside your class"
// on Spells and Play, where its rules sheet can take it off again.
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { addedSpellPoolKey } from '@/engine/effects/addedSpells';
import {
  classEntry,
  HARNESS_TIMEOUT,
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

afterEach(async () => {
  await resetSheetHarness();
});

/** A level 5 warrior, no spellcasting, WIS 14 its best casting ability. */
const warrior = () => testCharacter('Brann', [classEntry('Warrior', 5)], { str: 16, wis: 14 });

async function openAddSheet(): Promise<HTMLElement> {
  fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
  return screen.findByRole('dialog', { name: 'Add a spell' });
}

async function search(sheet: HTMLElement, text: string): Promise<void> {
  fireEvent.change(within(sheet).getByRole('textbox', { name: 'Search every spell' }), {
    target: { value: text },
  });
  await waitFor(() => expect(within(sheet).queryByText(/Type at least two letters/)).toBeNull());
}

describe('spells for every character', () => {
  it('shows Spells on a sheet with no spellcasting, which adds a spell from there', async () => {
    const h = await renderSheet(warrior());
    const nav = screen.getByRole('navigation', { name: 'Character sheet' });
    expect(within(nav).getByRole('link', { name: 'Spells' })).toBeTruthy();
    await h.tab('Spells');
    expect(screen.getByRole('heading', { name: 'Warrior has no spellcasting' })).toBeTruthy();

    let sheet = await openAddSheet();
    await search(sheet, 'sear');
    fireEvent.click(within(sheet).getByRole('button', { name: /^Searing Bolt/ }));
    sheet = await screen.findByRole('dialog', { name: 'Searing Bolt' });

    // WIS is the warrior's best: proficiency 3 + 2.
    const abilities = within(sheet).getByRole('group', { name: 'Spellcasting ability' });
    expect(
      within(abilities).getByRole('button', { name: 'WIS +2' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(within(sheet).getByText('Spell attack +5')).toBeTruthy();
    expect(within(sheet).getByText('Save DC 13')).toBeTruthy();
    fireEvent.click(within(abilities).getByRole('button', { name: 'CHA +0' }));
    expect(within(sheet).getByText('Spell attack +3')).toBeTruthy();
    fireEvent.click(within(abilities).getByRole('button', { name: 'WIS +2' }));

    fireEvent.click(within(sheet).getByRole('button', { name: 'Once per short rest' }));
    expect(
      within(sheet).getByText('Once per short or long rest, cast at 1st level with no slot.'),
    ).toBeTruthy();
    expect(within(sheet).getByText(/Brann's class and feats don't give this spell/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add Searing Bolt' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The tab turns from its empty state to the list, and focus goes back to
    // Add a spell, not to the page's top.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add a spell' })),
    );

    expect(screen.queryByRole('heading', { name: 'Warrior has no spellcasting' })).toBeNull();
    expect(screen.getByText('Outside your class')).toBeTruthy();
    expect(screen.getByText('1/1 per rest')).toBeTruthy();
    // Still there to add another.
    expect(screen.getByRole('button', { name: 'Add a spell' })).toBeTruthy();

    const saved = await h.saved();
    expect(saved.addedSpells).toEqual([
      { spell: { name: 'Searing Bolt', source: 'TST' }, ability: 'wis', uses: 'short' },
    ]);
    expect((await h.history())[0]).toBe('Added Searing Bolt');
  });

  it('adds a cantrip at will, and takes it off from the Spells tab', async () => {
    const doc = warrior();
    // Written by a newer build: this one cannot read it, and must not drop it.
    const unknown = { spell: { name: 'Aid', source: 'TST' }, ability: 'wis', uses: 'per moon' };
    (doc as { addedSpells: unknown }).addedSpells = [unknown];
    const h = await renderSheet(doc, { path: 'spells' });
    let sheet = await openAddSheet();
    await search(sheet, 'guid');
    fireEvent.click(within(sheet).getByRole('button', { name: /^Guidance/ }));
    sheet = await screen.findByRole('dialog', { name: 'Guidance' });
    expect(within(sheet).queryByRole('group', { name: 'How often' })).toBeNull();
    expect(within(sheet).getByText(/A cantrip is at will/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Add Guidance' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await h.saved()).addedSpells).toEqual([
      unknown,
      { spell: { name: 'Guidance', source: 'TST' }, ability: 'wis', uses: 'will' },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Guidance' }));
    const rules = await screen.findByRole('dialog', { name: /Guidance/ });
    fireEvent.click(await within(rules).findByRole('button', { name: 'Remove Guidance' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('heading', { name: 'Warrior has no spellcasting' })).toBeTruthy();
    expect((await h.saved()).addedSpells).toEqual([unknown]);
  });

  it('counts only the spells its sources allow', async () => {
    const doc = warrior();
    doc.allowedSources = ['PHB'];
    await renderSheet(doc, { path: 'spells' });
    const sheet = await openAddSheet();
    expect(await within(sheet).findByText(/to search 0 spells\./)).toBeTruthy();
  });

  it('marks an added spell on Play, and its rules sheet takes it off with its uses', async () => {
    const doc = warrior();
    doc.addedSpells = [
      { spell: { name: 'Searing Bolt', source: 'TST' }, ability: 'wis', uses: 'long' },
    ];
    doc.play.resources = [{ key: addedSpellPoolKey('Searing Bolt'), used: 1 }];
    const h = await renderSheet(doc);
    expect(screen.getByText('Outside your class')).toBeTruthy();
    expect(screen.getByText('0/1 per day')).toBeTruthy();

    // The name's button carries its badges: "Searing Bolt Outside your class 0/1 per day".
    fireEvent.click(screen.getByRole('button', { name: /^Searing Bolt.*Outside your class/ }));
    const rules = await screen.findByRole('dialog', { name: /Searing Bolt/ });
    const remove = await within(rules).findByRole('button', { name: 'Remove Searing Bolt' });
    // Opening a sheet to read must not put a stray Enter on Remove.
    expect(document.activeElement).toBe(rules);
    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('Outside your class')).toBeNull();

    const saved = await h.saved();
    expect(saved.addedSpells).toBeUndefined();
    expect(saved.play.resources).toEqual([]);
    expect((await h.history())[0]).toBe('Removed Searing Bolt');
  });

  it('offers a caster Add a spell under Your spells, leaving out the spells it has', async () => {
    await renderSheet(sorcerer(), { path: 'spells' });
    const sheet = await openAddSheet();
    await search(sheet, 'bolt');
    expect(within(sheet).queryByRole('button', { name: /^Searing Bolt/ })).toBeNull();
    expect(within(sheet).getByRole('button', { name: /^Quick Bolt/ })).toBeTruthy();
  });
});
