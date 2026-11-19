/**
 * What a Workshop effect card's tests share (ADR-002, U4a and U4b): a list of
 * cards that keeps what it writes, as an editor does, and a sheet derived with
 * a feat that holds what was written, beside one without it. "Done when each
 * card's save reads back unchanged and counts on a sheet" is asked of these.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { type ComponentProps, useState } from 'react';
import { expect } from 'vitest';
import { deriveSheet } from '@/engine/derive';
import { readMechanics, readStoredEffects } from '@/engine/effects/mechanics';
import {
  type CharacterDoc,
  type DataEntity,
  type DerivedSheet,
  type EngineContext,
  newCharacterDoc,
} from '@/engine/types';
import type { KindSpec } from '@/features/workshop/cards/kit/types';
import { EffectCards } from '@/features/workshop/EffectCards';
import { makeTestContext } from './testWorld';

type Eff = Record<string, unknown> & { kind: string };

/** A new card of a file's, as the add sheet makes it. */
export function makeCard(cards: readonly KindSpec[], add: string): Eff {
  const spec = cards.find((k) => k.add === add);
  if (spec === undefined) throw new Error(`no ${add} card`);
  return spec.make();
}

/** A card's box changed, found by its name ("Card: Label"). */
export const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** What a card's box holds. */
export const boxValue = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

/** The effects read as a saved file's are, with nothing to say. */
export const noProblems = (effects: unknown[]) =>
  expect(readStoredEffects(effects).problems).toEqual([]);

/**
 * The cards for `start` on screen, held as an editor holds them: each change
 * is kept and drawn again. `written()` is the list as last handed on.
 */
export function renderCards(
  start: Eff[],
  props: Partial<ComponentProps<typeof EffectCards>> = {},
): { written: () => Eff[] } {
  let last = start;
  function Host() {
    const [effects, setEffects] = useState<Eff[]>(start);
    return (
      <EffectCards
        effects={effects}
        readOnly={false}
        onChange={(next) => {
          last = next as Eff[];
          setEffects(next as Eff[]);
        }}
        {...props}
      />
    );
  }
  render(<Host />);
  return { written: () => last };
}

/** The feat a sheet is derived with, holding the effects written. */
export const CARD_FEAT = 'Card Feat';

/** The test world, with `extra` entries found first. */
export function worldWith(extra: Record<string, DataEntity[]>): EngineContext {
  const base = makeTestContext();
  return {
    get(type, name, source) {
      const hit = (extra[type] ?? []).find(
        (e) =>
          String(e.name).toLowerCase() === name.toLowerCase() &&
          (source === undefined || String(e.source).toLowerCase() === source.toLowerCase()),
      );
      return hit ?? base.get(type, name, source);
    },
    byType: (type) => [...base.byType(type), ...(extra[type] ?? [])],
  };
}

/**
 * A level 5 Warrior's sheet, with the feat holding `effects` when given and
 * without it when not: the second is what the first is compared with. The
 * feat's guidance is read first and must say nothing, as a saved one would.
 */
export function sheetWith(
  effects: readonly Eff[] | undefined,
  {
    setup,
    extra = {},
  }: { setup?: (d: CharacterDoc) => void; extra?: Record<string, DataEntity[]> } = {},
): DerivedSheet {
  const castGuidance = { v: 1, effects };
  if (effects !== undefined && readMechanics(castGuidance).problems.length > 0) {
    throw new Error(readMechanics(castGuidance).problems.join('; '));
  }
  const feat = { name: CARD_FEAT, source: 'HB', entries: ['A feat.'], castGuidance } as DataEntity;
  const d = newCharacterDoc('hero', 'Hero', 'test');
  d.abilities.base = { str: 14, dex: 16, con: 14, int: 10, wis: 12, cha: 10 };
  d.classes = [
    {
      ref: { name: 'Warrior', source: 'TST' },
      levels: 5,
      hp: ['avg', 'avg', 'avg', 'avg', 'avg'],
    },
  ];
  d.play.hpInitialized = true;
  d.play.currentHp = 30;
  if (effects !== undefined)
    d.feats = [{ ref: { name: CARD_FEAT, source: 'HB' }, instanceId: 'f0' }];
  setup?.(d);
  return deriveSheet(d, worldWith({ ...extra, feat: [...(extra.feat ?? []), feat] }));
}
