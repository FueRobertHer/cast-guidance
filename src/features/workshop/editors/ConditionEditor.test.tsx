// @vitest-environment jsdom
// What the condition editor puts in the entry, and what Save then stores.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { conditionMechanics, homebrewConditionEffects } from '@/engine/conditions';
import { writeEntry } from '../copyWriter';
import { EDITORS, type Json } from '../editorTypes';
import { editor } from './ConditionEditor';

// More's choices are recorded, and the one in `choice` is taken.
const { asked, choice } = vi.hoisted(() => ({
  asked: { current: [] as string[] },
  choice: { current: undefined as string | undefined },
}));
vi.mock('@/ui/dialogs', () => ({
  askChoice: (o: { options: Array<{ id: string }> }) => {
    asked.current = o.options.map((x) => x.id);
    return Promise.resolve(choice.current);
  },
}));

afterEach(() => {
  cleanup();
  asked.current = [];
  choice.current = undefined;
});

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
    // It holds under the rules of the sheet it is on: no card offers a version.
    expect(screen.queryByLabelText('Armor Class: Rules')).toBeNull();
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

  it('offers only what a condition counts', async () => {
    mount({ name: 'Dazed', ...editor.blank() });
    // The chips beside More, the kinds offered first.
    const row = screen.getByRole('button', { name: 'More' }).parentElement as HTMLElement;
    const chips = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t !== 'More');
    press('More');
    await waitFor(() => expect(asked.current.length).toBeGreaterThan(0));
    const offered = [...chips, ...asked.current];
    for (const no of ['Hit points per level', 'Skill', 'Uses per rest', 'Action']) {
      expect(offered).not.toContain(no);
    }
    expect(offered).toEqual(
      expect.arrayContaining(['Armor Class', 'Saving throws', 'Advantage', 'Hit points']),
    );
    // Each one offered, added as it comes, counts on a character in it.
    for (const kind of offered) {
      cleanup();
      const draft = mount({ name: 'Dazed', ...editor.blank() });
      if (chips.includes(kind)) press(kind);
      else {
        choice.current = kind;
        press('More');
      }
      await waitFor(() => expect(conditionMechanics(draft()).parts).toHaveLength(1));
      expect([kind, conditionMechanics(draft()).problems]).toEqual([kind, []]);
    }
  });

  it('offers no When of its own, and one a file gives only to take away', () => {
    mount({ name: 'Dazed', ...editor.blank() });
    press('Armor Class');
    // A condition's effects hold for as long as it does.
    expect(screen.queryByLabelText('Armor Class: When')).toBeNull();
    cleanup();
    const draft = mount({
      name: 'Dazed',
      entries: [],
      castGuidance: { v: 1, effects: [{ kind: 'acBonus', amount: 1, while: 'bloodied' }] },
    });
    const when = screen.getByLabelText('Armor Class: When') as HTMLSelectElement;
    expect([...when.options].map((o) => o.value)).toEqual(['', 'bloodied']);
    expect(conditionMechanics(draft()).problems).not.toEqual([]);
    fireEvent.change(when, { target: { value: '' } });
    expect(conditionMechanics(draft()).problems).toEqual([]);
    expect(screen.queryByLabelText('Armor Class: When')).toBeNull();
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
