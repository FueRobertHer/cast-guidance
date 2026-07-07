import { ChevronUp, Dices, RefreshCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useOutletContext } from 'react-router';
import type { Entity } from '@/data5e/copyMod';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import { filterByRulesVersion } from '@/data5e/rulesVersion';
import { roll } from '@/dice/roll';
import { meetsMulticlassRequirements, multiclassRequirementText } from '@/engine/multiclass';
import { ABILITIES, type DerivedSheet, SKILLS } from '@/engine/types';
import { ChoicePromptRenderer } from '@/features/creator/ChoicePromptRenderer';
import { rollLogStore } from '@/stores/rollLog';
import { BreakdownSheet } from '@/ui/BreakdownSheet';
import { EntityCardList } from '@/ui/EntityCardList';
import type { CharacterSheetState } from './useCharacterSheet';

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');

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
      <div className="sticky top-0 z-10 rounded-lg bg-surface/95 px-3 py-2 text-xs text-ink-muted backdrop-blur">
        Change anything below — the effects on your stats show up here instantly.
      </div>
    );
  }
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 rounded-lg border border-amber-300/30 bg-surface/95 px-3 py-2 backdrop-blur">
      {diff.map((d) => (
        <span key={d.label} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">
          {d.label} <span className="text-ink-muted">{d.from}</span>
          <span className={d.to > d.from ? 'text-emerald-300' : 'text-accent'}> → {d.to}</span>
        </span>
      ))}
      <button
        type="button"
        onClick={() => setDiff([])}
        className="ml-auto text-xs text-ink-muted"
        title="Dismiss"
      >
        ✕
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

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
    <details id={id} open={defaultOpen} className="group scroll-mt-4 rounded-lg bg-surface">
      <summary className="flex cursor-pointer items-center justify-between px-3 py-2.5">
        <span className="text-sm font-semibold">{title}</span>
        <span className="flex items-center gap-2 text-xs text-ink-muted">
          {summary}
          <ChevronUp size={14} className="transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="flex flex-col gap-3 border-t border-surface-2/40 p-3">{children}</div>
    </details>
  );
}

export function Component() {
  const { sheet, doc, update } = useOutletContext<CharacterSheetState>();
  const registry = useRegistry(['essentials']);

  useEffect(() => {
    void ensureTypePacks('class');
  }, []);

  if (sheet === null || doc === null || registry === null) {
    return <p className="text-sm text-ink-muted">Loading…</p>;
  }

  const classes = filterByRulesVersion([...registry.byType('class')], doc.rulesVersion);
  const subclassesFor = (ref: { name: string; source: string }) =>
    filterByRulesVersion(
      registry
        .byType('subclass')
        .filter(
          (s) =>
            String(s.className).toLowerCase() === ref.name.toLowerCase() &&
            String(s.classSource).toLowerCase() === ref.source.toLowerCase(),
        ),
      doc.rulesVersion,
    );
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

  const hdFacesOf = (ref: { name: string; source: string }): number => {
    const cls = registry.get('class', ref.name, ref.source);
    const faces = (cls?.hd as { faces?: number } | undefined)?.faces;
    return typeof faces === 'number' ? faces : 8;
  };
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
        const r = roll(`1d${faces}`, {
          label: `${c.ref.name} level ${c.levels} hit points (d${faces})`,
        });
        rollLogStore.getState().append(r);
        c.hp = [...c.hp, r.total];
      } else {
        c.hp = [...c.hp, 'avg'];
      }
    });
  };

  const openChoices = () => {
    const el = document.getElementById('build-choices');
    if (el instanceof HTMLDetailsElement) el.open = true;
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="flex flex-col gap-3">
      <ChangeBar sheet={sheet} />

      {sheet.pending.length > 0 && (
        <button
          type="button"
          onClick={openChoices}
          className="flex items-center justify-between gap-2 rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2.5 text-left text-sm text-amber-200"
        >
          <span>
            <strong>{sheet.pending.length}</strong> decision
            {sheet.pending.length > 1 ? 's' : ''} to make — skills, feats, languages…
          </span>
          <span className="shrink-0 font-semibold">Resolve →</span>
        </button>
      )}

      <Section title="Identity" summary={`${doc.rulesVersion} rules`} defaultOpen>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-muted">Name</span>
          <input
            value={doc.name}
            onChange={(e) => update((d) => void (d.name = e.target.value))}
            className="rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none"
          />
        </label>
        <fieldset className="flex gap-1.5">
          <legend className="mb-1 text-xs text-ink-muted">
            Rules version — switching re-derives everything; mismatched picks show warnings
          </legend>
          {(['2014', '2024'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => update((d) => void (d.rulesVersion = v))}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                doc.rulesVersion === v
                  ? 'border-accent bg-accent-deep/40 font-semibold'
                  : 'border-surface-2 text-ink-muted'
              }`}
            >
              {v}
            </button>
          ))}
        </fieldset>
      </Section>

      <Section
        title="Classes"
        summary={doc.classes.map((c) => `${c.ref.name} ${c.levels}`).join(' / ') || 'none'}
        defaultOpen
      >
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-xs text-ink-muted">
            HP per level (level 1 of your first class is always the full die)
          </legend>
          <div className="flex gap-1.5">
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
                onClick={() => update((d) => void (d.hpMethod = m))}
                className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-semibold ${
                  hpMethod === m
                    ? 'border-accent bg-accent-deep/40'
                    : 'border-surface-2 text-ink-muted'
                }`}
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
          const subclasses = subclassesFor(entry.ref);
          return (
            <div
              key={`${entry.ref.name}|${entry.ref.source}`}
              className="flex flex-col gap-2 rounded-lg border border-surface-2 p-3"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">
                  {entry.ref.name} {entry.levels}
                  <span className="ml-1.5 text-xs font-normal text-ink-muted">d{faces}</span>
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      update((d) => {
                        const c = d.classes[idx];
                        if (c === undefined) return;
                        if (c.levels <= 1) {
                          if (d.classes.length > 1) d.classes.splice(idx, 1);
                          return;
                        }
                        c.levels -= 1;
                        c.hp = c.hp.slice(0, c.levels);
                      })
                    }
                    className="h-8 w-8 rounded-full bg-surface-2 text-lg"
                    title={
                      entry.levels <= 1 && doc.classes.length > 1
                        ? 'Remove this class'
                        : 'Remove a level'
                    }
                  >
                    −
                  </button>
                  <button
                    type="button"
                    onClick={() => levelUpClass(idx)}
                    disabled={totalLevels >= 20}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    Level up
                  </button>
                </div>
              </div>

              {doc.classes.length > 1 && reqText !== undefined && (
                <p className={`text-xs ${reqMet ? 'text-ink-muted' : 'text-amber-300'}`}>
                  Multiclass requirement: {reqText}
                  {reqMet ? ' ✓' : ' — not met (allowed anyway, ask your DM)'}
                </p>
              )}

              {hpMethod === 'rolled' && (
                <div className="flex flex-wrap gap-1.5">
                  {entry.hp.map((v, i) =>
                    idx === 0 && i === 0 ? (
                      <span
                        key="hp-l1"
                        className="rounded bg-surface-2 px-2 py-1 font-mono text-xs text-ink-muted"
                        title="Level 1 is always the maximum"
                      >
                        L1: {faces}
                      </span>
                    ) : (
                      <span
                        key={`hp-l${String(i + 1)}`}
                        className="flex items-center gap-1 rounded bg-surface-2 px-1.5 py-1 text-xs"
                      >
                        L{i + 1}:
                        <input
                          inputMode="numeric"
                          value={typeof v === 'number' ? v : ''}
                          placeholder="?"
                          onChange={(e) => {
                            const n = Number.parseInt(e.target.value, 10);
                            update((d) => {
                              const c = d.classes[idx];
                              if (c !== undefined) c.hp[i] = Number.isNaN(n) ? 'avg' : n;
                            });
                          }}
                          className="w-8 bg-transparent text-center font-mono outline-none"
                        />
                        <button
                          type="button"
                          title={`Roll 1d${faces}`}
                          onClick={() => {
                            const r = roll(`1d${faces}`, {
                              label: `${entry.ref.name} level ${i + 1} hit points (d${faces})`,
                            });
                            rollLogStore.getState().append(r);
                            update((d) => {
                              const c = d.classes[idx];
                              if (c !== undefined) c.hp[i] = r.total;
                            });
                          }}
                          className="text-ink-muted hover:text-ink"
                        >
                          <Dices size={13} />
                        </button>
                      </span>
                    ),
                  )}
                </div>
              )}

              {subclasses.length > 0 && (
                <details open={entry.subclass === undefined}>
                  <summary className="cursor-pointer text-xs text-ink-muted">
                    Subclass: {entry.subclass?.name ?? 'none picked'}
                  </summary>
                  <div className="pt-2">
                    <EntityCardList
                      entities={subclasses}
                      selectedUid={
                        entry.subclass !== undefined
                          ? `${entry.subclass.name}|${entry.subclass.source}`.toLowerCase()
                          : undefined
                      }
                      onSelect={(e) =>
                        update((d) => {
                          const c = d.classes[idx];
                          if (c !== undefined)
                            c.subclass = { name: nameOf(e), source: sourceOf(e) };
                        })
                      }
                      onDeselect={() =>
                        update((d) => {
                          const c = d.classes[idx];
                          if (c !== undefined) c.subclass = undefined;
                        })
                      }
                    />
                  </div>
                </details>
              )}
            </div>
          );
        })}

        <details>
          <summary className="cursor-pointer text-xs text-ink-muted">
            {doc.classes.length === 0 ? 'Pick a class' : 'Add a class (multiclass)'}
          </summary>
          <div className="pt-2">
            <EntityCardList
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
        <EntityCardList
          entities={races}
          selectedUid={
            doc.race !== undefined ? `${doc.race.name}|${doc.race.source}`.toLowerCase() : undefined
          }
          onSelect={(e) =>
            update((d) => {
              d.race = { name: nameOf(e), source: sourceOf(e) };
              d.subrace = undefined;
            })
          }
        />
        {subraces.length > 0 && (
          <>
            <span className="text-xs text-ink-muted">Subrace</span>
            <EntityCardList
              entities={subraces}
              selectedUid={
                doc.subrace !== undefined
                  ? `${doc.subrace.name}|${doc.subrace.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) =>
                update((d) => void (d.subrace = { name: nameOf(e), source: sourceOf(e) }))
              }
              onDeselect={() => update((d) => void (d.subrace = undefined))}
            />
          </>
        )}
      </Section>

      <Section title="Abilities" summary={ABILITIES.map((a) => doc.abilities.base[a]).join('/')}>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {ABILITIES.map((a) => {
            const final = sheet.abilities[a];
            return (
              <div key={a} className="flex flex-col items-center gap-1 rounded-lg bg-surface-2 p-2">
                <span className="text-[10px] font-semibold uppercase text-ink-muted">{a}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        (d) => void (d.abilities.base[a] = Math.max(3, d.abilities.base[a] - 1)),
                      )
                    }
                    className="h-7 w-7 rounded-full bg-surface"
                  >
                    −
                  </button>
                  <span className="w-6 text-center font-bold">{doc.abilities.base[a]}</span>
                  <button
                    type="button"
                    onClick={() =>
                      update(
                        (d) => void (d.abilities.base[a] = Math.min(18, d.abilities.base[a] + 1)),
                      )
                    }
                    className="h-7 w-7 rounded-full bg-surface"
                  >
                    +
                  </button>
                </div>
                <span className="text-xs text-ink-muted">
                  {final.value !== doc.abilities.base[a] ? `→ ${final.value} ` : ''}(
                  {final.mod >= 0 ? '+' : ''}
                  {final.mod})
                </span>
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Background" summary={doc.background?.name ?? 'none'}>
        <EntityCardList
          entities={backgrounds}
          selectedUid={
            doc.background !== undefined
              ? `${doc.background.name}|${doc.background.source}`.toLowerCase()
              : undefined
          }
          onSelect={(e) =>
            update((d) => void (d.background = { name: nameOf(e), source: sourceOf(e) }))
          }
        />
      </Section>

      <Section
        id="build-choices"
        title="Choices"
        summary={
          sheet.pending.length > 0
            ? `${sheet.pending.length} pending`
            : `${sheet.resolvedChoices.length} made`
        }
        defaultOpen={sheet.pending.length > 0}
      >
        {sheet.pending.map((prompt) =>
          // Subclass is chosen in the Classes section above; point there.
          prompt.kind === 'generic' && prompt.options.length === 0 ? (
            <p
              key={prompt.id}
              className="rounded-lg bg-surface-2/60 px-3 py-2 text-sm text-amber-200"
            >
              {prompt.label} — choose it in the Classes section above.
            </p>
          ) : (
            <ChoicePromptRenderer
              key={prompt.id}
              prompt={prompt}
              value={doc.choices[prompt.id]}
              onChange={(v) => update((d) => void (d.choices[prompt.id] = v))}
            />
          ),
        )}
        {sheet.resolvedChoices.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-ink-muted">Made choices</span>
            {sheet.resolvedChoices.map(({ prompt, selected }) => (
              <div
                key={prompt.id}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate">{prompt.label}</div>
                  <div className="truncate text-xs text-ink-muted">
                    {prompt.origin.label} · {selected.join(', ')}
                  </div>
                </div>
                <button
                  type="button"
                  title="Change this pick"
                  onClick={() =>
                    update((d) => {
                      delete d.choices[prompt.id];
                      // dependent follow-up choices (asi feat picks etc.) reset too
                      for (const key of Object.keys(d.choices)) {
                        if (key.startsWith(`${prompt.id}:`)) delete d.choices[key];
                      }
                    })
                  }
                  className="flex shrink-0 items-center gap-1 rounded border border-surface-2 px-2 py-1 text-xs text-ink-muted hover:text-ink"
                >
                  <RefreshCcw size={12} /> change
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section
        title="Derived stats & skills"
        summary={`HP ${sheet.maxHp.value} · AC ${sheet.ac.value}`}
      >
        <p className="text-xs text-ink-muted">Tap any value to see exactly how it's calculated.</p>
        <div className="grid grid-cols-3 gap-2">
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
                <button type="button" className="rounded-lg bg-surface-2 p-2 text-center">
                  <div className="text-lg font-bold">{value.value}</div>
                  <div className="text-[10px] text-ink-muted">{label}</div>
                </button>
              }
            />
          ))}
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold uppercase text-ink-muted">Saving throws</span>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {ABILITIES.map((a) => (
              <BreakdownSheet
                key={a}
                title={`${a.toUpperCase()} save`}
                value={sheet.saves[a].total}
                trigger={
                  <button
                    type="button"
                    className={`rounded-lg px-2 py-1.5 text-sm ${
                      sheet.saves[a].prof
                        ? 'bg-accent-deep/40 font-semibold'
                        : 'bg-surface-2 text-ink-muted'
                    }`}
                  >
                    {a.toUpperCase()} {sheet.saves[a].total.value >= 0 ? '+' : ''}
                    {sheet.saves[a].total.value}
                  </button>
                }
              />
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase text-ink-muted">Skills</span>
          <div className="flex flex-col rounded-lg bg-surface-2/40">
            {SKILLS.map(({ name }) => {
              const s = sheet.skills[name];
              if (s === undefined) return null;
              return (
                <BreakdownSheet
                  key={name}
                  title={`${name} check`}
                  value={s.total}
                  trigger={
                    <button
                      type="button"
                      className="flex items-center justify-between border-b border-surface-2/40 px-3 py-1.5 text-left text-sm last:border-b-0"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            s.prof === 2
                              ? 'bg-amber-300'
                              : s.prof === 1
                                ? 'bg-accent'
                                : 'bg-surface-2'
                          }`}
                        />
                        {name}
                        <span className="text-xs uppercase text-ink-muted">{s.ability}</span>
                      </span>
                      <span className="font-mono font-semibold">
                        {s.total.value >= 0 ? '+' : ''}
                        {s.total.value}
                      </span>
                    </button>
                  }
                />
              );
            })}
          </div>
        </div>

        {sheet.grantedSpells.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase text-ink-muted">
              Innate & granted spells
            </span>
            <div className="flex flex-col rounded-lg bg-surface-2/40">
              {sheet.grantedSpells.map((g) => (
                <Link
                  key={`${g.name}|${g.source}`}
                  to={`/library/spell/${encodeURIComponent(`${g.name}|${g.source}`.toLowerCase())}`}
                  className="flex items-center justify-between border-b border-surface-2/40 px-3 py-1.5 text-sm last:border-b-0"
                >
                  <span className="capitalize">{g.name}</span>
                  <span className="text-xs text-ink-muted">
                    {g.origin}
                    {g.ability !== undefined ? ` · ${g.ability.toUpperCase()}` : ''}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </Section>

      {sheet.warnings.length > 0 && (
        <details className="rounded-lg bg-surface p-3 text-xs text-ink-muted">
          <summary className="cursor-pointer text-sm">
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
