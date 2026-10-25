// @vitest-environment jsdom
// TEST-003, the GAME-002 residual: the spell-state cues on an open sheet. The
// mode badge, the prepared and known counters with their over-limit status,
// the Play tab's prepared marker, always-prepared grants, a grant's daily uses,
// and the out-of-sources chip (#102), each followed through the edit that
// changes it and read off the next render.
import 'fake-indexeddb/auto';
import { fireEvent, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DataEntity } from '@/engine/types';
import {
  classEntry,
  dialog,
  grantedSpell,
  HARNESS_TIMEOUT,
  playSpell,
  renderSheet,
  resetSheetHarness,
  sorcerer,
  spellBlock,
  testCharacter,
} from '../../../tests-fixtures/sheetHarness';

vi.mock('@/data5e/loader', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.loaderStub),
);
vi.mock('@/app/AppShell', () =>
  import('../../../tests-fixtures/sheetHarnessMocks').then((m) => m.appShellStub),
);

vi.setConfig({ testTimeout: HARNESS_TIMEOUT });

afterEach(resetSheetHarness);

const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const ref = (name: string, source = 'TST') => ({ name, source });

const cantrip = (name: string): DataEntity => ({
  name,
  source: 'TST',
  level: 0,
  school: 'V',
  entries: ['A small trick.'],
});
/** Four more cantrips, so a level 1 Sorcerer (four cantrips) can go one over. */
const CANTRIPS = ['Frost Pin', 'Mote Light', 'Quiet Hum', 'Spark Flick'].map(cantrip);

/** A wizard-shaped class: prepares from a fixed known list, so a spellbook. */
const scribe: DataEntity = {
  name: 'Scribe',
  source: 'TST',
  hd: { number: 1, faces: 6 },
  casterProgression: 'full',
  spellcastingAbility: 'int',
  preparedSpells: '<$level$> + <$int_mod$>',
  spellsKnownProgressionFixed: [6, 8, 10, 12, 14, 16, 18, 20, 22, 24],
  classFeatures: [],
};

/** A caster with no known or prepared rule to name: its block has no badge. */
const dabbler: DataEntity = {
  name: 'Dabbler',
  source: 'TST',
  hd: { number: 1, faces: 8 },
  casterProgression: '1/2',
  spellcastingAbility: 'wis',
  classFeatures: [],
};

describe('the spellcasting mode badge (TEST-003)', () => {
  it('names how each class holds its spells', async () => {
    const doc = testCharacter(
      'Polymath',
      ['Sorcerer', 'Mage', 'Pactcaster', 'Scribe', 'Dabbler'].map((c) => classEntry(c, 1)),
      { int: 14, cha: 14 },
    );
    await renderSheet(doc, { extra: { class: [scribe, dabbler] }, path: 'spells' });

    expect(
      ['Sorcerer', 'Mage', 'Pactcaster', 'Scribe', 'Dabbler'].map((c) => spellBlock(c).mode),
    ).toEqual(['Known', 'Prepared', 'Pact Magic', 'Spellbook', undefined]);
  });

  it('appears with the first casting class a character takes', async () => {
    const sheet = await renderSheet(testCharacter('Wren', [classEntry('Warrior', 3)]), {
      path: 'spells',
    });
    expect(screen.getByText('This character has no spellcasting.')).toBeTruthy();

    await sheet.tab('Build');
    const add = screen.getByText('Add a class (multiclass)').closest('details');
    if (add === null) throw new Error('no class picker');
    fireEvent.click(within(add).getByRole('button', { name: 'Mage' }));
    await sheet.tab('Spells');

    expect(spellBlock('Mage').mode).toBe('Prepared');
    expect(screen.queryByText('This character has no spellcasting.')).toBeNull();
  });
});

describe('prepared and known limits (TEST-003)', () => {
  it('counts preparations, flags one over the limit, and clears the flag when undone', async () => {
    const doc = testCharacter('Quill', [classEntry('Mage', 1)]);
    const sheet = await renderSheet(doc, {
      path: 'spells',
      lists: { 'Searing Bolt|TST': ['Mage'], 'Quick Bolt|TST': ['Mage'] },
    });
    expect(spellBlock('Mage').counters).toContain('prepared 0/1');

    press('Prepare Searing Bolt');
    expect(spellBlock('Mage').counters).toContain('prepared 1/1');
    expect(spellBlock('Mage').overLimit).toBeUndefined();

    press('Prepare Quick Bolt');
    expect(spellBlock('Mage').counters).toContain('prepared 2/1');
    expect(spellBlock('Mage').overLimit).toMatch(/^1 over your prepared limit\./);
    expect(screen.getByRole('button', { name: 'Trim to limit, Mage spells' })).toBeTruthy();

    press('Prepare Quick Bolt');
    expect(spellBlock('Mage').counters).toContain('prepared 1/1');
    expect(spellBlock('Mage').overLimit).toBeUndefined();

    // The Play tab marks what is prepared; Quick Bolt stays known, unmarked.
    await sheet.tab('Play');
    expect(playSpell('Searing Bolt')).toEqual({ prepared: true });
    expect(playSpell('Quick Bolt')).toEqual({ prepared: false });
    const saved = (await sheet.saved()).spellcasting['mage|tst'];
    expect(saved?.prepared).toEqual([ref('Searing Bolt')]);
    expect(saved?.known).toEqual([ref('Searing Bolt'), ref('Quick Bolt')]);
  });

  it('flags cantrips and known spells over the limit, each in its own words', async () => {
    const doc = sorcerer(1);
    doc.spellcasting = { 'sorcerer|tst': { known: [], prepared: [] } };
    const lists = Object.fromEntries(
      ['Guidance', ...CANTRIPS.map((c) => String(c.name)), 'Searing Bolt', 'Quick Bolt', 'Aid'].map(
        (n) => [`${n}|TST`, ['Sorcerer']],
      ),
    );
    await renderSheet(doc, { path: 'spells', extra: { spell: CANTRIPS }, lists });
    expect(spellBlock('Sorcerer').counters).toContain('cantrips 0/4');
    expect(spellBlock('Sorcerer').counters).toContain('known 0/2');

    for (const name of ['Guidance', 'Frost Pin', 'Mote Light', 'Quiet Hum']) press(`Learn ${name}`);
    expect(spellBlock('Sorcerer').overLimit).toBeUndefined();
    press('Learn Spark Flick');
    expect(spellBlock('Sorcerer').counters).toContain('cantrips 5/4');
    expect(spellBlock('Sorcerer').overLimit).toMatch(/^1 over your cantrip limit\./);

    press('Learn Spark Flick');
    for (const name of ['Searing Bolt', 'Quick Bolt', 'Aid']) press(`Learn ${name}`);
    expect(spellBlock('Sorcerer').counters).toContain('known 3/2');
    expect(spellBlock('Sorcerer').overLimit).toMatch(/^1 over your spells-known limit\./);
    expect(spellBlock('Sorcerer').overLimit).not.toMatch(/cantrip/);

    press('Learn Aid');
    expect(spellBlock('Sorcerer').overLimit).toBeUndefined();
  });
});

describe('granted spells on the Play tab (TEST-003)', () => {
  it('lists a subclass grant as always prepared once the subclass is picked', async () => {
    const sheet = await renderSheet(testCharacter('Wren', [classEntry('Warrior', 3)]), {
      path: 'build',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Path of Tests' }));
    await sheet.tab('Play');

    expect(grantedSpell('bless').alwaysPrepared).toBe(true);
    expect(grantedSpell('cure wounds').alwaysPrepared).toBe(true);
    // Flame Strike joins at level 9, not before.
    expect(screen.queryByText('flame strike')).toBeNull();
  });

  it('spends a daily grant, says when it is out, and gets it back on a long rest', async () => {
    const doc = testCharacter('Wren', [classEntry('Warrior', 3)]);
    doc.equipment = [
      { id: 'w1', ref: ref('Wand of Searing'), qty: 1, equipped: true, attuned: false },
    ];
    const sheet = await renderSheet(doc);
    expect(grantedSpell('searing bolt')).toEqual({
      alwaysPrepared: false,
      uses: '1/1 per day',
      usesTitle: '1/day from Wand of Searing',
    });

    press('2d6');

    expect(grantedSpell('searing bolt')).toMatchObject({
      uses: '0/1 per day',
      usesTitle: 'No uses left until you rest',
    });
    await sheet.saved();

    press('Long rest');
    await (await dialog('Long rest')).press('Rest');
    expect(grantedSpell('searing bolt').uses).toBe('1/1 per day');
  });
});

describe('the out-of-sources chip (#102, TEST-003)', () => {
  it("labels a known spell from outside the character's books until the list allows it", async () => {
    const lance: DataEntity = {
      name: 'Ember Lance',
      source: 'HBX',
      level: 1,
      school: 'V',
      entries: ['A lance of embers.'],
    };
    const doc = sorcerer();
    doc.allowedSources = ['TST'];
    doc.spellcasting['sorcerer|tst']?.known.push(ref('Ember Lance', 'HBX'));
    const sheet = await renderSheet(doc, {
      path: 'spells',
      extra: { spell: [lance] },
      lists: { 'Searing Bolt|TST': ['Sorcerer'], 'Ember Lance|HBX': ['Sorcerer'] },
    });
    const chipFor = (name: string) =>
      screen.getByRole('button', { name: `Learn ${name}` }).parentElement?.textContent ?? '';
    expect(chipFor('Ember Lance')).toContain("Not in this character's sources");
    expect(chipFor('Searing Bolt')).not.toContain("Not in this character's sources");

    await sheet.tab('Build');
    fireEvent.click(screen.getByText('Sources'));
    press('No restriction');
    await sheet.tab('Spells');

    expect(chipFor('Ember Lance')).not.toContain("Not in this character's sources");
    expect((await sheet.saved()).allowedSources).toEqual([]);
  });
});
