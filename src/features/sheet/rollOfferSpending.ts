import { useEffect, useRef, useState } from 'react';
import { setTableCrit } from '@/dice/roll';
import type { CritDamage, RollResult } from '@/dice/types';
import { endEffect, naturalRolled } from '@/engine/effectLife';
import { momentsAt } from '@/engine/moments';
import { sheetRules } from '@/engine/rules';
import type { ActiveEffect, CharacterDoc, DerivedSheet, PlayState } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { cancelHeld } from '@/stores/heldRoll';
import { notify } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { rollOffersStore } from '@/stores/rollOffers';
import { hpLimits, momentLines, withMoments } from './effectsInPlay';

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

  // A natural 20 or 1 on a d20 test the sheet rolled (one that says its kind,
  // `meta.test`) fires the character's `natural20` or `natural1` moments, once
  // a roll: rolls already in the log when the sheet opens or the character
  // changes are passed over, and a roll put back in place (a die added after
  // it) is the same roll, not a new one. A roll the tray or a rules chip makes
  // says no kind and sets nothing off. It fires after the step that logged the
  // roll (a concentration save is logged inside an update), in a change of its own.
  const docId = doc?.id;
  useEffect(() => {
    if (docId === undefined) return;
    let seq = rollLogStore.getState().seq;
    const landed = (r: RollResult) => {
      const natural = r.meta?.d20?.natural;
      const test = r.meta?.test;
      if ((natural !== 20 && natural !== 1) || test === undefined) return;
      const { doc, sheet, update } = latest.current;
      if (doc === null || sheet === null || doc.id !== docId) return;
      const hp = hpLimits(sheet, doc.rulesVersion);
      const at = natural === 20 ? 'natural20' : 'natural1';
      if (hp.moments === undefined || momentsAt(hp.moments, at, { roll: test }).length === 0)
        return;
      let said: ReturnType<typeof withMoments> = null;
      update((d) => {
        const change = naturalRolled(d.play, natural, test, hp);
        // Said only when a moment did something to say.
        if (change.moments !== undefined && momentLines(change.moments).length > 0)
          said = withMoments({ title: `Natural ${natural}`, tone: 'info' }, change.moments);
      }, `Natural ${natural}`);
      if (said !== null) notify(said);
    };
    return rollLogStore.subscribe((s) => {
      if (s.seq === seq) return;
      const fresh = s.rolls.slice(0, Math.max(0, Math.min(s.seq - seq, s.rolls.length)));
      seq = s.seq;
      for (const r of fresh.reverse()) queueMicrotask(() => landed(r));
    });
  }, [docId]);

  const hp = doc === null ? undefined : `${doc.play.currentHp}/${doc.play.tempHp}`;
  const seen = useRef(hp);
  useEffect(() => {
    if (hp === seen.current) return;
    seen.current = hp;
    rollOffersStore.getState().expire();
  }, [hp]);
}
