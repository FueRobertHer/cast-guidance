import { ArrowLeft, ArrowRight, Check, History } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import { filterByRulesVersion, type RulesVersion } from '@/data5e/rulesVersion';
import { subclassOptions } from '@/data5e/subclassOptions';
import { characterRepo } from '@/db/characterRepo';
import { deriveSheet } from '@/engine/derive';
import { subclassUnlockLevel } from '@/engine/multiclass';
import {
  ABILITIES,
  type CharacterDoc,
  type EffectOrigin,
  type EntityRef,
  refUid,
} from '@/engine/types';
import { SpellManager } from '@/features/sheet/SpellManager';
import {
  classRemovalParts,
  listJoin,
  pickCount,
  picksCleared,
  plural,
} from '@/lib/describeRemoval';
import { pruneChoicesFor, pruneClass, pruneOrigin } from '@/lib/pruneChoices';
import { usePageTitle } from '@/lib/usePageTitle';
import { sameForUndo, type UndoNotice, useUndoOffer } from '@/lib/useUndoOffer';
import { notifyFailure } from '@/stores/notices';
import { askConfirm } from '@/ui/dialogs';
import { EntityCardList } from '@/ui/EntityCardList';
import { UndoBar } from '@/ui/UndoBar';
import { AbilitiesStep, type ShownMethod } from './AbilitiesStep';
import { abilityIssue, allAt, keepsOnPointBuySwitch } from './abilityMethods';
import {
  clearDraft,
  type Draft,
  draftSummary,
  freshDraft,
  isBlankDraft,
  isResumeState,
  readDraft,
  saveDraftStep,
  writeDraft,
} from './draft';
import { replaceWizardWith } from './leaveWizard';
import { OriginChoices } from './OriginChoices';
import {
  backgroundBlurb,
  classBlurb,
  makeSubclassBlurb,
  makeSubclassEntries,
  raceBlurb,
} from './pickerHints';
import {
  bundleGoldCp,
  bundleToEquipment,
  defaultStrings,
  type EquipmentBundle,
  itemsForEquipmentType,
  parseStartingEquipment,
} from './startingEquipment';
import { normalizeStep, STEP_LABELS, STEPS, type Step, wizardDepth, wizardState } from './steps';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');

const rowsKey = (rows: Record<string, string>) => JSON.stringify(Object.entries(rows).sort());

const sameDraft = (a: Draft, b: Draft) =>
  sameForUndo(a.doc, b.doc) &&
  rowsKey(a.bundleChoices) === rowsKey(b.bundleChoices) &&
  rowsKey(a.slotPicks) === rowsKey(b.slotPicks);

const hasCoin = (doc: CharacterDoc) => Object.values(doc.play.currency).some((v) => v !== 0);

/**
 * Take back the kit when the class or background it was granted for changes
 * (UX-004): the gear, the coin, and the rows picked for that source, which
 * would otherwise pick a row of the new one's kit by position. The gear has to
 * go rather than wait as a leftover: it is equipped and counts toward AC. With
 * the doc's equipment empty again, leaving the Equipment step and Review's
 * "No starting equipment" lead the player to the new kit; the other source's
 * rows stay picked for it. Says whether a granted kit went.
 */
function clearKit(d: Draft, source: 'class' | 'bg'): boolean {
  for (const rows of [d.bundleChoices, d.slotPicks]) {
    for (const key of Object.keys(rows)) if (key.startsWith(`${source}:`)) delete rows[key];
  }
  if (d.doc.equipment.length === 0 && !hasCoin(d.doc)) return false;
  d.doc.equipment = [];
  d.doc.play.currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  return true;
}

const KIT_CLEARED = 'starting equipment cleared, pick it again on the Equipment step';

/** An undo line's detail from its parts, or nothing when none apply. */
const detailOf = (...parts: Array<string | undefined>) => {
  const kept = parts.filter((p): p is string => p !== undefined);
  return kept.length > 0 ? kept.join(' · ') : undefined;
};

const scoresText = (d: CharacterDoc) => ABILITIES.map((a) => d.abilities.base[a]).join('/');
/** Ability overwrites offer undo only when a score moved, not for the method alone. */
const scoresChanged = (before: Draft, after: Draft) =>
  scoresText(before.doc) !== scoresText(after.doc);

/**
 * What a rules-version switch would clear from this draft, for its confirm:
 * only what is there, so an empty draft switches without asking.
 */
function rulesSwitchClears(d: Draft, active: ReadonlySet<string>): string[] {
  const { doc } = d;
  const parts: string[] = [];
  if (doc.classes.length > 0) {
    parts.push(
      `class ${listJoin(
        doc.classes.map(
          (c) => `${c.ref.name}${c.subclass !== undefined ? ` (${c.subclass.name})` : ''}`,
        ),
      )}`,
    );
  }
  if (doc.race !== undefined) {
    parts.push(
      `species ${doc.race.name}${doc.subrace !== undefined ? ` (${doc.subrace.name})` : ''}`,
    );
  }
  if (doc.background !== undefined) parts.push(`background ${doc.background.name}`);
  const picks = pickCount(doc, Object.keys(doc.choices), active);
  if (picks > 0) parts.push(plural(picks, 'pick'));
  const spells = new Set(
    Object.values(doc.spellcasting).flatMap((sc) =>
      [...sc.known, ...sc.prepared].map((r) => refUid(r)),
    ),
  );
  if (spells.size > 0) parts.push(plural(spells.size, 'spell'));
  // Only gear actually granted; kit options picked but not yet granted are
  // still reset, but there is nothing in hand to lose.
  if (doc.equipment.length > 0 || hasCoin(doc)) parts.push('starting equipment');
  return parts;
}

export function Component() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const step = normalizeStep(params.get('step'));
  const registry = useRegistry(['essentials']);
  // The in-progress draft survives reloads and trips to the roster via
  // sessionStorage, kit rows included.
  const [entry] = useState(() => {
    const stored = readDraft();
    return {
      draft: stored ?? freshDraft(),
      // Entered afresh (not a step of this load, nor the roster's Resume) on
      // a draft with something in it: say it is being continued, and offer
      // to start over. A line, not a gate: the step is right there.
      // Tied to the draft entered with (see `continuing` below).
      continuing:
        stored !== null &&
        !isBlankDraft(stored) &&
        wizardDepth(location.state) === 0 &&
        !isResumeState(location.state),
    };
  });
  const [draft, setDraftState] = useState<Draft>(() => {
    const { doc, bundleChoices, slotPicks } = entry.draft;
    return { doc, bundleChoices, slotPicks };
  });
  const { doc, bundleChoices, slotPicks } = draft;
  // The draft as last set, which a change builds on before React renders it:
  // two changes in one handler must see each other, and a change is worked out
  // once, here, not in a state updater that StrictMode runs twice (which would
  // also leave an undo with two different "before"s to pick from).
  const latest = useRef(draft);
  const setDraft = (next: Draft) => {
    latest.current = next;
    setDraftState(next);
    writeDraft(next, step);
  };
  /** Apply `recipe` to a copy of the draft, once, and keep both sides. */
  const change = (recipe: (d: Draft) => void) => {
    const before = latest.current;
    const after = structuredClone(before);
    recipe(after);
    setDraft(after);
    return { before, after };
  };
  // Before any early return: hooks run in the same order on every render.
  // The step a Start over took the draft from, so its undo puts back the
  // step to resume as well as the draft.
  const stepBeforeStartOver = useRef<{ id: string; step: Step | undefined } | null>(null);
  const undo = useUndoOffer<Draft>({
    current: draft,
    same: sameDraft,
    restore: (before) => {
      setDraft(before);
      const kept = stepBeforeStartOver.current;
      stepBeforeStartOver.current = null;
      if (kept?.id === before.doc.id && kept.step !== undefined) saveDraftStep(kept.step);
    },
  });
  // Bumped when a change's own control goes away with it, so focus moves to
  // the Undo button instead of falling to the page body.
  const [undoFocus, setUndoFocus] = useState(0);

  // The fixed block at the bottom (undo line plus step nav) is measured, and
  // the page ends in a spacer that tall, so nothing it covers is out of reach.
  // A fixed padding guessed its height, and a long undo line outgrew it,
  // leaving the Create button stuck under the bar.
  const [bottomBlock, setBottomBlock] = useState<HTMLDivElement | null>(null);
  const [bottomHeight, setBottomHeight] = useState(0);
  useLayoutEffect(() => {
    if (bottomBlock === null) return;
    const measure = () => setBottomHeight(bottomBlock.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(bottomBlock);
    return () => observer.disconnect();
  }, [bottomBlock]);

  useEffect(() => {
    void ensureTypePacks('class');
    void ensureTypePacks('item');
  }, []);

  // The step the roster's Resume returns to. Recorded only once the player
  // moves, never for the step the page opened on: a deep link or a plain
  // /create must not overwrite where the draft was left before it is used.
  const openedOn = useRef(step);
  useEffect(() => {
    if (openedOn.current === step) return;
    openedOn.current = step;
    saveDraftStep(step);
  }, [step]);

  // Set once Create is pressed: the name of the character being opened. From
  // then on the wizard is spent, and its history entries are being unwound.
  const [opening, setOpening] = useState<string | null>(null);
  const creating = useRef(false);
  // Create awaits a save before it unwinds, and the depth it unwinds is the
  // one current when the save lands, not when the button was pressed.
  // A layout effect, so a save that settles right after a Back reads the
  // entry the Back landed on.
  const live = useRef({ location, mounted: true });
  useLayoutEffect(() => {
    live.current.location = location;
  }, [location]);
  useEffect(() => {
    const state = live.current;
    state.mounted = true;
    return () => {
      state.mounted = false;
    };
  }, []);
  // The entry a step push left from, and when. Router state lands in a
  // transition, so a fast double tap could otherwise push twice from the same
  // stale location and miscount the depth Create unwinds. It expires rather
  // than waiting for a new entry: a Back that lands before the push commits
  // returns to the same entry, and a guard waiting on a new one would hold
  // every step button forever.
  const pushed = useRef<{ key: string; at: number } | null>(null);
  // A save slow enough to look stuck (a database blocked by another tab).
  // Only then is leaving offered: leaving mid-save pushes over the wizard's
  // entries, which is the trap Create unwinds, so a normal save never offers it.
  const [slowSave, setSlowSave] = useState(false);
  useEffect(() => {
    if (opening === null) return;
    const timer = setTimeout(() => setSlowSave(true), 3000);
    return () => clearTimeout(timer);
  }, [opening]);

  const ctx = registry !== null ? engineContextFor(registry) : null;
  const sheet = useMemo(() => (ctx !== null ? deriveSheet(doc, ctx) : null), [doc, ctx]);

  const update = (recipe: (d: CharacterDoc) => void) => {
    change((d) => recipe(d.doc));
  };

  /**
   * Make a change that takes something away, then offer to put it back
   * (UX-004). The undo restores the whole draft, kit rows included. A change
   * that changed nothing, or took nothing away (`worthUndo`: a first pick of
   * a class or species replaces nothing), offers nothing.
   */
  const undoable = (
    recipe: (d: Draft) => void,
    describe: (before: Draft, after: Draft) => UndoNotice,
    worthUndo: (before: Draft, after: Draft) => boolean = (b, a) => !sameDraft(b, a),
  ) => {
    const { before, after } = change(recipe);
    if (!worthUndo(before, after)) return;
    const { title, detail } = describe(before, after);
    undo.offer(before, after, title, detail);
  };

  const goto = (s: Step) => {
    const now = performance.now();
    if (pushed.current?.key === location.key && now - pushed.current.at < 1000) return;
    pushed.current = { key: location.key, at: now };
    setParams({ step: s }, { replace: false, state: wizardState(wizardDepth(location.state) + 1) });
  };
  const stepIdx = STEPS.indexOf(step);

  usePageTitle(
    ...(opening !== null
      ? ['Opening character']
      : [STEP_LABELS[step], `Step ${stepIdx + 1} of ${STEPS.length}`, 'New character']),
  );

  if (opening !== null) {
    return (
      <main className="flex flex-1 flex-col gap-3 p-4">
        <p role="status" className="text-sm text-ink-muted">
          Opening {opening}…
        </p>
        {slowSave && (
          <Link to="/" className="text-sm text-ink-muted underline hover:text-ink">
            Still saving. Back to characters
          </Link>
        )}
      </main>
    );
  }

  const header = (
    <header className="flex items-center gap-3">
      <Link
        to="/"
        aria-label="Back to characters (your draft is kept)"
        className="text-ink-muted hover:text-ink"
      >
        <ArrowLeft size={20} aria-hidden />
      </Link>
      <h1 className="text-xl font-bold">{STEP_LABELS[step]}</h1>
      <span className="text-sm text-ink-muted">
        {stepIdx + 1}/{STEPS.length}
      </span>
    </header>
  );

  if (registry === null) {
    return (
      <main className="flex flex-1 flex-col gap-4 p-4">
        {header}
        <p className="text-sm text-ink-muted">Loading game data…</p>
      </main>
    );
  }

  const classes = filterByRulesVersion([...registry.byType('class')], doc.rulesVersion);
  const classEntity =
    doc.classes[0] !== undefined
      ? registry.get('class', doc.classes[0].ref.name, doc.classes[0].ref.source)
      : undefined;
  const subclasses =
    doc.classes[0] !== undefined
      ? subclassOptions(
          registry.byType('subclass'),
          doc.classes[0].ref,
          doc.rulesVersion,
          doc.classes[0].subclass,
        )
      : [];
  const races = filterByRulesVersion([...registry.byType('race')], doc.rulesVersion);
  const subraces =
    doc.race !== undefined
      ? registry
          .byType('subrace')
          .filter(
            (s) =>
              String(s.raceName ?? '').toLowerCase() === doc.race?.name.toLowerCase() &&
              typeof s.name === 'string',
          )
      : [];
  const backgrounds = filterByRulesVersion([...registry.byType('background')], doc.rulesVersion);

  // --- Starting equipment (shared by the step body, auto-grant, and review) --
  const bgEntity =
    doc.background !== undefined
      ? registry.get('background', doc.background.name, doc.background.source)
      : undefined;
  const allEqGroups: Array<{ source: string; groupIdx: number; bundles: EquipmentBundle[] }> = [
    ...parseStartingEquipment(classEntity).map((bundles, groupIdx) => ({
      source: 'class',
      groupIdx,
      bundles,
    })),
    ...parseStartingEquipment(bgEntity).map((bundles, groupIdx) => ({
      source: 'bg',
      groupIdx,
      bundles,
    })),
  ];

  /** Rebuild doc.equipment from the draft's bundle + slot selections. */
  const grantKit = ({ doc: d, bundleChoices: choices, slotPicks: picks }: Draft) => {
    const chosen: (typeof d.equipment)[number][] = [];
    let goldCp = 0;
    for (const g of allEqGroups) {
      const key = `${g.source}:${g.groupIdx}`;
      const pick = choices[key] ?? g.bundles[0]?.key;
      const bundle = g.bundles.find((b) => b.key === pick);
      if (bundle === undefined) continue;
      const slotForBundle: Record<number, string> = {};
      bundle.items.forEach((item, idx) => {
        const v = picks[`${key}:${idx}`];
        if (item.equipmentType !== undefined && v !== undefined) slotForBundle[idx] = v;
      });
      chosen.push(...bundleToEquipment(bundle, slotForBundle));
      goldCp += bundleGoldCp(bundle);
    }
    d.equipment = chosen;
    // A "gold instead of gear" pick becomes real starting currency to spend.
    d.play.currency = {
      cp: goldCp % 10,
      sp: Math.floor((goldCp % 100) / 10),
      ep: 0,
      gp: Math.floor(goldCp / 100),
      pp: 0,
    };
    // Auto-equip armor, shield, and weapons so AC/attacks reflect the kit.
    for (const item of d.equipment) {
      if (item.ref === undefined) continue;
      const e =
        registry.get('item', item.ref.name, item.ref.source || undefined) ??
        registry.get('baseitem', item.ref.name, item.ref.source || undefined);
      if (e === undefined) continue;
      const type = String(e.type ?? '').split('|')[0];
      if (
        type === 'LA' ||
        type === 'MA' ||
        type === 'HA' ||
        type === 'S' ||
        e.weaponCategory !== undefined
      ) {
        item.equipped = true;
      }
    }
  };

  const pickBundle = (groupKey: string, bundleKey: string) =>
    change((d) => {
      d.bundleChoices[groupKey] = bundleKey;
      grantKit(d);
    });
  const pickSlot = (slotKey: string, uid: string) =>
    change((d) => {
      d.slotPicks[slotKey] = uid;
      grantKit(d);
    });

  /**
   * Step navigation that never loses work: walking on past the equipment step
   * grants the highlighted defaults if the player didn't touch anything.
   * Stepping back does not: that is usually to fix the class or background
   * just changed, and a grant there would count as a new edit and withdraw
   * the undo offered for that change. Walking forward again grants it.
   */
  const navStep = (s: Step) => {
    const forward = STEPS.indexOf(s) > stepIdx;
    if (forward && step === 'equipment' && doc.equipment.length === 0 && allEqGroups.length > 0) {
      change(grantKit);
    }
    goto(s);
  };

  const undoShown = undo.pending !== null || undo.undone !== null;

  // Prompts the player can see now, so "N picks cleared" counts only those.
  const activeChoices = new Set(sheet?.resolvedChoices.map((r) => r.prompt.id) ?? []);

  /**
   * Switching rules version starts the build over: every class, species,
   * background, pick, spell and kit came from the other edition's list. So it
   * says first what goes, and asks only when something would.
   */
  const switchRulesVersion = async (v: RulesVersion) => {
    // Re-selecting the current version must be a no-op: an accidental tap
    // must never wipe the in-progress build.
    if (doc.rulesVersion === v) return;
    const clears = rulesSwitchClears(latest.current, activeChoices);
    if (clears.length > 0) {
      const ok = await askConfirm({
        title: `Switch to ${v} rules?`,
        detail: `Clears your ${listJoin(clears)}, since they come from the other rules. Your name and ability scores stay.`,
        confirmLabel: `Switch to ${v}`,
        danger: true,
      });
      if (!ok) return;
    }
    change((d) => {
      if (d.doc.rulesVersion === v) return;
      d.doc.rulesVersion = v;
      d.doc.classes = [];
      d.doc.race = undefined;
      d.doc.subrace = undefined;
      d.doc.background = undefined;
      d.doc.choices = {};
      d.doc.spellcasting = {};
      d.doc.equipment = [];
      d.doc.play.currency = { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
      d.bundleChoices = {};
      d.slotPicks = {};
    });
  };

  /**
   * Picking a different class swaps out only what belonged to the old one: its
   * picks, subclass, ASI feats, spell list and kit. Species and background
   * picks stay; this used to clear every choice in the build.
   */
  const selectClass = (next: EntityRef) => {
    let kit = false;
    undoable(
      (d) => {
        const old = d.doc.classes[0];
        if (old !== undefined && refUid(old.ref) === refUid(next)) return;
        d.doc.classes = [{ ref: next, levels: old?.levels ?? 1, hp: old?.hp ?? ['avg'] }];
        if (old !== undefined) pruneClass(d.doc, old);
        kit = clearKit(d, 'class');
      },
      (before) => {
        const old = before.doc.classes[0];
        const parts = old !== undefined ? classRemovalParts(before.doc, old, activeChoices) : [];
        return {
          title: `Class: ${old?.ref.name ?? 'none'} → ${next.name}`,
          detail: detailOf(
            parts.length > 0 ? `${listJoin(parts)} cleared` : undefined,
            kit ? KIT_CLEARED : undefined,
          ),
        };
      },
      (before, after) => !sameDraft(before, after) && (before.doc.classes[0] !== undefined || kit),
    );
  };

  /** One level off. A rolled HP for that level would go with it. */
  const levelDown = () =>
    undoable(
      (d) => {
        const c = d.doc.classes[0];
        if (c === undefined || c.levels <= 1) return;
        c.levels -= 1;
        c.hp = c.hp.slice(0, c.levels);
      },
      (before) => {
        const c = before.doc.classes[0];
        const lost = c?.hp[c.levels - 1];
        return {
          title: `${c?.ref.name ?? 'Class'} level ${c?.levels ?? 0} → ${(c?.levels ?? 1) - 1}`,
          detail: typeof lost === 'number' ? `rolled ${lost} HP for that level cleared` : undefined,
        };
      },
      // At average HP the "+" puts back exactly what went.
      (before, after) =>
        !sameDraft(before, after) && typeof before.doc.classes[0]?.hp.at(-1) === 'number',
    );

  /** Swap or clear the subclass; the old one's picks go with it. */
  const setSubclass = (next: EntityRef | undefined) => {
    const removed: string[] = [];
    undoable(
      (d) => {
        const c = d.doc.classes[0];
        if (c === undefined) return;
        if (c.subclass !== undefined)
          removed.push(...pruneChoicesFor(d.doc, 'subclass', c.subclass));
        c.subclass = next;
      },
      (before) => {
        const c = before.doc.classes[0];
        return {
          title: `Subclass: ${c?.subclass?.name ?? 'none'} → ${next?.name ?? 'none'}`,
          detail: picksCleared(before.doc, removed, c?.subclass?.name, activeChoices),
        };
      },
      (before, after) => !sameDraft(before, after) && before.doc.classes[0]?.subclass !== undefined,
    );
  };

  const selectRace = (next: EntityRef) => {
    const removed: string[] = [];
    undoable(
      (d) => {
        if (d.doc.race !== undefined) removed.push(...pruneOrigin(d.doc, 'race', d.doc.race));
        if (d.doc.subrace !== undefined) {
          removed.push(...pruneOrigin(d.doc, 'subrace', d.doc.subrace));
        }
        d.doc.race = next;
        d.doc.subrace = undefined;
      },
      (before) => ({
        title: `Species: ${before.doc.race?.name ?? 'none'} → ${next.name}`,
        // Named for the species that changed; mixed species and subrace picks
        // are just "picks".
        detail: picksCleared(
          before.doc,
          removed,
          before.doc.subrace === undefined ? before.doc.race?.name : undefined,
          activeChoices,
        ),
      }),
      (before, after) => !sameDraft(before, after) && before.doc.race !== undefined,
    );
  };

  /** Swap or clear the subrace; the old one's picks go with it. */
  const setSubrace = (next: EntityRef | undefined) => {
    const removed: string[] = [];
    undoable(
      (d) => {
        if (d.doc.subrace !== undefined) {
          removed.push(...pruneOrigin(d.doc, 'subrace', d.doc.subrace));
        }
        d.doc.subrace = next;
      },
      (before) => ({
        title: `Subrace: ${before.doc.subrace?.name ?? 'none'} → ${next?.name ?? 'none'}`,
        detail: picksCleared(before.doc, removed, before.doc.subrace?.name, activeChoices),
      }),
      (before, after) => !sameDraft(before, after) && before.doc.subrace !== undefined,
    );
  };

  /** A new background takes the old one's picks, its feats' picks, and its kit. */
  const selectBackground = (next: EntityRef) => {
    const removed: string[] = [];
    let kit = false;
    undoable(
      (d) => {
        const old = d.doc.background;
        if (old !== undefined && refUid(old) === refUid(next)) return;
        if (old !== undefined) removed.push(...pruneOrigin(d.doc, 'background', old));
        d.doc.background = next;
        kit = clearKit(d, 'bg');
      },
      (before) => ({
        title: `Background: ${before.doc.background?.name ?? 'none'} → ${next.name}`,
        detail: detailOf(
          picksCleared(before.doc, removed, before.doc.background?.name, activeChoices),
          kit ? KIT_CLEARED : undefined,
        ),
      }),
      (before, after) => !sameDraft(before, after) && (before.doc.background !== undefined || kit),
    );
  };

  /**
   * Switching method never moves a score, except into point buy from scores
   * it cannot price: a legal spread (the standard array costs exactly 27)
   * carries over, anything else starts again from 8s. That reset offers undo,
   * unless it reset the untouched all-10 state, which loses nothing.
   */
  const setMethod = (m: ShownMethod) =>
    undoable(
      ({ doc: d }) => {
        // Re-selecting the current method is a no-op: otherwise re-tapping
        // "Point buy" re-zeroes allocated scores.
        if (d.abilities.method === m) return;
        d.abilities.method = m;
        if (m === 'pointbuy' && !keepsOnPointBuySwitch(d.abilities.base)) {
          d.abilities.base = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
        }
      },
      (before) => ({
        title: 'Point buy: every score back to 8',
        detail: `was ${scoresText(before.doc)}`,
      }),
      (before, after) => scoresChanged(before, after) && !allAt(before.doc.abilities.base, 10),
    );

  /**
   * Begin a new character in place of the draft, from the Basics step. Undo
   * brings the whole draft back, kit rows included.
   */
  const startOver = () => {
    stepBeforeStartOver.current = { id: latest.current.doc.id, step: readDraft()?.step };
    undoable(
      (d) => Object.assign(d, freshDraft()),
      (before) => ({
        title: 'Started a new character',
        detail: `was ${draftSummary(before.doc)}`,
      }),
    );
    setUndoFocus((n) => n + 1);
    if (step !== 'basics') setParams({ step: 'basics' }, { replace: true, state: location.state });
  };

  // The line stays with the draft it was shown for: Start over begins a new
  // doc (a new id) and hides it for good, and its undo brings both back.
  const continuing =
    entry.continuing && draft.doc.id === entry.draft.doc.id && !isBlankDraft(draft);

  const stepBody = () => {
    switch (step) {
      case 'basics':
        return (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Character name</span>
              <input
                value={doc.name}
                onChange={(e) => update((d) => void (d.name = e.target.value))}
                placeholder="e.g. Thorin"
                className="rounded-lg bg-surface px-3 py-2.5 outline-none placeholder:text-ink-muted"
              />
            </label>
            <fieldset className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Rules version</span>
              {(
                [
                  ['2014', 'Classic (2014 Player’s Handbook and expansions)'],
                  ['2024', 'Revised (2024 Player’s Handbook)'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={doc.rulesVersion === v}
                  onClick={() => void switchRulesVersion(v)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm ${
                    doc.rulesVersion === v
                      ? 'border-accent bg-accent-deep/40 font-semibold'
                      : 'border-surface-2 bg-surface'
                  }`}
                >
                  {label}
                </button>
              ))}
              <p className="text-xs text-ink-muted">
                Playing with a group? Match whichever books your table uses. Starting fresh on your
                own? Either works — 2014 has the most expansion content, 2024 is the newest rules.
              </p>
            </fieldset>
          </div>
        );

      case 'class': {
        const entry = doc.classes[0];
        const unlockLevel = subclassUnlockLevel(classEntity);
        return (
          <div className="flex flex-col gap-4">
            <EntityCardList
              fill
              dedupe
              describe={classBlurb}
              infoType="class"
              entities={classes}
              selectedUid={
                entry !== undefined
                  ? `${entry.ref.name}|${entry.ref.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) => selectClass({ name: nameOf(e), source: sourceOf(e) })}
            />
            {entry !== undefined && (
              <>
                {/* Not a <label>: that handed the steppers' "Level" name to the
                    minus alone (and a tap on the word to it), leaving plus nameless.
                    The value says "Level N" itself, and announces each change. */}
                <div className="flex items-center justify-between rounded-lg bg-surface px-3 py-2.5">
                  <span aria-hidden="true" className="text-sm font-semibold">
                    Level
                  </span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      aria-label="Decrease level"
                      onClick={levelDown}
                      className="h-9 w-9 rounded-full bg-surface-2 text-lg"
                    >
                      <span aria-hidden="true">−</span>
                    </button>
                    <span aria-live="polite" className="w-8 text-center text-lg font-bold">
                      <span className="sr-only">Level</span> {entry.levels}
                    </span>
                    <button
                      type="button"
                      aria-label="Increase level"
                      onClick={() =>
                        update((d) => {
                          const c = d.classes[0];
                          if (c === undefined || c.levels >= 20) return;
                          c.levels += 1;
                          c.hp = [...c.hp, 'avg'];
                        })
                      }
                      className="h-9 w-9 rounded-full bg-surface-2 text-lg"
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                  </span>
                </div>
                {subclasses.length > 0 && entry.levels < unlockLevel && (
                  <p className="rounded-lg bg-surface p-3 text-sm text-ink-muted">
                    Subclass unlocks at level {unlockLevel} — you'll pick one when you get there.
                  </p>
                )}
                {subclasses.length > 0 && entry.levels >= unlockLevel && (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-semibold">Subclass</span>
                    <EntityCardList
                      entities={subclasses}
                      describe={makeSubclassBlurb(registry)}
                      infoType="subclass"
                      infoEntries={makeSubclassEntries(registry)}
                      selectedUid={
                        entry.subclass !== undefined
                          ? `${entry.subclass.name}|${entry.subclass.source}`.toLowerCase()
                          : undefined
                      }
                      onSelect={(e) => setSubclass({ name: nameOf(e), source: sourceOf(e) })}
                      onDeselect={() => setSubclass(undefined)}
                    />
                  </div>
                )}
                {sheet !== null && (
                  <OriginChoices
                    sheet={sheet}
                    doc={doc}
                    update={update}
                    registry={registry}
                    match={(o) =>
                      (o.type === 'class' &&
                        o.uid === `${entry.ref.name}|${entry.ref.source}`.toLowerCase()) ||
                      (o.type === 'subclass' &&
                        entry.subclass !== undefined &&
                        o.uid === `${entry.subclass.name}|${entry.subclass.source}`.toLowerCase())
                    }
                  />
                )}
              </>
            )}
          </div>
        );
      }

      case 'species':
        return (
          <div className="flex flex-col gap-4">
            <EntityCardList
              fill
              dedupe
              describe={raceBlurb}
              infoType="race"
              entities={races}
              selectedUid={
                doc.race !== undefined
                  ? `${doc.race.name}|${doc.race.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) => selectRace({ name: nameOf(e), source: sourceOf(e) })}
            />
            {subraces.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Subrace</span>
                <EntityCardList
                  entities={subraces}
                  describe={raceBlurb}
                  infoType="subrace"
                  selectedUid={
                    doc.subrace !== undefined
                      ? `${doc.subrace.name}|${doc.subrace.source}`.toLowerCase()
                      : undefined
                  }
                  onSelect={(e) => setSubrace({ name: nameOf(e), source: sourceOf(e) })}
                  onDeselect={() => setSubrace(undefined)}
                />
              </div>
            )}
            {sheet !== null && (
              <OriginChoices
                sheet={sheet}
                doc={doc}
                update={update}
                registry={registry}
                match={(o) => o.type === 'race'}
              />
            )}
          </div>
        );

      case 'abilities':
        return (
          <AbilitiesStep
            abilities={doc.abilities}
            finals={sheet?.abilities}
            className={doc.classes[0]?.ref.name}
            onMethod={setMethod}
            onScores={(base) => update((d) => void (d.abilities.base = { ...base }))}
            onReplace={(base, title) =>
              undoable(
                (d) => void (d.doc.abilities.base = { ...base }),
                (before) => ({ title, detail: `was ${scoresText(before.doc)}` }),
                scoresChanged,
              )
            }
          />
        );

      case 'background':
        return (
          <div className="flex flex-col gap-4">
            <EntityCardList
              fill
              dedupe
              describe={backgroundBlurb}
              infoType="background"
              entities={backgrounds}
              selectedUid={
                doc.background !== undefined
                  ? `${doc.background.name}|${doc.background.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) => selectBackground({ name: nameOf(e), source: sourceOf(e) })}
            />
            {sheet !== null && (
              <OriginChoices
                sheet={sheet}
                doc={doc}
                update={update}
                registry={registry}
                match={(o) => o.type === 'background'}
              />
            )}
          </div>
        );

      case 'equipment': {
        const fallback =
          parseStartingEquipment(classEntity).length === 0 ? defaultStrings(classEntity) : [];
        const baseitems = registry.byType('baseitem');
        const itemEntities = registry.byType('item');
        return (
          <div className="flex flex-col gap-4">
            {allEqGroups.length > 0 && (
              <p className="text-sm text-ink-muted">
                Pick one option per row — it's added to your inventory and equipped automatically.
              </p>
            )}
            {allEqGroups.map((g) => {
              const key = `${g.source}:${g.groupIdx}`;
              const current = bundleChoices[key] ?? g.bundles[0]?.key;
              const currentBundle = g.bundles.find((b) => b.key === current);
              return (
                <fieldset key={key} className="flex flex-col gap-1.5 rounded-lg bg-surface p-3">
                  <legend className="sr-only">Equipment option</legend>
                  <span className="text-xs font-semibold uppercase text-ink-muted">
                    {g.source === 'class' ? 'Class equipment' : 'Background equipment'}
                  </span>
                  {g.bundles.map((b) => (
                    <button
                      key={b.key}
                      type="button"
                      aria-pressed={current === b.key}
                      onClick={() => pickBundle(key, b.key)}
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${
                        current === b.key ? 'border-accent bg-accent-deep/30' : 'border-surface-2'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
                  {/* Open slots ("any martial weapon") get a concrete picker. */}
                  {currentBundle?.items.map((item, idx) => {
                    if (item.equipmentType === undefined) return null;
                    const slotKey = `${key}:${idx}`;
                    const options = itemsForEquipmentType(
                      item.equipmentType,
                      baseitems,
                      itemEntities,
                    ).sort((a, b) => String(a.name).localeCompare(String(b.name)));
                    if (options.length === 0) return null;
                    return (
                      <label key={slotKey} className="flex items-center gap-2 text-sm">
                        <span className="shrink-0 text-xs text-ink-muted">
                          {item.label} — pick one:
                        </span>
                        <select
                          value={slotPicks[slotKey] ?? ''}
                          onChange={(e) => pickSlot(slotKey, e.target.value)}
                          className="min-w-0 flex-1 rounded-lg bg-surface-2 px-2 py-1.5 text-sm outline-none"
                        >
                          <option value="" disabled>
                            Choose…
                          </option>
                          {options.map((o) => (
                            <option
                              key={String(o.name)}
                              value={`${String(o.name)}|${String(o.source ?? '')}`.toLowerCase()}
                            >
                              {String(o.name)}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
            {fallback.length > 0 && (
              <div className="rounded-lg bg-surface p-3 text-sm text-ink-muted">
                <p className="mb-1 font-semibold text-ink">
                  Starting equipment (add manually in Inventory):
                </p>
                {fallback.map((s) => (
                  <p key={s}>• {s}</p>
                ))}
              </div>
            )}
            {doc.equipment.length > 0 && (
              <div className="rounded-lg border border-emerald-300/30 bg-surface p-3 text-sm">
                <p className="mb-1 text-xs font-semibold uppercase text-emerald-300">
                  You'll start with
                </p>
                <p className="text-ink-muted">
                  {doc.equipment
                    .map(
                      (i) =>
                        `${i.ref?.name ?? i.custom?.name ?? '?'}${i.qty > 1 ? ` ×${i.qty}` : ''}`,
                    )
                    .join(' · ')}
                </p>
              </div>
            )}
          </div>
        );
      }

      case 'spells':
        return sheet !== null ? (
          <SpellManager doc={doc} sheet={sheet} update={update} allowCasting={false} />
        ) : null;

      case 'choices': {
        // Race, class, and background picks now live on their own steps. This
        // step is the catch-all for anything else a build generates — feat picks
        // (from an ASI) and other origins without their own screen.
        const classUids = new Set(
          doc.classes.map((c) => `${c.ref.name}|${c.ref.source}`.toLowerCase()),
        );
        const subclassUids = new Set(
          doc.classes
            .filter((c) => c.subclass !== undefined)
            .map((c) => `${c.subclass?.name}|${c.subclass?.source}`.toLowerCase()),
        );
        const isOther = (o: EffectOrigin) =>
          o.type !== 'race' &&
          o.type !== 'background' &&
          !(o.type === 'class' && classUids.has(o.uid)) &&
          !(o.type === 'subclass' && subclassUids.has(o.uid));
        const hasOther =
          sheet !== null &&
          (sheet.pending.some(
            (p) => isOther(p.origin) && !(p.kind === 'generic' && p.options.length === 0),
          ) ||
            sheet.resolvedChoices.some((r) => isOther(r.prompt.origin)));
        return (
          <div className="flex flex-col gap-3">
            {!hasOther && (
              <p className="rounded-lg bg-surface p-4 text-sm text-emerald-300">
                Nothing else to decide here — your skills, languages, and other picks live on the
                Class, Species, and Background steps.
              </p>
            )}
            {sheet !== null && (
              <OriginChoices
                sheet={sheet}
                doc={doc}
                update={update}
                registry={registry}
                match={isOther}
              />
            )}
          </div>
        );
      }

      case 'review': {
        const create = async () => {
          // A second tap would start a second unwind, and two queued pops can
          // walk right out of the app.
          if (creating.current) return;
          creating.current = true;
          const final = structuredClone(doc);
          if (final.name.trim() === '') final.name = 'Unnamed hero';
          final.play.currentHp = sheet?.maxHp.value ?? 0;
          setOpening(final.name);
          try {
            await characterRepo.put(final);
          } catch (err) {
            creating.current = false;
            setOpening(null);
            notifyFailure('Create', err);
            return;
          }
          clearDraft();
          // Left while the save was in flight: the character is saved, and
          // the page the player went to is not this flow's to replace.
          if (!live.current.mounted) return;
          await replaceWizardWith(
            navigate,
            wizardDepth(live.current.location.state),
            `/c/${final.id}`,
          );
        };
        // Everything a new player might have missed, each one tap from its fix.
        const issues: Array<{ key: string; text: string; step: Step }> = [];
        if (doc.classes.length === 0) {
          issues.push({ key: 'class', text: 'No class picked yet', step: 'class' });
        }
        const abilityProblem = abilityIssue(doc.abilities);
        if (abilityProblem !== undefined) {
          issues.push({ key: 'abilities', text: abilityProblem, step: 'abilities' });
        }
        if (allEqGroups.length > 0 && doc.equipment.length === 0) {
          issues.push({ key: 'equipment', text: 'No starting equipment', step: 'equipment' });
        }
        if (
          doc.classes.length > 0 &&
          sheet !== null &&
          !sheet.attacks.some((a) => a.label !== 'Unarmed Strike')
        ) {
          issues.push({
            key: 'weapon',
            text: 'No weapon — only Unarmed Strike',
            step: 'equipment',
          });
        }
        if (sheet !== null && sheet.pending.length > 0) {
          issues.push({
            key: 'choices',
            text: `${sheet.pending.length} choice${sheet.pending.length > 1 ? 's' : ''} still pending`,
            step: 'choices',
          });
        }
        const profSkills = Object.entries(sheet?.skills ?? {})
          .filter(([, s]) => s.prof > 0)
          .map(([name]) => name);
        return (
          <div className="flex flex-col gap-4">
            <label className="flex flex-col gap-1">
              <span className="text-sm font-semibold">Name</span>
              <input
                value={doc.name}
                onChange={(e) => update((d) => void (d.name = e.target.value))}
                placeholder="Give your hero a name"
                className={`rounded-lg bg-surface px-3 py-2.5 outline-none placeholder:text-ink-muted ${
                  doc.name.trim() === '' ? 'border border-amber-300/50' : ''
                }`}
              />
            </label>

            {/* Who you built */}
            <div className="rounded-lg bg-surface p-3 text-sm">
              <p className="font-semibold">
                {doc.subrace?.name ?? doc.race?.name ?? 'No species'} ·{' '}
                {doc.classes
                  .map(
                    (c) =>
                      `${c.ref.name} ${c.levels}${c.subclass !== undefined ? ` (${c.subclass.name})` : ''}`,
                  )
                  .join(' / ') || 'no class'}
                {doc.background !== undefined ? ` · ${doc.background.name}` : ''}
              </p>
              <div className="mt-2 flex flex-col gap-1 text-xs text-ink-muted">
                {profSkills.length > 0 && <p>Skills: {profSkills.join(', ')}</p>}
                {(sheet?.languages.length ?? 0) > 0 && (
                  <p>Languages: {sheet?.languages.join(', ')}</p>
                )}
                {(sheet?.resists.length ?? 0) > 0 && (
                  <p>
                    Resistances: {[...new Set(sheet?.resists.map((r) => r.damageType))].join(', ')}
                  </p>
                )}
                {doc.equipment.length > 0 && (
                  <p>
                    Gear:{' '}
                    {doc.equipment.map((i) => i.ref?.name ?? i.custom?.name ?? '?').join(', ')}
                  </p>
                )}
              </div>
            </div>

            {sheet !== null && (
              <div className="grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    ['HP', sheet.maxHp.value],
                    ['AC', sheet.ac.value],
                    [
                      'Initiative',
                      `${sheet.initiative.value >= 0 ? '+' : ''}${sheet.initiative.value}`,
                    ],
                    ['Prof', `+${sheet.profBonus.value}`],
                    ['Speed', `${sheet.speedWalk.value} ft`],
                    ['Passive Per.', sheet.passivePerception.value],
                  ] as const
                ).map(([label, v]) => (
                  <div key={label} className="rounded-lg bg-surface p-3">
                    <div className="text-lg font-bold">{v}</div>
                    <div className="text-xs text-ink-muted">{label}</div>
                  </div>
                ))}
              </div>
            )}

            {issues.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {issues.map((issue) => (
                  <button
                    key={issue.key}
                    type="button"
                    onClick={() => navStep(issue.step)}
                    className="flex items-center justify-between gap-2 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2.5 text-left text-sm text-amber-200"
                  >
                    <span>{issue.text}</span>
                    <span className="shrink-0 font-semibold">Fix →</span>
                  </button>
                ))}
              </div>
            )}

            {sheet !== null && sheet.warnings.length > 0 && (
              <details className="rounded-lg bg-surface p-3 text-xs text-ink-muted">
                <summary className="cursor-pointer text-sm">
                  {sheet.warnings.length} note
                  {sheet.warnings.length > 1 ? 's' : ''}
                </summary>
                {sheet.warnings.map((w) => (
                  <p key={w} className="mt-1">
                    • {w}
                  </p>
                ))}
              </details>
            )}
            <button
              type="button"
              onClick={() => void create()}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent-fill px-4 py-3 font-semibold text-white"
            >
              <Check size={18} /> Create character
              {issues.length > 0 ? ' anyway' : ''}
            </button>
          </div>
        );
      }
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4">
      {header}

      {continuing && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface px-3 py-2 text-sm text-ink-muted">
          <History size={16} aria-hidden className="shrink-0" />
          <span>
            Continuing your unfinished character,{' '}
            <strong className="text-ink">{draftSummary(doc)}</strong>
          </span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={startOver}
            className="font-semibold text-ink underline underline-offset-2"
          >
            Start over
          </button>
        </p>
      )}

      {/* Live summary bar — the "like a game" feedback loop */}
      {sheet !== null && doc.classes.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
          <span>
            HP <strong className="text-ink">{sheet.maxHp.value}</strong>
          </span>
          <span>
            AC <strong className="text-ink">{sheet.ac.value}</strong>
          </span>
          <span>
            Init{' '}
            <strong className="text-ink">
              {sheet.initiative.value >= 0 ? '+' : ''}
              {sheet.initiative.value}
            </strong>
          </span>
          {sheet.pending.length > 0 && (
            <button
              type="button"
              onClick={() => navStep('choices')}
              className="text-amber-300 underline decoration-dotted underline-offset-2"
              aria-label={`${sheet.pending.length} pending ${sheet.pending.length === 1 ? 'decision' : 'decisions'}: go to the Choices step`}
              title="Decisions like skills and languages are waiting on the Choices step"
            >
              {sheet.pending.length} pending <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      )}

      {stepBody()}

      {/* Room for the fixed block below, measured so a long undo line fits. */}
      <div aria-hidden="true" className="shrink-0" style={{ height: bottomHeight }} />

      {/* The undo line rides on top of the step navigation, in the same fixed
          block, so the bar never covers it and it stays in reach while the
          step scrolls. */}
      <div ref={setBottomBlock} className="fixed inset-x-0 bottom-0 flex flex-col">
        <div className={undoShown ? 'mx-auto w-full max-w-5xl px-3 pb-2' : undefined}>
          <UndoBar
            pending={undo.pending}
            undone={undo.undone}
            onUndo={() => void undo.run()}
            focusRequest={undoFocus}
          />
        </div>
        {/* Step navigation */}
        <nav className="flex gap-2 border-t border-surface-2 bg-surface p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
          <button
            type="button"
            disabled={stepIdx === 0}
            onClick={() => {
              const prev = STEPS[stepIdx - 1];
              if (prev !== undefined) navStep(prev);
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            <ArrowLeft size={16} /> Back
          </button>
          {stepIdx < STEPS.length - 1 && (
            <button
              type="button"
              onClick={() => {
                const next = STEPS[stepIdx + 1];
                if (next !== undefined) navStep(next);
              }}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent-fill px-4 py-2.5 text-sm font-semibold text-white"
            >
              Next <ArrowRight size={16} />
            </button>
          )}
        </nav>
      </div>
    </main>
  );
}
