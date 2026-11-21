// @vitest-environment jsdom
// A choice sheet with a search box, group headings and a second line per
// option (the Workshop's Add an effect sheet). Each is optional: a choice asked
// without them is drawn as before.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { askChoice, type ChoiceOption, choiceMatches, DialogHost } from './dialogs';

// jsdom has no matchMedia and the drawer asks for one on mount.
beforeAll(() => {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
});

afterEach(cleanup);

const OPTIONS: ChoiceOption[] = [
  { id: 'str', label: 'Strength at least', line: 'Sets a minimum score', group: 'Abilities' },
  { id: 'ac', label: 'Armor Class', line: 'Raises Armor Class', group: 'Defenses' },
  { id: 'skill', label: 'Skill', line: 'Proficiency in a skill', group: 'Abilities' },
  { id: 'fly', label: 'Fly', line: 'A flying speed', group: 'Movement', words: 'wings air' },
];

function ask(opts: Parameters<typeof askChoice>[0]) {
  render(<DialogHost />);
  let answer: Promise<string | null> = Promise.resolve(null);
  act(() => {
    answer = askChoice(opts);
  });
  return () => answer;
}

const search = () => screen.getByRole('searchbox', { name: 'Search' });
const type = (text: string) => fireEvent.change(search(), { target: { value: text } });
/** The options shown, by name: an option with a second line is named by its label alone. */
// The options, not the sheet's Close (review item 6), which every choice has.
const listed = () =>
  screen
    .queryAllByRole('button')
    .filter((b) => b.getAttribute('aria-label') !== 'Close')
    .map((b) => b.querySelector('[id$="-label"]')?.textContent);
/** The text of what an element names by id (`aria-describedby`, `aria-labelledby`). */
const said = (el: HTMLElement, attr: string) =>
  (el.getAttribute(attr) ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent)
    .join(' ');

describe('askChoice', () => {
  it('draws a choice without the new options as before: no search, no headings', async () => {
    const answer = ask({
      title: 'Cast at',
      options: [
        { id: '1', label: '1st level', hint: '2 left' },
        { id: '2', label: '2nd level' },
      ],
    });
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
    // Named by its content, label and hint, as it was.
    const first = screen.getByRole('button', { name: /^1st level/ });
    expect(first.hasAttribute('aria-labelledby')).toBe(false);
    expect([...first.children].map((c) => c.textContent)).toEqual(['1st level', '2 left']);
    fireEvent.click(first);
    await expect(answer()).resolves.toBe('1');
  });

  it('lists options under their group, groups in the order their first option comes', () => {
    ask({ title: 'Add', options: OPTIONS, search: 'Search' });
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(['Abilities', 'Defenses', 'Movement']);
    const abilities = screen.getByRole('heading', { name: 'Abilities' })
      .parentElement as HTMLElement;
    expect(
      within(abilities)
        .getAllByRole('button')
        .map((b) => said(b, 'aria-labelledby')),
    ).toEqual(['Strength at least', 'Skill']);
  });

  it('names an option by its label and describes it by its second line', () => {
    ask({ title: 'Add', options: OPTIONS });
    const ac = screen.getByRole('button', { name: 'Armor Class' });
    expect(said(ac, 'aria-describedby')).toBe('Raises Armor Class');
  });

  it('finds options by what their second line, group or words say, every word typed', () => {
    ask({ title: 'Add', options: OPTIONS, search: 'Search' });
    type('minimum');
    expect(listed()).toEqual(['Strength at least']);
    type('abilities');
    expect(listed()).toEqual(['Strength at least', 'Skill']);
    type('WINGS');
    expect(listed()).toEqual(['Fly']);
    type('flying armor');
    expect(listed()).toHaveLength(0);
    type('   ');
    expect(listed()).toHaveLength(4);
  });

  it('says when nothing matches and offers the choice to take instead', async () => {
    const answer = ask({
      title: 'Add',
      options: OPTIONS,
      search: 'Search',
      noMatch: (q) => ({
        say: `Nothing does "${q}" yet.`,
        choice: { id: 'note', label: 'Add a note' },
      }),
    });
    type('teleport');
    expect(screen.getByRole('status').textContent).toBe('Nothing does "teleport" yet.');
    fireEvent.click(screen.getByRole('button', { name: 'Add a note' }));
    await expect(answer()).resolves.toBe('note');
  });

  it('says nothing matches in a live region there from the start, so it is announced', () => {
    ask({ title: 'Add', options: OPTIONS, search: 'Search' });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    type('teleport');
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Nothing matches "teleport".');
    type('');
    expect(status.textContent).toBe('');
  });

  it('says nothing matches when the ask gives no words for it', () => {
    ask({ title: 'Add', options: OPTIONS, search: 'Search' });
    type('teleport');
    expect(screen.getByRole('status').textContent).toBe('Nothing matches "teleport".');
    expect(listed()).toHaveLength(0);
  });

  it('matches a word anywhere in what an option says, without case', () => {
    const o = OPTIONS[3] as ChoiceOption;
    expect(choiceMatches(o, 'AIR fly')).toBe(true);
    expect(choiceMatches(o, 'air swim')).toBe(false);
  });
});
