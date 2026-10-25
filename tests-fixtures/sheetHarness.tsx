/**
 * A stateful character sheet for component tests (TEST-003).
 *
 * The tab tests elsewhere hand a tab a fixed outlet context, which is enough to
 * check what one render shows but not what an edit does next: the update goes
 * nowhere the screen reads back from. This mounts the app's own route table in
 * a memory router, over the real character session store, Dexie (on
 * fake-indexeddb) and the real data registry. A tap goes through `update`, the
 * session saves it to IndexedDB with its history label, the registry-backed
 * derivation runs again, and the next render is what a test asserts on.
 *
 * The world is the shared synthetic one from `testWorld.ts`, written into the
 * data cache as release files, so the registry normalizes it the way it does a
 * download. A test can layer entities over it (`extra`) for a case the base
 * world does not hold; an entity with the uid of a base one stands in for it.
 *
 * A test file using this must start with `import 'fake-indexeddb/auto'` and
 * install the two stand-ins in `sheetHarnessMocks.tsx`, then call
 * {@link resetSheetHarness} after each test.
 */
import 'fake-indexeddb/auto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { expect } from 'vitest';
import { routes } from '@/app/routes';
import { invalidateRegistry } from '@/data5e/registry';
import { characterRepo } from '@/db/characterRepo';
import { dataCacheRepo } from '@/db/dataCacheRepo';
import { db } from '@/db/db';
import { historyRepo } from '@/db/historyRepo';
import { type CharacterDoc, type DataEntity, newCharacterDoc } from '@/engine/types';
import { characterSessionStore } from '@/stores/characterSession';
import { noticeStore } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { HARNESS_TAG } from './sheetHarnessMocks';
// The routes the harness visits, loaded with it rather than on the first
// navigation. The table loads them lazily, and a cold transform of the sheet
// and its tabs took over ten seconds of the first test's time on a loaded
// runner; imported here, that cost lands in the file's import phase instead.
import '@/features/homebrew/BuilderPage';
import '@/features/sheet/BuildPage';
import '@/features/sheet/SheetLayout';
import '@/features/sheet/tabs/PlayTab';
import '@/features/sheet/tabs/SpellsTab';
import { makeTestContext } from './testWorld';

// ---------------------------------------------------------------------------
// The world

/** Entities to layer over the test world, by entity type. */
export type WorldLayer = Partial<Record<string, DataEntity[]>>;

/** Which class spell lists a spell is on: `"name|source"` to class names. */
export type SpellLists = Record<string, readonly string[]>;

/** Where each type lives in a release, as `normalizeDataset` reads it. */
const FILES: ReadonlyArray<[path: string, types: readonly string[]]> = [
  ['races.json', ['race', 'subrace']],
  ['backgrounds.json', ['background']],
  ['feats.json', ['feat']],
  ['optionalfeatures.json', ['optionalfeature']],
  ['items-base.json', ['baseitem']],
  ['items.json', ['item', 'itemGroup']],
  ['class/class-tst.json', ['class', 'classFeature', 'subclass', 'subclassFeature']],
  ['spells/spells-tst.json', ['spell']],
  ['conditionsdiseases.json', ['condition']],
];

const SPELL_LOOKUP = 'generated/gendata-spell-source-lookup.json';

const uid = (e: DataEntity) => `${String(e.name)}|${String(e.source)}`.toLowerCase();

/** The test world's entities of one type, with `extra` layered on top. */
function layered(type: string, extra: WorldLayer): DataEntity[] {
  const base = [...makeTestContext().byType(type)];
  for (const e of extra[type] ?? []) {
    const at = base.findIndex((b) => uid(b) === uid(e));
    if (at === -1) base.push(e);
    else base[at] = e;
  }
  return base;
}

/**
 * The generated class spell lookup, in the release's shape:
 * `lookup[source][name].class[classSource][className] = true`.
 */
function spellLookup(lists: SpellLists): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const [spell, classes] of Object.entries(lists)) {
    const [name = '', source = ''] = spell.toLowerCase().split('|');
    const bySource = (out[source] ??= {});
    bySource[name] = { class: { TST: Object.fromEntries(classes.map((c) => [c, true])) } };
  }
  return out;
}

/**
 * Write the world into the data cache as a finished download, and make the
 * registry build from it on its next read.
 */
export async function seedWorld(extra: WorldLayer = {}, lists: SpellLists = {}): Promise<void> {
  const files: Array<[string, unknown]> = FILES.map(([path, types]) => [
    path,
    Object.fromEntries(types.map((t) => [t, layered(t, extra)])),
  ]);
  files.push([SPELL_LOOKUP, spellLookup(lists)]);
  for (const [path, json] of files) {
    await dataCacheRepo.putFile({
      key: dataCacheRepo.key(HARNESS_TAG, path),
      tag: HARNESS_TAG,
      path,
      pack: 'essentials',
      json,
      bytes: 0,
      fetchedAt: 1,
    });
  }
  invalidateRegistry();
}

// ---------------------------------------------------------------------------
// Characters from the existing tab tests

let nextId = 0;

/** A fresh character with the stat line the tab tests use. */
export function testCharacter(
  name: string,
  classes: CharacterDoc['classes'],
  abilities: Partial<CharacterDoc['abilities']['base']> = {},
): CharacterDoc {
  nextId += 1;
  const doc = newCharacterDoc(`harness-${String(nextId)}`, name, HARNESS_TAG);
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10, ...abilities };
  doc.classes = classes;
  return doc;
}

const levels = (n: number) => Array.from({ length: n }, () => 'avg' as const);

/** One class entry at `level`, hit points by average. */
export const classEntry = (name: string, level: number): CharacterDoc['classes'][number] => ({
  ref: { name, source: 'TST' },
  levels: level,
  hp: levels(level),
});

/**
 * PlayTab.test's level-5 sorcerer: slots [4,3,2], five sorcery points, and
 * Searing Bolt known and prepared.
 */
export function sorcerer(level = 5): CharacterDoc {
  const doc = testCharacter('Sparks', [classEntry('Sorcerer', level)], { cha: 16 });
  const bolt = { name: 'Searing Bolt', source: 'TST' };
  doc.spellcasting = { 'sorcerer|tst': { known: [bolt], prepared: [bolt] } };
  return doc;
}

// ---------------------------------------------------------------------------
// Rendering

export interface SheetHarness {
  doc: CharacterDoc;
  router: ReturnType<typeof createMemoryRouter>;
  /** Go somewhere in the app, as a link or the back button would. */
  visit(path: string): Promise<void>;
  /** Open a sheet tab from the sheet's own tab bar ("Play", "Spells", "Build"…). */
  tab(label: string): Promise<void>;
  /** The saved character, once every pending write has landed. */
  saved(): Promise<CharacterDoc>;
  /** History labels, newest first, once every pending write has landed. */
  history(): Promise<string[]>;
}

/**
 * Store `doc`, then open it at `path` under the sheet (`''` is Play).
 * Resolves once the tab has a derived sheet to show.
 */
export async function renderSheet(
  doc: CharacterDoc,
  {
    path = '',
    extra = {},
    lists = {},
  }: { path?: string; extra?: WorldLayer; lists?: SpellLists } = {},
): Promise<SheetHarness> {
  installMatchMedia();
  await seedWorld(extra, lists);
  await characterRepo.put(doc);
  const at = `/c/${doc.id}${path === '' ? '' : `/${path}`}`;
  const router = createMemoryRouter(routes, { initialEntries: [at] });
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
  await sheetReady(doc.name);

  const flushed = async () => {
    await act(() => characterSessionStore.getState().flushAll());
  };
  // Opening a character still being built writes once (current HP follows the
  // derived maximum). Saved here, so it is a history row of its own and not
  // folded into whatever the test does first.
  await flushed();
  return {
    doc,
    router,
    async visit(to) {
      await act(() => router.navigate(to));
      if (to.startsWith('/c/')) await sheetReady(doc.name);
    },
    async tab(label) {
      const nav = screen.getByRole('navigation', { name: 'Character sheet' });
      fireEvent.click(within(nav).getByRole('link', { name: label }));
      // The tab's module loads lazily, and the link only turns current once
      // it has: a cold transform can take seconds on a loaded runner.
      await waitFor(
        () => {
          const link = within(nav).getByRole('link', { name: label });
          expect(link.getAttribute('aria-current')).toBe('page');
        },
        { timeout: LOAD_MS },
      );
      await sheetReady(doc.name);
    },
    async saved() {
      await flushed();
      const stored = await characterRepo.get(doc.id);
      if (stored === undefined) throw new Error(`${doc.id} was never saved`);
      return stored;
    },
    async history() {
      await flushed();
      return (await historyRepo.list(doc.id)).map((r) => r.label);
    },
  };
}

/**
 * A test timeout for files built on this harness. Each case mounts the app's
 * routes over IndexedDB and walks several screens, which on a loaded 4-vCPU
 * runner with coverage on can pass the suite-wide 15 seconds without anything
 * being wrong. Set it with `vi.setConfig({ testTimeout: HARNESS_TIMEOUT })`.
 */
export const HARNESS_TIMEOUT = 60_000;

/**
 * How long a route may take to appear. The route modules load lazily, and a
 * cold transform of one can take seconds on a loaded runner.
 */
const LOAD_MS = 15_000;

/** The sheet header has the character, and the open tab has its sheet. */
async function sheetReady(name: string): Promise<void> {
  await screen.findByRole('heading', { level: 1, name }, { timeout: LOAD_MS });
  await waitFor(
    () => {
      expect(screen.queryByText('Deriving…')).toBeNull();
      expect(screen.queryByText('Loading…')).toBeNull();
      expect(screen.queryByText('Loading spell list…')).toBeNull();
    },
    { timeout: LOAD_MS },
  );
}

/** jsdom has no matchMedia, and the dialog drawer asks for one on mount. */
function installMatchMedia(): void {
  if (typeof window.matchMedia === 'function') return;
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
}

/** Unmount, let the session finish its writes, and empty every store. */
export async function resetSheetHarness(): Promise<void> {
  cleanup();
  await characterSessionStore.getState().close();
  await Promise.all(db.tables.map((t) => t.clear()));
  invalidateRegistry();
  noticeStore.setState({ notice: null, seq: 0 });
  rollLogStore.getState().clear();
}

// ---------------------------------------------------------------------------
// Reading the screen

export type PipState = 'available' | 'spent';

/**
 * The pips of one pool, left to right, from each dot's `data-state`. `name` is
 * what every pip's label starts with: "Level 1 slot", "Pact slot", "Ki use".
 */
export function pips(name: string): PipState[] {
  const pattern = new RegExp(`^${escapeRegExp(name)} \\d+$`);
  return screen.getAllByRole('button', { name: pattern }).map((b) => {
    const state = b.querySelector('[data-state]')?.getAttribute('data-state');
    if (state !== 'available' && state !== 'spent') throw new Error(`pip without a state: ${b}`);
    return state;
  });
}

/** How many of a pool's pips are lit. */
export const left = (name: string): number => pips(name).filter((p) => p === 'available').length;

/** Current, maximum and temporary hit points, as the HP meter reports them. */
export function hp(): { current: number; max: number; temp: number } {
  const meter = screen.getByRole('meter', { name: 'Hit points' });
  const text = meter.getAttribute('aria-valuetext') ?? '';
  const match = /^(-?\d+) of (\d+)(?:, plus (\d+) temporary)?$/.exec(text);
  if (match === null) throw new Error(`unreadable HP meter: "${text}"`);
  return { current: Number(match[1]), max: Number(match[2]), temp: Number(match[3] ?? 0) };
}

/** Hit dice of one size still to spend, from the hit-die button. */
export function hitDiceLeft(die: string): number {
  const button = screen.getByRole('button', { name: new RegExp(`^Spend a ${die} hit die`) });
  const match = /, (\d+) left$/.exec(button.getAttribute('aria-label') ?? '');
  return Number(match?.[1] ?? Number.NaN);
}

/** What the concentration toggle says: the spell held, or undefined. */
export function concentratingOn(): string | undefined {
  const toggle = screen.getByRole('button', { name: /^(Concentrating on .+|Concentration)$/ });
  const text = toggle.textContent ?? '';
  return text.includes('Concentrating on')
    ? text.replace(/^.*Concentrating on\s*/, '').trim()
    : undefined;
}

/**
 * The notice toast on screen, as `title: detail`, or undefined when none is
 * showing. Found by its `data-testid`, so a change to the toast's element or
 * live-region attributes cannot quietly turn this into "no notice".
 */
export function notice(): string | undefined {
  const toast = screen.queryByTestId('notice-toast');
  if (toast === null) return undefined;
  // From the toast itself: the toast is a <div> now (A11Y-002), so a bare
  // `div > div` would match the text column as well as its two lines.
  const [title, detail] = [...toast.querySelectorAll(':scope > div > div')].map(
    (d) => d.textContent,
  );
  return detail === undefined ? (title ?? undefined) : `${title}: ${detail}`;
}

/** The open dialog, for reading its text or pressing one of its buttons. */
export async function dialog(title: string | RegExp) {
  const el = await screen.findByRole('dialog', { name: title }, { timeout: LOAD_MS });
  return {
    text: el.textContent ?? '',
    options: () =>
      within(el)
        .getAllByRole('button')
        .map((b) => b.textContent ?? ''),
    /** Press a button by its name and wait for the dialog to close. */
    async press(name: string | RegExp) {
      fireEvent.click(within(el).getByRole('button', { name }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: LOAD_MS });
    },
  };
}

/**
 * One class's block on the Spells tab: its mode badge ("Known", "Prepared",
 * "Spellbook", "Pact Magic", or undefined), the counters line ("DC 10 · Atk
 * +2 · prepared 0/1"), and the over-limit cue, which must be a status region
 * so the change is announced.
 */
export function spellBlock(className: string): {
  mode: string | undefined;
  counters: string;
  overLimit: string | undefined;
} {
  const heading = screen.getByRole('heading', {
    name: new RegExp(`^${escapeRegExp(className)} spells`),
  });
  const section = heading.closest('section');
  if (section === null) throw new Error(`no spell block for ${className}`);
  const cue = within(section).queryByText(/over your .* limit/);
  if (cue !== null) expect(cue.getAttribute('role')).toBe('status');
  return {
    mode: heading.querySelector('span')?.textContent ?? undefined,
    counters: heading.parentElement?.lastElementChild?.textContent ?? '',
    overLimit: cue?.textContent ?? undefined,
  };
}

/** A known spell's row on the Play tab: whether it is marked prepared. */
export function playSpell(name: string): { prepared: boolean } {
  const trigger = screen.getByRole('button', {
    name: new RegExp(`^${escapeRegExp(name)}\\s*(prepared)?$`),
  });
  return { prepared: /prepared$/.test(trigger.textContent ?? '') };
}

/**
 * A row under "Innate & granted spells": whether it says "Always prepared",
 * and its uses chip ("1/1 per day") with the chip's tooltip.
 */
export function grantedSpell(name: string): {
  alwaysPrepared: boolean;
  uses: string | undefined;
  usesTitle: string | undefined;
} {
  const section = screen.getByText('Innate & granted spells').parentElement;
  if (section === null) throw new Error('no granted spells on this sheet');
  // The name runs straight into its chips in the accessible name, so the row
  // is found by the name's own span.
  const trigger = within(section)
    .getAllByRole('button')
    .find((b) => b.querySelector('span')?.textContent === name);
  if (trigger === undefined) throw new Error(`no granted spell named ${name}`);
  const chips = [...trigger.querySelectorAll('span')].slice(1);
  const uses = chips.find((c) => /per /.test(c.textContent ?? ''));
  return {
    alwaysPrepared: chips.some((c) => c.textContent === 'Always prepared'),
    uses: uses?.textContent ?? undefined,
    usesTitle: uses?.getAttribute('title') ?? undefined,
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
