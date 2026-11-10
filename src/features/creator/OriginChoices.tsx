import { Info, RefreshCcw } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Entity } from '@/data5e/copyMod';
import { useRegistryRefreshing, useTypePacks } from '@/data5e/hooks';
import type { EntityRegistry } from '@/data5e/normalize';
import { filterByRulesVersion, type RulesVersion } from '@/data5e/rulesVersion';
import {
  applySourcePolicy,
  OUTSIDE_CHARACTER_ADVISORY,
  type PolicyScope,
  policyAllows,
  type SourcePolicy,
} from '@/data5e/sourceFilter';
import { sourceName } from '@/data5e/sourceNames';
import { classListCheck } from '@/data5e/spellLookup';
import { parseSpellRef } from '@/engine/effects/additionalSpells';
import { subclassPromptId } from '@/engine/effects/class';
import type {
  CharacterDoc,
  ChoiceOption,
  ChoicePrompt,
  DerivedSheet,
  EffectOrigin,
} from '@/engine/types';
import { SpellInfoSheet } from '@/features/sheet/SpellInfoSheet';
import { pruneAsiFeatPicks } from '@/lib/pruneChoices';
import { useClassLookup } from '@/lib/useClassLookup';
import { usePickSourcePolicy } from '@/lib/usePickSourcePolicy';
import { buttonClass } from '@/ui/Button';
import { EntityInfoSheet } from '@/ui/EntityInfoSheet';
import { FeatureInfoSheet } from '@/ui/FeatureInfoSheet';
import { PackProblem } from '@/ui/PackProblem';
import { cardClass } from '@/ui/surfaces';
import { ChoicePromptRenderer } from './ChoicePromptRenderer';
import { fillSpellPrompt } from './spellPrompt';

/**
 * Narrow an entity-backed prompt to what the player should be choosing from:
 * their rules version (the engine builds feat and optional-feature lists from
 * every edition) and their source settings. Keeps any already-chosen or unresolvable option so
 * a pick never vanishes.
 *
 * These prompts have no "show hidden anyway" affordance, and some of them are
 * mandatory, so each narrowing is skipped outright when it would leave nothing
 * to pick. A shorter list is the goal; a dead end is not. The version one comes
 * up when a 2014 character holds a 2024 grant: a species offering a feat from a
 * category only 2024 books print has nothing in that character's own edition.
 *
 * Under a character's own list (`scope` 'character'), an option that stays
 * listed from a book outside it (already chosen, or kept by that fallback)
 * says so in its advisory, after any prerequisite advisory it already has.
 */
export function filterEntityPrompt(
  prompt: ChoicePrompt,
  registry: EntityRegistry,
  version: RulesVersion,
  policy: SourcePolicy,
  value: string[] | string | number | undefined,
  scope: PolicyScope = 'device',
): ChoicePrompt {
  const type = prompt.kind === 'feat' ? 'feat' : 'optionalfeature';
  const selected = new Set(
    Array.isArray(value) ? value.map(String) : value !== undefined ? [String(value)] : [],
  );
  const entities: Entity[] = [];
  const sourceById = new Map<string, string>();
  for (const o of prompt.options) {
    const [name, source] = o.id.split('|');
    const found = name !== undefined ? registry.get(type, name, source) : undefined;
    if (found !== undefined) {
      entities.push(found);
      sourceById.set(o.id, String(found.source));
    }
  }
  const uidsOf = (list: readonly Entity[]) =>
    new Set(list.map((e) => `${String(e.name)}|${String(e.source)}`.toLowerCase()));

  // Both span editions. The engine offers every feat, and every optional
  // feature of the class's types, which the 2014 and 2024 printings share
  // (invocations are "EI" in both), so a 2014 Warlock was offered the XPHB
  // Agonizing Blast beside the PHB one.
  const byVersion = filterByRulesVersion(entities, version);
  const candidates = byVersion.length > 0 ? byVersion : entities;
  const bySource = applySourcePolicy(candidates, policy, (e) => String(e.source));
  const kept = uidsOf(bySource.length > 0 ? bySource : candidates);

  const options = prompt.options.filter(
    (o) => selected.has(o.id) || !sourceById.has(o.id) || kept.has(o.id),
  );
  if (scope !== 'character') return { ...prompt, options };
  return {
    ...prompt,
    options: options.map((o) => {
      const source = sourceById.get(o.id);
      if (source === undefined || policyAllows(policy, source)) return o;
      const advisory =
        o.advisory !== undefined
          ? `${o.advisory} ${OUTSIDE_CHARACTER_ADVISORY}.`
          : `${OUTSIDE_CHARACTER_ADVISORY}.`;
      return { ...o, advisory };
    }),
  };
}

/** The ⓘ on an option card: opens its rules text without picking it. */
function infoTrigger(o: ChoiceOption) {
  return (
    <button
      type="button"
      aria-label={`${o.label} details`}
      title="Full description"
      className="tap -m-2.5 rounded-full text-ink-muted hover:bg-surface-hover hover:text-ink"
    >
      <Info size={16} />
    </button>
  );
}

/** ⓘ full-description drawer for a feat option (id is `name|source`). */
function featOptionInfo(registry: EntityRegistry) {
  return (o: ChoiceOption) => {
    const [name, source] = o.id.split('|');
    const feat = name !== undefined ? registry.get('feat', name, source) : undefined;
    if (feat === undefined) return null;
    return (
      <EntityInfoSheet
        type="feat"
        entity={feat}
        subtitle={`${String(feat.name)} · ${sourceName(String(feat.source))}`}
        trigger={infoTrigger(o)}
      />
    );
  };
}

/** ⓘ rules text for a branch of a pick-one feature, which the engine carries. */
function featureOptionInfo(prompt: ChoicePrompt) {
  return (o: ChoiceOption) =>
    o.entries === undefined ? null : (
      <FeatureInfoSheet
        title={o.label}
        subtitle={`${prompt.origin.label} · ${prompt.label}`}
        entries={o.entries}
        trigger={infoTrigger(o)}
      />
    );
}

/** ⓘ rules text for a spell option (id is `name|source`, or a name alone). */
function spellOptionInfo(version: CharacterDoc['rulesVersion']) {
  return (o: ChoiceOption) => {
    const { name, source } = parseSpellRef(o.id);
    return (
      <SpellInfoSheet name={name} source={source} version={version} trigger={infoTrigger(o)} />
    );
  };
}

/**
 * Whether a list of picks shows this one. Only a class's subclass pointer is
 * left out, since the subclass picker beside the class answers it. Any other
 * pick shows even with nothing left in it, so a pending count never leads to
 * a step with nothing on it.
 */
export const listsPick = (p: ChoicePrompt): boolean =>
  !(p.origin.type === 'class' && p.id === subclassPromptId(p.origin.uid));

/** Whether `OriginChoices` with this `match` shows anything, made or not. */
export const hasOriginChoices = (
  sheet: DerivedSheet,
  match: (origin: EffectOrigin) => boolean,
): boolean =>
  sheet.pending.some((p) => match(p.origin) && listsPick(p)) ||
  sheet.resolvedChoices.some((r) => match(r.prompt.origin));

/** Do two stored choice values name the same picks, in the same order? */
function sameChoice(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) =>
    Array.isArray(v) ? v.map(String) : v === undefined ? [] : [String(v)];
  const x = norm(a);
  const y = norm(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * The choices (skills, languages, fighting styles, ASI/feat picks…) generated by
 * one origin, rendered right where that origin lives — under the race card, the
 * class card, etc. — instead of a single flat list where you can't tell what
 * produced each pick. Shows unmade prompts and made choices (with a "change"),
 * and skips the options-less subclass pointer since the subclass picker sits
 * inline already.
 */
export function OriginChoices({
  sheet,
  doc,
  update,
  match,
  registry,
}: {
  sheet: DerivedSheet;
  doc: CharacterDoc;
  update: (recipe: (d: CharacterDoc) => void) => void;
  match: (origin: EffectOrigin) => boolean;
  /** Enables ⓘ full-description drawers on feat options when provided. */
  registry?: EntityRegistry | null;
}) {
  const { policy, scope } = usePickSourcePolicy(doc.allowedSources);
  const pending = sheet.pending.filter((p) => match(p.origin) && listsPick(p));
  const resolved = sheet.resolvedChoices.filter((r) => match(r.prompt.origin));
  // Which already-made pick is open for editing, if any (by prompt id).
  const [editing, setEditing] = useState<string>();
  // Forget an id whose prompt has gone (the origin behind it was swapped out),
  // so it can't silently re-open an editor if that prompt ever comes back.
  if (editing !== undefined && !resolved.some((r) => r.prompt.id === editing)) {
    setEditing(undefined);
  }

  // Spell files and class lists load on demand, so only for a spell pick that is
  // open: most characters never see one, and a made pick reads from its save.
  const openSpellPrompts = [
    ...pending,
    ...resolved.flatMap((r) => (r.prompt.id === editing ? [r.prompt] : [])),
  ].filter((p) => p.kind === 'spell');
  const spellPacks = useTypePacks(openSpellPrompts.length > 0 ? 'spell' : undefined);
  const needsClassLists = openSpellPrompts.some((p) => (p.spellQuery?.classes.length ?? 0) > 0);
  const { lookup, problem: lookupProblem } = useClassLookup(needsClassLists, spellPacks.status);
  const refreshing = useRegistryRefreshing();
  const onClassList = useMemo(
    () => classListCheck(lookup, registry?.byType('spell') ?? []),
    [lookup, registry],
  );

  if (pending.length === 0 && resolved.length === 0) return null;

  const featInfo = registry != null ? featOptionInfo(registry) : undefined;
  const spellInfo = spellOptionInfo(doc.rulesVersion);

  // While these are on their way a short list is not the answer yet. Not an
  // error: that has its panel, and the list is then what there is.
  const spellsSettling =
    spellPacks.status !== 'error' &&
    (registry == null ||
      registry.byType('spell').length === 0 ||
      spellPacks.status === 'loading' ||
      refreshing ||
      (needsClassLists && lookup === null));

  // Feat and optional-feature lists are narrowed to the player's edition and
  // to the character's own sources (or this device's settings when it has
  // none), and a spell pick's list is drawn up here; every other kind renders
  // as the engine built it.
  const shownPrompt = (prompt: ChoicePrompt) => {
    if (registry == null) return prompt;
    const value = doc.choices[prompt.id];
    if (prompt.kind === 'feat' || prompt.kind === 'optionalfeature') {
      return filterEntityPrompt(prompt, registry, doc.rulesVersion, policy, value, scope);
    }
    if (prompt.kind !== 'spell') return prompt;
    const granted = new Set(
      sheet.grantedSpells
        .filter((g) => g.origin === prompt.origin.label)
        .map((g) => g.name.toLowerCase()),
    );
    return fillSpellPrompt(
      prompt,
      { registry, onClassList, version: doc.rulesVersion, policy, scope, granted },
      value,
    );
  };

  const commit = (id: string, value: string[] | string) => {
    // Confirming an untouched pick just closes the editor. Writing it would
    // schedule a save and log a history entry for a no-op.
    if (sameChoice(doc.choices[id], value)) {
      setEditing(undefined);
      return;
    }
    update((d) => {
      // Follow-up prompts (an ASI's feat pick, a feat's own sub-choices) were
      // derived from the answer that just changed, so they no longer apply. The
      // feat's are stored apart from the prompt, and the old answer finds them.
      pruneAsiFeatPicks(d, id);
      d.choices[id] = value;
      for (const key of Object.keys(d.choices)) {
        if (key.startsWith(`${id}:`)) delete d.choices[key];
      }
    });
    setEditing(undefined);
  };

  const editor = (prompt: ChoicePrompt, onCancel?: () => void) => {
    const shown = shownPrompt(prompt);
    const settling = prompt.kind === 'spell' && spellsSettling;
    // The card goes only with nothing to show: once there is a list, the one in it
    // holds the player's unconfirmed taps, and more spells arriving must not reset
    // them. The line beside it says that list is not the whole of it yet.
    if (settling && shown.options.length === 0) {
      return (
        <div className={`${cardClass} flex flex-col gap-1`}>
          <span className="text-body-strong wrap-break-word">{prompt.label}</span>
          <p className="text-caption text-ink-muted">Loading spell list…</p>
        </div>
      );
    }
    return (
      <>
        {settling && <p className="mb-1 text-caption text-ink-muted">Loading spell list…</p>}
        <ChoicePromptRenderer
          prompt={shown}
          value={doc.choices[prompt.id]}
          onChange={(v) => commit(prompt.id, v)}
          onCancel={onCancel}
          renderOptionInfo={
            prompt.kind === 'feat'
              ? featInfo
              : prompt.kind === 'feature'
                ? featureOptionInfo(prompt)
                : prompt.kind === 'spell'
                  ? spellInfo
                  : undefined
          }
        />
      </>
    );
  };

  return (
    <div className="mt-2 flex flex-col gap-2 border-line border-t pt-3">
      {/* One outage is one alert, however many spell picks are waiting on it. */}
      {openSpellPrompts.length > 0 && <PackProblem packs={spellPacks} what="the spell list" />}
      {needsClassLists && spellPacks.status === 'ready' && (
        <PackProblem
          packs={lookupProblem}
          what="the class spell lists"
          message={`The class spell lists couldn't be read on this device${
            lookupProblem.error === null ? '.' : `: ${lookupProblem.error}`
          }`}
        />
      )}
      {pending.map((prompt) => (
        <div key={prompt.id} data-pending-choice="">
          {editor(prompt)}
        </div>
      ))}
      {resolved.map(({ prompt, selected }) =>
        editing === prompt.id ? (
          // Re-opened with the current picks still selected, so swapping one
          // out is a deselect-and-replace rather than starting over.
          <div key={prompt.id}>{editor(prompt, () => setEditing(undefined))}</div>
        ) : (
          <div
            key={prompt.id}
            className="flex items-center justify-between gap-2 rounded-control bg-surface-raised py-1 pr-1 pl-3"
          >
            <div className="min-w-0">
              <div className="truncate">{prompt.label}</div>
              {/* Labels, not ids: "Divine Strike", not "divine strike". */}
              <div className="truncate text-caption text-ink-muted">
                {selected
                  .map((id) => prompt.options.find((o) => o.id === id)?.label ?? id)
                  .join(', ')}
              </div>
            </div>
            <button
              type="button"
              aria-label={`Change ${prompt.label}`}
              title="Change this pick"
              onClick={() => setEditing(prompt.id)}
              className={`shrink-0 ${buttonClass({ variant: 'outline', size: 'sm' })}`}
            >
              <RefreshCcw size={14} aria-hidden /> Change
            </button>
          </div>
        ),
      )}
    </div>
  );
}
