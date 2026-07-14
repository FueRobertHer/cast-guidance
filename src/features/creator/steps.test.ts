import { describe, expect, it } from 'vitest';
import { normalizeStep, STEPS } from './steps';

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
