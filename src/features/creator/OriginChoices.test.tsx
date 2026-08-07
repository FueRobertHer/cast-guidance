// @vitest-environment jsdom
// "change" on a made pick used to delete the stored choice, dropping the reader
// on an empty prompt. It now re-opens the prompt with the picks still selected,
// and nothing is written until Confirm.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDoc, ChoicePrompt, DerivedSheet } from '@/engine/types';
import { OriginChoices } from './OriginChoices';

afterEach(cleanup);

const origin = { label: 'Rogue', uid: 'class|rogue', type: 'class' } as const;

const skillPrompt: ChoicePrompt = {
  id: 'class:rogue|phb:skill:0',
  origin,
  kind: 'skill',
  label: 'Class skill proficiency',
  count: 2,
  options: [
    { id: 'Acrobatics', label: 'Acrobatics' },
    { id: 'Stealth', label: 'Stealth' },
    { id: 'Perception', label: 'Perception' },
  ],
};

/**
 * OriginChoices reads only `pending` / `resolvedChoices` off the sheet and
 * `choices` / `rulesVersion` off the doc, so the rest of those large shapes is
 * irrelevant here and left off deliberately.
 */
function harness(
  choices: CharacterDoc['choices'],
  resolvedChoices: DerivedSheet['resolvedChoices'],
  pending: ChoicePrompt[] = [],
) {
  const doc = { rulesVersion: '2014', choices } as unknown as CharacterDoc;
  const sheet = { pending, resolvedChoices } as unknown as DerivedSheet;
  const update = vi.fn((recipe: (d: CharacterDoc) => void) => recipe(doc));
  render(<OriginChoices sheet={sheet} doc={doc} update={update} match={() => true} />);
  return { doc, update };
}

const resolvedSkills = [{ prompt: skillPrompt, selected: ['Acrobatics', 'Stealth'] }];
const confirmBtn = () => screen.getByRole('button', { name: /^Confirm/ });

describe('OriginChoices editing a made pick', () => {
  it('opens the editor with the existing picks still selected, writing nothing', () => {
    const { doc, update } = harness(
      { [skillPrompt.id]: ['Acrobatics', 'Stealth'] },
      resolvedSkills,
    );

    fireEvent.click(screen.getByRole('button', { name: /change/ }));

    // The regression this guards: "change" must not clear the stored value.
    expect(update).not.toHaveBeenCalled();
    expect(doc.choices[skillPrompt.id]).toEqual(['Acrobatics', 'Stealth']);
    expect(screen.getByRole('button', { name: 'Acrobatics' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Stealth' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('button', { name: 'Perception' }).getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('swaps one pick and keeps the other', () => {
    const { doc } = harness({ [skillPrompt.id]: ['Acrobatics', 'Stealth'] }, resolvedSkills);
    fireEvent.click(screen.getByRole('button', { name: /change/ }));

    fireEvent.click(screen.getByRole('button', { name: 'Stealth' }));
    expect(confirmBtn().hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Perception' }));
    fireEvent.click(confirmBtn());

    expect(doc.choices[skillPrompt.id]).toEqual(['Acrobatics', 'Perception']);
  });

  it('discards the edit on Cancel', () => {
    const { doc, update } = harness(
      { [skillPrompt.id]: ['Acrobatics', 'Stealth'] },
      resolvedSkills,
    );
    fireEvent.click(screen.getByRole('button', { name: /change/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Stealth' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(update).not.toHaveBeenCalled();
    expect(doc.choices[skillPrompt.id]).toEqual(['Acrobatics', 'Stealth']);
    // Back to the compact summary row.
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByText('Acrobatics, Stealth')).toBeTruthy();
  });

  it('re-confirming an unchanged pick writes nothing at all', () => {
    const { update } = harness({ [skillPrompt.id]: ['Acrobatics', 'Stealth'] }, resolvedSkills);
    fireEvent.click(screen.getByRole('button', { name: /change/ }));
    fireEvent.click(confirmBtn());

    // No save, and no blank history entry for a no-op.
    expect(update).not.toHaveBeenCalled();
    expect(screen.getByText('Acrobatics, Stealth')).toBeTruthy();
  });
});

describe('OriginChoices dependent choices', () => {
  const asi: ChoicePrompt = {
    id: 'class:rogue|phb:asi:4',
    origin,
    kind: 'asiOrFeat',
    label: 'Level 4',
    count: 1,
    options: [
      { id: 'asi', label: 'Ability Score Improvement' },
      { id: 'feat', label: 'Take a feat' },
    ],
  };
  const resolvedAsi = [{ prompt: asi, selected: ['feat'] }];

  it('clears follow-up picks when the answer they hang off changes', () => {
    const { doc } = harness({ [asi.id]: 'feat', [`${asi.id}:feat`]: ['tough|phb'] }, resolvedAsi);
    fireEvent.click(screen.getByRole('button', { name: /change/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ability Score Improvement' }));
    fireEvent.click(confirmBtn());

    expect(doc.choices[asi.id]).toBe('asi');
    expect(doc.choices[`${asi.id}:feat`]).toBeUndefined();
  });

  it('keeps follow-up picks when the answer is re-confirmed unchanged', () => {
    const { doc } = harness({ [asi.id]: 'feat', [`${asi.id}:feat`]: ['tough|phb'] }, resolvedAsi);
    fireEvent.click(screen.getByRole('button', { name: /change/ }));
    fireEvent.click(confirmBtn());

    expect(doc.choices[`${asi.id}:feat`]).toEqual(['tough|phb']);
  });
});
