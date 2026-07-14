// @vitest-environment jsdom
// Integration coverage (TEST-003) for the {@link} sanitizer (SEC-001) through
// the real entry renderer.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { InlineText } from './renderEntries';

afterEach(cleanup);

describe('InlineText {@link} sanitization', () => {
  it('renders a plain https link as an anchor', () => {
    const { container } = render(<InlineText text="See {@link the site|https://example.com}" />);
    const a = container.querySelector('a');
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe('https://example.com/');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  it('renders a javascript: link as inert text, never an anchor', () => {
    const { container } = render(<InlineText text="Click {@link here|javascript:alert(1)}" />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('here');
  });

  it('renders a data: link as inert text too', () => {
    const { container } = render(
      <InlineText text="{@link x|data:text/html,<script>alert(1)</script>}" />,
    );
    expect(container.querySelector('a')).toBeNull();
  });
});
