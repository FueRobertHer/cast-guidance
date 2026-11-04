// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfDot, type ProfMark } from './ProfDot';

afterEach(cleanup);

const MARKS: Array<[ProfMark, string]> = [
  [0, 'not proficient'],
  ['half', 'half proficient'],
  [1, 'proficient'],
  [2, 'expertise'],
];

describe('ProfDot', () => {
  it.each(MARKS)('says %s in words', (level, words) => {
    render(<ProfDot level={level} />);
    expect(screen.getByText(words)).toBeTruthy();
  });

  it('draws each mark in its own shape', () => {
    // DS-001: the marks share a colour, so the shape is all that tells them apart.
    const shapes = MARKS.map(([level]) => {
      const { container } = render(<ProfDot level={level} decorative />);
      return container.querySelector('[aria-hidden]')?.className;
    });
    expect(new Set(shapes).size).toBe(MARKS.length);
  });
});
