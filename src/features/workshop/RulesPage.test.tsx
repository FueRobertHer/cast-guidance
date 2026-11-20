// @vitest-environment jsdom
// The Rules page (ADR-002 U9, board 10, B): the table rules as Settings' row
// says them, the rule packs with who each reaches, their order with where
// they disagree, and Write a rule pack, over the real registry.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateRegistry } from '@/data5e/registry';
import { homebrewRepo } from '@/db/homebrewRepo';
import { savePackLocal } from '@/features/homebrew/PackReviewSheet';
import { TableRulesRow } from '@/features/settings/SettingsPage';
import { resetAnnouncer } from '@/stores/announcer';
import { setAppTableRule } from '@/stores/tableRules';
import { namelessControls } from '../../../tests-fixtures/a11y';
import {
  HARNESS_TIMEOUT,
  resetSheetHarness,
  seedWorld,
} from '../../../tests-fixtures/sheetHarness';
import { collectionPath, collectionsOf } from './collections';
import { Component as RulesPage } from './RulesPage';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);
const downloads = vi.hoisted(() => [] as Array<{ name: string; data: unknown }>);
vi.mock('@/lib/download', async (actual) => ({
  ...(await actual<typeof import('@/lib/download')>()),
  downloadJson: (name: string, data: unknown) => downloads.push({ name, data }),
}));

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

const WAIT = 30_000;

beforeEach(() => {
  downloads.length = 0;
  resetAnnouncer();
});
afterEach(async () => {
  for (const id of ['critDamage', 'restLength', 'flanking'] as const)
    setAppTableRule(id, undefined);
  await resetSheetHarness();
});

/** The Rules page, with Settings' row beside it as Settings shows it. */
async function visit() {
  window.matchMedia ??= (query: string) =>
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
  await seedWorld();
  const router = createMemoryRouter(
    [
      {
        path: '/workshop/rules',
        element: (
          <>
            <RulesPage />
            <aside aria-label="Settings">
              <TableRulesRow />
            </aside>
          </>
        ),
      },
      { path: '*', element: <p>Elsewhere</p> },
    ],
    { initialEntries: ['/workshop/rules'] },
  );
  render(<RouterProvider router={router} />);
  await screen.findByRole('heading', { level: 1, name: 'Rules' }, { timeout: WAIT });
  return router;
}

const ruleRow = (name: string) =>
  within(screen.getByRole('region', { name: 'Table rules' })).getByRole('button', {
    name: new RegExp(`^${name}`),
  });
const settingsRow = () =>
  within(screen.getByRole('complementary', { name: 'Settings' })).getByRole('link', {
    name: /^Table rules and rule packs/,
  });

/** A rule pack file, as one comes in. */
const packFile = (name: string, tableRules: Record<string, string>) => ({
  _meta: {
    sources: [{ json: name.replaceAll(' ', ''), full: name }],
    castGuidance: { v: 1, tableRules },
  },
});

async function importPack(name: string, tableRules: Record<string, string>, everyone = false) {
  const row = await homebrewRepo.importJson(packFile(name, tableRules), `${name}.json`);
  if (everyone) {
    await savePackLocal(row.id, (local) => ({
      ...local,
      appliesTo: { characters: [], appDefault: true },
    }));
  }
  invalidateRegistry();
  return row;
}

describe('the Rules page', () => {
  it('shows the table rules as Settings does, and a change made here reaches both', async () => {
    setAppTableRule('critDamage', 'maxPlusRoll');
    await importPack('Gritty', { restLength: 'gritty' }, true);
    await visit();
    expect(ruleRow('Critical hits').textContent).toContain('Max the dice, then roll them');
    expect(settingsRow().textContent).toContain('Critical hits: Max the dice, then roll them');
    // A pack applied to every character sets a rule nobody chose, and both say so.
    await waitFor(
      () => expect(ruleRow('Rest length').textContent).toContain('Short 8 hours, long 7 days'),
      { timeout: WAIT },
    );
    expect(ruleRow('Rest length').textContent).toContain('Gritty');
    expect(settingsRow().textContent).toContain('Rest length: Short 8 hours, long 7 days');
    expect(settingsRow().getAttribute('href')).toBe('/workshop/rules');

    fireEvent.click(ruleRow('Critical hits'));
    const sheet = await screen.findByRole('dialog', { name: 'Critical hits' });
    fireEvent.click(within(sheet).getByRole('radio', { name: /^Double the total/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(ruleRow('Critical hits').textContent).toContain('Double the total'));
    expect(settingsRow().textContent).toContain('Critical hits: Double the total');
    expect(namelessControls()).toEqual([]);
  });

  it('says every rule is as written when none is a house rule', async () => {
    await visit();
    expect(settingsRow().textContent).toContain('Every rule as written');
  });

  it('lists each pack by where it came from and who it reaches, opening its review', async () => {
    const gritty = await importPack('Gritty', { restLength: 'gritty' });
    await visit();
    const row = await screen.findByRole(
      'button',
      { name: /^Gritty, From a file\. Applies to no character yet/ },
      { timeout: WAIT },
    );
    fireEvent.click(row);
    const review = await screen.findByRole('dialog', { name: 'Gritty' });
    // Its file's page does what a file needs: export, update, delete.
    expect(
      within(review)
        .getByRole('link', { name: 'Export, update or delete it' })
        .getAttribute('href'),
    ).toBe(collectionPath(collectionsOf([gritty])[0]?.id ?? 'none'));
    fireEvent.click(within(review).getByRole('button', { name: 'Every character' }));
    fireEvent.click(within(review).getByRole('button', { name: 'Done' }));
    expect(
      await screen.findByRole(
        'button',
        { name: /^Gritty, From a file\. On for every character/ },
        { timeout: WAIT },
      ),
    ).toBeTruthy();
    expect((await homebrewRepo.getSafe(gritty.id)).file?.pack?.appliesTo.appDefault).toBe(true);
    // Applied to every character, it sets the table's rest length on this page and in Settings.
    await waitFor(
      () => expect(ruleRow('Rest length').textContent).toContain('Short 8 hours, long 7 days'),
      { timeout: WAIT },
    );
    expect(settingsRow().textContent).toContain('Rest length: Short 8 hours, long 7 days');
  });

  it('orders the packs, saying where they disagree as the order now stands', async () => {
    await importPack('Gritty', { restLength: 'gritty' }, true);
    await importPack('Heroic', { restLength: 'heroic' }, true);
    await visit();
    fireEvent.click(await screen.findByRole('button', { name: 'Order' }, { timeout: WAIT }));
    const order = await screen.findByRole('dialog', { name: 'Pack order' });
    expect(within(order).getByText(/^Gritty and Heroic both set .+\. Heroic wins/)).toBeTruthy();
    fireEvent.click(within(order).getByRole('button', { name: 'Move Heroic up' }));
    expect(within(order).getByText(/^Heroic and Gritty both set .+\. Gritty wins/)).toBeTruthy();
    fireEvent.click(within(order).getByRole('button', { name: 'Save' }));
    await waitFor(
      () => expect(ruleRow('Rest length').textContent).toContain('Short 8 hours, long 7 days'),
      { timeout: WAIT },
    );
  });

  it('says which rules in a pack being written come from a pack applied to everyone', async () => {
    setAppTableRule('critDamage', 'doubleTotal');
    await importPack('Gritty', { restLength: 'gritty' }, true);
    await visit();
    await waitFor(
      () => expect(ruleRow('Rest length').textContent).toContain('Short 8 hours, long 7 days'),
      { timeout: WAIT },
    );
    fireEvent.click(screen.getByRole('button', { name: 'Write a rule pack' }));
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Write a rule pack' },
      { timeout: WAIT },
    );
    expect(
      within(sheet)
        .getByRole('checkbox', { name: /^Rest length/ })
        .closest('label')?.textContent,
    ).toContain('Short 8 hours, long 7 days, from Gritty');
    expect(
      within(sheet)
        .getByRole('checkbox', { name: /^Critical hits/ })
        .closest('label')?.textContent,
    ).toContain('Double the total, a house rule');
    expect(
      within(sheet)
        .getByRole('checkbox', { name: /^Flanking/ })
        .closest('label')?.textContent,
    ).toContain('Off, as written');
  });

  it('writes a rule pack from the table rules, lists it, and exports the file it saved', async () => {
    setAppTableRule('critDamage', 'doubleTotal');
    await visit();
    fireEvent.click(screen.getByRole('button', { name: 'Write a rule pack' }));
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Write a rule pack' },
      { timeout: WAIT },
    );
    // Every house rule is in until the player says otherwise; a rule as written is not.
    expect(
      (within(sheet).getByRole('checkbox', { name: /^Critical hits/ }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      (within(sheet).getByRole('checkbox', { name: /^Flanking/ }) as HTMLInputElement).checked,
    ).toBe(false);
    fireEvent.click(within(sheet).getByRole('checkbox', { name: /^Flanking/ }));
    expect(await within(sheet).findByText(/^None yet/)).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: /^Next: name it \(2 things\)/ }));
    const name = within(sheet).getByRole('textbox', { name: 'Name' });
    fireEvent.change(name, { target: { value: '' } });
    expect(within(sheet).getByText('A rule pack needs a name.')).toBeTruthy();
    fireEvent.change(name, { target: { value: 'Lantern Coast rules' } });
    expect(
      within(sheet).getByText('As written, kept so a table that changed it gets it back'),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save rule pack' }));
    const done = await screen.findByRole(
      'dialog',
      { name: 'Lantern Coast rules' },
      { timeout: WAIT },
    );
    fireEvent.click(within(done).getByRole('button', { name: 'Export as a file' }));
    expect(downloads.map((d) => d.name)).toEqual(['lantern-coast-rules.json']);
    const exported = downloads[0]?.data as { _meta: { castGuidance: unknown } };
    expect(exported._meta.castGuidance).toEqual({
      v: 1,
      tableRules: { critDamage: 'doubleTotal', flanking: 'off' },
    });
    const { files } = await homebrewRepo.listSafe();
    expect(files.map((f) => f.json)).toEqual([exported]);
    fireEvent.click(within(done).getByRole('button', { name: 'Done' }));
    expect(
      await screen.findByRole(
        'button',
        { name: /^Lantern Coast rules, Made in this app\. Applies to no character yet/ },
        { timeout: WAIT },
      ),
    ).toBeTruthy();
  });
});
