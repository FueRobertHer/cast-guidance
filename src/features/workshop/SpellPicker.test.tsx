// @vitest-environment jsdom
/**
 * The Workshop's spell box: a typed name with the matching spells listed
 * under it, each with its book. Filtering, the cap, the keys, a tap, words
 * kept as typed, and two printings of one name told apart.
 */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SpellOption } from './cards/kit/types';
import { printingOf, SHOWN_AT_MOST, SpellPicker, spellMatches } from './SpellPicker';

afterEach(cleanup);

const SPELLS: SpellOption[] = [
  { name: 'Delayed Blast Fireball', source: 'PHB' },
  { name: 'Fire Bolt', source: 'PHB' },
  { name: 'Fireball', source: 'PHB' },
  { name: 'Fireball', source: 'XPHB' },
  { name: 'Light', source: 'PHB' },
];

/** The box in a host that keeps what it is handed, as each Workshop site does. */
function mount(options: readonly SpellOption[] = SPELLS, start = '') {
  const typed: string[] = [];
  const picks: SpellOption[] = [];
  function Host() {
    const [value, setValue] = useState(start);
    const [picked, setPicked] = useState<SpellOption | undefined>(undefined);
    return (
      <SpellPicker
        label="Spell"
        ariaLabel="Cast a spell: Spell"
        value={value}
        options={options}
        picked={picked}
        onType={(t) => {
          typed.push(t);
          setValue(t);
          setPicked(undefined);
        }}
        onPick={(s) => {
          picks.push(s);
          setValue(s.name);
          setPicked(s);
        }}
      />
    );
  }
  render(<Host />);
  return { typed, picks };
}

const box = () => screen.getByRole('combobox', { name: 'Cast a spell: Spell' }) as HTMLInputElement;
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });
const key = (k: string) => fireEvent.keyDown(box(), { key: k });
const list = () => screen.queryByRole('listbox', { name: 'Spells found' });
/** Each row as its name and its book. */
const rows = () =>
  within(screen.getByRole('listbox', { name: 'Spells found' }))
    .getAllByRole('option')
    .map((o) => [o.firstElementChild?.textContent, o.querySelector('[aria-hidden]')?.textContent]);
const active = () => {
  const id = box().getAttribute('aria-activedescendant');
  return id === null ? undefined : document.getElementById(id)?.firstElementChild?.textContent;
};

describe('spellMatches', () => {
  it('finds names holding the words in any case, those that start with them first', () => {
    expect(spellMatches(SPELLS, 'FIREB').shown.map((s) => s.name)).toEqual([
      'Fireball',
      'Fireball',
      'Delayed Blast Fireball',
    ]);
    expect(spellMatches(SPELLS, '  light ').shown).toEqual([{ name: 'Light', source: 'PHB' }]);
    expect(spellMatches(SPELLS, 'zzz')).toEqual({ shown: [], more: 0 });
  });

  it('draws at most the cap, and counts the rest', () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ name: `Spell ${i}`, source: 'TST' }));
    const found = spellMatches(many, 'spell');
    expect(found.shown).toHaveLength(SHOWN_AT_MOST);
    expect(found.more).toBe(45 - SHOWN_AT_MOST);
  });
});

describe('printingOf', () => {
  it('names the printing a stored ref holds, in any case and with a # part left aside', () => {
    expect(printingOf('Fireball|XPHB', SPELLS)).toEqual({ name: 'Fireball', source: 'XPHB' });
    expect(printingOf('fireball|xphb#3', SPELLS)).toEqual({ name: 'Fireball', source: 'XPHB' });
    expect(printingOf('Fireball', SPELLS)).toBeUndefined();
    expect(printingOf('Fireball|TCE', SPELLS)).toBeUndefined();
  });
});

describe('SpellPicker', () => {
  it('is a labelled combobox whose list opens as it is typed in', () => {
    mount();
    expect(box().getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('Cast a spell: Spell')).toBe(box());
    type('fire');
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().getAttribute('aria-controls')).toBe(list()?.id);
    // Prefix matches first, the rest after, both printings of Fireball apart.
    expect(rows()).toEqual([
      ['Fire Bolt', 'PHB'],
      ['Fireball', 'PHB'],
      ['Fireball', 'XPHB'],
      ['Delayed Blast Fireball', 'PHB'],
    ]);
  });

  it('names each row by its spell and its book, apart, as a screen reader says it', () => {
    mount();
    type('fireball');
    const found = within(screen.getByRole('listbox', { name: 'Spells found' }));
    expect(found.getByRole('option', { name: "Fireball, Player's Handbook (2024)" })).toBeTruthy();
    expect(found.getByRole('option', { name: "Fireball, Player's Handbook (2014)" })).toBeTruthy();
  });

  it('keeps its list inside a narrow screen at large text', () => {
    mount();
    type('fire');
    const cls = screen.getByRole('listbox', { name: 'Spells found' }).parentElement?.className ?? '';
    // A fixed least width would outgrow a 320px screen at 200% text (15rem is 480px).
    expect(cls).not.toMatch(/(^|\s)min-w-60(\s|$)/);
    expect(cls).toContain('min-w-[min(15rem,calc(100vw-2rem))]');
  });

  it('says how many more match than it shows', () => {
    const many = Array.from({ length: 31 }, (_, i) => ({ name: `Spell ${i}`, source: 'TST' }));
    mount(many);
    type('spell');
    expect(rows()).toHaveLength(SHOWN_AT_MOST);
    expect(
      screen.getByText('1 more spell matches. Type more of the name to find it.'),
    ).toBeTruthy();
    cleanup();
    mount([...many, { name: 'Spell 31', source: 'TST' }]);
    type('spell');
    expect(
      screen.getByText('2 more spells match. Type more of the name to find them.'),
    ).toBeTruthy();
    type('spell 3');
    expect(screen.queryByText(/more spells? match/)).toBeNull();
  });

  it('moves through the rows with the arrows, and Enter picks the one it is on', () => {
    const at = mount();
    type('fireball');
    expect(active()).toBeUndefined();
    key('ArrowDown');
    expect(active()).toBe('Fireball');
    key('ArrowDown');
    key('ArrowDown');
    expect(active()).toBe('Delayed Blast Fireball');
    // Past the last row is the first again, and above the first the last.
    key('ArrowDown');
    expect(active()).toBe('Fireball');
    key('ArrowUp');
    expect(active()).toBe('Delayed Blast Fireball');
    key('ArrowUp');
    key('ArrowUp');
    expect(active()).toBe('Fireball');
    key('ArrowDown');
    const on = screen.getByRole('option', { selected: true });
    expect(on.id).toBe(box().getAttribute('aria-activedescendant'));
    expect(on.textContent).toContain('XPHB');
    key('Enter');
    expect(at.picks).toEqual([{ name: 'Fireball', source: 'XPHB' }]);
    expect(box().value).toBe('Fireball');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    // The pick is handed back alone: never the words of its name as well.
    expect(at.typed).toEqual(['fireball']);
    // The box says which printing it holds.
    expect(
      document.getElementById(box().getAttribute('aria-describedby') ?? '')?.textContent,
    ).toContain('XPHB');
  });

  it('opens from the keyboard with nothing typed', () => {
    mount();
    key('ArrowDown');
    expect(rows()).toHaveLength(SPELLS.length);
    expect(active()).toBe('Delayed Blast Fireball');
    key('Escape');
    key('ArrowUp');
    expect(active()).toBe('Light');
  });

  it('picks a row tapped, the second printing as itself', () => {
    const at = mount();
    type('fireball');
    const xphb = within(list() as HTMLElement)
      .getAllByRole('option')
      .find((o) => o.textContent?.includes('XPHB'));
    if (xphb === undefined) throw new Error('no XPHB row');
    // The row keeps the box's focus as it is pressed.
    expect(fireEvent.mouseDown(xphb)).toBe(false);
    fireEvent.click(xphb);
    expect(at.picks).toEqual([{ name: 'Fireball', source: 'XPHB' }]);
    expect(at.typed).toEqual(['fireball']);
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps words that match nothing as typed, and Enter with no row on does nothing', () => {
    const at = mount();
    type('Moonbeam of Elsewhere');
    expect(box().getAttribute('aria-expanded')).toBe('false');
    key('Enter');
    expect(at.typed).toEqual(['Moonbeam of Elsewhere']);
    expect(at.picks).toEqual([]);
    expect(box().value).toBe('Moonbeam of Elsewhere');
    type('fire');
    key('Enter');
    expect(at.picks).toEqual([]);
    expect(box().value).toBe('fire');
  });

  it('closes on Escape without the sheet it sits in hearing it, and lets it through when closed', () => {
    // A sheet (vaul, Radix) listens on the document before the box hears a key.
    const sheet = vi.fn();
    const onDocument = (e: KeyboardEvent) => {
      if (e.key === 'Escape') sheet();
    };
    document.addEventListener('keydown', onDocument, true);
    const parent = vi.fn();
    try {
      render(
        // biome-ignore lint/a11y/noStaticElementInteractions: a stand-in for a dialog's own handler
        <div onKeyDown={(e) => e.key === 'Escape' && parent()}>
          <Wrapped />
        </div>,
      );
      fireEvent.change(box(), { target: { value: 'fire' } });
      expect(box().getAttribute('aria-expanded')).toBe('true');
      key('Escape');
      expect(box().getAttribute('aria-expanded')).toBe('false');
      expect(box().value).toBe('fire');
      expect(sheet).not.toHaveBeenCalled();
      expect(parent).not.toHaveBeenCalled();
      key('Escape');
      expect(sheet).toHaveBeenCalledTimes(1);
      expect(parent).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', onDocument, true);
    }
  });

  it('closes when it loses focus, and Tab leaves the box as it would', () => {
    mount();
    type('fire');
    const tab = fireEvent.keyDown(box(), { key: 'Tab' });
    expect(tab).toBe(true);
    fireEvent.blur(box());
    expect(box().getAttribute('aria-expanded')).toBe('false');
  });

  it('lists nothing while it cannot be changed', () => {
    render(
      <SpellPicker
        label="Spell 1"
        value="Light"
        options={SPELLS}
        disabled
        onType={() => {}}
        onPick={() => {}}
      />,
    );
    const input = screen.getByLabelText('Spell 1') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(input.value).toBe('Light');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-expanded')).toBe('false');
  });
});

/** The picker in a host of its own, for the Escape test's own parent. */
function Wrapped() {
  const [value, setValue] = useState('');
  return (
    <SpellPicker
      label="Spell"
      ariaLabel="Cast a spell: Spell"
      value={value}
      options={SPELLS}
      onType={setValue}
      onPick={(s) => setValue(s.name)}
    />
  );
}
