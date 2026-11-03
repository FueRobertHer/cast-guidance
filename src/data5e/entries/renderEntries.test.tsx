// @vitest-environment jsdom
// Integration coverage (TEST-003) for the {@link} sanitizer (SEC-001) through
// the real entry renderer.
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import {
  DISPLAY_ARG,
  FORMATTING_TAGS,
  isRenderedTag,
  LINKED_TYPES,
  PLAIN_REF_TAGS,
} from './inlineTags';
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

describe('InlineText reference tags show their display text, never their parameters', () => {
  const text = (s: string) => {
    const { container, unmount } = render(
      <MemoryRouter>
        <InlineText text={s} />
      </MemoryRouter>,
    );
    const shown = container.textContent;
    unmount();
    return shown;
  };

  it('shows a {@filter} by its first part, dropping key=value and !negated filters', () => {
    // The Cleric's Destroy Undead (PHB), as it is in the data.
    expect(
      text(
        'when an {@filter undead of CR 1/2 or lower|bestiary|challenge rating=[&0;&1/2]|type=undead|miscellaneous=!swarm} fails its saving throw',
      ),
    ).toBe('when an undead of CR 1/2 or lower fails its saving throw');
  });

  it.each([
    ['{@filter 1/4|bestiary|challenge rating=[&0;&1/4]|type=beast|speed type=!fly;!swim}', '1/4'],
    ['{@5etools feats|feats.html|blankhash}', 'feats'],
    ['{@book chapter 5|PHB|4}', 'chapter 5'],
    ['{@book Making an Attack|phb|9|making an attack}', 'Making an Attack'],
    ['{@adventure chapter 1|WBtW|1}', 'chapter 1'],
    ['{@classFeature Divine Sense|Paladin|PHB|1}', 'Divine Sense'],
    ['{@classFeature Flash of Genius|Artificer|EFA|7|EFA}', 'Flash of Genius'],
    ['{@classFeature Rage|Barbarian||1||raging}', 'raging'],
    ['{@subclassFeature Arcane Jolt|Artificer|EFA|Battle Smith|EFA|9|EFA}', 'Arcane Jolt'],
    ['{@subclass Alchemist|Artificer|EFA|EFA}', 'Alchemist'],
    ['{@deity Azuth|Faerûnian|SCAG}', 'Azuth'],
    ['{@card Aberration|Deck of Many More Things|BMT}', 'Aberration'],
    ['{@quickref difficult terrain||3}', 'difficult terrain'],
    ['{@quickref Cover||3||half cover}', 'half cover'],
    ['{@class Bard|PHB|College of Swords|Swords|XGE}', 'College of Swords'],
    ['{@class fighter|phb|Battle Master|Battle Master|phb|2-0}', 'Battle Master'],
    ['{@spell fire shield||fire shield (warm shield only)}', 'fire shield (warm shield only)'],
    ['{@creature commoner||commoners}', 'commoners'],
  ])('shows %s as "%s"', (tag, shown) => {
    expect(text(tag)).toBe(shown);
  });

  it('only moves the display text of tags the renderer draws as references', () => {
    const refTags = new Set([...PLAIN_REF_TAGS, ...Object.keys(LINKED_TYPES)]);
    for (const tag of DISPLAY_ARG.keys()) expect(refTags).toContain(tag);
  });
});

describe('InlineText roll chips and target size (A11Y-002)', () => {
  /** Whether the text's roll chip is marked as sized by its line. */
  const inlineChip = (text: string) => {
    const { container, unmount } = render(<InlineText text={text} />);
    const inline = container.querySelector('button')?.hasAttribute('data-inline-target');
    unmount();
    return inline;
  };

  it('keeps a chip in a sentence the size of its line', () => {
    expect(inlineChip('Deals {@damage 1d6} fire damage.')).toBe(true);
  });

  it('makes a chip with no words around it, as in a table cell, a full target', () => {
    expect(inlineChip('{@dice 1d6}')).toBe(false);
    expect(inlineChip(' {@dice 1d6} ')).toBe(false);
  });
});
