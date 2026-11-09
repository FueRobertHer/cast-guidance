import { useEffect, useRef } from 'react';
import { endEffect } from '@/engine/effectLife';
import type { ActiveEffect, CharacterDoc, DerivedSheet, PlayState } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { rollOffersStore } from '@/stores/rollOffers';
import { hpLimits } from './effectsInPlay';

/**
 * Lets the roll toast spend the dice it offers while a sheet is open
 * (`stores/rollOffers`): adding Bardic Inspiration's die ends the effect, and
 * taking the die off puts it back where it was, as it was. The toast lives in
 * the entry chunk, so it reaches the sheet through the store, never by import.
 * Any change to hit points stops the toast's dice waiting: a roll made before
 * a hit is no longer the moment to add to.
 */
export function useRollOfferSpending(
  doc: CharacterDoc | null,
  sheet: DerivedSheet | null,
  update: DocUpdater,
): void {
  const latest = useRef({ doc, sheet, update });
  latest.current = { doc, sheet, update };
  // Effects a die spent, by id, with their place in the list and the
  // concentration ending them let go of (a Guidance the cleric holds).
  const spent = useRef(
    new Map<
      string,
      { effect: ActiveEffect; at: number; focus: PlayState['concentratingOn'] | undefined }
    >(),
  );

  useEffect(() => {
    const spend = (effectId: string, taken: boolean) => {
      const { doc, sheet, update } = latest.current;
      if (doc === null || sheet === null) return;
      if (taken) {
        const list = doc.play.activeEffects ?? [];
        const at = list.findIndex((e) => e.id === effectId);
        const effect = list[at];
        if (effect === undefined) return;
        const hp = hpLimits(sheet, doc.rulesVersion);
        let focus: PlayState['concentratingOn'] | undefined;
        update((d) => {
          const held = d.play.concentratingOn;
          endEffect(d.play, effectId, hp);
          if (held !== undefined && d.play.concentratingOn === undefined) focus = held;
        }, `Used ${effect.name}`);
        spent.current.set(effectId, { effect: structuredClone(effect), at, focus });
        return;
      }
      const back = spent.current.get(effectId);
      if (back === undefined) return;
      spent.current.delete(effectId);
      update((d) => {
        const list = [...(d.play.activeEffects ?? [])];
        if (list.some((e) => e.id === effectId)) return;
        list.splice(Math.min(back.at, list.length), 0, back.effect);
        d.play.activeEffects = list;
        if (back.focus !== undefined && d.play.concentratingOn === undefined) {
          d.play.concentratingOn = back.focus;
        }
      }, `Took back ${back.effect.name}`);
    };
    rollOffersStore.getState().setSpend(spend);
    return () => {
      if (rollOffersStore.getState().spend === spend) rollOffersStore.getState().setSpend(null);
    };
  }, []);

  const hp = doc === null ? undefined : `${doc.play.currentHp}/${doc.play.tempHp}`;
  const seen = useRef(hp);
  useEffect(() => {
    if (hp === seen.current) return;
    seen.current = hp;
    rollOffersStore.getState().expire();
  }, [hp]);
}
