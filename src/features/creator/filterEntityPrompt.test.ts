import { describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { ALLOW_ALL, type SourcePolicy } from '@/data5e/sourceFilter';
import type { ChoicePrompt, EffectOrigin } from '@/engine/types';
import { filterEntityPrompt } from './OriginChoices';

const origin: EffectOrigin = { label: 'Fighter 4', uid: 'class|fighter', type: 'class' };

const registry = new EntityRegistry();
registry.addAll('feat', [
  { name: 'Alert', source: 'XPHB' },
  { name: 'Lucky', source: 'XPHB' },
  { name: 'Telekinetic', source: 'TCE' },
  { name: 'Strike of the Giants', source: 'BGG' },
]);
registry.addAll('optionalfeature', [
  { name: 'Defense', source: 'XPHB' },
  { name: 'Blind Fighting', source: 'TCE' },
]);

const promptOf = (kind: ChoicePrompt['kind'], ids: string[]): ChoicePrompt => ({
  id: 'p1',
  origin,
  kind,
  label: 'Pick one',
  count: 1,
  options: ids.map((id) => ({ id, label: id.split('|')[0] ?? id })),
});

const featPrompt = promptOf('feat', [
  'alert|xphb',
  'lucky|xphb',
  'telekinetic|tce',
  'strike of the giants|bgg',
]);

const idsOf = (p: ChoicePrompt) => p.options.map((o) => o.id);

describe('filterEntityPrompt', () => {
  it('leaves every option alone when no source is hidden', () => {
    const out = filterEntityPrompt(featPrompt, registry, '2024', ALLOW_ALL, undefined);
    expect(idsOf(out)).toHaveLength(4);
  });

  it('drops feats from hidden books', () => {
    const policy: SourcePolicy = { mode: 'only', sources: ['XPHB'] };
    const out = filterEntityPrompt(featPrompt, registry, '2024', policy, undefined);
    expect(idsOf(out)).toEqual(['alert|xphb', 'lucky|xphb']);
  });

  it('keeps an already-chosen feat from a hidden book', () => {
    const policy: SourcePolicy = { mode: 'only', sources: ['XPHB'] };
    const out = filterEntityPrompt(featPrompt, registry, '2024', policy, ['telekinetic|tce']);
    expect(idsOf(out)).toContain('telekinetic|tce');
  });

  it('narrows optional features too, which is where fighting styles live', () => {
    const policy: SourcePolicy = { mode: 'only', sources: ['XPHB'] };
    const prompt = promptOf('optionalfeature', ['defense|xphb', 'blind fighting|tce']);
    expect(idsOf(filterEntityPrompt(prompt, registry, '2024', policy, undefined))).toEqual([
      'defense|xphb',
    ]);
  });

  it('skips the source narrowing rather than leaving a mandatory pick empty', () => {
    // Some of these prompts must be answered and have no "show hidden" escape,
    // so hiding every book they offer has to fall back to the full list.
    const policy: SourcePolicy = { mode: 'only', sources: ['NothingHere'] };
    const out = filterEntityPrompt(featPrompt, registry, '2024', policy, undefined);
    expect(idsOf(out)).toHaveLength(4);
  });

  it('keeps options it cannot resolve to an entity', () => {
    const policy: SourcePolicy = { mode: 'only', sources: ['XPHB'] };
    const prompt = promptOf('feat', ['alert|xphb', 'homebrew thing|unknownbook']);
    expect(idsOf(filterEntityPrompt(prompt, registry, '2024', policy, undefined))).toContain(
      'homebrew thing|unknownbook',
    );
  });
});
