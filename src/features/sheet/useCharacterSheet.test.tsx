// @vitest-environment jsdom
// REL-007 (#98): the sheet's one edit of its own, current HP following the
// maximum while a character is being built, must reach the session marked as
// automatic. Unmarked, it raises save conflicts the person never caused, and
// two tabs deriving different maxima would trade writes for as long as both
// stayed open.
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { makeTestContext } from '../../../tests-fixtures/testWorld';
import { useCharacterSheet } from './useCharacterSheet';

const session = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  update: vi.fn(),
}));

vi.mock('@/data5e/hooks', () => {
  let registry: ReturnType<typeof makeTestContext> | undefined;
  return {
    useRegistryState: () => ({
      registry: (registry ??= makeTestContext()),
      status: 'ready',
      error: null,
      retry: () => undefined,
    }),
  };
});
vi.mock('@/data5e/engineAdapter', () => ({ engineContextFor: (r: unknown) => r }));
vi.mock('@/stores/characterSession', () => ({
  characterSessionStore: {
    getState: () => ({
      ...session.state,
      load: async () => true,
      flush: async () => undefined,
      update: session.update,
      restore: () => undefined,
    }),
  },
  useCharacterSession: <T,>(select: (state: Record<string, unknown>) => T): T =>
    select(session.state),
}));

function warrior(): CharacterDoc {
  const doc = newCharacterDoc('c1', 'Hero', 't');
  doc.abilities.method = 'manual';
  doc.abilities.base = { str: 14, dex: 12, con: 14, int: 10, wis: 10, cha: 10 };
  doc.classes = [{ ref: { name: 'Warrior', source: 'TST' }, levels: 3, hp: ['avg', 'avg', 'avg'] }];
  return doc;
}

describe('useCharacterSheet', () => {
  it('has current HP follow the maximum as an automatic edit', () => {
    const doc = warrior();
    doc.play.hpInitialized = false;
    doc.play.currentHp = 1;
    session.state = {
      doc,
      rev: 1,
      requestedId: 'c1',
      loadStatus: 'ready',
      loadError: null,
      saveStatus: 'saved',
      saveCharacterId: 'c1',
    };

    renderHook(() => useCharacterSheet('c1'));

    expect(session.update).toHaveBeenCalledTimes(1);
    const [recipe, label, opts] = session.update.mock.calls[0] ?? [];
    expect(label).toBeUndefined();
    expect(opts).toEqual({ automatic: true });
    const followed = structuredClone(doc);
    (recipe as (d: CharacterDoc) => void)(followed);
    expect(followed.play.currentHp).toBe(deriveSheet(doc, makeTestContext()).maxHp.value);
  });
});
