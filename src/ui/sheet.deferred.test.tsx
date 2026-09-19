// @vitest-environment jsdom
// Against the real vaul, because everything under test here is about what vaul
// does on mount: a `Drawer.Root` installs a `window` scroll listener and a
// `window` resize listener whether or not it is open, and it refuses to
// animate a drawer that was born open. The info sheets are rendered one per
// row, so both of those are per-row costs on a list of hundreds.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet, SheetStandIn, useSheetOpenOnMount } from './sheet';

afterEach(cleanup);

function Live() {
  const [open, setOpen] = useSheetOpenOnMount();
  return (
    <Sheet.Root open={open} onOpenChange={setOpen}>
      <Sheet.Trigger asChild>
        <button type="button">Open it</button>
      </Sheet.Trigger>
      <Sheet.Portal>
        <Sheet.Overlay />
        <Sheet.Content>
          <Sheet.Title>Inside</Sheet.Title>
        </Sheet.Content>
      </Sheet.Portal>
    </Sheet.Root>
  );
}

/** The shape every info sheet now has: a trigger, and the sheet behind it. */
function Deferred({ onTriggerClick }: { onTriggerClick?: () => void }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    return (
      <SheetStandIn
        trigger={
          <button type="button" onClick={onTriggerClick}>
            Open it
          </button>
        }
        onArm={() => setArmed(true)}
      />
    );
  }
  return <Live />;
}

describe('a sheet deferred until its trigger is used', () => {
  it('costs no window listeners until it is used', () => {
    const spy = vi.spyOn(window, 'addEventListener');
    const listenedTypes = () => spy.mock.calls.map(([type]) => String(type));
    render(
      <div>
        {Array.from({ length: 25 }, (_, i) => `row-${i}`).map((id) => (
          <Deferred key={id} />
        ))}
      </div>,
    );
    expect(listenedTypes()).not.toContain('scroll');
    expect(listenedTypes()).not.toContain('resize');
    spy.mockRestore();
  });

  it('opens on the first press, with the trigger still announcing itself', async () => {
    render(<Deferred />);
    const button = screen.getByRole('button', { name: 'Open it' });
    // What Radix's own trigger says while closed, so deferring costs the
    // button nothing it used to advertise.
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByText('Inside')).toBeTruthy();
  });

  it('still runs the trigger’s own click handler', () => {
    const onTriggerClick = vi.fn();
    render(<Deferred onTriggerClick={onTriggerClick} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    expect(onTriggerClick).toHaveBeenCalledOnce();
  });

  it('slides in rather than appearing', async () => {
    // The reason this does not use `defaultOpen`. vaul starts `shouldAnimate`
    // at `!defaultOpen` and writes it out as `data-vaul-animate`, which its
    // own stylesheet turns into `animation: none !important`, so a sheet born
    // open never slides. It has to come up like one whose trigger was on
    // screen all along.
    render(<Deferred />);
    fireEvent.click(screen.getByRole('button', { name: 'Open it' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy());
    expect(screen.getByRole('dialog').getAttribute('data-vaul-animate')).toBe('true');
  });
});
