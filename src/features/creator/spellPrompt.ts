import type { Entity } from '@/data5e/copyMod';
import type { EntityRegistry } from '@/data5e/normalize';
import { filterByRulesVersion, type RulesVersion } from '@/data5e/rulesVersion';
import {
  applySourcePolicy,
  OUTSIDE_CHARACTER_ADVISORY,
  type PolicyScope,
  policyAllows,
  type SourcePolicy,
} from '@/data5e/sourceFilter';
import { parseSpellRef } from '@/engine/effects/additionalSpells';
import { spellFitsQuery } from '@/engine/spellQuery';
import type { ChoiceOption, ChoicePrompt } from '@/engine/types';
import { findSpell } from '@/features/sheet/spellData';
import { spellMeta } from '@/features/sheet/spellMeta';

const nameOf = (e: Entity) => String(e.name);
const sourceOf = (e: Entity) => String(e.source);
const uidOf = (e: Entity) => `${nameOf(e)}|${sourceOf(e)}`.toLowerCase();
const levelOf = (e: Entity) => (typeof e.level === 'number' ? e.level : 0);

/** What a `spell` prompt's list is drawn from, for one character. */
export interface SpellPool {
  registry: EntityRegistry;
  /** Whether the spell with this uid is on this class's list. */
  onClassList: (className: string, uid: string) => boolean;
  version: RulesVersion;
  policy: SourcePolicy;
  scope: PolicyScope;
  /** The spells the prompt's origin gives, as lower-case names. */
  granted: ReadonlySet<string>;
}

/**
 * Fill a `spell` prompt with what the engine cannot list: the spells that fit its
 * query, narrowed as feat lists are (see `filterEntityPrompt`), saved picks kept,
 * and each with its caption. A spell the same origin gives already is disabled,
 * since a second copy of it would be a pick that gains nothing.
 */
export function fillSpellPrompt(
  prompt: ChoicePrompt,
  pool: SpellPool,
  value: string[] | string | number | undefined,
): ChoicePrompt {
  const { registry, onClassList, version, policy, scope, granted } = pool;
  const raw = Array.isArray(value) ? value : value !== undefined ? [value] : [];
  const picks = new Set(raw.map((pick) => String(pick).toLowerCase()));
  // The origin gives a spell this prompt picked because this prompt picked it, which
  // must not stop the prompt moving to another printing of it.
  const ownNames = new Set(raw.map((pick) => parseSpellRef(String(pick)).name.toLowerCase()));
  const disabled = (name: string): Pick<ChoiceOption, 'disabled'> =>
    granted.has(name.toLowerCase()) && !ownNames.has(name.toLowerCase())
      ? { disabled: { reason: `${prompt.origin.label} already gives you this spell` } }
      : {};

  const query = prompt.spellQuery;
  if (query === undefined) {
    // A list the data spells out, so nothing narrows it. It names no printing:
    // the caption is the one this character would be shown.
    return {
      ...prompt,
      options: prompt.options.map((option) => {
        const { name, source } = parseSpellRef(option.id);
        const spell = findSpell(registry, name, source, version);
        return {
          ...option,
          ...(spell !== undefined ? { description: spellMeta(spell) } : {}),
          ...disabled(name),
        };
      }),
    };
  }

  const isPicked = (s: Entity) => picks.has(uidOf(s));
  const fits = registry
    .byType('spell')
    .filter(
      (s) =>
        spellFitsQuery(s, query) &&
        (query.classes.length === 0 || query.classes.some((c) => onClassList(c, uidOf(s)))),
    );
  // Each narrowing is skipped when it would leave nothing: a list to pick from
  // that is empty for this character's books is a dead end, not an answer. A saved
  // pick stays listed but does not count, since alone it leaves nothing to change to.
  const candidates =
    filterByRulesVersion(fits, version).length > 0
      ? filterByRulesVersion(fits, version, { keep: isPicked })
      : fits;
  const shown =
    applySourcePolicy(candidates, policy, sourceOf).length > 0
      ? applySourcePolicy(candidates, policy, sourceOf, isPicked)
      : candidates;

  const printings = new Map<string, number>();
  for (const s of shown) printings.set(nameOf(s), (printings.get(nameOf(s)) ?? 0) + 1);
  const options = [...shown]
    .sort((a, b) => levelOf(a) - levelOf(b) || nameOf(a).localeCompare(nameOf(b)))
    .map((s): ChoiceOption => {
      const id = `${nameOf(s)}|${sourceOf(s)}`;
      return {
        id,
        // The same name twice is two printings the character can tell apart only by book.
        label: (printings.get(nameOf(s)) ?? 0) > 1 ? `${nameOf(s)} (${sourceOf(s)})` : nameOf(s),
        description: spellMeta(s, { withLevel: query.levels.length !== 1 }),
        ...disabled(nameOf(s)),
        ...(scope === 'character' && !policyAllows(policy, sourceOf(s))
          ? { advisory: `${OUTSIDE_CHARACTER_ADVISORY}.` }
          : {}),
      };
    });
  // A saved pick the list has nothing for (its file is not in yet) stays listed,
  // so it reads as selected rather than vanishing.
  const listed = new Set(options.map((option) => option.id.toLowerCase()));
  return {
    ...prompt,
    options: [...prompt.options.filter((o) => !listed.has(o.id.toLowerCase())), ...options],
  };
}
