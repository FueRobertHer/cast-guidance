// @vitest-environment jsdom
// UX-004: the undo offer is a status line with a named Undo button, and taking
// the offer must not drop keyboard focus to the page body when the button goes.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { namelessControls } from '../../tests-fixtures/a11y';
import { UndoBar } from './UndoBar';

afterEach(cleanup);

function Harness({ onUndo }: { onUndo: () => void }) {
  const [pending, setPending] = useState<{ title: string; detail?: string } | null>({
    title: 'Species: Testfolk → Dragonborn',
    detail: '1 Testfolk pick cleared',
  });
  const [undone, setUndone] = useState<string | null>(null);
  return (
    <UndoBar
      pending={pending}
      undone={undone}
      onUndo={() => {
        onUndo();
        setUndone(pending?.title ?? null);
        setPending(null);
      }}
    />
  );
}

describe('UndoBar', () => {
  it('says what changed in a status line, with an Undo button named for it', () => {
    render(<Harness onUndo={() => undefined} />);
    const status = screen.getByRole('status');
    expect(status.textContent).toContain(
      'Species: Testfolk → Dragonborn · 1 Testfolk pick cleared',
    );
    const button = screen.getByRole('button', { name: 'Undo: Species: Testfolk → Dragonborn' });
    expect(button.textContent).toBe('Undo');
    expect(namelessControls()).toEqual([]);
  });

  it('undoes, keeps focus in the bar, and says what it undid', () => {
    const onUndo = vi.fn();
    render(<Harness onUndo={onUndo} />);
    const button = screen.getByRole('button', { name: /^Undo/ });
    button.focus();
    fireEvent.click(button);
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^Undo/ })).toBeNull();
    const status = screen.getByRole('status');
    expect(document.activeElement).toBe(status);
    expect(status.textContent).toBe('Undone: Species: Testfolk → Dragonborn');
  });

  it('moves focus only once the bar says what was undone', () => {
    // Focused any earlier, a screen reader reads the stale offer and then
    // announces again when the text changes.
    render(<Harness onUndo={() => undefined} />);
    const status = screen.getByRole('status');
    let heardOnFocus = '';
    status.addEventListener('focus', () => {
      heardOnFocus = status.textContent ?? '';
    });
    fireEvent.click(screen.getByRole('button', { name: /^Undo/ }));
    expect(heardOnFocus).toBe('Undone: Species: Testfolk → Dragonborn');
  });
});
