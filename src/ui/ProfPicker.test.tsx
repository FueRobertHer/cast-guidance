// @vitest-environment jsdom
// A11Y-001: each level button already says its level in words, so the dot's
// screen-reader text doubled it ("proficient Proficient").
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ProfPicker } from './ProfPicker';

afterEach(cleanup);

describe('ProfPicker', () => {
  it('names each level once, and says which is set', () => {
    render(<ProfPicker value={1} base={0} overridden={false} onChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Proficient', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'None', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expertise', pressed: false })).toBeTruthy();
  });
});
