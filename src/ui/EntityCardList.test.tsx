// @vitest-environment jsdom
// UX-004: re-tapping the already-selected card must not re-fire onSelect (which
// for race/class/background re-runs pruneChoicesFor and silently wipes picks).
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Entity } from '@/data5e/copyMod';
import type { SourcePolicy } from '@/data5e/sourceFilter';
import { EntityCardList } from './EntityCardList';

// Only the Dexie-backed hook is stubbed; the filtering logic under test is real.
const policyState = vi.hoisted(() => ({
  current: { mode: 'all', except: [] } as SourcePolicy,
}));
vi.mock('@/data5e/sourceFilter', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/data5e/sourceFilter')>()),
  useSourcePolicy: () => policyState.current,
}));

const entities: Entity[] = [
  { name: 'Human', source: 'PHB' },
  { name: 'Elf', source: 'PHB' },
];

afterEach(cleanup);
beforeEach(() => {
  policyState.current = { mode: 'all', except: [] };
});

describe('EntityCardList selection', () => {
  it('selects an unselected card', () => {
    const onSelect = vi.fn();
    render(<EntityCardList entities={entities} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Elf' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ name: 'Elf' });
  });

  it('deselects (not re-selects) when tapping the current pick with onDeselect', () => {
    const onSelect = vi.fn();
    const onDeselect = vi.fn();
    render(
      <EntityCardList
        entities={entities}
        selectedUid="human|phb"
        onSelect={onSelect}
        onDeselect={onDeselect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    expect(onDeselect).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  // A11Y-001: the selected card was shown only by its border and weight.
  it('reports the current pick as pressed', () => {
    render(<EntityCardList entities={entities} selectedUid="human|phb" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Human', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Elf', pressed: false })).toBeTruthy();
  });

  it('is a no-op when re-tapping the current pick with no onDeselect (no silent wipe)', () => {
    const onSelect = vi.fn();
    render(<EntityCardList entities={entities} selectedUid="human|phb" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('keeps the current pick when re-tapped with onReselect, and deselect wins over it', () => {
    const onSelect = vi.fn();
    const onReselect = vi.fn();
    const onDeselect = vi.fn();
    const { rerender } = render(
      <EntityCardList
        entities={entities}
        selectedUid="human|phb"
        onSelect={onSelect}
        onReselect={onReselect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    expect(onReselect).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();

    rerender(
      <EntityCardList
        entities={entities}
        selectedUid="human|phb"
        onSelect={onSelect}
        onReselect={onReselect}
        onDeselect={onDeselect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Human' }));
    expect(onDeselect).toHaveBeenCalledTimes(1);
    expect(onReselect).toHaveBeenCalledTimes(1);
  });

  it('still selects a different card while one is selected', () => {
    const onSelect = vi.fn();
    render(<EntityCardList entities={entities} selectedUid="human|phb" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Elf' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ name: 'Elf' });
  });
});

describe('EntityCardList source filtering', () => {
  // Over ten entries so the text-filter input renders.
  const mixed: Entity[] = [
    { name: 'Human', source: 'PHB' },
    { name: 'Elf', source: 'PHB' },
    ...Array.from({ length: 9 }, (_, i) => ({ name: `Filler ${String(i)}`, source: 'PHB' })),
    { name: 'Aarakocra', source: 'EEPC' },
    { name: 'Elfling', source: 'EEPC' },
  ];

  it('hides entities from sources the player turned off', () => {
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Human' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).toBeNull();
  });

  it('never hides the current pick, even from a hidden source', () => {
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} selectedUid="aarakocra|eepc" onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).not.toBeNull();
  });

  it('offers to reveal hidden entries, and to go back', () => {
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText(/2 hidden by your source settings/));
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).not.toBeNull();
    fireEvent.click(screen.getByText('Back to your chosen sources'));
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).toBeNull();
  });

  it('counts hidden entries against the text filter, not the whole list', () => {
    // Regression: the count was taken before the text filter, so searching
    // "elf" advertised every hidden entry in the list, including the ones that
    // revealing them would not have shown.
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'elf' } });
    expect(screen.queryByText(/2 hidden by your source settings/)).toBeNull();
    expect(screen.queryByText(/1 hidden by your source settings/)).not.toBeNull();
  });

  it('says nothing about hidden sources when the filter matches only visible entries', () => {
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText('Filter…'), { target: { value: 'human' } });
    expect(screen.queryByText(/hidden by your source settings/)).toBeNull();
  });

  it('shows everything when no policy is set', () => {
    render(<EntityCardList entities={mixed} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Aarakocra' })).not.toBeNull();
    expect(screen.queryByText(/hidden by your source settings/)).toBeNull();
  });
});

describe("EntityCardList under a character's own sources (GAME-005)", () => {
  const mixed: Entity[] = [
    { name: 'Human', source: 'PHB' },
    { name: 'Elf', source: 'PHB' },
    { name: 'Shadar-kai', source: 'XGE' },
    { name: 'Goblin', source: 'XGE' },
  ];
  const OUTSIDE = "Not in this character's sources";

  it("narrows to the character's list and says whose list it is", () => {
    render(<EntityCardList entities={mixed} sources={['PHB']} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Human' })).not.toBeNull();
    expect(screen.queryByRole('button', { name: 'Goblin' })).toBeNull();
    expect(screen.queryByText(/2 outside this character's sources/)).not.toBeNull();
    expect(screen.queryByText(/hidden by your source settings/)).toBeNull();
  });

  it('replaces the device settings rather than narrowing them further', () => {
    // The device hides PHB; the character's table allows it.
    policyState.current = { mode: 'only', sources: ['XPHB'] };
    render(<EntityCardList entities={mixed} sources={['PHB']} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Human' })).not.toBeNull();
    cleanup();

    // An empty list restricts nothing, so the device settings stay in charge.
    policyState.current = { mode: 'only', sources: ['PHB'] };
    render(<EntityCardList entities={mixed} sources={[]} onSelect={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Goblin' })).toBeNull();
    expect(screen.queryByText(/2 hidden by your source settings/)).not.toBeNull();
    expect(screen.queryByText(OUTSIDE)).toBeNull();
  });

  it('keeps a current pick from outside the list, labelled in words', () => {
    render(
      <EntityCardList
        entities={mixed}
        sources={['PHB']}
        selectedUid="goblin|xge"
        onSelect={vi.fn()}
      />,
    );
    const goblin = screen.getByRole('button', { name: 'Goblin' });
    // The aria-label hides the cue from the name, so it is the description.
    expect(screen.getByText(OUTSIDE).id).toBe(goblin.getAttribute('aria-describedby'));
    // Picks inside the list carry no such cue.
    expect(screen.getAllByText(OUTSIDE)).toHaveLength(1);
  });

  it('reveals the rest on request, each one labelled', () => {
    render(<EntityCardList entities={mixed} sources={['PHB']} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText(/outside this character's sources/));
    expect(screen.queryByRole('button', { name: 'Goblin' })).not.toBeNull();
    expect(screen.getAllByText(OUTSIDE)).toHaveLength(2);
    fireEvent.click(screen.getByText("Back to this character's sources"));
    expect(screen.queryByRole('button', { name: 'Goblin' })).toBeNull();
  });
});

describe('EntityCardList printings of one name', () => {
  // Three books' Goblins, each with its own rules, and one name in one book.
  const goblins: Entity[] = [
    { name: 'Goblin', source: 'VGM', blurb: 'VGM rules' },
    { name: 'Goblin', source: 'MPMM', blurb: 'MPMM rules' },
    { name: 'Goblin', source: 'DMG', blurb: 'DMG rules' },
    { name: 'Human', source: 'PHB', blurb: 'PHB rules' },
  ];
  const describe_ = (e: Entity) => String(e.blurb);
  const cardOf = (name: RegExp) => screen.getByRole('button', { name });
  const switchOf = (name: string) => screen.getByRole('group', { name: `${name}, printed in` });

  it('gives a name one card, with a switch between its books', () => {
    render(<EntityCardList entities={goblins} describe={describe_} onSelect={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /^Goblin/ })).toHaveLength(1);
    const books = switchOf('Goblin').querySelectorAll('button');
    // Book order: the core books by rank, so the MPMM printing leads.
    expect([...books].map((b) => b.textContent)).toEqual(['MPMM', 'VGM', 'DMG']);
    // A name in one book keeps its badge and has no switch.
    expect(screen.queryByRole('group', { name: 'Human, printed in' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Human' })).toBeTruthy();
  });

  it('shows the switched-to printing and picks that one', () => {
    const onSelect = vi.fn();
    render(<EntityCardList entities={goblins} describe={describe_} onSelect={onSelect} />);
    // Opens on the first book, its rules and its title in the card's name.
    expect(cardOf(/^Goblin, Mordenkainen Presents/)).toBeTruthy();
    expect(screen.queryByText('MPMM rules')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^VGM,/ }));
    expect(screen.getByRole('button', { name: /^VGM,/, pressed: true })).toBeTruthy();
    expect(screen.queryByText('MPMM rules')).toBeNull();
    expect(screen.queryByText('VGM rules')).not.toBeNull();
    expect(onSelect).not.toHaveBeenCalled();

    fireEvent.click(cardOf(/^Goblin, Volo's Guide/));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ name: 'Goblin', source: 'VGM' });
  });

  it('opens on the current pick, picked, and shows another book unpicked', () => {
    const onSelect = vi.fn();
    render(
      <EntityCardList
        entities={goblins}
        describe={describe_}
        selectedUid="goblin|dmg"
        onSelect={onSelect}
      />,
    );
    expect(
      screen.getByRole('button', { name: /^Goblin, Dungeon Master/, pressed: true }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^MPMM,/ }));
    // What the card shows is what a tap picks, so it is not the pick.
    const mpmm = screen.getByRole('button', { name: /^Goblin, Mordenkainen/, pressed: false });
    fireEvent.click(mpmm);
    expect(onSelect.mock.calls[0]?.[0]).toMatchObject({ source: 'MPMM' });
  });

  it('switches between the books in the player sources only, keeping the pick', () => {
    policyState.current = { mode: 'all', except: ['VGM', 'DMG'] };
    const { unmount } = render(<EntityCardList entities={goblins} onSelect={vi.fn()} />);
    // One book left, so a plain card with its badge.
    expect(screen.queryByRole('group', { name: 'Goblin, printed in' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Goblin' })).toBeTruthy();
    unmount();

    render(<EntityCardList entities={goblins} selectedUid="goblin|vgm" onSelect={vi.fn()} />);
    const books = switchOf('Goblin').querySelectorAll('button');
    expect([...books].map((b) => b.textContent)).toEqual(['MPMM', 'VGM']);
  });

  it('files a title under its best book in a curated list', () => {
    const list: Entity[] = [
      { name: 'Aarakocra', source: 'EEPC' },
      { name: 'Goblin', source: 'GGR' },
      { name: 'Goblin', source: 'PHB' },
      { name: 'Human', source: 'PHB' },
    ];
    render(<EntityCardList curated entities={list} onSelect={vi.fn()} />);
    // The cards' own buttons, not the books in a switch.
    const names = screen
      .getAllByRole('button', { pressed: false })
      .filter((b) => b.closest('[role="group"]') === null)
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(["Goblin, Player's Handbook (2014)", 'Human', 'Aarakocra']);
  });

  it('keeps playtest content behind the fold in a curated list, and the pick out of it', () => {
    const list: Entity[] = [
      { name: 'Human', source: 'PHB' },
      { name: 'Gremlin', source: 'UAGremlins' },
      { name: 'Sprite', source: 'UASprites' },
    ];
    render(
      <EntityCardList curated entities={list} selectedUid="sprite|uasprites" onSelect={vi.fn()} />,
    );
    expect(screen.queryByRole('button', { name: 'Gremlin' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sprite' })).not.toBeNull();
    fireEvent.click(screen.getByText('Show 1 more: playtest content, sidekicks and variants'));
    expect(screen.queryByRole('button', { name: 'Gremlin' })).not.toBeNull();
    fireEvent.click(screen.getByText('Show fewer: hide playtest content, sidekicks and variants'));
    expect(screen.queryByRole('button', { name: 'Gremlin' })).toBeNull();
  });

  it('names the shown book in the details button', () => {
    render(<EntityCardList entities={goblins} infoType="race" onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Goblin, Mordenkainen.* details$/ })).toBeTruthy();
  });
});

describe('EntityCardList info button (A11Y-002)', () => {
  it('gives the details button a 44px target without growing the row', () => {
    render(<EntityCardList entities={entities} onSelect={vi.fn()} infoType="race" />);
    const info = screen.getByRole('button', { name: 'Elf details' });
    expect(info.className.split(' ')).toEqual(expect.arrayContaining(['tap', '-m-2.5']));
    // The gap matches the negative margin, so the target stops at the badge.
    expect(info.closest('div')?.className.split(' ')).toContain('gap-2.5');
  });
});
