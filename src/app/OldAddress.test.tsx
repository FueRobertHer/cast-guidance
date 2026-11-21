// @vitest-environment jsdom
// ADR-002, U12: the Homebrew page and the Builder are gone. An old link or a
// bookmark to either lands on the Workshop page that does its job, in place
// of the old page in history, never on Page not found.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFirstEntry } from '@/lib/useBack';
import { workshopAddress } from './OldAddress';

// The real shell starts the data layer and analytics, and the Workshop's
// pages read the database: the route table is what this suite is about.
vi.mock('@/app/AppShell', async () => {
  const { Outlet } = await import('react-router');
  return { AppShell: () => <Outlet /> };
});
vi.mock('@/features/workshop/WorkshopHome', () => ({
  Component: () => {
    const { search } = useLocation();
    return <h1>Workshop{search}</h1>;
  },
}));
vi.mock('@/features/workshop/CollectionPage', () => ({
  Component: () => <h1>Collection {useParams().id}</h1>,
}));

import { routes } from './routes';

afterEach(cleanup);

describe('workshopAddress', () => {
  it('sends a Builder link to its collection, the id still encoded', () => {
    expect(workshopAddress('/homebrew/edit/abc')).toBe('/workshop/collection/abc');
    // The old route matched trailing slashes too, any number of them.
    expect(workshopAddress('/homebrew/edit/abc/')).toBe('/workshop/collection/abc');
    expect(workshopAddress('/homebrew/edit/abc//')).toBe('/workshop/collection/abc');
    expect(workshopAddress('/homebrew/edit/a%2Fb')).toBe('/workshop/collection/a%2Fb');
    // Routes match regardless of case.
    expect(workshopAddress('/Homebrew/Edit/abc')).toBe('/workshop/collection/abc');
  });

  it('sends everything else to the Collections shelf', () => {
    for (const path of [
      '/homebrew',
      '/homebrew/',
      '/homebrew/edit',
      '/homebrew/edit/',
      '/homebrew/edit//',
      '/homebrew/edit/abc/more',
      '/homebrew//edit/abc',
      // The collection page's name for The books, which no file's id was.
      '/homebrew/edit/books',
      '/homebrew/edit/%62ooks/',
      '/homebrew/other',
    ]) {
      expect(workshopAddress(path), path).toBe('/workshop?shelf=collections');
    }
  });
});

function renderAt(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: ['/', path], initialIndex: 1 });
  render(<RouterProvider router={router} />);
  return router;
}

describe('an old Homebrew address', () => {
  it('lands the Homebrew page on the Collections shelf, in its place in history', async () => {
    const router = renderAt('/homebrew');
    expect(await screen.findByRole('heading', { name: 'Workshop?shelf=collections' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/workshop');
    // Replaced, so Back goes to where the link was followed from.
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('heading', { name: 'Page not found' })).toBeNull();
  });

  it('lands a Builder link on its collection page', async () => {
    const router = renderAt('/homebrew/edit/file-1');
    expect(await screen.findByRole('heading', { name: 'Collection file-1' })).toBeTruthy();
    expect(router.state.location.pathname).toBe('/workshop/collection/file-1');
    expect(router.state.historyAction).toBe('REPLACE');
    // Followed from a page of the app, so Back steps back to it.
    expect(isFirstEntry(router.state.location)).toBe(false);
  });

  it('keeps an old link opened in a new tab the first page, so Back goes up', async () => {
    const router = createMemoryRouter(routes, { initialEntries: ['/homebrew/edit/file-1'] });
    render(<RouterProvider router={router} />);
    expect(await screen.findByRole('heading', { name: 'Collection file-1' })).toBeTruthy();
    // The replace gave the entry a new key, so only its state can say.
    expect(router.state.location.key).not.toBe('default');
    expect(isFirstEntry(router.state.location)).toBe(true);
  });

  it('lands a Builder link with no file in it on the Collections shelf', async () => {
    renderAt('/homebrew/edit');
    expect(await screen.findByRole('heading', { name: 'Workshop?shelf=collections' })).toBeTruthy();
  });
});
