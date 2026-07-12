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
import { subclassUnlockLevel } from '@/engine/multiclass';
import { ABILITIES, type CharacterDoc, newCharacterDoc } from '@/engine/types';
import { SpellManager } from '@/features/sheet/SpellManager';
import { pruneChoicesFor } from '@/lib/pruneChoices';
import { EntityCardList } from '@/ui/EntityCardList';
import { ChoicePromptRenderer } from './ChoicePromptRenderer';
import {
  backgroundBlurb,
  classAbilityHint,
  classBlurb,
  makeSubclassBlurb,
  pointBuyFocusFor,
  raceBlurb,
  standardArrayFor,
} from './pickerHints';
import {
  bundleToEquipment,
  defaultStrings,
  type EquipmentBundle,
  itemsForEquipmentType,
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

const DRAFT_KEY = 'dnd-sheet:creator-draft';

export function Component() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const step = (params.get('step') ?? 'basics') as Step;
  const registry = useRegistry(['essentials']);
  // The in-progress draft survives reloads via sessionStorage.
  const [doc, setDoc] = useState<CharacterDoc>(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT_KEY);
      if (raw !== null) return JSON.parse(raw) as CharacterDoc;
    } catch {
      // corrupted draft — start fresh
    }
    return newCharacterDoc(crypto.randomUUID(), '', DATA_TAG);
  });
  const [bundleChoices, setBundleChoices] = useState<Record<string, string>>({});
  // Concrete picks for "any martial weapon"-style slots, keyed `${group}:${idx}`.
  const [slotPicks, setSlotPicks] = useState<Record<string, string>>({});

  useEffect(() => {
    void ensureTypePacks('class');
    void ensureTypePacks('item');
  }, []);

  const ctx = registry !== null ? engineContextFor(registry) : null;
  const sheet = useMemo(() => (ctx !== null ? deriveSheet(doc, ctx) : null), [doc, ctx]);

  const update = (recipe: (d: CharacterDoc) => void) => {
    setDoc((d) => {
      const draft = structuredClone(d);
      recipe(draft);
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      } catch {
        // storage full/unavailable — draft just won't survive a reload
      }
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

  /** Rebuild doc.equipment from the current bundle + slot selections. */
  const applyEquipment = (choices: Record<string, string>, picks: Record<string, string>) => {
    update((d) => {
      const chosen: (typeof d.equipment)[number][] = [];
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
      }
      d.equipment = chosen;
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
    });
  };

  const pickBundle = (groupKey: string, bundleKey: string) => {
    const next = { ...bundleChoices, [groupKey]: bundleKey };
    setBundleChoices(next);
    applyEquipment(next, slotPicks);
  };
  const pickSlot = (slotKey: string, uid: string) => {
    const next = { ...slotPicks, [slotKey]: uid };
    setSlotPicks(next);
    applyEquipment(bundleChoices, next);
  };

  /**
   * Step navigation that never loses work: walking off the equipment step
   * grants the highlighted defaults if the player didn't touch anything.
   */
  const navStep = (s: Step) => {
    if (step === 'equipment' && doc.equipment.length === 0 && allEqGroups.length > 0) {
      applyEquipment(bundleChoices, slotPicks);
    }
    goto(s);
  };

  const abilitiesUntouched = ABILITIES.every((a) => doc.abilities.base[a] === 10);

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
              dedupe
              describe={classBlurb}
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
                      onDeselect={() =>
                        update((d) => {
                          const c = d.classes[0];
                          if (c !== undefined) c.subclass = undefined;
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
              dedupe
              describe={raceBlurb}
              entities={races}
              selectedUid={
                doc.race !== undefined
                  ? `${doc.race.name}|${doc.race.source}`.toLowerCase()
                  : undefined
              }
              onSelect={(e) =>
                update((d) => {
                  if (d.race !== undefined) pruneChoicesFor(d, 'race', d.race);
                  if (d.subrace !== undefined) pruneChoicesFor(d, 'subrace', d.subrace);
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
                    update((d) => {
                      if (d.subrace !== undefined) pruneChoicesFor(d, 'subrace', d.subrace);
                      d.subrace = { name: nameOf(e), source: sourceOf(e) };
                    })
                  }
                  onDeselect={() =>
                    update((d) => {
                      if (d.subrace !== undefined) pruneChoicesFor(d, 'subrace', d.subrace);
                      d.subrace = undefined;
                    })
                  }
                />
              </div>
            )}
          </div>
        );

      case 'abilities': {
        const cost = pointBuyCost(doc.abilities.base);
        const className = doc.classes[0]?.ref.name;
        const hint = className !== undefined ? classAbilityHint(className) : undefined;
        const autoArray = className !== undefined ? standardArrayFor(className) : undefined;
        return (
          <div className="flex flex-col gap-4">
            {hint !== undefined && (
              <p className="rounded-lg bg-surface p-3 text-sm text-ink-muted">
                💡 As a <strong className="text-ink">{className}</strong>, put your highest score in{' '}
                <strong className="text-ink">{hint}</strong> — they power your attacks and key
                features.
              </p>
            )}
            {autoArray !== undefined && (
              <button
                type="button"
                onClick={() => update((d) => void (d.abilities.base = { ...autoArray }))}
                className="rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white"
              >
                Auto-assign the standard array for a {className}
              </button>
            )}
            {abilitiesUntouched && (
              <p className="rounded-lg border border-amber-300/40 bg-amber-300/10 px-3 py-2 text-sm text-amber-200">
                Scores aren't assigned yet — every ability is still 10. Tap auto-assign or set them
                below.
              </p>
            )}
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
              <div className="flex flex-col gap-2">
                <p
                  className={`text-sm ${cost !== undefined && cost > POINT_BUY_BUDGET ? 'text-accent' : 'text-ink-muted'}`}
                >
                  Points: {cost ?? '—'} / {POINT_BUY_BUDGET}
                  {cost === undefined && ' (scores must stay 8–15)'}
                </p>
                {(() => {
                  const focus = className !== undefined ? pointBuyFocusFor(className) : undefined;
                  if (focus === undefined) return null;
                  return (
                    <button
                      type="button"
                      onClick={() => update((d) => void (d.abilities.base = { ...focus }))}
                      className="self-start rounded-lg bg-surface-2 px-3 py-1.5 text-xs font-semibold"
                    >
                      Focus a {className} (15/15/15 in key abilities)
                    </button>
                  );
                })()}
              </div>
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
            dedupe
            describe={backgroundBlurb}
            entities={backgrounds}
            selectedUid={
              doc.background !== undefined
                ? `${doc.background.name}|${doc.background.source}`.toLowerCase()
                : undefined
            }
            onSelect={(e) =>
              update((d) => {
                if (d.background !== undefined) pruneChoicesFor(d, 'background', d.background);
                d.background = { name: nameOf(e), source: sourceOf(e) };
              })
            }
          />
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
        // Pending AND resolved prompts render together in a stable order, so
        // finishing a pick never reflows the list under the player's finger
        // and every choice stays revisable in place.
        const prompts = [
          ...(sheet?.pending ?? []),
          ...(sheet?.resolvedChoices.map((r) => r.prompt) ?? []),
        ].sort((a, b) => a.id.localeCompare(b.id));
        return (
          <div className="flex flex-col gap-3">
            {sheet !== null && sheet.pending.length === 0 && (
              <p className="rounded-lg bg-surface p-4 text-sm text-emerald-300">
                All choices made — review them below or keep going.
              </p>
            )}
            {prompts.map((prompt) => (
              <ChoicePromptRenderer
                key={prompt.id}
                prompt={prompt}
                value={doc.choices[prompt.id]}
                onChange={(v) => update((d) => void (d.choices[prompt.id] = v))}
              />
            ))}
          </div>
        );
      }

      case 'review': {
        const create = async () => {
          const final = structuredClone(doc);
          if (final.name.trim() === '') final.name = 'Unnamed hero';
          final.play.currentHp = sheet?.maxHp.value ?? 0;
          await characterRepo.put(final);
          sessionStorage.removeItem(DRAFT_KEY);
          navigate(`/c/${final.id}`, { replace: true });
        };
        // Everything a new player might have missed, each one tap from its fix.
        const issues: Array<{ key: string; text: string; step: Step }> = [];
        if (doc.classes.length === 0) {
          issues.push({ key: 'class', text: 'No class picked yet', step: 'class' });
        }
        if (abilitiesUntouched) {
          issues.push({
            key: 'abilities',
            text: 'Ability scores not assigned (all still 10)',
            step: 'abilities',
          });
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
              {issues.length > 0 ? ' anyway' : ''}
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
            <button
              type="button"
              onClick={() => navStep('choices')}
              className="text-amber-300 underline decoration-dotted underline-offset-2"
              title="Decisions like skills and languages are waiting on the Choices step"
            >
              {sheet.pending.length} pending →
            </button>
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
            className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white"
          >
            Next <ArrowRight size={16} />
          </button>
        )}
      </nav>
    </main>
  );
}
