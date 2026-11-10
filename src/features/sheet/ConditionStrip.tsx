import {
  AlertTriangle,
  ChevronsUp,
  CircleAlert,
  PencilLine,
  Plus,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry } from '@/data5e/hooks';
import { pickForVersion } from '@/data5e/rulesVersion';
import { BARDIC_DICE, type BardicDie, bardicEffect } from '@/engine/curated/namedEffects';
import {
  applyEffect,
  conditionEndings,
  endEffect,
  type HpLimits,
  keepHigherTemp,
  knockedOut,
  setEffectOff,
} from '@/engine/effectLife';
import type { ActiveEffect, CharacterDoc, DerivedSheet, KeptEffect } from '@/engine/types';
import { announce } from '@/stores/announcer';
import type { DocUpdater } from '@/stores/characterSession';
import { conditionSheetStore } from '@/stores/conditionSheet';
import { type Notice, notify } from '@/stores/notices';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { DecodeBoundary } from '@/ui/DecodeBoundary';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { focusSheetOnTouch, Sheet, touchScreen } from '@/ui/sheet';
import { fieldClass } from '@/ui/TextField';
import { ToggleChip } from '@/ui/ToggleChip';
import { CONDITIONS, conditionEffect } from './conditionEffects';
import type { EffectTab } from './EffectFinder';
import { ExhaustionStepper } from './ExhaustionStepper';
import {
  andList,
  countedInstead,
  effectMark,
  effectsInPlay,
  hpLimits,
  immunityTo,
  lastsLine,
  partLine,
} from './effectsInPlay';
import { exhaustionLevel, setExhaustionLevel } from './exhaustion';
import { forget, keepOn } from './keptList';
import { answersTo, STARTERS, starterEffect } from './namedStarts';

type Condition = CharacterDoc['play']['conditions'][number];

/** A chip's words: "Poisoned", and exhaustion with its level, "Exhausted 2". */
export function conditionLabel(c: Condition): { name: string; level?: number } {
  if (c.id === 'Exhaustion') return { name: 'Exhausted', level: c.level };
  return { name: c.id, level: c.level };
}

/**
 * The search under + Effect, with the table it reads: a chunk of its own,
 * fetched as the Effects sheet opens, so the sheet's first load stays flat.
 */
const loadFinder = () => import('./EffectFinder');
const EffectFinder = lazy(loadFinder);

/** The sheet tabs by their route segment ('' is Play), each leading + Effect with its own effects. */
const EFFECT_TABS: Readonly<Record<string, EffectTab>> = {
  '': 'play',
  stats: 'stats',
  spells: 'spells',
  inventory: 'items',
  features: 'features',
};

/** The tab whose effects + Effect leads with, by its route segment; none for another. */
export function effectTab(segment: string): EffectTab | undefined {
  return Object.hasOwn(EFFECT_TABS, segment) ? EFFECT_TABS[segment] : undefined;
}

/** Where focus lands when nothing nearer is left: the sheet's title, which takes it. */
const sheetTitle = () => document.getElementById('sheet-title');

/**
 * How long after a sheet closes the chips play what changed under it. vaul's
 * slide takes 500ms, but its curve has cleared most of the page by now, so the
 * arrival is seen rather than spent behind the sheet.
 */
const SHEET_CLEARS_MS = 300;

/** A chip in the strip: its name opens its sheet, its x takes it away. */
const CHIP = 'flex h-8 shrink-0 items-center rounded-full bg-surface-raised';
const CHIP_NAME =
  '-my-1.5 flex min-h-tap items-center gap-1.5 whitespace-nowrap rounded-l-full pl-3 text-ink text-label underline-offset-2 [--tap-inset:0.375rem] hover:underline';
const CHIP_X =
  'tap -my-1.5 -mr-1.5 rounded-full text-ink-muted [--tap-inset:0.625rem] hover:text-ink';

/**
 * The condition `id` just came on in this draft: what it ends goes
 * (concentration, Rage; see `conditionEndings`), and the notice says so. Null
 * when nothing ended.
 */
function settleCondition(d: CharacterDoc, id: string, hp: HpLimits | null): Notice | null {
  if (hp === null) return null;
  const focus = d.play.concentratingOn?.label;
  const { ended } = conditionEndings(d.play, id, hp);
  const gone = ended.length === 0 ? [] : [`Ended ${andList(ended)}`];
  if (focus !== undefined && d.play.concentratingOn === undefined) {
    return {
      title: 'Concentration broken',
      detail: [focus, id, ...gone].join(' · '),
      tone: 'warn',
    };
  }
  if (ended.length === 0) return null;
  return { title: `Ended ${andList(ended)}`, detail: id, tone: 'warn' };
}

/** "You cannot be poisoned: Periapt of Proof against Poison." */
const cannotBe = (id: string, by: readonly string[]) =>
  `You cannot be ${id.toLowerCase()}: ${by.join(', ')}.`;

/**
 * The effect strip (the buffs canvas, Strip A): what is on the character now,
 * in sight on every sheet tab, directly under the header and sticky with it.
 * Conditions come first, then what is helping (Bless, Rage): the mark tells
 * them apart, an alert for a condition and the die or a lift for a help, not
 * only the colour.
 *
 * Each is a `surface-raised` chip: its name opens a sheet with what it does,
 * and its x removes it. A condition's sheet also switches its effects off and
 * on: a ruling at the table that it does not apply for now, which leaves it
 * listed (the chip says "off") but takes it out of every roll, speed and hit
 * point the sheet works out. One the character is immune to is held off the
 * same way, with a shield and the reason instead of the switch. An effect's
 * sheet says what it does and switches it off too.
 *
 * The row scrolls sideways when full; its end stays put, says how many chips
 * are out of sight, and opens the sheet that holds every one of them, with
 * every condition and the exhaustion stepper. With nothing on, the end stays
 * by itself, + Effect, on every tab: Build, which edits the character rather
 * than plays it, does not mount the strip. The sheet leads with the effects of
 * the tab it was opened on (the rolls and casting canvas, Effects C), then the
 * starters and Conditions; search still finds every effect.
 *
 * The sheets stay mounted here rather than in a chip, so a chip that goes away
 * (its condition removed in the picker, or Exhaustion stepped down to 0 in its
 * own sheet) does not take an open sheet with it. Each puts focus back where it
 * was opened from, or the nearest thing still there.
 */
export function ConditionStrip({
  doc,
  sheet,
  update,
  tab,
}: {
  doc: CharacterDoc;
  /** The derived sheet: what the character is immune to, and their HP maximum. */
  sheet: DerivedSheet | null;
  update: DocUpdater;
  /** The sheet tab it is on, by its route segment ('' is Play): its effects lead the sheet. */
  tab: string;
}) {
  const conditions = doc.play.conditions;
  const effects = effectsInPlay(doc.play);
  const edition = doc.rulesVersion;
  const immune = sheet?.conditionImmunities ?? [];
  const registry = useRegistry();
  const row = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const add = useRef<HTMLButtonElement>(null);
  const names = useRef(new Map<string, HTMLButtonElement>());
  // The condition or effect whose sheet is open, kept while it closes.
  const [shown, setShown] = useState<{ kind: 'condition' | 'effect'; id: string } | null>(null);
  // The shown effect as last seen, so one that ends (Remove it) still fills its
  // sheet while the sheet slides away.
  const lastEffect = useRef<ActiveEffect | undefined>(undefined);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // What + Effect's search holds: the words typed, and the result opened.
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  // A description being made, by the name it started with; none otherwise.
  const [describing, setDescribing] = useState<string | null>(null);
  // The tab's own list: shown whole once asked, while the sheet is open, and
  // the entry it opened, whose row Back puts focus on again.
  const [leadAll, setLeadAll] = useState(false);
  const leadRow = useRef<string | null>(null);
  const search = useRef<HTMLInputElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const toSearch = useRef(false);
  const finding = query.trim() !== '' || picked !== null || describing !== null;
  // A removed chip's place: focus goes to the chip now there, the one before
  // it if it was the last, the end of the strip if none is left, then the title.
  const refocus = useRef<number | null>(null);
  // How many chips are out of sight, for the end of the strip to say.
  const [hidden, setHidden] = useState(0);
  // A condition the character cannot have, tapped in the picker: the line saying why.
  const [refused, setRefused] = useState<string | null>(null);
  const refuseTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(refuseTimer.current), []);
  const clearRefused = () => {
    clearTimeout(refuseTimer.current);
    setRefused(null);
  };
  // Every way the picker closes (swiped, Esc, Apply death) leaves it as new.
  const closePicker = () => {
    setPickerOpen(false);
    clearRefused();
    setQuery('');
    setPicked(null);
    setDescribing(null);
    setLeadAll(false);
    leadRow.current = null;
  };
  useEffect(() => {
    if (pickerOpen) void loadFinder();
  }, [pickerOpen]);

  // Tells the attack chips a change is being made over them (conditionSheet.ts).
  const sheetOpen = infoOpen || pickerOpen;
  useEffect(() => {
    if (sheetOpen) {
      conditionSheetStore.setState({ open: true });
      return;
    }
    const timer = setTimeout(() => conditionSheetStore.setState({ open: false }), SHEET_CLEARS_MS);
    return () => clearTimeout(timer);
  }, [sheetOpen]);
  useEffect(() => () => conditionSheetStore.setState({ open: false }), []);

  const starterHeld = new Map<string, ActiveEffect>();
  for (const st of STARTERS) {
    const held = effects.find((e) => answersTo(e, st.name));
    if (held !== undefined) starterHeld.set(st.name, held);
  }
  const startersShown = new Set([...starterHeld.values()].map((e) => e.id));
  const bardic = starterHeld.get('Bardic Inspiration');
  const bardicDie = bardicDieOf(bardic);

  const chipCount = conditions.length + effects.length;
  const lead = effectTab(tab);
  useLayoutEffect(() => {
    const at = refocus.current;
    if (at === null) return;
    refocus.current = null;
    const next =
      list.current?.querySelectorAll<HTMLButtonElement>('[data-remove]')[
        Math.min(at, chipCount - 1)
      ];
    (next ?? add.current ?? sheetTitle())?.focus();
  }, [chipCount]);

  const measure = useCallback(() => {
    const strip = row.current;
    const end = add.current;
    if (strip === null || end === null) return;
    const left = strip.getBoundingClientRect().left;
    const edge = end.getBoundingClientRect().left;
    let n = 0;
    for (const chip of strip.querySelectorAll('li')) {
      const r = chip.getBoundingClientRect();
      if (r.right > edge + 1 || r.left < left - 1) n += 1;
    }
    setHidden(n);
  }, []);
  useLayoutEffect(measure);
  useEffect(() => {
    const strip = row.current;
    if (strip === null || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(strip);
    return () => watch.disconnect();
  }, [measure]);

  const limits = () => (sheet === null ? null : hpLimits(sheet, edition));
  const toggle = (id: string) => {
    const has = conditions.some((x) => x.id === id);
    const by = immunityTo(id, immune);
    // One the character cannot have is not added: the picker says why, which
    // is the moment to tell the DM. One already on can still come off.
    if (!has && by.length > 0) {
      clearTimeout(refuseTimer.current);
      setRefused(null);
      // Emptied first, so a second tap is read out as well.
      refuseTimer.current = setTimeout(() => setRefused(cannotBe(id, by)), 60);
      return;
    }
    clearRefused();
    const hp = limits();
    let notice: Notice | null = null;
    update((d) => {
      const idx = d.play.conditions.findIndex((x) => x.id === id);
      if (idx === -1) {
        d.play.conditions.push({ id });
        notice = settleCondition(d, id, hp);
      } else d.play.conditions.splice(idx, 1);
    });
    if (notice !== null) notify(notice);
  };
  const remove = (id: string, index: number) => {
    refocus.current = index;
    update((d) => {
      d.play.conditions = d.play.conditions.filter((x) => x.id !== id);
    });
  };
  const end = (effect: ActiveEffect, index?: number) => {
    const hp = limits();
    if (hp === null) return;
    if (index !== undefined) refocus.current = index;
    update((d) => void endEffect(d.play, effect.id, hp), `Ended ${effect.name}`);
  };
  /** Put an effect in play, or change one already there (the bard's die). */
  const put = (effect: ActiveEffect) => {
    const hp = limits();
    if (hp === null) return;
    update((d) => void applyEffect(d.play, effect, hp));
  };
  /** A starter's chip, not yet in play: add it. */
  const start = (name: string) => {
    const effect = starterEffect(name, edition);
    if (effect !== undefined) put(effect);
  };
  /**
   * A search result lands: your own concentration spell (Blur) is what you
   * concentrate on now, which ends the last one (`applyEffect` sees to both);
   * temporary hit points it gives go when it ends. A description kept goes on
   * the character's list for its search next time. The search starts over,
   * ready for the next.
   */
  const land = (effect: ActiveEffect, tempHp?: number, kept?: KeptEffect) => {
    const hp = limits();
    if (hp === null) return;
    update((d) => {
      applyEffect(d.play, effect, hp);
      if (tempHp !== undefined) keepHigherTemp(d.play, tempHp, effect.id);
      if (kept !== undefined) d.keptEffects = keepOn(d.keptEffects, kept);
    }, `Added ${effect.name}`);
    setPicked(null);
    setDescribing(null);
    setQuery('');
    announce(`${effect.name} added`);
    leadRow.current = null;
    toSearch.current = true;
  };
  const pick = (id: string | null) => {
    setPicked(id);
    // Back from an entry goes to the words that found it; one the tab's own
    // list opened then puts focus on its row there, when it is still listed.
    if (id === null) toSearch.current = true;
  };
  /** An entry opened from the tab's own list, which Back returns to. */
  const pickLead = (id: string | null) => {
    leadRow.current = id;
    setPicked(id);
  };
  const takeLeadRow = () => {
    const id = leadRow.current;
    leadRow.current = null;
    return id;
  };
  const describe = (name: string | null) => {
    setDescribing(name);
    // Back from a description goes to the words, as from an entry.
    if (name === null) toSearch.current = true;
  };
  /** A kept description, taken off the list: the search no longer finds it. */
  // The name is the one the search showed, not read again from the stored list.
  const forgetKept = (id: string, name: string) => {
    update((d) => {
      const left = forget(d.keptEffects, id);
      if (left === undefined) delete d.keptEffects;
      else d.keptEffects = left;
    }, `Forgot ${name}`);
    setPicked(null);
    toSearch.current = true;
    announce(`${name} forgotten`);
  };
  // The search field comes back once the entry gives way, and focus goes to
  // it; on a touch screen to the sheet, as when it opened, so no keyboard
  // rises over the lists unasked.
  useLayoutEffect(() => {
    if (!toSearch.current || picked !== null || describing !== null) return;
    toSearch.current = false;
    (touchScreen() ? panel.current : search.current)?.focus();
  });
  const switchEffect = (effect: ActiveEffect, on: boolean) => {
    const hp = limits();
    if (hp === null) return;
    update((d) => void setEffectOff(d.play, effect.id, !on, hp));
  };
  const setExhaustion = (level: number) =>
    update((d) => setExhaustionLevel(d.play.conditions, level));
  const setApplied = (id: string, applied: boolean) => {
    const hp = limits();
    let notice: Notice | null = null;
    update((d) => {
      const c = d.play.conditions.find((x) => x.id === id);
      if (c === undefined) return;
      if (applied) {
        delete c.ignored;
        notice = settleCondition(d, id, hp);
      } else c.ignored = true;
    });
    if (notice !== null) notify(notice);
  };
  const applyDeath = () => {
    const hp = limits();
    update((d) => {
      d.play.hpInitialized = true; // deliberate 0 HP must stick (no auto-fill)
      d.play.currentHp = 0;
      d.play.tempHp = 0;
      delete d.play.tempHpFrom;
      // Death ends concentration, the character's own effects it held, and Rage.
      if (hp === null) delete d.play.concentratingOn;
      else knockedOut(d.play, hp);
    });
    // The 0 HP it sets is on the page behind the sheet, so close it to show
    // what was done rather than leave the button looking unpressed.
    setInfoOpen(false);
    closePicker();
  };

  // Condition/status rules text for the character's edition: Exhaustion in
  // particular reads very differently between 2014 and 2024.
  const rules = (id: string): unknown => {
    if (registry === null) return undefined;
    const cands = [...registry.byType('condition'), ...registry.byType('status')].filter(
      (e) => String(e.name).toLowerCase() === id.toLowerCase(),
    );
    return pickForVersion(cands, edition)?.entries;
  };

  const exhaustion = (
    <ExhaustionStepper
      level={exhaustionLevel(conditions)}
      edition={edition}
      onSet={setExhaustion}
      onDeath={applyDeath}
    />
  );
  const open = (kind: 'condition' | 'effect', id: string) => {
    setShown({ kind, id });
    setInfoOpen(true);
  };
  const shownCondition = shown?.kind === 'condition' ? shown.id : null;
  const liveEffect = shown?.kind === 'effect' ? effects.find((e) => e.id === shown.id) : undefined;
  if (liveEffect !== undefined) lastEffect.current = liveEffect;
  const shownEffect =
    liveEffect ??
    (shown?.kind === 'effect' && lastEffect.current?.id === shown.id
      ? lastEffect.current
      : undefined);
  // One that ends while its sheet is open closes the sheet.
  const gone = infoOpen && shown?.kind === 'effect' && liveEffect === undefined;
  useEffect(() => {
    if (gone) setInfoOpen(false);
  }, [gone]);
  const effect = shownCondition === null ? undefined : conditionEffect(shownCondition, edition);
  const entries = shownCondition === null ? undefined : rules(shownCondition);
  // Exhaustion at 0 has no entry, and so nothing to switch.
  const shownEntry = conditions.find((c) => c.id === shownCondition);
  const shownHeld = shownEntry === undefined ? [] : immunityTo(shownEntry.id, immune);

  return (
    <>
      <div className="flex min-w-0 basis-full items-center">
        {/* Padded so the chips' 44px targets, wider than the 32px pills, fit
              inside the scrolling row instead of being clipped by it. The
              scroll padding does the same for a chip scrolled to (by focus,
              say): it stops clear of both edges. */}
        <div
          ref={row}
          onScroll={measure}
          className="flex min-w-0 flex-1 scroll-px-3 items-center gap-2 overflow-x-auto py-1.5 pr-1.5 pl-3 [scrollbar-width:none]"
        >
          {chipCount > 0 && (
            <ul ref={list} aria-label="Active effects" className="flex shrink-0 items-center gap-2">
              {conditions.map((c, i) => {
                const { name, level } = conditionLabel(c);
                const by = immunityTo(c.id, immune);
                const held = by.length > 0;
                return (
                  <li key={`c:${c.id}`} className={CHIP}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el === null) names.current.delete(`c:${c.id}`);
                        else names.current.set(`c:${c.id}`, el);
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={infoOpen && shownCondition === c.id}
                      onClick={() => open('condition', c.id)}
                      className={CHIP_NAME}
                    >
                      {held ? (
                        <ShieldCheck size={16} aria-hidden="true" className="shrink-0 text-ward" />
                      ) : (
                        <CircleAlert size={16} aria-hidden="true" className="shrink-0" />
                      )}
                      {/* One run of text, so its name has the space: "Exhausted 2". */}
                      <span>
                        {name}
                        {level !== undefined && (
                          <>
                            {' '}
                            <span className="font-normal text-ink-muted tabular-nums">{level}</span>
                          </>
                        )}
                        {(c.ignored === true || held) && (
                          <>
                            {' '}
                            <span className="font-normal text-ink-muted">off</span>
                          </>
                        )}
                        {held && <span className="sr-only">, held off by {by.join(', ')}</span>}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-remove=""
                      aria-label={`Remove ${c.id}`}
                      onClick={() => remove(c.id, i)}
                      className={CHIP_X}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
              {effects.map((e, i) => {
                const mark = effectMark(e);
                return (
                  <li key={`e:${e.id}`} className={CHIP}>
                    <button
                      type="button"
                      ref={(el) => {
                        if (el === null) names.current.delete(`e:${e.id}`);
                        else names.current.set(`e:${e.id}`, el);
                      }}
                      aria-haspopup="dialog"
                      aria-expanded={infoOpen && shownEffect?.id === e.id}
                      onClick={() => open('effect', e.id)}
                      className={CHIP_NAME}
                    >
                      {/* The space parts the die from the name when it is read out. */}
                      {mark !== undefined ? (
                        <>
                          <span className="font-bold text-heal tabular-nums">{mark}</span>{' '}
                        </>
                      ) : (
                        <ChevronsUp size={16} aria-hidden="true" className="shrink-0 text-heal" />
                      )}
                      <span>
                        {e.name}
                        {e.off === true && (
                          <>
                            {' '}
                            <span className="font-normal text-ink-muted">off</span>
                          </>
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      data-remove=""
                      aria-label={`Remove ${e.name}`}
                      onClick={() => end(e, conditions.length + i)}
                      className={CHIP_X}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {/* The end holds the row's right edge, outside the scrolling part,
              so a full strip never hides it and a chip scrolled toward it is
              clipped rather than covered. A word while the strip is empty, a
              plus once anything is on, and how many are out of sight when
              some are. */}
        <button
          ref={add}
          type="button"
          aria-haspopup="dialog"
          aria-expanded={pickerOpen}
          aria-label={hidden > 0 ? `Effects, ${hidden} more not shown` : 'Add an effect'}
          // The search's chunk starts on the press, so the tab's effects are
          // there as the sheet rises rather than arriving over its lists.
          onPointerDown={() => void loadFinder()}
          onClick={() => setPickerOpen(true)}
          className={`relative flex min-h-tap shrink-0 items-center bg-bg pr-3 pl-1.5 text-label ${
            hidden > 0 ? 'text-ink' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {hidden > 0 && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 right-full w-5 bg-gradient-to-r from-transparent to-bg"
            />
          )}
          <span className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full px-3 ring-1 ring-line-strong ring-inset">
            {hidden > 0 ? (
              `${hidden} more`
            ) : (
              <>
                <Plus size={16} aria-hidden="true" />
                {chipCount === 0 && 'Effect'}
              </>
            )}
          </span>
        </button>
      </div>

      <Sheet.Root open={infoOpen} onOpenChange={setInfoOpen}>
        <Sheet.Portal>
          <Sheet.Scrim />
          <Sheet.Panel
            aria-describedby={undefined}
            className="flex max-h-[80dvh] flex-col"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const name =
                shown === null
                  ? undefined
                  : names.current.get(`${shown.kind === 'condition' ? 'c' : 'e'}:${shown.id}`);
              (name?.isConnected ? name : (add.current ?? sheetTitle()))?.focus();
            }}
          >
            <Sheet.Heading>{shownEffect?.name ?? shownCondition}</Sheet.Heading>
            <div className="min-h-0 flex-1 overflow-y-auto text-body">
              {shownEffect !== undefined ? (
                <EffectInfo
                  effect={shownEffect}
                  insteadOf={countedInstead(effects, shownEffect.id)}
                  weaponName={(id) => sheet?.attacks.find((a) => a.weaponId === id)?.label}
                  onSwitch={(on) => switchEffect(shownEffect, on)}
                  onEnd={() => {
                    end(shownEffect);
                    setInfoOpen(false);
                  }}
                />
              ) : (
                <>
                  {shownCondition === 'Exhaustion' ? (
                    <div className="mb-3">{exhaustion}</div>
                  ) : (
                    effect !== undefined && (
                      <p className="mb-3 flex gap-1 text-caption text-guide">
                        <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
                        {effect}
                      </p>
                    )
                  )}
                  {shownEntry !== undefined &&
                    (shownHeld.length > 0 ? (
                      // Held off: the reason takes the switch's place, since
                      // switching it on would not make it apply.
                      <p className="mb-3 flex gap-1.5 text-caption text-ink">
                        <ShieldCheck
                          size={16}
                          aria-hidden="true"
                          className="mt-px shrink-0 text-ward"
                        />
                        <span>
                          Off while you are immune: {shownHeld.join(', ')}. It applies nothing, and
                          comes back if that ends, unless its own time ran out.
                        </span>
                      </p>
                    ) : (
                      <div className="mb-3">
                        <ToggleChip
                          label="Apply its effects"
                          on={shownEntry.ignored !== true}
                          onChange={(on) => setApplied(shownEntry.id, on)}
                          tone="guide"
                        />
                        <p className="mt-1 text-caption text-ink-muted">
                          Off keeps it listed, but the sheet leaves it out of your rolls, speed, hit
                          points and warnings until you switch it back on.
                        </p>
                      </div>
                    ))}
                  {entries !== undefined && <EntriesView entries={entries} />}
                </>
              )}
            </div>
          </Sheet.Panel>
        </Sheet.Portal>
      </Sheet.Root>

      <Sheet.Root
        open={pickerOpen}
        onOpenChange={(next) => (next ? setPickerOpen(true) : closePicker())}
      >
        <Sheet.Portal>
          <Sheet.Scrim />
          <Sheet.Panel
            ref={panel}
            aria-describedby={undefined}
            className="flex max-h-[85dvh] flex-col"
            onOpenAutoFocus={focusSheetOnTouch}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              (add.current ?? sheetTitle())?.focus();
            }}
          >
            <Sheet.Heading>Effects</Sheet.Heading>
            {/* Its padding holds the chip rows, which reach 6px past the text
                column so a chip's clear border sits outside it. Without it
                they overflow the box, and focusing a chip at the right edge
                scrolls the whole picker sideways. */}
            <div className="-mx-4 min-h-0 flex-1 overflow-y-auto px-4">
              {/* The search, over what the sheet already shows: words typed
                  swap the lists below for what they find, and an entry
                  opened takes the search's place until you go back. */}
              {picked === null && describing === null && (
                <div className="relative mb-3">
                  <Search
                    size={20}
                    aria-hidden="true"
                    className="pointer-events-none absolute top-3.5 left-3.5 text-ink-muted"
                  />
                  <input
                    ref={search}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search effects"
                    placeholder="Search spells, potions, features"
                    className={`${fieldClass} pl-10.5`}
                  />
                </div>
              )}
              {finding ? (
                sheet !== null && (
                  <Suspense
                    fallback={<p className="text-caption text-ink-muted">Loading effects…</p>}
                  >
                    <EffectFinder
                      doc={doc}
                      sheet={sheet}
                      query={query}
                      picked={picked}
                      onPick={pick}
                      onAdd={land}
                      describing={describing}
                      onDescribe={describe}
                      onForget={forgetKept}
                    />
                  </Suspense>
                )
              ) : (
                <>
                  {/* The tab's own effects lead (Items: potions; Stats: help for
                      checks and saves), from the search's chunk; the lists
                      below wait for none of it. */}
                  {sheet !== null && lead !== undefined && (
                    // A chunk that fails to load fails here, not over the
                    // conditions below it.
                    <DecodeBoundary label="This tab's list of effects">
                      <Suspense fallback={null}>
                        <EffectFinder
                          doc={doc}
                          sheet={sheet}
                          query=""
                          picked={null}
                          onPick={pickLead}
                          onAdd={land}
                          describing={null}
                          onDescribe={describe}
                          onForget={forgetKept}
                          tab={lead}
                          allShown={leadAll}
                          onShowAll={() => setLeadAll(true)}
                          takeReturn={takeLeadRow}
                        />
                      </Suspense>
                    </DecodeBoundary>
                  )}
                  <h3 className="mb-1 text-caption text-ink-muted font-semibold">Helping you</h3>
                  {/* Chips pad themselves to 44px with a 6px clear border, so the
                  row needs no gap of its own. A pressed one is in play;
                  tapping it ends it. The starters come first, in a fixed
                  order, so one that lands or ends stays where it was tapped. */}
                  <div className="-mx-1.5 mb-3 flex flex-wrap">
                    {STARTERS.map((st) => {
                      const held = starterHeld.get(st.name);
                      const mark = held === undefined ? st.mark : effectMark(held);
                      return (
                        <Chip
                          key={st.name}
                          pressed={held !== undefined}
                          onClick={() => (held === undefined ? start(st.name) : end(held))}
                        >
                          {mark !== undefined && (
                            <>
                              <span className="font-bold tabular-nums">{mark}</span>{' '}
                            </>
                          )}
                          {held?.name ?? st.name}
                        </Chip>
                      );
                    })}
                    {effects
                      .filter((e) => !startersShown.has(e.id))
                      .map((e) => {
                        const mark = effectMark(e);
                        return (
                          <Chip key={e.id} pressed onClick={() => end(e)}>
                            {mark !== undefined && (
                              <>
                                <span className="font-bold tabular-nums">{mark}</span>{' '}
                              </>
                            )}
                            {e.name}
                          </Chip>
                        );
                      })}
                  </div>
                  {/* Not among these and not in the search: say what it does. */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="mb-3"
                    onClick={() => {
                      void loadFinder();
                      describe('');
                    }}
                  >
                    <PencilLine size={16} aria-hidden="true" />
                    Describe an effect
                  </Button>
                  {bardicDie !== undefined && bardic !== undefined && (
                    <div className="mb-3 flex flex-col gap-1">
                      <h3 className="text-caption text-ink-muted font-semibold">
                        The bard's die, by their level
                      </h3>
                      <SegmentedControl
                        label="The bard's die, by their level"
                        options={BARDIC_DICE.map((die) => ({ value: die, label: die }))}
                        value={bardicDie}
                        // Only the die changes: switched off or counting turns, it stays so.
                        onChange={(die) =>
                          put({ ...bardic, parts: bardicEffect(bardic.id, edition, die).parts })
                        }
                        block
                      />
                    </div>
                  )}
                  <h3 className="mb-1 text-caption text-ink-muted font-semibold">Conditions</h3>
                  <div className="-mx-1.5 flex flex-wrap">
                    {CONDITIONS.map((c) => {
                      const by = immunityTo(c, immune);
                      const has = conditions.some((x) => x.id === c);
                      return (
                        <Chip
                          key={c}
                          pressed={has}
                          aria-label={by.length > 0 && !has ? `${c}, you are immune` : undefined}
                          aria-describedby={by.length > 0 ? 'immune-why' : undefined}
                          onClick={() => toggle(c)}
                        >
                          {by.length > 0 && (
                            <ShieldCheck
                              size={16}
                              aria-hidden="true"
                              className={has ? 'shrink-0' : 'shrink-0 text-ward'}
                            />
                          )}
                          {c}
                        </Chip>
                      );
                    })}
                  </div>
                  {/* Mounted from the start, so the status region exists before the
                  first tap; empty, it takes no room. */}
                  <p
                    id="immune-why"
                    role="status"
                    className={`flex gap-1.5 text-caption text-ink ${refused === null ? '' : 'mt-1'}`}
                  >
                    {refused !== null && (
                      <>
                        <ShieldCheck
                          size={16}
                          aria-hidden="true"
                          className="mt-px shrink-0 text-ward"
                        />
                        <span>{refused} Nothing was added.</span>
                      </>
                    )}
                  </p>
                  <div className="mt-2 border-line border-t pt-3">{exhaustion}</div>
                </>
              )}
            </div>
          </Sheet.Panel>
        </Sheet.Portal>
      </Sheet.Root>
    </>
  );
}

/** The bard's die a Bardic Inspiration in play offers, when it is one of the four. */
function bardicDieOf(effect: ActiveEffect | undefined): BardicDie | undefined {
  const offer = effect?.parts.find((p) => p.kind === 'rollOffer');
  if (offer?.kind !== 'rollOffer') return undefined;
  const die = offer.dice.replace(/^1d/i, 'd');
  return BARDIC_DICE.find((d) => d === die);
}

/** An effect's sheet: what it does, how long it lasts, and its switch. */
function EffectInfo({
  effect,
  insteadOf,
  weaponName,
  onSwitch,
  onEnd,
}: {
  effect: ActiveEffect;
  /** The effect of the same name that counts instead, when this one counts for nothing. */
  insteadOf: string | undefined;
  /** A carried weapon's name by its equipment id, for a part on one weapon (Magic Weapon). */
  weaponName: (id: string) => string | undefined;
  onSwitch: (on: boolean) => void;
  onEnd: () => void;
}) {
  const lasts = lastsLine(effect);
  return (
    <>
      <ul className="mb-3 flex flex-col gap-1">
        {effect.parts.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the stored parts have no id, and their order is the effect's own
          <li key={i} className="flex gap-1.5">
            <ChevronsUp size={16} aria-hidden="true" className="mt-0.75 shrink-0 text-heal" />
            {partLine(p, weaponName)}
          </li>
        ))}
      </ul>
      {insteadOf !== undefined && (
        <p className="mb-3 flex gap-1 text-caption text-guide">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
          {insteadOf === effect.name
            ? `Another ${effect.name} counts instead: effects of one name never add up.`
            : `${insteadOf} counts instead: effects of one name never add up.`}
        </p>
      )}
      {lasts !== undefined && <p className="mb-3 text-caption text-ink-muted">{lasts}</p>}
      <div className="mb-3">
        <ToggleChip
          label="Apply its effects"
          on={effect.off !== true}
          onChange={onSwitch}
          tone="guide"
        />
        <p className="mt-1 text-caption text-ink-muted">
          Off keeps it listed, but the sheet leaves it out until you switch it back on.
        </p>
      </div>
      <Button variant="secondary" block onClick={onEnd}>
        Remove it
      </Button>
    </>
  );
}
