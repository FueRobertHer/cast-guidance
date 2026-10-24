// @vitest-environment jsdom
// UX-003: the library's Back was `navigate(-1)`, which on a deep link (a shared
// URL, a bookmark) leaves the app or does nothing. With no history of its own
// to go back through, Back goes up instead.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { useBack } from './useBack';

afterEach(cleanup);

function Page() {
  const back = useBack('/library/spell');
  const { pathname } = useLocation();
  return (
    <>
      <div data-testid="location">{pathname}</div>
      <button type="button" onClick={back}>
        Back
      </button>
    </>
  );
}

function renderAt(entries: string[], index: number) {
  const router = createMemoryRouter([{ path: '*', element: <Page /> }], {
    initialEntries: entries,
    initialIndex: index,
  });
  render(<RouterProvider router={router} />);
  return router;
}

describe('useBack', () => {
  it('goes up to the fallback when the page is where the session started', async () => {
    const router = renderAt(['/library/spell/fireball%7Cphb'], 0);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('/library/spell')).toBeTruthy();
    // Replaced, not pushed: Back from the section does not return to the spell.
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('goes back through history when there is some', async () => {
    renderAt(['/library', '/library/spell/fireball%7Cphb'], 1);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(await screen.findByText('/library')).toBeTruthy();
  });
});
