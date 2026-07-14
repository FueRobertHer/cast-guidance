import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import { filterByRulesVersion } from '@/data5e/rulesVersion';
import {
  classSpellUids,
  classSpellUidsFromEntities,
  getSpellClassLookup,
} from '@/data5e/spellLookup';
import type {
  CharacterDoc,
  DerivedSheet,
  PlayState,
  SpellcastingBlock,
  SpellcastingMode,
} from '@/engine/types';
import { SourceBadge } from '@/ui/SourceBadge';
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

/** Does the spell require concentration (from its `duration` block)? */
export function spellNeedsConcentration(e: Entity | undefined): boolean {
  const d = e?.duration;
  return (
    Array.isArray(d) &&
    d.some((x) => (x as { concentration?: boolean } | null)?.concentration === true)
  );
}

export interface CastSpellInfo {
  name: string;
  source: string;
  concentration?: boolean;
  /** Which slice of the turn casting uses (from the spell's casting time). */
  economy?: 'action' | 'bonus' | 'reaction';
}

export type CastResource =
  | { kind: 'cantrip'; level: 0 }
  | { kind: 'pact'; level: number }
  | { kind: 'slot'; level: number }
  | { kind: 'none'; level: number };

/** Preview the resource the current automatic cast path will consume. */
export function nextCastResource(
  block: SpellcastingBlock,
  play: PlayState,
  spellLevel: number,
): CastResource {
  if (spellLevel === 0) return { kind: 'cantrip', level: 0 };
  if (
    block.pactSlots !== undefined &&
    block.pactSlots.level >= spellLevel &&
    play.pactSlotsSpent < block.pactSlots.count
  ) {
    return { kind: 'pact', level: block.pactSlots.level };
  }
  for (let level = spellLevel; level <= 9; level++) {
    const total = block.slots[level - 1] ?? 0;
    const spent = play.slotsSpent[level - 1] ?? 0;
    if (total > 0 && spent < total) return { kind: 'slot', level };
  }
  return { kind: 'none', level: spellLevel };
}

/**
 * Cast a spell: spend the lowest available slot ≥ `level` (pact-aware). Marks
 * the action economy the casting time uses and, when the spell concentrates, it
 * becomes the active concentration (dropping any prior one — one at a time).
 */
export function castSpell(
  update: (recipe: (d: CharacterDoc) => void) => void,
  block: SpellcastingBlock,
  level: number,
  spell?: CastSpellInfo,
): void {
  update((d) => {
    if (spell?.concentration === true) {
      d.play.concentratingOn = { label: spell.name };
    }
    if (spell?.economy !== undefined) {
      const turn = d.play.turn ?? { action: false, bonus: false, reaction: false };
      turn[spell.economy] = true;
      d.play.turn = turn;
    }
    const resource = nextCastResource(block, d.play, level);
    if (resource.kind === 'cantrip' || resource.kind === 'none') return;
    if (resource.kind === 'pact') {
      d.play.pactSlotsSpent += 1;
      return;
    }
    const spent = d.play.slotsSpent[resource.level - 1] ?? 0;
    d.play.slotsSpent[resource.level - 1] = spent + 1;
  });
}

function ClassSpells({
  block,
  doc,
  update,
  allowCasting,
}: {
  block: SpellcastingBlock;
  doc: CharacterDoc;
  update: (recipe: (d: CharacterDoc) => void) => void;
  allowCasting: boolean;
}) {
  const registry = useRegistry();
  const [classUids, setClassUids] = useState<Set<string> | null>(null);
  const [filter, setFilter] = useState('');

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

  const byLevel = useMemo(() => {
    if (registry === null || classUids === null) return new Map<number, Entity[]>();
    const spells = filterByRulesVersion([...registry.byType('spell')], doc.rulesVersion).filter(
      (s) => classUids.has(uidOf(s)) || homebrewUids.has(uidOf(s)),
    );
    const f = filter.trim().toLowerCase();
    const filtered = f === '' ? spells : spells.filter((s) => nameOf(s).toLowerCase().includes(f));
    const map = new Map<number, Entity[]>();
    for (const s of filtered) {
      const lvl = typeof s.level === 'number' ? s.level : 0;
      const list = map.get(lvl) ?? [];
      list.push(s);
      map.set(lvl, list);
    }
    for (const list of map.values()) list.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    return map;
  }, [registry, classUids, homebrewUids, doc.rulesVersion, filter]);

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

  const cast = (level: number, spell: Entity) =>
    castSpell(update, block, level, {
      name: nameOf(spell),
      source: sourceOf(spell),
      concentration: spellNeedsConcentration(spell),
    });

  const cantripsKnown = state.known.filter((r) => {
    const uid = `${r.name}|${r.source}`.toLowerCase();
    return (byLevel.get(0) ?? []).some((s) => uidOf(s) === uid);
  }).length;

  // Over-limit is allowed (house rules, features that add preparations) — flag
  // it, never block it (GAME-002 / guidance-not-gatekeeping).
  const prepMax = block.preparedMax;
  const cantripMax = block.cantripsKnown;
  const overPrepared = prepMax !== undefined && state.prepared.length > prepMax;
  const overCantrips = cantripMax !== undefined && cantripsKnown > cantripMax;

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
        </span>
      </header>
      {(overPrepared || overCantrips) && (
        <p role="status" className="text-xs text-amber-300">
          {overPrepared
            ? `${state.prepared.length - (prepMax ?? 0)} over your prepared limit. `
            : ''}
          {overCantrips ? `${cantripsKnown - (cantripMax ?? 0)} over your cantrip limit. ` : ''}
          That&rsquo;s allowed — the extra picks are kept, just flagging it.
        </p>
      )}
      {(() => {
        const rec = recommendedStarters(block.className);
        if (rec === undefined) return null;
        const picks = [...rec.cantrips, ...rec.level1];
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
                            onClick={() => cast(lvl, s)}
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
  update: (recipe: (d: CharacterDoc) => void) => void;
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
        />
      ))}
    </div>
  );
}
