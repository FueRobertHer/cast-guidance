// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SkipLink } from './SkipLink';

afterEach(cleanup);

describe('SkipLink', () => {
  it('moves focus to the page’s main, and leaves main unfocusable once focus moves on', () => {
    render(
      <>
        <SkipLink />
        <nav>
          <a href="/stats">Stats</a>
        </nav>
        <main>
          <button type="button">Damage</button>
        </main>
      </>,
    );
    const link = screen.getByRole('button', { name: 'Skip to content' });
    const main = screen.getByRole('main');
    link.focus();
    fireEvent.click(link);
    expect(document.activeElement).toBe(main);
    expect(main.getAttribute('tabindex')).toBe('-1');
    screen.getByRole('button', { name: 'Damage' }).focus();
    expect(main.hasAttribute('tabindex')).toBe(false);
  });

  it('keeps a tabindex main already had', () => {
    render(
      <>
        <SkipLink />
        <main tabIndex={-1}>Page</main>
      </>,
    );
    const main = screen.getByRole('main');
    fireEvent.click(screen.getByRole('button', { name: 'Skip to content' }));
    expect(document.activeElement).toBe(main);
    (document.activeElement as HTMLElement).blur();
    expect(main.getAttribute('tabindex')).toBe('-1');
  });

  it('does nothing on a page with no main', () => {
    render(<SkipLink />);
    const link = screen.getByRole('button', { name: 'Skip to content' });
    link.focus();
    fireEvent.click(link);
    expect(document.activeElement).toBe(link);
  });
});
