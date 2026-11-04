// @vitest-environment jsdom
// A11Y-001: each level button already says its level in words, so the dot's
// screen-reader text doubled it ("proficient Proficient").
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { EffectOrigin } from '@/engine/types';
import { ProfPicker } from './ProfPicker';

afterEach(cleanup);

const ROGUE: EffectOrigin = { label: 'Rogue', uid: 'rogue|tst', type: 'class' };
const ACOLYTE: EffectOrigin = { label: 'Acolyte', uid: 'acolyte|tst', type: 'background' };

describe('ProfPicker', () => {
  it('names each level once, and says which is set', () => {
    render(
      <ProfPicker value={1} base={0} sources={[]} overridden={false} onChange={() => undefined} />,
    );
    expect(screen.getByRole('button', { name: 'Proficient', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'None', pressed: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expertise', pressed: false })).toBeTruthy();
  });

  it('names what in the build already grants it', () => {
    render(
      <ProfPicker
        value={1}
        base={1}
        sources={[ROGUE, ACOLYTE]}
        overridden={false}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByText('From Rogue (class) and Acolyte (background).')).toBeTruthy();
  });

  it('says when nothing in the build grants it', () => {
    render(
      <ProfPicker value={0} base={0} sources={[]} overridden={false} onChange={() => undefined} />,
    );
    expect(screen.getByText('Nothing in your build grants this.')).toBeTruthy();
  });

  it('names the sources a cleared pin goes back to', () => {
    render(
      <ProfPicker value={2} base={1} sources={[ACOLYTE]} overridden onChange={() => undefined} />,
    );
    expect(
      screen.getByRole('button', {
        name: 'Set manually. Clear to go back to proficient from Acolyte (background).',
      }),
    ).toBeTruthy();
  });
});
