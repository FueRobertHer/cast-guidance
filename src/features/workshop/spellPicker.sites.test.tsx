// @vitest-environment jsdom
/**
 * The spell box at each Workshop site that names one spell: a Cast a spell
 * card, a feat's spell row, an item's charge spell. A name printed in two
 * books is listed twice, told apart by the book, and the printing picked is
 * the one written. A name typed and not picked is read as it always was (the
 * player's edition's printing). Then the feat, saved and loaded as a homebrew
 * file, gives the picked printing on a derived sheet.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { withBuiltInRules } from '@/data5e/builtInRules';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { EntityRegistry, mergeHomebrew, normalizeDataset } from '@/data5e/normalize';
import { deriveSheet } from '@/engine/derive';
import { newCharacterDoc } from '@/engine/types';
import { makeCard, renderCards } from '../../../tests-fixtures/cardSheet';
import { cards } from './cards/spells';
import { writeEntry } from './copyWriter';
import { editor as feat } from './editors/FeatEditor';
import { editor as item } from './editors/ItemEditor';
import type { EditorSpec, Json } from './editorTypes';
import { everyPrinting, onePerName } from './fields';

vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

afterEach(cleanup);

/** Fireball in both its books: the 2014 one first in the files, as the data has it. */
const FIREBALLS = [
  { name: 'Fireball', source: 'PHB', level: 3, school: 'V', entries: ['A bright streak.'] },
  {
    name: 'Fireball',
    source: 'XPHB',
    edition: 'one',
    level: 3,
    school: 'V',
    entries: ['A bright streak, 2024.'],
  },
];

const type = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Types `words` in the box and picks the row printed in `book`. */
function pickPrinting(label: string, words: string, book: string) {
  type(label, words);
  const rows = within(screen.getByRole('listbox', { name: 'Spells found' })).getAllByRole('option');
  // Both printings are rows, the name alike and the book told apart.
  expect(rows.map((o) => o.textContent)).toEqual([
    expect.stringContaining('PHB'),
    expect.stringContaining('XPHB'),
  ]);
  expect(rows.map((o) => o.firstElementChild?.textContent)).toEqual(['Fireball', 'Fireball']);
  const row = rows.find((o) => o.querySelector('[aria-hidden]')?.textContent === book);
  if (row === undefined) throw new Error(`no ${book} row`);
  fireEvent.click(row);
}

/** An editor on screen with `registry`; the draft as it stands. */
function mount(spec: EditorSpec, start: Json, registry: EntityRegistry) {
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
    return <spec.Body draft={draft} change={change} registry={registry} readOnly={false} />;
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return () => latest;
}

const spellRegistry = () => {
  const registry = new EntityRegistry();
  registry.addAll('spell', FIREBALLS as unknown as Entity[]);
  return registry;
};

describe('everyPrinting', () => {
  it("lists both, the entry's edition first, so a name typed finds what onePerName gave", () => {
    const spells = FIREBALLS as unknown as Entity[];
    for (const entry of [{ name: 'Old Feat' }, { name: 'New Feat', edition: 'one' }]) {
      const all = everyPrinting(spells, entry);
      expect(all).toHaveLength(2);
      expect(all[0]).toEqual(onePerName(spells, entry)[0]);
    }
    expect(everyPrinting(spells, { name: 'New Feat', edition: 'one' })[0]?.source).toBe('XPHB');
  });
});

describe('Cast a spell card', () => {
  const BOTH = [
    { name: 'Fireball', source: 'PHB' },
    { name: 'Fireball', source: 'XPHB' },
  ];

  it('writes the printing picked, and a name typed as before', () => {
    const list = renderCards([makeCard(cards, 'Cast a spell')], { spells: BOTH });
    pickPrinting('Cast a spell: Spell', 'fire', 'XPHB');
    expect(list.written()).toEqual([{ kind: 'grantSpell', spell: 'Fireball|XPHB' }]);
    expect(screen.getByLabelText('Cast a spell: Spell')).toHaveProperty('value', 'Fireball');
    // Typed in full and not picked, the first printing, as it always was.
    type('Cast a spell: Spell', 'fireball');
    expect(list.written()).toEqual([{ kind: 'grantSpell', spell: 'Fireball|PHB' }]);
  });
});

describe("a feat's spell row", () => {
  it('writes the printing picked, and a name typed as before', () => {
    const draft = mount(feat, { name: 'Ember Adept', ...feat.blank() }, spellRegistry());
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    pickPrinting('Spell 1', 'fireb', 'XPHB');
    expect(draft().additionalSpells).toEqual([{ known: { _: ['Fireball|XPHB'] } }]);
    type('Spell 1', 'fireball');
    expect(draft().additionalSpells).toEqual([{ known: { _: ['Fireball|PHB'] } }]);
  });
});

describe("an item's charge spell", () => {
  it('writes the printing picked, and a name typed as before', () => {
    const draft = mount(item, { name: 'Ember Wand', ...item.blank() }, spellRegistry());
    const charges = () =>
      ((draft().castGuidance as Json | undefined)?.effects as Json[] | undefined)?.[0];
    type('Charges', '7');
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell its charges cast' }));
    pickPrinting('Charge spell 1', 'ball', 'XPHB');
    expect(charges()?.spells).toEqual([{ spell: 'Fireball|XPHB', cost: 1 }]);
    type('Charge spell 1', 'fireball');
    expect(charges()?.spells).toEqual([{ spell: 'Fireball|PHB', cost: 1 }]);
  });
});

describe('the printing picked, on a derived sheet', () => {
  it('gives a character holding the feat the Fireball of the book picked', async () => {
    const official = () =>
      normalizeDataset(
        new Map([
          ['spells/spells-phb.json', { spell: [FIREBALLS[0]] }],
          ['spells/spells-xphb.json', { spell: [FIREBALLS[1]] }],
        ]),
      );
    const draft = mount(feat, { name: 'Ember Adept', ...feat.blank() }, official());
    fireEvent.click(screen.getByRole('button', { name: 'Add a spell' }));
    pickPrinting('Spell 1', 'fire', 'XPHB');
    const written = writeEntry({ draft: draft(), source: 'HBX', mode: 'full' });
    const file = {
      _meta: { sources: [{ json: 'HBX', abbreviation: 'HBX', full: 'My Brews' }] },
      feat: [written],
    };
    const reg = official();
    mergeHomebrew(reg, new Map([['brews', file]]));
    const doc = newCharacterDoc('p', 'Printing Check', 'test');
    doc.feats = [{ ref: { name: 'Ember Adept', source: 'HBX' }, instanceId: 'f0' }];
    const sheet = deriveSheet(doc, engineContextFor(await withBuiltInRules(reg)));
    expect(
      sheet.grantedSpells.filter((g) => g.origin === 'Ember Adept').map((g) => [g.name, g.source]),
    ).toEqual([['Fireball', 'XPHB']]);
  });
});
