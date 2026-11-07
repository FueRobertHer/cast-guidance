// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CastButton } from './CastButton';

afterEach(cleanup);

const PARALYZED = { looks: ['Paralyzed'], ignored: false } as const;

describe('CastButton', () => {
  it('keeps its name and its action, plain or worn', () => {
    const onClick = vi.fn();
    render(<CastButton wear={PARALYZED} aria-label="Cast Shield" onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Cast Shield' });
    expect(button.textContent).toBe('Cast');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('wears what it is given, on the fill inside its 44px target', () => {
    const { container } = render(<CastButton wear={PARALYZED} aria-label="Cast Shield" />);
    expect(container.querySelector('.cx')?.className).toContain('cx-at-cast');
    expect(container.querySelector('.cx')?.className).toContain('cx-paralyzed');
    expect(screen.getByRole('button').className).toContain('min-h-tap');
  });

  it('never flashes when pressed, because it does not roll', () => {
    const { container } = render(<CastButton wear={PARALYZED} aria-label="Cast Shield" />);
    fireEvent.click(screen.getByRole('button'));
    expect(container.querySelector('.cx-surge')).toBeNull();
  });

  it('stays plain when it can not be pressed, so it still reads as disabled', () => {
    const { container } = render(<CastButton wear={PARALYZED} aria-label="Cast Shield" disabled />);
    expect(container.querySelector('.cx')?.className).not.toContain('cx-on');
    expect(screen.getByRole<HTMLButtonElement>('button').disabled).toBe(true);
  });
});
