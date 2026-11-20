// @vitest-environment jsdom
/**
 * U4b's cards for spells (ADR-002, board 4): spell damage and spells added to a
 * class's list, and the Spell attacks and Spell save DC cards' new boxes (one
 * class's spells, those cast with one ability). Each is worked through its
 * boxes, read back from what it wrote, and counted on a sheet beside one
 * without it: on the class it names, and not on the other.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterDoc, DerivedSheet } from '@/engine/types';
import {
  boxValue,
  change,
  makeCard,
  noProblems,
  renderCards,
  sheetWith,
} from '../../../../tests-fixtures/cardSheet';
import { EffectCards, moreKinds, type SpellOption } from '../EffectCards';
import { SpellChoices } from '../spellChoices';
import { cards } from './spells';

/** What More last offered. */
const asked = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('@/ui/dialogs', () => ({
  askChoice: (req: { options: Array<{ id: string }> }) => {
    asked.ids = req.options.map((o) => o.id);
    return Promise.resolve(undefined);
  },
}));

afterEach(cleanup);

type Eff = Record<string, unknown> & { kind: string };

const make = (add: string) => makeCard(cards, add);
const tick = (label: string) => screen.getByRole('checkbox', { name: label }) as HTMLInputElement;
const line = (text: string) => expect(screen.getByText(text)).toBeTruthy();

/** A Mage 3 (Intelligence) and Pactcaster 2 (Charisma): two blocks, two abilities. */
const casters = (d: CharacterDoc) => {
  d.abilities.base = { str: 10, dex: 14, con: 14, int: 16, wis: 12, cha: 16 };
  d.classes = [
    { ref: { name: 'Mage', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] },
    { ref: { name: 'Pactcaster', source: 'TST' }, levels: 2, hp: ['avg', 'avg'] },
  ];
};
const block = (s: DerivedSheet, c: string) => {
  const b = s.spellcasting.find((x) => x.className === c);
  if (b === undefined) throw new Error(`no ${c} block`);
  return b;
};
/** How much each block's spell attack and DC rose with `effects`. */
const gained = (effects: Eff[]) => {
  const plain = sheetWith([], { setup: casters });
  const now = sheetWith(effects, { setup: casters });
  return ['Mage', 'Pactcaster'].map((c) => ({
    attack: block(now, c).attackMod.value - block(plain, c).attackMod.value,
    dc: block(now, c).saveDc.value - block(plain, c).saveDc.value,
  }));
};

describe('Spell attacks and Spell save DC, narrowed', () => {
  it("writes one class's spell attacks, and the sheet adds it to that block alone", () => {
    const cards = renderCards([make('Spell attacks')]);
    change('Spell attacks: Only spells of', 'Pactcaster');
    expect(cards.written()).toEqual([
      { kind: 'attackBonus', amount: 1, attack: 'spell', className: 'Pactcaster' },
    ]);
    line('+1 to Pactcaster spell attack rolls');
    noProblems(cards.written());
    expect(gained(cards.written())).toEqual([
      { attack: 0, dc: 0 },
      { attack: 1, dc: 0 },
    ]);

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue('Spell attacks: Only spells of')).toBe('Pactcaster');
    // Emptied, every class's.
    change('Spell attacks: Only spells of', ' ');
    expect(again.written()).toEqual([{ kind: 'attackBonus', amount: 1, attack: 'spell' }]);
  });

  it('writes spell attacks for the spells cast with one ability', () => {
    const cards = renderCards([make('Spell attacks')]);
    change('Spell attacks: Cast with', 'cha');
    expect(cards.written()).toEqual([
      { kind: 'attackBonus', amount: 1, attack: 'spell', ability: 'cha' },
    ]);
    noProblems(cards.written());
    expect(gained(cards.written())).toEqual([
      { attack: 0, dc: 0 },
      { attack: 1, dc: 0 },
    ]);
  });

  it('writes a DC for the spells cast with one ability, and for one class', () => {
    const cards = renderCards([make('Spell save DC')]);
    change('Spell save DC: Cast with', 'int');
    expect(cards.written()).toEqual([{ kind: 'spellDcBonus', amount: 1, ability: 'int' }]);
    line('+1 to your spell save DC, for spells cast with Intelligence');
    noProblems(cards.written());
    expect(gained(cards.written())).toEqual([
      { attack: 0, dc: 1 },
      { attack: 0, dc: 0 },
    ]);
    change('Spell save DC: Cast with', '');
    change('Spell save DC: Only spells of', 'mage');
    expect(cards.written()).toEqual([{ kind: 'spellDcBonus', amount: 1, className: 'mage' }]);
    line('+1 to your mage spell save DC');
    // A class named in any case.
    expect(gained(cards.written())).toEqual([
      { attack: 0, dc: 1 },
      { attack: 0, dc: 0 },
    ]);

    cleanup();
    renderCards(cards.written());
    expect(boxValue('Spell save DC: Only spells of')).toBe('mage');
    expect(boxValue('Spell save DC: Cast with')).toBe('');
  });
});

describe('Attack rolls, every attack, on spells', () => {
  it('narrowed to one ability, reaches the spell blocks cast with it alone', () => {
    const cards = renderCards([{ kind: 'attackBonus', amount: 1, scope: 'all' }]);
    change('Attack rolls: Which', ':every');
    change('Attack rolls: With', 'cha');
    expect(cards.written()).toEqual([
      { kind: 'attackBonus', amount: 1, scope: 'all', attack: 'any', ability: 'cha' },
    ]);
    noProblems(cards.written());
    // Pactcaster casts with Charisma, Mage with Intelligence.
    const plain = sheetWith([], { setup: casters });
    const now = sheetWith(cards.written(), { setup: casters });
    const mod = (s: DerivedSheet, c: string) => block(s, c).attackMod.value;
    expect(mod(now, 'Pactcaster')).toBe(mod(plain, 'Pactcaster') + 1);
    expect(mod(now, 'Mage')).toBe(mod(plain, 'Mage'));
  });
});

describe('Spell damage', () => {
  const T = 'Spell damage';
  const bonuses = (effects: Eff[]) =>
    sheetWith(effects, { setup: casters }).spellDamageBonuses.filter(
      (b) => b.origin === 'Card Feat',
    );

  it("adds an ability's modifier to cantrips' damage, and the sheet works it out", () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    line('Your Charisma modifier to the damage of cantrips');
    change(`${T}: Only spells of`, 'Pactcaster');
    change(`${T}: Only these spells`, 'Eldritch Blast');
    expect(cards.written()).toEqual([
      {
        kind: 'spellDamageBonus',
        amount: { f: 'mod.cha' },
        cantrips: true,
        className: 'Pactcaster',
        spells: ['Eldritch Blast'],
      },
    ]);
    line('Your Charisma modifier to the damage of Eldritch Blast, if Pactcaster cantrips');
    noProblems(cards.written());
    // Charisma 16 is +3.
    expect(bonuses([])).toEqual([]);
    expect(bonuses(cards.written())).toEqual([
      {
        amount: 3,
        origin: 'Card Feat',
        spells: ['Eldritch Blast'],
        className: 'Pactcaster',
        cantrips: true,
      },
    ]);

    cleanup();
    const again = renderCards(cards.written());
    expect(boxValue(`${T}: Adds`)).toBe('cha');
    expect(screen.queryByLabelText(`${T}: Amount`)).toBeNull();
    expect(tick(`${T}: Cantrips only`).checked).toBe(true);
    expect(boxValue(`${T}: Only these spells`)).toBe('Eldritch Blast');
    expect(again.written()).toEqual(cards.written());
  });

  it('keeps Amount open while a formula is typed that starts as a modifier', () => {
    const cards = renderCards([make(T)]);
    change(`${T}: Adds`, ':number');
    // "mod.cha" on the way to "mod.cha + 1": Adds would read it as Charisma's modifier.
    for (const typed of ['mod.cha', 'mod.cha + 1']) {
      change(`${T}: Amount`, typed);
      expect(boxValue(`${T}: Amount`)).toBe(typed);
      expect(boxValue(`${T}: Adds`)).toBe(':number');
    }
    expect(cards.written()).toEqual([
      { kind: 'spellDamageBonus', amount: { f: 'mod.cha + 1' }, cantrips: true },
    ]);
    noProblems(cards.written());

    // Read back, a modifier alone is the modifier.
    cleanup();
    renderCards([{ kind: 'spellDamageBonus', amount: { f: 'mod.cha' } }]);
    expect(boxValue(`${T}: Adds`)).toBe('cha');
    expect(screen.queryByLabelText(`${T}: Amount`)).toBeNull();
  });

  it("shows a file's empty school as written, and Any school takes it away", () => {
    const cards = renderCards([{ kind: 'spellDamageBonus', amount: 1, school: '' }]);
    const school = screen.getByLabelText(`${T}: School`) as HTMLSelectElement;
    expect(school.selectedOptions[0]?.textContent).toBe('"", as written');
    change(`${T}: School`, '');
    expect(cards.written()).toEqual([{ kind: 'spellDamageBonus', amount: 1 }]);
    noProblems(cards.written());
  });

  it('adds a number to one school, once a cast', () => {
    const cards = renderCards([make(T)]);
    change(`${T}: Adds`, ':number');
    change(`${T}: Amount`, '2');
    fireEvent.click(tick(`${T}: Cantrips only`));
    change(`${T}: School`, 'V');
    fireEvent.click(tick(`${T}: On one damage roll a cast, not each`));
    expect(cards.written()).toEqual([
      { kind: 'spellDamageBonus', amount: 2, school: 'V', oneRoll: true },
    ]);
    line('+2 to the damage of Evocation spells, on one damage roll a cast');
    noProblems(cards.written());
    expect(bonuses(cards.written())).toEqual([
      { amount: 2, origin: 'Card Feat', school: 'V', oneRoll: true },
    ]);
  });

  it("keeps a file's own class's spells, which has no box", () => {
    const cards = renderCards([
      { kind: 'spellDamageBonus', amount: 1, ownClass: true, cantrips: true },
    ]);
    line('+1 to the damage of cantrips of the class that gives it');
    expect(screen.queryByLabelText(`${T}: Only spells of`)).toBeNull();
    fireEvent.click(tick(`${T}: Cantrips only`));
    expect(cards.written()).toEqual([{ kind: 'spellDamageBonus', amount: 1, ownClass: true }]);
  });
});

describe('Spells added to a class list', () => {
  const T = 'Spells added to a class list';

  it("names spells for one class's list, and the sheet adds them to that list alone", () => {
    const start = make(T);
    noProblems([start]);
    const cards = renderCards([start]);
    line('Fireball joins the list of the class that gives it, or else each of yours');
    const box = `${T}: Spells`;
    for (const typed of ['Fireball,', 'Fireball, ', 'Fireball, Aid']) {
      change(box, typed);
      expect(boxValue(box)).toBe(typed);
    }
    change(`${T}: Class list`, 'Pactcaster');
    expect(cards.written()).toEqual([
      { kind: 'spellListAdd', spells: ['Fireball', 'Aid'], className: 'Pactcaster' },
    ]);
    line('Fireball and Aid join your Pactcaster spell list');
    noProblems(cards.written());

    const s = sheetWith(cards.written(), { setup: casters });
    expect(block(s, 'Pactcaster').expanded).toEqual([
      { from: 'Card Feat', spells: ['Fireball', 'Aid'], filters: [] },
    ]);
    expect(block(s, 'Mage').expanded ?? []).toEqual([]);
    // With no class, each list.
    const each = sheetWith([{ kind: 'spellListAdd', spells: ['Aid'] }], { setup: casters });
    expect(block(each, 'Mage').expanded?.[0]?.spells).toEqual(['Aid']);
    expect(block(each, 'Pactcaster').expanded?.[0]?.spells).toEqual(['Aid']);

    cleanup();
    renderCards(cards.written());
    expect(boxValue(box)).toBe('Fireball, Aid');
    expect(boxValue(`${T}: Class list`)).toBe('Pactcaster');
  });

  it('says it counts once a spell is named', () => {
    const cards = renderCards([make(T)]);
    change(`${T}: Spells`, '');
    expect(cards.written()).toEqual([{ kind: 'spellListAdd' }]);
    line('No spell yet joins the list of the class that gives it, or else each of yours');
    expect(screen.getByText(/This does not count yet: name a spell/)).toBeTruthy();
  });

  it("says the reader's own words for a file's other problem", () => {
    renderCards([
      { kind: 'spellListAdd', spells: Array.from({ length: 51 }, (_, i) => `Spell ${i}`) },
    ]);
    expect(screen.getByText(/"spells" lists at most 50/)).toBeTruthy();
    expect(screen.queryByText(/name a spell/)).toBeNull();
  });
});

describe('where the spell cards are offered', () => {
  it('leaves out of play what only a build gives', () => {
    const inPlay = moreKinds({ inPlay: true, spells: true });
    expect(inPlay).toEqual(expect.arrayContaining(['Spell attacks', 'Spell save DC']));
    for (const k of ['Spell damage', 'Spells added to a class list', 'Cast a spell']) {
      expect(inPlay).not.toContain(k);
    }
    expect(moreKinds({ inPlay: false, spells: false })).toEqual(
      expect.arrayContaining(['Spell damage', 'Spells added to a class list']),
    );
  });
});

describe('Cast a spell, with the spells of the page', () => {
  const PAGE: SpellOption[] = [
    { name: 'Aid', source: 'TST' },
    { name: 'Guidance', source: 'TST' },
  ];
  /** A list whose host names `spells` or none, on a page that has `page`'s. */
  function onPage(start: Eff[], page?: readonly SpellOption[], spells?: readonly SpellOption[]) {
    let last = start;
    function Host() {
      const [effects, setEffects] = useState<Eff[]>(start);
      return (
        <EffectCards
          effects={effects}
          readOnly={false}
          spells={spells}
          onChange={(next) => {
            last = next as Eff[];
            setEffects(next as Eff[]);
          }}
        />
      );
    }
    render(
      <SpellChoices.Provider value={page}>
        <Host />
      </SpellChoices.Provider>,
    );
    return { written: () => last };
  }
  const offered = async () => {
    asked.ids = [];
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    await waitFor(() => expect(asked.ids.length).toBeGreaterThan(0));
    return asked.ids;
  };

  it("offers it where the host names no spells, names the page's, and the sheet casts it", async () => {
    const cards = onPage([], PAGE);
    expect(await offered()).toContain('Cast a spell');
    cleanup();

    const again = onPage([make('Cast a spell')], PAGE);
    const options = Array.from(
      document.querySelectorAll<HTMLOptionElement>('datalist option'),
      (o) => o.value,
    );
    expect(options).toEqual(['Aid', 'Guidance']);
    change('Cast a spell: Spell', 'guidance');
    expect(again.written()).toEqual([{ kind: 'grantSpell', spell: 'Guidance|TST' }]);
    line('Cast Guidance at will');
    noProblems(again.written());
    expect(
      sheetWith(again.written()).grantedSpells.filter((g) => g.origin === 'Card Feat'),
    ).toEqual([expect.objectContaining({ name: 'Guidance', source: 'TST' })]);
    expect(sheetWith([]).grantedSpells.some((g) => g.name === 'Guidance')).toBe(false);
    expect(cards.written()).toEqual([]);
  });

  it("names the host's own spells over the page's", () => {
    onPage([make('Cast a spell')], PAGE, [{ name: 'Flame Strike', source: 'TST' }]);
    const options = Array.from(
      document.querySelectorAll<HTMLOptionElement>('datalist option'),
      (o) => o.value,
    );
    expect(options).toEqual(['Flame Strike']);
  });

  it('is not offered with no spells to name, nor in play', async () => {
    onPage([]);
    expect(await offered()).not.toContain('Cast a spell');
    cleanup();
    // A page whose books hold no spells.
    onPage([], []);
    expect(await offered()).not.toContain('Cast a spell');
    expect(moreKinds({ inPlay: true, spells: true })).not.toContain('Cast a spell');
  });
});
