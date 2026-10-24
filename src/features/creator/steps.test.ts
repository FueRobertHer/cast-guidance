import { describe, expect, it } from 'vitest';
import { normalizeStep, STEP_LABELS, STEPS, wizardDepth } from './steps';

describe('normalizeStep', () => {
  it('passes through every valid step', () => {
    for (const s of STEPS) expect(normalizeStep(s)).toBe(s);
  });

  it('falls back to the first step for invalid, empty, or missing values', () => {
    expect(normalizeStep('garbage')).toBe('basics');
    expect(normalizeStep('')).toBe('basics');
    expect(normalizeStep(null)).toBe('basics');
    expect(normalizeStep(undefined)).toBe('basics');
    expect(normalizeStep('REVIEW')).toBe('basics'); // case-sensitive
  });
});

describe('STEP_LABELS', () => {
  it('names every step', () => {
    for (const s of STEPS) expect(STEP_LABELS[s].trim(), s).not.toBe('');
  });
});

describe('wizardDepth', () => {
  it('reads the depth a step push recorded', () => {
    expect(wizardDepth({ creatorDepth: 4 })).toBe(4);
    expect(wizardDepth({ creatorDepth: 0 })).toBe(0);
  });

  it('reads anything else as the entry the wizard was entered on', () => {
    // History state survives reloads and can come from an older build.
    for (const state of [
      undefined,
      null,
      {},
      'x',
      { creatorDepth: '3' },
      { creatorDepth: -1 },
      { creatorDepth: 1.5 },
      { creatorDepth: Number.NaN },
    ]) {
      expect(wizardDepth(state), JSON.stringify(state)).toBe(0);
    }
  });
});
