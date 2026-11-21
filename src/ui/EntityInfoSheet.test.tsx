// @vitest-environment jsdom
// Review item 5: a class's info sheet says what the class gives (its
// proficiencies and its features by level), and has a Close on screen.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityInfoSheet } from './EntityInfoSheet';

const FEATURES = [
  {
    name: 'Cantrip Formulas',
    className: 'Wizard',
    level: 3,
    source: 'TCE',
    isClassFeatureVariant: true,
  },
];

vi.mock('@/data5e/hooks', () => ({
  useRegistry: () => ({
    get: () => undefined,
    byType: (type: string) => (type === 'classFeature' ? FEATURES : []),
    changeOf: () => undefined,
  }),
}));

afterEach(cleanup);

const wizard = {
  name: 'Wizard',
  source: 'PHB',
  hd: { number: 1, faces: 6 },
  startingProficiencies: { weapons: ['daggers'] },
  classFeatures: ['Spellcasting|Wizard||1', 'Cantrip Formulas|Wizard||3|TCE'],
};

describe('a class info sheet', () => {
  it('lists what the class gives, and its Close hands focus back to the button', async () => {
    render(
      <EntityInfoSheet
        type="class"
        entity={wizard}
        trigger={<button type="button">Wizard details</button>}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Wizard details' }));
    const sheet = await screen.findByRole('dialog');
    expect(screen.getByRole('heading', { name: 'Proficiencies' })).toBeTruthy();
    expect(screen.getByText('Cantrip Formulas (optional)')).toBeTruthy();
    expect(sheet.textContent).toContain('daggers');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Wizard details' })),
    );
  });
});
