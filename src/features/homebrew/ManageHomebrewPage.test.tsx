// @vitest-environment jsdom
// This is the only screen that can remove a file the app cannot read, so it is
// the one screen that has to say such a file exists, and offer the delete.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { namelessControls } from '../../../tests-fixtures/a11y';

const { read, remove, prepare } = vi.hoisted(() => ({
  read: { current: undefined as unknown },
  remove: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: () => read.current }));
vi.mock('@/db/homebrewRepo', () => ({ homebrewRepo: { delete: remove, prepare } }));
vi.mock('@/ui/dialogs', () => ({ askConfirm: () => Promise.resolve(true), askText: vi.fn() }));
vi.mock('@/data5e/registry', () => ({ invalidateRegistry: vi.fn() }));
vi.mock('@/data5e/sourceFilter', () => ({ ensureSourcesVisible: vi.fn() }));

import { Component as ManageHomebrewPage } from './ManageHomebrewPage';

const file = (over: Record<string, unknown> = {}) => ({
  id: 'a',
  fileName: 'good.json',
  json: {},
  enabled: true,
  editable: false,
  sourceIds: ['HB'],
  counts: { spell: 2 },
  addedAt: 1,
  ...over,
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ManageHomebrewPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  read.current = undefined;
  remove.mockReset();
  prepare.mockReset();
  vi.restoreAllMocks();
});

describe('ManageHomebrewPage read errors', () => {
  it('names the files that could not be read and keeps listing the rest', () => {
    read.current = {
      files: [file()],
      errors: [
        { id: 'b', fileName: 'broken.json', message: 'the file content is not a JSON object' },
      ],
    };
    renderPage();

    // The banner counts; the row below it names the file and offers the fix.
    expect(screen.getByRole('alert').textContent).toContain('1 file');
    expect(screen.getByText('broken.json')).toBeTruthy();
    expect(screen.getByText('good.json')).toBeTruthy();
  });

  it('gives an unreadable file a row and a way to remove it', async () => {
    // Reporting these without a delete left the builder telling people to come
    // here and do something they could not.
    remove.mockResolvedValue(undefined);
    read.current = {
      files: [],
      errors: [{ id: 'b', fileName: 'broken.json', message: 'content is not a JSON object' }],
    };
    renderPage();

    expect(screen.getByText('broken.json')).toBeTruthy();
    expect(screen.getByText('content is not a JSON object')).toBeTruthy();

    fireEvent.click(screen.getByTitle('Delete'));
    await waitFor(() => expect(remove).toHaveBeenCalledWith('b'));
  });

  it('says so instead of offering a delete it cannot perform', () => {
    // No id means nothing can address the row, so there is no delete to offer.
    read.current = { files: [], errors: [{ message: 'the row has no id' }] };
    renderPage();

    expect(screen.getByText('An unnamed file')).toBeTruthy();
    expect(screen.queryByTitle('Delete')).toBeNull();
  });

  it('does not call a file-less device empty while it is reporting a failure', () => {
    read.current = { files: [], errors: [{ id: 'b', message: 'unreadable' }] };
    renderPage();

    expect(screen.queryByText('No homebrew imported yet.')).toBeNull();
  });

  it('says nothing when every file read cleanly', () => {
    read.current = { files: [file()], errors: [] };
    renderPage();

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still shows the empty state, not an error, with no files at all', () => {
    read.current = { files: [], errors: [] };
    renderPage();

    expect(screen.getByText('No homebrew imported yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// A11Y-001: every row action was an icon named only by its tooltip, and the
// URL import button had no name at all.
describe('ManageHomebrewPage accessible names', () => {
  it('names every control, with the file each row action acts on', () => {
    read.current = {
      files: [file({ editable: true }), file({ id: 'c', fileName: 'off.json', enabled: false })],
      errors: [{ id: 'b', fileName: 'broken.json', message: 'not a JSON object' }],
    };
    renderPage();

    expect(namelessControls()).toEqual([]);
    expect(screen.getByRole('button', { name: 'Import from URL' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit good.json in the builder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download good.json' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete broken.json' })).toBeTruthy();
  });

  it('reports whether each file is enabled as a pressed state', () => {
    read.current = {
      files: [file(), file({ id: 'c', fileName: 'off.json', enabled: false })],
      errors: [],
    };
    renderPage();

    expect(screen.getByRole('button', { name: 'Enable good.json', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Enable off.json', pressed: false })).toBeTruthy();
  });
});

// SEC-001: the enforced CSP only lets the app connect to a few hosts, so a URL
// anywhere else is refused before any request, with a way that still works.
describe('ManageHomebrewPage URL import', () => {
  function submitUrl(url: string) {
    fireEvent.change(screen.getByRole('textbox', { name: 'Homebrew JSON URL' }), {
      target: { value: url },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Import from URL' }));
  }

  it('refuses a host off the list without fetching, and offers the file instead', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    read.current = { files: [], errors: [] };
    renderPage();

    submitUrl('https://example.com/x.json');

    const guidance = await screen.findByRole('status');
    expect(guidance.textContent).toContain('only from GitHub');
    expect(guidance.textContent).toContain('use Import file');
    const open = within(guidance).getByRole('link', { name: 'Open file' });
    expect(open.getAttribute('href')).toBe('https://example.com/x.json');
    expect(open.getAttribute('rel')).toContain('noopener');
    expect(within(guidance).getByRole('button', { name: 'Import file' })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it('gives a malformed or http URL its own fix, not the other-sites advice', async () => {
    read.current = { files: [], errors: [] };
    renderPage();

    submitUrl('not a url');
    let guidance = await screen.findByRole('status');
    expect(guidance.textContent).toContain('That is not a complete URL.');
    expect(guidance.textContent).not.toContain('For other sites');

    submitUrl('http://raw.githubusercontent.com/me/brews/main/brew.json');
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('Only https URLs are fetched.'),
    );
    guidance = screen.getByRole('status');
    expect(guidance.textContent).not.toContain('For other sites');
  });

  it('sends a GitHub folder page to the Raw button', async () => {
    read.current = { files: [], errors: [] };
    renderPage();

    submitUrl('https://github.com/me/brews/tree/main/dir');
    const guidance = await screen.findByRole('status');
    expect(guidance.textContent).toContain('Raw button');
    expect(guidance.textContent).not.toContain('For other sites');
  });

  it('links nothing for a refused URL that is not http(s)', async () => {
    read.current = { files: [], errors: [] };
    renderPage();

    submitUrl('javascript:alert(1)');

    const guidance = await screen.findByRole('status');
    expect(within(guidance).queryByRole('link')).toBeNull();
  });

  it('advises the file import when the host cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    read.current = { files: [], errors: [] };
    renderPage();

    submitUrl('https://raw.githubusercontent.com/me/brews/main/brew.json');

    const status = await screen.findByText(/URL import failed/);
    expect(status.textContent).toContain('(Failed to fetch)');
    expect(status.textContent).toContain('use Import file instead');
  });

  it('reports an HTTP failure as itself, without network advice', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    read.current = { files: [], errors: [] };
    renderPage();

    submitUrl('https://raw.githubusercontent.com/me/brews/main/brew.json');

    const status = await screen.findByText(/URL import failed/);
    expect(status.textContent).toBe('URL import failed (HTTP 404).');
  });
});
