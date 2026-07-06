import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { DATA_TAG } from '@/data5e/config';
import type { Entity } from '@/data5e/copyMod';
import { engineContextFor } from '@/data5e/engineAdapter';
import { useRegistry } from '@/data5e/hooks';
import { ensureTypePacks } from '@/data5e/loader';
import { filterByRulesVersion } from '@/data5e/rulesVersion';
import { characterRepo } from '@/db/characterRepo';
import { POINT_BUY_BUDGET, pointBuyCost, STANDARD_ARRAY } from '@/engine/calc/abilities';
import { deriveSheet } from '@/engine/derive';
import { ABILITIES, type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { SpellManager } from '@/features/sheet/SpellManager';
import { SourceBadge } from '@/ui/SourceBadge';
import { ChoicePromptRenderer } from './ChoicePromptRenderer';
import {
  bundleToEquipment,
  defaultStrings,
  type EquipmentBundle,
  parseStartingEquipment,
} from './startingEquipment';

const STEPS = [
  'basics',
  'class',
  'species',
  'abilities',
  'background',
  'equipment',
  'spells',
  'choices',
  'review',
] as const;
type Step = (typeof STEPS)[number];

const nameOf = (e: Entity) => String(e.name ?? '?');
const sourceOf = (e: Entity) => String(e.source ?? '?');
const uidOf = (e: Entity) => `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();

function EntityCardList({
  entities,
  selectedUid,
  onSelect,
}: {
  entities: readonly Entity[];
  selectedUid?: string;
  onSelect: (e: Entity) => void;
}) {
  const [filter, setFilter] = useState('');
  const list = useMemo(() => {
    const sorted = [...entities].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const f = filter.trim().toLowerCase();
    return f === '' ? sorted : sorted.filter((e) => nameOf(e).toLowerCase().includes(f));
  }, [entities, filter]);
  return (
    <div className="flex flex-col gap-2">
      {entities.length > 10 && (
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="rounded-lg bg-surface px-3 py-2 text-sm outline-none placeholder:text-ink-muted"
        />
      )}
      <div className="grid max-h-96 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
        {list.map((e) => (
          <button
            key={uidOf(e)}
            type="button"
            onClick={() => onSelect(e)}
            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm ${
              selectedUid === uidOf(e)
                ? 'border-accent bg-accent-deep/40 font-semibold'
                : 'border-surface-2 bg-surface hover:bg-surface-2'
            }`}
          >
            <span className="truncate">{nameOf(e)}</span>
            <SourceBadge source={sourceOf(e)} />
          </button>
        ))}
      </div>
    </div>
  );
}

export function Component() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const step = (params.get('step') ?? 'basics') as Step;
  const registry = useRegistry(['essentials']);
  const [doc, setDoc] = useState<CharacterDoc>(() =>
    newCharacterDoc(crypto.randomUUID(), '', DATA_TAG),
  );
  const [bundleChoices, setBundleChoices] = useState<Record<string, string>>({});

  useEffect(() => {
    void ensureTypePacks('class');
  }, []);

  const ctx = registry !== null ? engineContextFor(registry) : null;
  const sheet = useMemo(() => (ctx !== null ? deriveSheet(doc, ctx) : null), [doc, ctx]);

  const update = (recipe: (d: CharacterDoc) => void) => {
    setDoc((d) => {
      const draft = structuredClone(d);
      recipe(draft);
      return draft;
    });
  };

  const goto = (s: Step) => setParams({ step: s }, { replace: false });
  const stepIdx = STEPS.indexOf(step);

  if (registry === null) {
    return <main className="p-4 text-sm text-ink-muted">Loading game data…</main>;
  }

  const classes = filterByRulesVersion([...registry.byType('class')], doc.rulesVersion);
  const classEntity =
    doc.classes[0] !== undefined
      ? registry.get('class', doc.classes[0].ref.name, doc.classes[0].ref.source)
      : undefined;
  const subclasses =
    doc.classes[0] !== undefined
      ? filterByRulesVersion(
          registry
            .byType('subclass')
            .filter(
              (s) =>
                String(s.className).toLowerCase() === doc.classes[0]?.ref.name.toLowerCase() &&
                String(s.classSource).toLowerCase() === doc.classes[0]?.ref.source.toLowerCase(),
            ),
          doc.rulesVersion,
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
                  onClick={() =>
                    update((d) => {
                      d.rulesVersion = v;
                      d.classes = [];
                      d.race = undefined;
                      d.subrace = undefined;
                      d.background = undefined;
                      d.choices = {};
                    })
                  }
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm ${
                    doc.rulesVersion === v
                      ? 'border-accent bg-accent-deep/40 font-semibold'
                      : 'border-surface-2 bg-surface'
                  }`}
                >
                  {label}
                </button>
              ))}
            </fieldset>
          </div>
        );

      case 'class': {
        const entry = doc.classes[0];
        return (
          <div className="flex flex-col gap-4">
            <EntityCardList
              entities={classes}
              selectedUid={
                entry !== undefined
                  ? `${entry.ref.name}|${entry.ref.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) =>
                update((d) => {
                  d.classes = [
                    {
                      ref: { name: nameOf(e), source: sourceOf(e) },
                      levels: d.classes[0]?.levels ?? 1,
                      hp: d.classes[0]?.hp ?? ['avg'],
                    },
                  ];
                  d.choices = {};
                })
              }
            />
            {entry !== undefined && (
              <>
                <label className="flex items-center justify-between rounded-lg bg-surface px-3 py-2.5">
                  <span className="text-sm font-semibold">Level</span>
                  <span className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        update((d) => {
                          const c = d.classes[0];
                          if (c === undefined || c.levels <= 1) return;
                          c.levels -= 1;
                          c.hp = c.hp.slice(0, c.levels);
                        })
                      }
                      className="h-9 w-9 rounded-full bg-surface-2 text-lg"
                    >
                      −
                    </button>
                    <span className="w-8 text-center text-lg font-bold">{entry.levels}</span>
                    <button
                      type="button"
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
                      +
                    </button>
                  </span>
                </label>
                {subclasses.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-semibold">Subclass</span>
                    <EntityCardList
                      entities={subclasses}
                      selectedUid={
                        entry.subclass !== undefined
                          ? `${entry.subclass.name}|${entry.subclass.source}`.toLowerCase()
                          : undefined
                      }
                      onSelect={(e) =>
                        update((d) => {
                          const c = d.classes[0];
                          if (c !== undefined)
                            c.subclass = { name: nameOf(e), source: sourceOf(e) };
                        })
                      }
                    />
                  </div>
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
              entities={races}
              selectedUid={
                doc.race !== undefined
                  ? `${doc.race.name}|${doc.race.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) =>
                update((d) => {
                  d.race = { name: nameOf(e), source: sourceOf(e) };
                  d.subrace = undefined;
                })
              }
            />
            {subraces.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Subrace</span>
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
                />
              </div>
            )}
          </div>
        );

      case 'abilities': {
        const cost = pointBuyCost(doc.abilities.base);
        return (
          <div className="flex flex-col gap-4">
            <div className="flex gap-1.5">
              {(['standard', 'pointbuy', 'manual'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() =>
                    update((d) => {
                      d.abilities.method = m;
                      if (m === 'pointbuy')
                        d.abilities.base = { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 };
                    })
                  }
                  className={`rounded-full border px-3 py-1.5 text-sm ${
                    doc.abilities.method === m
                      ? 'border-accent bg-accent-deep/40 font-semibold'
                      : 'border-surface-2 text-ink-muted'
                  }`}
                >
                  {m === 'standard' ? 'Standard array' : m === 'pointbuy' ? 'Point buy' : 'Manual'}
                </button>
              ))}
            </div>
            {doc.abilities.method === 'pointbuy' && (
              <p
                className={`text-sm ${cost !== undefined && cost > POINT_BUY_BUDGET ? 'text-accent' : 'text-ink-muted'}`}
              >
                Points: {cost ?? '—'} / {POINT_BUY_BUDGET}
                {cost === undefined && ' (scores must stay 8–15)'}
              </p>
            )}
            {doc.abilities.method === 'standard' && (
              <p className="text-sm text-ink-muted">
                Assign {STANDARD_ARRAY.join(' / ')} across your abilities.
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {ABILITIES.map((a) => {
                const final = sheet?.abilities[a];
                return (
                  <div
                    key={a}
                    className="flex flex-col items-center gap-1 rounded-lg bg-surface p-3"
                  >
                    <span className="text-xs font-semibold uppercase text-ink-muted">{a}</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            (d) =>
                              void (d.abilities.base[a] = Math.max(3, d.abilities.base[a] - 1)),
                          )
                        }
                        className="h-8 w-8 rounded-full bg-surface-2"
                      >
                        −
                      </button>
                      <span className="w-7 text-center text-lg font-bold">
                        {doc.abilities.base[a]}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          update(
                            (d) =>
                              void (d.abilities.base[a] = Math.min(18, d.abilities.base[a] + 1)),
                          )
                        }
                        className="h-8 w-8 rounded-full bg-surface-2"
                      >
                        +
                      </button>
                    </div>
                    {final !== undefined && final.value !== doc.abilities.base[a] && (
                      <span className="text-xs text-emerald-300">
                        → {final.value} ({final.mod >= 0 ? '+' : ''}
                        {final.mod})
                      </span>
                    )}
                    {final !== undefined && final.value === doc.abilities.base[a] && (
                      <span className="text-xs text-ink-muted">
                        mod {final.mod >= 0 ? '+' : ''}
                        {final.mod}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      }

      case 'background':
        return (
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
        );

      case 'equipment': {
        const groups = parseStartingEquipment(classEntity);
        const bgEntity =
          doc.background !== undefined
            ? registry.get('background', doc.background.name, doc.background.source)
            : undefined;
        const bgGroups = parseStartingEquipment(bgEntity);
        const fallback = groups.length === 0 ? defaultStrings(classEntity) : [];
        const allGroups: Array<{ source: string; groupIdx: number; bundles: EquipmentBundle[] }> = [
          ...groups.map((bundles, groupIdx) => ({ source: 'class', groupIdx, bundles })),
          ...bgGroups.map((bundles, groupIdx) => ({ source: 'bg', groupIdx, bundles })),
        ];
        const apply = () => {
          update((d) => {
            const chosen: EquipmentBundle[] = [];
            for (const g of allGroups) {
              const key = `${g.source}:${g.groupIdx}`;
              const pick = bundleChoices[key] ?? g.bundles[0]?.key;
              const bundle = g.bundles.find((b) => b.key === pick);
              if (bundle !== undefined) chosen.push(bundle);
            }
            d.equipment = chosen.flatMap(bundleToEquipment);
            // Auto-equip armor, shield, and weapons for the live preview.
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
          });
        };
        return (
          <div className="flex flex-col gap-4">
            {allGroups.map((g) => {
              const key = `${g.source}:${g.groupIdx}`;
              const current = bundleChoices[key] ?? g.bundles[0]?.key;
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
                      onClick={() => setBundleChoices((c) => ({ ...c, [key]: b.key }))}
                      className={`rounded-lg border px-3 py-2 text-left text-sm ${
                        current === b.key ? 'border-accent bg-accent-deep/30' : 'border-surface-2'
                      }`}
                    >
                      {b.label}
                    </button>
                  ))}
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
            {allGroups.length > 0 && (
              <button
                type="button"
                onClick={apply}
                className="rounded-lg bg-surface-2 px-4 py-2.5 text-sm font-semibold"
              >
                Grant selected equipment ({doc.equipment.length} items now)
              </button>
            )}
          </div>
        );
      }

      case 'spells':
        return sheet !== null ? (
          <SpellManager doc={doc} sheet={sheet} update={update} allowCasting={false} />
        ) : null;

      case 'choices':
        return (
          <div className="flex flex-col gap-3">
            {sheet !== null && sheet.pending.length === 0 && (
              <p className="rounded-lg bg-surface p-4 text-sm text-emerald-300">
                All choices made — nothing pending.
              </p>
            )}
            {sheet?.pending.map((prompt) => (
              <ChoicePromptRenderer
                key={prompt.id}
                prompt={prompt}
                value={doc.choices[prompt.id]}
                onChange={(v) => update((d) => void (d.choices[prompt.id] = v))}
              />
            ))}
          </div>
        );

      case 'review': {
        const create = async () => {
          const final = structuredClone(doc);
          if (final.name.trim() === '') final.name = 'Unnamed hero';
          final.play.currentHp = sheet?.maxHp.value ?? 0;
          await characterRepo.put(final);
          navigate(`/c/${final.id}`, { replace: true });
        };
        return (
          <div className="flex flex-col gap-4">
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
            {sheet !== null && sheet.pending.length > 0 && (
              <button
                type="button"
                onClick={() => goto('choices')}
                className="rounded-lg border border-amber-300/40 bg-surface p-3 text-left text-sm text-amber-300"
              >
                {sheet.pending.length} choice{sheet.pending.length > 1 ? 's' : ''} still pending —
                tap to resolve
              </button>
            )}
            {sheet !== null && sheet.warnings.length > 0 && (
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
            <button
              type="button"
              onClick={() => void create()}
              className="flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-3 font-semibold text-white"
            >
              <Check size={18} /> Create character
            </button>
          </div>
        );
      }
    }
  };

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 pb-24">
      <header className="flex items-center gap-3">
        <Link to="/" className="text-ink-muted hover:text-ink">
          <ArrowLeft size={20} />
        </Link>
        <h1 className="text-xl font-bold capitalize">
          {step === 'species' ? 'Species / Race' : step}
        </h1>
        <span className="text-sm text-ink-muted">
          {stepIdx + 1}/{STEPS.length}
        </span>
      </header>

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
            <span className="text-amber-300">{sheet.pending.length} pending</span>
          )}
        </div>
      )}

      {stepBody()}

      {/* Step navigation */}
      <nav className="fixed inset-x-0 bottom-0 flex gap-2 border-t border-surface-2 bg-surface p-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <button
          type="button"
          disabled={stepIdx === 0}
          onClick={() => {
            const prev = STEPS[stepIdx - 1];
            if (prev !== undefined) goto(prev);
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
              if (next !== undefined) goto(next);
            }}
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white"
          >
            Next <ArrowRight size={16} />
          </button>
        )}
      </nav>
    </main>
  );
}
