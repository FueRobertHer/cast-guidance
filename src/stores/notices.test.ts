import { beforeEach, describe, expect, it } from 'vitest';
import { errorText, noticeStore, notify, notifyFailure } from './notices';

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

  it('notifyFailure names the action and carries the reason', () => {
    notifyFailure('Rename', new Error('QuotaExceededError'));
    expect(noticeStore.getState().notice).toEqual({
      title: 'Rename failed',
      detail: 'QuotaExceededError',
      tone: 'warn',
    });
  });

  it('notifyFailure survives a thrown non-Error', () => {
    notifyFailure('Delete', 'gone');
    expect(noticeStore.getState().notice?.detail).toBe('gone');
  });

  it('errorText reads anything that can be thrown', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText('boom')).toBe('boom');
    expect(errorText(undefined)).toBe('undefined');
  });

  it('clear() drops the current notice', () => {
    notify({ title: 'X', tone: 'warn' });
    noticeStore.getState().clear();
    expect(noticeStore.getState().notice).toBeNull();
  });
});
