import { afterEach, describe, expect, it, vi } from 'vitest';
import { COMPARE_API_URL } from './config';
import { changedFilesBetween, changedFilesFromComparison } from './releaseDiff';

const comparison = (status: string, ...filenames: string[]) => ({
  status,
  files: filenames.map((filename) => ({ filename })),
});

describe('changedFilesFromComparison', () => {
  it('lists the data files a newer release changed, relative to the data folder', () => {
    const changed = changedFilesFromComparison(
      comparison('ahead', 'data/items.json', 'data/class/class-wizard.json', 'js/render.js'),
    );
    expect([...(changed ?? [])]).toEqual(['items.json', 'class/class-wizard.json']);
  });

  it('counts both ends of a rename', () => {
    const changed = changedFilesFromComparison({
      status: 'ahead',
      files: [{ filename: 'data/new.json', previous_filename: 'data/old.json' }],
    });
    expect([...(changed ?? [])].sort()).toEqual(['new.json', 'old.json']);
  });

  it('reads a release that changed only files the app does not use as nothing changed', () => {
    expect(changedFilesFromComparison(comparison('ahead', 'js/render.js'))?.size).toBe(0);
  });

  it('reads identical releases as nothing changed', () => {
    expect(changedFilesFromComparison(comparison('identical'))?.size).toBe(0);
  });

  it.each([
    // The dangerous one: a downgrade really does come back as `behind` with no
    // files, and reading that as "nothing changed" would install the old files
    // under the new tag's name.
    ['a downgrade', comparison('behind')],
    ['histories that split', comparison('diverged', 'data/items.json')],
    ['a newer release with no file list', { status: 'ahead' }],
    ['a newer release with an empty file list', comparison('ahead')],
    [
      'a list at the limit, which may be cut short',
      comparison('ahead', ...Array.from({ length: 300 }, (_, i) => `data/f${i}.json`)),
    ],
    ['an unreadable entry', { status: 'ahead', files: [{ filename: 7 }] }],
    ['a null entry', { status: 'ahead', files: [null] }],
    ['a bare array', []],
    ['nothing', null],
    ['a rate-limit answer', { message: 'API rate limit exceeded' }],
  ])('does not trust %s', (_label, body) => {
    expect(changedFilesFromComparison(body)).toBeUndefined();
  });
});

describe('changedFilesBetween', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks GitHub to compare the two releases, oldest first', async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(comparison('ahead', 'data/items.json')))),
    );
    vi.stubGlobal('fetch', fetchSpy);
    const changed = await changedFilesBetween('v2.39.0', 'v2.39.1');
    expect([...(changed ?? [])]).toEqual(['items.json']);
    expect(fetchSpy.mock.calls[0]).toEqual([
      `${COMPARE_API_URL}/v2.39.0...v2.39.1`,
      expect.anything(),
    ]);
  });

  it.each([
    ['GitHub refuses', () => Promise.resolve(new Response('{}', { status: 403 }))],
    ['the network fails', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['the answer is not JSON', () => Promise.resolve(new Response('<html>portal</html>'))],
  ])('resolves to unknown when %s', async (_label, answer) => {
    vi.stubGlobal('fetch', vi.fn(answer));
    await expect(changedFilesBetween('v2.39.0', 'v2.39.1')).resolves.toBeUndefined();
  });
});
