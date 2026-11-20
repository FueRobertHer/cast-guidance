// @vitest-environment jsdom
/**
 * U4b's note card (ADR-002, board 4): its words, read back from what it wrote,
 * and listed among the sheet's notes after what gives it.
 */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  boxValue,
  change,
  makeCard,
  noProblems,
  renderCards,
  sheetWith,
} from '../../../../tests-fixtures/cardSheet';
import { moreKinds } from '../EffectCards';
import { cards } from './words';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

describe('Note', () => {
  const T = 'Note';

  it("writes its words, and the sheet's notes list them after what gives it", () => {
    const start = makeCard(cards, T);
    noProblems([start]);
    const note = renderCards([start]);
    expect(screen.getByText('Ask the DM before using this')).toBeTruthy();
    change(`${T}: Note`, 'Only in moonlight');
    expect(note.written()).toEqual([{ kind: 'note', text: 'Only in moonlight' }]);
    noProblems(note.written());
    expect(sheetWith([]).warnings).not.toContain('Card Feat: Only in moonlight');
    expect(sheetWith(note.written()).warnings).toContain('Card Feat: Only in moonlight');

    cleanup();
    renderCards(note.written());
    expect(boxValue(`${T}: Note`)).toBe('Only in moonlight');
  });

  it('is left out of play, where the reminder is offered', () => {
    const inPlay = moreKinds({ inPlay: true, spells: false });
    expect(inPlay).toContain('Reminder');
    expect(inPlay).not.toContain('Note');
    expect(moreKinds({ inPlay: false, spells: false })).toContain('Note');
  });
});
