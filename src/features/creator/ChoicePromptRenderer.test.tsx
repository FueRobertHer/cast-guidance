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

    // The advisory option is NOT disabled and selecting it reaches the doc
    // once confirmed.
    const advisoryBtn = screen.getByRole('button', { name: /Elemental Adept/ });
    expect(advisoryBtn.hasAttribute('disabled')).toBe(false);
    fireEvent.click(advisoryBtn);
    fireEvent.click(screen.getByRole('button', { name: /^Confirm/ }));
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

const skills: ChoicePrompt = {
  id: 'background:sage|phb:skill:0',
  origin: { label: 'Sage', uid: 'background|sage', type: 'background' },
  kind: 'skill',
  label: 'Skill proficiencies',
  count: 2,
  options: [
    { id: 'Arcana', label: 'Arcana' },
    { id: 'History', label: 'History' },
    { id: 'Insight', label: 'Insight' },
  ],
};

const confirmBtn = () => screen.getByRole('button', { name: /^Confirm/ });

describe('ChoicePromptRenderer confirm gate', () => {
  it('stages taps locally and only commits on Confirm', () => {
    const onChange = vi.fn();
    render(<ChoicePromptRenderer prompt={skills} value={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Arcana' }));
    expect(onChange).not.toHaveBeenCalled();
    // One short of the count, so there is nothing to confirm yet.
    expect(confirmBtn().hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(confirmBtn());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['Arcana', 'History']);
  });

  it('lets a mis-tap be undone before it reaches the character', () => {
    const onChange = vi.fn();
    render(<ChoicePromptRenderer prompt={skills} value={undefined} onChange={onChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Arcana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Arcana' }));
    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    fireEvent.click(screen.getByRole('button', { name: 'Insight' }));
    fireEvent.click(confirmBtn());

    expect(onChange).toHaveBeenCalledExactlyOnceWith(['History', 'Insight']);
  });

  it('re-opens an existing pick with its options still selected', () => {
    const onChange = vi.fn();
    render(
      <ChoicePromptRenderer prompt={skills} value={['Arcana', 'History']} onChange={onChange} />,
    );

    // Already complete, so Confirm is live and swapping is deselect-then-pick
    // rather than starting from an empty slate.
    expect(confirmBtn().hasAttribute('disabled')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Insight' }));
    // Both slots are still full, so the stray tap is ignored.
    fireEvent.click(confirmBtn());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['Arcana', 'History']);
    onChange.mockClear();

    fireEvent.click(screen.getByRole('button', { name: 'History' }));
    expect(confirmBtn().hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Insight' }));
    fireEvent.click(confirmBtn());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['Arcana', 'Insight']);
  });

  it('offers Cancel only when the caller can back out', () => {
    const onCancel = vi.fn();
    const { unmount } = render(
      <ChoicePromptRenderer prompt={skills} value={undefined} onChange={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    unmount();

    render(
      <ChoicePromptRenderer
        prompt={skills}
        value={['Arcana', 'History']}
        onChange={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('marks staged options with aria-pressed, not colour alone', () => {
    render(<ChoicePromptRenderer prompt={skills} value={undefined} onChange={vi.fn()} />);
    const pressed = () =>
      screen.getByRole('button', { name: 'Arcana' }).getAttribute('aria-pressed');
    expect(pressed()).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'Arcana' }));
    expect(pressed()).toBe('true');
  });

  it('confirms at the attainable count when options are disabled below it', () => {
    // A pick-2 language prompt where only one option is still selectable (the
    // rest are already known). Gating on count would strand it forever.
    const onChange = vi.fn();
    const scarce: ChoicePrompt = {
      ...skills,
      kind: 'language',
      count: 2,
      options: [
        { id: 'Common', label: 'Common', disabled: { reason: 'You already speak Common' } },
        { id: 'Elvish', label: 'Elvish', disabled: { reason: 'You already speak Elvish' } },
        { id: 'Orc', label: 'Orc' },
      ],
    };
    render(<ChoicePromptRenderer prompt={scarce} value={undefined} onChange={onChange} />);

    expect(confirmBtn().hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('1 more to pick')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Orc' }));
    expect(confirmBtn().hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('Only 1 of 2 still available.')).toBeTruthy();

    fireEvent.click(confirmBtn());
    expect(onChange).toHaveBeenCalledExactlyOnceWith(['Orc']);
  });

  it('never confirms a prompt with nothing selectable at all', () => {
    const onChange = vi.fn();
    const none: ChoicePrompt = {
      ...skills,
      count: 1,
      options: [{ id: 'Common', label: 'Common', disabled: { reason: 'Already known' } }],
    };
    render(<ChoicePromptRenderer prompt={none} value={undefined} onChange={onChange} />);
    expect(confirmBtn().hasAttribute('disabled')).toBe(true);
    fireEvent.click(confirmBtn());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('stores a single asiOrFeat pick as a bare string', () => {
    const onChange = vi.fn();
    const asi: ChoicePrompt = {
      id: 'class:warrior|tst:asi:4',
      origin: { label: 'Warrior', uid: 'class|warrior', type: 'class' },
      kind: 'asiOrFeat',
      label: 'Level 4: ASI or feat',
      count: 1,
      options: [
        { id: 'asi', label: 'Ability Score Improvement' },
        { id: 'feat', label: 'Take a feat' },
      ],
    };
    render(<ChoicePromptRenderer prompt={asi} value={undefined} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Take a feat' }));
    fireEvent.click(confirmBtn());
    expect(onChange).toHaveBeenCalledExactlyOnceWith('feat');
  });
});
