// @vitest-environment jsdom
// The Rules page (ADR-002 U9, board 10, B): the table rules as Settings' row
// says them, the rule packs with who each reaches, their order with where
// they disagree, and Write a rule pack, over the real registry.
import 'fake-indexeddb/auto';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DATA_TAG } from '@/data5e/config';
import { getRegistry, invalidateRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { newCharacterDoc } from '@/engine/types';
import { savePackLocal } from '@/features/homebrew/PackReviewSheet';
import { RULE_TITLES } from '@/features/settings/RuleSheet';
import { TableRulesRow } from '@/features/settings/SettingsPage';
import { resetAnnouncer } from '@/stores/announcer';
import { noticeStore } from '@/stores/notices';
import { setAppTableRule } from '@/stores/tableRules';
import { namelessControls } from '../../../tests-fixtures/a11y';
import {
  HARNESS_TIMEOUT,
  resetSheetHarness,
  seedWorld,
} from '../../../tests-fixtures/sheetHarness';
import { collectionPath, collectionsOf } from './collections';
import { writeChange } from './copyWriter';
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
  vi.restoreAllMocks();
  for (const id of ['critDamage', 'restLength', 'flanking'] as const)
    setAppTableRule(id, undefined);
  await resetSheetHarness();
});

/** The Rules page, with Settings' row beside it as Settings shows it. */
/** `strict`: under StrictMode, as `main.tsx` renders the app (effects run, clean up, run again). */
async function visit({
  strict = false,
  at = '/workshop/rules',
}: {
  strict?: boolean;
  at?: string;
} = {}) {
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
    { initialEntries: [at] },
  );
  const app = <RouterProvider router={router} />;
  render(strict ? <StrictMode>{app}</StrictMode> : app);
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

async function importPack(
  name: string,
  tableRules: Record<string, string>,
  { everyone = false, order, url }: { everyone?: boolean; order?: number; url?: string } = {},
) {
  const row = await homebrewRepo.importJson(packFile(name, tableRules), `${name}.json`, url);
  if (everyone || order !== undefined) {
    await savePackLocal(row.id, (local) => ({
      ...local,
      ...(everyone ? { appliesTo: { characters: [], appDefault: true } } : {}),
      // Two imports in one millisecond would take their order from their ids.
      ...(order === undefined ? {} : { order }),
    }));
  }
  invalidateRegistry();
  return row;
}

type Json = Record<string, unknown> & { name: string; source: string };

/**
 * Two of the harness's spells changed for the table, as Change for your
 * table saves them, in the file's order. Called after `visit`, which seeds
 * the books.
 */
async function saveTwoChanges(): Promise<[Json, Json]> {
  // Not one a table rule's pick shares a name with (Guidance).
  const [a, b] = (await getRegistry())
    .byType('spell')
    .filter((s) => !Object.values(RULE_TITLES).some((t) => t.startsWith(String(s.name))))
    .slice(0, 2) as unknown as Json[];
  if (a === undefined || b === undefined) throw new Error('the harness has two spells');
  for (const spell of [a, b]) {
    await homebrewRepo.saveEntry(
      'spell',
      writeChange('spell', spell, {
        ...spell,
        entries: [`${spell.name}, for this table.`],
      }) as Json,
      { role: 'changes' },
    );
  }
  invalidateRegistry();
  return [a, b];
}

/** The Changes to the books file's row. */
async function changesRow() {
  return (await homebrewRepo.ownedSafe()).files.find((f) => f.role === 'changes');
}

/** The rule pack the Write sheet saved. */
async function writtenRow() {
  return (await homebrewRepo.listSafe()).files.find((f) => f.role !== 'changes');
}

/** Open Write a rule pack and wait for its picks. */
async function openWrite() {
  fireEvent.click(screen.getByRole('button', { name: 'Write a rule pack' }));
  const sheet = await screen.findByRole('dialog', { name: 'Write a rule pack' }, { timeout: WAIT });
  await within(sheet).findByRole('checkbox', { name: /^Critical hits/ }, { timeout: WAIT });
  return sheet;
}

/** A promise held until the test lets it go. */
function gate() {
  let release = (): void => undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  return { held, release };
}

describe('the Rules page', () => {
  it('shows the table rules as Settings does, and a change made here reaches both', async () => {
    setAppTableRule('critDamage', 'maxPlusRoll');
    await importPack('Gritty', { restLength: 'gritty' }, { everyone: true });
    await visit();
    // A pack applied to every character sets a rule nobody chose, and both say so.
    await waitFor(
      () => expect(ruleRow('Rest length').textContent).toContain('Short 8 hours, long 7 days'),
      { timeout: WAIT },
    );
    expect(ruleRow('Critical hits').textContent).toContain('Max the dice, then roll them');
    expect(settingsRow().textContent).toContain('Critical hits: Max the dice, then roll them');
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

  it('opens Write a rule pack from the address once, Back still going up to the Workshop', async () => {
    // The tab's first page, as a link opened in a new tab or a bookmark.
    const router = await visit({ at: '/workshop/rules?write' });
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Write a rule pack' },
      { timeout: WAIT },
    );
    await waitFor(() => expect(router.state.location.search).toBe(''));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    // No button opened it here: focus lands on the page's heading, not the body.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Rules' })),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() =>
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/workshop?shelf=rules',
      ),
    );
  });

  it('says every rule is as written when none is a house rule', async () => {
    await visit();
    await waitFor(() => expect(settingsRow().textContent).toContain('Every rule as written'), {
      timeout: WAIT,
    });
  });

  it('says a pack from a link is from a link', async () => {
    await importPack(
      'Gritty',
      { restLength: 'gritty' },
      { url: 'https://example.com/gritty.json' },
    );
    await visit();
    expect(
      await screen.findByRole(
        'button',
        { name: /^Gritty, From a link\. Applies to no character yet/ },
        { timeout: WAIT },
      ),
    ).toBeTruthy();
  });

  it('lists each pack by where it came from and who it reaches, opening its review', async () => {
    const gritty = await importPack('Gritty', { restLength: 'gritty' });
    await visit();
    const row = await screen.findByRole(
      'button',
      { name: /^Gritty, Applies to no character yet/ },
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
        { name: /^Gritty, On for every character/ },
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
    await importPack('Gritty', { restLength: 'gritty' }, { everyone: true, order: 0 });
    await importPack('Heroic', { restLength: 'heroic' }, { everyone: true, order: 1 });
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
    await importPack('Gritty', { restLength: 'gritty' }, { everyone: true });
    await visit();
    await waitFor(
      () => expect(ruleRow('Rest length').textContent).toContain('Short 8 hours, long 7 days'),
      { timeout: WAIT },
    );
    // Every render of the sheet, watched: a pick shown before the packs are
    // read would say the pack's rule is as written, and could be taken so.
    const shown: string[] = [];
    const watch = new MutationObserver(() => {
      for (const label of document.querySelectorAll('label')) {
        if (/^Rest length/.test(label.textContent ?? '')) shown.push(label.textContent ?? '');
      }
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    fireEvent.click(screen.getByRole('button', { name: 'Write a rule pack' }));
    const sheet = await screen.findByRole(
      'dialog',
      { name: 'Write a rule pack' },
      { timeout: WAIT },
    );
    // The picks wait for the packs, so none starts from the rules without them.
    expect(
      (
        await within(sheet).findByRole('checkbox', { name: /^Rest length/ }, { timeout: WAIT })
      ).closest('label')?.textContent,
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
    watch.disconnect();
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.filter((t) => !t.includes('from Gritty'))).toEqual([]);
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
      (
        (await within(sheet).findByRole(
          'checkbox',
          { name: /^Critical hits/ },
          { timeout: WAIT },
        )) as HTMLInputElement
      ).checked,
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
        { name: /^Lantern Coast rules, Applies to no character yet/ },
        { timeout: WAIT },
      ),
    ).toBeTruthy();
  });

  it('waits for the characters before saying who a pack reaches', async () => {
    // A pack applied to Hild, with the characters read only after the packs.
    await characterRepo.put(newCharacterDoc('hild', 'Hild', DATA_TAG));
    const row = await importPack('Gritty', { restLength: 'gritty' });
    await savePackLocal(row.id, (local) => ({ ...local, appliesTo: { characters: ['hild'] } }));
    const roster = gate();
    const real = characterRepo.listSafe.bind(characterRepo);
    vi.spyOn(characterRepo, 'listSafe').mockImplementation(async () => {
      await roster.held;
      return real();
    });
    const said: string[] = [];
    const watch = new MutationObserver(() => {
      for (const b of document.querySelectorAll('button')) {
        const t = b.textContent ?? '';
        if (t.startsWith('Gritty')) said.push(t);
      }
    });
    watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    // The page reads each pack's file; once Gritty's is in, its row could show.
    const packRead = gate();
    const getSafe = homebrewRepo.getSafe.bind(homebrewRepo);
    vi.spyOn(homebrewRepo, 'getSafe').mockImplementation(async (id) => {
      const read = await getSafe(id);
      if (id === row.id) packRead.release();
      return read;
    });
    await visit();
    await packRead.held;
    // A render after the read is in, while the characters are not.
    await new Promise((r) => setTimeout(r, 100));
    roster.release();
    expect(
      await screen.findByRole('button', { name: /^Gritty, On for Hild/ }, { timeout: WAIT }),
    ).toBeTruthy();
    watch.disconnect();
    expect(said.filter((t) => t.includes('Applies to no character yet'))).toEqual([]);
  });

  it('closes a pack’s review for good when the pack is deleted in another tab', async () => {
    const gritty = await importPack('Gritty', { restLength: 'gritty' });
    await visit();
    fireEvent.click(
      await screen.findByRole('button', { name: /^Gritty, Applies/ }, { timeout: WAIT }),
    );
    await screen.findByRole('dialog', { name: 'Gritty' });
    const stored = await db.homebrewFiles.get(gritty.id);
    const json = await db.homebrewJson.get(gritty.id);
    if (stored === undefined || json === undefined) throw new Error('Gritty is stored');
    // Deleted as another tab deletes it, then put back as it was (an undo).
    await db.homebrewFiles.delete(gritty.id);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Gritty' })).toBeNull(), {
      timeout: WAIT,
    });
    await db.homebrewFiles.put(stored);
    await db.homebrewJson.put(json);
    expect(
      await screen.findByRole('button', { name: /^Gritty, Applies/ }, { timeout: WAIT }),
    ).toBeTruthy();
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('dialog', { name: 'Gritty' })).toBeNull();
  });

  it('keeps a change’s pick on its entry when another tab removes the one before it', async () => {
    await visit();
    const [first, second] = await saveTwoChanges();
    const sheet = await openWrite();
    const box = (name: string) =>
      within(sheet).getByRole('checkbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
    await waitFor(() => expect(box(second.name).checked).toBe(true), { timeout: WAIT });
    // The player leaves the first change out, then it is removed elsewhere.
    fireEvent.click(box(first.name));
    expect(box(first.name).checked).toBe(false);
    await homebrewRepo.removeEntry((await changesRow())?.id ?? '', 'spell', first);
    await waitFor(
      () =>
        expect(
          within(sheet).queryByRole('checkbox', { name: new RegExp(`^${first.name}`) }),
        ).toBeNull(),
      { timeout: WAIT },
    );
    // The second is still picked, as the player left it, and it is what is saved.
    expect(box(second.name).checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: /^Next: name it \(1 thing\)/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save rule pack' }));
    await screen.findByRole('dialog', { name: 'My table rules' }, { timeout: WAIT });
    expect(((await writtenRow())?.json.spell as Json[]).map((e) => e.name)).toEqual([second.name]);
  });

  it('will not save a change removed in another tab since it was shown', async () => {
    await visit();
    const [first] = await saveTwoChanges();
    const sheet = await openWrite();
    await waitFor(
      () => expect(within(sheet).getByRole('button', { name: /^Next: name it \(2 things\)/ })),
      { timeout: WAIT },
    );
    fireEvent.click(within(sheet).getByRole('button', { name: /^Next: name it/ }));
    // Removed after the sheet last read the changes and before Save: what the
    // file holds from here on is read without it, while the sheet still shows it.
    const real = homebrewRepo.ownedSafe.bind(homebrewRepo);
    vi.spyOn(homebrewRepo, 'ownedSafe').mockImplementation(async () => {
      const read = await real();
      return {
        ...read,
        files: read.files.map((f) =>
          f.role === 'changes'
            ? {
                ...f,
                json: {
                  ...f.json,
                  spell: (f.json.spell as Json[]).filter((e) => e.name !== first.name),
                },
              }
            : f,
        ),
      };
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save rule pack' }));
    expect(
      await within(sheet).findByText(/^Your changes to the books changed while this was open/),
    ).toBeTruthy();
    expect(await writtenRow()).toBeUndefined();
  });

  it('saves only the changes picked, and holds what it saves while it saves', async () => {
    await visit();
    const [first, second] = await saveTwoChanges();
    const sheet = await openWrite();
    const box = (name: string) =>
      within(sheet).getByRole('checkbox', { name: new RegExp(`^${name}`) }) as HTMLInputElement;
    await waitFor(() => expect(box(first.name).checked).toBe(true), { timeout: WAIT });
    fireEvent.click(box(second.name));
    fireEvent.click(within(sheet).getByRole('button', { name: /^Next: name it \(1 thing\)/ }));
    const name = () => within(sheet).getByRole('textbox', { name: 'Name' }) as HTMLInputElement;
    fireEvent.change(name(), { target: { value: 'Lantern Coast rules' } });
    const saving = gate();
    const commit = homebrewRepo.commit.bind(homebrewRepo);
    vi.spyOn(homebrewRepo, 'commit').mockImplementation(async (...args) => {
      await saving.held;
      return commit(...args);
    });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save rule pack' }));
    await within(sheet).findByRole('button', { name: 'Saving…' });
    // While it saves, the name and Back stay as they were.
    fireEvent.change(name(), { target: { value: 'Something else' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back' }));
    expect(name().value).toBe('Lantern Coast rules');
    saving.release();
    const done = await screen.findByRole(
      'dialog',
      { name: 'Lantern Coast rules' },
      { timeout: WAIT },
    );
    const pack = await writtenRow();
    expect(pack?.fileName).toBe('lantern-coast-rules.json');
    expect((pack?.json.spell as Json[]).map((e) => e.name)).toEqual([first.name]);
    // The done step says what was saved, though the change is removed since:
    // the sheet reads the changes again (the live query), and still says it.
    const reads = vi.spyOn(homebrewRepo, 'ownedSafe');
    await homebrewRepo.removeEntry((await changesRow())?.id ?? '', 'spell', first);
    await waitFor(() => expect(reads).toHaveBeenCalled(), { timeout: WAIT });
    await new Promise((r) => setTimeout(r, 100));
    expect(
      within(done).getByText(/^Saved to Rules\. Lantern Coast rules changes 1 thing/),
    ).toBeTruthy();
    expect(within(done).getByText(first.name)).toBeTruthy();
  });

  it('clears a failed save on Back, and reports one that fails after the sheet closes', async () => {
    setAppTableRule('critDamage', 'doubleTotal');
    // As the app runs: an effect run twice must not leave the sheet thinking it closed.
    await visit({ strict: true });
    let sheet = await openWrite();
    vi.spyOn(homebrewRepo, 'commit').mockRejectedValueOnce(new Error('the disk is full'));
    fireEvent.click(within(sheet).getByRole('button', { name: /^Next: name it/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save rule pack' }));
    expect(
      await within(sheet).findByText('Could not save the rule pack: the disk is full'),
    ).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Back' }));
    expect(within(sheet).queryByText(/^Could not save the rule pack/)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Saved, then closed before it fails: a notice says so.
    noticeStore.setState({ notice: null, seq: 0 });
    let fail: ((err: Error) => void) | undefined;
    vi.spyOn(homebrewRepo, 'commit').mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    );
    sheet = await openWrite();
    fireEvent.click(within(sheet).getByRole('button', { name: /^Next: name it/ }));
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save rule pack' }));
    await within(sheet).findByRole('button', { name: 'Saving…' });
    fireEvent.keyDown(sheet, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // "Saving…" shows at the press, before Save has re-read the changes and
    // reached the store: fail the write only once it is under way.
    await waitFor(() => expect(fail).toBeDefined(), { timeout: WAIT });
    fail?.(new Error('the disk is full'));
    await waitFor(() =>
      expect(noticeStore.getState().notice).toMatchObject({
        title: 'Save rule pack failed',
        detail: 'the disk is full',
      }),
    );
  });
});
