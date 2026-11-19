// @vitest-environment jsdom
// Effect cards the One Workshop plan fixes (F2): the "Ability score is at
// least" card, an attack bonus to every attack, a saving throw bonus to some
// saves, and a box showing a value its list does not offer. Each is checked
// for what it stores, that the reader takes it, and what a sheet then counts.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { deriveSheet } from '@/engine/derive';
import { readStoredEffects } from '@/engine/effects/mechanics';
import { type DataEntity, type EngineContext, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { EffectCards, moreKinds } from './EffectCards';
import { editor as feat } from './editors/FeatEditor';
import type { Json } from './editorTypes';

const { choice } = vi.hoisted(() => ({ choice: { current: undefined as string | undefined } }));
vi.mock('@/ui/dialogs', () => ({
  askChoice: () => Promise.resolve(choice.current),
}));

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
const pick = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const type = pick;
const tick = (name: string) => fireEvent.click(screen.getByRole('checkbox', { name }));
const ticked = (name: string) =>
  (screen.getByRole('checkbox', { name }) as HTMLInputElement).checked;
const shown = (text: string) => expect(screen.getByText(text)).toBeTruthy();
/** The text of the choice a box shows. */
const showing = (label: string) => box(label).selectedOptions[0]?.textContent;
// The strict reading: a field the reader would pass over is a problem too.
const problems = (effects: Json[]) => readStoredEffects(effects, 'effects', true).problems;

/**
 * Boxes on screen showing a choice other than the value they hold: a value
 * none of a box's choices is would show as its first choice, unsaid.
 */
function misshown(): string[] {
  return screen.getAllByRole('combobox').flatMap((select) => {
    if (!(select instanceof HTMLSelectElement)) return [];
    const props = Object.entries(select).find(([k]) => k.startsWith('__reactProps'))?.[1] as
      | { value?: unknown }
      | undefined;
    const held = String(props?.value ?? '');
    return select.value === held ? [] : [`${select.getAttribute('aria-label')}: ${held}`];
  });
}

/** A level 5 sorcerer with the homebrew feat Gift doing `effects`, derived. */
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
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 16 };
  doc.classes = [{ ref: { name: 'Sorcerer', source: 'TST' }, levels: 5, hp: [] }];
  doc.feats = [{ ref: { name: 'Gift', source: 'HB' }, instanceId: 'f0' }];
  return deriveSheet(doc, ctx);
}

/** The sheet's to-hit numbers: each attack row's, and each spell block's. */
function toHit(effects: Json[]) {
  const sheet = sheetWith(effects);
  return {
    attacks: sheet.attacks.map((a) => a.toHit.value),
    spells: sheet.spellcasting.map((b) => b.attackMod.value),
  };
}

const plus = (xs: number[], n: number) => xs.map((x) => x + n);

describe('the Ability score is at least card', () => {
  it('is offered under More, in play too, and writes a minimum the reader takes', async () => {
    expect(moreKinds({ inPlay: false, spells: false })).toContain('Ability score is at least');
    expect(moreKinds({ inPlay: true, spells: false })).toContain('Ability score is at least');
    const effects = withCards([]);
    choice.current = 'Ability score is at least';
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await screen.findByLabelText('Ability score is at least: Ability');
    pick('Ability score is at least: Ability', 'con');
    type('Ability score is at least: At least', '17');
    expect(effects()).toEqual([{ kind: 'abilityMin', ability: 'con', min: 17 }]);
    shown('Constitution is at least 17');
    expect(problems(effects())).toEqual([]);
    const sheet = sheetWith(effects());
    expect(sheet.abilities.con.value).toBe(17);
    expect(sheet.abilities.str.value).toBe(10);
  });
});

describe('the Attack rolls card', () => {
  it('writes one bonus for every attack, weapon and spell, and the sheet counts it on both', () => {
    const effects = withCards([{ kind: 'attackBonus', amount: 1, scope: 'all' }]);
    pick('Attack rolls: Which', ':every');
    expect(effects()).toEqual([{ kind: 'attackBonus', amount: 1, scope: 'all', attack: 'any' }]);
    shown('+1 to every attack roll, weapon and spell');
    expect(problems(effects())).toEqual([]);
    expect(misshown()).toEqual([]);

    const before = toHit([]);
    expect(before.attacks.length).toBeGreaterThan(0);
    expect(before.spells.length).toBeGreaterThan(0);
    expect(toHit(effects())).toEqual({
      attacks: plus(before.attacks, 1),
      spells: plus(before.spells, 1),
    });
    // The card as it was, and Spell attacks: each reaches one side alone.
    expect(toHit([{ kind: 'attackBonus', amount: 1, scope: 'all' }])).toEqual({
      attacks: plus(before.attacks, 1),
      spells: before.spells,
    });
  });

  it('goes back to weapon attacks alone, with melee, ranged or all of them', () => {
    const effects = withCards([{ kind: 'attackBonus', amount: 1, scope: 'all', attack: 'any' }]);
    expect(box('Attack rolls: Which').value).toBe(':every');
    pick('Attack rolls: Which', 'melee');
    expect(effects()).toEqual([{ kind: 'attackBonus', amount: 1, scope: 'melee' }]);
    pick('Attack rolls: Which', ':every');
    pick('Attack rolls: Which', 'all');
    expect(effects()).toEqual([{ kind: 'attackBonus', amount: 1, scope: 'all' }]);
    expect(problems(effects())).toEqual([]);
  });

  it('says what a file gives that reaches no spell, and keeps the ability it names', () => {
    const effects = withCards([
      { kind: 'attackBonus', amount: 2, scope: 'melee', attack: 'any', ability: 'str' },
    ]);
    // Melee or ranged reach no spell attack, so it reads as melee attacks.
    shown('+2 to melee attack rolls');
    expect(misshown()).toEqual([]);
    pick('Attack rolls: Which', ':every');
    expect(effects()).toEqual([
      { kind: 'attackBonus', amount: 2, scope: 'all', attack: 'any', ability: 'str' },
    ]);
  });
});

describe('the Saving throws card', () => {
  it('writes a bonus to the saves picked, and the sheet adds it to those alone', () => {
    const effects = withCards([{ kind: 'saveBonus', amount: 1 }]);
    shown('+1 to every saving throw');
    tick('Saving throws: Dexterity');
    tick('Saving throws: Strength');
    // In the order the sheet lists them, whichever is picked first.
    expect(effects()).toEqual([{ kind: 'saveBonus', amount: 1, abilities: ['str', 'dex'] }]);
    shown('+1 to Strength and Dexterity saving throws');
    expect(problems(effects())).toEqual([]);

    const before = sheetWith([]).saves;
    const after = sheetWith(effects()).saves;
    expect(after.str.total.value).toBe(before.str.total.value + 1);
    expect(after.dex.total.value).toBe(before.dex.total.value + 1);
    expect(after.con.total.value).toBe(before.con.total.value);
    expect(after.cha.total.value).toBe(before.cha.total.value);
  });

  it('is every saving throw again once none is picked', () => {
    const effects = withCards([{ kind: 'saveBonus', amount: 1, abilities: ['wis'] }]);
    tick('Saving throws: Wisdom');
    expect(effects()).toEqual([{ kind: 'saveBonus', amount: 1 }]);
    shown('+1 to every saving throw');
  });

  it('shows the saves a file names', () => {
    withCards([{ kind: 'saveBonus', amount: 2, abilities: ['con', 'wis', 'cha'] }]);
    shown('+2 to Constitution, Wisdom and Charisma saving throws');
    expect(ticked('Saving throws: Wisdom')).toBe(true);
    expect(ticked('Saving throws: Strength')).toBe(false);
  });
});

describe("a card's box", () => {
  it('shows a table, or a scope no choice is, as written in the Which box', () => {
    withCards([
      { kind: 'attackBonus', amount: 1, scope: { byLevel: { 1: 'melee' } } },
      { kind: 'attackBonus', amount: 1, scope: 'every' },
    ]);
    const [table, word] = screen.getAllByLabelText('Attack rolls: Which') as HTMLSelectElement[];
    expect(table?.selectedOptions[0]?.textContent).toBe('By level, as written');
    expect(word?.selectedOptions[0]?.textContent).toBe('every, as written');
    expect(misshown()).toEqual([]);
  });

  it("shows a spell grant's pool and ability the boxes have not, as written", () => {
    withCards([
      { kind: 'grantSpell', spell: 'Misty Step|TST', resourceKey: 'elsewhere', ability: 'STR' },
    ]);
    expect(showing('Cast a spell: Cast')).toBe('Spending 1 use of elsewhere, as written');
    expect(showing('Cast a spell: Attack and DC from')).toBe('STR, as written');
    expect(misshown()).toEqual([]);
  });

  it("shows a value a file gives that its list does not offer as written, and a pick of the list's replaces it", () => {
    const effects = withCards([
      { kind: 'conditionImmune', condition: 'Dazed' },
      { kind: 'skillProf', skill: 'Cooking', level: 0.5 },
    ]);
    expect(misshown()).toEqual([]);
    expect(showing('Condition immunity: Condition')).toBe('Dazed, as written');
    expect(showing('Skill: Skill')).toBe('Cooking, as written');
    expect(showing('Skill: Level')).toBe('0.5, as written');
    pick('Condition immunity: Condition', 'Frightened');
    pick('Skill: Level', '2');
    expect(effects()).toEqual([
      { kind: 'conditionImmune', condition: 'Frightened' },
      { kind: 'skillProf', skill: 'Cooking', level: 2 },
    ]);
    expect(misshown()).toEqual([]);
  });
});

describe('a card in play (a spell on its target)', () => {
  it('has no When box, as an effect in play holds for as long as it lasts', () => {
    render(
      <MemoryRouter>
        <EffectCards
          effects={[{ kind: 'acBonus', amount: 1 }]}
          readOnly={false}
          inPlay
          onChange={() => undefined}
        />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Armor Class: Amount')).toBeTruthy();
    expect(screen.queryByLabelText('Armor Class: When')).toBeNull();
  });
});
