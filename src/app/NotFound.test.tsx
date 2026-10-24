// @vitest-environment jsdom
// UX-003: an address no route matches used to reach the root error boundary,
// which replaced the whole app with "This screen ran into a problem" and a
// Reload button. It is a missing page, not a crash, and says so.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nearestPage } from './NotFound';

// The real shell starts the data layer and analytics; the route table under it
// is what this suite is about.
vi.mock('@/app/AppShell', async () => {
  const { Outlet } = await import('react-router');
  return { AppShell: () => <Outlet /> };
});

import { routes } from './routes';

afterEach(() => {
  cleanup();
  document.title = '';
});

describe('nearestPage', () => {
  it('points a mistyped sheet tab at the sheet', () => {
    expect(nearestPage('/c/abc/spell')?.to).toBe('/c/abc');
    expect(nearestPage('/c/abc/spell/')?.to).toBe('/c/abc');
  });

  it('has nothing for a sheet link with no character in it', () => {
    expect(nearestPage('/c')).toBeNull();
    expect(nearestPage('/c/')).toBeNull();
  });

  it('points into a library section only when the section exists', () => {
    expect(nearestPage('/library/spell/a/b')?.to).toBe('/library/spell');
    // Not on the home grid, but a section the library still opens.
    expect(nearestPage('/library/classFeature/a/b')?.to).toBe('/library/classFeature');
    expect(nearestPage('/library/bogus/a/b')?.to).toBe('/library');
  });

  it('keeps segments encoded, so the link matches the way the input did', () => {
    expect(nearestPage('/c/a%20b/x')?.to).toBe('/c/a%20b');
  });

  it('points the other sections at their own page', () => {
    expect(nearestPage('/homebrew/edit')?.to).toBe('/homebrew');
    expect(nearestPage('/create/x')?.to).toBe('/create');
    expect(nearestPage('/settings/x')?.to).toBe('/settings');
  });

  it('has nothing better than the roster for anything else', () => {
    expect(nearestPage('/nope')).toBeNull();
    expect(nearestPage('/')).toBeNull();
  });
});

function renderAt(path: string) {
  render(<RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />);
}

describe('the catch-all route', () => {
  it('says the page is missing, keeps the app nav, and offers the nearest page', async () => {
    renderAt('/c/abc/spell');

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByText('/c/abc/spell')).toBeTruthy();
    expect(
      screen.getByRole('link', { name: 'Open this character’s sheet' }).getAttribute('href'),
    ).toBe('/c/abc');
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
    expect(screen.queryByText(/ran into a problem/)).toBeNull();
    expect(document.title).toBe('Page not found · Cast Guidance');
  });

  it('catches a builder link with no file in it', async () => {
    renderAt('/homebrew/edit');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to homebrew' }).getAttribute('href')).toBe(
      '/homebrew',
    );
  });

  it('offers only the roster when nothing is nearer', async () => {
    renderAt('/totally/unknown');
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeTruthy();
    const links = screen.getAllByRole('link').filter((l) => l.closest('main') !== null);
    expect(links.map((l) => l.textContent)).toEqual(['Back to characters']);
    expect(links[0]?.getAttribute('href')).toBe('/');
  });
});
