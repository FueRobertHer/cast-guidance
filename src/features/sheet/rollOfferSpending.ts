import { useEffect, useRef, useState } from 'react';
import { setTableCrit } from '@/dice/roll';
import type { CritDamage } from '@/dice/types';
import { endEffect } from '@/engine/effectLife';
import { sheetRules } from '@/engine/rules';
import type { ActiveEffect, CharacterDoc, DerivedSheet, PlayState } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { cancelHeld } from '@/stores/heldRoll';
import { rollOffersStore } from '@/stores/rollOffers';
import { hpLimits } from './effectsInPlay';

/**
 * Lets the roll toast spend the dice it offers while a sheet is open
 * (`stores/rollOffers`): adding Bardic Inspiration's die ends the effect, and
 * taking the die off puts it back where it was, as it was. The toast lives in
 * the entry chunk, so it reaches the sheet through the store, never by import.
 * Any change to hit points stops the toast's dice waiting: a roll made before
 * a hit is no longer the moment to add to.
 *
 * It also says how the open character's table rules reach the dice
 * (`DerivedSheet.rules`): when its one-use dice are named (its own rule on
 * Build, else a pack's, the app's in Settings, or as written), and how its
 * critical hits count. A roll still waiting for one-use dice when the sheet
 * closes, or the rule changes, is let go unseen.
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

  // While the sheet re-derives (its data reloading) it is null for a moment:
  // the rules it had hold, so a roll waiting under them is not let go.
  const [held, setHeld] = useState<{ before: boolean; crit: CritDamage }>({
    before: false,
    crit: 'doubleDice',
  });
  if (doc !== null && sheet !== null) {
    const rules = sheetRules(sheet, doc.rulesVersion);
    const now = { before: rules.oneUseDice === 'before', crit: rules.critDamage };
    if (now.before !== held.before || now.crit !== held.crit) setHeld(now);
  }
  const before = doc !== null && held.before;
  const crit = doc === null ? 'doubleDice' : held.crit;
  useEffect(() => {
    setTableCrit(crit);
    return () => setTableCrit('doubleDice');
  }, [crit]);
  useEffect(() => {
    rollOffersStore.getState().setBefore(before);
    return () => {
      rollOffersStore.getState().setBefore(false);
      cancelHeld();
    };
  }, [before]);

  const hp = doc === null ? undefined : `${doc.play.currentHp}/${doc.play.tempHp}`;
  const seen = useRef(hp);
  useEffect(() => {
    if (hp === seen.current) return;
    seen.current = hp;
    rollOffersStore.getState().expire();
  }, [hp]);
}
