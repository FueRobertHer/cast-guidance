import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import { filterByRulesVersion } from '@/data5e/rulesVersion';
import { applySourcePolicy, policyAllows, useSourcePolicy } from '@/data5e/sourceFilter';
import {
  classSpellUids,
  classSpellUidsFromEntities,
  getSpellClassLookup,
} from '@/data5e/spellLookup';
import type {
  CharacterDoc,
  DerivedResource,
  DerivedSheet,
  SpellcastingBlock,
  SpellcastingMode,
} from '@/engine/types';
import type { DocUpdater } from '@/stores/characterSession';
import { askChoice } from '@/ui/dialogs';
import { SourceBadge } from '@/ui/SourceBadge';
import {
  availableCastResources,
  castResourceId,
  castResourceOptions,
  castSpell,
} from './castResources';
import { isRecommendedStarter, recommendedStarters } from './spellHints';

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
  doc,
  update,
  allowCasting,
  characterLevel,
  pools,
}: {
  block: SpellcastingBlock;
  doc: CharacterDoc;
  update: DocUpdater;
  allowCasting: boolean;
  characterLevel: number;
  /** Derived pools, so a convertible one (sorcery points) is offered as a source. */
  pools: readonly DerivedResource[];
}) {
  const registry = useRegistry();
  const [classUids, setClassUids] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState('');
  const [showHiddenSources, setShowHiddenSources] = useState(false);
  const policy = useSourcePolicy();

  useEffect(() => {
    void ensureTypePacks('spell');
    void getSpellClassLookup().then((lookup) =>
      setClassUids(classSpellUids(lookup, block.className)),
    );
  }, [block.className]);

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
    const spells = filterByRulesVersion([...registry.byType('spell')], doc.rulesVersion).filter(
      (s) => classUids.has(uidOf(s)) || homebrewUids.has(uidOf(s)),
    );
    // Hidden sources drop out of the list to learn from, but a spell this
    // character already knows or prepares stays put, or the sheet would
    // show a count it can't account for.
    const onSheet = new Set(onSheetKey === '' ? [] : onSheetKey.split(','));
    const isOnSheet = (s: Entity) => onSheet.has(uidOf(s));
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
    // Nothing to choose (exhausted, or a single option): cast directly, but
    // still name the one option, since it may be a pool conversion that the
    // automatic slot-first path would never have reached for.
    if (options.length <= 1) {
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
      }),
    });
    if (picked === null) return;
    const chosen = options.find((o) => castResourceId(o) === picked);
    castSpell(update, block, level, info, chosen);
  };

  // Classify known spells by their real level via the registry (NOT the
  // search-filtered `byLevel`, which would shrink the counts mid-search and
  // fire a spurious over-limit cue).
  const { cantrips: cantripsKnown, leveled: knownLeveled } = classifyKnown(state.known, (ref) => {
    const e = registry?.get('spell', ref.name, ref.source);
    return typeof e?.level === 'number' ? e.level : undefined;
  });

  // Over-limit is allowed (house rules, features that add preparations) — flag
  // it, never block it (GAME-002/007 / guidance-not-gatekeeping).
  const prepMax = block.preparedMax;
  const cantripMax = block.cantripsKnown;
  // Known/pact casters cap the leveled spells they know; prepared/spellbook
  // casters don't count "known" this way, so the cue only applies to those modes.
  const knownGated = block.mode === 'known' || block.mode === 'pact';
  const knownMax = knownGated ? block.spellsKnownMax : undefined;
  const overPrepared = prepMax !== undefined && state.prepared.length > prepMax;
  const overCantrips = cantripMax !== undefined && cantripsKnown > cantripMax;
  const overKnown = knownMax !== undefined && knownLeveled > knownMax;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-baseline gap-2 text-sm font-semibold">
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
      {(overPrepared || overCantrips || overKnown) && (
        <p role="status" className="text-xs text-amber-300">
          {overPrepared
            ? `${state.prepared.length - (prepMax ?? 0)} over your prepared limit. `
            : ''}
          {overCantrips ? `${cantripsKnown - (cantripMax ?? 0)} over your cantrip limit. ` : ''}
          {overKnown ? `${knownLeveled - (knownMax ?? 0)} over your spells-known limit. ` : ''}
          That&rsquo;s allowed — the extra picks are kept, just flagging it.
        </p>
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
          placeholder={`Search ${block.className} spell list…`}
          className="w-full bg-transparent text-sm outline-none placeholder:text-ink-muted"
        />
      </label>
      {classUids === null && <p className="text-sm text-ink-muted">Loading spell list…</p>}
      {sourceHiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setShowHiddenSources(true)}
          className="rounded-lg border border-dashed border-surface-2 px-3 py-2 text-left text-xs text-ink-muted hover:text-ink"
        >
          {sourceHiddenCount} spells hidden by your source settings. Show them anyway
        </button>
      )}
      {showHiddenSources && (
        <button
          type="button"
          onClick={() => setShowHiddenSources(false)}
          className="rounded-lg border border-dashed border-surface-2 px-3 py-2 text-left text-xs text-ink-muted hover:text-ink"
        >
          Back to your chosen sources
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
                            ★
                          </span>
                        )}
                        {nameOf(s)}
                      </Link>
                      <SourceBadge source={sourceOf(s)} />
                      <button
                        type="button"
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
  if (sheet.spellcasting.length === 0) {
    return <p className="text-sm text-ink-muted">This character has no spellcasting.</p>;
  }
  return (
    <div className="flex flex-col gap-5">
      {sheet.spellcasting.map((block) => (
        <ClassSpells
          key={block.classUid}
          block={block}
          doc={doc}
          update={update}
          allowCasting={allowCasting}
          characterLevel={sheet.totalLevel}
          pools={sheet.resources}
        />
      ))}
    </div>
  );
}
