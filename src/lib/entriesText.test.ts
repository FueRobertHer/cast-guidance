import { describe, expect, it } from 'vitest';
import { entriesToText, textToEntries } from './entriesText';

describe('textToEntries', () => {
  it('splits paragraphs on blank lines', () => {
    expect(textToEntries('First para.\n\nSecond para.')).toEqual(['First para.', 'Second para.']);
  });

  it('joins wrapped lines inside a paragraph', () => {
    expect(textToEntries('One line\nwrapped here.')).toEqual(['One line wrapped here.']);
  });

  it('turns "- " blocks into lists', () => {
    expect(textToEntries('Intro.\n\n- alpha\n- beta')).toEqual([
      'Intro.',
      { type: 'list', items: ['alpha', 'beta'] },
    ]);
  });

  it('keeps inline tags verbatim', () => {
    expect(textToEntries('Deals {@damage 2d6} fire damage.')).toEqual([
      'Deals {@damage 2d6} fire damage.',
    ]);
  });

  it('round-trips through entriesToText', () => {
    const text = 'Intro paragraph.\n\n- one\n- two\n\nOutro.';
    expect(entriesToText(textToEntries(text))).toBe(text);
  });
});
