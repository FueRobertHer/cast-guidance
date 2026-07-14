// @vitest-environment jsdom
// First component/integration test (TEST-003), on jsdom + Testing Library.
// Exercises the REL-005 route error boundary end-to-end in a real render.
import { cleanup, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RouteError } from './RouteError';

function Boom(): never {
  throw new Error('kaboom');
}

afterEach(cleanup);

describe('RouteError', () => {
  it('renders recovery UI when a route throws, keeping the app alive', async () => {
    // React logs the caught render error; silence it for a clean test run.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const router = createMemoryRouter([
      { path: '/', element: <Boom />, errorElement: <RouteError /> },
    ]);
    render(<RouterProvider router={router} />);

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('ran into a problem');
    // Recovery affordances are present.
    expect(screen.getByRole('button', { name: /reload/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /back to characters/i }).getAttribute('href')).toBe(
      '/',
    );
    spy.mockRestore();
  });
});
