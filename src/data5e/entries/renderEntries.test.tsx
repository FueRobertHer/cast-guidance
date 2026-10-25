// @vitest-environment jsdom
// Integration coverage (TEST-003) for the {@link} sanitizer (SEC-001) through
// the real entry renderer.
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { FORMATTING_TAGS, isRenderedTag, LINKED_TYPES, PLAIN_REF_TAGS } from './inlineTags';
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

describe('InlineText tag coverage agrees with inlineTags', () => {
  // The data audit treats every tag in these lists as rendered. Each must
  // therefore draw something other than the unknown-tag fallback, which shows
  // the bare body: a name listed without a renderer case fails here.
  const markup = (tag: string) => {
    const { container, unmount } = render(
      <MemoryRouter>
        <InlineText text={`{@${tag} 1d6|https://example.com|3}`} />
      </MemoryRouter>,
    );
    const html = container.innerHTML;
    unmount();
    return html;
  };

  it('falls back to the bare body for an unknown tag', () => {
    expect(markup('zzzUnknownTag')).toBe('1d6');
    expect(isRenderedTag('zzzUnknownTag')).toBe(false);
    // An inherited property name is not a tag the renderer knows.
    expect(isRenderedTag('constructor')).toBe(false);
  });

  it.each([...FORMATTING_TAGS])('renders the formatting tag {@%s}', (tag) => {
    expect(isRenderedTag(tag)).toBe(true);
    expect(markup(tag)).not.toBe(markup('zzzUnknownTag'));
  });

  it.each([
    ...PLAIN_REF_TAGS,
    ...Object.keys(LINKED_TYPES),
  ])('renders the reference tag {@%s}', (tag) => {
    expect(isRenderedTag(tag)).toBe(true);
    expect(markup(tag)).not.toBe(markup('zzzUnknownTag'));
  });
});
