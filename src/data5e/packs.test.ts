import { describe, expect, it } from 'vitest';
import { classPackId, ESSENTIALS_FILES, spellsPackId } from './packs';

describe('pack id helpers', () => {
  it('namespaces and lowercases class/spell pack ids', () => {
    expect(classPackId('Wizard')).toBe('class:wizard');
    expect(spellsPackId('XGE')).toBe('spells:xge');
  });

  it('essentials includes the class and spells indexes needed to resolve dynamic packs', () => {
    expect(ESSENTIALS_FILES).toContain('class/index.json');
    expect(ESSENTIALS_FILES).toContain('spells/index.json');
  });
});
