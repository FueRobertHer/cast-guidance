import { Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import { filterByRulesVersion } from '@/data5e/rulesVersion';
import { classSpellUids, getSpellClassLookup } from '@/data5e/spellLookup';
import type { CharacterDoc, DerivedSheet, SpellcastingBlock } from '@/engine/types';
import { SourceBadge } from '@/ui/SourceBadge';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');
const uidOf = (e: Entity) => `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();

function levelLabel(lvl: number): string {
  return lvl === 0 ? 'Cantrips' : `Level ${lvl}`;
}

/** Spend the lowest available slot ≥ `level` (pact-aware). Shared with PlayTab. */
export function castSpell(
  update: (recipe: (d: CharacterDoc) => void) => void,
  block: SpellcastingBlock,
  level: number,
): void {
  update((d) => {
    // Pact slots first when this class has them and the spell fits…
    if (
      block.pactSlots !== undefined &&
      block.pactSlots.level >= level &&
      d.play.pactSlotsSpent < block.pactSlots.count
    ) {
      d.play.pactSlotsSpent += 1;
      return;
    }
    // …otherwise the shared leveled pool (multiclass warlocks can use both).
    for (let lvl = level; lvl <= 9; lvl++) {
      const total = block.slots[lvl - 1] ?? 0;
      const spent = d.play.slotsSpent[lvl - 1] ?? 0;
      if (total > 0 && spent < total) {
        d.play.slotsSpent[lvl - 1] = spent + 1;
        return;
      }
    }
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

  const state = doc.spellcasting[block.classUid] ?? { known: [], prepared: [] };
  const knownUids = new Set(state.known.map((r) => `${r.name}|${r.source}`.toLowerCase()));
  const preparedUids = new Set(state.prepared.map((r) => `${r.name}|${r.source}`.toLowerCase()));

  const byLevel = useMemo(() => {
    if (registry === null || classUids === null) return new Map<number, Entity[]>();
    const spells = filterByRulesVersion([...registry.byType('spell')], doc.rulesVersion).filter(
      (s) => classUids.has(uidOf(s)),
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
  }, [registry, classUids, doc.rulesVersion, filter]);

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

  const cast = (level: number) => castSpell(update, block, level);

  const cantripsKnown = state.known.filter((r) => {
    const uid = `${r.name}|${r.source}`.toLowerCase();
    return (byLevel.get(0) ?? []).some((s) => uidOf(s) === uid);
  }).length;

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{block.className} spells</h2>
        <span className="text-xs text-ink-muted">
          DC {block.saveDc.value} · Atk +{block.attackMod.value}
          {block.cantripsKnown !== undefined &&
            ` · cantrips ${cantripsKnown}/${block.cantripsKnown}`}
          {block.preparedMax !== undefined &&
            ` · prepared ${state.prepared.length}/${block.preparedMax}`}
        </span>
      </header>
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
                      {allowCasting && lvl > 0 && (known || prepared) && (
                        <button
                          type="button"
                          onClick={() => cast(lvl)}
                          className="shrink-0 rounded bg-accent-deep px-2 py-0.5 text-xs font-semibold"
                          title={`Cast at level ${lvl} (spends a slot)`}
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
