// @vitest-environment jsdom
// What the condition editor puts in the entry, and what Save then stores.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { conditionMechanics, homebrewConditionEffects } from '@/engine/conditions';
import { writeEntry } from '../copyWriter';
import { EDITORS, type Json } from '../editorTypes';
import { editor } from './ConditionEditor';

afterEach(cleanup);

/** The editor on screen, as the Workshop holds it; returns the draft as it stands. */
function mount(start: Json, original?: Json) {
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
      <editor.Body
        draft={draft}
        change={change}
        original={original}
        registry={new EntityRegistry()}
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

const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

const POISONED: Json = {
  name: 'Poisoned',
  source: 'XPHB',
  page: 372,
  entries: ['While Poisoned, you experience the following effects.'],
};

describe('ConditionEditor', () => {
  it('makes a new condition whose effects a character in it counts', () => {
    const draft = mount({ name: 'Dazed', ...editor.blank() });
    press('Armor Class');
    const saved = writeEntry({ draft: draft(), source: 'MyHomebrew', mode: 'changes' });
    expect(saved).toEqual({
      name: 'Dazed',
      source: 'MyHomebrew',
      entries: [],
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1 }] },
    });
    const { effects } = homebrewConditionEffects([{ id: 'Dazed' }], () => saved);
    expect(effects).toEqual([
      { id: 'condition:Dazed', name: 'Dazed', parts: [{ kind: 'acBonus', amount: 1 }] },
    ]);
  });

  it('says which card a condition cannot count, and why', () => {
    mount({
      name: 'Dazed',
      entries: [],
      castGuidance: {
        v: 1,
        effects: [
          { kind: 'acBonus', amount: -1 },
          { kind: 'skillProf', skill: 'Stealth', level: 1 },
        ],
      },
    });
    const list = screen.getByRole('list', { name: 'What does not count on a condition' });
    expect(list.textContent).toMatch(/^Card 2 does not count: a condition changes only numbers/);
  });

  it('starts a copy of a built-in condition from what the app does for it', () => {
    const draft = mount({ ...POISONED, name: 'Badly Poisoned' }, POISONED);
    expect(screen.getByText(/The app counts Poisoned by its own rules/)).toBeTruthy();
    press('Add what Poisoned does');
    const saved = writeEntry({
      original: POISONED,
      draft: draft(),
      source: 'MyHomebrew',
      mode: 'changes',
    });
    expect(saved).toMatchObject({
      name: 'Badly Poisoned',
      _copy: { name: 'Poisoned', source: 'XPHB' },
      castGuidance: {
        v: 1,
        basedOn: 'Poisoned|XPHB',
        effects: [
          { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['attack'] } },
          { kind: 'rollAdvantage', mode: 'dis', on: { rolls: ['check'] } },
        ],
      },
    });
    expect(conditionMechanics(saved).parts).toHaveLength(2);
    // All of it is on the list now, so there is nothing more to add.
    expect(screen.queryByRole('button', { name: 'Add what Poisoned does' })).toBeNull();
  });

  it('offers no start for a copy of a homebrew condition', () => {
    const mine = { name: 'Dazed', source: 'Other', entries: [] };
    mount({ ...mine, name: 'Dazed Again' }, mine);
    expect(screen.queryByRole('button', { name: /^Add what/ })).toBeNull();
  });

  it('is the editor the Workshop finds for conditions', async () => {
    const load = EDITORS.get('condition');
    expect((await load?.())?.editor).toBe(editor);
  });

  it('refuses a built-in name, whatever its case', () => {
    expect(editor.check?.({ name: 'Poisoned' })).toMatch(/Give yours another name/);
    expect(editor.check?.({ name: ' prone ' })).toMatch(/^prone is a condition/);
    expect(editor.check?.({ name: 'Dazed' })).toBeUndefined();
  });
});
