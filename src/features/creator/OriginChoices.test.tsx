// @vitest-environment jsdom
// "change" on a made pick used to delete the stored choice, dropping the reader
// on an empty prompt. It now re-opens the prompt with the picks still selected,
// and nothing is written until Confirm.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
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

    // A11Y-001: every made pick's button read "change"; the name says which.
    fireEvent.click(screen.getByRole('button', { name: 'Change Class skill proficiency' }));

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
    fireEvent.click(screen.getByRole('button', { name: /change/i }));

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
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
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
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Ability Score Improvement' }));
    fireEvent.click(confirmBtn());

    expect(doc.choices[asi.id]).toBe('asi');
    expect(doc.choices[`${asi.id}:feat`]).toBeUndefined();
  });

  it('keeps follow-up picks when the answer is re-confirmed unchanged', () => {
    const { doc } = harness({ [asi.id]: 'feat', [`${asi.id}:feat`]: ['tough|phb'] }, resolvedAsi);
    fireEvent.click(screen.getByRole('button', { name: /change/i }));
    fireEvent.click(confirmBtn());

    expect(doc.choices[`${asi.id}:feat`]).toEqual(['tough|phb']);
  });
});

describe("OriginChoices under a character's own sources (GAME-005)", () => {
  const registry = new EntityRegistry();
  registry.addAll('feat', [
    { name: 'Alert', source: 'PHB' },
    { name: 'Telekinetic', source: 'TCE' },
  ]);
  const featPick: ChoicePrompt = {
    id: 'class:fighter|phb:asi:4:feat',
    origin,
    kind: 'feat',
    label: 'Feat',
    count: 1,
    options: [
      // Described, as the engine's feat options are, so they render as the
      // readable list that carries advisories.
      { id: 'alert|phb', label: 'Alert', description: 'Always on the lookout.' },
      { id: 'telekinetic|tce', label: 'Telekinetic', description: 'Move things with your mind.' },
    ],
  };

  function renderFeats(allowedSources: string[], choices: CharacterDoc['choices'] = {}) {
    const doc = { rulesVersion: '2014', choices, allowedSources } as unknown as CharacterDoc;
    const sheet = { pending: [featPick], resolvedChoices: [] } as unknown as DerivedSheet;
    render(
      <OriginChoices
        sheet={sheet}
        doc={doc}
        update={vi.fn()}
        match={() => true}
        registry={registry}
      />,
    );
  }

  it("offers only the character's books, and every book when it has no list", () => {
    renderFeats(['PHB']);
    expect(screen.queryByText('Alert')).not.toBeNull();
    expect(screen.queryByText('Telekinetic')).toBeNull();
    cleanup();
    renderFeats([]);
    expect(screen.queryByText('Telekinetic')).not.toBeNull();
  });

  it('keeps a chosen feat from outside the list, and says where it is from', () => {
    renderFeats(['PHB'], { [featPick.id]: ['telekinetic|tce'] });
    const kept = screen.getByText('Telekinetic').closest('button');
    expect(kept?.getAttribute('aria-pressed')).toBe('true');
    expect(kept?.textContent).toContain("From a book outside this character's sources.");
    // A feat from a listed book carries no such cue.
    expect(screen.getByText('Alert').closest('button')?.textContent).not.toContain('outside');
  });
});
