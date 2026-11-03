// @vitest-environment jsdom
// A pick-one class feature (the 2024 Cleric's Blessed Strikes) as Build shows
// it: the engine's own prompt, offered as option cards, each with an info
// button that reads the branch without picking it.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import type { CharacterDoc } from '@/engine/types';
import { makePickOneContext, pickOneDoc } from '../../../tests-fixtures/pickOneWorld';
import { OriginChoices } from './OriginChoices';

// vaul reads this on close and jsdom does not provide it.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

afterEach(cleanup);

const ctx = makePickOneContext();
const BLESSED = 'class:cleric|xphb:feature:blessed strikes:7';

/** Build's class card for a level 7 Cleric, with `update` writing to the doc. */
function renderCleric(choices: CharacterDoc['choices'] = {}) {
  const doc = pickOneDoc({ name: 'Cleric', source: 'XPHB' }, 7, {
    choices: { 'class:cleric|xphb:feature:divine order:1': ['protector'], ...choices },
  });
  const update = vi.fn((recipe: (d: CharacterDoc) => void) => recipe(doc));
  render(
    <OriginChoices
      sheet={deriveSheet(doc, ctx)}
      doc={doc}
      update={update}
      match={(o) => o.type === 'class'}
    />,
  );
  return { doc, update };
}

/** An option card, named by its label then its summary (not its info button). */
const card = (name: string, opts: { hidden?: boolean } = {}) =>
  screen.getByRole('button', { name: new RegExp(`^${name}(?! details)`), ...opts });

describe('OriginChoices with a pick-one feature', () => {
  it('offers each branch as an option card, none picked', () => {
    renderCleric();
    const picker = screen.getByRole('group', { name: 'Level 7: Blessed Strikes' });
    expect(within(picker).getByText('Cleric · pick 1')).toBeTruthy();
    for (const name of ['Divine Strike', 'Potent Spellcasting']) {
      expect(card(name).getAttribute('aria-pressed')).toBe('false');
    }
    expect(card('Divine Strike').textContent).toContain('an extra 1d8 radiant damage');
    expect(
      within(picker).getByRole('button', { name: 'Confirm Level 7: Blessed Strikes' }),
    ).toHaveProperty('disabled', true);
  });

  it('opens a branch’s rules text without picking it', async () => {
    const { update } = renderCleric();
    fireEvent.click(screen.getByRole('button', { name: 'Divine Strike details' }));
    const sheet = await waitFor(() => screen.getByRole('dialog', { name: 'Divine Strike' }));
    expect(sheet.textContent).toContain('an extra 1d8 radiant damage');
    // Behind the open sheet, so out of the accessibility tree for now.
    expect(card('Divine Strike', { hidden: true }).getAttribute('aria-pressed')).toBe('false');
    expect(update).not.toHaveBeenCalled();
  });

  it('stores the pick on Confirm, under the prompt’s own id', () => {
    const { doc } = renderCleric();
    fireEvent.click(card('Potent Spellcasting'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Level 7: Blessed Strikes' }));
    expect(doc.choices[BLESSED]).toEqual(['potent spellcasting']);
  });

  it('names a made pick by its label, with a way to change it', () => {
    renderCleric({ [BLESSED]: ['potent spellcasting'] });
    const change = screen.getByRole('button', { name: 'Change Level 7: Blessed Strikes' });
    expect(change.parentElement?.textContent).toContain('Potent Spellcasting');
  });
});
