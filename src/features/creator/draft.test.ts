// @vitest-environment jsdom
// UX-001: the creator kept only the doc of its draft, so the equipment rows
// picked for a kit were lost on a reload, and it read the doc back with a bare
// cast, so any stored value was trusted as a character.
import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTER_SCHEMA_VERSION, type CharacterDoc, newCharacterDoc } from '@/engine/types';
import {
  clearDraft,
  DRAFT_KEY,
  draftSummary,
  freshDraft,
  isBlankDraft,
  LEGACY_DRAFT_KEY,
  readDraft,
  saveDraftStep,
  writeDraft,
} from './draft';

afterEach(() => sessionStorage.clear());

// One doc copied, so its timestamps match wherever it is compared.
const ARIA = newCharacterDoc('hero-1', 'Aria', 't');
const aria = () => structuredClone(ARIA);
const raw = (key: string, value: unknown) => sessionStorage.setItem(key, JSON.stringify(value));

describe('readDraft', () => {
  it('reads a bare doc from an older build as a draft with no rows or step', () => {
    raw(LEGACY_DRAFT_KEY, aria());
    expect(readDraft()).toEqual({ v: 2, doc: aria(), bundleChoices: {}, slotPicks: {} });
  });

  it('keeps the kit rows and the step through a round trip', () => {
    writeDraft(
      { doc: aria(), bundleChoices: { 'class:0': 'b' }, slotPicks: { 'class:0:1': 'x' } },
      'equipment',
    );
    expect(readDraft()).toEqual({
      v: 2,
      doc: aria(),
      bundleChoices: { 'class:0': 'b' },
      slotPicks: { 'class:0:1': 'x' },
      step: 'equipment',
    });
  });

  it('prefers the envelope to a leftover legacy doc, and writing drops the legacy one', () => {
    raw(LEGACY_DRAFT_KEY, { ...aria(), name: 'Old' });
    writeDraft({ doc: aria(), bundleChoices: {}, slotPicks: {} });
    expect(readDraft()?.doc.name).toBe('Aria');
    expect(sessionStorage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
  });

  it('reads nothing from a value that is not a draft the creator can open', () => {
    sessionStorage.setItem(DRAFT_KEY, '{not json');
    expect(readDraft()).toBeNull();
    // The old cast would have handed these to the wizard as characters.
    raw(LEGACY_DRAFT_KEY, { id: 'x', classes: 'x' });
    expect(readDraft()).toBeNull();
    const cases: Array<(d: Record<string, unknown>) => void> = [
      (d) => void (d.classes = 'x'),
      (d) => void delete d.id,
      (d) => void (d.abilities = { method: 'standard', base: { str: '15' } }),
      (d) => void (d.abilities = { base: aria().abilities.base }),
      (d) => void (d.play = { ...aria().play, currency: null }),
      (d) => void delete d.equipment,
      (d) => void (d.schemaVersion = CHARACTER_SCHEMA_VERSION + 1),
    ];
    for (const breakIt of cases) {
      const doc = aria() as unknown as Record<string, unknown>;
      breakIt(doc);
      raw(DRAFT_KEY, { v: 2, doc, bundleChoices: {}, slotPicks: {} });
      expect(readDraft()).toBeNull();
    }
    raw(DRAFT_KEY, { v: 3, doc: aria() });
    expect(readDraft()).toBeNull();
  });

  it('drops rows that are not strings, and a step that is not one', () => {
    raw(DRAFT_KEY, {
      v: 2,
      doc: aria(),
      bundleChoices: { 'class:0': 'b', 'bg:0': 3 },
      slotPicks: ['x'],
      step: 'garbage',
    });
    expect(readDraft()).toEqual({
      v: 2,
      doc: aria(),
      bundleChoices: { 'class:0': 'b' },
      slotPicks: {},
    });
  });
});

describe('saveDraftStep and clearDraft', () => {
  it('records the step only on a draft that exists', () => {
    saveDraftStep('abilities');
    expect(readDraft()).toBeNull();
    expect(sessionStorage.length).toBe(0);
    writeDraft({ doc: aria(), bundleChoices: {}, slotPicks: {} }, 'class');
    saveDraftStep('abilities');
    expect(readDraft()?.step).toBe('abilities');
  });

  it('clears both the envelope and a legacy doc', () => {
    raw(LEGACY_DRAFT_KEY, aria());
    writeDraft({ doc: aria(), bundleChoices: {}, slotPicks: {} });
    raw(LEGACY_DRAFT_KEY, aria());
    clearDraft();
    expect(sessionStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(sessionStorage.getItem(LEGACY_DRAFT_KEY)).toBeNull();
    expect(readDraft()).toBeNull();
  });
});

describe('isBlankDraft', () => {
  const edited = (edit: (doc: CharacterDoc) => void) => {
    const d = freshDraft();
    edit(d.doc);
    return isBlankDraft(d);
  };

  it('is blank only while nothing the player sets has been set', () => {
    expect(isBlankDraft(freshDraft())).toBe(true);
    expect(edited((d) => void (d.name = '   '))).toBe(true);
    expect(edited((d) => void (d.name = 'Aria'))).toBe(false);
    expect(edited((d) => void (d.rulesVersion = '2024'))).toBe(false);
    expect(
      edited(
        (d) =>
          void (d.classes = [{ ref: { name: 'Monk', source: 'TST' }, levels: 1, hp: ['avg'] }]),
      ),
    ).toBe(false);
    expect(edited((d) => void (d.race = { name: 'Elf', source: 'TST' }))).toBe(false);
    expect(edited((d) => void (d.background = { name: 'Sage', source: 'TST' }))).toBe(false);
    expect(edited((d) => void (d.abilities.base.str = 15))).toBe(false);
    expect(edited((d) => void (d.abilities.method = 'manual'))).toBe(false);
    expect(edited((d) => void (d.choices = { a: ['b'] }))).toBe(false);
    expect(edited((d) => void (d.play.currency.gp = 5))).toBe(false);
    expect(isBlankDraft({ ...freshDraft(), bundleChoices: { 'class:0': 'b' } })).toBe(false);
  });
});

describe('draftSummary', () => {
  it('names the draft and what it has so far', () => {
    const doc = aria();
    expect(draftSummary(doc)).toBe('Aria');
    doc.classes = [{ ref: { name: 'Fighter', source: 'TST' }, levels: 3, hp: ['avg'] }];
    doc.race = { name: 'Elf', source: 'TST' };
    expect(draftSummary(doc)).toBe('Aria (Fighter 3, Elf)');
    doc.name = ' ';
    expect(draftSummary(doc)).toBe('Unnamed (Fighter 3, Elf)');
  });
});
