// @vitest-environment jsdom
// PWA-001 with A11Y-002: a data failure panel is the alert for its failure
// unless the shell's DataBanner is alerting that outage. Whoever speaks, the
// failure is said once, and never by nobody.
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { dataStatusStore } from '@/stores/dataStatus';
import { dbLifecycleStore } from '@/stores/dbLifecycle';
import { useFailureAlert } from './failureAlert';

function Panel() {
  return <p role={useFailureAlert() ? 'alert' : undefined}>panel</p>;
}

const role = () => screen.getByText('panel').getAttribute('role');
const queue = (phase: 'idle' | 'done' | 'error', failedTag?: string) =>
  act(() =>
    dataStatusStore.setState({ phase, error: phase === 'error' ? 'x' : undefined, failedTag }),
  );

afterEach(() => {
  cleanup();
  dataStatusStore.setState({ phase: 'idle', error: undefined, failedTag: undefined });
  dbLifecycleStore.setState({ state: 'open' });
});

describe('useFailureAlert', () => {
  it('is the alert when no banner speaks: a repair pressed offline with the queue done', () => {
    queue('done');
    render(<Panel />);
    expect(role()).toBe('alert');
  });

  it('is the alert beside a failed version install, which is not this outage', () => {
    queue('error', 'v2.33.0');
    render(<Panel />);
    expect(role()).toBe('alert');
  });

  it('is a visual while the banner alerts a failed download, and stays one', () => {
    queue('error');
    render(<Panel />);
    expect(role()).toBeNull();
    // The banner retrying, or done: a late role would re-read stale words.
    queue('idle');
    expect(role()).toBeNull();
  });

  it('gives the role up when the banner starts alerting after it, for good', () => {
    render(<Panel />);
    expect(role()).toBe('alert');
    queue('error');
    expect(role()).toBeNull();
    queue('done');
    expect(role()).toBeNull();
  });

  it('is the alert when the database is closed, which hides the banner', () => {
    dbLifecycleStore.setState({ state: 'deleted' });
    queue('error');
    render(<Panel />);
    expect(role()).toBe('alert');
  });
});
