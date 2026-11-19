// @vitest-environment jsdom
// The Workshop's one Import sheet (ADR-002 U7, board 7): a file, a link and
// pasted text read into the one preview and land through the one path, so
// the same file is the same collection whichever way it came, and bringing a
// changed copy in again offers Update. A pack's `replaces` is named entry by
// entry before anything lands. Real repositories over fake-indexeddb, the
// real sheet and preview; the registry is a small stand-in built from the
// official entries below plus every enabled file, merged by the real merge.
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { ensureSourcesVisible } = vi.hoisted(() => ({
  ensureSourcesVisible: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/data5e/sourceFilter', () => ({ ensureSourcesVisible }));
vi.mock('@/data5e/registry', async () => {
  const { EntityRegistry, mergeHomebrew } = await import('@/data5e/normalize');
  const { homebrewRepo } = await import('@/db/homebrewRepo');
  return {
    invalidateRegistry: () => undefined,
    /** Official Fireball and Fire Bolt, then every enabled file in the real merge order. */
    getRegistry: async () => {
      const reg = new EntityRegistry();
      reg.addAll('spell', [
        { name: 'Fireball', source: 'XPHB', level: 3, entries: ['Boom.'] },
        { name: 'Fire Bolt', source: 'XPHB', level: 0, entries: ['Zap.'] },
      ]);
      const files = (await homebrewRepo.enabledSafe()).files;
      mergeHomebrew(
        reg,
        new Map(files.map((f) => [f.id, f.json])),
        new Map(files.flatMap((f) => (f.pack === undefined ? [] : [[f.id, f.pack]]))),
      );
      return reg;
    },
  };
});

import { db } from '@/db/db';
import { homebrewRepo } from '@/db/homebrewRepo';
import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import { namelessControls } from '../../../tests-fixtures/a11y';
import ImportSheet from './ImportSheet';

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

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
  resetAnnouncer();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type Json = Record<string, unknown>;
type Way = 'A file' | 'A link' | 'Text';

const NAME = 'Tidewater Grimoire.json';
const LINK = `https://raw.githubusercontent.com/me/brews/main/${encodeURIComponent(NAME)}`;

/** The file, and a changed copy of it. */
function grimoire(changed = false): Json {
  return {
    _meta: { sources: [{ json: 'TWG', full: 'Tidewater Grimoire' }] },
    spell: [
      { name: 'Riptide', source: 'TWG', level: 1, entries: ['Pull.'] },
      ...(changed ? [{ name: 'Kelp Cloak', source: 'TWG', level: 2, entries: ['Wrap.'] }] : []),
    ],
  };
}

/** What the sheet reported when it closed with an outcome. */
let done: { message: string; landed: boolean }[] = [];
let closed = 0;

/** The editor a text hands its words to: where it went and what it carried. */
function EditorStandIn() {
  const location = useLocation();
  return <p data-testid="editor">{JSON.stringify({ at: location.pathname, ...location.state })}</p>;
}

function renderSheet() {
  done = [];
  closed = 0;
  const router = createMemoryRouter(
    [
      {
        path: '/workshop',
        element: (
          <ImportSheet
            onClose={() => {
              closed += 1;
            }}
            onDone={(message, landed) => done.push({ message, landed })}
          />
        ),
      },
      { path: '/workshop/new/:type', element: <EditorStandIn /> },
    ],
    { initialEntries: ['/workshop?import='] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

/** Reads hash the file and build a registry: slow when the machine is busy. */
const WAIT = 5000;
const sheet = () => screen.findByRole('dialog', { name: 'Import' }, { timeout: WAIT });
const findDialog = (name: string) => screen.findByRole('dialog', { name }, { timeout: WAIT });

/** Bring `content` in one way, as a person would, and press Read it. */
async function bringIn(way: Way, content: Json) {
  const s = await sheet();
  fireEvent.click(within(s).getByRole('button', { name: way }));
  const text = JSON.stringify(content);
  if (way === 'A file') {
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (input === null) throw new Error('no file input');
    fireEvent.change(input, {
      target: { files: [new File([text], NAME, { type: 'application/json' })] },
    });
    expect(s.textContent).toContain(NAME);
  } else if (way === 'A link') {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(text));
    fireEvent.change(within(s).getByRole('textbox', { name: 'Link to a JSON homebrew file' }), {
      target: { value: LINK },
    });
  } else {
    fireEvent.change(within(s).getByRole('textbox', { name: /^Paste a homebrew file/ }), {
      target: { value: text },
    });
  }
  fireEvent.click(within(s).getByRole('button', { name: 'Read it' }));
}

/** Bring it in and answer the preview titled `title` with `answer`. */
async function land(way: Way, content: Json, title: string, answer: string) {
  renderSheet();
  await bringIn(way, content);
  const preview = await findDialog(title);
  fireEvent.click(within(preview).getByRole('button', { name: answer }));
  await waitFor(() => expect(done).toHaveLength(1), { timeout: WAIT });
  cleanup();
  return done[0];
}

const stored = async () => (await homebrewRepo.listSafe()).files;

describe('the Import sheet', () => {
  it('names every control, and offers a file, a link and text', async () => {
    renderSheet();
    const s = await sheet();
    expect(
      within(within(s).getByRole('group', { name: 'Bring in' }))
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['A file', 'A link', 'Text']);
    // Nothing to read yet: the button says so and does nothing.
    const readIt = within(s).getByRole('button', { name: 'Read it' });
    expect(readIt.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(readIt);
    expect(document.querySelector('[data-import-status] p')).toBeNull();
    expect(namelessControls()).toEqual([]);
  });

  it('lands the same file as the same collection whichever way it comes', async () => {
    const first = await land('A file', grimoire(), `Import "${NAME}"?`, 'Import');
    expect(first).toEqual({ message: `Imported "${NAME}" (1 spell)`, landed: true });
    const [row] = await stored();
    expect(row).toMatchObject({ fileName: NAME, json: grimoire() });

    // The same file by a link, then pasted: it is already here, as one collection.
    for (const way of ['A link', 'Text'] as const) {
      // A pasted file is named from what it is, so it is this file too.
      const again = await land(
        way,
        grimoire(),
        `"${NAME}" is already here`,
        'Keep the existing file',
      );
      expect(again).toEqual({
        message: `Kept the existing "${NAME}". Nothing was added.`,
        landed: false,
      });
      expect((await stored()).map((f) => f.id)).toEqual([row?.id]);
    }
  });

  for (const way of ['A file', 'A link', 'Text'] as const) {
    it(`offers Update for a changed copy brought in again (${way.toLowerCase()})`, async () => {
      await land(way, grimoire(), `Import "${NAME}"?`, 'Import');
      const [before] = await stored();
      await homebrewRepo.setEnabled(before?.id ?? '', false);

      renderSheet();
      await bringIn(way, grimoire(true));
      const preview = await findDialog(`Update "${NAME}"?`);
      expect(
        within(preview).getByRole('region', { name: 'Updates a collection here' }).textContent,
      ).toContain('This copy is different, so it takes its place and keeps its switch');
      // The files here are under Collections in the Workshop, not in a list below.
      expect(preview.textContent).toContain(
        'It stays off. Turn it on under Collections to use it.',
      );
      fireEvent.click(within(preview).getByRole('button', { name: 'Update' }));
      await waitFor(
        () => expect(done).toEqual([{ message: `Updated "${NAME}" (2 spell)`, landed: true }]),
        { timeout: WAIT },
      );

      const after = await stored();
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({
        json: grimoire(true),
        addedAt: before?.addedAt,
        enabled: false,
        key: before?.key,
      });
    });
  }

  it('lands a changed copy by another way beside it: a file and a link are keyed apart', async () => {
    // E1's keys: a file by its first source and name, a link by the link.
    // Pinned so a change to that rule is seen; see the U7 hand-over.
    await land('A file', grimoire(), `Import "${NAME}"?`, 'Import');
    await land('A link', grimoire(true), `Import "${NAME}"?`, 'Import');
    expect((await stored()).map((f) => f.key).sort()).toEqual([
      'file:twg|tidewater grimoire',
      `url:${LINK}`,
    ]);
  });

  it('names a pasted file from what it is, so pasting it again is the same file', async () => {
    await land('Text', grimoire(), `Import "${NAME}"?`, 'Import');
    expect((await stored())[0]).toMatchObject({
      fileName: NAME,
      key: 'file:twg|tidewater grimoire',
    });
  });

  it('names each entry a rule pack replaces before it lands, and none as a clash', async () => {
    const pack = {
      _meta: {
        sources: [{ json: 'TBL', full: 'Our Table' }],
        castGuidance: {
          v: 1,
          replaces: [
            { type: 'spell', name: 'Fireball', source: 'XPHB' },
            { type: 'spell', name: 'Riptide', source: 'TWG' },
            { type: 'spell', name: 'Moonbeam', source: 'XPHB' },
            { type: 'spell', name: 'Ice Knife', source: 'XPHB' },
            { type: 'spell' },
          ],
        },
      },
      spell: [
        { name: 'Fireball', source: 'XPHB', level: 3, entries: ['A smaller boom.'] },
        {
          name: 'Riptide',
          source: 'TWG',
          _copy: { name: 'Riptide', source: 'TWG', _mod: { level: 2 } },
        },
        { name: 'Moonbeam', source: 'XPHB', level: 2, entries: ['Not in the books here.'] },
        { name: 'Fire Bolt', source: 'XPHB', level: 0, entries: ['Not listed.'] },
      ],
    };
    await land('A file', grimoire(), `Import "${NAME}"?`, 'Import');
    renderSheet();
    await bringIn('Text', pack);
    const preview = await findDialog('Add Our Table?');
    const changes = within(preview).getByRole('region', { name: 'Changes to entries' });
    const rows = [...changes.querySelectorAll('dl > div')].map((r) => [
      r.querySelector('dt')?.textContent,
      r.querySelector('dd')?.textContent,
    ]);
    expect(rows).toEqual([
      [
        'Fireball (spell, XPHB)',
        "The pack's own version, in place of the book's, for the characters it applies to",
      ],
      [
        'Riptide (spell, TWG)',
        `The pack's own version, in place of the one in "${NAME}", for the characters it applies to`,
      ],
      // No game data is downloaded here, so an entry nothing has may be in what is not.
      [
        'Moonbeam (spell, XPHB)',
        "Not found yet: not all game data is on this device, so it may replace the book's once the rest is",
      ],
      ['Ice Knife (spell, XPHB)', 'Not in this pack, so it replaces nothing'],
    ]);
    expect(preview.textContent).toContain(
      'One entry it names to replace has no type, name or source, so it replaces nothing',
    );
    // A replaced entry is no content: it is no official clash. Fire Bolt, not listed, is one.
    expect(preview.textContent).not.toContain('Fireball (XPHB) is also official content');
    expect(preview.textContent).toContain('Fire Bolt (XPHB) is also official content');
    expect(namelessControls()).toEqual([]);
  });

  it('hands one entry’s words to the editor, in Text', async () => {
    const router = renderSheet();
    const s = await sheet();
    fireEvent.click(within(s).getByRole('button', { name: 'Text' }));
    fireEvent.change(within(s).getByRole('textbox', { name: /^Paste a homebrew file/ }), {
      target: { value: 'Kelp Cloak\nWhile you wear it, you can breathe underwater.' },
    });
    fireEvent.change(within(s).getByRole('combobox', { name: 'These words are' }), {
      target: { value: 'item' },
    });
    fireEvent.click(within(s).getByRole('button', { name: 'Open in the editor' }));
    const editor = await screen.findByTestId('editor');
    const went = JSON.parse(editor.textContent ?? '{}') as { at: string; seed: Json };
    expect(went.at).toBe('/workshop/new/item');
    expect(JSON.stringify(went.seed.entries)).toContain('you can breathe underwater');
    expect(router.state.location.pathname).toBe('/workshop/new/item');
    expect(await stored()).toEqual([]);
  });

  it('refuses a link the app may not read, before any request, and offers a file', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    renderSheet();
    const s = await sheet();
    fireEvent.click(within(s).getByRole('button', { name: 'A link' }));
    fireEvent.change(within(s).getByRole('textbox', { name: 'Link to a JSON homebrew file' }), {
      target: { value: 'https://example.com/brew.json' },
    });
    fireEvent.click(within(s).getByRole('button', { name: 'Read it' }));
    await waitFor(
      () =>
        expect(s.textContent).toContain('For other sites, open the file, save it to this device'),
      { timeout: WAIT },
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    fireEvent.click(within(s).getByRole('button', { name: 'Bring it in as a file' }));
    expect(within(s).getByRole('button', { name: 'A file' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('says why text that is no homebrew file cannot be read, and adds nothing', async () => {
    const status = () => document.querySelector('[data-import-status] p')?.textContent;
    renderSheet();
    await bringIn('Text', {} as Json);
    await waitFor(() => expect(status()).toMatch(/^Import failed/), { timeout: WAIT });
    // Text that starts as JSON but is none says so, not that an import failed.
    const s = await sheet();
    fireEvent.change(within(s).getByRole('textbox', { name: /^Paste a homebrew file/ }), {
      target: { value: '{ "spell": [ ' },
    });
    fireEvent.click(within(s).getByRole('button', { name: 'Read it' }));
    await waitFor(() => expect(status()).toMatch(/^That text is not a homebrew file: /), {
      timeout: WAIT,
    });
    expect(await stored()).toEqual([]);
    expect(done).toEqual([]);
    expect(closed).toBe(0);
  });

  it('stops a read part way, after the text is read, and adds nothing', async () => {
    renderSheet();
    await bringIn('Text', grimoire());
    const s = await sheet();
    const stop = within(s).getByRole('button', { name: 'Stop reading' });
    stop.focus();
    fireEvent.click(stop);
    await waitFor(
      () =>
        expect(document.querySelector('[data-import-status] p')?.textContent).toBe(
          'Stopped. Nothing was added.',
        ),
      { timeout: WAIT },
    );
    expect(screen.queryByRole('dialog', { name: `Import "${NAME}"?` })).toBeNull();
    expect(within(s).queryByRole('button', { name: 'Stop reading' })).toBeNull();
    // Focus on Stop, which went with the read, is not dropped on the page.
    expect(document.activeElement).toBe(within(s).getByRole('button', { name: 'Read it' }));
    expect(await stored()).toEqual([]);
  });

  it('offers Stop for the read in progress, not the way picked since', async () => {
    renderSheet();
    await bringIn('Text', grimoire());
    const s = await sheet();
    fireEvent.click(within(s).getByRole('button', { name: 'A link' }));
    expect(within(s).getByRole('button', { name: 'Stop reading' })).toBeTruthy();
    await findDialog(`Import "${NAME}"?`);
  });

  it('says nothing more once closed part way through a read', async () => {
    renderSheet();
    await bringIn('Text', grimoire());
    cleanup();
    // Long enough for the read to have finished, had it gone on.
    await new Promise((r) => setTimeout(r, 1000));
    expect(getAnnouncerState().messages.map((m) => m.text)).not.toContain(
      'Stopped. Nothing was added.',
    );
    expect(await stored()).toEqual([]);
  });

  it('keeps the preview up while it is stored: a second press or Cancel does nothing', async () => {
    const real = homebrewRepo.commit.bind(homebrewRepo);
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const commit = vi.spyOn(homebrewRepo, 'commit').mockImplementation(async (...args) => {
      await gate;
      return real(...args);
    });
    renderSheet();
    await bringIn('Text', grimoire());
    const preview = await findDialog(`Import "${NAME}"?`);
    fireEvent.click(within(preview).getByRole('button', { name: 'Import' }));
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(1), { timeout: WAIT });
    fireEvent.click(within(preview).getByRole('button', { name: 'Import' }));
    fireEvent.click(within(preview).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('dialog', { name: `Import "${NAME}"?` })).toBe(preview);
    expect(done).toEqual([]);
    open();
    await waitFor(
      () => expect(done).toEqual([{ message: `Imported "${NAME}" (1 spell)`, landed: true }]),
      {
        timeout: WAIT,
      },
    );
    expect(commit).toHaveBeenCalledTimes(1);
    expect(await stored()).toHaveLength(1);
  });

  it('brings the sheet back with the reason when storing fails, and lands nothing', async () => {
    vi.spyOn(homebrewRepo, 'commit').mockRejectedValue(new Error('the disk is full'));
    renderSheet();
    await bringIn('Text', grimoire());
    const preview = await findDialog(`Import "${NAME}"?`);
    fireEvent.click(within(preview).getByRole('button', { name: 'Import' }));
    const s = await sheet();
    await waitFor(
      () =>
        expect(s.querySelector('[data-import-status] p')?.textContent).toMatch(/^Import failed: /),
      { timeout: WAIT },
    );
    // What was given is still there, to try again.
    expect(
      (within(s).getByRole('textbox', { name: /^Paste a homebrew file/ }) as HTMLTextAreaElement)
        .value,
    ).toBe(JSON.stringify(grimoire()));
    expect(done).toEqual([]);
    expect(await stored()).toEqual([]);
  });

  it('cancels from the preview without landing anything', async () => {
    const out = await land('Text', grimoire(), `Import "${NAME}"?`, 'Cancel');
    expect(out).toEqual({ message: 'Import canceled. Nothing was added.', landed: false });
    expect(await stored()).toEqual([]);
  });
});
