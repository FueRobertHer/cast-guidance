// @vitest-environment jsdom
/**
 * Review finding 13: two "Uses per rest" cards left at their default name
 * shared the key `uses`, and the sheet kept the first pool and dropped the
 * other. A new pool is now named for what gives it, with a key no pool beside
 * it has. Proved through the real write path: cards added in the Workshop's
 * own editors, written out by `writeEntry`, merged as a homebrew file and
 * derived on a character holding both entries.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withBuiltInRules } from '@/data5e/builtInRules';
import { engineContextFor } from '@/data5e/engineAdapter';
import { mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { deriveSheet } from '@/engine/derive';
import { newCharacterDoc } from '@/engine/types';
import { cards } from './cards/actions';
import { writeEntry } from './copyWriter';
import { EntryEffects } from './EffectCards';
import { FeatureEditor } from './FeatureRow';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

type Json = Record<string, unknown>;

/** A species trait's effects after `taps` taps on Uses per rest in its editor. */
function traitWithPools(name: string, taps: number): Json {
  let value: Json = { type: 'entries', name, entries: ['It glows.'] };
  const view = render(
    <FeatureEditor
      value={value}
      noun="trait"
      onChange={(next) => {
        value = next;
      }}
      onRename={() => {}}
      readOnly={false}
      withEffects
    />,
  );
  for (let i = 0; i < taps; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Uses per rest' }));
    view.rerender(
      <FeatureEditor
        value={value}
        noun="trait"
        onChange={(next) => {
          value = next;
        }}
        onRename={() => {}}
        readOnly={false}
        withEffects
      />,
    );
  }
  cleanup();
  return value;
}

/** A feat's own effects after one tap on Uses per rest in its editor. */
function featWithPool(name: string): Json {
  let draft: Json = { name, entries: ['A feat.'] };
  render(
    <EntryEffects
      draft={draft}
      change={(patch) => {
        draft = { ...draft, ...patch };
      }}
      readOnly={false}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Uses per rest' }));
  cleanup();
  return draft;
}

const pools = (v: Json) =>
  ((v.castGuidance as Json | undefined)?.effects as Json[] | undefined)?.filter(
    (e) => e.kind === 'resource',
  ) ?? [];

/** A character with the brewed species and feat, derived from the merged file. */
async function sheetOf(trait: Json, feat: Json) {
  const race = writeEntry({
    draft: { name: 'Solari', size: ['M'], speed: 30, entries: [trait] },
    source: 'HBX',
    mode: 'full',
  });
  const written = writeEntry({ draft: feat, source: 'HBX', mode: 'full' });
  const file = {
    _meta: { sources: [{ json: 'HBX', abbreviation: 'HBX', full: 'My Brews' }] },
    race: [race],
    feat: [written],
  };
  const reg = normalizeDataset(new Map());
  mergeHomebrew(reg, new Map([['brews', file]]));
  const doc = newCharacterDoc('p', 'Pool Check', 'test');
  doc.race = { name: 'Solari', source: 'HBX' };
  doc.feats = [{ ref: { name: String(feat.name), source: 'HBX' }, instanceId: 'f0' }];
  return deriveSheet(doc, engineContextFor(await withBuiltInRules(reg)));
}

describe('a new pool is named for what gives it (finding 13)', () => {
  it("names a trait's pool for the trait, and a second one beside it apart", () => {
    const trait = traitWithPools('Solar Corona', 2);
    expect(pools(trait).map((p) => [p.label, p.key])).toEqual([
      ['Solar Corona', 'solar-corona'],
      ['Solar Corona 2', 'solar-corona-2'],
    ]);
  });

  it('keeps both entries’ pools on the sheet', async () => {
    const trait = traitWithPools('Solar Corona', 1);
    const feat = featWithPool('Radiant Ward');
    expect(pools(feat).map((p) => [p.label, p.key])).toEqual([['Radiant Ward', 'radiant-ward']]);
    const sheet = await sheetOf(trait, feat);
    expect(sheet.resources.map((r) => [r.label, r.origin])).toEqual(
      expect.arrayContaining([
        ['Solar Corona', 'Solari'],
        ['Radiant Ward', 'Radiant Ward'],
      ]),
    );
  });

  it('control: two pools left at one key are one pool on the sheet, as before', async () => {
    const uses = { kind: 'resource', key: 'uses', label: 'Uses', max: 1, reset: 'long' };
    const trait = {
      type: 'entries',
      name: 'Solar Corona',
      entries: ['It glows.'],
      castGuidance: { v: 1, effects: [uses] },
    };
    const feat = {
      name: 'Radiant Ward',
      entries: ['A feat.'],
      castGuidance: { v: 1, effects: [uses] },
    };
    const sheet = await sheetOf(trait, feat);
    expect(sheet.resources.filter((r) => r.key === 'uses')).toHaveLength(1);
  });

  it('gives a new short rest regain to the pool beside it, else Uses', () => {
    const regain = cards.find((k) => k.add === 'Uses back on a short rest');
    expect(regain?.make({ pools: ['solar-corona'] })).toEqual({
      kind: 'resourceRegain',
      key: 'solar-corona',
      amount: 1,
    });
    expect(regain?.make()).toEqual({ kind: 'resourceRegain', key: 'uses', amount: 1 });
  });

  it('names a pool Uses where what gives it has no name yet, apart from one there', () => {
    const pool = cards.find((k) => k.add === 'Uses per rest');
    expect(pool?.make({ name: '  ', pools: ['uses'] })).toMatchObject({
      key: 'uses-2',
      label: 'Uses 2',
    });
    expect(pool?.make()).toMatchObject({ key: 'uses', label: 'Uses' });
  });

  it('keys a pool named in any script apart, never as the shared Uses', () => {
    const pool = cards.find((k) => k.add === 'Uses per rest');
    expect(pool?.make({ name: '火の輪' })).toMatchObject({ key: '火の輪', label: '火の輪' });
  });

  it("names a copy's new pool apart from what its original's may be keyed", () => {
    const pool = cards.find((k) => k.add === 'Uses per rest');
    expect(pool?.make({ name: 'Breath Weapon', copy: true })).toMatchObject({
      key: 'breath-weapon-uses',
      label: 'Breath Weapon uses',
    });
  });
});
