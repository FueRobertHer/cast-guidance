// @vitest-environment jsdom
// The boot routine flips `phase` to 'working' before it knows whether there is
// anything to download, and leaves it there until the whole pack queue drains.
// On an installed PWA that meant ~1.2s of "Downloading game data… 0/0" for a
// download that had already happened, so the banner is gated on real work.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { dataStatusStore } from '@/stores/dataStatus';
import { DataBanner } from './DataBanner';

afterEach(() => {
  cleanup();
  dataStatusStore.setState({
    phase: 'idle',
    filesDone: 0,
    filesTotal: 0,
    error: undefined,
  });
});

describe('DataBanner', () => {
  it('stays silent while working with nothing to fetch', () => {
    dataStatusStore.setState({ phase: 'working', filesDone: 0, filesTotal: 0 });
    render(<DataBanner />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('appears as soon as there are files to count', () => {
    dataStatusStore.setState({ phase: 'working', filesDone: 3, filesTotal: 10 });
    render(<DataBanner />);
    const bar = screen.getByRole('progressbar');
    expect(bar.textContent).toContain('3/10');
    expect(bar.getAttribute('aria-valuenow')).toBe('3');
    expect(bar.getAttribute('aria-valuemax')).toBe('10');
  });

  it('stays silent once the queue is done', () => {
    dataStatusStore.setState({ phase: 'done', filesDone: 10, filesTotal: 10 });
    render(<DataBanner />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('reports a failure even though no files were counted', () => {
    // The error path must not inherit the work gate: a download that failed
    // before addTotal ran is exactly when the user needs the retry.
    dataStatusStore.setState({ phase: 'error', filesTotal: 0, error: 'offline' });
    render(<DataBanner />);
    expect(screen.getByRole('alert').textContent).toContain('offline');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});
