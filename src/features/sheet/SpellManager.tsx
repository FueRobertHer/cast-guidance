import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { type TypePacksState, useRegistry, useTypePacks } from '@/data5e/hooks';
import { filterByRulesVersion } from '@/data5e/rulesVersion';
import {
  applySourcePolicy,
  backToSourcesLabel,
  hiddenSourcesLabel,
  policyAllows,
} from '@/data5e/sourceFilter';
import {
  classSpellUids,
  classSpellUidsFromEntities,
  getSpellClassLookup,
  type SpellClassLookup,
} from '@/data5e/spellLookup';
import type {
  CharacterDoc,
  DerivedResource,
  DerivedSheet,
  EntityRef,
  SpellcastingBlock,
  SpellcastingMode,
} from '@/engine/types';
import { usePickSourcePolicy } from '@/lib/usePickSourcePolicy';
import type { DocUpdater } from '@/stores/characterSession';
import { askChoice, askConfirm } from '@/ui/dialogs';
import { OutsideSourcesChip } from '@/ui/OutsideSourcesChip';
import { PackProblem } from '@/ui/PackProblem';
import { SourceBadge } from '@/ui/SourceBadge';
import {
  availableCastResources,
  castResourceId,
  castResourceOptions,
  castSpell,
  needsCastChoice,
} from './castResources';
import { isRecommendedStarter, recommendedStarters } from './spellHints';
import { applySpellTrim, describeTrim, isEmptyTrim, planSpellTrim, spellLimits } from './spellTrim';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');
const uidOf = (e: Entity) => `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();

/** Short badge + tooltip describing how the class relates to its spells (GAME-002). */
const MODE_LABEL: Record<SpellcastingMode, string | undefined> = {
  known: 'Known',
  prepared: 'Prepared',
  spellbook: 'Spellbook',
  pact: 'Pact Magic',
  none: undefined,
};
const MODE_HINT: Record<SpellcastingMode, string> = {
  known: 'You know a fixed set of chosen spells.',
  prepared: 'You prepare a changeable subset of the whole class list.',
  spellbook: 'You learn spells into a spellbook, then prepare a subset.',
  pact: 'Pact Magic: known spells cast with pact slots.',
  none: '',
};

function levelLabel(lvl: number): string {
  return lvl === 0 ? 'Cantrips' : `Level ${lvl}`;
}

/**
 * Split a caster's known-spell list into cantrip vs leveled counts using a
 * caller-supplied level lookup. Kept pure and independent of the on-screen
 * search filter so the header counts and over-limit cues don't shift while the
 * user is searching. A spell whose level can't be resolved counts as neither.
 */
export function classifyKnown(
  known: ReadonlyArray<{ name: string; source: string }>,
  levelOf: (ref: { name: string; source: string }) => number | undefined,
): { cantrips: number; leveled: number } {
  let cantrips = 0;
  let leveled = 0;
  for (const ref of known) {
    const lvl = levelOf(ref);
    if (lvl === 0) cantrips += 1;
    else if (lvl !== undefined && lvl > 0) leveled += 1;
  }
  return { cantrips, leveled };
}

/** Does the spell require concentration (from its `duration` block)? */
export function spellNeedsConcentration(e: Entity | undefined): boolean {
  const d = e?.duration;
  return (
    Array.isArray(d) &&
    d.some((x) => (x as { concentration?: boolean } | null)?.concentration === true)
  );
}

function ClassSpells({
  block,
  lookup,
  waiting,
  complete,
  doc,
  update,
  allowCasting,
  characterLevel,
  pools,
  alwaysPrepared,
}: {
  block: SpellcastingBlock;
  /** Which spells are on which class's list; null until it has been read. */
  lookup: SpellClassLookup | null;
  /** Whether the list is still on its way, rather than failed and said above. */
  waiting: boolean;
  /** Whether everything the list reads is in, so an empty list is the answer. */
  complete: boolean;
  doc: CharacterDoc;
  update: DocUpdater;
  allowCasting: boolean;
  characterLevel: number;
  /** Derived pools, so a convertible one (sorcery points) is offered as a source. */
  pools: readonly DerivedResource[];
  /** Always-prepared grants a trim may unprepare first (empty with several casting classes). */
  alwaysPrepared: readonly EntityRef[];
}) {
  const registry = useRegistry();
  const [filter, setFilter] = useState('');
  const [showHiddenSources, setShowHiddenSources] = useState(false);
  const { policy, scope } = usePickSourcePolicy(doc.allowedSources);

  const classUids = useMemo(
    () => (lookup !== null ? classSpellUids(lookup, block.className) : null),
    [lookup, block.className],
  );

  // Homebrew spells carry classes.fromClassList inline — union them in.
  const homebrewUids = useMemo(
    () =>
      registry !== null
        ? classSpellUidsFromEntities(registry.byType('spell'), block.className)
        : new Set<string>(),
    [registry, block.className],
  );

  const state = doc.spellcasting[block.classUid] ?? { known: [], prepared: [] };
  const knownUids = new Set(state.known.map((r) => `${r.name}|${r.source}`.toLowerCase()));
  const preparedUids = new Set(state.prepared.map((r) => `${r.name}|${r.source}`.toLowerCase()));

  /**
   * Spells already on the sheet, as a primitive so it can be a memo dependency.
   * The character store `structuredClone`s the doc on every write, so depending
   * on `doc.spellcasting` itself would rebuild the whole spell list on an HP
   * tick or a condition toggle. Only these uids actually affect the result.
   */
  const onSheetKey = [...knownUids, ...preparedUids].sort().join(',');

  const { byLevel, sourceHiddenCount } = useMemo(() => {
    const empty = { byLevel: new Map<number, Entity[]>(), sourceHiddenCount: 0 };
    if (registry === null || classUids === null) return empty;
    // Hidden sources and the other edition's printings drop out of the list to
    // learn from, but a spell this character already knows or prepares stays
    // put, or the sheet would show a count it can't account for and offer no
    // way to unlearn it (a 2014 pick after a switch to 2024, say).
    const onSheet = new Set(onSheetKey === '' ? [] : onSheetKey.split(','));
    const isOnSheet = (s: Entity) => onSheet.has(uidOf(s));
    const spells = filterByRulesVersion([...registry.byType('spell')], doc.rulesVersion, {
      keep: isOnSheet,
    }).filter((s) => classUids.has(uidOf(s)) || homebrewUids.has(uidOf(s)));
    const allowed = showHiddenSources
      ? spells
      : applySourcePolicy(spells, policy, sourceOf, isOnSheet);
    const f = filter.trim().toLowerCase();
    const matchesText = (s: Entity) => f === '' || nameOf(s).toLowerCase().includes(f);
    // Counted after the text filter so the offer never promises matches that
    // revealing hidden books would not produce.
    const sourceHiddenCount = showHiddenSources
      ? 0
      : spells.filter((s) => matchesText(s) && !policyAllows(policy, sourceOf(s)) && !isOnSheet(s))
          .length;
    const map = new Map<number, Entity[]>();
    for (const s of allowed.filter(matchesText)) {
      const lvl = typeof s.level === 'number' ? s.level : 0;
      const list = map.get(lvl) ?? [];
      list.push(s);
      map.set(lvl, list);
    }
    for (const list of map.values()) list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return { byLevel: map, sourceHiddenCount };
  }, [
    registry,
    classUids,
    homebrewUids,
    doc.rulesVersion,
    onSheetKey,
    policy,
    showHiddenSources,
    filter,
  ]);

  const toggle = (spell: Entity, list: 'known' | 'prepared') => {
    update((d) => {
      const sc = d.spellcasting[block.classUid] ?? { known: [], prepared: [] };
      d.spellcasting[block.classUid] = sc;
      const ref = { name: nameOf(spell), source: sourceOf(spell) };
      const uid = uidOf(spell);
      const idx = sc[list].findIndex((r) => `${r.name}|${r.source}`.toLowerCase() === uid);
      if (idx >= 0) {
        sc[list].splice(idx, 1);
        if (list === 'known') {
          // unknowing also unprepares
          const pIdx = sc.prepared.findIndex((r) => `${r.name}|${r.source}`.toLowerCase() === uid);
          if (pIdx >= 0) sc.prepared.splice(pIdx, 1);
        }
      } else {
        sc[list].push(ref);
        if (list === 'prepared') {
          const kIdx = sc.known.findIndex((r) => `${r.name}|${r.source}`.toLowerCase() === uid);
          if (kIdx < 0) sc.known.push(ref);
        }
      }
    });
  };

  const cast = async (level: number, spell: Entity) => {
    const info = {
      name: nameOf(spell),
      source: sourceOf(spell),
      concentration: spellNeedsConcentration(spell),
    };
    const options = availableCastResources(block, doc.play, level, pools);
    // Nothing to decide: cast directly on the one option, or on none at all.
    if (!needsCastChoice(options)) {
      castSpell(update, block, level, info, options[0]);
      return;
    }
    // Multiple slot levels (and/or pact, and/or a convertible pool) available:
    // let the player pick which to spend instead of always the lowest (GAME-001).
    const picked = await askChoice({
      title: `Cast ${nameOf(spell)}`,
      detail: 'Choose which slot or pool to spend — a higher level upcasts the spell.',
      options: castResourceOptions(options, {
        block,
        play: doc.play,
        pools,
        spell,
        spellLevel: level,
        characterLevel,
        rulesVersion: doc.rulesVersion,
        classes: doc.classes,
      }),
    });
    if (picked === null) return;
    const chosen = options.find((o) => castResourceId(o) === picked);
    // Ids round-trip, so a miss is impossible; casting the automatic pick
    // instead of the choice would be the wrong way to find that out.
    if (chosen === undefined) return;
    castSpell(update, block, level, info, chosen);
  };

  // Classify known spells by their real level via the registry (NOT the
  // search-filtered `byLevel`, which would shrink the counts mid-search and
  // fire a spurious over-limit cue).
  const levelOf = (ref: EntityRef) => {
    const e = registry?.get('spell', ref.name, ref.source);
    return typeof e?.level === 'number' ? e.level : undefined;
  };
  const { cantrips: cantripsKnown, leveled: knownLeveled } = classifyKnown(state.known, levelOf);

  // Over-limit is allowed (house rules, features that add preparations) — flag
  // it, never block it (GAME-002/007 / guidance-not-gatekeeping).
  const limits = spellLimits(block);
  const prepMax = limits.prepared;
  const cantripMax = limits.cantrips;
  const knownMax = limits.known;
  const overPrepared = prepMax !== undefined && state.prepared.length > prepMax;
  const overCantrips = cantripMax !== undefined && cantripsKnown > cantripMax;
  const overKnown = knownMax !== undefined && knownLeveled > knownMax;
  const over = overPrepared || overCantrips || overKnown;

  const heading = useRef<HTMLHeadingElement>(null);
  // Offered, never done for the player: the confirm lists exactly what goes,
  // and only this class's entry changes.
  const trim = async () => {
    const plan = planSpellTrim({ state, limits, levelOf, alwaysPrepared });
    if (isEmptyTrim(plan)) return;
    const ok = await askConfirm({
      title: `Trim ${block.className} spells to your limits?`,
      detail: `${describeTrim(plan, block.mode).join('. ')}. ${
        plan.unprepareRedundant.length > 0
          ? 'Otherwise the most recently added go first.'
          : 'The most recently added go first.'
      } Over-limit is allowed, so this is optional.`,
      confirmLabel: 'Trim',
    });
    if (!ok) return;
    update((d) => {
      const sc = d.spellcasting[block.classUid];
      if (sc !== undefined) applySpellTrim(sc, plan);
    }, `Trimmed ${block.className} spells to limit`);
    // The button goes away with the overage, so the dialog cannot hand focus
    // back to it. Land on this class's heading rather than the top of the page.
    requestAnimationFrame(() => heading.current?.focus({ preventScroll: true }));
  };

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 ref={heading} tabIndex={-1} className="flex items-baseline gap-2 text-sm font-semibold">
          {block.className} spells
          {MODE_LABEL[block.mode] !== undefined && (
            <span
              className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted"
              title={MODE_HINT[block.mode]}
            >
              {MODE_LABEL[block.mode]}
            </span>
          )}
        </h2>
        <span className="text-xs text-ink-muted">
          DC {block.saveDc.value} · Atk +{block.attackMod.value}
          {cantripMax !== undefined && (
            <>
              {' · cantrips '}
              <span className={overCantrips ? 'font-semibold text-amber-300' : undefined}>
                {cantripsKnown}/{cantripMax}
              </span>
            </>
          )}
          {prepMax !== undefined && (
            <>
              {' · prepared '}
              <span className={overPrepared ? 'font-semibold text-amber-300' : undefined}>
                {state.prepared.length}/{prepMax}
              </span>
            </>
          )}
          {knownMax !== undefined && (
            <>
              {' · known '}
              <span className={overKnown ? 'font-semibold text-amber-300' : undefined}>
                {knownLeveled}/{knownMax}
              </span>
            </>
          )}
        </span>
      </header>
      {over && (
        <p role="status" className="text-xs text-amber-300">
          {overPrepared
            ? `${state.prepared.length - (prepMax ?? 0)} over your prepared limit. `
            : ''}
          {overCantrips ? `${cantripsKnown - (cantripMax ?? 0)} over your cantrip limit. ` : ''}
          {overKnown ? `${knownLeveled - (knownMax ?? 0)} over your spells-known limit. ` : ''}
          That&rsquo;s allowed — the extra picks are kept, just flagging it.
        </p>
      )}
      {/* A sibling of the cue, not inside it, so the live region doesn't read the button. */}
      {over && (
        <button
          type="button"
          onClick={() => {
            void trim();
          }}
          aria-label={`Trim to limit, ${block.className} spells`}
          className="self-start rounded-lg border border-surface-2 px-3 py-1 text-xs text-ink-muted hover:text-ink"
        >
          Trim to limit…
        </button>
      )}
      {(() => {
        const rec = recommendedStarters(block.className);
        if (rec === undefined) return null;
        // Only suggest what the list below actually offers: a starter pick from
        // a book the player has hidden would be advice they cannot take.
        const visible = new Set([...byLevel.values()].flat().map((s) => nameOf(s).toLowerCase()));
        const picks = [...rec.cantrips, ...rec.level1].filter((p) => visible.has(p.toLowerCase()));
        if (picks.length === 0) return null;
        return (
          <p className="rounded-lg bg-surface px-3 py-2 text-xs text-ink-muted">
            <span className="text-amber-300">★ New to {block.className}?</span> Solid first picks:{' '}
            {picks.join(', ')}.
          </p>
        );
      })()}
      <label className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2">
        <Search size={14} className="shrink-0 text-ink-muted" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          aria-label={`Search ${block.className} spell list`}
          placeholder={`Search ${block.className} spell list…`}
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-muted"
        />
      </label>
      {classUids === null && waiting && (
        <p className="text-sm text-ink-muted">Loading spell list…</p>
      )}
      {/* Said, not left as a bare heading: a homebrew class with no list, or a
          search or sources that leave nothing (the offer below then says how
          many are hidden). */}
      {complete && classUids !== null && byLevel.size === 0 && (
        <p className="text-sm text-ink-muted">
          {filter.trim() === ''
            ? `No spells on the ${block.className} list to show.`
            : `No ${block.className} spells match “${filter.trim()}”.`}
        </p>
      )}
      {sourceHiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowHiddenSources(true)}
          className="rounded-lg border border-dashed border-surface-2 px-3 py-2 text-left text-xs text-ink-muted hover:text-ink"
        >
          {hiddenSourcesLabel(
            sourceHiddenCount,
            scope,
            sourceHiddenCount === 1 ? 'spell' : 'spells',
          )}
        </button>
      )}
      {showHiddenSources && (
        <button
          type="button"
          onClick={() => setShowHiddenSources(false)}
          className="rounded-lg border border-dashed border-surface-2 px-3 py-2 text-left text-xs text-ink-muted hover:text-ink"
        >
          {backToSourcesLabel(scope)}
        </button>
      )}
      {[...byLevel.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([lvl, spells]) => {
          const knownAtLevel = spells.filter((s) => knownUids.has(uidOf(s)));
          const open = filter !== '' || knownAtLevel.length > 0;
          return (
            <details key={lvl} open={open} className="rounded-lg bg-surface">
              <summary className="cursor-pointer px-3 py-2 text-sm font-semibold">
                {levelLabel(lvl)}
                <span className="ml-2 text-xs font-normal text-ink-muted">
                  {knownAtLevel.length > 0 ? `${knownAtLevel.length} known · ` : ''}
                  {spells.length} available
                </span>
              </summary>
              <div className="flex flex-col border-t border-surface-2/40">
                {spells.map((s) => {
                  const uid = uidOf(s);
                  const known = knownUids.has(uid);
                  const prepared = preparedUids.has(uid);
                  return (
                    <div
                      key={uid}
                      className="flex items-center gap-2 border-b border-surface-2/30 px-3 py-2 text-sm last:border-b-0"
                    >
                      <Link
                        to={`/library/spell/${encodeURIComponent(uid)}`}
                        className="min-w-0 flex-1 truncate hover:text-amber-200"
                      >
                        {isRecommendedStarter(block.className, nameOf(s), lvl) && (
                          <span
                            className="mr-1 text-amber-300"
                            title={`Recommended first pick for ${block.className}`}
                          >
                            <span aria-hidden="true">★</span>
                            <span className="sr-only">Recommended:</span>
                          </span>
                        )}
                        {nameOf(s)}
                      </Link>
                      {scope === 'character' && !policyAllows(policy, sourceOf(s)) && (
                        <OutsideSourcesChip />
                      )}
                      <SourceBadge source={sourceOf(s)} />
                      {/* Stable verbs for the names, so aria-pressed alone says the state. */}
                      <button
                        type="button"
                        aria-label={`Learn ${nameOf(s)}`}
                        aria-pressed={known}
                        onClick={() => toggle(s, 'known')}
                        className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                          known ? 'border-sky-300 text-sky-300' : 'border-surface-2 text-ink-muted'
                        }`}
                      >
                        {known ? 'known' : 'learn'}
                      </button>
                      {lvl > 0 && (
                        <button
                          type="button"
                          aria-label={`Prepare ${nameOf(s)}`}
                          aria-pressed={prepared}
                          onClick={() => toggle(s, 'prepared')}
                          className={`shrink-0 rounded-full border px-2 py-0.5 text-xs ${
                            prepared
                              ? 'border-emerald-300 text-emerald-300'
                              : 'border-surface-2 text-ink-muted'
                          }`}
                        >
                          {prepared ? 'prepared' : 'prepare'}
                        </button>
                      )}
                      {allowCasting &&
                        (known || prepared) &&
                        // Leveled spells spend a slot; cantrips only get a Cast
                        // button when they concentrate (so the tracker fires).
                        (lvl > 0 || spellNeedsConcentration(s)) && (
                          <button
                            type="button"
                            aria-label={`Cast ${nameOf(s)}`}
                            onClick={() => {
                              void cast(lvl, s);
                            }}
                            className="shrink-0 rounded bg-accent-deep px-2 py-0.5 text-xs font-semibold"
                            title={
                              lvl === 0
                                ? 'Cast cantrip (starts concentration)'
                                : `Cast at level ${lvl} (spends a slot${
                                    spellNeedsConcentration(s) ? ', starts concentration' : ''
                                  })`
                            }
                          >
                            Cast
                          </button>
                        )}
                    </div>
                  );
                })}
              </div>
            </details>
          );
        })}
    </section>
  );
}

const NO_LOOKUP: SpellClassLookup = {};

/**
 * The generated index of which spells each class can learn, read once for
 * every casting class, with somewhere for its failure to go.
 *
 * It is one essentials file, so it is normally on the device already, but the
 * read can still fail: the row went missing and the network is down, or
 * IndexedDB refused the read. That used to be a rejection nothing caught, and
 * the list said "Loading spell list…" for good. Until it is in hand it is read
 * again whenever the spell download's status moves, so the Retry on the spell
 * list's panel, the only one on screen until the spell files are in, retries
 * this too.
 */
function useClassLookup(
  enabled: boolean,
  packsStatus: TypePacksState['status'],
): { lookup: SpellClassLookup | null; problem: TypePacksState } {
  const [lookup, setLookup] = useState<SpellClassLookup | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // Read once: in hand, a later status change has nothing to fix.
  const settled = lookup !== null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `packsStatus` and `attempt` are what ask for a fresh read
  useEffect(() => {
    if (!enabled || settled) return;
    let alive = true;
    // Back to waiting while it is read again, as a retried download is.
    setFailure(null);
    getSpellClassLookup().then(
      (next) => {
        if (!alive) return;
        setLookup(next);
        setFailure(null);
      },
      (e: unknown) => {
        if (!alive) return;
        setFailure(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      alive = false;
    };
  }, [enabled, settled, packsStatus, attempt]);
  return {
    // Failed, the lists fall back to the homebrew spells, which carry their
    // classes inline, rather than to a list that never arrives.
    lookup: lookup ?? (failure !== null ? NO_LOOKUP : null),
    problem: {
      status: failure !== null ? 'error' : lookup !== null ? 'ready' : 'loading',
      error: failure,
      // Never "offline": the read is normally local, so a failure is this
      // device's storage far more often than the network, and the panel is
      // given words that say so instead.
      offline: false,
      retry: () => setAttempt((n) => n + 1),
      repair: () => undefined,
    },
  };
}

/** Full spell management for every casting class on the character. */
export function SpellManager({
  doc,
  sheet,
  update,
  allowCasting = true,
}: {
  doc: CharacterDoc;
  sheet: DerivedSheet;
  update: DocUpdater;
  allowCasting?: boolean;
}) {
  const caster = sheet.spellcasting.length > 0;
  // Once for the whole page, not once per class: a character with two casting
  // classes reads the same spell files, and one panel says why both are short.
  // Nothing for a character with no spellcasting, which has no list to fill.
  const packs = useTypePacks(caster ? 'spell' : undefined);
  const { lookup, problem } = useClassLookup(caster, packs.status);
  if (!caster) {
    return <p className="text-sm text-ink-muted">This character has no spellcasting.</p>;
  }
  // Always-prepared grants aren't tied to a class, so they only say which of a
  // class's preparations are redundant when there is just the one class.
  const alwaysPrepared =
    sheet.spellcasting.length === 1
      ? sheet.grantedSpells.filter((g) => g.usage === 'prepared')
      : [];
  return (
    <div className="flex flex-col gap-5">
      <PackProblem packs={packs} what="the spell list" />
      {/* Only with the spell files in: while they are failing or being
          retried, the spell list's panel speaks for both (its Retry reads
          the index again too), so one outage is one alert. */}
      {packs.status === 'ready' && (
        <PackProblem
          packs={problem}
          what="the class spell lists"
          message={`The class spell lists couldn't be read on this device${
            problem.error === null ? '.' : `: ${problem.error}`
          }`}
        />
      )}
      {sheet.spellcasting.map((block) => (
        <ClassSpells
          key={block.classUid}
          block={block}
          lookup={lookup}
          waiting={packs.status !== 'error'}
          complete={packs.status === 'ready' && problem.status === 'ready'}
          doc={doc}
          update={update}
          allowCasting={allowCasting}
          characterLevel={sheet.totalLevel}
          pools={sheet.resources}
          alwaysPrepared={alwaysPrepared}
        />
      ))}
    </div>
  );
}
