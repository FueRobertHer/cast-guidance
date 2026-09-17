// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DecodeBoundary } from './DecodeBoundary';

function Boom({ message }: { message: string }): React.ReactElement {
  throw new Error(message);
}

beforeEach(() => {
  // React writes the caught error to the console itself; the test asserts on
  // what the user sees, and a passing run should look like one.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DecodeBoundary', () => {
  it('keeps a record that throws from taking its neighbours with it', () => {
    render(
      <div>
        <DecodeBoundary label="This item">
          <Boom message="Cannot read properties of null" />
        </DecodeBoundary>
        <p>Sunblade</p>
      </div>,
    );

    expect(screen.getByText(/This item could not be read/)).toBeTruthy();
    expect(screen.getByText('Cannot read properties of null')).toBeTruthy();
    expect(screen.getByText('Sunblade')).toBeTruthy();
  });

  it('still offers the way out of the failed record', () => {
    const onDelete = vi.fn();
    render(
      <DecodeBoundary
        label="This item"
        action={
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        }
      >
        <Boom message="bad record" />
      </DecodeBoundary>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('tries again when resetKey says the subject may have changed', () => {
    // List keys are positional, so a boundary that caught for one record can
    // be handed to another when the list moves. Holding the first record's
    // failure over the second would mark a healthy record unreadable forever.
    const { rerender } = render(
      <DecodeBoundary label="This item" resetKey={2}>
        <Boom message="bad record" />
      </DecodeBoundary>,
    );
    expect(screen.getByText(/could not be read/)).toBeTruthy();

    rerender(
      <DecodeBoundary label="This item" resetKey={1}>
        <p>Sunblade</p>
      </DecodeBoundary>,
    );

    expect(screen.getByText('Sunblade')).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });

  it('holds the failure while resetKey is unchanged', () => {
    const { rerender } = render(
      <DecodeBoundary label="This item" resetKey={2}>
        <Boom message="bad record" />
      </DecodeBoundary>,
    );
    rerender(
      <DecodeBoundary label="This item" resetKey={2}>
        <Boom message="bad record" />
      </DecodeBoundary>,
    );

    expect(screen.getByText(/could not be read/)).toBeTruthy();
  });

  it('renders its children untouched when nothing throws', () => {
    render(
      <DecodeBoundary label="This item">
        <p>Sunblade</p>
      </DecodeBoundary>,
    );

    expect(screen.getByText('Sunblade')).toBeTruthy();
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});
