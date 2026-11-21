// @vitest-environment jsdom
// Rules text in a homebrew file is anyone's, up to the import limit of 200,000
// characters a string. These each crashed the renderer or froze it before it
// was bounded: a few thousand nested tags overflowed the stack, and a long
// sentence of tags with no full stop made every tag walk back over all the
// ones before it (2 s at 56,000 characters, out of memory at 112,000). At these
// sizes a quadratic path runs past the test timeout rather than through a
// timing assertion.
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { IMPORT_LIMITS } from '@/lib/guards';
import { plainEntryText } from './plainText';
import { EntriesView, InlineText } from './renderEntries';

afterEach(cleanup);

const MAX = IMPORT_LIMITS.maxStringLength;

function shown(text: string): string {
  const { container } = render(
    <MemoryRouter>
      <InlineText text={text} />
    </MemoryRouter>,
  );
  return container.textContent ?? '';
}

/** `{@b {@b ... x}}`, `depth` deep, within `MAX` characters. */
const nested = (depth: number, tag = 'b') => `${`{@${tag} `.repeat(depth)}x${'}'.repeat(depth)}`;

describe('hostile rules text', () => {
  it('renders tags nested to the string limit without overflowing the stack', () => {
    const depth = Math.floor((MAX - 1) / 5);
    const text = nested(depth);
    expect(text.length).toBeLessThanOrEqual(MAX);
    // Past the nesting the plain reader reads, the text stays as written, as
    // there: the two never disagree.
    expect(shown(text)).toBe(plainEntryText(text));
  });

  it('still reads the nesting the books use', () => {
    expect(shown('{@note See {@b the {@i {@spell fireball}}} rules.}')).toBe(
      'See the fireball rules.',
    );
    expect(shown(nested(4))).toBe('x');
    expect(shown(nested(5))).toBe('{@b x}');
  });

  it('caps nesting through links and reference tags too', () => {
    const text = `${'{@spell {@b '.repeat(2_000)}x${'}}'.repeat(2_000)}`;
    expect(shown(text)).toBe(plainEntryText(text));
  });

  it('renders a sentence of tags with no full stop in linear time', () => {
    const text = '{@b x} '.repeat(Math.floor(MAX / 7));
    expect(shown(text)).toBe(plainEntryText(text));
  });

  it('renders a sentence of scaling dice with no full stop in linear time', () => {
    const tag = '{@scaledice 1d6|1-9|1d6} ';
    const { container } = render(<InlineText text={tag.repeat(Math.floor(MAX / tag.length))} />);
    expect(container.querySelectorAll('button').length).toBe(Math.floor(MAX / tag.length));
  });

  it('reads a long run of words before a heal in linear time', () => {
    // One full stop at the end of a long run: a pattern anchored at the end
    // of the text retried from every start before it.
    const text = `${'a'.repeat(MAX - 20)}. {@dice 1d6} more`;
    expect(shown(text)).toContain('1d6');
  });

  it('keeps the end of the sentence a scaling chip reads its levels from', () => {
    // No full stop before it, so the sentence is every tag before it too; the
    // words the chip needs are at its end.
    const sentence =
      'when you cast this spell using a spell slot of 5th or 6th level, the extra damage increases to {@scaledamage 1d4|3-9|2d4}.';
    const { container } = render(<InlineText text={`${'{@b word} '.repeat(2_000)}${sentence}`} />);
    expect(container.querySelector('button')?.getAttribute('title')).toContain(
      'at slot levels 5 and 6',
    );
  });

  it('renders entries nested to the import depth limit', () => {
    let entries: unknown = 'deep';
    for (let i = 0; i < IMPORT_LIMITS.maxDepth; i++) entries = [{ type: 'entries', entries }];
    const { container } = render(<EntriesView entries={entries} />);
    expect(container.textContent).toBe('deep');
  });
});
