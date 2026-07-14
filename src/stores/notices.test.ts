import { beforeEach, describe, expect, it } from 'vitest';
import { noticeStore, notify } from './notices';

beforeEach(() => noticeStore.setState({ notice: null, seq: 0 }));

describe('noticeStore', () => {
  it('notify() sets the current notice and bumps the sequence', () => {
    notify({ title: 'Saved', tone: 'good' });
    expect(noticeStore.getState().notice).toMatchObject({ title: 'Saved', tone: 'good' });
    expect(noticeStore.getState().seq).toBe(1);
  });

  it('bumps seq even for a repeated identical notice (re-triggers the toast)', () => {
    notify({ title: 'Rest', tone: 'info' });
    notify({ title: 'Rest', tone: 'info' });
    expect(noticeStore.getState().seq).toBe(2);
  });

  it('clear() drops the current notice', () => {
    notify({ title: 'X', tone: 'warn' });
    noticeStore.getState().clear();
    expect(noticeStore.getState().notice).toBeNull();
  });
});
