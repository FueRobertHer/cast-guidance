// @vitest-environment jsdom
// The spell editor's fields from the One Workshop's board 5, each saved and
// read back, and what it offers to put on a spell's target (suspected bug 1).
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EntityRegistry } from '@/data5e/normalize';
import { homebrewLanding } from '@/engine/curated/effectCatalog';

// More's choices are recorded, and the one in `choice` is taken.
const { asked, choice } = vi.hoisted(() => ({
  asked: { current: [] as string[] },
  choice: { current: undefined as string | undefined },
}));
vi.mock('@/data5e/hooks', () => ({
  useTypePacks: () => ({ status: 'ready', error: null, offline: false, retry: () => undefined }),
}));
vi.mock('@/ui/dialogs', () => ({
  askChoice: (o: { options: Array<{ id: string }> }) => {
    asked.current = o.options.map((x) => x.id);
    return Promise.resolve(choice.current);
  },
}));

import { writeEntry } from './copyWriter';
import { editor as spell } from './editors/SpellEditor';
import type { Json } from './editorTypes';

afterEach(() => {
  cleanup();
  asked.current = [];
  choice.current = undefined;
});

/** The editor on screen, as the Workshop holds it; returns the draft as it stands. */
function mount(start: Json, registry = new EntityRegistry(), original?: Json) {
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
      <spell.Body
        draft={draft}
        change={change}
        registry={registry}
        original={original}
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
const save = (draft: Json) => writeEntry({ draft, source: 'MyHomebrew', mode: 'changes' });

/** A new spell that lasts, so its target list is on screen. */
const LASTING = (): Json => ({
  name: 'Lantern Ward',
  ...spell.blank(),
  duration: [{ type: 'timed', duration: { type: 'minute', amount: 1 }, concentration: true }],
});

describe('what a spell puts on its target (suspected bug 1)', () => {
  it('offers only kinds + Effect puts on a target, and each one offered lands', async () => {
    mount(LASTING());
    // The chips beside More, the kinds offered first.
    const row = screen.getByRole('button', { name: 'More' }).parentElement as HTMLElement;
    const chips = within(row)
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
      .filter((t) => t !== 'More');
    press('More');
    await waitFor(() => expect(asked.current.length).toBeGreaterThan(0));
    const offered = [...chips, ...asked.current];
    // A target holds numbers and rolls, not proficiencies, uses or actions:
    // each of these was offered and then refused by + Effect.
    for (const no of [
      'Ability score',
      'Skill',
      'Uses per rest',
      'Hit points per level',
      'Save proficiency',
      'Language',
      'Tool',
      'Weapon',
      'Action',
      'Cast a spell',
    ]) {
      expect(offered).not.toContain(no);
    }
    expect(offered).toEqual(
      expect.arrayContaining([
        'Armor Class',
        'Speed',
        'Resistance',
        'Ability score is at least',
        'Advantage',
        'Another way to work out AC',
      ]),
    );
    // Each one offered, added as it comes, is put on the target by + Effect.
    for (const kind of offered) {
      cleanup();
      const draft = mount(LASTING());
      if (chips.includes(kind)) press(kind);
      else {
        choice.current = kind;
        press('More');
      }
      await waitFor(() => {
        const g = draft().castGuidance as { effects?: unknown[] } | undefined;
        expect(g?.effects).toHaveLength(1);
      });
      const landing = homebrewLanding(save(draft()), 'spell');
      expect([kind, landing.problems]).toEqual([kind, []]);
      expect(landing.entry).toBeDefined();
    }
  });
});
