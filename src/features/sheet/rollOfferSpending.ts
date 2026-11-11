import { useEffect, useRef, useState } from 'react';
import { setTableCrit } from '@/dice/roll';
import type { CritDamage, RollResult } from '@/dice/types';
import { endEffect, naturalRolled } from '@/engine/effectLife';
import { type MomentReport, momentsAt } from '@/engine/moments';
import { sheetRules } from '@/engine/rules';
import type { ActiveEffect, CharacterDoc, DerivedSheet, PlayState } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { cancelHeld } from '@/stores/heldRoll';
import { noticeStore, notify } from '@/stores/notices';
import { rollLogStore } from '@/stores/rollLog';
import { type PaidExtra, rollOffersStore } from '@/stores/rollOffers';
import { hpLimits, momentLines, withMoments } from './effectsInPlay';
import { payOffer, refundOffer } from './rollPrice';

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
    // A feature's own extra, paid as its Use is: the uses and the reaction it
    // takes, in one update, and given back the same way. Only what was paid
    // for (this very extra) is given back.
    const paidFor = new WeakSet<PaidExtra>();
    const pay = (extra: PaidExtra, taken: boolean): boolean => {
      const { doc, update } = latest.current;
      const price = extra.pay;
      if (doc === null || price === undefined) return false;
      if (taken) {
        if (paidFor.has(extra)) return true;
        // Tried on a copy first, so a price that cannot be paid leaves no
        // "Used" row in the history; then paid on the doc as it stands.
        let paid = false;
        if (payOffer(structuredClone(doc.play), price)) {
          update((d) => {
            paid = payOffer(d.play, price);
          }, `Used ${extra.source}`);
        }
        if (paid) paidFor.add(extra);
        else
          notify({
            title: `Not paid: ${extra.source}`,
            detail: `Nothing left to pay with: it ${price.words}.`,
            tone: 'warn',
          });
        return paid;
      }
      if (!paidFor.has(extra)) return false;
      paidFor.delete(extra);
      update((d) => refundOffer(d.play, price), `Took back ${extra.source}`);
      return true;
    };
    rollOffersStore.getState().setPay(pay);
    return () => {
      if (rollOffersStore.getState().spend === spend) rollOffersStore.getState().setSpend(null);
      if (rollOffersStore.getState().pay === pay) rollOffersStore.getState().setPay(null);
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
  // says no kind and sets nothing off, and so does a save that failed
  // automatically (Paralyzed): its die decides nothing. It fires after the step
  // that logged the roll (a concentration save is logged inside an update), in
  // a change with no name of its own, so the history row keeps the step's name
  // ("Attacked with Longsword") when the two land together.
  const docId = doc?.id;
  useEffect(() => {
    if (docId === undefined) return;
    let seq = rollLogStore.getState().seq;
    // `noticed`: the notice count as the roll was logged. A notice after it is
    // the step's own (a concentration save's), and the toast shows one notice,
    // so the moment joins it rather than taking its place.
    const landed = (r: RollResult, noticed: number) => {
      const natural = r.meta?.d20?.natural;
      const test = r.meta?.test;
      if ((natural !== 20 && natural !== 1) || test === undefined) return;
      if (r.meta?.autoFail === true) return;
      const { doc, sheet, update } = latest.current;
      if (doc === null || sheet === null || doc.id !== docId) return;
      const hp = hpLimits(sheet, doc.rulesVersion);
      const at = natural === 20 ? 'natural20' : 'natural1';
      if (hp.moments === undefined || momentsAt(hp.moments, at, { roll: test }).length === 0)
        return;
      let moments: MomentReport | undefined;
      update((d) => {
        moments = naturalRolled(d.play, natural, test, hp).moments;
      });
      // Said only when a moment did something to say.
      if (moments === undefined || momentLines(moments).length === 0) return;
      const now = noticeStore.getState();
      const step = now.seq !== noticed ? now.notice : null;
      const title = `Natural ${natural}`;
      const own = withMoments({ title, tone: 'info' }, moments);
      if (own === null) return;
      // Said in its own words: the step's notice was just said.
      notify(own);
      // Shown joined with the step's, which it would otherwise replace.
      if (step !== null) {
        const detail = [step.detail, title].filter((x) => x !== undefined && x !== '').join(' · ');
        const joined = withMoments({ ...step, detail }, moments);
        if (joined !== null) noticeStore.getState().push(joined);
      }
    };
    return rollLogStore.subscribe((s) => {
      if (s.seq === seq) return;
      const fresh = s.rolls.slice(0, Math.max(0, Math.min(s.seq - seq, s.rolls.length)));
      seq = s.seq;
      const noticed = noticeStore.getState().seq;
      for (const r of fresh.reverse()) queueMicrotask(() => landed(r, noticed));
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
