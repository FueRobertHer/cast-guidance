import { afterEach, describe, expect, it } from 'vitest';
import { advModeStore, currentAdvantage } from './advMode';

afterEach(() => advModeStore.setState({ mode: 'normal' }));

describe('advMode', () => {
  it('defaults to normal', () => {
    expect(advModeStore.getState().mode).toBe('normal');
    expect(currentAdvantage()).toBeUndefined();
  });

  it('set() switches the sticky mode', () => {
    advModeStore.getState().set('adv');
    expect(currentAdvantage()).toBe('adv');
    advModeStore.getState().set('dis');
    expect(currentAdvantage()).toBe('dis');
    advModeStore.getState().set('normal');
    expect(currentAdvantage()).toBeUndefined();
  });
});
