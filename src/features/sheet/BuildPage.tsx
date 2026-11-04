import { Check, ChevronRight, ChevronUp, Dices, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useOutletContext } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { describeSwitch, editionFitChip } from '@/data5e/editionCompat';
import { useRegistry, useTypePacks } from '@/data5e/hooks';
import { filterByRulesVersion, type RulesVersion } from '@/data5e/rulesVersion';
import { subclassOptions } from '@/data5e/subclassOptions';
import { subraceOptions } from '@/data5e/subraceOptions';
import { roll } from '@/dice/roll';
import {
  meetsMulticlassRequirements,
  multiclassRequirementText,
  subclassUnlockLevel,
} from '@/engine/multiclass';
import {
  ABILITIES,
  type CharacterDoc,
  type ClassLevelEntry,
  type DerivedSheet,
  type EffectOrigin,
  refUid,
  SKILLS,
} from '@/engine/types';
import { listsPick, OriginChoices } from '@/features/creator/OriginChoices';
import {
  classBlurb,
  makeBackgroundBlurb,
  makeSubclassBlurb,
  makeSubclassEntries,
  raceBlurb,
} from '@/features/creator/pickerHints';
import { classRemovalParts, listJoin, picksCleared } from '@/lib/describeRemoval';
import { scrollBehavior } from '@/lib/motion';
import { pruneChoicesFor, pruneClass, pruneOrigin } from '@/lib/pruneChoices';
import { signed } from '@/lib/signed';
import { useStickyHeight } from '@/lib/useStickyHeight';
import { captureUpdate, sameForUndo, type UndoNotice, useUndoOffer } from '@/lib/useUndoOffer';
import { rollLogStore } from '@/stores/rollLog';
import { badgeClass } from '@/ui/Badge';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { Button } from '@/ui/Button';
import { askConfirm } from '@/ui/dialogs';
import { EntityCardList } from '@/ui/EntityCardList';
import { PackProblem } from '@/ui/PackProblem';
import { ProfDot } from '@/ui/ProfDot';
import { ProfPicker } from '@/ui/ProfPicker';
import { TextField } from '@/ui/TextField';
import { UndoBar } from '@/ui/UndoBar';
import { CharacterSourcesSection } from './CharacterSourcesSection';
import {
  cueKey,
  type EditionCue,
  type EditionSlot,
  type EntityLookup,
  editionCueNotes,
  editionCues,
  editionSwitchPreview,
  registryLookup,
} from './editionCues';
import { SpellInfoSheet } from './SpellInfoSheet';
import type { CharacterSheetState } from './useCharacterSheet';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');

/**
 * Identity for a picker, so that answering it closes it.
 *
 * The picker is a `<details>` that starts open while the field is empty, the
 * way the class and subclass ones do. Native `open` is the reader's to change
 * after that, and React will not take it back, so a picker reopened to swap a
 * species would stay open over the choices that swap just rewrote. Keying on
 * the current pick remounts the element when the answer changes, which lets
 * `open` be read fresh: shut, now that there is an answer.
 */
const pickerKey = (ref: { name: string; source: string } | undefined) =>
  ref === undefined ? 'none' : `${ref.name}|${ref.source}`;

/**
 * A segmented control's track and segments (DS-001), for a choice of modes
 * that keeps its `fieldset` and the legend naming it. The pressed segment is
 * an `ink` pill, as `SegmentedControl` draws its own.
 */
const SEGMENTS = 'flex flex-wrap gap-0.5 rounded-control bg-surface-raised p-0.75';
const SEGMENT =
  'min-h-9.5 flex-1 rounded-lg px-3 text-label text-ink-muted transition-colors duration-120 not-aria-pressed:hover:text-ink aria-pressed:bg-ink aria-pressed:text-bg';

/** A list of rows inside a section: hairline-divided, each row pads itself. */
const ROWS =
  'flex flex-col divide-y divide-line overflow-hidden rounded-control ring-1 ring-line ring-inset';

/** A small group label inside a section (SAVING THROWS). */
const OVERLINE = 'text-overline text-ink-muted uppercase';

/**
 * The ability score cells: two across on a phone, three from `sm` and six from
 * `lg` once that many 7.75rem cells fit (a 44px − and + either side of the
 * score), but never a cell narrower than 5.75rem, which holds the − and + side
 * by side. All in rem, with the wrapper as the query container, so with large
 * text the grid drops to fewer columns instead of the steppers running out of
 * their cells and the page (A11Y-003).
 */
const SCORES =
  'grid grid-cols-[repeat(auto-fit,minmax(max(5.75rem,(100%_-_0.5rem)/2),1fr))] gap-2 sm:@min-[24.25rem]:grid-cols-3 lg:@min-[49rem]:grid-cols-6';
/**
 * A cell's −, score and +: in a row, or where the cell is under 7.5rem, the
 * score above the two buttons. DOM order stays −, score, +.
 */
const SCORE_STEPPER =
  'grid grid-cols-2 justify-items-center gap-1 @min-[7.5rem]:flex @min-[7.5rem]:items-center';

// ---------------------------------------------------------------------------
// "What changed" diff — the build-explorer feedback loop
// ---------------------------------------------------------------------------

type Snapshot = Record<string, number>;

function snapshot(sheet: DerivedSheet): Snapshot {
  const s: Snapshot = {
    HP: sheet.maxHp.value,
    AC: sheet.ac.value,
    Initiative: sheet.initiative.value,
    Speed: sheet.speedWalk.value,
    'Prof bonus': sheet.profBonus.value,
    'Passive Perc.': sheet.passivePerception.value,
  };
  for (const a of ABILITIES) s[a.toUpperCase()] = sheet.abilities[a].mod;
  const dc = sheet.spellcasting[0];
  if (dc !== undefined) s['Spell DC'] = dc.saveDc.value;
  return s;
}

function diffSnapshots(
  prev: Snapshot,
  next: Snapshot,
): Array<{ label: string; from: number; to: number }> {
  const out: Array<{ label: string; from: number; to: number }> = [];
  for (const [label, to] of Object.entries(next)) {
    const from = prev[label];
    if (from !== undefined && from !== to) out.push({ label, from, to });
  }
  for (const [label, from] of Object.entries(prev)) {
    if (!(label in next)) out.push({ label, from, to: 0 });
  }
  return out;
}

function ChangeBar({ sheet }: { sheet: DerivedSheet }) {
  const prev = useRef<Snapshot | null>(null);
  const [diff, setDiff] = useState<Array<{ label: string; from: number; to: number }>>([]);

  useEffect(() => {
    const next = snapshot(sheet);
    if (prev.current !== null) {
      const d = diffSnapshots(prev.current, next);
      if (d.length > 0) setDiff(d);
    }
    prev.current = next;
  }, [sheet]);

  if (diff.length === 0) {
    return (
      <div className="rounded-control bg-surface/95 px-3 py-2 text-caption text-ink-muted shadow-card ring-1 ring-line ring-inset backdrop-blur">
        Change anything below: the effects on your stats show up here instantly.
      </div>
    );
  }
  // What just changed is guidance, so the guide's tint; a stat that rose is
  // healing's green, one that fell damage's red, and the numbers say which.
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-control bg-guide-soft py-1.5 pr-1.5 pl-3">
      {diff.map((d) => (
        <span
          key={d.label}
          className="rounded-full bg-surface px-2 py-0.5 text-caption tabular-nums"
        >
          {d.label} <span className="text-ink-muted">{d.from}</span>
          <span className={d.to > d.from ? 'text-heal' : 'text-danger'}> → {d.to}</span>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setDiff([])}
        className="ml-auto flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface hover:text-ink"
        aria-label="Dismiss stat changes"
        title="Dismiss"
      >
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

const scoresText = (d: CharacterDoc) => ABILITIES.map((a) => d.abilities.base[a]).join('/');

// ---------------------------------------------------------------------------

/**
 * How one identity pick sits with the character's rules version (GAME-003). The
 * source badge beside it already says which book it came from; this says what
 * that means here, which is the part filtering alone never answered.
 */
function EditionChip({ cue, version }: { cue: EditionCue | undefined; version: RulesVersion }) {
  const chip = cue === undefined ? undefined : editionFitChip(cue.fit, version);
  if (chip === undefined) return null;
  return (
    <span title={chip.title} className={`shrink-0 ${badgeClass('guide')}`}>
      {chip.text}
    </span>
  );
}

function Section({
  title,
  summary,
  children,
  defaultOpen = false,
  id,
}: {
  title: string;
  summary?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  id?: string;
}) {
  return (
    <details
      id={id}
      open={defaultOpen}
      className="group scroll-mt-4 rounded-card bg-surface shadow-card ring-1 ring-line ring-inset"
    >
      {/* Wraps so a long summary (six ability scores, no spaces) moves
          under the title at large text instead of widening the page, and
          breaks where even its own line is too narrow. */}
      <summary className="flex min-h-tap cursor-pointer flex-wrap items-center justify-between gap-x-2 px-4 py-2.5">
        <span className="text-heading">{title}</span>
        <span className="flex min-w-0 items-center gap-2 text-caption text-ink-muted wrap-anywhere">
          {summary}
          <ChevronUp size={16} aria-hidden className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-line border-t p-4">{children}</div>
    </details>
  );
}

export function Component() {
  const { sheet, doc, update, restore } = useOutletContext<CharacterSheetState>();
  const registry = useRegistry(['essentials']);
  const undo = useUndoOffer({ current: doc, same: sameForUndo, restore });
  // Under the sheet header, so the scroll padding counts it too (A11Y-003).
  const bar = useStickyHeight('--sheet-bar-h');
  // Tap-to-swap for ability scores (tap one value, then another).
  const [swapFrom, setSwapFrom] = useState<(typeof ABILITIES)[number] | null>(null);

  // Everything below picks from the class files; a download that cannot
  // happen says so beside the list it leaves empty.
  const classPacks = useTypePacks('class');

  if (sheet === null || doc === null || registry === null) {
    return <p className="text-body text-ink-muted">Loading…</p>;
  }

  // Prompts the player can see now, so "N picks cleared" counts only those.
  const activeChoices = new Set(sheet.resolvedChoices.map((r) => r.prompt.id));
  const classes = filterByRulesVersion([...registry.byType('class')], doc.rulesVersion);
  const subclassesFor = (entry: ClassLevelEntry) =>
    subclassOptions(registry.byType('subclass'), entry.ref, doc.rulesVersion, entry.subclass);
  const subclassBlurb = makeSubclassBlurb(registry);
  const subclassEntries = makeSubclassEntries(registry);
  const races = filterByRulesVersion([...registry.byType('race')], doc.rulesVersion);
  const subraces =
    doc.race !== undefined ? subraceOptions(registry.byType('subrace'), doc.race, doc.subrace) : [];
  const backgrounds = filterByRulesVersion([...registry.byType('background')], doc.rulesVersion);

  // Edition standing of the identity picks, against the version this character
  // is on now. Keyed by slot + ref so a chip beside a pick finds its own cue.
  const lookup: EntityLookup = registryLookup(registry);
  const cues = editionCues(doc, doc.rulesVersion, lookup);
  const cueFor = (slot: EditionSlot, ref: { name: string; source: string } | undefined) =>
    ref === undefined ? undefined : cues.find((c) => c.key === cueKey(slot, ref));
  const cueNotes = editionCueNotes(cues, doc.rulesVersion);

  /**
   * Switch rules version, but say first what it does to this character.
   * Re-deriving under the other edition changes what every pick means, and the
   * change was one unguarded tap with a legend promising warnings that did not
   * exist. Nothing is ever removed, which is the reassurance the preview leads
   * with; the cues afterwards carry the detail.
   */
  const switchRulesVersion = async (v: RulesVersion) => {
    if (doc.rulesVersion === v) return;
    const { summary, unchanged } = describeSwitch(editionSwitchPreview(doc, v, lookup), v);
    // Nothing to warn about means nothing to confirm: an empty character, or one
    // whose every pick already suits the target, would otherwise pay a modal to
    // be told the switch changes nothing for it.
    if (!unchanged) {
      const ok = await askConfirm({
        title: `Switch to ${v} rules?`,
        detail: summary,
        confirmLabel: `Switch to ${v}`,
      });
      if (!ok) return;
    }
    update((d) => void (d.rulesVersion = v));
  };

  const hdFacesOf = (ref: { name: string; source: string }): number => {
    const cls = registry.get('class', ref.name, ref.source);
    const faces = (cls?.hd as { faces?: number } | undefined)?.faces;
    return typeof faces === 'number' ? faces : 8;
  };

  const subclassLevelOf = (ref: { name: string; source: string }): number =>
    subclassUnlockLevel(registry.get('class', ref.name, ref.source));
  const hpMethod = doc.hpMethod ?? 'average';
  const totalLevels = doc.classes.reduce((s, c) => s + c.levels, 0);
  const finalScores = Object.fromEntries(
    ABILITIES.map((a) => [a, sheet.abilities[a].value]),
  ) as Record<(typeof ABILITIES)[number], number>;

  const levelUpClass = (idx: number) => {
    update((d) => {
      const c = d.classes[idx];
      if (c === undefined || totalLevels >= 20) return;
      c.levels += 1;
      if ((d.hpMethod ?? 'average') === 'rolled') {
        const faces = hdFacesOf(c.ref);
        // Hit points gained, so a heal (DS-001), not the damage red.
        const r = roll(`1d${faces}`, {
          label: `${c.ref.name} level ${c.levels} hit points (d${faces})`,
          kind: 'heal',
        });
        rollLogStore.getState().append(r);
        c.hp = [...c.hp, r.total];
      } else {
        c.hp = [...c.hp, 'avg'];
      }
    });
  };

  /**
   * Make a change that takes something away, then offer to put it back
   * (UX-004). The recipe runs once; `describe` gets the doc on either side of
   * it. A change that changed nothing offers nothing.
   *
   * Equipment is never part of it: after creation the inventory is the
   * player's, not tied to the species, background or class that once supplied
   * it, so an identity change leaves it alone. Removing items here would be its
   * own silent loss.
   */
  const undoable = (
    recipe: (d: CharacterDoc) => void,
    describe: (before: CharacterDoc, after: CharacterDoc) => UndoNotice,
    label?: string,
  ) => {
    const change = captureUpdate<CharacterDoc>((r) => update(r, label), recipe);
    if (change === undefined || sameForUndo(change.before, change.after)) return;
    const { title, detail } = describe(change.before, change.after);
    undo.offer(change.before, change.after, title, detail);
  };

  /**
   * Removing a class asks first, whichever class it is: it takes the class's
   * picks, its subclass and its spell list with it. A level-1 class that was not
   * the only one used to go on one tap, with its subclass picks and spells
   * left behind.
   */
  const removeClass = async (entry: ClassLevelEntry) => {
    const name = entry.ref.name;
    const parts = classRemovalParts(doc, entry, activeChoices);
    const clears = parts.length > 0 ? `Clears ${listJoin(parts)}.` : 'Nothing else is tied to it.';
    const ok = await askConfirm({
      title: `Remove ${name}?`,
      detail: `${clears} You can undo this right after.${doc.classes.length === 1 ? ' Then pick a new class.' : ''}`,
      confirmLabel: 'Remove class',
      danger: true,
    });
    if (!ok) return;
    const uid = refUid(entry.ref);
    undoable(
      (d) => {
        const i = d.classes.findIndex((c) => refUid(c.ref) === uid);
        const c = d.classes[i];
        if (c === undefined) return;
        d.classes.splice(i, 1);
        pruneClass(d, c);
      },
      () => ({
        title: `Removed ${name}`,
        detail: parts.length > 0 ? `${listJoin(parts)} cleared` : undefined,
      }),
      `Removed ${name}`,
    );
  };

  /** One level off a class. Its rolled HP for that level goes, so it can come back. */
  const levelDownClass = (idx: number) => {
    undoable(
      (d) => {
        const c = d.classes[idx];
        if (c === undefined || c.levels <= 1) return;
        c.levels -= 1;
        c.hp = c.hp.slice(0, c.levels);
      },
      (before) => {
        // From the snapshot the recipe ran on, not the render that scheduled it.
        const c = before.classes[idx];
        const lost = c?.hp[c.levels - 1];
        return {
          title: `${c?.ref.name ?? 'Class'} level ${c?.levels ?? 0} → ${(c?.levels ?? 1) - 1}`,
          detail: typeof lost === 'number' ? `rolled ${lost} HP for that level cleared` : undefined,
        };
      },
    );
  };

  /** Swap or clear a class's subclass; the old one's picks go with it. */
  const setSubclass = (idx: number, next: { name: string; source: string } | undefined) => {
    const removed: string[] = [];
    undoable(
      (d) => {
        const c = d.classes[idx];
        if (c === undefined) return;
        if (c.subclass !== undefined) removed.push(...pruneChoicesFor(d, 'subclass', c.subclass));
        c.subclass = next;
      },
      (before) => {
        const c = before.classes[idx];
        return {
          title: `${c?.ref.name ?? 'Class'} subclass: ${c?.subclass?.name ?? 'none'} → ${next?.name ?? 'none'}`,
          detail: picksCleared(before, removed, c?.subclass?.name, activeChoices),
        };
      },
    );
  };

  /** Swap or clear the subrace; the old one's picks go with it. */
  const setSubrace = (next: { name: string; source: string } | undefined) => {
    const removed: string[] = [];
    undoable(
      (d) => {
        if (d.subrace !== undefined) removed.push(...pruneOrigin(d, 'subrace', d.subrace));
        d.subrace = next;
      },
      (before) => ({
        title: `Subrace: ${before.subrace?.name ?? 'none'} → ${next?.name ?? 'none'}`,
        detail: picksCleared(before, removed, before.subrace?.name, activeChoices),
      }),
    );
  };

  const openChoices = () => {
    // Choices live inline under their origin now — jump to the first unmade one,
    // expanding whatever collapsed sections/details contain it.
    const el = document.querySelector('[data-pending-choice]');
    for (
      let node = el?.parentElement;
      node !== null && node !== undefined;
      node = node.parentElement
    ) {
      if (node instanceof HTMLDetailsElement) node.open = true;
    }
    el?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
  };

  return (
    <div className="flex flex-col gap-3">
      <div ref={bar} className="sticky top-(--sheet-header-h,0px) z-10 flex flex-col gap-1.5">
        <ChangeBar sheet={sheet} />
        <UndoBar pending={undo.pending} undone={undo.undone} onUndo={() => void undo.run()} />
      </div>

      {sheet.pending.length > 0 && (
        <button
          type="button"
          onClick={openChoices}
          className="flex min-h-tap flex-wrap items-center justify-between gap-x-2 rounded-control bg-guide-soft px-3 py-2.5 text-left text-sm transition-colors duration-120 hover:brightness-108"
        >
          {/* The summary keeps at least 6rem beside Resolve, which otherwise
              goes under it, still at the right (large text). */}
          <span className="min-w-0 grow basis-24">
            <strong>{sheet.pending.length}</strong> decision
            {sheet.pending.length > 1 ? 's' : ''} to make: skills, feats, languages…
          </span>
          <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-bold text-guide">
            Resolve <ChevronRight size={16} aria-hidden="true" />
          </span>
        </button>
      )}

      <Section title="Identity" summary={`${doc.rulesVersion} rules`} defaultOpen>
        <TextField
          label="Name"
          value={doc.name}
          onChange={(e) => update((d) => void (d.name = e.target.value))}
        />
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-caption text-ink-muted">
            Rules version: switching re-derives everything and keeps every pick. You get a preview
            of what changes first.
          </legend>
          <div className={SEGMENTS}>
            {(['2014', '2024'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={doc.rulesVersion === v}
                onClick={() => void switchRulesVersion(v)}
                className={SEGMENT}
              >
                {v}
              </button>
            ))}
          </div>
        </fieldset>
        {cueNotes.length > 0 && (
          <div className="flex flex-col gap-1 rounded-control p-3 ring-1 ring-line ring-inset">
            <span className="text-label text-ink-muted">Mixed editions ({cueNotes.length})</span>
            {cueNotes.map(({ key, note }) => (
              <p key={key} className="text-caption text-ink-muted">
                {note}
              </p>
            ))}
          </div>
        )}
      </Section>

      <CharacterSourcesSection doc={doc} sheet={sheet} update={update} />

      <Section
        title="Classes"
        summary={doc.classes.map((c) => `${c.ref.name} ${c.levels}`).join(' / ') || 'none'}
        defaultOpen
      >
        {/* A fieldset's default min-width is min-content, which at large
            text sizes holds it wider than the screen; min-w-0 lets it and
            its legend wrap, and the choices wrap rather than overflow. */}
        <fieldset className="flex min-w-0 flex-col gap-1.5">
          <legend className="mb-1.5 text-caption text-ink-muted">
            HP per level (level 1 of your first class is always the full die)
          </legend>
          <div className={SEGMENTS}>
            {(
              [
                ['average', 'Average'],
                ['rolled', 'Rolled'],
                ['max', 'Max'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                aria-pressed={hpMethod === m}
                onClick={() => update((d) => void (d.hpMethod = m))}
                className={SEGMENT}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        {doc.classes.map((entry, idx) => {
          const faces = hdFacesOf(entry.ref);
          const clsEntity = registry.get('class', entry.ref.name, entry.ref.source);
          const reqText = multiclassRequirementText(clsEntity);
          const reqMet = meetsMulticlassRequirements(clsEntity, finalScores);
          const subclasses = subclassesFor(entry);
          return (
            <div
              key={`${entry.ref.name}|${entry.ref.source}`}
              className="flex flex-col gap-2 rounded-control p-3 ring-1 ring-line ring-inset"
            >
              {/* The level controls wrap under the name where both do not fit. */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-1.5 text-body-strong">
                  <span>
                    {entry.ref.name} {entry.levels}
                    <span className="ml-1.5 font-normal text-caption text-ink-muted">d{faces}</span>
                  </span>
                  <EditionChip cue={cueFor('class', entry.ref)} version={doc.rulesVersion} />
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (entry.levels <= 1) void removeClass(entry);
                      else levelDownClass(idx);
                    }}
                    className="tap rounded-full bg-surface-raised text-lg transition-colors hover:bg-surface-hover"
                    aria-label={
                      entry.levels <= 1
                        ? `Remove ${entry.ref.name}`
                        : `Remove a ${entry.ref.name} level`
                    }
                    title={entry.levels <= 1 ? 'Remove this class' : 'Remove a level'}
                  >
                    <span aria-hidden="true">−</span>
                  </button>
                  {/* The class's own action, so an outline (DS-001). */}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => levelUpClass(idx)}
                    disabled={totalLevels >= 20}
                  >
                    Level up
                  </Button>
                </div>
              </div>

              {doc.classes.length > 1 && reqText !== undefined && (
                <p className={`text-caption ${reqMet ? 'text-ink-muted' : 'text-guide'}`}>
                  Multiclass requirement: {reqText}
                  {reqMet ? (
                    <Check size={14} aria-label="met" className="ml-1 inline align-[-2px]" />
                  ) : (
                    ', not met (allowed anyway, ask your DM)'
                  )}
                </p>
              )}

              {hpMethod === 'rolled' && (
                <div className="flex flex-wrap gap-1.5">
                  {entry.hp.map((v, i) =>
                    idx === 0 && i === 0 ? (
                      <span
                        key="hp-l1"
                        className="rounded-chip bg-surface-raised px-2 py-1 text-xs text-ink-muted tabular-nums"
                        title="Level 1 is always the maximum"
                      >
                        L1: {faces}
                      </span>
                    ) : (
                      <span
                        key={`hp-l${String(i + 1)}`}
                        className="flex items-center gap-1 rounded-chip bg-surface-raised px-1.5 py-1 text-xs tabular-nums"
                      >
                        L{i + 1}:
                        <input
                          inputMode="numeric"
                          value={typeof v === 'number' ? v : ''}
                          aria-label={`${entry.ref.name} level ${i + 1} hit points`}
                          placeholder="?"
                          onChange={(e) => {
                            const n = Number.parseInt(e.target.value, 10);
                            update((d) => {
                              const c = d.classes[idx];
                              if (c !== undefined) c.hp[i] = Number.isNaN(n) ? 'avg' : n;
                            });
                          }}
                          className="w-8 bg-transparent text-center outline-none"
                        />
                        <button
                          type="button"
                          aria-label={`Roll ${entry.ref.name} level ${i + 1} hit points (d${faces})`}
                          title={`Roll 1d${faces}`}
                          onClick={() => {
                            const r = roll(`1d${faces}`, {
                              label: `${entry.ref.name} level ${i + 1} hit points (d${faces})`,
                              kind: 'heal',
                            });
                            rollLogStore.getState().append(r);
                            update((d) => {
                              const c = d.classes[idx];
                              if (c !== undefined) c.hp[i] = r.total;
                            });
                          }}
                          className="text-ink-muted hover:text-ink"
                        >
                          <Dices size={14} />
                        </button>
                      </span>
                    ),
                  )}
                </div>
              )}

              {subclasses.length > 0 &&
              entry.subclass === undefined &&
              entry.levels < subclassLevelOf(entry.ref) ? (
                <p className="text-xs text-ink-muted">
                  Subclass unlocks at level {subclassLevelOf(entry.ref)}.
                </p>
              ) : subclasses.length > 0 ? (
                <details open={entry.subclass === undefined}>
                  <summary className="cursor-pointer py-1 text-caption text-ink-muted">
                    Subclass: {entry.subclass?.name ?? 'none picked'}{' '}
                    <EditionChip
                      cue={cueFor('subclass', entry.subclass)}
                      version={doc.rulesVersion}
                    />
                  </summary>
                  <div className="pt-2">
                    <EntityCardList
                      sources={doc.allowedSources}
                      entities={subclasses}
                      describe={subclassBlurb}
                      infoType="subclass"
                      infoEntries={subclassEntries}
                      selectedUid={
                        entry.subclass !== undefined
                          ? `${entry.subclass.name}|${entry.subclass.source}`.toLowerCase()
                          : undefined
                      }
                      onSelect={(e) => setSubclass(idx, { name: nameOf(e), source: sourceOf(e) })}
                      onDeselect={() => setSubclass(idx, undefined)}
                    />
                  </div>
                </details>
              ) : null}
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
            </div>
          );
        })}

        <details open={doc.classes.length === 0}>
          <summary
            className={`cursor-pointer py-1 text-caption ${
              doc.classes.length === 0 ? 'font-semibold text-guide' : 'text-ink-muted'
            }`}
          >
            {doc.classes.length === 0 ? 'Pick a class to start' : 'Add a class (multiclass)'}
          </summary>
          <div className="flex flex-col gap-2 pt-2">
            <PackProblem packs={classPacks} what="the class list" />
            <EntityCardList
              sources={doc.allowedSources}
              curated
              describe={classBlurb}
              infoType="class"
              entities={classes.filter(
                (e) =>
                  !doc.classes.some(
                    (c) =>
                      c.ref.name.toLowerCase() === nameOf(e).toLowerCase() &&
                      c.ref.source.toLowerCase() === sourceOf(e).toLowerCase(),
                  ),
              )}
              onSelect={(e) =>
                update((d) => {
                  d.classes.push({
                    ref: { name: nameOf(e), source: sourceOf(e) },
                    levels: 1,
                    hp: ['avg'],
                  });
                })
              }
            />
          </div>
        </details>
      </Section>

      <Section title="Species / Race" summary={doc.subrace?.name ?? doc.race?.name ?? 'none'}>
        <details key={pickerKey(doc.race)} open={doc.race === undefined}>
          <summary
            className={`cursor-pointer py-1 text-caption ${
              doc.race === undefined ? 'font-semibold text-guide' : 'text-ink-muted'
            }`}
          >
            {doc.race === undefined ? 'Pick a species to start' : 'Change species'}{' '}
            <EditionChip cue={cueFor('race', doc.race)} version={doc.rulesVersion} />
          </summary>
          <div className="pt-2">
            <EntityCardList
              sources={doc.allowedSources}
              curated
              describe={raceBlurb}
              infoType="race"
              entities={races}
              selectedUid={
                doc.race !== undefined
                  ? `${doc.race.name}|${doc.race.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) => {
                const removed: string[] = [];
                undoable(
                  (d) => {
                    if (d.race !== undefined) removed.push(...pruneOrigin(d, 'race', d.race));
                    if (d.subrace !== undefined) {
                      removed.push(...pruneOrigin(d, 'subrace', d.subrace));
                    }
                    d.race = { name: nameOf(e), source: sourceOf(e) };
                    d.subrace = undefined;
                  },
                  (before, after) => ({
                    title: `Species: ${before.race?.name ?? 'none'} → ${after.race?.name ?? 'none'}`,
                    detail: picksCleared(
                      before,
                      removed,
                      before.subrace === undefined ? before.race?.name : undefined,
                      activeChoices,
                    ),
                  }),
                );
              }}
            />
          </div>
        </details>
        {subraces.length > 0 && (
          <details key={pickerKey(doc.subrace)} open={doc.subrace === undefined}>
            <summary className="cursor-pointer py-1 text-caption text-ink-muted">
              Subrace: {doc.subrace?.name ?? 'none picked'}{' '}
              <EditionChip cue={cueFor('subrace', doc.subrace)} version={doc.rulesVersion} />
            </summary>
            <div className="pt-2">
              <EntityCardList
                sources={doc.allowedSources}
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
          </details>
        )}
        <OriginChoices
          sheet={sheet}
          doc={doc}
          update={update}
          registry={registry}
          match={(o) => o.type === 'race'}
        />
      </Section>

      <Section title="Abilities" summary={ABILITIES.map((a) => doc.abilities.base[a]).join('/')}>
        <div className="-ml-1 flex flex-wrap items-center gap-1">
          <Button
            size="sm"
            onClick={() =>
              undoable(
                (d) => {
                  const arr = [15, 14, 13, 12, 10, 8];
                  ABILITIES.forEach((a, i) => {
                    d.abilities.base[a] = arr[i] ?? 10;
                  });
                },
                (before) => ({
                  title: 'Applied standard array',
                  detail: `was ${scoresText(before)}`,
                }),
                'Applied standard array',
              )
            }
          >
            Standard array
          </Button>
          <Button
            size="sm"
            onClick={() => {
              const scores = ABILITIES.map(() => {
                const dice = [1, 2, 3, 4].map(() => roll('1d6').total);
                dice.sort((x, y) => x - y);
                // 4d6 drop lowest
                return dice.slice(1).reduce((s, v) => s + v, 0);
              });
              undoable(
                (d) => {
                  ABILITIES.forEach((a, i) => {
                    d.abilities.base[a] = scores[i] ?? 10;
                  });
                },
                (before, after) => ({
                  title: `Rolled ability scores: ${scoresText(after)}`,
                  detail: `was ${scoresText(before)}`,
                }),
                'Rolled ability scores',
              );
            }}
          >
            {/* Lucide's Dices, not DS-001's D20Icon, for now: with no Dices
                import left here, Rolldown folds the 145 KB data registry into
                the entry chunk (over the entry budget). */}
            <Dices size={16} /> Roll 4d6
          </Button>
          {(() => {
            // Passive point-buy meter — shows only when all scores are in range.
            const COST: Record<number, number> = {
              8: 0,
              9: 1,
              10: 2,
              11: 3,
              12: 4,
              13: 5,
              14: 7,
              15: 9,
            };
            const costs = ABILITIES.map((a) => COST[doc.abilities.base[a]]);
            if (costs.some((c) => c === undefined)) return null;
            const total = costs.reduce<number>((s, c) => s + (c ?? 0), 0);
            return (
              <span
                className={`ml-auto text-caption tabular-nums ${total === 27 ? 'text-heal' : total > 27 ? 'text-guide' : 'text-ink-muted'}`}
              >
                Point buy: {total}/27
              </span>
            );
          })()}
        </div>
        <div className="@container">
          <div className={SCORES}>
            {ABILITIES.map((a) => {
              const final = sheet.abilities[a];
              return (
                // No side padding: the stepper is centred, and where it fills
                // the cell, padding would only push it out.
                <div
                  key={a}
                  className="@container flex flex-col items-center gap-1 rounded-control bg-surface-raised py-2"
                >
                  <span className={OVERLINE}>{a}</span>
                  <div className={SCORE_STEPPER}>
                    <button
                      type="button"
                      aria-label={`Decrease ${a.toUpperCase()}`}
                      onClick={() =>
                        update(
                          (d) => void (d.abilities.base[a] = Math.max(3, d.abilities.base[a] - 1)),
                        )
                      }
                      className="tap rounded-full bg-surface"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label={`${a.toUpperCase()} ${doc.abilities.base[a]}: swap with another ability`}
                      aria-pressed={swapFrom === a}
                      onClick={() => {
                        if (swapFrom === null) setSwapFrom(a);
                        else {
                          const from = swapFrom;
                          setSwapFrom(null);
                          if (from === a) return;
                          update((d) => {
                            const t = d.abilities.base[from];
                            d.abilities.base[from] = d.abilities.base[a];
                            d.abilities.base[a] = t;
                          });
                        }
                      }}
                      className="col-span-2 row-start-1 h-11 w-7 shrink-0 rounded-chip text-center font-bold tabular-nums aria-pressed:bg-ink aria-pressed:text-bg"
                    >
                      {doc.abilities.base[a]}
                    </button>
                    <button
                      type="button"
                      aria-label={`Increase ${a.toUpperCase()}`}
                      onClick={() =>
                        update(
                          (d) => void (d.abilities.base[a] = Math.min(18, d.abilities.base[a] + 1)),
                        )
                      }
                      className="tap rounded-full bg-surface"
                    >
                      +
                    </button>
                  </div>
                  <span className="text-caption text-ink-muted tabular-nums">
                    {final.value !== doc.abilities.base[a] ? `→ ${final.value} ` : ''}(
                    {signed(final.mod)})
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <p className="text-caption text-ink-muted">
          {swapFrom !== null
            ? `Swapping ${swapFrom.toUpperCase()}: tap another score to trade values.`
            : 'Tip: tap a score, then another, to swap the two values.'}
        </p>
      </Section>

      <Section title="Background" summary={doc.background?.name ?? 'none'}>
        <details key={pickerKey(doc.background)} open={doc.background === undefined}>
          <summary
            className={`cursor-pointer py-1 text-caption ${
              doc.background === undefined ? 'font-semibold text-guide' : 'text-ink-muted'
            }`}
          >
            {doc.background === undefined ? 'Pick a background to start' : 'Change background'}{' '}
            <EditionChip cue={cueFor('background', doc.background)} version={doc.rulesVersion} />
          </summary>
          <div className="pt-2">
            <EntityCardList
              sources={doc.allowedSources}
              curated
              describe={makeBackgroundBlurb(sheet.skills)}
              infoType="background"
              entities={backgrounds}
              selectedUid={
                doc.background !== undefined
                  ? `${doc.background.name}|${doc.background.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) => {
                const removed: string[] = [];
                undoable(
                  (d) => {
                    if (d.background !== undefined) {
                      removed.push(...pruneOrigin(d, 'background', d.background));
                    }
                    d.background = { name: nameOf(e), source: sourceOf(e) };
                  },
                  (before, after) => ({
                    title: `Background: ${before.background?.name ?? 'none'} → ${after.background?.name ?? 'none'}`,
                    detail: picksCleared(before, removed, before.background?.name, activeChoices),
                  }),
                );
              }}
            />
          </div>
        </details>
        <OriginChoices
          sheet={sheet}
          doc={doc}
          update={update}
          registry={registry}
          match={(o) => o.type === 'background'}
        />
      </Section>

      {(() => {
        // Choices now render inline under their origin (Classes / Race /
        // Background above). This catches anything without a visible home —
        // feat, item, or custom-origin picks, plus orphaned class/subclass ones.
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
          sheet.pending.some((p) => isOther(p.origin) && listsPick(p)) ||
          sheet.resolvedChoices.some((r) => isOther(r.prompt.origin));
        if (!hasOther) return null;
        return (
          <Section id="build-choices" title="Feat & other choices" defaultOpen>
            <OriginChoices
              sheet={sheet}
              doc={doc}
              update={update}
              registry={registry}
              match={isOther}
            />
          </Section>
        );
      })()}

      <Section
        title="Derived stats & skills"
        summary={`HP ${sheet.maxHp.value} · AC ${sheet.ac.value}`}
      >
        <p className="text-caption text-ink-muted">
          Tap any value to see exactly how it's calculated.
        </p>
        {/* Three across, but never a tile narrower than 4.75rem, which holds
            "Initiative": with large text, fewer columns rather than labels
            spilling out of their tiles and the page (A11Y-003). */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(max(4.75rem,(100%_-_1rem)/3),1fr))] gap-2">
          {(
            [
              ['Max HP', sheet.maxHp],
              ['Armor Class', sheet.ac],
              ['Initiative', sheet.initiative],
              ['Speed', sheet.speedWalk],
              ['Prof. bonus', sheet.profBonus],
              ['Passive Perc.', sheet.passivePerception],
            ] as const
          ).map(([label, value]) => (
            <BreakdownSheet
              key={label}
              title={label}
              value={value}
              trigger={
                <button
                  type="button"
                  className="rounded-control bg-surface-raised p-2 text-center transition-colors hover:bg-surface-hover"
                >
                  <div className="text-stat tabular-nums">{value.value}</div>
                  <div className="text-caption text-ink-muted">{label}</div>
                </button>
              }
            />
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className={OVERLINE}>Saving throws</span>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {ABILITIES.map((a) => (
              <BreakdownSheet
                key={a}
                title={`${a.toUpperCase()} save`}
                value={sheet.saves[a].total}
                trigger={
                  <button
                    type="button"
                    className={`rounded-control bg-surface-raised px-2 py-1.5 text-sm tabular-nums transition-colors hover:bg-surface-hover ${
                      sheet.saves[a].prof
                        ? 'font-semibold ring-1 ring-line-strong ring-inset'
                        : 'text-ink-muted'
                    }`}
                  >
                    {a.toUpperCase()} {signed(sheet.saves[a].total.value)}
                  </button>
                }
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className={OVERLINE}>Skills</span>
          <p className="text-caption text-ink-muted">
            Tap a skill to see its math and to set proficiency by hand.
          </p>
          <div className={ROWS}>
            {SKILLS.map(({ name }) => {
              const s = sheet.skills[name];
              if (s === undefined) return null;
              const pinned = doc.overrides[`skill.${name}.prof`] !== undefined;
              return (
                <BreakdownSheet
                  key={name}
                  title={`${name} check`}
                  value={s.total}
                  trigger={
                    <button
                      type="button"
                      className="flex items-center justify-between gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-raised"
                    >
                      {/* With large text the ability wraps under the name,
                          and a long name breaks, rather than pushing the total
                          out of the list's clipped edge. */}
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2 wrap-anywhere">
                        <ProfDot level={s.halfProf ? 'half' : s.prof} />
                        {name}
                        <span className="text-xs uppercase text-ink-muted">{s.ability}</span>
                        {pinned && <span className="text-overline text-guide uppercase">set</span>}
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums">
                        {signed(s.total.value)}
                      </span>
                    </button>
                  }
                >
                  <ProfPicker
                    value={s.prof}
                    base={s.profBase}
                    half={s.halfProf}
                    sources={s.sources}
                    overridden={pinned}
                    onChange={(level) =>
                      update(
                        (d) => {
                          if (level === null) delete d.overrides[`skill.${name}.prof`];
                          else d.overrides[`skill.${name}.prof`] = { value: level };
                        },
                        `${level === null ? 'Cleared' : 'Set'} ${name} proficiency`,
                      )
                    }
                  />
                </BreakdownSheet>
              );
            })}
          </div>
        </div>

        {sheet.grantedSpells.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className={OVERLINE}>Innate & granted spells</span>
            <div className={ROWS}>
              {sheet.grantedSpells.map((g) => (
                <SpellInfoSheet
                  key={`${g.name}|${g.source}`}
                  name={g.name}
                  source={g.source}
                  version={doc.rulesVersion}
                  subtitle={`${g.origin}${g.usage === 'prepared' ? ' · always prepared' : ''}`}
                  trigger={
                    <button
                      type="button"
                      className="flex w-full flex-wrap items-center justify-between gap-x-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-surface-raised"
                    >
                      {/* The origin wraps under the name, at the right, where
                          both do not fit (large text). */}
                      <span className="min-w-0 capitalize wrap-anywhere">{g.name}</span>
                      <span className="ml-auto min-w-0 text-xs text-ink-muted wrap-anywhere">
                        {g.origin}
                        {g.ability !== undefined ? ` · ${g.ability.toUpperCase()}` : ''}
                      </span>
                    </button>
                  }
                />
              ))}
            </div>
          </div>
        )}
      </Section>

      {sheet.warnings.length > 0 && (
        <details className="rounded-card bg-surface p-4 text-caption text-ink-muted shadow-card ring-1 ring-line ring-inset">
          <summary className="cursor-pointer text-body">
            {sheet.warnings.length} note{sheet.warnings.length > 1 ? 's' : ''}
          </summary>
          {sheet.warnings.map((w) => (
            <p key={w} className="mt-1">
              • {w}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
