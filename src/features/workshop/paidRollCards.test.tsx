// @vitest-environment jsdom
// The Workshop's Paid extra and Reroll cards (rule pack port 3f): what each box
// stores, that every mix of boxes is one the reader takes, that a shipped row
// opens and keeps what no box shows, and that a feat the cards write reaches
// the roll prompt priced.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { deriveSheet } from '@/engine/derive';
import { readStoredEffects } from '@/engine/effects/mechanics';
import { rollEffects } from '@/engine/playRules';
import { type DataEntity, type EngineContext, newCharacterDoc } from '@/engine/types';
import { pricedRollEffects } from '@/features/sheet/rollPrice';
import rollExtras from '@/rules/cast-guidance/roll-extras.json';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { moreKinds } from './EffectCards';
import { editor as feat } from './editors/FeatEditor';
import type { Json } from './editorTypes';

afterEach(cleanup);

/** The feat editor on screen with these effects; returns its effects as they stand. */
function withCards(effects: Json[]) {
  let latest: Json = {};
  const start: Json = { name: 'Gift', ...feat.blank(), castGuidance: { v: 1, effects } };
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
      <feat.Body draft={draft} change={change} registry={new EntityRegistry()} readOnly={false} />
    );
  }
  render(
    <MemoryRouter>
      <Harness />
    </MemoryRouter>,
  );
  return () => ((latest.castGuidance as Json | undefined)?.effects ?? []) as Json[];
}

const box = (label: string) => screen.getByLabelText(label) as HTMLSelectElement;
const has = (label: string) => screen.queryByLabelText(label) !== null;
const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const choices = (label: string) => [...box(label).options].map((o) => o.value);
const shown = (text: string) => expect(screen.getByText(text)).toBeTruthy();
const problems = (effects: Json[]) => readStoredEffects(effects).problems;

// As More adds them.
const PAID = { kind: 'rollPaid', on: { rolls: ['check'] }, dice: '1d4', ifFailed: true };
const REROLL = { kind: 'rollReroll', on: { rolls: ['save'] }, ifFailed: true };
const POOL = { kind: 'resource', key: 'gift', label: 'Gift', max: 2, reset: 'long' };

describe('the add list', () => {
  it('offers a paid extra and a reroll, but not in play, where they never count', () => {
    expect(moreKinds({ inPlay: false, spells: false })).toEqual(
      expect.arrayContaining(['Paid extra', 'Reroll']),
    );
    const inPlay = moreKinds({ inPlay: true, spells: false });
    expect(inPlay).not.toContain('Paid extra');
    expect(inPlay).not.toContain('Reroll');
    expect(inPlay).toContain('Added die');
  });

  it('adds cards the reader takes', () => {
    expect(problems([PAID, REROLL])).toEqual([]);
  });

  it('names no death or concentration save, which roll at once and are offered neither', () => {
    withCards([PAID, REROLL]);
    for (const title of ['Paid extra', 'Reroll']) {
      const on = choices(`${title}: On`);
      expect(on).toEqual(expect.arrayContaining(['attack', 'check', 'save']));
      expect(on).not.toContain('death');
      expect(on).not.toContain('concentration');
    }
  });
});

describe('the Paid extra card', () => {
  it('adds a die after a failed roll, its use coming back if it still fails', () => {
    const effects = withCards([POOL, PAID]);
    shown('+1d4 to ability checks, after a failed roll, paid with its use');
    pick('Paid extra: Dice', '1d10');
    pick('Paid extra: Ability', 'int');
    pick('Paid extra: If it still fails', 'back');
    expect(effects()[1]).toEqual({
      kind: 'rollPaid',
      on: { rolls: ['check'], abilities: ['int'] },
      dice: '1d10',
      ifFailed: true,
      spentOnSuccess: true,
    });
    shown(
      '+1d10 to Intelligence checks, after a failed roll, paid with its use (the use comes back if it still fails)',
    );
    // Offered on any roll, the use is always spent.
    pick('Paid extra: Offered', 'after');
    expect(effects()[1]).not.toHaveProperty('spentOnSuccess');
    expect(has('Paid extra: If it still fails')).toBe(false);
    expect(problems(effects())).toEqual([]);
  });

  it('adds a bonus once the d20 shows, as a number or a formula', () => {
    const effects = withCards([POOL, { ...PAID, ifFailed: undefined }]);
    pick('Paid extra: Offered', 'before');
    pick('Paid extra: Adds', 'bonus');
    // A bonus is never added before the d20.
    expect(choices('Paid extra: Offered')).toEqual(['after', 'failed']);
    expect(effects()[1]).toEqual({
      kind: 'rollPaid',
      on: { rolls: ['check'] },
      bonus: 1,
      after: true,
    });
    fireEvent.change(screen.getByLabelText('Paid extra: Bonus'), {
      target: { value: 'max(1, mod.int)' },
    });
    pick('Paid extra: Paid with', 'useReaction');
    expect(effects()[1]).toMatchObject({ bonus: { f: 'max(1, mod.int)' }, reaction: true });
    shown(
      '+(max(1, mod.int)) to ability checks, after the roll, paid with its use and your reaction',
    );
    expect(problems(effects())).toEqual([]);
  });

  it('claims advantage before the d20, paid with Inspiration', () => {
    const effects = withCards([PAID]);
    pick('Paid extra: Adds', 'advantage');
    expect(has('Paid extra: Offered')).toBe(false);
    pick('Paid extra: Paid with', 'inspiration');
    pick('Paid extra: Only when', 'Only against a creature you can see');
    expect(effects()).toEqual([
      {
        kind: 'rollPaid',
        on: { rolls: ['check'] },
        advantage: true,
        inspiration: true,
        when: 'Only against a creature you can see',
      },
    ]);
    shown(
      'Advantage on ability checks, paid with Inspiration. Only against a creature you can see',
    );
    expect(problems(effects())).toEqual([]);
  });

  it("keeps the paying pool's die as written, and offers no Inspiration for it", () => {
    const poolDie = { kind: 'rollPaid', on: { rolls: ['attack'] }, poolDie: true, ifFailed: true };
    const effects = withCards([POOL, poolDie]);
    expect(box('Paid extra: Adds').selectedOptions[0]?.textContent).toBe(
      "The paying pool's die, as written",
    );
    expect(choices('Paid extra: Paid with')).not.toContain('inspiration');
    pick('Paid extra: Ability', 'str');
    expect(effects()[1]).toEqual({ ...poolDie, on: { rolls: ['attack'], abilities: ['str'] } });
  });

  it('says what pays for it while the entry has nothing to pay with', () => {
    const text = /offers it while this entry has an Action or Uses per rest/;
    withCards([PAID]);
    expect(screen.getByText(text)).toBeTruthy();
    pick('Paid extra: Paid with', 'inspiration');
    expect(screen.queryByText(text)).toBeNull();
    cleanup();
    withCards([POOL, PAID]);
    expect(screen.queryByText(text)).toBeNull();
  });

  it('stores only what the reader takes, whatever the boxes say', () => {
    const effects = withCards([POOL, PAID]);
    const seen = new Set<string>();
    for (const adds of choices('Paid extra: Adds')) {
      pick('Paid extra: Adds', adds);
      for (const time of has('Paid extra: Offered') ? choices('Paid extra: Offered') : ['']) {
        if (time !== '') pick('Paid extra: Offered', time);
        const stills = has('Paid extra: If it still fails')
          ? choices('Paid extra: If it still fails')
          : [undefined];
        for (const still of stills) {
          if (still !== undefined) pick('Paid extra: If it still fails', still);
          for (const pay of choices('Paid extra: Paid with')) {
            pick('Paid extra: Paid with', pay);
            const now = effects();
            expect(problems(now), JSON.stringify(now[1])).toEqual([]);
            seen.add(JSON.stringify(now[1]));
          }
        }
      }
    }
    // Die: 3 times, the failed one twice; bonus: 2 times, the failed one twice;
    // advantage: once; each paid 4 ways.
    expect(seen.size).toBe((4 + 3 + 1) * 4);
  });
});

describe('the Reroll card', () => {
  it('rerolls a failed save, paid with its use and the reaction', () => {
    const effects = withCards([POOL, REROLL]);
    shown('Reroll the d20 on saving throws, after a failed roll, paid with its use');
    pick('Reroll: Ability', 'con');
    pick('Reroll: Paid with', 'useReaction');
    fireEvent.change(screen.getByLabelText('Reroll: Adds to the new roll'), {
      target: { value: 'classLevel' },
    });
    expect(effects()[1]).toEqual({
      kind: 'rollReroll',
      on: { rolls: ['save'], abilities: ['con'] },
      ifFailed: true,
      reaction: true,
      bonus: { f: 'classLevel' },
    });
    shown(
      'Reroll the d20 on Constitution saving throws, adding +(classLevel), after a failed roll, paid with its use and your reaction',
    );
    // Emptied, the bonus is gone.
    fireEvent.change(screen.getByLabelText('Reroll: Adds to the new roll'), {
      target: { value: ' ' },
    });
    expect(effects()[1]).not.toHaveProperty('bonus');
    expect(problems(effects())).toEqual([]);
  });

  it('makes a 1 rerolled as the d20 lands, and pays for it again past a 1', () => {
    const effects = withCards([REROLL]);
    pick('Reroll: Does', 'one');
    pick('Reroll: Paid with', 'auto');
    expect(effects()).toEqual([
      {
        kind: 'rollReroll',
        on: { rolls: ['save'] },
        die: 'one',
        atMost: 1,
        auto: true,
        free: true,
      },
    ]);
    // Made as the d20 lands, it waits on nothing.
    expect(has('Reroll: Offered')).toBe(false);
    expect(has('Reroll: Only when')).toBe(false);
    shown('Reroll a 1 on saving throws, as the d20 lands');
    // A 2 or less could be rerolled into worse: it is offered, paid with its use.
    pick('Reroll: Showing at most', '2');
    expect(effects()[0]).toEqual({
      kind: 'rollReroll',
      on: { rolls: ['save'] },
      die: 'one',
      atMost: 2,
    });
    expect(choices('Reroll: Paid with')).not.toContain('auto');
    expect(problems(effects())).toEqual([]);
  });

  it('makes the lower die and a floor only as the d20 lands, and a set adds no bonus', () => {
    const effects = withCards([{ ...REROLL, bonus: 2, reaction: true }]);
    pick('Reroll: Does', 'low');
    expect(effects()[0]).toEqual({
      kind: 'rollReroll',
      on: { rolls: ['save'] },
      die: 'low',
      bonus: 2,
      auto: true,
      free: true,
    });
    expect(has('Reroll: Paid with')).toBe(false);
    pick('Reroll: Does', 'floor');
    pick('Reroll: Score', 'dex');
    expect(effects()[0]).toEqual({
      kind: 'rollReroll',
      on: { rolls: ['save'] },
      floorScore: 'dex',
      auto: true,
      free: true,
    });
    shown(
      'A total under your Dexterity score counts as the score on saving throws, as the d20 lands',
    );
    pick('Reroll: Does', 'to');
    pick('Reroll: At least', '20');
    expect(effects()[0]).toEqual({
      kind: 'rollReroll',
      on: { rolls: ['save'] },
      to: 20,
      auto: true,
      free: true,
    });
    expect(has('Reroll: Adds to the new roll')).toBe(false);
    // A reroll of every die could be worse: it is paid with its use again.
    pick('Reroll: Does', 'all');
    expect(effects()[0]).toEqual({ kind: 'rollReroll', on: { rolls: ['save'] } });
    expect(problems(effects())).toEqual([]);
  });

  it('stores only what the reader takes, whatever the boxes say', () => {
    const effects = withCards([POOL, REROLL]);
    const seen = new Set<string>();
    const numbers: Record<string, readonly string[]> = {
      'Reroll: Showing at most': ['1', '5'],
      'Reroll: At least': ['10', '20'],
      'Reroll: Score': ['str', 'wis'],
    };
    for (const does of choices('Reroll: Does')) {
      pick('Reroll: Does', does);
      const label = Object.keys(numbers).find(has);
      for (const n of label === undefined ? [undefined] : (numbers[label] ?? [])) {
        if (label !== undefined && n !== undefined) pick(label, n);
        for (const pay of has('Reroll: Paid with') ? choices('Reroll: Paid with') : [undefined]) {
          if (pay !== undefined) pick('Reroll: Paid with', pay);
          for (const off of has('Reroll: Offered') ? choices('Reroll: Offered') : [undefined]) {
            if (off !== undefined) pick('Reroll: Offered', off);
            const bonuses = has('Reroll: Adds to the new roll') ? ['2', ''] : [undefined];
            for (const bonus of bonuses) {
              if (bonus !== undefined) {
                fireEvent.change(screen.getByLabelText('Reroll: Adds to the new roll'), {
                  target: { value: bonus },
                });
              }
              const now = effects();
              expect(problems(now), JSON.stringify(now[1])).toEqual([]);
              seen.add(JSON.stringify(now[1]));
            }
          }
        }
      }
    }
    expect(seen.size).toBeGreaterThan(100);
  });
});

describe('a shipped paid extra or reroll on a card', () => {
  const shipped = rollExtras.rows.flatMap((row) =>
    (row.effects as Json[])
      .filter((e) => e.kind === 'rollPaid' || e.kind === 'rollReroll')
      .map((effect) => ({ key: row.keys[0] ?? '', effect })),
  );

  it('opens every one, worded, and keeps it whole while another box changes', () => {
    expect(shipped.length).toBeGreaterThan(50);
    const asWritten: string[] = [];
    for (const { key, effect } of shipped) {
      const effects = withCards([effect]);
      const title = effect.kind === 'rollPaid' ? 'Paid extra' : 'Reroll';
      expect(document.body.textContent, key).not.toMatch(/undefined|NaN|\[object/);
      for (const select of screen.getAllByRole('combobox')) {
        const text =
          select instanceof HTMLSelectElement ? select.selectedOptions[0]?.textContent : '';
        if (text?.endsWith('as written') === true) asWritten.push(`${key}: ${text}`);
      }
      pick(`${title}: Rules`, '2014');
      pick(`${title}: Rules`, '');
      expect(effects(), key).toEqual([effect]);
      cleanup();
    }
    // What no box shows: rolls of more than one kind or a filter of skills,
    // the paying pool's die, and Rage, a state the When box has no choice for.
    expect(
      asWritten.every((w) =>
        /(checks|rolls|throws), as written$|pool's die|While Rage lasts/.test(w),
      ),
      asWritten.join('\n'),
    ).toBe(true);
  });

  it('shows a state the When box has no choice for as written, and takes it away for Always', () => {
    const rage = { ...REROLL, free: true, while: { effect: 'Rage' } };
    const effects = withCards([rage]);
    expect(box('Reroll: When').selectedOptions[0]?.textContent).toBe(
      'While Rage lasts, as written',
    );
    pick('Reroll: Ability', 'wis');
    expect(effects()[0]?.while).toEqual({ effect: 'Rage' });
    pick('Reroll: When', '');
    expect(effects()[0]).not.toHaveProperty('while');
  });

  it('keeps a paid extra a file gives, its formula bonus and a reaction never taken, while another changes', () => {
    const paid = {
      kind: 'rollPaid',
      on: { rolls: ['save'] },
      bonus: { f: 'max(1, mod.int)' },
      after: true,
      reaction: false,
    };
    const effects = withCards([paid, { kind: 'acBonus', amount: 1 }]);
    shown(
      '+(max(1, mod.int)) to saving throws, after the roll, paid with its use, never your reaction',
    );
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '2' } });
    expect(effects()).toEqual([paid, { kind: 'acBonus', amount: 2 }]);
    expect(problems(effects())).toEqual([]);
    expect(screen.queryByText(/This does not count yet/)).toBeNull();
  });
});

describe('a feat the cards write, on a sheet', () => {
  /** A Warrior 4 with the feat, its effects as the cards left them. */
  function sheetWith(effects: Json[]) {
    const base = makeTestContext();
    const gift: DataEntity = {
      name: 'Gift',
      source: 'HB',
      entries: [],
      castGuidance: { v: 1, effects },
    };
    const ctx: EngineContext = {
      get: (type, name, source) =>
        type === 'feat' && name.toLowerCase() === 'gift' ? gift : base.get(type, name, source),
      byType: (type) => [...base.byType(type), ...(type === 'feat' ? [gift] : [])],
    };
    const doc = newCharacterDoc('c', 'Hero', 't');
    doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 4, hp: [] }];
    doc.feats = [{ ref: { name: 'Gift', source: 'HB' }, instanceId: 'f0' }];
    return { sheet: deriveSheet(doc, ctx), play: doc.play };
  }

  it('is offered priced as a use of its pool, and not once the pool is spent', () => {
    const effects = withCards([POOL, PAID, REROLL]);
    pick('Paid extra: Dice', '1d6');
    pick('Paid extra: If it still fails', 'back');
    pick('Reroll: Paid with', 'useReaction');
    const { sheet, play } = sheetWith(effects());
    const priced = (used: number, roll: Parameters<typeof rollEffects>[1]) =>
      pricedRollEffects(rollEffects(sheet, roll), sheet, {
        ...play,
        resources: [{ key: 'gift', used }],
      });
    const spends = [{ key: 'gift', max: 2, amount: 1 }];
    expect(priced(0, { kind: 'check', ability: 'str' }).offers).toEqual([
      expect.objectContaining({
        dice: '1d6',
        source: 'Gift',
        ifFailed: true,
        spentOnSuccess: true,
        pay: expect.objectContaining({ spends, reaction: false }),
      }),
    ]);
    expect(priced(0, { kind: 'save', ability: 'con' }).rerollOffers).toEqual([
      expect.objectContaining({
        source: 'Gift',
        ifFailed: true,
        pay: expect.objectContaining({ spends, reaction: true }),
      }),
    ]);
    expect(priced(2, { kind: 'check', ability: 'str' }).offers).toEqual([]);
    expect(priced(2, { kind: 'save', ability: 'con' }).rerollOffers).toBeUndefined();
  });
});
