// @vitest-environment jsdom
// House rules in Settings (the Rules board, A), through the real rule store:
// a row per rule opens its sheet, and a choice there, as written too, is
// stored as made, so it outranks a rule pack made the app's default.
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RULE_PACK_TYPE } from '@/engine/castGuidance';
import { rulesFor } from '@/engine/rules';
import { type CharacterDoc, type DataEntity, newCharacterDoc } from '@/engine/types';
import { ONE_USE_DICE_KEY } from '@/lib/oneUseDice';
import { appTableRules } from '@/stores/tableRules';

/** The rule packs the registry lists: none unless a test puts one in. */
const packs: DataEntity[] = [];
const registry = { byType: (type: string) => (type === RULE_PACK_TYPE ? packs : []) };
vi.mock('@/data5e/hooks', () => ({ useRegistry: () => registry }));

import { HouseRulesSection } from './HouseRulesSection';
import { RuleSheet } from './RuleSheet';

// Hidden too: an open sheet hides the page under it from the accessibility tree.
const row = (title: string) =>
  screen.getByRole('button', { name: new RegExp(`^${title}`), hidden: true });
const sheet = () => screen.getByRole('dialog');
const pick = (name: RegExp) => fireEvent.click(within(sheet()).getByRole('radio', { name }));
const checked = () =>
  within(sheet())
    .getAllByRole('radio')
    .filter((r) => (r as HTMLInputElement).checked)
    .map((r) => r.getAttribute('value'));

beforeEach(() => {
  localStorage.clear();
  packs.length = 0;
});
afterEach(cleanup);

describe('house rules in Settings', () => {
  it('lists every rule with the value the app plays by, as written to start', () => {
    render(<HouseRulesSection heading="" />);
    expect(row('Critical hits').textContent).toContain('Double the dice');
    expect(row('Rest length').textContent).toContain('Short 1 hour, long 8 hours');
    expect(row('HP each level').textContent).toContain('The fixed amount');
    expect(row('HP on a long rest').textContent).toContain('All of it');
    expect(row('Flanking').textContent).toContain('Off');
    expect(row('Guidance and Bardic Inspiration').textContent).toContain(
      'Offered after the roll too',
    );
  });

  it('opens the one-use dice sheet on the row, with what each choice means and Bless', () => {
    render(<HouseRulesSection heading="" />);
    fireEvent.click(row('Guidance and Bardic Inspiration'));
    expect(checked()).toEqual(['after']);
    expect(within(sheet()).getByText(/^As written: the roll prompt offers them/)).toBeTruthy();
    expect(within(sheet()).getByText(/There is nothing to set/)).toBeTruthy();
    expect(within(sheet()).getByText(/Under 2024 rules Guidance is not one use/)).toBeTruthy();
  });

  it('stores each choice as made, as written too', () => {
    render(<HouseRulesSection heading="" />);
    fireEvent.click(row('Guidance and Bardic Inspiration'));
    pick(/^Named before the roll/);
    expect(localStorage.getItem(ONE_USE_DICE_KEY)).toBe('before');
    expect(checked()).toEqual(['before']);
    expect(row('Guidance and Bardic Inspiration').textContent).toContain('Named before the roll');

    pick(/^Offered after the roll too/);
    expect(localStorage.getItem(ONE_USE_DICE_KEY)).toBe('after');
    expect(appTableRules().oneUseDice).toBe('after');
  });

  it('starts where this device chose, and follows a choice made in another tab', () => {
    localStorage.setItem(ONE_USE_DICE_KEY, 'before');
    render(<HouseRulesSection heading="" />);
    expect(row('Guidance and Bardic Inspiration').textContent).toContain('Named before the roll');
    localStorage.setItem(ONE_USE_DICE_KEY, 'after');
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: ONE_USE_DICE_KEY }));
    });
    expect(row('Guidance and Bardic Inspiration').textContent).toContain(
      'Offered after the roll too',
    );
  });

  it('shows an app-default pack’s rule until Settings chooses, then the choice outranks it', () => {
    packs.push({
      name: 'Strict Table',
      source: 'MyTable',
      appliesTo: { appDefault: true },
      castGuidance: { v: 1, tableRules: { oneUseDice: 'before', critDamage: 'maxPlusRoll' } },
    });
    const hild = newCharacterDoc('hild', 'Hild', 'tag');
    const ctx = () => ({ byType: registry.byType, rules: appTableRules() });
    render(<HouseRulesSection heading="" />);
    expect(row('Guidance and Bardic Inspiration').textContent).toContain(
      'Named before the roll · Strict Table',
    );
    expect(rulesFor(hild, ctx()).oneUseDice).toBe('before');

    fireEvent.click(row('Guidance and Bardic Inspiration'));
    expect(
      within(sheet()).getByText(
        'Strict Table sets this for every character until you pick one here.',
      ),
    ).toBeTruthy();
    // As written, chosen in Settings: stored, so it holds over the pack.
    pick(/^Offered after the roll too/);
    expect(localStorage.getItem(ONE_USE_DICE_KEY)).toBe('after');
    expect(row('Guidance and Bardic Inspiration').textContent).not.toContain('Strict Table');
    expect(rulesFor(hild, ctx()).oneUseDice).toBe('after');
    // The pack still decides what Settings has not chosen.
    expect(row('Critical hits').textContent).toContain(
      'Max the dice, then roll them · Strict Table',
    );
    expect(rulesFor(hild, ctx()).critDamage).toBe('maxPlusRoll');
  });

  it('sets every other rule for the app the same way', () => {
    render(<HouseRulesSection heading="" />);
    fireEvent.click(row('Rest length'));
    pick(/^Short 8 hours, long 7 days/);
    expect(appTableRules().restLength).toBe('gritty');
    expect(within(sheet()).getByText(/end effects by these lengths/)).toBeTruthy();
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Done' }));
    expect(row('Rest length').textContent).toContain('Short 8 hours, long 7 days');
    expect(localStorage.getItem('cast-guidance:table-rule:restLength')).toBe('gritty');
  });
});

describe('the option sheet', () => {
  it('stores the checked value when it is picked, as written too', () => {
    render(<HouseRulesSection heading="" />);
    fireEvent.click(row('Critical hits'));
    expect(checked()).toEqual(['doubleDice']);
    // Checked already (as written), so a click fires no change: it still counts.
    pick(/^Double the dice/);
    expect(localStorage.getItem('cast-guidance:table-rule:critDamage')).toBe('doubleDice');
  });

  it('gives a character the value they follow as their own when it is picked', () => {
    let hild = newCharacterDoc('hild', 'Hild', 'tag');
    const update = (recipe: (d: CharacterDoc) => void) => {
      const next = structuredClone(hild);
      recipe(next);
      hild = next;
    };
    render(
      <RuleSheet rule="oneUseDice" onClose={() => {}} character={{ doc: hild, update }} mine />,
    );
    expect(checked()).toEqual(['after']);
    pick(/^Offered after the roll too/);
    expect(hild.oneUseDice).toBe('after');
  });

  it('names the pack applied to the character as what they follow without their own', () => {
    let hild = newCharacterDoc('hild', 'Hild', 'tag');
    hild.tableRules = { critDamage: 'maxPlusRoll' };
    packs.push({
      name: 'Hild only',
      source: 'MyTable',
      appliesTo: { characters: ['hild'] },
      castGuidance: { v: 1, tableRules: { critDamage: 'doubleTotal' } },
    });
    const update = (recipe: (d: CharacterDoc) => void) => {
      const next = structuredClone(hild);
      recipe(next);
      hild = next;
    };
    render(
      <RuleSheet rule="critDamage" onClose={() => {}} character={{ doc: hild, update }} mine />,
    );
    fireEvent.click(within(sheet()).getByRole('button', { name: 'Follow Hild only again' }));
    expect('tableRules' in hild).toBe(false);
    expect(rulesFor(hild, { byType: registry.byType, rules: appTableRules() }).critDamage).toBe(
      'doubleTotal',
    );
  });

  it('hands focus to what it is given as it closes, when what opened it is gone', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    function Host() {
      const [open, setOpen] = useState(true);
      return (
        <RuleSheet
          rule={open ? 'flanking' : null}
          onClose={() => setOpen(false)}
          returnFocus={opener}
        />
      );
    }
    render(<Host />);
    fireEvent.keyDown(sheet(), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});
