import { describe, expect, it } from 'vitest';
import { VOCABULARY } from '@/theme/vocabulary';
import { EDITOR_GROUPS } from './groups';

describe('the theme editor groups', () => {
  it('show every token exactly once', () => {
    const shown = EDITOR_GROUPS.flatMap((g) => [...g.tokens, ...(g.more?.tokens ?? [])]);
    expect([...shown].sort()).toEqual(VOCABULARY.map((t) => t.name).sort());
  });
});
