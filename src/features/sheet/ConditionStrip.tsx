import { AlertTriangle, ChevronsUp, CircleAlert, Plus, ShieldCheck, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EntriesView } from '@/data5e/entries/renderEntries';
import { useRegistry } from '@/data5e/hooks';
import { pickForVersion } from '@/data5e/rulesVersion';
import { BARDIC_DICE, type BardicDie, bardicEffect } from '@/engine/curated/namedEffects';
import { applyEffect, endEffect, setConcentration, setEffectOff } from '@/engine/effectLife';
import { type ActiveEffect, type CharacterDoc, type DerivedSheet, SKILLS } from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { conditionSheetStore } from '@/stores/conditionSheet';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Sheet } from '@/ui/sheet';
import { ToggleChip } from '@/ui/ToggleChip';
import { CONDITIONS, conditionEffect } from './conditionEffects';
import { ExhaustionStepper } from './ExhaustionStepper';
import {
  countedInstead,
  effectMark,
  effectsInPlay,
  hpLimits,
  immunityTo,
  lastsLine,
  partLine,
} from './effectsInPlay';
import { exhaustionLevel, setExhaustionLevel } from './exhaustion';
import { answersTo, STARTERS, starterEffect } from './namedStarts';

type Condition = CharacterDoc['play']['conditions'][number];

/** A chip's words: "Poisoned", and exhaustion with its level, "Exhausted 2". */
export function conditionLabel(c: Condition): { name: string; level?: number } {
  if (c.id === 'Exhaustion') return { name: 'Exhausted', level: c.level };
  return { name: c.id, level: c.level };
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
 * every condition and the exhaustion stepper. With nothing on, the strip is
 * gone, except on Play (`addable`), where the end stays.
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
  addable,
}: {
  doc: CharacterDoc;
  /** The derived sheet: what the character is immune to, and their HP maximum. */
  sheet: DerivedSheet | null;
  update: DocUpdater;
  addable: boolean;
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
  // 2024 Guidance asks which skill before it lands.
  const [askingSkill, setAskingSkill] = useState(false);
  const guidanceChip = useRef<HTMLButtonElement>(null);
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
    setAskingSkill(false);
  };

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
  const stripShown = chipCount > 0 || addable;
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
  // The row comes and goes with the strip, so each one it mounts is watched.
  useEffect(() => {
    const strip = row.current;
    if (!stripShown || strip === null || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(measure);
    watch.observe(strip);
    return () => watch.disconnect();
  }, [measure, stripShown]);

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
    update((d) => {
      const idx = d.play.conditions.findIndex((x) => x.id === id);
      if (idx === -1) d.play.conditions.push({ id });
      else d.play.conditions.splice(idx, 1);
    });
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
  /** A starter's chip, not yet in play: add it, or ask what it needs first. */
  const start = (name: string, skill?: string) => {
    if (name === 'Guidance' && edition === '2024' && skill === undefined) {
      setAskingSkill((was) => !was);
      return;
    }
    const effect = starterEffect(name, edition, skill === undefined ? {} : { skill });
    if (effect === undefined) return;
    setAskingSkill(false);
    put(effect);
  };
  const switchEffect = (effect: ActiveEffect, on: boolean) => {
    const hp = limits();
    if (hp === null) return;
    update((d) => void setEffectOff(d.play, effect.id, !on, hp));
  };
  const setExhaustion = (level: number) =>
    update((d) => setExhaustionLevel(d.play.conditions, level));
  const setApplied = (id: string, applied: boolean) =>
    update((d) => {
      const c = d.play.conditions.find((x) => x.id === id);
      if (c === undefined) return;
      if (applied) delete c.ignored;
      else c.ignored = true;
    });
  const applyDeath = () => {
    const hp = limits();
    update((d) => {
      d.play.hpInitialized = true; // deliberate 0 HP must stick (no auto-fill)
      d.play.currentHp = 0;
      d.play.tempHp = 0;
      delete d.play.tempHpFrom;
      // Death ends concentration, and the character's own effects it held.
      if (hp === null) delete d.play.concentratingOn;
      else setConcentration(d.play, undefined, hp);
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
      {stripShown && (
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
              <ul
                ref={list}
                aria-label="Active effects"
                className="flex shrink-0 items-center gap-2"
              >
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
                          <ShieldCheck
                            size={16}
                            aria-hidden="true"
                            className="shrink-0 text-ward"
                          />
                        ) : (
                          <CircleAlert size={16} aria-hidden="true" className="shrink-0" />
                        )}
                        {/* One run of text, so its name has the space: "Exhausted 2". */}
                        <span>
                          {name}
                          {level !== undefined && (
                            <>
                              {' '}
                              <span className="font-normal text-ink-muted tabular-nums">
                                {level}
                              </span>
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
      )}

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
            aria-describedby={undefined}
            className="flex max-h-[85dvh] flex-col"
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
              <h3 className="mb-1 text-caption text-ink-muted font-semibold">Helping you</h3>
              {/* Chips pad themselves to 44px with a 6px clear border, so the
                  row needs no gap of its own. A pressed one is in play;
                  tapping it ends it. The starters come first, in a fixed
                  order, so one that lands or ends stays where it was tapped. */}
              <div className="-mx-1.5 mb-3 flex flex-wrap">
                {STARTERS.map((st) => {
                  const held = starterHeld.get(st.name);
                  const asks = st.name === 'Guidance' && edition === '2024' && held === undefined;
                  const mark = held === undefined ? st.mark : effectMark(held);
                  return (
                    <Chip
                      key={st.name}
                      ref={st.name === 'Guidance' ? guidanceChip : undefined}
                      pressed={held !== undefined}
                      aria-expanded={asks ? askingSkill : undefined}
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
              {askingSkill && starterHeld.get('Guidance') === undefined && (
                <>
                  <h3
                    id="guidance-skill"
                    className="mb-1 text-caption text-ink-muted font-semibold"
                  >
                    Guidance on which skill?
                  </h3>
                  {/* 2024 Guidance adds its d4 to every check with one skill. */}
                  {/* biome-ignore lint/a11y/useSemanticElements: a group of buttons, not a fieldset of inputs */}
                  <div
                    role="group"
                    aria-labelledby="guidance-skill"
                    className="-mx-1.5 mb-3 flex flex-wrap"
                  >
                    {SKILLS.map((sk) => (
                      <Chip
                        key={sk.name}
                        onClick={() => {
                          start('Guidance', sk.name);
                          guidanceChip.current?.focus();
                        }}
                      >
                        {sk.name}
                      </Chip>
                    ))}
                  </div>
                </>
              )}
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
  onSwitch,
  onEnd,
}: {
  effect: ActiveEffect;
  /** The effect of the same name that counts instead, when this one counts for nothing. */
  insteadOf: string | undefined;
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
            {partLine(p)}
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
