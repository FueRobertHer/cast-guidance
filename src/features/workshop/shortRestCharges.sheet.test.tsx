// @vitest-environment jsdom
/**
 * Item charges that come back on a short rest, from the Workshop to the sheet:
 * each item is made in the item editor as a player makes one (Charges,
 * Regains them, How many), written as the Workshop saves it (`writeEntry`),
 * merged as a player's file is (`mergeHomebrew`) into a release registry with
 * the built-in rules, and carried by a character whose derived sheet the rests
 * run on. An item whose fields alone say a short rest (a file from elsewhere,
 * no `charges` effect) goes the same way.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withBuiltInRules } from '@/data5e/builtInRules';
import { engineContextFor } from '@/data5e/engineAdapter';
import { EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { deriveSheet } from '@/engine/derive';
import { readOwnEffects } from '@/engine/effects/mechanics';
import { longRestRecovery, shortRestRecovery } from '@/engine/rest';
import { newCharacterDoc } from '@/engine/types';
import { backCaption } from '@/features/sheet/rest';
import { writeEntry } from './copyWriter';

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({ status: 'ready', error: null, offline: false, retry: () => undefined }),
}));

import { editor as item } from './editors/ItemEditor';
import type { Json } from './editorTypes';

afterEach(cleanup);

const SOURCE = 'MyShortRestBrew';

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** The item editor on screen, as the Workshop holds it; returns the draft as it stands. */
function mount(start: Json): () => Json {
  let latest = start;
  function Harness() {
    const [draft, setDraft] = useState(start);
    latest = draft;
    const change = (patch: Json) =>
      setDraft((d) => {
        const next = { ...d, ...patch };
        for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
        return next;
      });
    return (
      <item.Body
        draft={draft}
        change={change}
        registry={new EntityRegistry()}
        original={undefined}
        readOnly={false}
      />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return () => latest;
}

/** An item made in the editor: its charges, back on a short rest, `amount` of them. */
function made(name: string, charges: string, amount?: string): Json {
  const draft = mount({ name, ...item.blank() });
  type('Charges', charges);
  type('Regains them', 'restShort');
  if (amount !== undefined) type('How many', amount);
  const out = draft();
  cleanup();
  return writeEntry({ draft: out, source: SOURCE, mode: 'full' });
}

describe('item charges back on a short rest, from the Workshop to the sheet', () => {
  it('refills on a short rest, all of them or a number, and all on a long rest', async () => {
    const lantern = made('Lantern of Short Rests T8', '4');
    const flask = made('Flask of Short Rests T8', '5', '2');
    // A file from elsewhere: the fields alone, no charges effect.
    const rod = {
      name: 'Field Short Rest Rod T8',
      source: SOURCE,
      type: 'RD',
      rarity: 'rare',
      entries: [],
      charges: 3,
      recharge: 'restShort',
    };
    // What the editor wrote, as the file holds it.
    expect(lantern).toMatchObject({ charges: 4, recharge: 'restShort' });
    expect((lantern.castGuidance as Json).effects).toEqual([
      { kind: 'charges', charges: 4, regain: 'all', rest: 'short' },
    ]);
    expect((flask.castGuidance as Json).effects).toEqual([
      { kind: 'charges', charges: 5, regain: 2, rest: 'short' },
    ]);

    const reg = await withBuiltInRules(normalizeDataset(new Map()));
    const file = {
      _meta: { sources: [{ json: SOURCE, full: 'My Short Rest Brew' }] },
      item: [lantern, flask, rod],
    };
    mergeHomebrew(reg, new Map([['mine', file]]));
    const ctx = engineContextFor(reg);
    const doc = newCharacterDoc('hero', 'Hero', 'test');
    doc.equipment = [
      ['l', lantern],
      ['f', flask],
      ['r', rod],
    ].map(([id, e]) => ({
      id: id as string,
      ref: { name: String((e as Json).name), source: SOURCE },
      qty: 1,
      equipped: true,
      attuned: true,
    }));
    const sheet = deriveSheet(doc, ctx);
    const pool = (key: string) => sheet.resources.find((r) => r.key === `item-charges:${key}`);
    expect(pool('l')).toMatchObject({ max: 4, resetOn: 'short' });
    expect(pool('f')).toMatchObject({ max: 5, resetOn: 'long', regainOnShort: 2 });
    expect(pool('r')).toMatchObject({ max: 3, resetOn: 'short' });
    for (const key of ['l', 'f', 'r']) expect(pool(key)?.regainRoll, key).toBe(undefined);
    // What each row on the sheet says of it.
    expect(['l', 'f', 'r'].map((k) => backCaption(pool(k) ?? { resetOn: 'long' }))).toEqual([
      'Back on a short rest',
      '2 back on a short rest, all on a long rest',
      'Back on a short rest',
    ]);

    const spent = () => [
      { key: 'item-charges:l', used: 3 },
      { key: 'item-charges:f', used: 4 },
      { key: 'item-charges:r', used: 2 },
    ];
    doc.play.resources = spent();
    expect(shortRestRecovery(doc.play, sheet)).toEqual([
      'Lantern of Short Rests T8 charges',
      '2 Flask of Short Rests T8 charges',
      'Field Short Rest Rod T8 charges',
    ]);
    expect(doc.play.resources).toEqual([{ key: 'item-charges:f', used: 2 }]);
    // A long rest gives all of each back, rolling nothing.
    doc.play.resources = spent();
    longRestRecovery(
      doc.play,
      sheet,
      { maxHp: sheet.maxHp.value, edition: '2024' },
      {
        rollTotal: () => {
          throw new Error('a long rest rolled for charges a short rest gives back');
        },
      },
    );
    expect(doc.play.resources).toEqual([]);
  });
  it('keeps the pool of a short rest item whose amount a short rest cannot give, once its charges are written out', async () => {
    // Fields from elsewhere: dice a short rest never rolls. Read alone, they
    // give none back on a short rest; counting them in the editor must say the
    // same, not a short rest the reader refuses (which would drop the pool).
    // "Add spells they cast" writes the item's charges effect from its fields.
    const fields = {
      name: 'Dice Short Rest Wand T8',
      type: 'WD',
      rarity: 'rare',
      entries: [],
      charges: 3,
      recharge: 'restShort',
      rechargeAmount: '{@dice 1d4}',
    };
    const draft = mount(fields);
    fireEvent.click(screen.getByRole('button', { name: 'Add spells they cast' }));
    expect(readOwnEffects((draft().castGuidance as Json).effects, 'effects').charges).toMatchObject(
      {
        regain: 'none',
      },
    );
    // An edit after it that says nothing of when they come back keeps that.
    type('Fixed save DC', '15');
    const counted = writeEntry({ draft: draft(), source: SOURCE, mode: 'full' });
    cleanup();
    expect((counted.castGuidance as Json).effects).toEqual([
      { kind: 'charges', charges: 3, regain: 'none', dc: 15 },
    ]);
    const alone = writeEntry({
      draft: { ...fields, name: 'Dice Short Rest Wand Alone T8' },
      source: SOURCE,
      mode: 'full',
    });

    const reg = await withBuiltInRules(normalizeDataset(new Map()));
    const file = {
      _meta: { sources: [{ json: SOURCE, full: 'My Short Rest Brew' }] },
      item: [counted, alone],
    };
    mergeHomebrew(reg, new Map([['mine', file]]));
    const doc = newCharacterDoc('hero', 'Hero', 'test');
    doc.equipment = [counted, alone].map((e, i) => ({
      id: `w${i}`,
      ref: { name: String(e.name), source: SOURCE },
      qty: 1,
      equipped: true,
      attuned: true,
    }));
    const sheet = deriveSheet(doc, engineContextFor(reg));
    const pool = (key: string) => sheet.resources.find((r) => r.key === `item-charges:${key}`);
    expect(pool('w0')).toMatchObject({ max: 3 });
    const { key: _k, label: _l, origin: _o, ...countedPool } = pool('w0') ?? {};
    const { key: _k2, label: _l2, origin: _o2, ...alonePool } = pool('w1') ?? {};
    expect(countedPool).toEqual(alonePool);
  });
});
