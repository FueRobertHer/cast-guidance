// @vitest-environment jsdom
/**
 * The search under + Effect (the buffs canvas, Catalog board): what it finds,
 * the questions an entry asks, and what lands when it is added.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  type ActiveEffect,
  type AttackRow,
  type CharacterDoc,
  type DerivedSheet,
  newCharacterDoc,
} from '@/engine/types';
import { getAnnouncerState, resetAnnouncer } from '@/stores/announcer';
import type { DocUpdater } from '@/stores/characterSession';
import { ConditionStrip } from './ConditionStrip';
import { RESULTS_SHOWN } from './EffectFinder';

vi.mock('@/data5e/hooks', () => ({ useRegistry: () => ({ byType: () => [] }) }));

beforeAll(() => {
  // vaul asks for matchMedia, which jsdom does not have.
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

const attack = (label: string, extra: Partial<AttackRow> = {}): AttackRow => ({
  label,
  toHit: { value: 5, base: 5, parts: [], overridden: false },
  damage: '1d8+3',
  extraDamage: [],
  properties: [],
  origin: label,
  ...extra,
});

/** What the search reads of the sheet: the weapons carried, the features, the spells granted. */
const sheet = {
  conditionImmunities: [],
  maxHp: { value: 20, base: 20, parts: [], overridden: false },
  attacks: [
    attack('Longsword', { weaponId: 'e1' }),
    attack('Moon Blade', { weaponId: 'e3', magical: true }),
    attack('Unarmed Strike'),
  ],
  actions: [],
  grantedSpells: [],
} as unknown as DerivedSheet;

function renderStrip(setup: (d: CharacterDoc) => void = () => undefined) {
  function Harness() {
    const [doc, setDoc] = useState(() => {
      const d = newCharacterDoc('c1', 'Hero', 't');
      d.rulesVersion = '2024';
      setup(d);
      return d;
    });
    const update = ((recipe: (draft: CharacterDoc) => void) =>
      setDoc((current) => {
        const next = structuredClone(current);
        recipe(next);
        return next;
      })) as DocUpdater;
    return (
      <>
        <h1 id="sheet-title" tabIndex={-1}>
          Hero
        </h1>
        <output data-testid="play">{JSON.stringify(doc.play)}</output>
        <ConditionStrip doc={doc} sheet={sheet} update={update} addable />
      </>
    );
  }
  render(<Harness />);
}

const play = () =>
  JSON.parse(screen.getByTestId('play').textContent ?? '{}') as CharacterDoc['play'];
/** The effects in play as stored, without their ids (each a fresh random one). */
const stored = (): Array<Omit<ActiveEffect, 'id'>> =>
  (play().activeEffects ?? []).map(({ id: _, ...rest }) => rest);

const openPicker = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Add an effect' }));
  return within(await screen.findByRole('dialog', { name: 'Effects' }));
};
const type = (picker: ReturnType<typeof within>, words: string) =>
  fireEvent.change(picker.getByRole('searchbox', { name: 'Search effects' }), {
    target: { value: words },
  });
const results = async (picker: ReturnType<typeof within>) =>
  within(await picker.findByRole('list', { name: 'Effects found' }));
/** Open the result whose name is given, as found by these words. */
const open = async (picker: ReturnType<typeof within>, words: string, name: string) => {
  type(picker, words);
  const list = await results(picker);
  fireEvent.click(list.getByRole('button', { name: new RegExp(`^${name}\\b`) }));
  return picker.getByRole('heading', { name });
};

describe('the search under + Effect', () => {
  it('finds an effect by what it does, asks its question, and lands it answered', async () => {
    renderStrip();
    const picker = await openPicker();
    expect(picker.getByRole('heading', { name: 'Helping you' })).toBeTruthy();

    type(picker, 'cold resist');
    const list = await results(picker);
    // The lists below give way to what the words find.
    expect(picker.queryByRole('heading', { name: 'Helping you' })).toBeNull();
    fireEvent.click(list.getByRole('button', { name: /^Protection from Energy/ }));

    const heading = picker.getByRole('heading', { name: 'Protection from Energy' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(picker.getByText('Spell, 3rd level. Concentration, up to 1 hour.')).toBeTruthy();
    // No type is likelier than another, so it waits for one.
    const add = picker.getByRole('button', { name: 'Choose above to add it' });
    expect((add as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      within(picker.getByRole('group', { name: 'Which damage type' })).getByRole('button', {
        name: 'Cold',
      }),
    );
    expect(picker.getByText('Half cold damage')).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));

    expect(stored()).toEqual([
      {
        name: 'Protection: cold',
        same: 'Protection from Energy',
        parts: [{ kind: 'resist', damageType: 'cold' }],
        lasts: { minutes: 60, concentration: true },
      },
    ]);
    // The search starts over, ready for the next, and the new one shows as in play.
    const box = picker.getByRole('searchbox', { name: 'Search effects' }) as HTMLInputElement;
    expect(box.value).toBe('');
    expect(document.activeElement).toBe(box);
    expect(picker.getByRole('button', { name: 'Protection: cold', pressed: true })).toBeTruthy();
  });

  it('says when nothing is found, and how many more a broad search holds', async () => {
    renderStrip();
    const picker = await openPicker();
    type(picker, 'zzz');
    expect(await picker.findByText('Nothing called “zzz” that can land on Hero.')).toBeTruthy();

    type(picker, 'spell');
    const list = await results(picker);
    expect(list.getAllByRole('listitem')).toHaveLength(RESULTS_SHOWN);
    expect(picker.getByText(/^\d+ more\. Keep typing to narrow them\.$/)).toBeTruthy();
  });

  it('goes back to what the words found, and starts over when the sheet closes', async () => {
    renderStrip();
    let picker = await openPicker();
    await open(picker, 'haste', 'Haste');
    fireEvent.click(picker.getByRole('button', { name: 'All effects' }));
    const box = picker.getByRole('searchbox', { name: 'Search effects' }) as HTMLInputElement;
    expect(box.value).toBe('haste');
    await waitFor(() => expect(document.activeElement).toBe(box));
    await results(picker);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    picker = await openPicker();
    expect(
      (picker.getByRole('searchbox', { name: 'Search effects' }) as HTMLInputElement).value,
    ).toBe('');
    expect(picker.getByRole('heading', { name: 'Helping you' })).toBeTruthy();
  });

  it('puts Magic Weapon on a free nonmagical weapon, and no second spell on it', async () => {
    renderStrip();
    const picker = await openPicker();
    await open(picker, 'magic weapon', 'Magic Weapon');
    // The one weapon it can take is the one it goes on.
    const weapons = within(picker.getByRole('group', { name: 'On which weapon' }));
    expect(weapons.getAllByRole('button').map((b) => b.textContent)).toEqual(['Longsword']);
    expect(weapons.getByRole('button', { name: 'Longsword', pressed: true })).toBeTruthy();
    expect(picker.getByText('Not offered: Moon Blade (already magical).')).toBeTruthy();
    expect(picker.getByText('+1 to attack rolls with your Longsword')).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));
    expect(stored()[0]?.parts).toEqual([
      { kind: 'attackBonus', scope: 'all', amount: 1, weapon: 'e1' },
      { kind: 'damageBonus', scope: 'all', amount: 1, weapon: 'e1' },
    ]);

    await open(picker, 'elemental', 'Elemental Weapon');
    expect(picker.queryByRole('group', { name: 'On which weapon' })).toBeNull();
    expect(
      picker.getByText(
        'Not offered: Longsword (Magic Weapon is on it), Moon Blade (already magical).',
      ),
    ).toBeTruthy();
    expect(
      picker.getByText('It needs a nonmagical weapon, and none of yours is free'),
    ).toBeTruthy();
    expect(
      (picker.getByRole('button', { name: 'No weapon to put it on' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    // In play, its sheet names the weapon it is on.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Magic Weapon' }));
    const info = within(await screen.findByRole('dialog', { name: 'Magic Weapon' }));
    expect(info.getByText('+1 to attack rolls with your Longsword')).toBeTruthy();
    expect(info.getByText('+1 damage with your Longsword')).toBeTruthy();
  });

  it('lands a spell on its caster only, and makes it what they concentrate on', async () => {
    renderStrip();
    let picker = await openPicker();
    await open(picker, 'blur', 'Blur');
    expect(
      picker.getByText('Blur lands only on its caster, and Hero does not have the spell.'),
    ).toBeTruthy();
    expect(picker.queryByRole('button', { name: /^Add/ })).toBeNull();
    cleanup();

    renderStrip((d) => {
      d.spellcasting = { wizard: { known: [{ name: 'Blur', source: 'XPHB' }], prepared: [] } };
      d.play.concentratingOn = { label: 'Bless' };
      d.play.activeEffects = [
        {
          id: 'b1',
          name: 'Bless',
          parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
          lasts: { minutes: 1, concentration: true },
          mine: true,
        },
      ];
    });
    picker = await openPicker();
    await open(picker, 'blur', 'Blur');
    expect(picker.getByText('You are concentrating on Bless: this ends it')).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));
    expect(stored()).toEqual([
      {
        name: 'Blur',
        parts: [
          {
            kind: 'cue',
            tone: 'ward',
            text: 'Attack rolls against you have disadvantage, unless the attacker has blindsight or truesight',
          },
        ],
        lasts: { minutes: 1, concentration: true },
        mine: true,
      },
    ]);
    expect(play().concentratingOn).toEqual({ label: 'Blur' });

    // Cast again, it takes the place of the one on: no twin, no "another".
    await open(picker, 'blur', 'Blur');
    expect(picker.getByText('Casting it again ends the Blur already on Hero')).toBeTruthy();
    expect(picker.queryByText(/is already on Hero/)).toBeNull();
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));
    expect(stored().map((e) => e.name)).toEqual(['Blur']);
  });

  it("gives a potion's temporary hit points, tied to it", async () => {
    renderStrip();
    const picker = await openPicker();
    await open(picker, 'heroism', 'Potion of Heroism');
    expect(picker.getByText('10 temporary hit points now, gone when it ends')).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));
    const p = play();
    expect(p.tempHp).toBe(10);
    expect(p.tempHpFrom).toBe(p.activeEffects?.[0]?.id);
  });

  it('warns when what it brings counts once: a part of one name, or one on the same target', async () => {
    renderStrip((d) => {
      d.play.activeEffects = [
        {
          id: 'b1',
          name: 'Bless',
          parts: [{ kind: 'rollDie', dice: '1d4', on: { rolls: ['attack', 'save'] } }],
          lasts: { minutes: 1, concentration: true },
        },
      ];
    });
    const picker = await openPicker();
    // The potion's d4 is Bless.
    await open(picker, 'heroism', 'Potion of Heroism');
    expect(
      picker.getByText('Bless is already on Hero: effects of one name count once'),
    ).toBeTruthy();
    expect(picker.getByRole('button', { name: 'Add another to Hero' })).toBeTruthy();
    fireEvent.click(picker.getByRole('button', { name: 'All effects' }));
    // Haste shares nothing with it.
    await open(picker, 'haste', 'Haste');
    expect(picker.queryByText(/is already on Hero/)).toBeNull();
    expect(picker.getByRole('button', { name: 'Add to Hero' })).toBeTruthy();
  });

  it('a recast replaces only your own: another of the name still warns', async () => {
    const blur = {
      name: 'Blur',
      parts: [
        {
          kind: 'cue' as const,
          tone: 'ward' as const,
          text: 'Attacks against you have disadvantage',
        },
      ],
      lasts: { minutes: 1, concentration: true },
    };
    renderStrip((d) => {
      d.spellcasting = { wizard: { known: [{ name: 'Blur', source: 'XPHB' }], prepared: [] } };
      d.play.concentratingOn = { label: 'Blur' };
      d.play.activeEffects = [
        { id: 'mine', ...blur, mine: true },
        { id: 'theirs', ...blur },
      ];
    });
    const picker = await openPicker();
    await open(picker, 'blur', 'Blur');
    expect(picker.getByText('Casting it again ends the Blur already on Hero')).toBeTruthy();
    expect(
      picker.getByText('Blur is already on Hero: effects of one name count once'),
    ).toBeTruthy();
  });

  it('says what the words found once typing rests', async () => {
    resetAnnouncer();
    renderStrip();
    const picker = await openPicker();
    const said = () => getAnnouncerState().messages.map((m) => m.text);
    type(picker, 'fly');
    await waitFor(() => expect(said()).toContain('2 found'), { timeout: 3000 });
    type(picker, 'zzz');
    await waitFor(() => expect(said()).toContain('Nothing called zzz that can land on Hero'), {
      timeout: 3000,
    });
  });

  it('drops a count still settling when an entry opens or the search goes', async () => {
    resetAnnouncer();
    renderStrip();
    const picker = await openPicker();
    const counts = () =>
      getAnnouncerState()
        .messages.map((m) => m.text)
        .filter((t) => t.endsWith(' found'));
    const rest = () => new Promise((done) => setTimeout(done, 1200));
    // Opened before typing rests: the count is about results no longer shown.
    await open(picker, 'fly', 'Fly');
    await rest();
    expect(counts()).toEqual([]);
    // Back, then the words cleared before typing rests.
    fireEvent.click(picker.getByRole('button', { name: 'All effects' }));
    type(picker, '');
    await rest();
    expect(counts()).toEqual([]);
  });

  it('on a touch screen, gives focus to the sheet rather than raise the keyboard', async () => {
    const was = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...was(query),
      matches: query === '(pointer: coarse)',
    })) as typeof window.matchMedia;
    try {
      renderStrip();
      const picker = await openPicker();
      const sheetPanel = screen.getByRole('dialog', { name: 'Effects' });
      await waitFor(() => expect(document.activeElement).toBe(sheetPanel));
      await open(picker, 'haste', 'Haste');
      fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));
      await waitFor(() => expect(document.activeElement).toBe(sheetPanel));
    } finally {
      window.matchMedia = was;
    }
  });

  it('takes a roll typed in, but only one the dice could make', async () => {
    renderStrip();
    const picker = await openPicker();
    await open(picker, 'feast', "Heroes' Feast");
    const field = picker.getByRole('textbox', { name: 'Your 2d10 more hit points' });
    const rolled = Number((field as HTMLInputElement).value);
    expect(rolled).toBeGreaterThanOrEqual(2);
    expect(rolled).toBeLessThanOrEqual(20);

    fireEvent.change(field, { target: { value: '25' } });
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(
      (picker.getByRole('button', { name: 'Choose above to add it' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(field, { target: { value: '14' } });
    fireEvent.click(picker.getByRole('button', { name: 'Add to Hero' }));
    expect(stored()[0]?.parts).toContainEqual({ kind: 'maxHpBonus', amount: 14 });
  });

  it("never finds another class's own feature", async () => {
    renderStrip();
    const picker = await openPicker();
    type(picker, 'rage');
    const list = await results(picker);
    expect(list.queryByRole('button', { name: /^Rage\b/ })).toBeNull();
  });
});
