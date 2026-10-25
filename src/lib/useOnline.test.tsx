// @vitest-environment jsdom
// PWA-001: pages choose their offline copy from this, so it has to follow the
// browser's online and offline events, not just read the flag once.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isOnline, useOnline, useOnReconnect } from './useOnline';

function Probe() {
  return <p>{useOnline() ? 'online' : 'offline'}</p>;
}

function setOnLine(value: boolean) {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(value);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useOnline', () => {
  it('reads the browser flag', () => {
    setOnLine(false);
    expect(isOnline()).toBe(false);
    render(<Probe />);
    expect(screen.getByText('offline')).toBeTruthy();
  });

  it('follows the online and offline events', () => {
    setOnLine(true);
    render(<Probe />);
    expect(screen.getByText('online')).toBeTruthy();

    setOnLine(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('offline')).toBeTruthy();

    setOnLine(true);
    act(() => {
      window.dispatchEvent(new Event('online'));
    });
    expect(screen.getByText('online')).toBeTruthy();
  });
});

describe('useOnReconnect', () => {
  function Reconnect({ on }: { on: () => void }) {
    useOnReconnect(on);
    return null;
  }

  it('runs on each return online, with the latest callback, and stops on unmount', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender, unmount } = render(<Reconnect on={first} />);
    window.dispatchEvent(new Event('offline'));
    expect(first).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('online'));
    expect(first).toHaveBeenCalledOnce();

    rerender(<Reconnect on={second} />);
    window.dispatchEvent(new Event('online'));
    expect(second).toHaveBeenCalledOnce();
    expect(first).toHaveBeenCalledOnce();

    unmount();
    window.dispatchEvent(new Event('online'));
    expect(second).toHaveBeenCalledOnce();
  });
});
