// @vitest-environment jsdom
// A11Y-002: the announcer's two regions are in the page before anything is
// said, which is what lets a screen reader hear text added to them.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { announce, resetAnnouncer } from '@/stores/announcer';
import { LiveAnnouncer } from './LiveAnnouncer';

afterEach(() => {
  cleanup();
  resetAnnouncer();
});

const region = (container: HTMLElement, politeness: string) => {
  const el = container.querySelector<HTMLElement>(`[data-announcer="${politeness}"]`);
  if (el === null) throw new Error(`no ${politeness} region`);
  return el;
};

describe('LiveAnnouncer', () => {
  it('mounts a polite and an assertive region, empty, hidden from sight only', () => {
    const { container } = render(<LiveAnnouncer />);
    const polite = region(container, 'polite');
    const assertive = region(container, 'assertive');
    expect(polite.getAttribute('aria-live')).toBe('polite');
    expect(assertive.getAttribute('aria-live')).toBe('assertive');
    // Atomic would re-read every line still in the region with each addition.
    expect(polite.getAttribute('aria-atomic')).toBeNull();
    expect(polite.getAttribute('aria-relevant')).toBe('additions');
    expect(polite.textContent).toBe('');
    expect(assertive.textContent).toBe('');
    expect(polite.closest('.sr-only')).not.toBeNull();
    expect(polite.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('puts each message in the region its politeness names, as its own line', () => {
    const { container } = render(<LiveAnnouncer />);
    act(() => {
      announce('Imported brew.json', { key: 'import' });
      announce('Character changes could not be saved', { key: 'save', politeness: 'assertive' });
    });
    const polite = region(container, 'polite');
    const assertive = region(container, 'assertive');
    expect([...polite.children].map((c) => c.textContent)).toEqual(['Imported brew.json']);
    expect([...assertive.children].map((c) => c.textContent)).toEqual([
      'Character changes could not be saved',
    ]);
  });
});
