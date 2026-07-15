// @vitest-environment jsdom
// GAME-005: an option flagged with an unmet prerequisite shows an accessible,
// color-independent advisory cue but stays selectable (guidance, not gatekeeping).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChoicePrompt } from '@/engine/types';
import { ChoicePromptRenderer } from './ChoicePromptRenderer';

afterEach(cleanup);

const prompt: ChoicePrompt = {
  id: 'class:warrior|tst:asi:4:feat',
  origin: { label: 'Warrior', uid: 'class|warrior', type: 'class' },
  kind: 'feat',
  label: 'Level 4: choose a feat',
  count: 1,
  options: [
    {
      id: 'elemental adept|tst',
      label: 'Elemental Adept (TST)',
      description: 'Prereq: spellcasting. Ignore resistance.',
      advisory: 'You may not meet this prerequisite.',
    },
    { id: 'tough|phb', label: 'Tough (PHB)', description: '+2 hp per level.' },
    {
      id: 'blocked|tst',
      label: 'Blocked (TST)',
      description: 'Already have it.',
      disabled: { reason: 'Already taken (not repeatable)' },
    },
  ],
};

describe('ChoicePromptRenderer advisory cue', () => {
  it('renders an accessible advisory but keeps the option selectable', () => {
    const onChange = vi.fn();
    render(<ChoicePromptRenderer prompt={prompt} value={undefined} onChange={onChange} />);

    // The cue is visible text (color-independent — the ⚠ glyph + words carry it).
    expect(screen.getByText(/You may not meet this prerequisite/)).toBeTruthy();

    // The advisory option is NOT disabled and selecting it fires onChange.
    const advisoryBtn = screen.getByRole('button', { name: /Elemental Adept/ });
    expect(advisoryBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(advisoryBtn);
    expect(onChange).toHaveBeenCalledWith(['elemental adept|tst']);
  });

  it('still disables a truly blocked option', () => {
    const onChange = vi.fn();
    render(<ChoicePromptRenderer prompt={prompt} value={undefined} onChange={onChange} />);
    const blocked = screen.getByRole('button', { name: /Blocked/ });
    expect(blocked.hasAttribute('disabled')).toBe(true);
    fireEvent.click(blocked);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows no advisory on options without one', () => {
    render(<ChoicePromptRenderer prompt={prompt} value={undefined} onChange={vi.fn()} />);
    const tough = screen.getByRole('button', { name: /Tough/ });
    expect(tough.textContent).not.toMatch(/may not meet/i);
  });
});
