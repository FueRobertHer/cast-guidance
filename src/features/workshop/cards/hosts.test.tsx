// @vitest-environment jsdom
// Every editor that shows effect cards hands the same effects back as they are
// edited, so a card typed in stays the same card: the box keeps the keyboard and
// what the player hid on the card stays hidden. Cards are known by their
// effects (EffectCards), so a host that copied them on each change would
// redraw every card at every key pressed.
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';

vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({ status: 'ready', error: null, offline: false, retry: () => undefined }),
}));
vi.mock('@/ui/dialogs', () => ({ askChoice: () => Promise.resolve(undefined) }));

import { editor as cls } from '../editors/ClassEditor';
import { editor as condition } from '../editors/ConditionEditor';
import { editor as feat } from '../editors/FeatEditor';
import { editor as item } from '../editors/ItemEditor';
import { editor as optional } from '../editors/OptionalFeatureEditor';
import { editor as species } from '../editors/SpeciesEditor';
import { editor as spell } from '../editors/SpellEditor';
import { editor as subclass } from '../editors/SubclassEditor';
import type { EditorSpec, Json } from '../editorTypes';

afterEach(cleanup);

const AC = () => ({ v: 1, effects: [{ kind: 'acBonus', amount: 1 }] });

/** Each host, the draft that puts one Armor Class card in it, and whether its cards are in play. */
const HOSTS: Array<[string, EditorSpec, Json, boolean]> = [
  ['a feat', feat, { name: 'Guard', castGuidance: AC() }, false],
  ['an optional feature', optional, { name: 'Guard', castGuidance: AC() }, false],
  ['an item', item, { name: 'Ring', type: 'RG', castGuidance: AC() }, false],
  ['a condition', condition, { name: 'Dazed', castGuidance: AC() }, true],
  [
    'a spell, while it lasts',
    spell,
    {
      name: 'Ward',
      level: 1,
      duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 } }],
      castGuidance: AC(),
    },
    true,
  ],
  [
    'a species trait',
    species,
    { name: 'Stonefolk', entries: [{ type: 'entries', name: 'Stone Skin', castGuidance: AC() }] },
    false,
  ],
  [
    'a class feature',
    cls,
    {
      name: 'Warden',
      _features: {
        changed: {},
        removed: [],
        added: [{ name: 'Stance', level: 1, entries: [], castGuidance: AC() }],
      },
    },
    false,
  ],
  [
    'a subclass feature',
    subclass,
    {
      name: 'Oath of Stone',
      _features: {
        changed: {},
        removed: [],
        added: [{ name: 'Stance', level: 3, entries: [], castGuidance: AC() }],
      },
    },
    false,
  ],
];

function mount(spec: EditorSpec, draft: Json) {
  const start: Json = { ...spec.blank(), ...draft };
  function Harness() {
    const [now, setNow] = useState(start);
    return (
      <spec.Body
        draft={now}
        change={(patch) =>
          setNow((d) => {
            const next = { ...d, ...patch };
            for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
            return next;
          })
        }
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
}

describe('a card typed in, in every editor that shows effect cards', () => {
  it.each(HOSTS)('keeps the card in %s', async (_, spec, draft, inPlay) => {
    mount(spec, draft);
    // The class editor shows a level's features on its Table, once the level is opened.
    if (spec === cls) {
      fireEvent.click(screen.getByRole('button', { name: 'Table' }));
      // The table loads on its own, and may draw again as it does.
      await waitFor(() => {
        const level = screen.getByRole('button', { name: /^Level 1,/ });
        if (level.getAttribute('aria-expanded') !== 'true') fireEvent.click(level);
        expect(level.getAttribute('aria-expanded')).toBe('true');
      });
      const header = screen.queryByRole('button', { name: /^Stance/ });
      if (header !== null && header.getAttribute('aria-expanded') !== 'true') {
        fireEvent.click(header);
      }
    }
    const amount = await screen.findByRole('textbox', { name: 'Armor Class: Amount' });
    const row = screen.getByRole('group', { name: 'Armor Class: modifiers' });
    const hide = () => within(row).getByRole('button', { name: 'Only while' });
    // In play there is no Only while to hide; out of play it shows from the start.
    if (!inPlay) {
      fireEvent.click(hide());
      expect(hide().getAttribute('aria-pressed')).toBe('false');
    }
    amount.focus();
    fireEvent.change(amount, { target: { value: '3' } });
    expect(screen.getByText('+3 to Armor Class')).toBeTruthy();
    expect(document.activeElement).toBe(amount);
    expect(screen.getByRole('group', { name: 'Armor Class: modifiers' })).toBe(row);
    if (!inPlay) expect(hide().getAttribute('aria-pressed')).toBe('false');
  });
});
